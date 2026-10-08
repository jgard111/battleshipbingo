// OSRS Battleship Bingo server. Uses only Node's built-in modules (Node 20+).
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as R from "./public/shared.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, "data"));
const GAMES_DIR = path.join(DATA, "games");
const ICONS_DIR = path.join(DATA, "icons");
const WIKI = process.env.WIKI_API || "https://oldschool.runescape.wiki/api.php";
const WIKI_HOSTS = (process.env.WIKI_IMAGE_HOSTS || "oldschool.runescape.wiki").split(",");
const UA = "OSRS-Battleship-Bingo/1.0 (" + (process.env.CONTACT || "self-hosted clan bingo tracker") + ")";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");

fs.mkdirSync(GAMES_DIR, { recursive: true });
fs.mkdirSync(ICONS_DIR, { recursive: true });
if (!process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH && process.env.RAILWAY_ENVIRONMENT)
  console.warn("WARNING: no Railway volume attached. Games will be lost on every redeploy. Attach a volume (see README).");

/* ---------------- secret ---------------- */
const SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA, "secret.key");
  try { return fs.readFileSync(f, "utf8").trim(); } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();

/* ---------------- icon store ---------------- */
const ICON_INDEX_FILE = path.join(DATA, "icons.json");
let iconIndex = {};
try { iconIndex = JSON.parse(fs.readFileSync(ICON_INDEX_FILE, "utf8")); } catch {}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = b => b.length > 8 && b.subarray(0, 8).equals(PNG_SIG);
let iconIndexTimer = null;
function saveIconIndex() {
  clearTimeout(iconIndexTimer);
  iconIndexTimer = setTimeout(() => writeAtomic(ICON_INDEX_FILE, JSON.stringify(iconIndex)), 200);
}
function storeIcon(buf, name, src) {
  if (!isPng(buf)) throw httpError(400, "Images must be PNG.");
  if (buf.length > 300 * 1024) throw httpError(400, "That image is too large (300 KB max).");
  const id = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 20);
  const f = path.join(ICONS_DIR, id + ".png");
  if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
  const prev = iconIndex[id];
  if (!prev || (name && prev.src === "upload" && src !== "upload")) iconIndex[id] = { name: name || (prev && prev.name) || "", src };
  else if (name && !prev.name) prev.name = name;
  saveIconIndex();
  return id;
}
// Seed the bundled icon library once.
(() => {
  const seedFile = path.join(ROOT, "seed", "icons.json");
  if (!fs.existsSync(seedFile)) return;
  const marker = path.join(DATA, ".seeded-icons");
  if (fs.existsSync(marker)) return;
  for (const [name, b64] of JSON.parse(fs.readFileSync(seedFile, "utf8"))) {
    try { storeIcon(Buffer.from(b64, "base64"), name, "seed"); } catch {}
  }
  writeAtomic(ICON_INDEX_FILE, JSON.stringify(iconIndex));
  fs.writeFileSync(marker, new Date().toISOString());
  console.log("Seeded " + Object.keys(iconIndex).length + " item icons.");
})();
const iconByName = () => {
  const m = new Map();
  for (const [id, v] of Object.entries(iconIndex)) if (v.name && v.src !== "upload") m.set(v.name.toLowerCase(), id);
  return m;
};

/* ---------------- games ---------------- */
const games = new Map();
for (const f of fs.readdirSync(GAMES_DIR)) {
  if (!f.endsWith(".json")) continue;
  try { const g = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), "utf8")); games.set(g.slug, g); } catch (e) { console.error("Could not read " + f, e.message); }
}
console.log("Loaded " + games.size + " games from " + DATA);

function writeAtomic(file, text) {
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function saveGame(g) {
  g.version = (g.version || 0) + 1;
  g.updatedAt = Date.now();
  writeAtomic(path.join(GAMES_DIR, g.slug + ".json"), JSON.stringify(g));
  broadcast(g);
}
const line = n => Array.from({ length: n }, (_, k) => [0, k]);
function defaultGame(slug, name) {
  const byName = iconByName();
  const defaults = ["Twisted bow", "Scythe of vitur (uncharged)", "Tumeken's shadow (uncharged)", "Elder maul", "Kodai insignia", "Dragon claws", "Ancestral hat", "Dexterous prayer scroll",
    "Avernic defender hilt", "Ghrazi rapier", "Justiciar faceguard", "Osmumten's fang", "Lightbearer", "Masori mask", "Zaryte vambraces", "Torva full helm (damaged)",
    "Nihil horn", "Ancient hilt", "Armadyl hilt", "Bandos hilt", "Saradomin hilt", "Zamorak hilt", "Armadyl crossbow", "Bandos chestplate",
    "Dragon warhammer", "Abyssal dagger", "Abyssal whip", "Kraken tentacle", "Occult necklace", "Dark claw", "Hydra's claw", "Dragon hunter crossbow",
    "Pegasian crystal", "Primordial crystal", "Eternal crystal", "Tanzanite fang", "Magic fang", "Serpentine visage", "Bludgeon claw", "Jar of souls",
    "Zenyte shard", "Dragon pickaxe", "Dragon axe", "Ring of the gods", "Treasonous ring", "Tyrannical ring", "Voidwaker hilt", "Draconic visage",
    "Crystal weapon seed", "Crystal armour seed", "Enhanced crystal weapon seed", "Imbued heart", "Smouldering stone", "Dragon chainbody", "Uncut onyx", "Black mask",
    "Tome of fire", "Phoenix", "Pet zilyana", "Pet general graardor", "Pet kree'arra", "Olmlet", "Lil' zik", "Youngllef"];
  return {
    v: 2, slug, title: name, createdAt: Date.now(), updatedAt: Date.now(), version: 0,
    status: "setup", startedAt: null, finishedAt: null,
    rows: 8, cols: 8,
    cells: defaults.map(n => ({ name: n, icon: byName.get(n.toLowerCase()) || "", hover: "" })),
    teams: [{ name: "Team Zamorak", color: "#c23b2a", pass: "", ver: 1 }, { name: "Team Saradomin", color: "#2f6fc0", pass: "", ver: 1 }],
    ships: [{ id: "carrier", name: "Carrier", shape: line(5), count: 1 }, { id: "battleship", name: "Battleship", shape: line(4), count: 1 },
      { id: "cruiser", name: "Cruiser", shape: line(3), count: 1 }, { id: "submarine", name: "Submarine", shape: line(3), count: 1 },
      { id: "destroyer", name: "Destroyer", shape: line(2), count: 1 }],
    fleets: [null, null], attacks: [],
    rules: "Each team hides its fleet on its own copy of the board. When a player gets one of these drops in game, post the screenshot in Discord and an admin fires at that square in the other team's waters.\nA red cross is a hit, a ring is a miss. Sink every enemy ship to win.",
    auth: null,
    discord: { url: "", shots: "all", image: true, start: true, end: true, lastError: "", lastOk: 0 },
    publicUrl: "",
  };
}
function viewFor(g, who) {
  const v = { ...g };
  delete v.auth;
  v.teams = g.teams.map(t => ({ name: t.name, color: t.color, hasPass: !!t.pass, ...(who.role === "admin" ? { pass: t.pass } : {}) }));
  v.fleetReady = g.fleets.map(f => !!f);
  delete v.fleets;
  if (who.role === "admin") {
    v.fleets = g.fleets;
    v.discord = { ...g.discord, url: g.discord.url };
  } else {
    delete v.discord;
    if (who.role === "captain") v.myFleet = g.fleets[who.team];
  }
  return v;
}

/* ---------------- auth ---------------- */
function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(pw, salt, 32).toString("hex") };
}
function checkPassword(pw, auth) {
  const h = crypto.scryptSync(String(pw), auth.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(auth.hash, "hex"));
}
const b64u = b => Buffer.from(b).toString("base64url");
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  return body + "." + crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
}
function verify(token) {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const exp = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const DAY = 86400000;
const adminToken = g => sign({ s: g.slug, r: "admin", ver: g.auth.ver, exp: Date.now() + 30 * DAY });
const captainToken = (g, t) => sign({ s: g.slug, r: "captain", t, ver: g.teams[t].ver, exp: Date.now() + 30 * DAY });
function whoIs(req, g) {
  const p = verify((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!p || p.s !== g.slug) return { role: "public" };
  if (p.r === "admin" && g.auth && p.ver === g.auth.ver) return { role: "admin" };
  if (p.r === "captain" && (p.t === 0 || p.t === 1) && g.teams[p.t].pass && p.ver === g.teams[p.t].ver) return { role: "captain", team: p.t };
  return { role: "public" };
}

/* ---------------- rate limits ---------------- */
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n++;
  buckets.set(key, b);
  return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 600000).unref();
const ipOf = req => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";

/* ---------------- live updates (SSE) ---------------- */
const listeners = new Map();
function broadcast(g) {
  const set = listeners.get(g.slug);
  if (!set) return;
  for (const res of set) res.write("data: " + JSON.stringify({ v: g.version, status: g.status }) + "\n\n");
}
setInterval(() => { for (const set of listeners.values()) for (const res of set) res.write(": ping\n\n"); }, 25000).unref();

/* ---------------- wiki ---------------- */
const searchCache = new Map();
async function wikiGet(params) {
  const u = new URL(WIKI);
  for (const [k, v] of Object.entries({ format: "json", formatversion: "2", ...params })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "User-Agent": UA, "Api-User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("wiki " + r.status);
  return r.json();
}
async function wikiFileInfo(titles) {
  if (!titles.length) return new Map();
  const files = titles.map(t => "File:" + t + ".png");
  const j = await wikiGet({ action: "query", titles: files.join("|"), prop: "imageinfo", iiprop: "url|size|mime", redirects: "1" });
  const q = j.query || {};
  const rename = new Map();
  for (const n of q.normalized || []) rename.set(n.from, n.to);
  for (const n of q.redirects || []) rename.set(n.from, n.to);
  const pages = new Map((q.pages || []).map(p => [p.title, p]));
  const out = new Map();
  titles.forEach((t, k) => {
    let f = files[k];
    for (let i = 0; i < 3 && rename.has(f); i++) f = rename.get(f);
    const p = pages.get(f);
    const ii = p && !p.missing && p.imageinfo && p.imageinfo[0];
    if (ii && ii.mime === "image/png" && ii.width <= 64 && ii.height <= 64 && ii.size <= 300 * 1024) out.set(t, ii.url);
  });
  return out;
}
async function wikiSearch(q) {
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.t < DAY) return hit.r;
  const words = q.replace(/[^\p{L}\p{N}'() -]/gu, " ").split(/\s+/).filter(Boolean);
  const j = await wikiGet({ action: "query", list: "prefixsearch|search", pssearch: q, pslimit: "15", psnamespace: "0",
    srsearch: words.map(w => "intitle:" + w).join(" ") || q, srnamespace: "0", srlimit: "25", srprop: "" });
  const titles = [];
  for (const p of [...((j.query || {}).prefixsearch || []), ...((j.query || {}).search || [])]) if (!titles.includes(p.title)) titles.push(p.title);
  const info = await wikiFileInfo(titles.slice(0, 40));
  const r = titles.filter(t => info.has(t)).map(t => ({ name: t, thumb: info.get(t) }));
  searchCache.set(key, { t: Date.now(), r });
  if (searchCache.size > 1000) searchCache.delete(searchCache.keys().next().value);
  return r;
}
async function wikiImport(title) {
  const info = await wikiFileInfo([title]);
  const url = info.get(title);
  if (!url) throw httpError(404, "The wiki has no item icon called " + title + ".");
  const u = new URL(url);
  if (u.protocol !== "https:" || !WIKI_HOSTS.includes(u.hostname)) throw httpError(400, "Unexpected image host.");
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw httpError(502, "The wiki didn't send the image. Try again in a moment.");
  return storeIcon(Buffer.from(await r.arrayBuffer()), title, "wiki");
}

/* ---------------- discord ---------------- */
const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const pendingShotPosts = new Map();
async function discordSend(g, content, png) {
  const url = g.discord && g.discord.url;
  if (!url) return;
  const payload = { content: content.slice(0, 1990), allowed_mentions: { parse: [] } };
  let body, headers = {};
  if (png) {
    body = new FormData();
    body.append("payload_json", JSON.stringify(payload));
    body.append("files[0]", new Blob([png], { type: "image/png" }), "board.png");
  } else { body = JSON.stringify(payload); headers["Content-Type"] = "application/json"; }
  try {
    const r = await fetch(url + "?wait=true", { method: "POST", body, headers, signal: AbortSignal.timeout(10000) });
    const gg = games.get(g.slug);
    if (!gg) return;
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      gg.discord.lastError = "Discord answered " + r.status + (r.status === 404 ? " (the webhook was deleted or the URL is wrong)" : "") + (t ? ": " + t.slice(0, 120) : "");
    } else { gg.discord.lastError = ""; gg.discord.lastOk = Date.now(); }
    saveGame(gg);
  } catch (e) {
    const gg = games.get(g.slug);
    if (gg) { gg.discord.lastError = "Couldn't reach Discord: " + e.message; saveGame(gg); }
  }
}
const gameUrl = g => (PUBLIC_URL || g.publicUrl || "") + "/g/" + g.slug;

/* ---------------- http helpers ---------------- */
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(httpError(413, "That's too much data.")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(httpError(400, "Bad request.")); } });
    req.on("error", reject);
  });
}
const SEC_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https://oldschool.runescape.wiki; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
async function serveStatic(res, file, cache = "no-cache") {
  try {
    const buf = await fsp.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": cache, ...SEC_HEADERS });
    res.end(buf);
  } catch { res.writeHead(404, SEC_HEADERS); res.end("Not found"); }
}

/* ---------------- validation helpers ---------------- */
const str = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, c => (c === "\n" ? c : "")).slice(0, max);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(["api", "admin", "new", "icons", "static", "assets", "g", "www", "help"]);
const uid = () => crypto.randomBytes(5).toString("hex");
function slugify(s) { return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, ""); }
function cleanShape(shape) {
  if (!Array.isArray(shape) || !shape.length || shape.length > R.LIMITS.designer * R.LIMITS.designer) return null;
  const pts = [];
  const seen = new Set();
  for (const p of shape) {
    if (!Array.isArray(p) || !Number.isInteger(p[0]) || !Number.isInteger(p[1]) || p[0] < 0 || p[1] < 0 || p[0] >= 15 || p[1] >= 15) return null;
    const k = p[0] + "," + p[1];
    if (!seen.has(k)) { seen.add(k); pts.push([p[0], p[1]]); }
  }
  return R.connected(pts) ? R.normShape(pts) : null;
}
const iconOk = id => id === "" || (typeof id === "string" && /^[a-f0-9]{20}$/.test(id) && !!iconIndex[id]);
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/* ---------------- game actions ---------------- */
function requireAdmin(who) { if (who.role !== "admin") throw httpError(401, "Log in as admin first."); }
function requireStatus(g, ...ok) {
  if (!ok.includes(g.status)) throw httpError(409, g.status === "setup" ? "The game hasn't started yet." : "The game has started, so that can't change any more.");
}
function applyOps(g, ops) {
  if (!Array.isArray(ops) || ops.length > 200) throw httpError(400, "Bad request.");
  for (const op of ops) {
    if (!op || typeof op !== "object") throw httpError(400, "Bad request.");
    if ("title" in op) g.title = str(op.title, 80).trim() || g.title;
    else if ("rules" in op) g.rules = str(op.rules, 2000);
    else if (op.cell) {
      const i = op.cell.i;
      if (!Number.isInteger(i) || i < 0 || i >= g.cells.length) throw httpError(400, "That square doesn't exist.");
      const c = g.cells[i];
      if ("name" in op.cell) c.name = str(op.cell.name, 80);
      if ("hover" in op.cell) c.hover = str(op.cell.hover, 300);
      if ("icon" in op.cell) { if (!iconOk(op.cell.icon)) throw httpError(400, "Unknown icon."); c.icon = op.cell.icon; }
    } else if (op.cells) {
      if (!Array.isArray(op.cells) || op.cells.length > g.cells.length) throw httpError(400, "Bad request.");
      op.cells.forEach((c, i) => {
        if (!c) return;
        g.cells[i] = { name: str(c.name, 80), hover: str(c.hover != null ? c.hover : g.cells[i].hover, 300), icon: iconOk(c.icon) ? c.icon : "" };
      });
    } else if (op.size) {
      requireStatus(g, "setup");
      if (g.fleets[0] || g.fleets[1]) throw httpError(409, "Remove the placed fleets before changing the board size.");
      const rows = Math.trunc(op.size.rows), cols = Math.trunc(op.size.cols);
      if (!(rows >= R.LIMITS.minSize && rows <= R.LIMITS.maxSize && cols >= R.LIMITS.minSize && cols <= R.LIMITS.maxSize)) throw httpError(400, "Boards can be 3 to 15 squares each way.");
      const cells = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push(y < g.rows && x < g.cols ? g.cells[y * g.cols + x] : { name: "", icon: "", hover: "" });
      g.rows = rows; g.cols = cols; g.cells = cells;
    } else if (op.team) {
      const t = op.team.t;
      if (t !== 0 && t !== 1) throw httpError(400, "Bad team.");
      if ("name" in op.team) g.teams[t].name = str(op.team.name, 40).trim() || "Team " + (t + 1);
      if ("color" in op.team) { if (!COLOR_RE.test(op.team.color)) throw httpError(400, "Bad colour."); g.teams[t].color = op.team.color; }
    } else if (op.ships) {
      requireStatus(g, "setup");
      if (g.fleets[0] || g.fleets[1]) throw httpError(409, "Remove the placed fleets before changing ships.");
      if (!Array.isArray(op.ships) || !op.ships.length || op.ships.length > R.LIMITS.maxShipTypes) throw httpError(400, "Have between 1 and 12 ship types.");
      const ships = op.ships.map(s => {
        const shape = cleanShape(s && s.shape);
        if (!shape) throw httpError(400, "Every ship needs connected squares.");
        const count = Math.trunc(s.count);
        return { id: /^[a-z0-9]{1,24}$/.test(s.id) ? s.id : uid(), name: str(s.name, 30).trim() || "Ship", shape, count: count >= 1 && count <= R.LIMITS.maxCount ? count : 1 };
      });
      if (new Set(ships.map(s => s.id)).size !== ships.length) throw httpError(400, "Duplicate ship.");
      if (R.units({ ships }).length > R.LIMITS.maxUnits) throw httpError(400, "That's more than 30 ships per team.");
      g.ships = ships;
    } else throw httpError(400, "Unknown change.");
  }
}
function recomputeOutcome(g) {
  g.attacks = R.adjudicate(g, g.attacks, g.fleets);
  const w = R.winner(g);
  if (w != null) { if (g.status !== "finished") { g.status = "finished"; g.finishedAt = Date.now(); } g.winner = w; }
  else if (g.status === "finished") { g.status = "live"; g.finishedAt = null; g.winner = null; }
}
function exportBoard(g) {
  return {
    format: "battleship-bingo-board", v: 1, title: g.title, rows: g.rows, cols: g.cols, rules: g.rules,
    teams: g.teams.map(t => ({ name: t.name, color: t.color })),
    ships: g.ships,
    cells: g.cells.map(c => {
      let icon = "";
      if (c.icon) try { icon = "data:image/png;base64," + fs.readFileSync(path.join(ICONS_DIR, c.icon + ".png")).toString("base64"); } catch {}
      return { name: c.name, hover: c.hover, icon };
    }),
  };
}
function importBoard(g, b) {
  if (!b || b.format !== "battleship-bingo-board") throw httpError(400, "That isn't a board file from this tracker.");
  const rows = Math.trunc(b.rows), cols = Math.trunc(b.cols);
  if (!(rows >= 3 && rows <= 15 && cols >= 3 && cols <= 15) || !Array.isArray(b.cells) || b.cells.length !== rows * cols) throw httpError(400, "The board in that file is the wrong size.");
  const cells = b.cells.map(c => {
    let icon = "";
    const m = typeof c.icon === "string" && c.icon.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (m) try { icon = storeIcon(Buffer.from(m[1], "base64"), str(c.name, 80), "upload"); } catch {}
    return { name: str(c.name, 80), hover: str(c.hover, 300), icon };
  });
  const tmp = { ...g, rows, cols, cells };
  if (b.ships) applyOps(tmp, [{ ships: b.ships }]);
  g.rows = rows; g.cols = cols; g.cells = cells; g.ships = tmp.ships;
  if (b.title) g.title = str(b.title, 80).trim() || g.title;
  if (typeof b.rules === "string") g.rules = str(b.rules, 2000);
  if (Array.isArray(b.teams)) b.teams.slice(0, 2).forEach((t, i) => {
    if (t && t.name) g.teams[i].name = str(t.name, 40).trim() || g.teams[i].name;
    if (t && COLOR_RE.test(t.color)) g.teams[i].color = t.color;
  });
}

/* ---------------- routes ---------------- */
async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
  const method = req.method;
  const ip = ipOf(req);

  if (parts[0] === "slug" && method === "GET") {
    const s = slugify(url.searchParams.get("s") || "");
    return send(res, 200, { slug: s, ok: SLUG_RE.test(s) && !RESERVED.has(s) && !games.has(s) });
  }
  if (parts[0] === "games" && method === "POST" && parts.length === 1) {
    if (limited("create:" + ip, 10, 3600000)) throw httpError(429, "Too many new games from your connection. Try again in an hour.");
    const b = await readJson(req);
    const name = str(b.name, 80).trim();
    const slug = slugify(b.slug || name);
    if (!name) throw httpError(400, "Give the game a name.");
    if (!SLUG_RE.test(slug)) throw httpError(400, "The link name needs 3 to 40 letters, numbers or dashes.");
    if (RESERVED.has(slug) || games.has(slug)) throw httpError(409, "That link name is taken. Try another.");
    if (typeof b.password !== "string" || b.password.length < 6) throw httpError(400, "The admin password needs at least 6 characters.");
    const g = defaultGame(slug, name);
    g.auth = { ...hashPassword(b.password), ver: 1 };
    g.publicUrl = PUBLIC_URL || originOf(req);
    games.set(slug, g);
    saveGame(g);
    return send(res, 201, { slug, token: adminToken(g) });
  }
  if (parts[0] === "items" && method === "GET") {
    const q = str(url.searchParams.get("q"), 60).trim();
    if (q.length < 2) return send(res, 200, { local: [], wiki: [] });
    const ql = q.toLowerCase();
    const local = Object.entries(iconIndex).filter(([, v]) => v.name && v.src !== "upload" && v.name.toLowerCase().includes(ql))
      .sort((a, b) => (b[1].name.toLowerCase().startsWith(ql) - a[1].name.toLowerCase().startsWith(ql)) || a[1].name.localeCompare(b[1].name))
      .slice(0, 40).map(([id, v]) => ({ id, name: v.name }));
    let wiki = [], wikiError = "";
    if (url.searchParams.get("wiki") !== "0") {
      if (limited("search:" + ip, 120, 600000)) wikiError = "Searching too fast. Wait a moment.";
      else try {
        const have = new Set(local.map(x => x.name.toLowerCase()));
        wiki = (await wikiSearch(q)).filter(x => !have.has(x.name.toLowerCase()));
      } catch (e) { wikiError = "The OSRS Wiki didn't answer. Showing saved icons only."; console.warn("wiki search:", e.message); }
    }
    return send(res, 200, { local, wiki, wikiError });
  }
  if (parts[0] !== "g" || !parts[1]) throw httpError(404, "Not found.");
  const g = games.get(parts[1]);
  if (!g) throw httpError(404, "There's no game at this link.");
  const who = whoIs(req, g);
  const sub = parts.slice(2).join("/");
  const ok = () => send(res, 200, { game: viewFor(g, who), role: who.role, team: who.team });

  if (sub === "" && method === "GET") return ok();
  if (sub === "events" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    let set = listeners.get(g.slug);
    if (!set) listeners.set(g.slug, set = new Set());
    if (set.size > 500) { res.end(); return; }
    set.add(res);
    req.on("close", () => { set.delete(res); if (!set.size) listeners.delete(g.slug); });
    return;
  }
  if (sub === "login" && method === "POST") {
    const b = await readJson(req);
    if (limited("login:" + ip + ":" + g.slug, 15, 600000)) throw httpError(429, "Too many tries. Wait 10 minutes and try again.");
    if (b.role === "admin") {
      if (!checkPassword(b.password || "", g.auth)) throw httpError(401, "That password isn't right.");
      return send(res, 200, { token: adminToken(g) });
    }
    const t = b.team;
    if ((t === 0 || t === 1) && g.teams[t].pass && typeof b.password === "string" && b.password.length === g.teams[t].pass.length &&
      crypto.timingSafeEqual(Buffer.from(b.password), Buffer.from(g.teams[t].pass))) return send(res, 200, { token: captainToken(g, t) });
    throw httpError(401, "That passcode isn't right for " + R.teamName(g, t === 1 ? 1 : 0) + ".");
  }
  const fleetMatch = sub.match(/^fleet\/([01])$/);
  if (fleetMatch) {
    const t = Number(fleetMatch[1]);
    if (!(who.role === "admin" || (who.role === "captain" && who.team === t))) throw httpError(401, "Log in as this team's captain first.");
    requireStatus(g, "setup");
    if (method === "PUT") {
      const b = await readJson(req);
      const lay = { ships: Array.isArray(b.ships) ? b.ships.map(s => ({ id: String(s && s.id), cells: Array.isArray(s && s.cells) ? s.cells.slice(0, 200) : [] })) : null };
      const err = R.validLayout(g, lay);
      if (err) throw httpError(400, err);
      g.fleets[t] = lay;
    } else if (method === "DELETE") g.fleets[t] = null;
    else throw httpError(405, "Not allowed.");
    saveGame(g);
    return ok();
  }

  requireAdmin(who);
  if (!g.publicUrl && !PUBLIC_URL) g.publicUrl = originOf(req);

  if (sub === "ops" && method === "POST") {
    const b = await readJson(req);
    applyOps(g, b.ops);
    saveGame(g);
    return ok();
  }
  if (sub === "team-pass" && method === "POST") {
    const b = await readJson(req);
    const t = b.team;
    if (t !== 0 && t !== 1) throw httpError(400, "Bad team.");
    const p = str(b.pass, 40).trim();
    if (p.length < 4) throw httpError(400, "Use at least 4 characters.");
    if (g.teams[1 - t].pass === p) throw httpError(400, "Use a different passcode from the other team.");
    g.teams[t].pass = p;
    g.teams[t].ver = (g.teams[t].ver || 1) + 1;
    saveGame(g);
    return ok();
  }
  if (sub === "admin-password" && method === "POST") {
    const b = await readJson(req);
    if (typeof b.password !== "string" || b.password.length < 6) throw httpError(400, "Use at least 6 characters.");
    g.auth = { ...hashPassword(b.password), ver: g.auth.ver + 1 };
    saveGame(g);
    return send(res, 200, { token: adminToken(g), game: viewFor(g, who), role: "admin" });
  }
  if (sub === "start" && method === "POST") {
    requireStatus(g, "setup");
    for (let t = 0; t < 2; t++) {
      if (!g.fleets[t]) throw httpError(409, R.teamName(g, t) + " hasn't placed a fleet yet.");
      const err = R.validLayout(g, g.fleets[t]);
      if (err) throw httpError(409, R.teamName(g, t) + "'s fleet needs fixing: " + err);
    }
    g.status = "live"; g.startedAt = Date.now();
    recomputeOutcome(g);
    saveGame(g);
    if (g.discord.url && g.discord.start) discordSend(g, "⚓ **" + g.title + "** has started! " + R.teamName(g, 0) + " vs " + R.teamName(g, 1) + ".\nFollow the boards: " + gameUrl(g));
    return ok();
  }
  if (sub === "reset" && method === "POST") {
    const b = await readJson(req);
    g.attacks = [];
    g.winner = null; g.finishedAt = null;
    if (b.mode === "setup") { g.status = "setup"; g.startedAt = null; }
    else if (b.mode === "clear-all") { g.status = "setup"; g.startedAt = null; g.fleets = [null, null]; }
    else if (g.status === "finished") g.status = "live";
    saveGame(g);
    return ok();
  }
  if (sub === "shots" && method === "POST") {
    requireStatus(g, "live");
    const b = await readJson(req);
    const by = b.by, cell = b.cell;
    if ((by !== 0 && by !== 1) || !Number.isInteger(cell) || cell < 0 || cell >= g.cells.length) throw httpError(400, "Pick a team and a square.");
    if (g.attacks.some(a => a.by === by && a.cell === cell)) throw httpError(409, "That square was already fired at.");
    const shot = { id: uid(), by, cell, player: str(b.player, 40).trim(), t: Date.now() };
    g.attacks.push(shot);
    recomputeOutcome(g);
    saveGame(g);
    const rec = g.attacks[g.attacks.length - 1];
    const d = g.discord;
    if (d.url && (d.shots === "all" || (d.shots === "hits" && rec.result === "hit"))) {
      let text = R.shotText(g, rec, gameUrl(g));
      if (g.status === "finished" && d.end) text += "\n🏁 Game over!";
      if (d.image) {
        const timer = setTimeout(() => { pendingShotPosts.delete(rec.id); discordSend(g, text); }, 15000);
        pendingShotPosts.set(rec.id, { timer, text });
      } else discordSend(g, text);
    } else if (g.status === "finished" && d.url && d.end) {
      discordSend(g, "🏆 **" + R.teamName(g, rec.by) + " sank every ship and won " + g.title + "!**\n" + gameUrl(g));
    }
    return send(res, 200, { game: viewFor(g, who), role: who.role, shot: rec, wantsImage: pendingShotPosts.has(rec.id) });
  }
  const imgMatch = sub.match(/^shots\/([a-f0-9]{10})\/image$/);
  if (imgMatch && method === "POST") {
    const p = pendingShotPosts.get(imgMatch[1]);
    const b = await readJson(req, 3 * 1024 * 1024);
    if (!p) return send(res, 200, { ok: false });
    clearTimeout(p.timer);
    pendingShotPosts.delete(imgMatch[1]);
    const m = typeof b.png === "string" && b.png.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    const buf = m ? Buffer.from(m[1], "base64") : null;
    discordSend(g, p.text, buf && isPng(buf) ? buf : null);
    return send(res, 200, { ok: true });
  }
  const delShot = sub.match(/^shots\/([a-f0-9]{10})$/);
  if (delShot && method === "DELETE") {
    requireStatus(g, "live", "finished");
    g.attacks = g.attacks.filter(a => a.id !== delShot[1]);
    recomputeOutcome(g);
    saveGame(g);
    return ok();
  }
  if (sub === "discord" && method === "POST") {
    const b = await readJson(req);
    const d = g.discord;
    if ("url" in b) {
      const u = str(b.url, 300).trim();
      if (u && !WEBHOOK_RE.test(u)) throw httpError(400, "That doesn't look like a Discord webhook URL. It should start with https://discord.com/api/webhooks/");
      d.url = u; d.lastError = "";
    }
    if ("shots" in b) d.shots = ["all", "hits", "off"].includes(b.shots) ? b.shots : "all";
    for (const k of ["image", "start", "end"]) if (k in b) d[k] = !!b[k];
    saveGame(g);
    return ok();
  }
  if (sub === "discord/test" && method === "POST") {
    if (!g.discord.url) throw httpError(400, "Add a webhook URL first.");
    if (limited("dtest:" + g.slug, 5, 60000)) throw httpError(429, "Wait a minute before testing again.");
    await discordSend(g, "✅ **" + g.title + "** is connected to this channel. Shots will be posted here.\n" + gameUrl(g));
    return ok();
  }
  if (sub === "icons/wiki" && method === "POST") {
    if (limited("import:" + ip, 120, 600000)) throw httpError(429, "Too many icon imports. Wait a few minutes.");
    const b = await readJson(req);
    const title = str(b.title, 120).trim();
    if (!title) throw httpError(400, "Pick an item.");
    const id = await wikiImport(title);
    return send(res, 200, { id, name: iconIndex[id].name || title });
  }
  if (sub === "icons/upload" && method === "POST") {
    if (limited("upload:" + ip, 60, 600000)) throw httpError(429, "Too many uploads. Wait a few minutes.");
    const b = await readJson(req, 600 * 1024);
    const m = typeof b.png === "string" && b.png.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw httpError(400, "Images must be PNG.");
    const id = storeIcon(Buffer.from(m[1], "base64"), str(b.name, 80), "upload");
    return send(res, 200, { id });
  }
  if (sub === "export" && method === "GET") return send(res, 200, exportBoard(g));
  if (sub === "import" && method === "POST") {
    requireStatus(g, "setup");
    if (g.fleets[0] || g.fleets[1]) throw httpError(409, "Remove the placed fleets before importing a board.");
    importBoard(g, await readJson(req, 5 * 1024 * 1024));
    saveGame(g);
    return ok();
  }
  if (sub === "" && method === "DELETE") {
    const b = await readJson(req);
    if (b.confirm !== g.slug) throw httpError(400, "Type the link name to confirm.");
    games.delete(g.slug);
    fs.rmSync(path.join(GAMES_DIR, g.slug + ".json"), { force: true });
    const set = listeners.get(g.slug);
    if (set) for (const r of set) r.end();
    listeners.delete(g.slug);
    return send(res, 200, { ok: true });
  }
  throw httpError(404, "Not found.");
}
function originOf(req) {
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return /^[a-z0-9.:-]+$/i.test(host) ? proto + "://" + host : "";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "Not allowed.");
    const icon = url.pathname.match(/^\/icons\/([a-f0-9]{20})\.png$/);
    if (icon) return serveStatic(res, path.join(ICONS_DIR, icon[1] + ".png"), "public, max-age=31536000, immutable");
    if (url.pathname === "/healthz") return send(res, 200, { ok: true, games: games.size });
    const pub = path.join(ROOT, "public");
    const file = path.normalize(path.join(pub, url.pathname));
    if (file.startsWith(pub + path.sep) && /\.(js|css|png|svg|ico)$/.test(file) && fs.existsSync(file)) return serveStatic(res, file);
    return serveStatic(res, path.join(pub, "index.html"));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Something went wrong on the server." : e.message });
    else res.end();
  }
});
server.listen(PORT, () => console.log("Battleship Bingo listening on port " + PORT));
