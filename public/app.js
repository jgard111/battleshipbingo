import * as R from "/shared.js";

const app = document.getElementById("app");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "x");
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const iconUrl = id => (id ? "/icons/" + id + ".png" : "");

/* ---------------- routing ---------------- */
const parts = location.pathname.split("/").filter(Boolean);
const route = parts[0] === "g" && parts[1] ? { slug: decodeURIComponent(parts[1]), admin: parts[2] === "admin" } : { home: true };
const slug = route.slug;
const ADMIN_KEY = "bb:admin:" + slug, TEAM_KEY = "bb:team:" + slug;

let G = null, ROLE = "public", MYTEAM = null;
const ui = { tab: "board", sel: null, libQ: "", lib: null, libBusy: false, attacker: 0, target: null, player: "", showFleets: true, placing: null, confirm: null, err: {}, designer: null, fresh: null, welcome: new URLSearchParams(location.search).has("new"), importOpen: null };

/* ---------------- api ---------------- */
function token() { return route.admin ? store.get(ADMIN_KEY) : store.get(TEAM_KEY); }
async function api(method, p, body, opts = {}) {
  const headers = {};
  const t = opts.noAuth ? null : token();
  if (t) headers.Authorization = "Bearer " + t;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error(j.error || "Request failed (" + r.status + ")");
    e.status = r.status;
    if (r.status === 401 && t && !opts.keepToken) { store.del(route.admin ? ADMIN_KEY : TEAM_KEY); }
    throw e;
  }
  return j;
}
const gapi = (method, sub, body, opts) => api(method, "/api/g/" + encodeURIComponent(slug) + (sub ? "/" + sub : ""), body, opts);
function take(j) {
  if (!j || !j.game) return;
  G = j.game; ROLE = j.role; MYTEAM = j.team != null ? j.team : null;
  if (G.status !== "setup" && ui.placing) ui.placing = null;
}

/* ---------------- ops queue (admin autosave) ---------------- */
const pending = new Map();
let opTimer = null, inflight = false, refreshWanted = false;
function queueOp(key, op, delay = 500) {
  pending.set(key, op);
  clearTimeout(opTimer);
  opTimer = setTimeout(flushOps, delay);
  paintSaving();
}
async function flushOps() {
  if (inflight || !pending.size) return;
  const ops = [...pending.values()];
  pending.clear();
  inflight = true; paintSaving();
  try {
    const j = await gapi("POST", "ops", { ops });
    if (!pending.size) take(j);
  } catch (e) { toast(e.message, "error"); await refresh(); }
  inflight = false;
  if (pending.size) flushOps();
  else { paintSaving(); if (refreshWanted) { refreshWanted = false; await refresh(); } else render(); }
}
function paintSaving() {
  const el = document.getElementById("saving");
  if (el) el.textContent = inflight || pending.size ? "Saving…" : "All changes saved";
}

/* ---------------- live updates ---------------- */
let refreshTimer = null;
async function refresh() {
  try { take(await gapi("GET", "")); render(); }
  catch (e) { if (e.status === 404) { G = null; render(); } }
}
function startEvents() {
  if (!window.EventSource) return;
  const es = new EventSource("/api/g/" + encodeURIComponent(slug) + "/events");
  es.onmessage = ev => {
    let d = {}; try { d = JSON.parse(ev.data); } catch {}
    if (G && d.v === G.version) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (inflight || pending.size || ui.placing || ui.designer || busyAction) { refreshWanted = true; return; }
      refresh();
    }, 250);
  };
}

/* ---------------- toast / tooltip / modal ---------------- */
let toastT = null;
function toast(msg, kind) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, kind === "error" ? 6000 : 3200);
}
const tip = document.createElement("div");
tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
function showTip(cellEl) {
  if (!G) return;
  const i = +cellEl.dataset.cell; const c = G.cells[i]; if (!c) return;
  const st = cellEl.dataset.st;
  tip.innerHTML = '<span class="co">' + R.coord(G, i) + (st ? " · " + esc(st.toUpperCase()) : "") + "</span><b>" + esc(c.name || "Empty square") + "</b>" + (c.hover ? "<span>" + esc(c.hover) + "</span>" : "");
  tip.hidden = false;
  const r = cellEl.getBoundingClientRect(); const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(x, innerWidth - w - 8));
  let y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function openModal(inner, wide) {
  closeModal();
  const bg = document.createElement("div");
  bg.className = "modal-bg"; bg.id = "modal";
  bg.innerHTML = '<div class="modal' + (wide ? " wide" : "") + '" role="dialog" aria-modal="true">' + inner + "</div>";
  bg.addEventListener("click", e => { if (e.target === bg) { closeModal(); ui.designer = null; } });
  document.body.appendChild(bg);
}
function closeModal() { const m = document.getElementById("modal"); if (m) m.remove(); }
async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label || "Copied."); }
  catch { openModal('<h2>Copy this</h2><textarea id="copy-fallback" class="code" rows="5" readonly>' + esc(text) + '</textarea><div class="row"><button class="btn" data-act="close-modal">Close</button></div>'); const ta = document.getElementById("copy-fallback"); if (ta) { ta.focus(); ta.select(); } }
}

/* ---------------- helpers ---------------- */
const tname = t => R.teamName(G, t);
const tcol = t => (G.teams[t] && G.teams[t].color) || "#888";
const N = () => G.rows * G.cols;
const shotsAt = d => G.attacks.filter(a => a.by === 1 - d);
const sunkAt = d => R.sunkAt(G, d);
const units = () => R.units(G);
const anyFleet = () => !!(G.fleetReady[0] || G.fleetReady[1]);
const setup = () => G.status === "setup";
const publicLink = () => location.origin + "/g/" + slug;
const adminLink = () => location.origin + "/g/" + slug + "/admin";
function timeAgo(t) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + "s ago"; const m = Math.round(s / 60); if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 48) return h + "h ago"; return new Date(t).toLocaleDateString();
}
function miniShape(shape, m) {
  const t = R.normShape(shape);
  const h = Math.max(...t.map(q => q[0])) + 1, w = Math.max(...t.map(q => q[1])) + 1;
  const set = new Set(t.map(q => q.join(",")));
  let o = '<span class="mini" aria-hidden="true" style="--m:' + (m || 7) + "px;grid-template-columns:repeat(" + w + ',var(--m))">';
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) o += "<i" + (set.has(r + "," + c) ? ' class="on"' : "") + "></i>";
  return o + "</span>";
}
const statusChip = () => '<span class="status ' + G.status + '">' + (G.status === "setup" ? "Setting up" : G.status === "live" ? "● Live" : "Finished") + "</span>";

/* ---------------- board ---------------- */
function boardHTML(d, mode, opts = {}) {
  const shots = {}, sunk = new Set();
  if (mode !== "edit") { for (const a of shotsAt(d)) shots[a.cell] = a; for (const s of sunkAt(d)) s.cells.forEach(i => sunk.add(i)); }
  const own = new Set(); if (opts.layout) opts.layout.ships.forEach(s => s.cells.forEach(i => own.add(i)));
  let h = '<div class="board-wrap"><div class="grid" style="grid-template-columns:22px repeat(' + G.cols + ",var(--cell));--team:" + esc(tcol(d)) + '"><span></span>';
  for (let c = 0; c < G.cols; c++) h += '<span class="lab">' + R.LETTERS[c] + "</span>";
  for (let r = 0; r < G.rows; r++) {
    h += '<span class="lab">' + (r + 1) + "</span>";
    for (let c = 0; c < G.cols; c++) {
      const i = r * G.cols + c, cell = G.cells[i] || {}, s = shots[i];
      let cls = "cell", st = "";
      if (s) { cls += " " + (s.result === "hit" ? "hit" : "miss"); st = s.result; }
      if (sunk.has(i)) { cls += " sunk"; st = "sunk"; }
      if (own.has(i)) cls += " ship";
      if (opts.sel === i) cls += " sel";
      if (mode === "attack" && s) cls += " dead";
      if (ui.fresh && s && s.id === ui.fresh) cls += " fresh";
      const lbl = R.coord(G, i) + " " + (cell.name || "empty") + (st ? ", " + st : "");
      h += '<button type="button" class="' + cls + '" data-cell="' + i + '" data-board="' + d + '" data-mode="' + mode + '" data-st="' + st + '" aria-label="' + esc(lbl) + '">' +
        (cell.icon ? '<img alt="" src="' + iconUrl(cell.icon) + '">' : cell.name ? '<span class="nm">' + esc(cell.name) + "</span>" : "") +
        (s ? '<span class="mk ' + (s.result === "hit" ? "hit" : "miss") + '"></span>' : "") + "</button>";
    }
  }
  return h + "</div></div>";
}
const legend = withShips => '<div class="legend"><span><i><span class="mk hit"></span></i>Hit</span><span><i><span class="mk miss"></span></i>Miss</span><span><i class="h"></i>Sunk ship</span>' + (withShips ? '<span><i class="s"></i>Your ships</span>' : "") + "</div>";

/* ---------------- home ---------------- */
function viewHome() {
  const demo = "........" + "..m.hh.." + "........" + ".h..m..." + "........" + "...m..h." + ".h......" + "........";
  return '<main class="home"><div class="hero">' +
    '<span class="eyebrow">Old School RuneScape · Clan events</span>' +
    "<h1>Battleship Bingo</h1>" +
    '<div class="mini-board" aria-hidden="true">' + [...demo].map(ch => "<i" + (ch === "h" ? ' class="h"' : ch === "m" ? ' class="m"' : "") + "></i>").join("") + "</div>" +
    '<p class="lead">Fill a board with drops, split your clan into two teams and hide your fleets. Every drop lets your team fire at that square. Sink the other team\'s ships to win.</p>' +
    (ui.creating ? createForm() : '<button class="btn primary big" data-act="create-open">Create game</button>') +
    "</div></main>";
}
function createForm() {
  const c = ui.creating;
  return '<form class="panel stack create" data-form="create" autocomplete="off"><h2>Create a game</h2>' +
    '<label class="f"><span>Game name</span><input id="cg-name" type="text" maxlength="80" required placeholder="e.g. Iron Legion Autumn Bingo" value="' + esc(c.name) + '"></label>' +
    '<label class="f"><span>Link name</span><input id="cg-slug" type="text" maxlength="40" required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value="' + esc(c.slug) + '"></label>' +
    '<p class="muted" style="font-size:13px" id="cg-slug-note">' + slugNote() + "</p>" +
    '<label class="f"><span>Admin password</span><input id="cg-pw" type="password" autocomplete="new-password" minlength="6" required></label>' +
    '<label class="f"><span>Confirm password</span><input id="cg-pw2" type="password" autocomplete="new-password" required></label>' +
    '<p class="muted" style="font-size:13px">Share this password only with your admins. It can\'t be recovered if lost.</p>' +
    (ui.err.create ? '<p class="err">' + esc(ui.err.create) + "</p>" : "") +
    '<div class="row"><button class="btn primary" type="submit">Create game</button><button class="btn ghost" type="button" data-act="create-cancel">Cancel</button></div></form>';
}
function slugNote() {
  const c = ui.creating; if (!c) return "";
  const link = location.host + "/g/" + (c.slug || "…");
  if (!c.slug) return "Your public link will be " + esc(link);
  if (c.slugOk === false) return '<span class="err">' + esc(link) + " is taken or not allowed. Try another.</span>";
  if (c.slugOk === true) return '<span class="okc">' + esc(link) + " is free.</span>";
  return "Your public link will be " + esc(link);
}
let slugTimer = null;
function checkSlug() {
  clearTimeout(slugTimer);
  slugTimer = setTimeout(async () => {
    const c = ui.creating; if (!c || !c.slug) return;
    const asked = c.slug;
    try { const j = await api("GET", "/api/slug?s=" + encodeURIComponent(asked), undefined, { noAuth: true }); if (ui.creating && ui.creating.slug === asked) { ui.creating.slugOk = j.ok && j.slug === asked; const n = document.getElementById("cg-slug-note"); if (n) n.innerHTML = slugNote(); } } catch {}
  }, 300);
}
const slugify = s => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

/* ---------------- public ---------------- */
function teamCard(t) {
  const shots = G.attacks.filter(a => a.by === t), hits = shots.filter(a => a.result === "hit").length;
  const lost = sunkAt(t).map(s => s.id);
  return '<div class="panel team-card" style="--team:' + esc(tcol(t)) + '"><span class="dot"></span><span class="name">' + esc(tname(t)) + "</span>" +
    '<div class="stats"><div class="stat"><b>' + shots.length + '</b><span>Shots</span></div><div class="stat"><b>' + hits + '</b><span>Hits</span></div><div class="stat"><b>' + sunkAt(1 - t).length + "/" + units().length + '</b><span>Ships sunk</span></div><div class="stat"><b>' + (units().length - lost.length) + "</b><span>Ships afloat</span></div></div>" +
    '<div class="hulls">' + units().map(u => '<span class="hull' + (lost.includes(u.id) ? " down" : "") + '" title="' + u.size + ' squares">' + miniShape(u.shape, 4) + " " + esc(u.name) + "</span>").join("") + "</div></div>";
}
function shotRow(a, admin) {
  const c = G.cells[a.cell] || {};
  const res = a.sunk ? '<span class="tag sunk">Sunk ' + esc(a.sunk.name) + "</span>" : '<span class="tag ' + a.result + '">' + a.result + "</span>";
  let h = '<div class="shot"><span class="dot" style="--team:' + esc(tcol(a.by)) + '"></span>' +
    (c.icon ? '<img alt="" src="' + iconUrl(c.icon) + '">' : '<span class="co">' + R.coord(G, a.cell) + "</span>") +
    '<div class="txt"><div class="row" style="gap:8px"><b>' + esc(tname(a.by)) + "</b>" + (a.player ? '<span class="muted">' + esc(a.player) + "</span>" : "") + res + '</div><div class="muted" style="font-size:13px">' + R.coord(G, a.cell) + " · " + esc(c.name || "Empty square") + " · " + esc(tname(1 - a.by)) + "'s waters</div></div>" +
    '<span class="when">' + (a.t ? timeAgo(a.t) : "") + "</span>";
  if (admin) {
    h += '<div class="shot-actions"><button class="btn sm" data-act="copy-text" data-id="' + a.id + '">Copy for Discord</button><button class="btn sm" data-act="board-img" data-d="' + (1 - a.by) + '">Board image</button>' +
      (ui.confirm === "del-" + a.id ? '<span class="err">Delete this shot?</span><button class="btn sm danger" data-act="del-shot" data-id="' + a.id + '">Delete</button><button class="btn sm ghost" data-act="cancel-confirm">Keep</button>' : '<button class="btn sm ghost danger" data-act="ask" data-k="del-' + a.id + '">Delete</button>') + "</div>";
  }
  return h + "</div>";
}
function myFleet() { return ROLE === "captain" ? G.myFleet : null; }
function viewPublic() {
  const w = G.status === "finished" ? G.winner : null;
  let h = '<div class="wrap"><header class="top"><div class="brand"><span class="eyebrow">Battleship Bingo</span><h1>' + esc(G.title) + "</h1></div>" +
    '<div class="row">' + statusChip() + (ROLE === "captain" ? '<span class="chip" style="--team:' + esc(tcol(MYTEAM)) + '"><span class="dot"></span>' + esc(tname(MYTEAM)) + ' captain</span><button class="btn" data-act="team-logout">Log out</button>' : '<button class="btn" data-act="team-login">Captain login</button>') + "</div></header>";
  if (setup()) {
    h += '<div class="banner"><span>The game hasn\'t started yet. ' + (ROLE === "captain" ? (G.myFleet ? "Your fleet is placed. You can move it until the admin starts the game." : "Place your fleet on your team's board below.") : "Captains, log in to place your fleet.") + "</span>" +
      '<span class="row" style="gap:12px">' + [0, 1].map(t => '<span class="chip" style="--team:' + esc(tcol(t)) + '"><span class="dot"></span>' + esc(tname(t)) + ": " + (G.fleetReady[t] ? "fleet ready" : "placing ships") + "</span>").join("") + "</span></div>";
  }
  if (w != null) h += '<div class="banner win"><b>' + esc(tname(w)) + " sank every ship. They win!</b></div>";
  h += '<section class="score">' + teamCard(0) + teamCard(1) + "</section><section class=\"boards\">";
  for (let d = 0; d < 2; d++) {
    const mine = ROLE === "captain" && MYTEAM === d;
    if (mine && ui.placing && ui.placing.team === d) { h += placementPanel(); continue; }
    h += '<div class="panel"><div class="board-head"><div><h2 style="color:' + esc(tcol(d)) + '">' + esc(tname(d)) + "'s waters</h2><div class=\"sub\">" + esc(tname(1 - d)) + " fires here</div></div>" +
      (mine && setup() ? '<button class="btn primary sm" data-act="captain-place">' + (G.myFleet ? "Move ships" : "Place your fleet") + "</button>" : "") + "</div>" +
      boardHTML(d, "view", { layout: mine ? G.myFleet : null }) + legend(mine && !!G.myFleet) + "</div>";
  }
  h += "</section>";
  const shots = G.attacks.slice().reverse();
  h += '<section class="panel"><div class="board-head"><h2>Shots fired</h2><span class="sub">' + G.attacks.length + " total</span></div>" +
    (shots.length ? '<div class="log">' + shots.slice(0, 50).map(a => shotRow(a, false)).join("") + "</div>" : '<p class="muted">' + (setup() ? "Shots appear here once the game starts." : "No shots yet. Each drop from the board lets that team fire at the matching square.") + "</p>") + "</section>";
  if (G.rules) h += '<details class="rules panel"' + (setup() ? " open" : "") + '><summary>How to play</summary><p>' + esc(G.rules) + "</p></details>";
  h += '<footer><span>Item icons from the Old School RuneScape Wiki.</span><a href="/g/' + esc(slug) + '/admin">Admin</a></footer></div>';
  return h;
}
function teamLoginModal() {
  const ready = [0, 1].filter(t => G.teams[t].hasPass);
  openModal("<h2>Captain login</h2>" + (ready.length
    ? '<p class="muted" style="font-size:14px">Use the passcode your admin gave you. You\'ll see your own ships' + (setup() ? ", and you can place them until the game starts" : "") + '.</p><form class="stack" data-form="team-login"><label class="f"><span>Team</span><select id="tl-team">' + ready.map(t => '<option value="' + t + '">' + esc(tname(t)) + "</option>").join("") + '</select></label><label class="f"><span>Passcode</span><input id="tl-pass" type="password" required autocomplete="off"></label><p class="err" id="tl-err" hidden></p><div class="row"><button class="btn primary" type="submit">Log in</button><button class="btn ghost" type="button" data-act="close-modal">Cancel</button></div></form>'
    : '<p>Your admin hasn\'t set team passcodes yet.</p><div><button class="btn" data-act="close-modal">Close</button></div>'));
  const p = document.getElementById("tl-pass"); if (p) p.focus();
}

/* ---------------- placement ---------------- */
function startPlacing(t, existing) {
  const ships = {};
  if (existing) existing.ships.forEach(x => (ships[x.id] = x.cells.slice()));
  ui.placing = { team: t, ships, sel: (units().find(u => !ships[u.id]) || units()[0] || {}).id, rot: 0, flip: false, msg: "" };
}
function placementPanel() {
  const p = ui.placing, t = p.team, us = units();
  const lay = { ships: Object.keys(p.ships).map(id => ({ id, cells: p.ships[id] })) };
  const done = us.every(u => p.ships[u.id]);
  const cur = us.find(u => u.id === p.sel);
  return '<div class="panel" style="--team:' + esc(tcol(t)) + '"><div class="board-head"><div><h2 style="color:' + esc(tcol(t)) + '">Place ' + esc(tname(t)) + "'s fleet</h2><div class=\"sub\">Pick a ship, then click a square. The outline shows where it lands. Click a placed ship to pick it back up.</div></div>" +
    '<div class="row" style="gap:6px">' + (cur ? '<span class="chip">' + miniShape(R.transform(cur.shape, p.rot, p.flip), 6) + " " + esc(cur.name) + "</span>" : "") + '<button class="btn sm" data-act="rot" title="Rotate (R)">Rotate</button><button class="btn sm" data-act="flip" title="Flip (F)">Flip</button></div></div>' +
    '<div class="fleet-list" style="margin-bottom:12px">' + us.map(u => '<button data-act="pick-ship" data-id="' + esc(u.id) + '" aria-pressed="' + (p.sel === u.id) + '" class="' + (p.ships[u.id] ? "done" : "") + '" style="display:inline-flex;align-items:center;gap:6px">' + miniShape(u.shape, 5) + (p.ships[u.id] ? "✓ " : "") + esc(u.name) + "</button>").join("") + "</div>" +
    boardHTML(t, "place", { layout: lay }) +
    (p.msg ? '<p class="err" style="margin-top:8px">' + esc(p.msg) + "</p>" : "") +
    '<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn ghost" data-act="cancel-place">Cancel</button><button class="btn" data-act="clear-place">Clear all</button><button class="btn primary" data-act="finish-place"' + (done ? "" : " disabled") + ">Save fleet</button></div></div>";
}
function placeCells(i) {
  const p = ui.placing; const u = units().find(x => x.id === p.sel); if (!u) return { err: "Pick a ship first." };
  const t = R.transform(u.shape, p.rot, p.flip); const a = t[0]; const r0 = Math.floor(i / G.cols), c0 = i % G.cols; const cells = [];
  for (const q of t) {
    const rr = r0 + q[0] - a[0], cc = c0 + q[1] - a[1];
    if (rr < 0 || cc < 0 || rr >= G.rows || cc >= G.cols) return { u, err: u.name + " doesn't fit there. Try another square, or rotate it." };
    cells.push(rr * G.cols + cc);
  }
  for (const id in p.ships) if (id !== u.id && p.ships[id].some(x => cells.includes(x))) return { u, cells, err: "That overlaps another ship." };
  return { u, cells };
}
function placeAt(i) {
  const p = ui.placing;
  for (const id in p.ships) if (p.ships[id].includes(i)) { delete p.ships[id]; p.sel = id; p.msg = ""; return; }
  const r = placeCells(i); if (r.err) { p.msg = r.err; return; }
  p.ships[r.u.id] = r.cells; p.msg = "";
  const next = units().find(u => !p.ships[u.id]); p.sel = next ? next.id : null;
}
function previewAt(i) {
  document.querySelectorAll(".cell.ghost,.cell.bad").forEach(c => c.classList.remove("ghost", "bad"));
  if (i == null || !ui.placing) return;
  for (const id in ui.placing.ships) if (ui.placing.ships[id].includes(i)) return;
  const r = placeCells(i); if (!r.cells) return;
  r.cells.forEach(k => { const el = document.querySelector('.cell[data-mode="place"][data-cell="' + k + '"]'); if (el) el.classList.add(r.err ? "bad" : "ghost"); });
}
async function finishPlace() {
  const p = ui.placing;
  const lay = { ships: units().map(u => ({ id: u.id, cells: p.ships[u.id] })) };
  const bad = R.validLayout(G, lay);
  if (bad) { p.msg = bad; render(); return; }
  try {
    take(await gapi("PUT", "fleet/" + p.team, lay));
    ui.placing = null; toast(tname(p.team) + "'s fleet is saved.");
  } catch (e) { p.msg = e.message; }
  render();
  if (refreshWanted) { refreshWanted = false; refresh(); }
}

/* ---------------- admin ---------------- */
function viewAdmin() {
  let h = '<div class="wrap"><header class="top"><div class="brand"><span class="eyebrow">Admin</span><h1>' + esc(G ? G.title : "Battleship Bingo") + "</h1></div>";
  if (ROLE !== "admin") {
    return h + '</header><section class="panel stack" style="max-width:420px"><h2>Admin login</h2><form class="stack" data-form="admin-login"><label class="f"><span>Admin password</span><input id="pw" type="password" autocomplete="current-password" required></label>' +
      (ui.err.login ? '<p class="err">' + esc(ui.err.login) + "</p>" : "") + '<div class="row"><button class="btn primary" type="submit">Log in</button><a class="btn ghost" href="/g/' + esc(slug) + '">View board</a></div></form></section></div>';
  }
  h += '<div class="row">' + statusChip() + '<span class="saving" id="saving">All changes saved</span><a class="btn" href="/g/' + esc(slug) + '" target="_blank" rel="noopener">View board</a><button class="btn ghost" data-act="admin-logout">Log out</button></div></header>';
  if (ui.welcome) h += '<div class="banner win" style="display:grid;gap:10px"><b>Your game is ready.</b>' +
    '<div class="linkbox"><span style="min-width:92px">Public link</span><code>' + esc(publicLink()) + '</code><button class="btn sm" data-act="copy" data-v="' + esc(publicLink()) + '">Copy</button></div>' +
    '<div class="linkbox"><span style="min-width:92px">Admin page</span><code>' + esc(adminLink()) + '</code><button class="btn sm" data-act="copy" data-v="' + esc(adminLink()) + '">Copy</button></div>' +
    '<span class="muted" style="font-size:13px">Share the public link with your clan. Admins log in at the admin page with the password you just set.</span><div><button class="btn sm ghost" data-act="welcome-close">Got it</button></div></div>';
  if (G.discord && G.discord.url && G.discord.lastError) h += '<div class="banner bad"><span>Discord: ' + esc(G.discord.lastError) + '</span><button class="btn sm" data-act="tab" data-tab="settings">Open settings</button></div>';
  h += phasePanel();
  const tabs = [["board", "Board"], ["fleets", "Ships & fleets"], ["shots", "Shots"], ["settings", "Settings"]];
  h += '<nav class="tabs" role="tablist">' + tabs.map(t => '<button class="tab" role="tab" data-act="tab" data-tab="' + t[0] + '" aria-selected="' + (ui.tab === t[0]) + '">' + t[1] + "</button>").join("") + "</nav>";
  h += ui.tab === "board" ? tabBoard() : ui.tab === "fleets" ? tabFleets() : ui.tab === "shots" ? tabShots() : tabSettings();
  return h + "</div>";
}
function phasePanel() {
  if (G.status === "setup") {
    const passes = G.teams.filter(t => t.hasPass).length, fleets = G.fleetReady.filter(Boolean).length;
    const ready = fleets === 2;
    return '<section class="panel stack"><div class="row" style="justify-content:space-between"><div class="stack" style="gap:8px"><h2>Get the game ready</h2><ul class="checklist">' +
      '<li><span class="' + (G.cells.some(c => c.name || c.icon) ? "ok" : "no") + '">' + (G.cells.some(c => c.name || c.icon) ? "✓" : "○") + "</span>Fill the board squares (Board tab)</li>" +
      '<li><span class="' + (passes === 2 ? "ok" : "no") + '">' + (passes === 2 ? "✓" : "○") + "</span>Set both team passcodes (" + passes + "/2, Ships & fleets tab)</li>" +
      '<li><span class="' + (ready ? "ok" : "no") + '">' + (ready ? "✓" : "○") + "</span>Both captains place their fleets (" + fleets + "/2)</li></ul></div>" +
      '<div class="stack" style="gap:6px;justify-items:end">' + (ui.confirm === "start"
        ? '<p style="font-size:14px;max-width:34ch">Starting locks both fleets, the ships and the board size. Start now?</p><div class="row"><button class="btn primary" data-act="start">Yes, start the game</button><button class="btn ghost" data-act="cancel-confirm">Not yet</button></div>'
        : '<button class="btn primary" data-act="ask" data-k="start"' + (ready ? "" : " disabled") + ">Start game</button>" + (ready ? "" : '<span class="muted" style="font-size:12px">Needs both fleets placed</span>')) + "</div></div></section>";
  }
  if (G.status === "live") return '<section class="panel row" style="justify-content:space-between"><span><b>The game is live.</b> <span class="muted">Started ' + timeAgo(G.startedAt) + ". Fleets are locked.</span></span>" + (ui.tab !== "shots" ? '<button class="btn primary" data-act="tab" data-tab="shots">Record a shot</button>' : "") + "</section>";
  return '<section class="banner win"><b>' + esc(tname(G.winner)) + " won the game.</b><span class=\"muted\">Delete a shot to reopen it, or reset in Settings.</span></section>";
}
function tabBoard() {
  const i = ui.sel;
  let h = '<div class="split"><div class="panel"><div class="board-head"><div><h2>Item squares</h2><div class="sub">Click a square to set its item and hover text. Both teams share this grid.</div></div></div>' + boardHTML(0, "edit", { sel: i }) + '</div><div class="stack">';
  if (i == null || !G.cells[i]) h += '<div class="panel"><p class="muted">Select a square on the board to edit it.</p></div>';
  else {
    const c = G.cells[i];
    h += '<div class="panel stack"><div class="editor-preview"><div class="big">' + (c.icon ? '<img alt="" src="' + iconUrl(c.icon) + '">' : "") + '</div><div><div class="eyebrow">Square ' + R.coord(G, i) + '</div><h3 id="ed-title">' + esc(c.name || "Empty square") + "</h3></div></div>" +
      '<label class="f"><span>Find an item</span><input id="lib-q" type="search" placeholder="Search any OSRS item: whip, pet, ancestral…" value="' + esc(ui.libQ) + '" autocomplete="off"></label><div class="lib" id="lib-res">' + libResults() + "</div>" +
      '<label class="f"><span>Item name</span><input id="ed-name" type="text" maxlength="80" data-bind="name" value="' + esc(c.name) + '"></label>' +
      '<label class="f"><span>Hover text</span><textarea id="ed-hover" maxlength="300" data-bind="hover" placeholder="e.g. Any Tormented Demon unique counts">' + esc(c.hover) + "</textarea></label>" +
      '<div class="row"><label class="btn sm" for="ed-file">Upload image</label><input id="ed-file" type="file" accept="image/*" hidden><span class="muted" style="font-size:12px">or paste an image</span><button class="btn sm ghost danger" data-act="clear-cell">Clear square</button></div>' +
      '<div class="row" style="justify-content:space-between"><button class="btn sm" data-act="sel-move" data-d="-1">← Previous</button><button class="btn sm" data-act="sel-move" data-d="1">Next →</button></div></div>';
  }
  const lockSize = !setup() || anyFleet();
  h += '<details class="panel"><summary style="cursor:pointer;font-weight:700">Board size</summary><div class="stack" style="margin-top:12px">' +
    (lockSize ? '<p class="muted" style="font-size:13px">' + (setup() ? "Remove the placed fleets to change the size." : "The size is locked once the game starts.") + "</p>" : "") +
    '<div class="row"><label class="f" style="width:110px"><span>Rows</span><input id="sz-r" type="number" min="3" max="15" value="' + G.rows + '"' + (lockSize ? " disabled" : "") + '></label><label class="f" style="width:110px"><span>Columns</span><input id="sz-c" type="number" min="3" max="15" value="' + G.cols + '"' + (lockSize ? " disabled" : "") + '></label><button class="btn" data-act="resize" style="align-self:end"' + (lockSize ? " disabled" : "") + ">Apply</button></div></div></details>" +
    '<details class="panel"><summary style="cursor:pointer;font-weight:700">Fill squares from a list</summary><div class="stack" style="margin-top:12px"><p class="muted" style="font-size:13px">One item per line, filled left to right from A1. Each name is looked up on the OSRS Wiki.</p><textarea id="bulk" rows="6" placeholder="Twisted bow&#10;Dragon warhammer&#10;Pet zilyana"></textarea>' +
    (ui.err.bulk ? '<p class="muted" style="font-size:13px">' + esc(ui.err.bulk) + "</p>" : "") + '<div><button class="btn" data-act="bulk"' + (busyAction ? " disabled" : "") + ">Fill squares</button></div></div></details>";
  return h + "</div></div>";
}
function libResults() {
  const L = ui.lib;
  if (!ui.libQ || ui.libQ.trim().length < 2) return '<p class="note">Type at least 2 letters. Results come from saved icons and the OSRS Wiki.</p>';
  if (!L) return '<p class="note">Searching…</p>';
  let h = "";
  if (L.local.length) h += '<p class="res-head">Saved icons</p>' + L.local.map(x => '<button type="button" data-act="pick-icon" data-id="' + x.id + '" data-n="' + esc(x.name) + '" ><img alt="" src="' + iconUrl(x.id) + '"><span>' + esc(x.name) + "</span></button>").join("");
  if (L.wiki.length) h += '<p class="res-head">From the OSRS Wiki</p>' + L.wiki.map(x => '<button type="button" class="wiki" data-act="pick-wiki" data-n="' + esc(x.name) + '" ><img alt="" referrerpolicy="no-referrer" src="' + esc(x.thumb) + '"><span>' + esc(x.name) + "</span></button>").join("");
  if (ui.libBusy) h += '<p class="note">Searching the wiki…</p>';
  if (L.wikiError) h += '<p class="note">' + esc(L.wikiError) + "</p>";
  if (!h) h = '<p class="note">No item matches. Check the spelling, or upload the image instead.</p>';
  return h;
}
let libTimer = null, libSeq = 0;
function searchLib() {
  clearTimeout(libTimer);
  const q = ui.libQ.trim();
  if (q.length < 2) { ui.lib = null; paintLib(); return; }
  libTimer = setTimeout(async () => {
    const seq = ++libSeq;
    try {
      const fast = await api("GET", "/api/items?wiki=0&q=" + encodeURIComponent(q));
      if (seq !== libSeq) return;
      ui.lib = { local: fast.local, wiki: [] }; ui.libBusy = true; paintLib();
      const full = await api("GET", "/api/items?q=" + encodeURIComponent(q));
      if (seq !== libSeq) return;
      ui.lib = full; ui.libBusy = false; paintLib();
    } catch (e) { if (seq === libSeq) { ui.libBusy = false; ui.lib = { local: (ui.lib && ui.lib.local) || [], wiki: [], wikiError: e.message }; paintLib(); } }
  }, 250);
}
function paintLib() { const el = document.getElementById("lib-res"); if (el) el.innerHTML = libResults(); }
function setCell(i, patch) {
  Object.assign(G.cells[i], patch);
  queueOp("cell" + i + Object.keys(patch).join(), { cell: { i, ...patch } }, 0);
  render();
}
function tabFleets() {
  const lockS = !setup() || anyFleet();
  let h = '<div class="split"><div class="stack">';
  if (ui.placing) h += placementPanel();
  for (let t = 0; t < 2; t++) {
    const team = G.teams[t];
    h += '<div class="panel stack" style="--team:' + esc(tcol(t)) + '"><div class="row" style="justify-content:space-between"><h2 style="color:' + esc(tcol(t)) + '">' + esc(tname(t)) + "</h2>" + (G.fleetReady[t] ? '<span class="okc">Fleet placed</span>' : '<span class="muted">No fleet yet</span>') + "</div>" +
      '<dl class="kv"><dt>Captain passcode</dt><dd>' + (team.hasPass ? (ui.showPass === t ? "<code>" + esc(team.pass) + '</code> <button class="btn sm ghost" data-act="hide-pass">Hide</button> <button class="btn sm ghost" data-act="copy" data-v="' + esc(team.pass) + '">Copy</button>' : '<button class="btn sm ghost" data-act="show-pass" data-t="' + t + '">Show</button>') : '<span class="err">Not set</span>') + "</dd></dl>" +
      '<form class="row" data-form="team-pass" data-t="' + t + '"><input id="tp-' + t + '" type="text" placeholder="' + (team.hasPass ? "New passcode" : "Set a passcode for the captain") + '" style="flex:1 1 180px" minlength="4" maxlength="40" required autocomplete="off"><button class="btn" type="submit">' + (team.hasPass ? "Change" : "Set") + "</button></form>" +
      (team.hasPass ? '<p class="muted" style="font-size:13px">Changing the passcode logs the captain out.</p>' : "") +
      (setup() ? '<div class="row"><button class="btn" data-act="admin-place" data-t="' + t + '">' + (G.fleetReady[t] ? "Move ships" : "Place ships for them") + "</button>" +
        (G.fleetReady[t] ? (ui.confirm === "rf" + t ? '<span class="err">Remove this fleet?</span><button class="btn danger" data-act="reset-fleet" data-t="' + t + '">Remove</button><button class="btn ghost" data-act="cancel-confirm">Keep</button>' : '<button class="btn ghost danger" data-act="ask" data-k="rf' + t + '">Remove fleet</button>') : "") + "</div>"
        : '<p class="muted" style="font-size:13px">Fleets are locked while the game runs.</p>') +
      (G.fleets[t] && !(ui.placing && ui.placing.team === t) ? boardHTML(t, "view", { layout: G.fleets[t] }) : "") + "</div>";
  }
  const us = units(), cellsUsed = us.reduce((a, u) => a + u.size, 0);
  const tooBig = G.ships.filter(sh => !R.fits(sh.shape, G.rows, G.cols));
  h += '</div><div class="stack"><div class="panel stack"><h2>Ships</h2><p class="muted" style="font-size:13px">Design each ship\'s shape, then set how many of it every team gets. Ships can be rotated and flipped when placed.</p>' +
    (lockS ? '<p class="muted" style="font-size:13px">' + (setup() ? "Ships are locked while a fleet is placed. Remove both fleets to edit them." : "Ships are locked once the game starts.") + "</p>" : "") +
    '<div class="stack" style="gap:8px">' + G.ships.map((sh, k) => '<div class="ship-row"><span class="shape">' + miniShape(sh.shape, 7) + '</span><input type="text" id="sn-' + esc(sh.id) + '" data-ship="' + k + '" data-k="name" maxlength="30" value="' + esc(sh.name) + '" aria-label="Ship name"' + (lockS ? " disabled" : "") + '><label style="display:flex;align-items:center;gap:4px;font-size:13px" title="How many per team">×<input type="number" min="1" max="10" id="sc-' + esc(sh.id) + '" data-ship="' + k + '" data-k="count" value="' + (sh.count || 1) + '" aria-label="How many per team"' + (lockS ? " disabled" : "") + ' style="padding:6px"></label><button class="btn sm" data-act="edit-ship" data-k="' + k + '"' + (lockS ? " disabled" : "") + '>Shape</button><button class="btn sm ghost danger" data-act="del-ship" data-k="' + k + '"' + (lockS || G.ships.length < 2 ? " disabled" : "") + ' aria-label="Remove ' + esc(sh.name) + '">✕</button></div>').join("") + "</div>" +
    '<div><button class="btn" data-act="add-ship"' + (lockS || G.ships.length >= 12 ? " disabled" : "") + ">New ship</button></div>" +
    '<p class="muted" style="font-size:13px">' + us.length + " ships per team, covering " + cellsUsed + " of " + N() + " squares.</p>" +
    (cellsUsed > N() * 0.6 ? '<p class="err">That\'s a lot of the board. Fleets may be hard or impossible to fit.</p>' : "") +
    (tooBig.length ? '<p class="err">' + esc(tooBig.map(x => x.name).join(", ")) + " won't fit on a " + G.cols + "×" + G.rows + " board.</p>" : "") + "</div>" +
    '<div class="panel stack"><h2>How captains place ships</h2><p style="font-size:14px">Give each captain their passcode and the public link. They choose <b>Captain login</b>, place their fleet and save it. They can move ships until you press <b>Start game</b>.</p></div></div></div>';
  return h;
}
function tabShots() {
  if (setup()) return '<section class="panel"><p class="muted">Shots can be recorded once the game starts. Use <b>Start game</b> above when both fleets are placed.</p></section>';
  const by = ui.attacker, d = 1 - by;
  let h = "";
  if (ui.flash) { const a = G.attacks.find(x => x.id === ui.flash); if (a) h += '<div class="banner' + (a.result === "hit" ? " bad" : "") + '"><span><b>' + esc(shotHeadline(a)) + "</b>" + (G.discord.url && G.discord.shots !== "off" ? ' <span class="muted">Posted to Discord.</span>' : "") + '</span><span class="row"><button class="btn sm primary" data-act="copy-text" data-id="' + a.id + '">Copy for Discord</button><button class="btn sm" data-act="board-img" data-d="' + (1 - a.by) + '">Board image</button><button class="btn sm ghost" data-act="close-flash">Close</button></span></div>'; }
  const finished = G.status === "finished";
  h += '<div class="split"><div class="panel"><div class="board-head"><div><h2>Record a shot</h2><div class="sub">Pick who fired, then the square they hit with their drop.</div></div>' +
    '<div class="seg" role="group" aria-label="Firing team"><button data-act="attacker" data-t="0" aria-pressed="' + (by === 0) + '"><span class="dot" style="--team:' + esc(tcol(0)) + '"></span>' + esc(tname(0)) + '</button><button data-act="attacker" data-t="1" aria-pressed="' + (by === 1) + '"><span class="dot" style="--team:' + esc(tcol(1)) + '"></span>' + esc(tname(1)) + "</button></div></div>" +
    '<p class="sub muted" style="margin-bottom:10px">Firing at <b style="color:' + esc(tcol(d)) + '">' + esc(tname(d)) + "'s waters</b> · <label><input type=\"checkbox\" id=\"show-fleet\" " + (ui.showFleets ? "checked" : "") + "> Show their ships</label></p>" +
    boardHTML(d, "attack", { sel: ui.target, layout: ui.showFleets ? G.fleets[d] : null }) + legend(false) + "</div>";
  const tc = ui.target != null ? G.cells[ui.target] : null;
  h += '<div class="stack"><div class="panel stack"><h3>' + (finished ? "The game is over" : tc ? "Square " + R.coord(G, ui.target) + " · " + esc(tc.name || "Empty square") : "No square selected") + "</h3>" +
    '<label class="f"><span>Player (optional)</span><input id="shot-player" type="text" maxlength="40" value="' + esc(ui.player) + '" placeholder="RSN of whoever got the drop"' + (finished ? " disabled" : "") + "></label>" +
    '<button class="btn primary" data-act="fire"' + (tc && !finished && !busyAction ? "" : " disabled") + '>Fire</button><p class="muted" style="font-size:12px">Hit or miss is worked out from the hidden fleet' + (G.discord.url && G.discord.shots !== "off" ? " and posted to Discord" : "") + ".</p></div>" +
    '<div class="panel"><div class="board-head"><h2>Shot log</h2><span class="sub">' + G.attacks.length + "</span></div>" + (G.attacks.length ? '<div class="log">' + G.attacks.slice().reverse().map(a => shotRow(a, true)).join("") + "</div>" : '<p class="muted">No shots yet.</p>') + "</div></div></div>";
  return h;
}
function tabSettings() {
  const dc = G.discord;
  return '<div class="split"><div class="stack"><div class="panel stack"><h2>Game</h2>' +
    '<label class="f"><span>Game name</span><input id="set-title" type="text" maxlength="80" data-g="title" value="' + esc(G.title) + '"></label>' +
    '<label class="f"><span>How to play (shown on the board)</span><textarea id="set-rules" data-g="rules" rows="5" maxlength="2000">' + esc(G.rules) + "</textarea></label>" +
    '<div class="row">' + [0, 1].map(t => '<label class="f" style="flex:1 1 200px"><span>Team ' + (t + 1) + ' name</span><span class="row" style="flex-wrap:nowrap"><input id="tn-' + t + '" type="text" maxlength="40" data-team="' + t + '" data-k="name" value="' + esc(G.teams[t].name) + '"><input id="tcol-' + t + '" type="color" data-team="' + t + '" data-k="color" value="' + esc(tcol(t)) + '" style="width:44px;height:36px;padding:2px;border:1px solid var(--line);border-radius:6px;background:var(--surface)" aria-label="Team ' + (t + 1) + ' colour"></span></label>').join("") + "</div>" +
    '<div class="linkbox"><span>Public link</span><code>' + esc(publicLink()) + '</code><button class="btn sm" data-act="copy" data-v="' + esc(publicLink()) + '">Copy</button></div></div>' +
    '<div class="panel stack"><h2>Discord updates <span class="muted" style="font:500 13px var(--body)">(optional)</span></h2><p class="muted" style="font-size:13px">Post shots to a channel automatically. In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL, then paste it here.</p>' +
    '<form class="stack" data-form="discord"><label class="f"><span>Webhook URL</span><input id="dc-url" type="url" placeholder="https://discord.com/api/webhooks/…" value="' + esc(dc.url) + '" autocomplete="off"></label>' +
    '<label class="f"><span>Post shots</span><select id="dc-shots"><option value="all"' + (dc.shots === "all" ? " selected" : "") + '>Every shot</option><option value="hits"' + (dc.shots === "hits" ? " selected" : "") + '>Only hits and sunk ships</option><option value="off"' + (dc.shots === "off" ? " selected" : "") + ">Don't post shots</option></select></label>" +
    '<label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="dc-image"' + (dc.image ? " checked" : "") + "> Attach the updated board image</label>" +
    '<label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="dc-start"' + (dc.start ? " checked" : "") + "> Announce when the game starts</label>" +
    '<label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="dc-end"' + (dc.end ? " checked" : "") + "> Announce the winner</label>" +
    '<div class="row"><button class="btn primary" type="submit">Save Discord settings</button><button class="btn" type="button" data-act="discord-test"' + (dc.url ? "" : " disabled") + ">Send test message</button>" + (dc.url ? '<button class="btn ghost danger" type="button" data-act="discord-off">Disconnect</button>' : "") + "</div>" +
    (dc.url ? (dc.lastError ? '<p class="err">' + esc(dc.lastError) + "</p>" : dc.lastOk ? '<p class="okc" style="font-size:13px">Last post went through ' + timeAgo(dc.lastOk) + ".</p>" : '<p class="muted" style="font-size:13px">Connected. Send a test message to check it.</p>') : "") + "</form></div></div>" +
    '<div class="stack"><div class="panel stack"><h2>Change admin password</h2><form class="stack" data-form="chpw"><label class="f"><span>New password</span><input id="npw1" type="password" autocomplete="new-password" minlength="6" required></label><label class="f"><span>Confirm</span><input id="npw2" type="password" autocomplete="new-password" required></label>' + (ui.err.chpw ? '<p class="err">' + esc(ui.err.chpw) + "</p>" : "") + '<p class="muted" style="font-size:13px">Other admins will need the new password.</p><div><button class="btn" type="submit">Change password</button></div></form></div>' +
    '<div class="panel stack"><h2>Board file</h2><p class="muted" style="font-size:13px">Save this board (squares, icons, ships, teams and rules) as a file, or load one into this game. Loading is only possible before fleets are placed.</p><div class="row"><button class="btn" data-act="export">Download board file</button><label class="btn" for="import-file"' + (setup() && !anyFleet() ? "" : ' aria-disabled="true" style="opacity:.45;pointer-events:none"') + '>Load board file</label><input id="import-file" type="file" accept=".json,application/json" hidden></div></div>' +
    '<div class="panel stack"><h2>Reset</h2><div class="stack" style="gap:8px">' +
    confirmBtn("clr-shots", "Clear all shots", "Clear every shot? Fleets stay locked and the game keeps running.", !setup()) +
    confirmBtn("to-setup", "Back to setup", "Clear every shot and unlock fleets so captains can move ships?", !setup()) +
    confirmBtn("clr-all", "Clear shots and fleets", "Clear every shot and both fleets, and go back to setup?", true) + "</div></div>" +
    '<div class="panel stack"><h2>Delete game</h2><p class="muted" style="font-size:13px">This removes the game and its link for good.</p><form class="row" data-form="delete"><input id="del-confirm" type="text" placeholder="Type ' + esc(slug) + ' to confirm" style="flex:1 1 200px" autocomplete="off"><button class="btn danger" type="submit">Delete game</button></form></div></div></div>';
}
function confirmBtn(k, label, q, enabled) {
  if (!enabled) return "";
  return ui.confirm === k ? '<div class="stack" style="gap:6px"><span class="err">' + esc(q) + '</span><div class="row"><button class="btn danger" data-act="' + k + '">Yes</button><button class="btn ghost" data-act="cancel-confirm">Cancel</button></div></div>' : '<div><button class="btn danger" data-act="ask" data-k="' + k + '">' + esc(label) + "</button></div>";
}

/* ---------------- ship designer ---------------- */
function openDesigner(idx) {
  const sh = idx != null ? G.ships[idx] : null; const cells = new Set();
  if (sh) { const t = R.normShape(sh.shape); const h = Math.max(...t.map(q => q[0])) + 1, w = Math.max(...t.map(q => q[1])) + 1; const or = Math.floor((10 - h) / 2), oc = Math.floor((10 - w) / 2); t.forEach(q => cells.add((q[0] + or) + "," + (q[1] + oc))); }
  ui.designer = { idx, name: sh ? sh.name : "", count: sh ? sh.count || 1 : 1, cells };
  renderDesigner(true);
}
function renderDesigner(first) {
  const z = ui.designer; if (!z) return;
  const pts = [...z.cells].map(k => k.split(",").map(Number)); const ok = pts.length > 0 && R.connected(pts);
  let g = '<div class="dz" role="grid" aria-label="Ship shape grid">';
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const k = r + "," + c; g += '<button type="button" data-act="dz-cell" data-k="' + k + '" class="' + (z.cells.has(k) ? "on" : "") + '" aria-pressed="' + z.cells.has(k) + '" aria-label="Row ' + (r + 1) + " column " + (c + 1) + '"></button>'; }
  g += "</div>";
  const status = !pts.length ? '<p class="muted" style="font-size:13px">Click squares to draw the ship. Every square has to touch another one on a side.</p>' : ok ? '<p class="okc" style="font-size:13px">' + pts.length + " square" + (pts.length > 1 ? "s" : "") + ", all connected.</p>" : '<p class="err">' + pts.length + " squares, but they aren't all connected. Squares must touch on a side, not just a corner.</p>";
  const inner = "<h2>" + (z.idx != null ? "Edit ship" : "New ship") + '</h2><div class="row"><label class="f" style="flex:1 1 200px"><span>Ship name</span><input id="dz-name" type="text" maxlength="30" value="' + esc(z.name) + '" placeholder="e.g. Kraken"></label><label class="f" style="width:120px"><span>Per team</span><input id="dz-count" type="number" min="1" max="10" value="' + z.count + '"></label></div>' +
    g + '<div id="dz-status">' + status + '</div><div class="row" style="justify-content:space-between"><button class="btn ghost" data-act="dz-clear">Clear grid</button><span class="row"><button class="btn ghost" data-act="dz-cancel">Cancel</button><button class="btn primary" data-act="dz-ok"' + (ok ? "" : " disabled") + ">" + (z.idx != null ? "Save ship" : "Create ship") + "</button></span></div>";
  const m = document.querySelector("#modal .modal");
  if (first || !m) { openModal(inner, true); const n = document.getElementById("dz-name"); if (n && !z.name) n.focus(); } else m.innerHTML = inner;
}
function confirmDesigner() {
  const z = ui.designer; const pts = [...z.cells].map(k => k.split(",").map(Number));
  if (!pts.length || !R.connected(pts)) return;
  const shape = R.normShape(pts); const name = (z.name || "").trim() || "Ship"; const count = Math.max(1, Math.min(10, +z.count || 1));
  if (z.idx != null) Object.assign(G.ships[z.idx], { name, shape, count });
  else G.ships.push({ id: uid(), name, shape, count });
  ui.designer = null; closeModal();
  queueOp("ships", { ships: clone(G.ships) }, 0);
  render();
  if (!R.fits(shape, G.rows, G.cols)) toast(name + " is bigger than the board. Make the board larger or the ship smaller.", "error");
}

/* ---------------- discord helpers ---------------- */
function shotHeadline(a) {
  let s = tname(a.by) + (a.player ? " (" + a.player + ")" : "") + " fired at " + R.coord(G, a.cell) + ": " + (a.result === "hit" ? "HIT" : "miss");
  if (a.sunk) s += ", sank " + tname(1 - a.by) + "'s " + a.sunk.name;
  return s + ".";
}
const loadImg = src => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; });
async function boardImage(d) {
  const cs = 46, gap = 3, left = 34, top = 88, W = left + G.cols * (cs + gap) + 20, H = top + G.rows * (cs + gap) + 44;
  const cv = document.createElement("canvas"); const sc = 2; cv.width = W * sc; cv.height = H * sc; const g = cv.getContext("2d"); g.scale(sc, sc);
  g.fillStyle = "#10202a"; g.fillRect(0, 0, W, H);
  g.fillStyle = tcol(d); g.fillRect(0, 0, W, 5);
  g.fillStyle = "#e5ab41"; g.font = "600 12px Figtree, system-ui, sans-serif"; g.fillText(G.title.toUpperCase(), left, 28);
  g.fillStyle = "#e8f0f2"; g.font = "700 22px 'Pixelify Sans', monospace"; g.fillText(tname(d) + "'s waters", left, 56);
  g.fillStyle = "#90a5ad"; g.font = "500 12px Figtree, system-ui, sans-serif"; g.fillText(tname(1 - d) + " has sunk " + sunkAt(d).length + "/" + units().length + " ships", left, 74);
  const shots = {}; for (const a of shotsAt(d)) shots[a.cell] = a; const sunk = new Set(); sunkAt(d).forEach(s => s.cells.forEach(i => sunk.add(i)));
  g.textAlign = "center"; g.textBaseline = "middle"; g.font = "500 12px 'Pixelify Sans', monospace"; g.fillStyle = "#90a5ad";
  for (let c = 0; c < G.cols; c++) g.fillText(R.LETTERS[c], left + c * (cs + gap) + cs / 2, top - 10);
  for (let r = 0; r < G.rows; r++) g.fillText(String(r + 1), left - 14, top + r * (cs + gap) + cs / 2);
  g.imageSmoothingEnabled = false;
  const imgs = await Promise.all(G.cells.map(c => (c.icon ? loadImg(iconUrl(c.icon)) : null)));
  for (let i = 0; i < N(); i++) {
    const r = Math.floor(i / G.cols), c = i % G.cols, x = left + c * (cs + gap), y = top + r * (cs + gap), s = shots[i];
    g.fillStyle = sunk.has(i) ? "#6a2a26" : s && s.result === "hit" ? "#40343a" : "#173845"; g.fillRect(x, y, cs, cs);
    g.strokeStyle = sunk.has(i) ? "#ff5a44" : "#24505f"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
    const im = imgs[i];
    if (im) { g.globalAlpha = s && s.result === "miss" ? 0.3 : 1; const k = Math.min((cs - 10) / im.width, (cs - 10) / im.height); const iw = im.width * k, ih = im.height * k; g.drawImage(im, x + (cs - iw) / 2, y + (cs - ih) / 2, iw, ih); g.globalAlpha = 1; }
    if (s && s.result === "miss") { g.strokeStyle = "#d6e8ee"; g.lineWidth = 3; g.beginPath(); g.arc(x + cs / 2, y + cs / 2, cs * 0.24, 0, Math.PI * 2); g.stroke(); }
    if (s && s.result === "hit") { g.strokeStyle = "#ff5a44"; g.lineWidth = 5; g.lineCap = "round"; g.beginPath(); g.moveTo(x + 9, y + 9); g.lineTo(x + cs - 9, y + cs - 9); g.moveTo(x + cs - 9, y + 9); g.lineTo(x + 9, y + cs - 9); g.stroke(); }
  }
  return new Promise(r => cv.toBlob(b => r({ blob: b, url: cv.toDataURL("image/png") }), "image/png"));
}
async function boardImageAction(d) {
  const p = boardImage(d);
  try { if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) { await navigator.clipboard.write([new ClipboardItem({ "image/png": p.then(x => x.blob) })]); toast("Board image copied. Paste it in Discord."); return; } } catch {}
  const res = await p;
  openModal("<h2>" + esc(tname(d)) + '\'s waters</h2><img alt="Board image" src="' + res.url + '"><p class="muted" style="font-size:13px">Right-click or long-press the image to copy or save it.</p><div class="row"><button class="btn" data-act="close-modal">Close</button></div>', true);
}
async function fileToPng(file) {
  const url = URL.createObjectURL(file); const im = await loadImg(url); URL.revokeObjectURL(url);
  if (!im) throw new Error("That file isn't an image this browser can read.");
  const max = 64; const k = Math.min(1, max / Math.max(im.width, im.height));
  const w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d"); g.imageSmoothingEnabled = k < 1; g.drawImage(im, 0, 0, w, h);
  return cv.toDataURL("image/png");
}
async function uploadIcon(file) {
  const i = ui.sel; if (i == null) return;
  const png = await fileToPng(file);
  const j = await gapi("POST", "icons/upload", { png, name: G.cells[i].name || "" });
  setCell(i, { icon: j.id });
  toast("Image added to " + R.coord(G, i) + ".");
}

/* ---------------- render ---------------- */
function render() {
  const ae = document.activeElement; const fid = ae && ae.id;
  const sel = fid && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
  if (route.home) app.innerHTML = viewHome();
  else if (!G) app.innerHTML = '<div class="wrap"><section class="panel stack" style="max-width:520px"><h1>No game here</h1><p class="muted">There\'s no game at this link. It may have been deleted, or the link has a typo.</p><div><a class="btn primary" href="/">Create a game</a></div></section></div>';
  else app.innerHTML = route.admin ? viewAdmin() : viewPublic();
  if (fid) { const el = document.getElementById(fid); if (el && el !== document.activeElement) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch {} } }
  document.title = G ? G.title + (route.admin ? " · Admin" : "") + " · Battleship Bingo" : "Battleship Bingo";
  paintSaving(); tip.hidden = true;
}

/* ---------------- events ---------------- */
let busyAction = false;
async function run(fn) {
  if (busyAction) return;
  busyAction = true;
  try { await fn(); } catch (e) { toast(e.message || String(e), "error"); }
  busyAction = false;
  if (refreshWanted && !pending.size && !inflight) { refreshWanted = false; await refresh(); } else render();
}
const acts = {
  "create-open": () => { ui.creating = { name: "", slug: "", slugOk: null, slugTouched: false }; render(); document.getElementById("cg-name").focus(); },
  "create-cancel": () => { ui.creating = null; render(); },
  "close-modal": () => { closeModal(); ui.designer = null; },
  copy: el => copyText(el.dataset.v),
  "welcome-close": () => { ui.welcome = false; history.replaceState(null, "", location.pathname); render(); },
  tab: el => { ui.tab = el.dataset.tab; ui.placing = null; ui.confirm = null; render(); scrollTo(0, 0); },
  ask: el => { ui.confirm = el.dataset.k; render(); },
  "cancel-confirm": () => { ui.confirm = null; render(); },
  "team-login": () => teamLoginModal(),
  "team-logout": () => { store.del(TEAM_KEY); ui.placing = null; refresh(); },
  "admin-logout": () => { store.del(ADMIN_KEY); location.href = "/g/" + slug; },
  "captain-place": () => { startPlacing(MYTEAM, G.myFleet); render(); },
  "admin-place": el => { const t = +el.dataset.t; startPlacing(t, G.fleets[t]); render(); scrollTo(0, 0); },
  "pick-ship": el => { ui.placing.sel = el.dataset.id; ui.placing.msg = ""; render(); },
  rot: () => { ui.placing.rot = (ui.placing.rot + 1) % 4; ui.placing.msg = ""; render(); },
  flip: () => { ui.placing.flip = !ui.placing.flip; ui.placing.msg = ""; render(); },
  "cancel-place": () => { ui.placing = null; render(); if (refreshWanted) { refreshWanted = false; refresh(); } },
  "clear-place": () => { ui.placing.ships = {}; ui.placing.sel = (units()[0] || {}).id; render(); },
  "finish-place": () => run(finishPlace),
  "pick-icon": el => setCell(ui.sel, { icon: el.dataset.id, name: el.dataset.n }),
  "pick-wiki": el => run(async () => { const j = await gapi("POST", "icons/wiki", { title: el.dataset.n }); setCell(ui.sel, { icon: j.id, name: j.name }); }),
  "clear-cell": () => setCell(ui.sel, { name: "", icon: "", hover: "" }),
  "sel-move": el => { ui.sel = (ui.sel + +el.dataset.d + N()) % N(); render(); },
  resize: () => run(async () => {
    const rows = +document.getElementById("sz-r").value, cols = +document.getElementById("sz-c").value;
    take(await gapi("POST", "ops", { ops: [{ size: { rows, cols } }] })); ui.sel = null;
  }),
  bulk: () => run(async () => {
    const lines = document.getElementById("bulk").value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, N());
    const cells = []; const miss = [];
    for (let k = 0; k < lines.length; k++) {
      ui.err.bulk = "Looking up " + (k + 1) + " of " + lines.length + "…"; render();
      const ln = lines[k], l = ln.toLowerCase();
      let icon = "", name = ln;
      try {
        const j = await api("GET", "/api/items?q=" + encodeURIComponent(ln));
        const loc = j.local.find(x => x.name.toLowerCase() === l) || (!j.wiki.length && j.local[0]);
        const wk = j.wiki.find(x => x.name.toLowerCase() === l) || j.wiki[0];
        if (loc) { icon = loc.id; name = loc.name; }
        else if (wk) { const r = await gapi("POST", "icons/wiki", { title: wk.name }); icon = r.id; name = r.name; }
        else if (j.local[0]) { icon = j.local[0].id; name = j.local[0].name; }
      } catch {}
      if (!icon) miss.push(ln);
      cells[k] = { name, icon, hover: G.cells[k].hover };
    }
    take(await gapi("POST", "ops", { ops: [{ cells }] }));
    ui.err.bulk = "Filled " + lines.length + " squares." + (miss.length ? " No icon found for: " + miss.join(", ") + ". Upload those by hand." : "");
  }),
  "show-pass": el => { ui.showPass = +el.dataset.t; render(); },
  "hide-pass": () => { ui.showPass = null; render(); },
  "reset-fleet": el => run(async () => { take(await gapi("DELETE", "fleet/" + el.dataset.t)); ui.confirm = null; }),
  "add-ship": () => openDesigner(null),
  "edit-ship": el => openDesigner(+el.dataset.k),
  "del-ship": el => { G.ships.splice(+el.dataset.k, 1); queueOp("ships", { ships: clone(G.ships) }, 0); render(); },
  "dz-cell": el => { const z = ui.designer; if (!z) return; const k = el.dataset.k; if (z.cells.has(k)) z.cells.delete(k); else z.cells.add(k); renderDesigner(false); },
  "dz-clear": () => { if (ui.designer) { ui.designer.cells.clear(); renderDesigner(false); } },
  "dz-cancel": () => { ui.designer = null; closeModal(); if (refreshWanted) { refreshWanted = false; refresh(); } },
  "dz-ok": () => confirmDesigner(),
  start: () => run(async () => { take(await gapi("POST", "start")); ui.confirm = null; ui.tab = "shots"; toast("The game has started."); }),
  attacker: el => { ui.attacker = +el.dataset.t; ui.target = null; store.set("bb:attacker", String(ui.attacker)); render(); },
  fire: () => run(async () => {
    const by = ui.attacker, cell = ui.target; if (cell == null) return;
    const j = await gapi("POST", "shots", { by, cell, player: ui.player.trim() });
    take(j); ui.target = null; ui.player = ""; ui.flash = j.shot.id; ui.fresh = j.shot.id;
    render();
    if (j.wantsImage) {
      const img = await boardImage(1 - by);
      await gapi("POST", "shots/" + j.shot.id + "/image", { png: img.url }).catch(() => {});
    }
  }),
  "del-shot": el => run(async () => { take(await gapi("DELETE", "shots/" + el.dataset.id)); ui.confirm = null; }),
  "copy-text": el => { const a = G.attacks.find(x => x.id === el.dataset.id); if (a) copyText(R.shotText(G, a, publicLink()), "Copied. Paste it in Discord."); },
  "board-img": el => boardImageAction(+el.dataset.d),
  "close-flash": () => { ui.flash = null; render(); },
  "discord-test": () => run(async () => { take(await gapi("POST", "discord/test")); toast(G.discord.lastError ? "Discord didn't accept the message." : "Test message sent. Check your channel.", G.discord.lastError ? "error" : ""); }),
  "discord-off": () => run(async () => { take(await gapi("POST", "discord", { url: "" })); toast("Discord disconnected."); }),
  "clr-shots": () => run(async () => { take(await gapi("POST", "reset", { mode: "shots" })); ui.confirm = null; toast("Shots cleared."); }),
  "to-setup": () => run(async () => { take(await gapi("POST", "reset", { mode: "setup" })); ui.confirm = null; toast("Back in setup. Captains can move ships."); }),
  "clr-all": () => run(async () => { take(await gapi("POST", "reset", { mode: "clear-all" })); ui.confirm = null; toast("Shots and fleets cleared."); }),
  export: () => run(async () => {
    const j = await gapi("GET", "export");
    const blob = new Blob([JSON.stringify(j)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = slug + "-board.json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }),
};
document.addEventListener("click", e => {
  const a = e.target.closest("[data-act]");
  if (a && !a.disabled) { if (acts[a.dataset.act]) { e.preventDefault(); acts[a.dataset.act](a, e); } return; }
  const c = e.target.closest(".cell"); if (!c) return;
  const i = +c.dataset.cell, m = c.dataset.mode;
  if (m === "edit") { ui.sel = i; ui.libQ = G.cells[i].name || ""; ui.lib = null; render(); if (ui.libQ) searchLib(); const ed = document.getElementById("lib-q"); if (ed && innerWidth < 860) ed.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  else if (m === "place") { placeAt(i); render(); }
  else if (m === "attack") { if (c.classList.contains("dead") || G.status !== "live") return; ui.target = ui.target === i ? null : i; render(); }
  else if (m === "view") showTip(c);
});
document.addEventListener("mouseover", e => {
  const c = e.target.closest && e.target.closest(".cell");
  if (c) { if (c.dataset.mode === "place") { tip.hidden = true; previewAt(+c.dataset.cell); } else showTip(c); }
  else { tip.hidden = true; if (ui.placing) previewAt(null); }
});
document.addEventListener("focusin", e => { const c = e.target.closest && e.target.closest(".cell"); if (c && c.dataset.mode !== "place") showTip(c); });
document.addEventListener("focusout", () => { tip.hidden = true; });
addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });
document.addEventListener("input", e => {
  const el = e.target;
  if (ui.creating && el.id === "cg-name") { ui.creating.name = el.value; if (!ui.creating.slugTouched) { ui.creating.slug = slugify(el.value); ui.creating.slugOk = null; const s = document.getElementById("cg-slug"); if (s) s.value = ui.creating.slug; document.getElementById("cg-slug-note").innerHTML = slugNote(); checkSlug(); } return; }
  if (ui.creating && el.id === "cg-slug") { ui.creating.slugTouched = true; ui.creating.slug = slugify(el.value); ui.creating.slugOk = null; document.getElementById("cg-slug-note").innerHTML = slugNote(); checkSlug(); return; }
  if (!G) return;
  if (el.dataset.bind && ui.sel != null) { const k = el.dataset.bind; G.cells[ui.sel][k] = el.value; if (k === "name") { const t = document.getElementById("ed-title"); if (t) t.textContent = el.value || "Empty square"; } queueOp("cell" + ui.sel + k, { cell: { i: ui.sel, [k]: el.value } }); return; }
  if (el.id === "lib-q") { ui.libQ = el.value; ui.lib = null; searchLib(); return; }
  if (el.id === "shot-player") { ui.player = el.value; return; }
  if (el.dataset.g) { G[el.dataset.g] = el.value; queueOp(el.dataset.g, { [el.dataset.g]: el.value }); return; }
  if (el.dataset.team != null) { const t = +el.dataset.team, k = el.dataset.k; G.teams[t][k] = el.value; queueOp("team" + t + k, { team: { t, [k]: el.value } }); return; }
  if (el.dataset.ship != null) { const sh = G.ships[+el.dataset.ship]; if (el.dataset.k === "count") sh.count = Math.max(1, Math.min(10, +el.value || 1)); else sh.name = el.value; queueOp("ships", { ships: clone(G.ships) }); return; }
  if (el.id === "dz-name" && ui.designer) { ui.designer.name = el.value; return; }
  if (el.id === "dz-count" && ui.designer) { ui.designer.count = el.value; return; }
});
document.addEventListener("change", async e => {
  const el = e.target;
  if (el.id === "ed-file" && el.files[0]) return run(() => uploadIcon(el.files[0]));
  if (el.id === "import-file" && el.files[0]) return run(async () => {
    const text = await el.files[0].text(); let b;
    try { b = JSON.parse(text); } catch { throw new Error("That file isn't a board file."); }
    take(await gapi("POST", "import", b)); ui.sel = null; toast("Board loaded.");
  });
  if (el.id === "show-fleet") { ui.showFleets = el.checked; render(); return; }
  if (el.dataset.ship != null || el.dataset.team != null || el.dataset.g) render();
});
document.addEventListener("paste", e => {
  if (!route.admin || ui.tab !== "board" || ui.sel == null) return;
  const it = [...((e.clipboardData && e.clipboardData.items) || [])].find(x => x.type.startsWith("image/"));
  if (!it) return;
  e.preventDefault();
  run(() => uploadIcon(it.getAsFile()));
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeModal(); ui.designer = null; tip.hidden = true; }
  if (ui.placing && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    if (e.key === "r" || e.key === "R") { ui.placing.rot = (ui.placing.rot + 1) % 4; render(); }
    else if (e.key === "f" || e.key === "F") { ui.placing.flip = !ui.placing.flip; render(); }
  }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, k = f.dataset.form;
  run(async () => {
    if (k === "create") {
      const c = ui.creating; const pw = document.getElementById("cg-pw").value, pw2 = document.getElementById("cg-pw2").value;
      c.name = document.getElementById("cg-name").value;
      if (pw.length < 6) { ui.err.create = "Use at least 6 characters for the password."; return; }
      if (pw !== pw2) { ui.err.create = "The passwords don't match."; return; }
      try {
        const j = await api("POST", "/api/games", { name: c.name, slug: c.slug, password: pw }, { noAuth: true });
        store.set("bb:admin:" + j.slug, j.token);
        location.href = "/g/" + j.slug + "/admin?new=1";
      } catch (err) { ui.err.create = err.message; }
      return;
    }
    if (k === "admin-login") {
      try { const j = await gapi("POST", "login", { role: "admin", password: document.getElementById("pw").value }, { noAuth: true }); store.set(ADMIN_KEY, j.token); ui.err.login = null; take(await gapi("GET", "")); }
      catch (err) { ui.err.login = err.message; }
      return;
    }
    if (k === "team-login") {
      const t = +document.getElementById("tl-team").value, pass = document.getElementById("tl-pass").value;
      try { const j = await gapi("POST", "login", { role: "captain", team: t, password: pass }, { noAuth: true }); store.set(TEAM_KEY, j.token); closeModal(); take(await gapi("GET", "")); }
      catch (err) { const er = document.getElementById("tl-err"); if (er) { er.textContent = err.message; er.hidden = false; } }
      return;
    }
    if (k === "team-pass") {
      const t = +f.dataset.t; const pass = document.getElementById("tp-" + t).value.trim();
      take(await gapi("POST", "team-pass", { team: t, pass })); ui.showPass = t; toast("Passcode set.");
      return;
    }
    if (k === "chpw") {
      const a = document.getElementById("npw1").value, b = document.getElementById("npw2").value;
      if (a.length < 6) { ui.err.chpw = "Use at least 6 characters."; return; }
      if (a !== b) { ui.err.chpw = "The passwords don't match."; return; }
      const j = await gapi("POST", "admin-password", { password: a }); store.set(ADMIN_KEY, j.token); take(j); ui.err.chpw = null; toast("Admin password changed.");
      return;
    }
    if (k === "discord") {
      take(await gapi("POST", "discord", { url: document.getElementById("dc-url").value.trim(), shots: document.getElementById("dc-shots").value, image: document.getElementById("dc-image").checked, start: document.getElementById("dc-start").checked, end: document.getElementById("dc-end").checked }));
      toast("Discord settings saved.");
      return;
    }
    if (k === "delete") {
      await gapi("DELETE", "", { confirm: document.getElementById("del-confirm").value.trim() });
      store.del(ADMIN_KEY); location.href = "/";
    }
  });
});

/* ---------------- boot ---------------- */
(async function boot() {
  ui.attacker = store.get("bb:attacker") === "1" ? 1 : 0;
  if (route.home) { render(); return; }
  try { take(await gapi("GET", "")); } catch (e) { if (e.status !== 404) toast(e.message, "error"); G = null; }
  render();
  if (G) startEvents();
})();
