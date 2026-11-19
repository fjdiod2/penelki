// Панельки, the arithmetic of the touch interface, kept apart from the scene so it can be tested in Node: what a
// two-finger gesture is, where a selected block's handles go, and which handles to show when they crowd together.
import { V, offsetPoly, pathLen, polyArea } from "./sandbox_blocks.js";
const ang = (d) => Math.atan2(d[1], d[0]);

// ---- two fingers. A gesture is decided once the fingers have moved a little: both fingers going up (or down)
// together, side by side, is a tilt (as in map apps); anything else moves the view (slide, pinch, twist at once).
// a, b: [[x, y], [x, y]] where the two fingers started and where they are now -> "tilt" | "move" | null (not yet)
export function classifyTwo(a, b) {
  const d0 = V.sub(b[0], a[0]), d1 = V.sub(b[1], a[1]), m = Math.max(V.len(d0), V.len(d1));
  if (m < 10) return null;
  const spread0 = V.dist(a[0], a[1]), spread1 = V.dist(b[0], b[1]);
  const vertical = (d) => Math.abs(d[1]) > 2 * Math.abs(d[0]) && Math.abs(d[1]) > 6;
  const sideBySide = Math.abs(a[1][0] - a[0][0]) > Math.abs(a[1][1] - a[0][1]);
  const da = ang(V.sub(b[1], b[0])) - ang(V.sub(a[1], a[0])), turn = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
  if (vertical(d0) && vertical(d1) && Math.sign(d0[1]) === Math.sign(d1[1]) && sideBySide && Math.abs(spread1 - spread0) < 0.15 * spread0 && turn < 0.17) return "tilt";
  return "move";
}

// ---- handles. Each has an anchor in the world (at), a kind, and how it is put on screen (place):
//   "out"    outside the block's outline on screen, on the side its arrow points to (walls)
//   "near"   by its anchor, pushed off it a little (the edges of a choice of panels)
//   "above"  just above its anchor on screen, or beside it if that is taken (floors)
//   "at"     on its anchor (move, step tabs)
// dir: the arrow's direction in the world [x, y, z] (null: no direction). Earlier handles are placed first.

// a block's handles. phase "place" (just built: move it, its walls, floors) or "select" (built: walls, floors, step backs)
//   push   a wall: drag out or in (wall: { mode: "width", n, s } or { mode: "length", n, end }, as the core's push)
//   floors drag up or down          move   drag to move the whole block
//   step   on the roof by an edge: drag inward to step back (mode: "end" k 0/1, "side" k ±1, "corner", "ring"; n: inward)
export function blockHandles(b, lay, phase = "select") {
  const out = [], D = b.D || 12, y = (lay.base + lay.top) / 2, top = lay.top, P = (q, h) => [q[0], h, q[1]], d3 = (d) => [d[0], 0, d[1]];
  if (b.closed) {
    const n = b.pts.length, seg = V.norm(V.sub(b.pts[1 % n], b.pts[0])), lf = V.left(seg);
    const outSign = Math.abs(polyArea(offsetPoly(b.pts, true, 1))) > Math.abs(polyArea(b.pts)) ? 1 : -1;      // the offset sign that grows the ring
    const outN = V.mul(lf, outSign), wallPt = V.add(b.pts[0], V.mul(outN, D / 2)), c = V.mul(b.pts.reduce((a, q) => V.add(a, q), [0, 0]), 1 / n);
    out.push({ kind: "push", place: "out", at: P(wallPt, y), dir: d3(outN), wall: { mode: "width", n: outN, s: outSign } });
    if (phase === "place") out.push({ kind: "move", place: "at", at: P(c, 0) });
    out.push({ kind: "floors", place: "above", at: P(V.sub(wallPt, V.mul(outN, D / 2)), top), dir: null });
    if (phase === "select") out.push({ kind: "step", place: "at", at: P(V.add(wallPt, V.mul(outN, -1.8)), top), dir: d3(V.mul(outN, -1)), mode: "ring", n: V.mul(outN, -1) });
    return out;
  }
  const n = b.pts.length, L = pathLen(b.pts, false), mid = along(b.pts, L / 2), u0 = V.norm(V.sub(b.pts[1], b.pts[0])), u1 = V.norm(V.sub(b.pts[n - 2], b.pts[n - 1]));
  const lf = V.left(mid.u), inset = Math.min(2, D / 4, L / 6);
  out.push({ kind: "push", place: "out", at: P(V.add(mid.p, V.mul(lf, D / 2)), y), dir: d3(lf), wall: { mode: "width", n: lf, s: 1 } });
  out.push({ kind: "push", place: "out", at: P(V.add(mid.p, V.mul(lf, -D / 2)), y), dir: d3(V.mul(lf, -1)), wall: { mode: "width", n: V.mul(lf, -1), s: -1 } });
  out.push({ kind: "push", place: "out", at: P(b.pts[0], y), dir: d3(V.mul(u0, -1)), wall: { mode: "length", n: V.mul(u0, -1), end: 0 } });
  out.push({ kind: "push", place: "out", at: P(b.pts[n - 1], y), dir: d3(V.mul(u1, -1)), wall: { mode: "length", n: V.mul(u1, -1), end: 1 } });
  if (phase === "place") out.push({ kind: "move", place: "at", at: P(mid.p, top) });
  out.push({ kind: "floors", place: "above", at: P(mid.p, top), dir: null });
  if (phase === "select") {
    out.push({ kind: "step", place: "at", at: P(V.add(b.pts[0], V.mul(u0, inset)), top), dir: d3(u0), mode: "end", k: 0, n: u0 });
    out.push({ kind: "step", place: "at", at: P(V.add(b.pts[n - 1], V.mul(u1, inset)), top), dir: d3(u1), mode: "end", k: 1, n: u1 });
    out.push({ kind: "step", place: "at", at: P(V.add(mid.p, V.mul(lf, D / 2 - inset)), top), dir: d3(V.mul(lf, -1)), mode: "side", k: 1, n: V.mul(lf, -1) });
    out.push({ kind: "step", place: "at", at: P(V.add(mid.p, V.mul(lf, -D / 2 + inset)), top), dir: d3(lf), mode: "side", k: -1, n: lf });
    const c0 = V.add(V.add(b.pts[0], V.mul(u0, inset)), V.mul(V.left(u0), D / 2 - inset)), cn = V.norm(V.sub(u0, V.left(u0)));
    out.push({ kind: "step", place: "at", at: P(c0, top), dir: d3(cn), mode: "corner", n: cn });
  }
  return out;
}
// the outline of a block for placing handles: the corners of its walls, at its foot and its top
export function outline(lay) { const q = [...lay.Lp, ...lay.Rp]; return [...q.map((p) => [p[0], lay.base, p[1]]), ...q.map((p) => [p[0], lay.top, p[1]])]; }

// the handles of a choice of panels on a wall. F: the wall's frame, box: { t0, t1, f0, f1 } (metres along, floors),
// H: storey. phase "choose": an arrow on each edge (stretch) and one in the middle (move); "pull": one arrow, out or in
export function selHandles(F, box, H, phase, out = true) {
  const { t0, t1, f0, f1 } = box, y = (f) => F.y0 + f * H, P = (t, h, o = 0.3) => { const q = V.add(V.add(F.o, V.mul(F.ax, t)), V.mul(F.N, o)); return [q[0], h, q[1]]; };
  const tm = (t0 + t1) / 2, ym = y((f0 + f1) / 2), ax = [F.ax[0], 0, F.ax[1]];
  if (phase === "pull") { const N = [F.N[0], 0, F.N[1]]; return [{ kind: "pull", place: "at", at: P(tm, ym, 1.5), dir: out ? N : N.map((v) => -v) }]; }
  return [
    { kind: "edge", place: "near", at: P(t1, ym), dir: ax, edge: "k1" }, { kind: "edge", place: "near", at: P(t0, ym), dir: ax.map((v) => -v), edge: "k0" },
    { kind: "edge", place: "near", at: P(tm, y(f1)), dir: [0, 1, 0], edge: "f1" }, { kind: "edge", place: "near", at: P(tm, y(f0)), dir: [0, -1, 0], edge: "f0" },
    { kind: "move", place: "at", at: P(tm, ym) },
  ];
}
function along(pts, s) {                           // the point at arc length s along a path, and its direction
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = V.dist(pts[i], pts[i + 1]); if (s <= d || i + 2 === pts.length) { const u = V.norm(V.sub(pts[i + 1], pts[i])); return { p: V.add(pts[i], V.mul(u, Math.min(s, d))), u }; }
    s -= d;
  }
  return { p: pts[0], u: [1, 0] };
}

// ---- put the handles on screen. project: [x, y, z] -> [sx, sy] (null behind the camera); hull: world points of the
// block's outline. Each handle is tried at a few spots, in order, and takes the first one at least gap px from the
// handles already placed and inside the free part of the screen (x0..w, y0..h: not under buttons or bars). -> a screen point for each handle, or null where none was free
export function arrange(hs, project, hull, { gap = 44, x0 = -Infinity, y0 = -Infinity, w = Infinity, h = Infinity, pad = 30 } = {}) {
  const hp = hull.map(project).filter(Boolean), c = hp.length ? V.mul(hp.reduce((a, q) => V.add(a, q), [0, 0]), 1 / hp.length) : null;
  const reach = (d) => Math.max(0, ...hp.map((q) => V.dot(V.sub(q, c), d)));
  const rot = (d, a) => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)];
  const placed = [], res = [];
  for (const hd of hs) {
    const a = project(hd.at); if (!a) { res.push(null); continue; }
    let d = null, dl = 0; if (hd.dir) { const b = project(hd.at.map((v, i) => v + hd.dir[i] * 3)); if (b) { const v = V.sub(b, a); dl = V.len(v); if (dl > 1e-6) d = V.norm(v); } }
    let cands;
    if (hd.place === "out" && c) {                // outside the outline, along the arrow (or straight out from the middle, for a wall facing the camera)
      const dd = d && dl > 6 ? d : V.dist(a, c) > 1 ? V.norm(V.sub(a, c)) : [0, 1];
      cands = [0, 0.35, -0.35, 0.7, -0.7].map((t) => { const e = rot(dd, t); return V.add(c, V.mul(e, reach(e) + pad)); });
    } else if (hd.place === "above") cands = [[0, -1], [1, 0], [-1, 0], [0, 1]].map((e) => V.add(a, V.mul(e, gap + 4)));
    else if (hd.place === "near" && d) cands = [V.add(a, V.mul(d, pad * 0.8)), a, V.add(a, V.mul(d, pad * 1.6))];
    else cands = c && V.dist(a, c) > 1 ? [a, V.add(a, V.mul(V.norm(V.sub(c, a)), gap * 0.8)), V.add(a, V.mul(V.norm(V.sub(c, a)), gap * 1.6))] : [a];   // on its anchor, or a little toward the middle
    const m = gap * 0.45, ok = (q) => q[0] > x0 + m && q[1] > y0 + m && q[0] < w - m && q[1] < h - m && placed.every((o) => V.dist(o, q) >= gap);
    const q = cands.find(ok) || null; res.push(q); if (q) placed.push(q);
  }
  return res;
}
// which handle is under a finger at q: the nearest within r pixels -> its index, or -1
export function hitHandle(pts, q, r) {
  let best = -1, bd = r; pts.forEach((p, i) => { if (!p) return; const d = V.dist(p, q); if (d < bd) { bd = d; best = i; } });
  return best;
}
