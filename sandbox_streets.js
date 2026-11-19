// Панельки, roads: their shapes and what stands along them, as plain functions (no scene) so they can be tested in Node.
// A road is a straight centre line { id, pts: [a, b], w } (width in metres); a longer street is several roads that meet
// end to end. Where roads meet, the surface is joined up and the kerbs stop.
import { V, rng } from "./sandbox_blocks.js";

export const ROAD_W = { drive: 4, street: 7, wide: 11 };
export const KERB = { w: 0.25, h: 0.14 };

const segDist = (p, a, b) => { const d = V.sub(b, a), L2 = V.dot(d, d) || 1e-9, t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), d) / L2)); return { d: V.dist(p, V.add(a, V.mul(d, t))), t, q: V.add(a, V.mul(d, t)) }; };
const dirOf = (r) => V.norm(V.sub(r.pts[1], r.pts[0]));

// how far each end of road r reaches past its point: where it joins another road, by half that road's width (so an
// L or T corner is filled in), else not at all. -> [ext at a, ext at b]
export function endExt(r, roads) {
  return r.pts.map((e) => { let x = 0; for (const o of roads) if (o !== r && segDist(e, o.pts[0], o.pts[1]).d < 0.1) x = Math.max(x, o.w / 2); return x; });
}
// the road's surface as a quad on the plan: [left a, left b, right b, right a] (left: V.left of a -> b)
export function roadQuad(r, roads) {
  const u = dirOf(r), lf = V.left(u), [ea, eb] = endExt(r, roads), a = V.sub(r.pts[0], V.mul(u, ea)), b = V.add(r.pts[1], V.mul(u, eb)), h = r.w / 2;
  return [V.add(a, V.mul(lf, h)), V.add(b, V.mul(lf, h)), V.sub(b, V.mul(lf, h)), V.sub(a, V.mul(lf, h))];
}
// is p on the surface of road o (with its ends reaching into the roads it joins)?
export function onRoad(p, o, roads, margin = 0) {
  const u = dirOf(o), [ea, eb] = endExt(o, roads), a = V.sub(o.pts[0], V.mul(u, ea)), b = V.add(o.pts[1], V.mul(u, eb));
  const L = V.dist(a, b), s = V.dot(V.sub(p, a), u), w = Math.abs(V.dot(V.sub(p, a), V.left(u)));
  return s > -margin && s < L + margin && w < o.w / 2 + margin;
}
// the kerbs along both sides of r, as runs [[x, z], [x, z]], stopping where another road's surface is
export function kerbs(r, roads) {
  const u = dirOf(r), lf = V.left(u), [ea, eb] = endExt(r, roads), a = V.sub(r.pts[0], V.mul(u, ea)), L = V.dist(r.pts[0], r.pts[1]) + ea + eb, out = [];
  const others = roads.filter((o) => o !== r), step = 0.5, n = Math.max(1, Math.ceil(L / step));
  for (const side of [1, -1]) {
    const off = V.mul(lf, side * (r.w / 2 + KERB.w / 2)); let run = null;
    for (let i = 0; i <= n; i++) {
      const p = V.add(V.add(a, V.mul(u, (L * i) / n)), off), free = !others.some((o) => onRoad(p, o, roads, KERB.w / 2));
      if (free) { if (!run) run = [p, p]; else run[1] = p; } else if (run) { if (V.dist(run[0], run[1]) > 0.2) out.push(run); run = null; }
    }
    if (run && V.dist(run[0], run[1]) > 0.2) out.push(run);
  }
  return out;
}

// ---- snapping a road's end: onto another road's end, else onto another road's centre line (a T junction)
// -> { p, why } or null when nothing is within tol
export function snapToRoads(p, roads, tol, except = null) {           // except: a road, or a list of them, to leave out
  let best = null; if (Array.isArray(except)) roads = roads.filter((o) => !except.includes(o)), except = null;
  for (const o of roads) if (o !== except) for (const e of o.pts) { const d = V.dist(p, e); if (d < tol && (!best || d < best.d)) best = { d, p: e, why: "road end" }; }
  if (best) return best;
  for (const o of roads) if (o !== except) { const s = segDist(p, o.pts[0], o.pts[1]); if (s.d < Math.max(tol, o.w / 2) && s.t > 0.01 && s.t < 0.99 && (!best || s.d < best.d)) best = { d: s.d, p: s.q, why: "joins the road" }; }
  return best;
}
// the road (index) nearest p within its surface (+ margin), for picking -> index or -1
export function roadAt(p, roads, margin = 0.5) {
  let best = -1, bd = Infinity;
  roads.forEach((o, i) => { const s = segDist(p, o.pts[0], o.pts[1]); if (s.d < o.w / 2 + margin && s.d < bd) { bd = s.d; best = i; } });
  return best;
}

// ---- what stands along a road. ctx: { roads, blocks (with pts, D, closed), attach: { pole name -> attach points },
// free(p) -> false where nothing may stand (water) }. Seeded by the road's id, so a road always gets the same.
// -> { items: [{ name, p: [x, y, z], a: [x, z] (along the prop), paint, r }], wires: [[[x, y, z], ...], ...] }
// Lamps every 26 m on one side, their arms over the road; on roads 50 m and longer, electricity poles every 34 m on the
// other side with wires between them; cars parked along the edges where there are blocks within 30 m.
const CARS = ["car_photo_0", "car_photo_1", "car_photo_2", "car_photo_3"];
const nearBlock = (p, blocks, d) => blocks.some((b) => !b.parent && !b.at && minDistPath(b, p) < (b.D || 12) / 2 + d);
function minDistPath(b, p) { let m = Infinity; const n = b.pts.length; for (let i = 0; i < (b.closed ? n : n - 1); i++) m = Math.min(m, segDist(p, b.pts[i], b.pts[(i + 1) % n]).d); return m; }
export function roadProps(r, ctx) {
  const { roads, blocks = [], attach = {}, free = () => true } = ctx;
  const R = rng((r.id * 2654435761) >>> 0), u = dirOf(r), lf = V.left(u), L = V.dist(r.pts[0], r.pts[1]), items = [], wires = [];
  const others = roads.filter((o) => o !== r), side = R() < 0.5 ? 1 : -1;
  const clear = (p, m) => free(p) && !others.some((o) => onRoad(p, o, roads, m)) && !blocks.some((b) => !b.parent && !b.at && minDistPath(b, p) < (b.D || 12) / 2 + m);
  const at = (s, off) => V.add(V.add(r.pts[0], V.mul(u, s)), V.mul(lf, off));
  // a prop whose back (+y) faces `back` on the plan: along = the vector whose V.left is `back`
  const facing = (back) => [-back[1], back[0]];
  const taken = [];
  // lamps
  const lampName = r.w >= 7 ? "lamp_0" : R() < 0.5 ? "lamp_1" : "lamp_2", out1 = V.mul(lf, side);
  for (let s = 8 + R() * 6; s < L - 4; s += 26) {
    const p = at(s, side * (r.w / 2 + KERB.w + 0.6)); if (!clear(p, 0.8)) continue;
    items.push({ name: lampName, p: [p[0], 0, p[1]], a: facing(out1), paint: [0, 0, 0], r: R() }); taken.push(p);
  }
  // electricity poles and their wires
  if (L >= 50) {
    const pole = ["pole_0", "pole_1", "pole_2"][Math.floor(R() * 3)], a = u, poles = [];     // along the road: the cross-arms (y) across it
    for (let s = 10 + R() * 8; s < L - 6; s += 34) {
      const p = at(s, -side * (r.w / 2 + KERB.w + 1.4)); if (!clear(p, 0.8)) { poles.push(null); continue; }
      items.push({ name: pole, p: [p[0], 0, p[1]], a, paint: [0, 0, 0], r: R() }); poles.push(p); taken.push(p);
    }
    const pts = attach[pole] || [], Y = V.left(a);        // attach points: x along the prop (a), y its back (Y), z up
    for (let i = 0; i + 1 < poles.length; i++) {
      if (!poles[i] || !poles[i + 1]) continue;
      for (const q of pts) {
        const w0 = V.add(V.add(poles[i], V.mul(a, q[0])), V.mul(Y, q[1])), w1 = V.add(V.add(poles[i + 1], V.mul(a, q[0])), V.mul(Y, q[1])), span = V.dist(w0, w1), sag = 0.012 * span + 0.15, line = [];
        for (let k = 0; k <= 12; k++) { const t = k / 12, p = V.lerp(w0, w1, t); line.push([p[0], q[2] - sag * 4 * t * (1 - t), p[1]]); }
        wires.push(line);
      }
    }
  }
  // parked cars, end to end along the edge, where people live
  for (const sd of [1, -1]) {
    for (let s = 3 + R() * 3; s < L - 3; s += 5.2 + R() * 2.5) {
      if (R() < 0.45) continue;
      const off = sd * (r.w / 2 - (r.w >= 7 ? 1.1 : 0.9)), p = at(s, off);
      if (!nearBlock(p, blocks, 30) || taken.some((t) => V.dist(t, p) < 3.5)) continue;
      if (!clear(p, -1)) continue;                  // (cars stand on this road, but not on a junction with another)
      const name = CARS[Math.floor(R() * CARS.length)], dir = R() < 0.5 ? u : V.mul(u, -1);
      items.push({ name, p: [p[0], 0.03, p[1]], a: dir, paint: [0, 0, 0], r: R() }); taken.push(p);
    }
  }
  return { items, wires };
}
