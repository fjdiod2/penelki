// Sandbox blocks: Soviet panel blocks laid along ANY path (straight, curved, a closed ring), built from the same Blender
// pieces and wall shader as the simulator (apartments.js). A block here is
//   { id, pts: [[x, z], ...] centreline, closed, D (depth, m), fl (floors), fin (wall finish), seed, parent (block id or null) }
// The two long facades are the centreline offset D/2 to each side. Each facade is cut into runs at its sharp corners and
// every run is divided into equal modules of about 3.2 m; a panel spans the chord between two module points, so panels
// meet exactly even on curves. A block with a parent stands on that block's roof (no plinth, no entrances).
// Map frame: x east, y up, z south. Piece frame (Blender): x along the facade, y into the building, z up.
import * as THREE from "three";
import { createApartments } from "./apartments.js";

const MAIN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12], TWO = [5, 6, 7, 8, 9, 11, 12], BARS = 10;
const SHARP = (25 * Math.PI) / 180;              // a facade turning more than this at a point gets a corner there

// ---- 2D helpers; points are [x, z]
export const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]], add: (a, b) => [a[0] + b[0], a[1] + b[1]], mul: (a, k) => [a[0] * k, a[1] * k],
  len: (a) => Math.hypot(a[0], a[1]), dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  norm: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  left: (d) => [d[1], -d[0]],                    // the side a piece's "into the building" axis points to when walking along d
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
};
export function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function pathLen(p, closed) { let s = 0; for (let i = 1; i < p.length; i++) s += V.dist(p[i], p[i - 1]); return closed ? s + V.dist(p[p.length - 1], p[0]) : s; }
// a polyline moved sideways by dist (+ = V.left side), with mitred corners
export function offsetPoly(pts, closed, dist) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    const dPrev = hasPrev ? V.norm(V.sub(p, pts[(i - 1 + n) % n])) : null, dNext = hasNext ? V.norm(V.sub(pts[(i + 1) % n], p)) : null;
    const n0 = V.left(dPrev || dNext), n1 = V.left(dNext || dPrev);
    let m = V.add(n0, n1); m = V.len(m) < 1e-6 ? n0 : V.norm(m);
    const k = dist / Math.max(0.35, V.dot(m, n0));
    out.push([p[0] + m[0] * k, p[1] + m[1] * k]);
  }
  return out;
}
// nearest point on a polyline: { q, d, i (segment), t }
export function nearestOnPath(pts, closed, p) {
  let best = { d: Infinity }; const n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], ab = V.sub(b, a), L2 = V.dot(ab, ab) || 1e-9, t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), ab) / L2)), q = V.lerp(a, b, t), d = V.dist(p, q);
    if (d < best.d) best = { q, d, i, t };
  }
  return best;
}
// a stretch of an open polyline between arc lengths s0 and s1
export function subPath(pts, s0, s1) {
  const out = []; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = V.dist(a, b), e = acc + L;
    if (e >= s0 && acc <= s1) {
      if (!out.length) out.push(V.lerp(a, b, L ? Math.max(0, (s0 - acc) / L) : 0));
      if (e <= s1) out.push(b); else { out.push(V.lerp(a, b, (s1 - acc) / L)); break; }
    }
    acc = e;
  }
  return out;
}
function runs(poly, closed) {                     // split a facade line at its sharp corners
  const n = poly.length;
  const turn = (i) => { const a = V.norm(V.sub(poly[i], poly[(i - 1 + n) % n])), b = V.norm(V.sub(poly[(i + 1) % n], poly[i])); return Math.acos(Math.max(-1, Math.min(1, V.dot(a, b)))); };
  if (!closed) {
    const out = []; let cur = [poly[0]];
    for (let i = 1; i < n; i++) { cur.push(poly[i]); if (i < n - 1 && turn(i) > SHARP) { out.push(cur); cur = [poly[i]]; } }
    out.push(cur); return out;
  }
  const sharp = []; for (let i = 0; i < n; i++) if (turn(i) > SHARP) sharp.push(i);
  if (!sharp.length) return [[...poly, poly[0]]];
  return sharp.map((a, k) => { const b = sharp[(k + 1) % sharp.length], run = []; let i = a; do { run.push(poly[i]); i = (i + 1) % n; } while (i !== b); run.push(poly[b]); return run; });
}
function resample(run, W) {                       // equal modules of about W along a run
  const cum = [0]; for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + V.dist(run[i], run[i - 1]));
  const L = cum[cum.length - 1]; if (L < 0.5) return [];
  const N = Math.max(1, Math.round(L / W)), out = []; let j = 1;
  for (let k = 0; k <= N; k++) {
    const s = (L * k) / N; while (j < run.length - 1 && cum[j] < s) j++;
    out.push(V.lerp(run[j - 1], run[j], Math.min(1, Math.max(0, (s - cum[j - 1]) / Math.max(1e-9, cum[j] - cum[j - 1])))));
  }
  return out;
}
function pointAt(pts, closed, s) {                // point and unit direction at arc length s along a path
  const n = pts.length, segs = closed ? n : n - 1; let acc = 0;
  for (let i = 0; i < segs; i++) { const a = pts[i], b = pts[(i + 1) % n], L = V.dist(a, b); if (acc + L >= s || i === segs - 1) return [V.lerp(a, b, L ? Math.min(1, (s - acc) / L) : 0), V.norm(V.sub(b, a))]; acc += L; }
  return [pts[0], [1, 0]];
}
// a straight block's cuts as boxes in its own frame: { s0, s1 (along), w0, w1 (across, + to the left), f0, f1 }
export function cutRects(b) {
  if (!b.cuts || b.closed || b.pts.length !== 2) return [];
  const D = b.D || 12, L = V.dist(b.pts[0], b.pts[1]), FL = Math.max(1, b.fl);
  return b.cuts.map((c) => {
    let s0, s1, w0, w1;
    if (c.end === undefined) { s0 = c.s0; s1 = c.s1; const d = Math.min(c.d, D); if (c.side > 0) { w1 = D / 2; w0 = D / 2 - d; } else { w0 = -D / 2; w1 = -D / 2 + d; } }
    else { w0 = c.w0; w1 = c.w1; const d = Math.min(c.d, L); if (c.end === 0) { s0 = 0; s1 = d; } else { s0 = L - d; s1 = L; } }
    return { s0: Math.max(0, s0), s1: Math.min(L, s1), w0: Math.max(-D / 2, w0), w1: Math.min(D / 2, w1), f0: Math.max(0, c.f0), f1: Math.min(FL, c.f1) };
  });
}
export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296); }

export async function createBlockKit(fog) {
  const A = await createApartments(fog), W = A.P.module, H = A.P.storey, PL = A.P.plinth, E4 = A.P.end_width;
  const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();

  // one placed piece: from A to B along a facade (interior on the V.left side), its foot at height y
  function piece(pc, a, b, y, win = 0, v2 = 0, door = 0, rnd = 0, zs = 1) {
    const d = V.sub(b, a), L = V.len(d), u = V.mul(d, 1 / (L || 1));
    X.set(u[0], 0, u[1]).multiplyScalar(L / A.geo[pc].pw); Y.set(u[1], 0, -u[0]); Z.copy(UP).multiplyScalar(zs);
    // q, n, y, h: the middle of its face on the plan, the direction into the building, its foot and height (for merging)
    return { pc, m: new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a[0], y, a[1]), win, v2, door, rnd, q: V.lerp(a, b, 0.5), n: V.left(u), y, h: PIECE_H[pc] ?? H * zs, trim: pc in PIECE_H, pa: a, pb: b };
  }
  const PIECE_H = { plinth: PL, plinth_end: PL, parapet: 0.6, parapet_end: 0.6, pipe: 0.4 };      // not full storey panels: in a shared wall plane these always give way
  function flat(pc, o, dir, y) {                  // a roof box: x along dir, y to the V.left of it
    X.set(dir[0], 0, dir[1]); Y.set(dir[1], 0, -dir[0]);
    return { pc, m: new THREE.Matrix4().makeBasis(X, Y, UP).setPosition(o[0], y, o[1]), win: 0, v2: 0, door: 0, rnd: 0, q: o, y, roof: true };
  }

  // ---- the rules: block -> pieces
  function layout(b, base) {
    const ground = !b.parent && !b.at, D = b.D || 12, r = rng(b.seed), pl = ground ? PL : 0, FL = Math.max(1, b.fl), top = base + pl + FL * H;
    const Lp = offsetPoly(b.pts, b.closed, D / 2), Rp = offsetPoly(b.pts, b.closed, -D / 2);
    const facR = Rp, facL = [...Lp].reverse(), lenR = pathLen(facR, b.closed), lenL = pathLen(facL, b.closed);
    // entrances go on the shorter facade (a ring's courtyard side); on a straight block the seed decides
    const frontR = Math.abs(lenR - lenL) > 0.02 * Math.max(lenR, lenL) ? lenR < lenL : (b.seed & 1) === 0;
    const glazedShare = 0.4 + 0.4 * r(), out = [], pick = (a) => a[Math.floor(r() * a.length)];
    for (const [fac, front] of [[facR, frontR], [facL, !frontR]]) {
      let m = 0;
      for (const run of runs(fac, b.closed)) {
        const sp = resample(run, W);
        for (let k = 0; k + 1 < sp.length; k++, m++) {
          const a = sp[k], c = sp[k + 1], s5 = m % 5;
          for (let f = 0; f < FL; f++) {
            let pc = "window", win = pick(MAIN), v2 = 0;
            if (front && s5 === 2) { pc = f === 0 && ground ? "entrance" : "stair"; win = pick(TWO); }
            else if (!front && (s5 === 1 || s5 === 3) && f > 0) {
              win = pick(TWO);
              if (r() < glazedShare) pc = f === FL - 1 ? "balcony_glazed_top" : "balcony_glazed";
              else { const q = r(); pc = q < 0.35 ? "balcony_open_laundry" : q < 0.6 ? "balcony_open_junk" : "balcony_open"; }
              v2 = Math.floor(r() * 4);
            } else if (f === 0 && ground && r() < 0.25) win = BARS;
            out.push(piece(pc, a, c, base + pl + f * H, win, v2, Math.floor(r() * 4), r()));
          }
          if (ground) out.push(piece("plinth", a, c, base));
          out.push(piece("parapet", a, c, top));
          if (m % 7 === 0 && r() < 0.7) { const pa = V.lerp(a, c, 0.06); out.push(piece("pipe", pa, V.add(pa, V.mul(V.norm(V.sub(c, a)), 0.16)), base, 0, 0, 0, 0, (top - base + 0.3) / 15.1)); }
        }
      }
    }
    if (!b.closed) {                              // end walls: panels across the depth at each end (four on a standard 12 m block)
      // a wide block (18 m and more) has flats along its ends too, so it gets ordinary window panels there
      const n = b.pts.length, wide = D >= 18, ne = wide ? Math.max(2, Math.round(D / W)) : Math.max(2, Math.round(D / E4));
      for (const [a, c] of [[Lp[0], Rp[0]], [Rp[n - 1], Lp[n - 1]]]) for (let j = 0; j < ne; j++) {
        const p0 = V.lerp(a, c, j / ne), p1 = V.lerp(a, c, (j + 1) / ne);
        for (let f = 0; f < FL; f++) out.push(wide ? piece("window", p0, p1, base + pl + f * H, f === 0 && ground && r() < 0.25 ? BARS : pick(MAIN), 0, Math.floor(r() * 4), r())
          : piece(j > 0 && j < ne - 1 && r() < 0.3 ? "end_narrow" : "end", p0, p1, base + pl + f * H, pick(TWO), 0, 0, r()));
        if (ground) out.push(piece(wide ? "plinth" : "plinth_end", p0, p1, base));
        out.push(piece(wide ? "parapet" : "parapet_end", p0, p1, top));
      }
    }
    // roof: a stair exit for every five modules of length, and vents
    const Lc = pathLen(b.pts, b.closed), sec = Math.max(1, Math.round(Lc / (5 * W)));
    for (let s = 0; s < sec; s++) {
      const [c, d] = pointAt(b.pts, b.closed, ((s + 0.5) * Lc) / sec), lf = V.left(d);
      out.push(flat("roof_exit", V.sub(V.sub(c, V.mul(d, 1.3)), V.mul(lf, 1.05)), d, top));
      for (const o of [-0.3, 0.3]) { const [v] = pointAt(b.pts, b.closed, ((s + 0.5 + o) * Lc) / sec); out.push(flat("vent", V.add(v, V.mul(lf, D * 0.22)), d, top)); }
    }
    const lay = { out, base, top, Lp, Rp, closed: b.closed, ground, fin: A.FINISH[b.fin] || A.FINISH.concrete };
    if (!b.closed && b.pts.length === 2 && b.cuts && b.cuts.length) applyCuts(b, lay, { D, FL, pl, r, pick });
    return lay;
  }
  // ---- holes dug into a straight block. A cut dug from a long wall: { side: +1 (left wall) / -1 (right wall), s0, s1
  // (metres along the block from its first point), f0, f1 (floors, f1 not included), d (how deep) }; from an end wall:
  // { end: 0 / 1, w0, w1 (metres across, + to the left), f0, f1, d }. Each is a box in the block (s along, w across).
  // All of a block's cuts together cut it into a small grid of cells (split at every cut's edges, and by floors); a cell
  // is empty if any cut takes it. Outer panels in front of empty cells are dropped, and wherever an empty cell meets a
  // solid one the hole gets a surface: wall panels (windows on walls facing the way the long walls do, end-wall panels
  // on the others), a ceiling, a floor (dark like a roof where it is open to the sky). The roof and underside lose the
  // empty columns, and the invisible hull used for clicking follows the holes too, so clicks go through them.
  function applyCuts(b, lay, { D, FL, pl, r, pick }) {
    const c0 = b.pts[0], u = V.norm(V.sub(b.pts[1], b.pts[0])), lf = V.left(u), L = V.dist(b.pts[0], b.pts[1]), y0 = lay.base + pl, E = 0.01;
    const cuts = cutRects(b);
    const uniq = (a) => { const o = []; for (const v of a.sort((x, y) => x - y)) if (!o.length || v - o[o.length - 1] > E) o.push(v); return o; };
    const ss = uniq([0, L, ...cuts.flatMap((c) => [c.s0, c.s1])].map((v) => Math.min(L, Math.max(0, v))));
    const ws = uniq([-D / 2, D / 2, ...cuts.flatMap((c) => [c.w0, c.w1])].map((v) => Math.min(D / 2, Math.max(-D / 2, v))));
    const NI = ss.length - 1, NJ = ws.length - 1, empty = new Uint8Array(NI * NJ * FL);
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) for (let f = 0; f < FL; f++) {
      const sm = (ss[i] + ss[i + 1]) / 2, wm = (ws[j] + ws[j + 1]) / 2;
      if (cuts.some((c) => sm > c.s0 && sm < c.s1 && wm > c.w0 && wm < c.w1 && f >= c.f0 && f < c.f1)) empty[(i * NJ + j) * FL + f] = 1;
    }
    const isEmpty = (i, j, f) => empty[(i * NJ + j) * FL + f] === 1;
    const solid = (i, j, f) => i >= 0 && j >= 0 && f >= 0 && i < NI && j < NJ && f < FL && !isEmpty(i, j, f);
    const idx = (arr, v) => { for (let k = 0; k < arr.length - 1; k++) if (v < arr[k + 1]) return k; return arr.length - 2; };
    const loc = (p) => { const d = V.sub(p, c0); return [V.dot(d, u), V.dot(d, lf)]; };
    const P = (s, w) => V.add(V.add(c0, V.mul(u, s)), V.mul(lf, w));
    const yBot = (f) => (f === 0 && lay.ground ? lay.base : y0 + f * H), yTop = (f) => y0 + (f + 1) * H;
    // the outer pieces: dropped where the cell behind them is empty
    const out = [];
    for (const pc of lay.out) {
      if (!pc.q) { out.push(pc); continue; }
      const [s, w] = loc(pc.q), i = idx(ss, Math.min(L - E, Math.max(E, s))), j = idx(ws, Math.min(D / 2 - E, Math.max(-D / 2 + E, w)));
      if (pc.roof) { if (!isEmpty(i, j, FL - 1)) out.push(pc); continue; }
      if (pc.pc === "pipe") { let any = false; for (let f = 0; f < FL; f++) any ||= isEmpty(i, j, f); if (!any) out.push(pc); continue; }
      const f = pc.pc.startsWith("plinth") ? 0 : pc.pc.startsWith("parapet") ? FL - 1 : Math.min(FL - 1, Math.max(0, Math.round((pc.y - y0) / H)));
      // a hole's edge can cut through a panel (a dig not in whole panels of this wall): keep the part in front of solid
      // building, as plain wall where it is too narrow for its window
      const [sa, wa] = loc(pc.pa), [sb, wb] = loc(pc.pb), alongS = Math.abs(sb - sa) > Math.abs(wb - wa), t0v = alongS ? sa : wa, t1v = alongS ? sb : wb;
      const ts = [0, ...(alongS ? ss : ws).map((v) => (v - t0v) / (t1v - t0v)).filter((t) => t > 0.02 && t < 0.98).sort((x, y) => x - y), 1];
      if (ts.length === 2) { if (!isEmpty(i, j, f)) out.push(pc); continue; }
      const cellOf = (q) => { const [s1, w1] = loc(q); return [idx(ss, Math.min(L - E, Math.max(E, s1))), idx(ws, Math.min(D / 2 - E, Math.max(-D / 2 + E, w1)))]; };
      const solidPart = ts.slice(0, -1).map((t, k) => { const [ci, cj] = cellOf(V.lerp(pc.pa, pc.pb, (t + ts[k + 1]) / 2)); return !isEmpty(ci, cj, f); });
      if (solidPart.every(Boolean)) { out.push(pc); continue; }
      for (let k = 0; k < solidPart.length; k++) {
        if (!solidPart[k]) continue; let e = k; while (e + 1 < solidPart.length && solidPart[e + 1]) e++;
        const a = V.lerp(pc.pa, pc.pb, ts[k]), c = V.lerp(pc.pa, pc.pb, ts[e + 1]), wide = V.dist(a, c) >= 0.75 * W;
        const kind = wide || /^(end|plinth_end|parapet_end)$/.test(pc.pc) ? pc.pc : /plinth/.test(pc.pc) ? "plinth_end" : /parapet/.test(pc.pc) ? "parapet_end" : "end";
        out.push(piece(kind, a, c, pc.y, pc.win, pc.v2, pc.door, pc.rnd)); k = e;
      }
    }
    // the hole's surfaces
    const quads = [], hull = [];
    const wallPiece = (pcn, p, q, y, inward, win) => { if (V.dot(V.left(V.sub(q, p)), inward) < 0) [p, q] = [q, p]; return piece(pcn, p, q, y, win, 0, 0, r()); };
    const vface = (a, bq, f, inward, windows) => {          // one cell's wall, split into panels about a panel wide
      const len = V.dist(a, bq); let ne = Math.max(1, Math.round(len / (windows ? W : E4)));
      if (windows && len / ne < 0.75 * W) { windows = false; ne = Math.max(1, Math.round(len / E4)); }   // too narrow for a window panel: plain wall
      for (let k = 0; k < ne; k++) {
        const p = V.lerp(a, bq, k / ne), q = V.lerp(a, bq, (k + 1) / ne);
        out.push(windows ? wallPiece("window", p, q, y0 + f * H, inward, pick(MAIN)) : wallPiece("end", p, q, y0 + f * H, inward, pick(TWO)));
        if (f === 0 && lay.ground) out.push(wallPiece(windows ? "plinth" : "plinth_end", p, q, lay.base, inward, 0));
        if (f === FL - 1) out.push(wallPiece(windows ? "parapet" : "parapet_end", p, q, lay.top, inward, 0));
      }
    };
    const openUp = (i, j, f) => { for (let g = f; g < FL; g++) if (!isEmpty(i, j, g)) return false; return true; };
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) for (let f = 0; f < FL; f++) {
      const rect = [P(ss[i], ws[j]), P(ss[i + 1], ws[j]), P(ss[i + 1], ws[j + 1]), P(ss[i], ws[j + 1])];
      if (isEmpty(i, j, f)) {
        if (solid(i - 1, j, f)) vface(P(ss[i], ws[j]), P(ss[i], ws[j + 1]), f, V.mul(u, -1), false);
        if (solid(i + 1, j, f)) vface(P(ss[i + 1], ws[j]), P(ss[i + 1], ws[j + 1]), f, u, false);
        if (solid(i, j - 1, f)) vface(P(ss[i], ws[j]), P(ss[i + 1], ws[j]), f, V.mul(lf, -1), true);
        if (solid(i, j + 1, f)) vface(P(ss[i], ws[j + 1]), P(ss[i + 1], ws[j + 1]), f, lf, true);
        if (solid(i, j, f + 1)) quads.push({ p: rect, y: yTop(f) - 0.02 });                                      // ceiling
        if (solid(i, j, f - 1)) quads.push({ p: rect, y: y0 + f * H + 0.02, roof: openUp(i, j, f) });           // floor
        continue;
      }
      // the hull: every side of a solid cell that faces a hole or the outside
      const yb = yBot(f), yt = yTop(f), side = (a, bq) => hull.push([[a[0], yb, a[1]], [bq[0], yb, bq[1]], [bq[0], yt, bq[1]], [a[0], yt, a[1]]]);
      if (!solid(i - 1, j, f)) side(rect[0], rect[3]); if (!solid(i + 1, j, f)) side(rect[1], rect[2]);
      if (!solid(i, j - 1, f)) side(rect[0], rect[1]); if (!solid(i, j + 1, f)) side(rect[3], rect[2]);
      if (!solid(i, j, f + 1)) hull.push(rect.map((q) => [q[0], f === FL - 1 ? lay.top : yt, q[1]]));
      if (!solid(i, j, f - 1)) hull.push(rect.map((q) => [q[0], yb, q[1]]));
    }
    const cells = (f) => { const res = []; for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) if (!isEmpty(i, j, f)) res.push([P(ss[i], ws[j]), P(ss[i + 1], ws[j]), P(ss[i + 1], ws[j + 1]), P(ss[i], ws[j + 1])]); return res; };
    lay.out = out; lay.quads = quads; lay.hullQuads = hull; lay.roofCells = cells(FL - 1); lay.underCells = lay.ground ? null : cells(0);
  }

  // ---- all pieces of many blocks as one InstancedMesh per piece type
  function buildMeshes(lays) {
    const per = {}, grp = new THREE.Group();
    for (const lay of lays) for (const p of lay.out) (per[p.pc] ||= []).push([p, lay]);
    for (const [pc, list] of Object.entries(per)) {
      const G = A.geo[pc], g = G.g.clone(), n = list.length, im = new THREE.InstancedMesh(g, G.mat, n), bt = pc === "window" ? 0 : 5;
      const iVar = new Float32Array(n * 4), iWall = new Float32Array(n * 4), iUv = new Float32Array(n * 4);
      list.forEach(([p, lay], i) => {
        im.setMatrixAt(i, p.m); iVar.set([lay.base, lay.top, lay.fin[2] ? 1 : 0, p.rnd], i * 4); iWall.set([lay.fin[0], ...lay.fin[1]], i * 4);
        iUv.set([((p.win % 4) - (bt % 4)) / 4, -(Math.floor(p.win / 4) - Math.floor(bt / 4)) / 4, p.door, p.v2], i * 4);
      });
      g.setAttribute("iVar", new THREE.InstancedBufferAttribute(iVar, 4)); g.setAttribute("iWall", new THREE.InstancedBufferAttribute(iWall, 4)); g.setAttribute("iUv", new THREE.InstancedBufferAttribute(iUv, 4));
      im.frustumCulled = false; grp.add(im);
    }
    return grp;
  }
  const disposeGroup = (g) => g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });

  // ---- simple surfaces: the roof, the underside of a block standing out over nothing, and an invisible hull for picking
  function ribbon(Lp, Rp, closed, y, pos, idx) {
    const n = Lp.length, o = pos.length / 3;
    for (let i = 0; i < n; i++) pos.push(Lp[i][0], y, Lp[i][1], Rp[i][0], y, Rp[i][1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) { const a = o + 2 * i, c = o + 2 * ((i + 1) % n); idx.push(a, a + 1, c + 1, a, c + 1, c); }
  }
  function wall(poly, closed, y0, y1, pos, idx) {
    const n = poly.length, o = pos.length / 3;
    for (let i = 0; i < n; i++) pos.push(poly[i][0], y0, poly[i][1], poly[i][0], y1, poly[i][1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) { const a = o + 2 * i, c = o + 2 * ((i + 1) % n); idx.push(a, c, c + 1, a, c + 1, a + 1); }
  }
  const geom = (pos, idx) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
  const roofMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.085, 0.085, 0.095, THREE.LinearSRGBColorSpace), side: THREE.DoubleSide });
  const underMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.42, 0.41, 0.39, THREE.LinearSRGBColorSpace), side: THREE.DoubleSide });
  const hullMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  roofMat.userData.townLight = "up"; underMat.userData.townLight = "down";   // (shaded by the town: sandbox_lightgl.js)
  const quad = (c, y, pos, idx) => { const o = pos.length / 3; for (const q of c) pos.push(q[0], y, q[1]); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  function roofMesh(lay) {
    const grp = new THREE.Group(), p = [], i = [];
    if (lay.roofCells) for (const c of lay.roofCells) quad(c, lay.top + 0.02, p, i); else ribbon(lay.Lp, lay.Rp, lay.closed, lay.top + 0.02, p, i);
    for (const h of lay.quads || []) if (h.roof) quad(h.p, h.y, p, i);                     // the floor of a hole open to the sky: a roof
    grp.add(new THREE.Mesh(geom(p, i), roofMat));
    const q = [], j = [];
    if (!lay.ground) { if (lay.underCells) for (const c of lay.underCells) quad(c, lay.base + 0.01, q, j); else ribbon(lay.Lp, lay.Rp, lay.closed, lay.base + 0.01, q, j); }
    for (const h of lay.quads || []) if (!h.roof) quad(h.p, h.y, q, j);                     // a hole's ceiling and floor
    if (j.length) grp.add(new THREE.Mesh(geom(q, j), underMat));
    return grp;
  }
  function hullMesh(lay) {
    const p = [], i = [];
    if (lay.hullQuads) { for (const h of lay.hullQuads) { const o = p.length / 3; for (const q of h) p.push(...q); i.push(o, o + 1, o + 2, o, o + 2, o + 3); } return new THREE.Mesh(geom(p, i), hullMat); }
    ribbon(lay.Lp, lay.Rp, lay.closed, lay.top, p, i); ribbon(lay.Lp, lay.Rp, lay.closed, lay.base, p, i);
    wall(lay.Lp, lay.closed, lay.base, lay.top, p, i); wall(lay.Rp, lay.closed, lay.base, lay.top, p, i);
    if (!lay.closed) { const n = lay.Lp.length; wall([lay.Lp[0], lay.Rp[0]], false, lay.base, lay.top, p, i); wall([lay.Lp[n - 1], lay.Rp[n - 1]], false, lay.base, lay.top, p, i); }
    return new THREE.Mesh(geom(p, i), hullMat);
  }
  function overlay(lay, mat, lift = 0.6) { const p = [], i = []; ribbon(lay.Lp, lay.Rp, lay.closed, lay.top + lift, p, i); return new THREE.Mesh(geom(p, i), mat); }

  // ---- merging. Blocks on the same grid (every side parallel or square to every side of the other) that run into each
  // other are drawn as one building: a piece is dropped when the face it shows lies inside the other block (it could
  // only be seen from within: walls, parapets and roof boxes buried in a neighbour), and where two walls lie in one
  // plane facing the same way only one is kept. Angled, curved and round blocks keep all their pieces.
  // items: [{ id, b, lay }] -> the lays, with pieces dropped where needed (the cached lays are not changed)
  function boxesOf(b) {
    if (b.closed) return null; const out = [], D = b.D || 12;
    for (let i = 0; i + 1 < b.pts.length; i++) { const a = b.pts[i], c = b.pts[i + 1], L = V.dist(a, c); if (L > 1e-6) out.push({ a, u: V.mul(V.sub(c, a), 1 / L), L, D }); }
    return out;
  }
  const inBox = (bx, p) => { const d = V.sub(p, bx.a), s = V.dot(d, bx.u), w = V.dot(d, V.left(bx.u)); return s > 0.05 && s < bx.L - 0.05 && Math.abs(w) < bx.D / 2 - 0.05; };
  const square = (A, B) => A.every((x) => B.every((y) => { const c = Math.abs(x.u[0] * y.u[1] - x.u[1] * y.u[0]), d = Math.abs(V.dot(x.u, y.u)); return c < 0.01 || d < 0.01; }));
  function mergeLays(items) {
    const info = items.map((it) => { const xs = [...it.lay.Lp, ...it.lay.Rp].map((q) => q[0]), zs = [...it.lay.Lp, ...it.lay.Rp].map((q) => q[1]);
      return { ...it, boxes: boxesOf(it.b), voids: cutRects(it.b), bb: [Math.min(...xs) - 0.5, Math.min(...zs) - 0.5, Math.max(...xs) + 0.5, Math.max(...zs) + 0.5] }; });
    return info.map((A) => {
      if (!A.boxes) return A.lay;
      const others = info.filter((B) => B !== A && B.boxes && B.bb[0] < A.bb[2] && B.bb[2] > A.bb[0] && B.bb[1] < A.bb[3] && B.bb[3] > A.bb[1]
        && B.lay.top > A.lay.base && B.lay.base < A.lay.top + 1 && square(A.boxes, B.boxes));
      if (!others.length) return A.lay;
      const inHole = (B, p, y) => {                // in a hole dug into B: not inside it after all
        if (!B.voids.length) return false; const bx = B.boxes[0], d = V.sub(p, bx.a), s = V.dot(d, bx.u), w = V.dot(d, V.left(bx.u));
        const f = Math.floor((y - B.lay.base - (B.lay.ground ? PL : 0)) / H);
        return B.voids.some((r) => s > r.s0 && s < r.s1 && w > r.w0 && w < r.w1 && f >= r.f0 && f < r.f1);
      };
      const inside = (B, p, y) => y > B.lay.base + 0.01 && y < B.lay.top - 0.01 && B.boxes.some((bx) => inBox(bx, p)) && !inHole(B, p, y);
      const out = A.lay.out.filter((pc) => {
        if (!pc.q) return true;
        if (pc.roof) return !others.some((B) => inside(B, pc.q, pc.y + 0.5));
        const y = pc.y + pc.h / 2, po = V.sub(pc.q, V.mul(pc.n, 0.4)), pi = V.add(pc.q, V.mul(pc.n, 0.4));
        for (const B of others) { if (inside(B, po, y)) return false; if (inside(B, pi, y) && (pc.trim || A.id > B.id)) return false; }
        return true;
      });
      return { ...A.lay, out };
    });
  }

  return { W, H, PL, E4, mergeLays, FIN: A.FIN, FINISH: A.FINISH, layout, buildMeshes, disposeGroup, roofMesh, hullMesh, overlay };
}
