// Панельки, roads: their shapes and what stands along them, as plain functions (no scene) so they can be tested in Node.
// A road is a centre line { id, pts: [a, b, ...], w } (width in metres): a straight piece, or several straight pieces
// one after another (a bend), drawn as one strip with mitred joints and unbroken kerbs; or a loop (closed: true, as
// the driveway round a ring's courtyard), with no ends at all.
// Where roads meet, only one surface is drawn: at a T the side road stops at the edge of the road it joins; where two
// roads meet end to end, one of them covers the corner and the other starts at its edge. The kerbs stop at junctions.
import { V, rng, offsetPoly } from "./sandbox_blocks.js";

export const ROAD_W = { drive: 4, street: 7, wide: 11 };
export const KERB = { w: 0.25, h: 0.14 };

const segDist = (p, a, b) => { const d = V.sub(b, a), L2 = V.dot(d, d) || 1e-9, t = V.dot(V.sub(p, a), d) / L2, tc = Math.max(0, Math.min(1, t)); return { d: V.dist(p, V.add(a, V.mul(d, tc))), t, q: V.add(a, V.mul(d, tc)) }; };
const pathLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += V.dist(pts[i - 1], pts[i]); return L; };
// the nearest point of a centre line to p -> { d, q, i (segment), t (along that segment, unclamped), s (metres along) }
export function nearestOn(pts, p) {
  let best = null, acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const s = segDist(p, pts[i], pts[i + 1]), L = V.dist(pts[i], pts[i + 1]); if (!best || s.d < best.d) best = { ...s, i, s: acc + Math.max(0, Math.min(1, s.t)) * L }; acc += L; }
  return best;
}
export const loopOf = (r) => (r.closed ? [...r.pts, r.pts[0]] : r.pts);   // the centre line, closed up for a loop
const endDir = (r, k) => (k === 0 ? V.norm(V.sub(r.pts[0], r.pts[1])) : V.norm(V.sub(r.pts[r.pts.length - 1], r.pts[r.pts.length - 2])));   // pointing out of the road

// how far each end of road r reaches past its end point (negative: stops short of it): where it ends on another road's
// side (a T), it stops at that road's edge; where it meets another road's end, the one with the lower id reaches over
// the corner by the other's half width and the other stops at its edge -> [at the first point, at the last]
export function endExt(r, roads) {
  if (r.closed) return [0, 0];
  return [0, r.pts.length - 1].map((idx) => {
    const e = r.pts[idx]; let x = 0;
    for (const o of roads) {
      if (o === r) continue; const n = nearestOn(loopOf(o), e); if (n.d > 0.1) continue;
      const atEnd = !o.closed && (V.dist(e, o.pts[0]) < 0.1 || V.dist(e, o.pts[o.pts.length - 1]) < 0.1);
      if (!atEnd) x = Math.min(x, -o.w / 2);                          // a T: stop at its edge
      else x = r.id < o.id ? Math.max(x, o.w / 2) : Math.min(x, -o.w / 2);
    }
    return x;
  });
}
// the centre line with its ends moved by endExt
function extended(r, roads) {
  if (r.closed) return loopOf(r);
  const [ea, eb] = endExt(r, roads), p = r.pts.map((q) => [...q]), n = p.length;
  p[0] = V.add(p[0], V.mul(endDir(r, 0), ea)); p[n - 1] = V.add(p[n - 1], V.mul(endDir(r, 1), eb)); return p;
}
// the road's surface: its two edges (left: V.left of the way the points run), point for point, and metres along it
export function roadStrip(r, roads) {
  const c = extended(r, roads), h = r.w / 2, [ea] = endExt(r, roads), s = [-ea];
  let left, right;
  if (r.closed) { left = offsetPoly(r.pts, true, h); right = offsetPoly(r.pts, true, -h); left.push(left[0]); right.push(right[0]); }   // (mitred at the seam too)
  else { left = offsetPoly(c, false, h); right = offsetPoly(c, false, -h); }
  for (let i = 1; i < c.length; i++) s.push(s[i - 1] + V.dist(c[i - 1], c[i]));
  return { left, right, s, len: r.closed ? 1e6 : pathLen(r.pts) };     // (a loop has no ends for its markings to stop short of)
}
export function roadQuad(r, roads) { const { left, right } = roadStrip(r, roads); return [...left, ...[...right].reverse()]; }   // its outline
// is p on the surface of road o (as drawn, with its ends moved)?
export function onRoad(p, o, roads, margin = 0) { return onLine(p, o, extended(o, roads), margin); }
function onLine(p, o, c, margin) {
  const n = nearestOn(c, p); if (!n || n.d >= o.w / 2 + margin) return false;
  if (o.closed) return true;
  if (n.i === 0 && n.t < 0) return n.t * V.dist(c[0], c[1]) > -margin;                                   // square ends
  if (n.i === c.length - 2 && n.t > 1) return (n.t - 1) * V.dist(c[n.i], c[n.i + 1]) < margin;
  return true;
}
// For many questions about the same roads: each road's surface worked out once, with a box round it to skip it fast.
// -> a list to pass as `prep` (or to onRoads)
export function prepRoads(roads) {
  return roads.map((o) => { const c = extended(o, roads), xs = c.map((q) => q[0]), zs = c.map((q) => q[1]), h = o.w / 2; return { o, c, box: [Math.min(...xs) - h, Math.min(...zs) - h, Math.max(...xs) + h, Math.max(...zs) + h] }; });
}
// is p on any of the prepared roads (but `skip`)?
export function onRoads(p, prep, margin = 0, skip = null) {
  for (const { o, c, box } of prep) { if (o === skip || p[0] < box[0] - margin || p[1] < box[1] - margin || p[0] > box[2] + margin || p[1] > box[3] + margin) continue; if (onLine(p, o, c, margin)) return true; }
  return false;
}
// the kerbs along both sides of r, as runs of points, stopping where another road's surface is
export function kerbs(r, roads, prep = prepRoads(roads)) {
  const c = extended(r, roads), out = [];
  for (const side of [1, -1]) {
    let line = offsetPoly(r.closed ? r.pts : c, !!r.closed, side * (r.w / 2 + KERB.w / 2)); if (r.closed) line = [...line, line[0]];
    let run = null; const first = out.length;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], L = V.dist(a, b), n = Math.max(1, Math.ceil(L / 0.5));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const p = V.lerp(a, b, k / n), free = !onRoads(p, prep, KERB.w / 2, r);
        if (free) { if (!run) run = [p]; else run.push(p); } else if (run) { if (run.length > 1 && pathLen(run) > 0.2) out.push(run); run = null; }
      }
    }
    if (run && run.length > 1 && pathLen(run) > 0.2) out.push(run);
    if (r.closed && out.length - first > 1 && V.dist(out[out.length - 1].at(-1), out[first][0]) < 0.6) out[first] = [...out.pop(), ...out[first].slice(1)];   // a run across the seam is one
  }
  return out;
}

// ---- snapping a road's end: onto another road's end, else onto another road's centre line (a T junction)
// -> { p, why } or null when nothing is within tol
export function snapToRoads(p, roads, tol, except = null) {           // except: a road, or a list of them, to leave out
  const skip = Array.isArray(except) ? except : except ? [except] : [];
  let best = null;
  for (const o of roads) if (!skip.includes(o) && !o.closed) for (const e of [o.pts[0], o.pts[o.pts.length - 1]]) { const d = V.dist(p, e); if (d < tol && (!best || d < best.d)) best = { d, p: e, why: "road end" }; }
  if (best) return best;
  for (const o of roads) if (!skip.includes(o)) { const ln = loopOf(o), n = nearestOn(ln, p), L = pathLen(ln); if (n.d < Math.max(tol, o.w / 2) && (o.closed || (n.s > 0.5 && n.s < L - 0.5)) && (!best || n.d < best.d)) best = { d: n.d, p: n.q, why: "joins the road" }; }
  return best;
}
// the road (index) nearest p within its surface (+ margin), for picking -> index or -1
export function roadAt(p, roads, margin = 0.5) {
  let best = -1, bd = Infinity;
  roads.forEach((o, i) => { const n = nearestOn(loopOf(o), p); if (n.d < o.w / 2 + margin && n.d < bd) { bd = n.d; best = i; } });
  return best;
}

// ---- what stands along a road. ctx: { roads, blocks (with pts, D, closed), attach: { pole name -> attach points },
// free(p) -> false where nothing may stand (water) }. Seeded by the road's id, so a road always gets the same.
// -> { items: [{ name, p: [x, y, z], a: [x, z] (along the prop), paint, r }], wires: [[[x, y, z], ...], ...] }
// Lamps every 26 m on one side, their arms over the road; on roads 50 m and longer (not yard driveways), electricity
// poles every 34 m on the other side with wires between them; cars parked along the edges where blocks are within 30 m.
const CARS = ["car_photo_0", "car_photo_1", "car_photo_2", "car_photo_3"];
function minDistPath(b, p) { let m = Infinity; const n = b.pts.length; for (let i = 0; i < (b.closed ? n : n - 1); i++) m = Math.min(m, segDist(p, b.pts[i], b.pts[(i + 1) % n]).d); return m; }
const nearBlock = (p, blocks, d) => blocks.some((b) => !b.parent && !b.at && minDistPath(b, p) < (b.D || 12) / 2 + d);
export function roadProps(r, ctx) {
  const { roads, blocks = [], attach = {}, free = () => true } = ctx, prep = ctx.prep || prepRoads(roads);
  const R = rng((r.id * 2654435761) >>> 0), P = loopOf(r), L = pathLen(P), items = [], wires = [];
  const side = R() < 0.5 ? 1 : -1;
  const clear = (p, m) => free(p) && !onRoads(p, prep, m, r) && !(ctx.field ? ctx.field.dist(p) < m : blocks.some((b) => !b.parent && !b.at && minDistPath(b, p) < (b.D || 12) / 2 + m));
  const frame = (s) => { let acc = 0; for (let i = 0; i + 1 < P.length; i++) { const l = V.dist(P[i], P[i + 1]); if (s <= acc + l || i + 2 === P.length) { const u = V.norm(V.sub(P[i + 1], P[i])); return { p: V.add(P[i], V.mul(u, Math.min(l, s - acc))), u }; } acc += l; } return { p: P[0], u: [1, 0] }; };
  const at = (s, off) => { const f = frame(s); return { p: V.add(f.p, V.mul(V.left(f.u), off)), u: f.u }; };
  const facing = (back) => [-back[1], back[0]];        // the "along" that turns a prop's back (+y) to `back` on the plan
  const onSelf = (p, off) => nearestOn(P, p).d < Math.abs(off) - 0.3;   // (at a bend: pushed onto the road itself)
  const taken = [];
  const lampName = r.w >= 7 ? "lamp_0" : R() < 0.5 ? "lamp_1" : "lamp_2";
  for (let s = 8 + R() * 6; s < L - 4; s += 26) {
    const off = side * (r.w / 2 + KERB.w + 0.6), { p, u } = at(s, off); if (!clear(p, 0.8) || onSelf(p, off)) continue;
    items.push({ name: lampName, p: [p[0], 0, p[1]], a: facing(V.mul(V.left(u), side)), paint: [0, 0, 0], r: R() }); taken.push(p);
  }
  if (L >= 50 && !r.yard) {                           // (no power line along a yard's driveway)
    const pole = ["pole_0", "pole_1", "pole_2"][Math.floor(R() * 3)], poles = [];
    for (let s = 10 + R() * 8; s < L - 6; s += 34) {
      const off = -side * (r.w / 2 + KERB.w + 1.4), { p, u } = at(s, off); if (!clear(p, 0.8) || onSelf(p, off)) { poles.push(null); continue; }
      items.push({ name: pole, p: [p[0], 0, p[1]], a: u, paint: [0, 0, 0], r: R() }); poles.push({ p, a: u }); taken.push(p);      // along the road: the cross-arms (y) across it
    }
    const pts = attach[pole] || [];                  // attach points: x along the prop (a), y its back, z up
    for (let i = 0; i + 1 < poles.length; i++) {
      if (!poles[i] || !poles[i + 1]) continue;
      for (const q of pts) {
        const w0 = V.add(V.add(poles[i].p, V.mul(poles[i].a, q[0])), V.mul(V.left(poles[i].a), q[1])), w1 = V.add(V.add(poles[i + 1].p, V.mul(poles[i + 1].a, q[0])), V.mul(V.left(poles[i + 1].a), q[1]));
        const span = V.dist(w0, w1), sag = 0.012 * span + 0.15, line = [];
        for (let k = 0; k <= 12; k++) { const t = k / 12, p = V.lerp(w0, w1, t); line.push([p[0], q[2] - sag * 4 * t * (1 - t), p[1]]); }
        wires.push(line);
      }
    }
  }
  for (const sd of [1, -1]) {                         // parked cars, end to end along the edge, where people live
    for (let s = 3 + R() * 3; s < L - 3; s += 5.2 + R() * 2.5) {
      if (R() < 0.45) continue;
      const off = sd * (r.w / 2 - (r.w >= 7 ? 1.1 : 0.9)), { p, u } = at(s, off);
      if (!(ctx.field ? ctx.field.dist(p) < 30 : nearBlock(p, blocks, 30)) || taken.some((t) => V.dist(t, p) < 3.5)) continue;
      if (!clear(p, -1)) continue;                  // (cars stand on this road, but not on a junction with another)
      const name = CARS[Math.floor(R() * CARS.length)], dir = R() < 0.5 ? u : V.mul(u, -1);
      items.push({ name, p: [p[0], 0.03, p[1]], a: dir, paint: [0, 0, 0], r: R() }); taken.push(p);
    }
  }
  return { items, wires };
}
