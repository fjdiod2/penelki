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

// ---- a selected block's handles. lay: its layout (Lp, Rp, base, top). -> [{ kind, at: [x, y, z], dir: [x, z] or null (up), ... }]
//   push   a wall: drag out or in (wall: { mode: "width", n, s } or { mode: "length", n, end }, as the core's push)
//   floors above the roof: drag up or down
//   step   on the roof by an edge: drag inward to step back (mode: "end" k 0/1, "side" k ±1, "corner", "ring"; n: inward)
// Earlier handles matter more (see cull).
export function blockHandles(b, lay) {
  const out = [], D = b.D || 12, y = (lay.base + lay.top) / 2, top = lay.top, P = (q, h) => [q[0], h, q[1]];
  if (b.closed) {
    const n = b.pts.length, i = 0, seg = V.norm(V.sub(b.pts[(i + 1) % n], b.pts[i])), lf = V.left(seg);
    const outSign = Math.abs(polyArea(offsetPoly(b.pts, true, 1))) > Math.abs(polyArea(b.pts)) ? 1 : -1;      // the offset sign that grows the ring
    const outN = V.mul(lf, outSign), wallPt = V.add(b.pts[i], V.mul(outN, D / 2));
    out.push({ kind: "floors", at: P(V.add(wallPt, V.mul(outN, -D / 2)), top + 4), dir: null });
    out.push({ kind: "push", at: P(V.add(wallPt, V.mul(outN, 1.2)), y), dir: outN, wall: { mode: "width", n: outN, s: outSign } });
    out.push({ kind: "step", at: P(V.add(wallPt, V.mul(outN, -1.8)), top), dir: V.mul(outN, -1), mode: "ring", n: V.mul(outN, -1) });
    return out;
  }
  const n = b.pts.length, L = pathLen(b.pts, false), mid = along(b.pts, L / 2), u0 = V.norm(V.sub(b.pts[1], b.pts[0])), u1 = V.norm(V.sub(b.pts[n - 2], b.pts[n - 1]));
  const lf = V.left(mid.u), inset = Math.min(2, D / 4, L / 6);
  out.push({ kind: "floors", at: P(mid.p, top + 4), dir: null });
  out.push({ kind: "push", at: P(V.add(mid.p, V.mul(lf, D / 2 + 1.2)), y), dir: lf, wall: { mode: "width", n: lf, s: 1 } });
  out.push({ kind: "push", at: P(V.add(mid.p, V.mul(lf, -D / 2 - 1.2)), y), dir: V.mul(lf, -1), wall: { mode: "width", n: V.mul(lf, -1), s: -1 } });
  out.push({ kind: "push", at: P(V.add(b.pts[0], V.mul(u0, -1.2)), y), dir: V.mul(u0, -1), wall: { mode: "length", n: V.mul(u0, -1), end: 0 } });
  out.push({ kind: "push", at: P(V.add(b.pts[n - 1], V.mul(u1, -1.2)), y), dir: V.mul(u1, -1), wall: { mode: "length", n: V.mul(u1, -1), end: 1 } });
  out.push({ kind: "step", at: P(V.add(b.pts[0], V.mul(u0, inset)), top), dir: u0, mode: "end", k: 0, n: u0 });
  out.push({ kind: "step", at: P(V.add(b.pts[n - 1], V.mul(u1, inset)), top), dir: u1, mode: "end", k: 1, n: u1 });
  out.push({ kind: "step", at: P(V.add(mid.p, V.mul(lf, D / 2 - inset)), top), dir: V.mul(lf, -1), mode: "side", k: 1, n: V.mul(lf, -1) });
  out.push({ kind: "step", at: P(V.add(mid.p, V.mul(lf, -D / 2 + inset)), top), dir: lf, mode: "side", k: -1, n: lf });
  const c0 = V.add(V.add(b.pts[0], V.mul(u0, inset)), V.mul(V.left(u0), D / 2 - inset)), cn = V.norm(V.sub(u0, V.left(u0)));
  out.push({ kind: "step", at: P(c0, top), dir: cn, mode: "corner", n: cn });
  return out;
}
function along(pts, s) {                           // the point at arc length s along a path, and its direction
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = V.dist(pts[i], pts[i + 1]); if (s <= d || i + 2 === pts.length) { const u = V.norm(V.sub(pts[i + 1], pts[i])); return { p: V.add(pts[i], V.mul(u, Math.min(s, d))), u }; }
    s -= d;
  }
  return { p: pts[0], u: [1, 0] };
}

// ---- handles crowd together when a block is small on screen: keep them in order, dropping any within minPx of one
// already kept, or off the screen. pts: screen points (null: behind the camera) -> the indices to show
export function cull(pts, minPx, w = Infinity, h = Infinity) {
  const keep = [];
  pts.forEach((p, i) => { if (p && p[0] > -minPx && p[1] > -minPx && p[0] < w + minPx && p[1] < h + minPx && keep.every((j) => V.dist(pts[j], p) >= minPx)) keep.push(i); });
  return keep;
}
// which handle is under a finger at q: the nearest within r pixels -> its index, or -1
export function hitHandle(pts, shown, q, r) {
  let best = -1, bd = r; for (const i of shown) { const d = V.dist(pts[i], q); if (d < bd) { bd = d; best = i; } }
  return best;
}
