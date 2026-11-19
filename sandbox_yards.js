// Панельки, yards, as plain functions (no scene) so they can be tested in Node. A yard is stored as the point that was
// tapped ({ id, p, seed }); its shape is worked out again whenever the town changes: the open ground around that point,
// filled like a paint bucket up to the walls, roads and water, no further than REACH metres from a block (so in front
// of a lone block it stops, and an empty field is not a yard), and only where it can be seen from that point (so the
// fill does not run round the end of a block into the space behind it). In it: a driveway along the side of the blocks
// their entrances face, joined to the nearest road; a playground where it is quietest; a kiosk where it meets a road.
// The parked cars and lamps along the driveway, and the paths from the entrances, then come as for any road.
import { V, rng, offsetPoly } from "./sandbox_blocks.js";
import { onRoad, nearestOn, loopOf } from "./sandbox_streets.js";
import { inBlock, PORCH } from "./sandbox_details.js";

export const CELL = 2, REACH = 40, RADIUS = 120, DRIVE_W = 4, DRIVE_OFF = 9;
const segDist = (p, a, b) => { const d = V.sub(b, a), L2 = V.dot(d, d) || 1e-9, t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), d) / L2)); return { d: V.dist(p, V.add(a, V.mul(d, t))), q: V.add(a, V.mul(d, t)), t }; };
function blockDist(p, blocks) {                    // metres from p to the nearest ground block's wall (negative inside)
  let m = Infinity;
  for (const b of blocks) { if (b.parent || b.at) continue; const n = b.pts.length; for (let i = 0; i < (b.closed ? n : n - 1); i++) m = Math.min(m, segDist(p, b.pts[i], b.pts[(i + 1) % n]).d - (b.D || 12) / 2); }
  return m;
}

// ---- the yard's shape: the cells (CELL metres square) reachable from p. ctx: { blocks, roads, free(p) }
// -> { x0, z0, n (cells a side), mask (1 = in the yard), count, at(p) (is p in it?), centre(i, j) } or null when p is
// not open ground near a block
export function yardCells(p, ctx) {
  const { blocks = [], roads = [], free = () => true } = ctx, n = Math.ceil((2 * RADIUS) / CELL), x0 = p[0] - RADIUS, z0 = p[1] - RADIUS;
  const centre = (i, j) => [x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL];
  const open = new Uint8Array(n * n), solid = new Uint8Array(n * n);   // 0 unknown, 1 yes, 2 no
  const isOpen = (i, j) => { const k = j * n + i; if (!open[k]) { const q = centre(i, j), d = blockDist(q, blocks); solid[k] = d <= 0 ? 1 : 2; open[k] = d > 0.5 && d <= REACH && free(q) && !roads.some((o) => onRoad(q, o, roads, 0.5)) ? 1 : 2; } return open[k] === 1; };
  const isSolid = (i, j) => { const k = j * n + i; if (!solid[k]) solid[k] = blockDist(centre(i, j), blocks) <= 0 ? 1 : 2; return solid[k] === 1; };
  const si = Math.floor((p[0] - x0) / CELL), sj = Math.floor((p[1] - z0) / CELL);
  if (!isOpen(si, sj)) return null;
  const seen = (i, j) => {                        // no block between the tapped point and this cell
    const q = centre(i, j), L = V.dist(p, q), steps = Math.ceil(L / (CELL / 2));
    for (let k = 1; k < steps; k++) { const r = V.lerp(p, q, k / steps), a = Math.floor((r[0] - x0) / CELL), b = Math.floor((r[1] - z0) / CELL); if (isSolid(a, b)) return false; }
    return true;
  };
  const mask = new Uint8Array(n * n), stack = [[si, sj]]; mask[sj * n + si] = 1; let count = 0;
  while (stack.length) {
    const [i, j] = stack.pop(); count++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n || mask[b * n + a]) continue; if (isOpen(a, b) && seen(a, b)) { mask[b * n + a] = 1; stack.push([a, b]); } else mask[b * n + a] = 2; }
  }
  for (let k = 0; k < n * n; k++) if (mask[k] === 2) mask[k] = 0;
  const at = (q) => { const i = Math.floor((q[0] - x0) / CELL), j = Math.floor((q[1] - z0) / CELL); return i >= 0 && j >= 0 && i < n && j < n && mask[j * n + i] === 1; };
  return { x0, z0, n, mask, count, at, centre, area: count * CELL * CELL };
}
// metres from each yard cell to the nearest cell outside the yard (a chamfer distance) -> Float32Array
function edgeDist(Y) {
  const { n, mask } = Y, d = new Float32Array(n * n).fill(1e9);
  for (let k = 0; k < n * n; k++) if (!mask[k]) d[k] = 0;
  const pass = (order) => { for (const [i, j] of order()) { const k = j * n + i; if (!mask[k]) continue;
    for (const [di, dj, w] of [[-1, 0, 1], [0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, -1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [1, 1, 1.414]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue; d[k] = Math.min(d[k], d[b * n + a] + w * CELL); } } };
  pass(function* () { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) yield [i, j]; });
  pass(function* () { for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) yield [i, j]; });
  return d;
}

// ---- what is in a yard. ctx: { id, seed, entrances: [{ p, out }], blocks, roads (the town's), free }
// -> { roads: [driveways and their links to roads, { id, pts, w, yard: true }], items: props }
export function yardLayout(Y, ctx) {
  const { id, seed, entrances = [], blocks = [], roads = [], free = () => true } = ctx, R = rng((seed >>> 0) || 1), out = [], items = [];
  const clearLine = (a, b) => { const L = V.dist(a, b); for (let s = 0; s <= L; s += 1) { const q = V.lerp(a, b, s / (L || 1)); if (!free(q) || inBlock(q, blocks, 0.8)) return false; } return true; };
  // driveways: one along each wall whose entrances open into the yard, DRIVE_OFF m out from it (a curved or round
  // block: one that follows its curve)
  const groups = new Map(), curved = new Map(), byId = new Map(blocks.map((b) => [b.id, b]));
  for (const e of entrances) {
    if (!Y.at(V.add(e.p, V.mul(e.out, PORCH + 1.5)))) continue;
    const b = byId.get(e.b);
    if (b && (b.closed || b.pts.length > 2)) { (curved.get(b) || curved.set(b, []).get(b)).push(e); continue; }
    const k = `${Math.round(e.out[0] * 100)},${Math.round(e.out[1] * 100)},${Math.round(V.dot(e.p, e.out))}`;    // the same wall: the same facing and line
    (groups.get(k) || groups.set(k, []).get(k)).push(e);
  }
  let rid = 0;
  const linkUp = (drive) => {                     // joined to the nearest road (the town's, or a driveway already made) from whichever end is nearer (a loop: from anywhere on it)
    const starts = drive.closed ? drive.pts : [drive.pts[0], drive.pts[drive.pts.length - 1]]; let link = null;
    for (const end of starts) for (const r of [...roads, ...out.filter((x) => x !== drive)]) {
      const s = nearestOn(loopOf(r), end); if (s.d > 90 || s.d < 1) continue;
      const dir = V.norm(V.sub(s.q, end)); if (!clearLine(V.add(end, V.mul(dir, 2)), V.sub(s.q, V.mul(dir, r.w / 2 + 0.5)))) continue;
      if (!link || s.d < link.d) link = { d: s.d, a: end, b: s.q };
    }
    if (link) out.push({ id: 1e6 + id * 1000 + rid++, pts: [link.a, link.b], w: DRIVE_W, yard: true });
  };
  for (const [b, es] of curved) {
    const d = curveDrive(b, es, Y, roads); if (!d) continue;
    const drive = { id: 1e6 + id * 1000 + rid++, pts: d.pts, w: DRIVE_W, yard: true, ...(d.closed ? { closed: true } : {}) }; out.push(drive); linkUp(drive);
  }
  for (const es of groups.values()) {
    const o = es[0].out, u = V.left(o), base = V.add(es[0].p, V.mul(o, DRIVE_OFF)), ss = es.map((e) => V.dot(V.sub(e.p, es[0].p), u));
    const s0 = Math.min(...ss) - 7, s1 = Math.max(...ss) + 7, inside = [];
    for (let s = s0; s <= s1; s += 1) { const q = V.add(base, V.mul(u, s)); inside.push(Y.at(q) && !roads.some((r) => onRoad(q, r, roads, 0)) ? s : null); }
    let best = null, run = null;                 // the longest stretch of that line inside the yard
    for (const s of [...inside, null]) { if (s != null) { run = run ? [run[0], s] : [s, s]; } else if (run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; } }
    if (!best || best[1] - best[0] < 10) continue;
    const A = V.add(base, V.mul(u, best[0])), B = V.add(base, V.mul(u, best[1])), drive = { id: 1e6 + id * 1000 + rid++, pts: [A, B], w: DRIVE_W, yard: true };
    out.push(drive); linkUp(drive);
  }
  const allRoads = [...roads, ...out];
  // the quietest spot: farthest from the yard's edge, walls and roads -> a playground there, with benches round it
  const ed = edgeDist(Y); let best = null;
  for (let j = 0; j < Y.n; j++) for (let i = 0; i < Y.n; i++) {
    const k = j * Y.n + i; if (!Y.mask[k]) continue; const q = Y.centre(i, j);
    let s = Math.min(ed[k], blockDist(q, blocks)); for (const r of allRoads) s = Math.min(s, nearestOn(loopOf(r), q).d - r.w / 2);
    if (!best || s > best.s) best = { s, q };
  }
  if (best && best.s >= 7) {
    const C = best.q, rad = Math.min(best.s - 2.5, 7), names = ["play_0", "play_1", "play_2", "play_3", "play_4", "play_5"].sort(() => R() - 0.5).slice(0, 3 + Math.floor(R() * 3)), a0 = R() * 6.283;
    names.forEach((nm, i) => {
      const t = a0 + (i / names.length) * 6.283, r = nm === "play_4" ? 0 : rad * (0.45 + 0.25 * R()), q = V.add(C, [Math.cos(t) * r, Math.sin(t) * r]);
      const back = V.norm(V.sub(q, C)); items.push({ name: nm, p: [q[0], 0, q[1]], a: V.len(back) > 0.5 ? [-back[1], back[0]] : [1, 0], paint: [0, 0, 0], r: R() });
    });
    for (let i = 0, nb = 2 + Math.floor(R() * 2); i < nb; i++) {
      const t = a0 + Math.PI / nb + (i / nb) * 6.283, q = V.add(C, [Math.cos(t) * (rad + 2), Math.sin(t) * (rad + 2)]), back = V.norm(V.sub(q, C));
      if (Y.at(q)) items.push({ name: ["bench_0", "bench_1", "bench_2"][Math.floor(R() * 3)], p: [q[0], 0, q[1]], a: [-back[1], back[0]], paint: [0, 0, 0], r: R() });
    }
  }
  // a kiosk where the yard meets one of the town's roads, its back to the yard
  if (roads.length && R() < 0.8) {
    const cands = [];
    for (let j = 0; j < Y.n; j++) for (let i = 0; i < Y.n; i++) {
      if (!Y.mask[j * Y.n + i]) continue; const q = Y.centre(i, j);
      for (const r of roads) { const s = nearestOn(r.pts, q), e = s.d - r.w / 2, L = r.pts.slice(1).reduce((a, p, k) => a + V.dist(r.pts[k], p), 0); if (e > 2.2 && e < 4.5 && s.s > 0.1 * L && s.s < 0.9 * L && blockDist(q, blocks) > 4) cands.push({ q, back: V.norm(V.sub(q, s.q)) }); }
    }
    if (cands.length) { const c = cands[Math.floor(R() * cands.length)]; items.push({ name: ["kiosk_0", "kiosk_1", "kiosk_2"][Math.floor(R() * 3)], p: [c.q[0], 0, c.q[1]], a: [-c.back[1], c.back[0]], paint: [0, 0, 0], r: R() }); }
  }
  return { roads: out, items };
}

// a driveway following a curved or round block b on its entrances' side, DRIVE_OFF m out: round a ring a loop, all the
// way round, when all of it is in the yard and off the roads; else (and along a curved block) from a little before its
// first entrance to a little past its last, only where it is in the yard and not on a road.
// -> { pts (about every 3 m), closed } or null
function curveDrive(b, es, Y, roads) {
  const D = b.D || 12, path = b.closed ? [...b.pts, b.pts[0]] : b.pts, n0 = nearestOn(path, es[0].p), u = V.norm(V.sub(path[n0.i + 1], path[n0.i]));
  const side = V.dot(es[0].out, V.left(u)) > 0 ? 1 : -1, line = offsetPoly(b.pts, b.closed, side * (D / 2 + DRIVE_OFF)), loop = b.closed ? [...line, line[0]] : line;
  const smp = [];                                 // the line, a point every metre
  for (let i = 0; i + 1 < loop.length; i++) { const a = loop[i], c = loop[i + 1], L = V.dist(a, c), k = Math.max(1, Math.round(L)); for (let j = 0; j < k; j++) smp.push(V.lerp(a, c, j / k)); }
  if (!b.closed) smp.push(loop[loop.length - 1]);
  const N = smp.length, ok = smp.map((q) => Y.at(q) && !roads.some((r) => onRoad(q, r, roads, 0)));
  const thin = (run) => { const pts = run.filter((_, i) => i % 3 === 0); if (pts[pts.length - 1] !== run[run.length - 1]) pts.push(run[run.length - 1]); return pts; };
  if (b.closed && ok.every(Boolean)) return { pts: smp.filter((_, i) => i % 3 === 0), closed: true };
  const near = (p) => { let bi = 0, bd = Infinity; smp.forEach((q, i) => { const d = V.dist(q, p); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const at = es.map((e) => near(V.add(e.p, V.mul(e.out, D / 2 + DRIVE_OFF)))).sort((a, c) => a - c), M = 7;
  let keep;                                        // which samples, in order
  if (!b.closed) { const i0 = Math.max(0, at[0] - M), i1 = Math.min(N - 1, at[at.length - 1] + M); keep = []; for (let i = i0; i <= i1; i++) keep.push(i); }
  else { const start = ok.indexOf(false); keep = []; for (let k = 1; k <= N; k++) keep.push((start + k) % N); }   // round the ring from a blocked spot
  let best = [], run = [];                        // the longest stretch inside the yard and off the roads
  for (const i of [...keep, -1]) { if (i >= 0 && ok[i]) run.push(smp[i]); else { if (run.length > best.length) best = run; run = []; } }
  if (best.length < 10) return null;
  return { pts: thin(best), closed: false };
}
