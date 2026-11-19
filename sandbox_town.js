// Панельки, the town's rules without any scene or input: how blocks stand on one another, the shapes of a step back,
// the walls of a block as grids of panels, and the boxes that extruding and digging make. Plain functions on plain
// data, so they run anywhere (the fast tests run them in Node). The core makes one town and shares its state with it.
import { V, offsetPoly, polyArea, pathLen, subPath, cutRects } from "./sandbox_blocks.js";

export const MIN_D = 6;
// the shapes of curved and round blocks: the circle arc from a to c through m (straight if m is near the chord), and a
// ring of radius r round c, as centre lines with a point about every 1.2 m
export function arc(a, c, m) {                           // the circle arc from a to c through m (straight if m is near the chord)
  const ax = a[0], az = a[1], bx = m[0], bz = m[1], cx = c[0], cz = c[1], d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  const chord = V.dist(a, c), sag = Math.abs(V.dot(V.sub(m, a), V.left(V.norm(V.sub(c, a)))));
  if (Math.abs(d) < 1e-6 || sag < 1.5) return [a, c];
  const ux = ((ax * ax + az * az) * (bz - cz) + (bx * bx + bz * bz) * (cz - az) + (cx * cx + cz * cz) * (az - bz)) / d;
  const uz = ((ax * ax + az * az) * (cx - bx) + (bx * bx + bz * bz) * (ax - cx) + (cx * cx + cz * cz) * (bx - ax)) / d;
  const R = Math.hypot(ax - ux, az - uz), A0 = Math.atan2(az - uz, ax - ux), A1 = Math.atan2(cz - uz, cx - ux), Am = Math.atan2(bz - uz, bx - ux);
  const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(A1 - A0); if (norm(Am - A0) > sweep) sweep -= 2 * Math.PI;      // go the way that passes through m
  const n = Math.max(6, Math.ceil((Math.abs(sweep) * R) / 1.2)), out = [];
  for (let i = 0; i <= n; i++) { const t = A0 + (sweep * i) / n; out.push([ux + R * Math.cos(t), uz + R * Math.sin(t)]); }
  return chord > 1 ? out : [a, c];
}
export function ring(c, r) { const n = Math.max(48, Math.round((2 * Math.PI * r) / 1.2)), out = []; for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); } return out; }
                            // the narrowest a block may be (m)
export const sameWall = (a, b) => a.long === b.long && a.end === b.end;
const frame = (b) => { const u = V.norm(V.sub(b.pts[1], b.pts[0])); return { u, lf: V.left(u), L: V.dist(b.pts[0], b.pts[1]), D: b.D || 12 }; };
const local = (b, p) => { const { u, lf } = frame(b), d = V.sub(p, b.pts[0]); return [V.dot(d, u), V.dot(d, lf)]; };   // s along, w across (+ to the left)

// dims: { W, H, PL, E4 } (panel module, storey, plinth, end-wall panel); state(): the town { blocks, trees, nextId }
export function createTown(dims, state) {
  const { W, H, PL, E4 } = dims;
  const byId = new Map(), topMemo = new Map();
  function reindex() { byId.clear(); topMemo.clear(); for (const b of state().blocks) byId.set(b.id, b); }

  // A block stands on the ground, on another block's roof (parent), or out of another block's wall (at: { id, f }: an
  // extrusion, its floor level with that block's floor f)
  const isGround = (b) => !b.parent && !b.at;
  function baseOf(b) {
    if (b.at) { const P = byId.get(b.at.id); return P ? baseOf(P) + (isGround(P) ? PL : 0) + b.at.f * H : 0; }
    return b.parent && byId.has(b.parent) ? topOf(byId.get(b.parent)) : 0;
  }
  function topOf(b) { if (!topMemo.has(b.id)) topMemo.set(b.id, baseOf(b) + (isGround(b) ? PL : 0) + b.fl * H); return topMemo.get(b.id); }
  const floorY = (b, f) => baseOf(b) + (isGround(b) ? PL : 0) + f * H;             // the floor of storey f
  // a block and everything standing on it or built out of it, all the way up
  function subtree(id) {
    const out = new Set([id]); let grew = true;
    while (grew) { grew = false; for (const b of state().blocks) if (((b.parent && out.has(b.parent)) || (b.at && out.has(b.at.id))) && !out.has(b.id)) { out.add(b.id); grew = true; } }
    return out;
  }
  // knock down a block, with what stands on it and the trees on all of them
  function demolish(id) { const S = state(), gone = subtree(id); S.blocks = S.blocks.filter((x) => !gone.has(x.id)); S.trees = S.trees.filter((t) => !t.b || !gone.has(t.b)); return gone; }

  // ---- holes: the hole whose floor is at floor f of block b, under p -> { s0, s1, w0, w1, f0, f1 } in the block's frame
  function holeAt(b, p, f) {
    const [s, w] = local(b, p);
    const rs = cutRects(b).filter((r) => s > r.s0 - 0.05 && s < r.s1 + 0.05 && w > r.w0 - 0.05 && w < r.w1 + 0.05 && f >= r.f0 && f < r.f1);
    return rs.find((r) => r.f0 === f) || rs[0] || null;
  }
  // is p within `near` metres of an edge of that hole's floor? -> the edge ("s0" "s1" "w0" "w1")
  function holeEdgeAt(b, p, r, near) {
    const [s, w] = local(b, p);
    const c = [["s0", s - r.s0], ["s1", r.s1 - s], ["w0", w - r.w0], ["w1", r.w1 - w]].filter((x) => x[1] < near).sort((a, b2) => a[1] - b2[1]);
    return c.length ? c[0][0] : null;
  }

  // ---- a step back: the same block again on its own roof, smaller. What was grabbed decides how: an end edge trims
  // that end, a long edge moves that wall in, a corner steps in all round (a pyramid's step); a ring shrinks all round.
  // k: which end (0 / 1) or which wall (+1 the left one, -1 the right one). inset < 0 steps out instead. -> { pts, inset, D }
  const inSign = (b) => (Math.abs(polyArea(offsetPoly(b.pts, true, 1))) < Math.abs(polyArea(b.pts)) ? 1 : -1);   // which offset sign moves a closed path inward
  function terracePts(b, inset, mode = "end", k = 0) {
    const D = b.D || 12;
    if (b.closed) {
      // stepping in too far turns the ring (or its inner wall) inside out: its edges then run backwards
    const s = inSign(b), A0 = polyArea(b.pts), same = (P, Q) => P.every((p, i) => { const n = P.length, a = V.sub(P[(i + 1) % n], p), c = V.sub(Q[(i + 1) % n], Q[i]); return V.dot(a, c) > 0; });
    const ok = (q) => { const c = offsetPoly(b.pts, true, q * s), inner = offsetPoly(c, true, (D / 2 + 2) * s); return same(c, b.pts) && same(inner, b.pts) && Math.abs(polyArea(inner)) > 30 && Math.sign(polyArea(inner)) === Math.sign(A0); };
    while (inset > 0 && !ok(inset)) inset -= 0.5;
      return { pts: offsetPoly(b.pts, true, inset * s), inset, D };
    }
    if (mode === "side") { inset = Math.min(inset, D - MIN_D); return { pts: offsetPoly(b.pts, false, (-k * inset) / 2), inset, D: D - inset }; }
    const L = pathLen(b.pts, false), n = b.pts.length;
    if (mode === "end") {
      inset = Math.min(inset, L - 2 * W);
      if (inset >= 0) return { pts: k ? subPath(b.pts, 0, L - inset) : subPath(b.pts, inset, L), inset, D };
      const pts = b.pts.map((q) => [...q]), i = k ? n - 1 : 0, j = k ? n - 2 : 1; pts[i] = V.add(b.pts[i], V.mul(V.norm(V.sub(b.pts[i], b.pts[j])), -inset));
      return { pts, inset, D };
    }
    inset = Math.min(inset, (L - 2 * W) / 2, (D - MIN_D) / 2);                       // corner: all round
    if (inset >= 0) return { pts: subPath(b.pts, inset, L - inset), inset, D: D - 2 * inset };
    const d0 = V.norm(V.sub(b.pts[0], b.pts[1])), d1 = V.norm(V.sub(b.pts[n - 1], b.pts[n - 2]));
    return { pts: [V.add(b.pts[0], V.mul(d0, -inset)), ...b.pts.slice(1, -1), V.add(b.pts[n - 1], V.mul(d1, -inset))], inset, D: D - 2 * inset };
  }

  // ---- walls as panel grids (straight blocks only). wall: { long: +1 / -1 } (the left / right long wall) or { end: 0 / 1 }.
  // -> { o: its lower-left corner on the plan, ax: along it, N: straight out of it, n panels of m metres, floors from y0 }
  function wallFrame(b, wall) {
    if (!b || b.closed || b.pts.length !== 2) return null;
    const { u, lf, L, D } = frame(b), y0 = floorY(b, 0);
    if (wall.long !== undefined) { const n = Math.max(1, Math.round(L / W)); return { o: V.add(b.pts[0], V.mul(lf, (wall.long * D) / 2)), ax: u, N: V.mul(lf, wall.long), Lw: L, n, m: L / n, y0, fl: b.fl, D, L, deep: D }; }
    const n = D >= 18 ? Math.max(2, Math.round(D / W)) : Math.max(2, Math.round(D / E4));      // as the layout cuts an end wall
    return { o: V.add(wall.end ? b.pts[1] : b.pts[0], V.mul(lf, -D / 2)), ax: lf, N: V.mul(u, wall.end ? 1 : -1), Lw: D, n, m: D / n, y0, fl: b.fl, D, L, deep: L };
  }
  // the panel of block b's wall at point p (on the plan) and height y -> { b, wall, k (panel), f (floor) }, or null
  function cellAt(b, p, y) {
    if (b.closed || b.pts.length !== 2) return null;
    const [s, w] = local(b, p), { L, D } = frame(b);
    const wall = Math.abs(Math.abs(w) - D / 2) < 0.6 && s > 0.3 && s < L - 0.3 ? { long: Math.sign(w) } : s < 0.6 ? { end: 0 } : s > L - 0.6 ? { end: 1 } : null; if (!wall) return null;
    const F = wallFrame(b, wall), t = V.dot(V.sub(p, F.o), F.ax), k = Math.floor(t / F.m), f = Math.floor((y - F.y0) / H);
    if (k < 0 || k >= F.n || f < 0 || f >= F.fl) return null;
    return { b, wall, k, f };
  }
  // a choice of panels { b, wall, k0, k1, f0, f1 } (either way round) -> along the wall t0..t1 (m), floors f0..f1 (f1 not included)
  function selBox(sl) { const F = wallFrame(sl.b, sl.wall); return { F, t0: Math.min(sl.k0, sl.k1) * F.m, t1: (Math.max(sl.k0, sl.k1) + 1) * F.m, f0: Math.min(sl.f0, sl.f1), f1: Math.max(sl.f0, sl.f1) + 1 }; }
  // the box built out of the chosen panels, d metres out: a block of its own, attached to that wall at that floor
  function extrudeBlock(sl, d, seed) {
    const { F, t0, t1, f0, f1 } = selBox(sl), P = (t, n) => V.add(V.add(F.o, V.mul(F.ax, t)), V.mul(F.N, n));
    let pts, D;
    if (t1 - t0 >= d) { pts = [P(t0, d / 2), P(t1, d / 2)]; D = d; }                          // wider than deep: runs along the wall
    else { const tm = (t0 + t1) / 2; pts = [P(tm, 0), P(tm, d)]; D = t1 - t0; }                 // deeper than wide: runs out from it
    return { id: state().nextId, pts, closed: false, D, fl: f1 - f0, fin: sl.b.fin, seed, parent: null, at: { id: sl.b.id, f: f0 } };
  }
  // the cut for digging the chosen panels d metres in
  function digCut(sl, d) {
    const { F, t0, t1, f0, f1 } = selBox(sl);
    return sl.wall.long !== undefined ? { side: sl.wall.long, s0: t0, s1: t1, f0, f1, d } : { end: sl.wall.end, w0: t0 - F.D / 2, w1: t1 - F.D / 2, f0, f1, d };
  }
  // how far a pull goes, from how far the pointer went (raw, m; + is out of the wall). Build out only builds, Dig only
  // digs, whatever the direction; in half panels (1.6 m) unless free; dug no deeper than the block (deep), and a dig
  // nearly through goes right through. -> d (+ out, - in, 0 nothing)
  function pullDepth(raw, mode, deep, free = false) {
    const st = W / 2; let d = 0;
    if (mode === "out" && raw > st * 0.5) d = free ? raw : Math.max(st, Math.round(raw / st) * st);
    else if (mode === "dig" && raw < -st * 0.5) { d = free ? raw : Math.min(-st, Math.round(raw / st) * st); if (-d >= deep - st * 0.5) d = -deep; d = Math.max(d, -deep); }
    return Math.min(d, 400);
  }

  // ---- quick building (tap to place, then adjust by handles)
  // how far a step back goes, snapped: an end or corner in whole panels of the block below (so the tier's panels stand
  // over the ones below), a long wall in whole end-wall panels, a ring in whole panels
  function stepSnap(b, raw, mode) {
    if (mode === "side") return Math.round(raw / E4) * E4;
    if (mode === "ring" || b.closed) return Math.round(raw / W) * W;
    const L = pathLen(b.pts, false); return Math.round(raw / (L / Math.max(1, Math.round(L / W)))) * (L / Math.max(1, Math.round(L / W)));
  }
  // a new block on the ground: n panels long, D deep, its near-left wall corner at c, running at angle ang
  function newBlock(c, ang, { n = 8, D = 12, fl = 5, fin = "concrete", seed = 1 } = {}) {
    const u = [Math.cos(ang), Math.sin(ang)], lf = V.left(u), a = V.add(c, V.mul(lf, D / 2));
    return { id: state().nextId, pts: [a, V.add(a, V.mul(u, n * W))], closed: false, D, fl, fin, seed, parent: null };
  }
  // a new block on the roof of P around point p: along P, n panels (fewer if the roof is short), as deep as P or 12 m,
  // its panels over P's panels and kept on the roof; centred across P when it fills less than its depth
  function roofBlock(P, p, { n = 4, fl = 3, fin, seed = 1 } = {}) {
    if (P.closed || P.pts.length !== 2) return null;
    const { u, lf, L, D } = frame(P), m = L / Math.max(1, Math.round(L / W)), k = Math.min(n, Math.round(L / m)), len = k * m, d = Math.min(D, 12);
    const [s] = local(P, p), s0 = Math.min(L - len, Math.max(0, Math.round((s - len / 2) / m) * m));
    const a = V.add(P.pts[0], V.mul(u, s0));
    return { id: state().nextId, pts: [a, V.add(a, V.mul(u, len))], closed: false, D: d, fl, fin: fin || P.fin, seed, parent: P.id };
  }

  // moving block b0 (before the move) by a drag of delta on the roof of P (straight, its walls parallel or square to
  // P's): along P in whole panels of P, across in half end-wall panels, unless it comes within tol of flush with an
  // edge of the roof or centred on it. -> { delta, why }
  function tierMove(b0, P, delta, tol) {
    const F = frame(P), m = F.L / Math.max(1, Math.round(F.L / W)), D = b0.D || 12, u = V.norm(V.sub(b0.pts[1], b0.pts[0])), lf = V.left(u);
    const corners = [b0.pts[0], b0.pts[1]].flatMap((p) => [V.add(p, V.mul(lf, D / 2)), V.sub(p, V.mul(lf, D / 2))]).map((p) => local(P, p));
    const s0 = Math.min(...corners.map((c) => c[0])), len = Math.max(...corners.map((c) => c[0])) - s0;
    const w0 = Math.min(...corners.map((c) => c[1])), wid = Math.max(...corners.map((c) => c[1])) - w0;
    const ds = V.dot(delta, F.u), dw = V.dot(delta, F.lf), whys = [];
    const snap = (v, cands, step, base) => { let best = null; for (const [c, why] of cands) if (Math.abs(c - v) < tol && (!best || Math.abs(c - v) < Math.abs(best[0] - v))) best = [c, why];
      if (best) { whys.push(best[1]); return best[0]; } return base + Math.round((v - base) / step) * step; };
    const joint = (v) => Math.abs(v / m - Math.round(v / m)) < 0.02;      // along: only on a panel joint below, so the panels line up
    const ns = snap(s0 + ds, [[0, "flush"], [F.L - len, "flush"], [(F.L - len) / 2, "centred"]].filter(([c]) => joint(c)), m, 0);
    const nw = snap(w0 + dw, [[-F.D / 2, "flush"], [F.D / 2 - wid, "flush"], [-wid / 2, "centred"]], E4 / 2, -F.D / 2);
    return { delta: V.add(V.mul(F.u, ns - s0), V.mul(F.lf, nw - w0)), why: [...new Set(whys)].join(" · ") };
  }
  // move a block and everything standing on it or built out of it
  function translate(id, delta) {
    const S = state(), ids = subtree(id);
    for (const b of S.blocks) if (ids.has(b.id)) b.pts = b.pts.map((p) => V.add(p, delta));
    for (const t of S.trees) if (t.b && ids.has(t.b)) { t.x += delta[0]; t.z += delta[1]; }
  }

  return { tierMove, translate, stepSnap, newBlock, roofBlock, byId, reindex, isGround, baseOf, topOf, floorY, subtree, demolish, holeAt, holeEdgeAt, inSign, terracePts, wallFrame, cellAt, selBox, extrudeBlock, digCut, pullDepth };
}
