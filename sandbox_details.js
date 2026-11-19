// Панельки, the small things on and around blocks, as plain functions (no scene) so they can be tested in Node:
// at each entrance a concrete path (on to the nearest road when there is one in front), benches, a bin, sometimes a lamp;
// satellite dishes here and there on the facades; antennas on the roofs. All seeded, so a block keeps the same ones.
import { V, rng } from "./sandbox_blocks.js";
import { onRoads, prepRoads, KERB } from "./sandbox_streets.js";

export const PORCH = 2.6;                          // how far an entrance porch (with its steps) stands out from the wall
export const PATH_W = 1.6;                         // a concrete path's width
const facing = (back) => [-back[1], back[0]];      // a prop's "along" for its back (+y) to face `back` on the plan
const segDist = (p, a, b) => { const d = V.sub(b, a), L2 = V.dot(d, d) || 1e-9, t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), d) / L2)); return V.dist(p, V.add(a, V.mul(d, t))); };
export function inBlock(p, blocks, margin = 0) {   // inside a ground block's footprint (plus margin)?
  return blocks.some((b) => { if (b.parent || b.at) return false; const n = b.pts.length; let m = Infinity; for (let i = 0; i < (b.closed ? n : n - 1); i++) m = Math.min(m, segDist(p, b.pts[i], b.pts[(i + 1) % n])); return m < (b.D || 12) / 2 + margin; });
}
// For many questions about the same blocks: the ground blocks' walls in chunks of 16 segments, each in a box, so the
// distance from a point to the nearest wall skips the far ones. -> { dist(p): metres to the nearest wall (- inside) }
export function blockField(blocks) {
  const chunks = [];
  for (const b of blocks) {
    if (b.parent || b.at) continue; const n = b.pts.length, m = b.closed ? n : n - 1, h = (b.D || 12) / 2;
    for (let i0 = 0; i0 < m; i0 += 16) {
      const segs = []; for (let i = i0; i < Math.min(m, i0 + 16); i++) segs.push([b.pts[i], b.pts[(i + 1) % n]]);
      const xs = segs.flat().map((q) => q[0]), zs = segs.flat().map((q) => q[1]); chunks.push({ segs, h, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] });
    }
  }
  return { dist(p) {
    let best = Infinity;
    for (const c of chunks) {
      const dx = Math.max(c.box[0] - p[0], 0, p[0] - c.box[2]), dz = Math.max(c.box[1] - p[1], 0, p[1] - c.box[3]);
      if (Math.hypot(dx, dz) - c.h >= best) continue;
      for (const [a, q] of c.segs) best = Math.min(best, segDist(p, a, q) - c.h);
    }
    return best;
  } };
}

// ---- entrances. es: [{ p: the door on the plan (the wall line), out: unit vector away from the wall, seed }]
// ctx: { roads, blocks, free(p) }. -> { items: props as in sandbox_streets, paths: [{ a, b, w }] }
// The path runs straight out from the porch: up to the edge of a road if one lies within 40 m in front, else 7 m.
// Benches face the path from one or both sides a few metres out, a bin by one of them, sometimes a small lamp.
export function entranceDetails(es, ctx) {
  const { roads = [], blocks = [], free = () => true } = ctx, items = [], paths = [], F = ctx.field || blockField(blocks), prep = ctx.prep || prepRoads(roads);
  const clear = (p, m) => free(p) && F.dist(p) >= m && !onRoads(p, prep, m);
  for (const e of es) {
    const R = rng(e.seed >>> 0 || 1), out = V.norm(e.out), side = V.left(out), a = V.add(e.p, V.mul(out, PORCH));
    if (!clear(a, 0)) continue;
    let len = 7, toRoad = false;
    for (let t = 0.5; t <= 40; t += 0.5) {         // up to the first road in front (its kerb), or until something is in the way
      const q = V.add(a, V.mul(out, t));
      if (onRoads(q, prep, KERB.w)) { len = t; toRoad = true; break; }
      if (!free(q) || F.dist(q) < 0.3) { len = Math.min(len, t - 0.5); break; }
      if (t > 7 && !roads.length) break;
    }
    if (!toRoad) len = Math.min(len, 7);
    if (len < 1) continue;
    paths.push({ a, b: V.add(a, V.mul(out, len)), w: PATH_W, road: toRoad });
    // benches: a couple of metres out, either side of the path, their backs to it turned away (they face the path)
    const s = Math.min(2.2 + R() * 1.2, Math.max(1, len - 1)), sides = R() < 0.5 ? [1, -1] : [R() < 0.5 ? 1 : -1], bench = ["bench_0", "bench_1", "bench_2"][Math.floor(R() * 3)];
    let binDone = false;
    for (const k of sides) {
      const p = V.add(V.add(a, V.mul(out, s)), V.mul(side, k * (PATH_W / 2 + 0.75)));
      if (!clear(p, 0.6)) continue;
      items.push({ name: bench, p: [p[0], 0, p[1]], a: facing(V.mul(side, k)), paint: [0, 0, 0], r: R() });
      if (!binDone) {                              // a bin at the end of the bench nearer the door
        const q = V.add(V.sub(p, V.mul(out, 1.45)), V.mul(side, k * 0.1));
        if (clear(q, 0.4)) { items.push({ name: ["bin_0", "bin_1", "bin_2"][Math.floor(R() * 3)], p: [q[0], 0, q[1]], a: out, paint: [0, 0, 0], r: R() }); binDone = true; }
      }
    }
    if (R() < 0.35 && len > 4) {                   // now and then a small lamp by the path
      const k = R() < 0.5 ? 1 : -1, p = V.add(V.add(a, V.mul(out, Math.min(len - 0.6, 5.5))), V.mul(side, k * (PATH_W / 2 + 0.5)));
      if (clear(p, 0.5)) items.push({ name: "lamp_2", p: [p[0], 0, p[1]], a: facing(V.mul(side, k)), paint: [0, 0, 0], r: R() });
    }
  }
  return { items, paths };
}

// ---- satellite dishes. ws: the window panels of a block's long walls [{ q: middle of the panel on the wall line,
// n: into the building, u: along the wall, y: its floor, f: which floor }]; about one panel in 25, more higher up,
// beside the window, near the top of the storey. seed: the block's. -> items
export function facadeDishes(ws, seed) {
  const R = rng(((seed >>> 0) ^ 0x5bd1e995) >>> 0 || 1), items = [];
  for (const w of ws) {
    const p = 0.025 + 0.02 * Math.min(1, w.f / 8); if (R() > p) continue;
    const k = R() < 0.5 ? 1 : -1, q = V.add(V.sub(w.q, V.mul(w.n, 0.06)), V.mul(w.u, k * 1.15));
    items.push({ name: ["dish_0", "dish_1", "dish_2"][Math.floor(R() * 3)], p: [q[0], w.y + 2.05, q[1]], a: facing(w.n), paint: [0, 0, 0], r: R() });
  }
  return items;
}

// ---- antennas on a roof: about one for every 22 m of a block (once one over each stairwell), near its edges, kept clear of the roof exits and
// of anything open to the sky. b: the block; top: its roof height; exits: roof exit positions; open(p): a hole there
export function roofAntennas(b, top, exits, seed, open = () => false) {
  const R = rng(((seed >>> 0) ^ 0x27d4eb2f) >>> 0 || 1), items = [], n = b.pts.length;
  const segs = []; let L = 0; for (let i = 0; i < (b.closed ? n : n - 1); i++) { const a = b.pts[i], c = b.pts[(i + 1) % n], l = V.dist(a, c); segs.push([a, c, l]); L += l; }
  const count = Math.max(R() < 0.6 ? 1 : 0, Math.round((L / 22) * (0.6 + R() * 0.8)));
  const at = (s) => { for (const [a, c, l] of segs) { if (s <= l) return [V.lerp(a, c, s / l), V.norm(V.sub(c, a))]; s -= l; } return [b.pts[0], [1, 0]]; };
  const placed = [];
  for (let i = 0; i < count; i++) {
    const [p0, u] = at((L * (i + 0.2 + 0.6 * R())) / count), p = V.add(p0, V.mul(V.left(u), Math.max(0.5, (b.D || 12) / 2 - 2.2) * (R() < 0.5 ? 1 : -1)));   // near an edge: the exits are along the middle
    if (exits.some((e) => V.dist(e, p) < 2.5) || placed.some((q) => V.dist(q, p) < 6) || open(p)) continue;
    const ang = R() * Math.PI * 2; items.push({ name: ["ant_0", "ant_1", "ant_2"][Math.floor(R() * 3)], p: [p[0], top, p[1]], a: [Math.cos(ang), Math.sin(ang)], paint: [0, 0, 0], r: R() }); placed.push(p);
  }
  return items;
}
