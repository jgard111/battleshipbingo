// Game rules shared by the server (authoritative) and the browser (previews).
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const LIMITS = { minSize: 3, maxSize: 15, maxShipTypes: 12, maxCount: 10, maxUnits: 30, designer: 10 };

export const coord = (g, i) => LETTERS[i % g.cols] + (Math.floor(i / g.cols) + 1);
export const teamName = (g, t) => (g.teams[t] && g.teams[t].name) || "Team " + (t + 1);

export function normShape(pts) {
  const mr = Math.min(...pts.map(q => q[0])), mc = Math.min(...pts.map(q => q[1]));
  return pts.map(q => [q[0] - mr, q[1] - mc]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
export function transform(shape, rot, flip) {
  let pts = shape.map(q => [q[0], q[1]]);
  if (flip) pts = pts.map(q => [q[0], -q[1]]);
  for (let i = 0; i < rot; i++) pts = pts.map(q => [q[1], -q[0]]);
  return normShape(pts);
}
const shapeKey = pts => normShape(pts).map(q => q.join(",")).join(";");
export function sameShape(a, b) {
  if (a.length !== b.length) return false;
  const kb = shapeKey(b);
  for (let f = 0; f < 2; f++) for (let r = 0; r < 4; r++) if (shapeKey(transform(a, r, !!f)) === kb) return true;
  return false;
}
export function connected(pts) {
  if (!pts.length) return false;
  const set = new Set(pts.map(q => q.join(",")));
  const seen = new Set([pts[0].join(",")]);
  const stack = [pts[0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (r + dr) + "," + (c + dc);
      if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push([r + dr, c + dc]); }
    }
  }
  return seen.size === set.size;
}
export function fits(shape, rows, cols) {
  for (let f = 0; f < 2; f++) for (let r = 0; r < 4; r++) {
    const t = transform(shape, r, !!f);
    const h = Math.max(...t.map(q => q[0])) + 1, w = Math.max(...t.map(q => q[1])) + 1;
    if (h <= rows && w <= cols) return true;
  }
  return false;
}
export function units(g) {
  const out = [];
  for (const sh of g.ships) {
    const n = Math.max(1, sh.count || 1);
    for (let k = 0; k < n; k++) out.push({ id: n > 1 ? sh.id + "-" + (k + 1) : sh.id, tpl: sh.id, name: n > 1 ? sh.name + " " + (k + 1) : sh.name, shape: sh.shape, size: sh.shape.length });
  }
  return out;
}
export function validLayout(g, lay) {
  if (!lay || !Array.isArray(lay.ships)) return "No fleet was sent.";
  const used = new Set();
  const N = g.rows * g.cols;
  for (const u of units(g)) {
    const s = lay.ships.find(x => x && x.id === u.id);
    if (!s || !Array.isArray(s.cells)) return u.name + " isn't placed.";
    if (s.cells.length !== u.size) return u.name + " is the wrong size.";
    for (const i of s.cells) {
      if (!Number.isInteger(i) || i < 0 || i >= N) return u.name + " is off the board.";
      if (used.has(i)) return "Two ships overlap.";
      used.add(i);
    }
    if (!sameShape(u.shape, s.cells.map(i => [Math.floor(i / g.cols), i % g.cols]))) return u.name + " doesn't match its shape.";
  }
  if (lay.ships.length !== units(g).length) return "The fleet has the wrong number of ships.";
  return null;
}
// Recompute hit/miss/sunk for every shot from the hidden fleets.
export function adjudicate(g, attacks, fleets) {
  const hits = [{}, {}];
  const names = Object.fromEntries(units(g).map(u => [u.id, u.name]));
  return attacks.map(a0 => {
    const a = { ...a0 };
    delete a.sunk;
    const d = 1 - a.by;
    const f = fleets[d];
    if (!f) throw new Error(teamName(g, d) + " has no fleet.");
    const ship = f.ships.find(s => s.cells.includes(a.cell));
    if (ship) {
      a.result = "hit";
      const h = hits[d][ship.id] || (hits[d][ship.id] = new Set());
      h.add(a.cell);
      if (h.size === ship.cells.length) a.sunk = { id: ship.id, name: names[ship.id] || "Ship", cells: ship.cells.slice() };
    } else a.result = "miss";
    return a;
  });
}
export const sunkAt = (g, d) => g.attacks.filter(a => a.by === 1 - d && a.sunk).map(a => a.sunk);
export function winner(g) {
  const n = units(g).length;
  if (!n) return null;
  for (let d = 0; d < 2; d++) if (sunkAt(g, d).length >= n) return 1 - d;
  return null;
}
export function shotText(g, a, url) {
  const c = g.cells[a.cell] || {};
  const by = teamName(g, a.by), d = teamName(g, 1 - a.by);
  const who = a.player ? " (" + a.player + ")" : "";
  let s = a.result === "hit"
    ? "💥 **HIT!** " + by + who + " fired at **" + coord(g, a.cell) + "** (" + (c.name || "empty square") + ") and hit " + d + "'s fleet."
    : "🌊 **Miss.** " + by + who + " fired at **" + coord(g, a.cell) + "** (" + (c.name || "empty square") + "). Open water.";
  const idx = g.attacks.findIndex(x => x.id === a.id);
  const upTo = g.attacks.slice(0, idx + 1).filter(x => x.by === a.by && x.sunk).length;
  const total = units(g).length;
  if (a.sunk) s += "\n🚢 **" + by + " sank " + d + "'s " + a.sunk.name + "!**";
  if (a.sunk && upTo >= total) s += "\n🏆 **" + by + " sank every ship and wins!**";
  else s += "\n" + by + " has sunk " + upTo + "/" + total + " ships.";
  if (url) s += "\n" + url;
  return s;
}
