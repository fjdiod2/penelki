// Панельки, light that knows about the town: sun shadows of the blocks, and how much sky each spot sees (deep streets
// between tall blocks are in shade, brighter floor by floor upward). Kept apart from the scene so it can be tested in
// Node; sandbox_lightgl.js does the same sums on the GPU (bakes them into textures when the town changes) and puts them
// into the shaders. Keep the two the same.
//
// 1. A height map: the town seen from above on a grid (2 m cells, coarser for very big towns). Each cell holds where
//    solid starts and ends over it, [bot, top] (bot 0 for blocks standing on the ground, above it for a bridge or a bay
//    hanging over the street), and a gap in it, [g0, g1] (a hole dug through; none when g1 <= g0); empty cells [0, 0].
// 2. Sun shadows: from each cell, step toward the sun over the map; whatever the line meets shades ranges of heights
//    at the cell: two of them kept, [L1, H1, L2, H2] (one from the ground up for blocks standing on the ground, another
//    above it where the sun comes through a hole lower down).
// 3. Sky: from a spot, in 16 directions round, step outward over the map and find how high the sky starts (the
//    horizon); the light of an even sky above it, as a roof (up) and a wall facing +x, -x, +z, -z would get it,
//    1 in the open. Baked at a few heights above each cell's ground (LAYERS), blended between them.

export const SUN = (() => { const v = [30, 45, 62], l = Math.hypot(...v); return v.map((x) => x / l); })();   // as apartments.js
export const SUN_XZ = (() => { const l = Math.hypot(SUN[0], SUN[2]); return [SUN[0] / l, SUN[2] / l]; })();
export const TAN_E = SUN[1] / Math.hypot(SUN[0], SUN[2]);          // the sun's height: rise per metre toward it
export const LAYERS = [0, 5, 12, 25, 50, 100, 200, 400];           // heights (m) above a cell's ground the sky is baked at
export const DIRS = 16, SKY_STEPS = 22, SKY_GROW = 1.33;
export const NONE = -1000;                                         // "no shadow here" in [L, H]

// blocks as prisms: { pts (centre line), closed, D (depth), y0, y1, holes: [{ a, u, lf, s0, s1, w0, w1, y0, y1 }] (a
// box dug out: s along u from a, w along lf, between heights y0 and y1) } -> the height map
// { x0, z0, c (cell, m), nx, nz, bot, top, g0, g1 (Float32Array, row by row along x) }. Cells are in when their centre is.
export function heightGrid(prisms, { cellMin = 2, nMax = 1024, around = 60, maxShadow = 1200 } = {}) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, top = 0;
  for (const p of prisms) { const h = p.D / 2; for (const q of p.pts) { x0 = Math.min(x0, q[0] - h); z0 = Math.min(z0, q[1] - h); x1 = Math.max(x1, q[0] + h); z1 = Math.max(z1, q[1] + h); } top = Math.max(top, p.y1); }
  if (!prisms.length) return null;
  const L = Math.min(maxShadow, top / TAN_E);                     // shadows reach this far, away from the sun
  x0 -= around + Math.max(0, SUN_XZ[0]) * L; x1 += around + Math.max(0, -SUN_XZ[0]) * L;
  z0 -= around + Math.max(0, SUN_XZ[1]) * L; z1 += around + Math.max(0, -SUN_XZ[1]) * L;
  const c = Math.max(cellMin, Math.max(x1 - x0, z1 - z0) / nMax);
  x0 = Math.floor(x0 / c) * c; z0 = Math.floor(z0 / c) * c;       // (on whole cells: the map does not slide as blocks come and go)
  const nx = Math.min(nMax, Math.ceil((x1 - x0) / c)), nz = Math.min(nMax, Math.ceil((z1 - z0) / c));
  const g = { x0, z0, c, nx, nz, bot: new Float32Array(nx * nz), top: new Float32Array(nx * nz), g0: new Float32Array(nx * nz), g1: new Float32Array(nx * nz), maxTop: top };
  const put = (i, j, b, t) => {                                    // the union of what stands over a cell (gaps filled)
    const k = j * nx + i;
    if (g.top[k] <= 0) { g.bot[k] = b; g.top[k] = t; } else { g.bot[k] = Math.min(g.bot[k], b); g.top[k] = Math.max(g.top[k], t); }
  };
  for (const p of prisms) {
    const n = p.pts.length, m = p.closed ? n : n - 1, h = p.D / 2, b = p.y0 < 0.5 ? 0 : p.y0;
    const cover = (test, bx0, bz0, bx1, bz1) => {
      const i0 = Math.max(0, Math.floor((bx0 - x0) / c)), i1 = Math.min(nx - 1, Math.floor((bx1 - x0) / c));
      const j0 = Math.max(0, Math.floor((bz0 - z0) / c)), j1 = Math.min(nz - 1, Math.floor((bz1 - z0) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (test(x0 + (i + 0.5) * c, z0 + (j + 0.5) * c)) put(i, j, b, p.y1);
    };
    p.cover = cover;
    for (let s = 0; s < m; s++) {                                  // each wall segment's strip
      const A = p.pts[s], B = p.pts[(s + 1) % n], dx = B[0] - A[0], dz = B[1] - A[1], len = Math.hypot(dx, dz); if (len < 1e-6) continue;
      const ux = dx / len, uz = dz / len;
      cover((x, z) => { const t = (x - A[0]) * ux + (z - A[1]) * uz, o = -(x - A[0]) * uz + (z - A[1]) * ux; return t >= 0 && t <= len && Math.abs(o) <= h; },
        Math.min(A[0], B[0]) - h, Math.min(A[1], B[1]) - h, Math.max(A[0], B[0]) + h, Math.max(A[1], B[1]) + h);
    }
    for (let s = p.closed ? 0 : 1; s < (p.closed ? n : n - 1); s++) {   // and round the bends (no wedge gaps on curves)
      const V = p.pts[s]; cover((x, z) => Math.hypot(x - V[0], z - V[1]) <= h, V[0] - h, V[1] - h, V[0] + h, V[1] + h);
    }
  }
  for (const p of prisms) for (const H of p.holes || []) {          // then the holes (after every block is in: no block fills them)
    const cs = [H.a, ...[[H.s0, H.w0], [H.s1, H.w0], [H.s0, H.w1], [H.s1, H.w1]].map(([s1, w]) => [H.a[0] + H.u[0] * s1 + H.lf[0] * w, H.a[1] + H.u[1] * s1 + H.lf[1] * w])].slice(1);
    const xs = cs.map((q) => q[0]), zs = cs.map((q) => q[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / c)), i1 = Math.min(nx - 1, Math.floor((Math.max(...xs) - x0) / c));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / c)), j1 = Math.min(nz - 1, Math.floor((Math.max(...zs) - z0) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + (i + 0.5) * c - H.a[0], z = z0 + (j + 0.5) * c - H.a[1], s1 = x * H.u[0] + z * H.u[1], w = x * H.lf[0] + z * H.lf[1];
      if (s1 < H.s0 || s1 > H.s1 || w < H.w0 || w > H.w1) continue;
      const k = j * nx + i; if (!(g.top[k] > H.y0)) continue;
      if (g.g1[k] > g.g0[k] && H.y0 <= g.g1[k] && H.y1 >= g.g0[k]) { g.g0[k] = Math.min(g.g0[k], H.y0); g.g1[k] = Math.max(g.g1[k], H.y1); }
      else if (!(g.g1[k] > g.g0[k]) || H.y1 - H.y0 > g.g1[k] - g.g0[k]) { g.g0[k] = H.y0; g.g1[k] = Math.min(H.y1, g.top[k]); }
      if (g.g1[k] >= g.top[k] - 0.01) { g.top[k] = g.g0[k]; g.g0[k] = g.g1[k] = 0; }   // (dug out to the top: just lower)
      if (g.g0[k] <= g.bot[k] + 0.01 && g.g1[k] > g.g0[k]) { g.bot[k] = g.g1[k]; g.g0[k] = g.g1[k] = 0; }   // (dug from the bottom: starts higher)
    }
  }
  return g;
}
export function cellAt(g, i, j) { if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return [0, 0]; const k = j * g.nx + i; return [g.bot[k], g.top[k]]; }
// the solid over a cell as one or two ranges (two where a hole goes through), [] for none
export function partsAt(g, i, j) {
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return []; const k = j * g.nx + i, b = g.bot[k], t = g.top[k];
  if (!(t > 0)) return []; return g.g1[k] > g.g0[k] ? [[b, g.g0[k]], [g.g1[k], t]] : [[b, t]];
}
const at = (g, x, z) => cellAt(g, Math.floor((x - g.x0) / g.c), Math.floor((z - g.z0) / g.c));
const partsXZ = (g, x, z) => partsAt(g, Math.floor((x - g.x0) / g.c), Math.floor((z - g.z0) / g.c));

// adding a shaded range [l, h] to the (at most) two kept, [L1, H1, L2, H2] (NONE for an empty slot, the lower first):
// ranges that touch become one; three apart -> the two nearest each other become one
export function addRange(S, l, h) {
  const I = []; if (S[1] > NONE) I.push([S[0], S[1]]); if (S[3] > NONE) I.push([S[2], S[3]]); I.push([l, h]);
  I.sort((a, b) => a[0] - b[0]);
  for (let k = 0; k + 1 < I.length; ) { if (I[k + 1][0] <= I[k][1] + 0.5) { I[k] = [I[k][0], Math.max(I[k][1], I[k + 1][1])]; I.splice(k + 1, 1); } else k++; }
  if (I.length === 3) { const k = I[1][0] - I[0][1] <= I[2][0] - I[1][1] ? 0 : 1; I[k] = [I[k][0], I[k + 1][1]]; I.splice(k + 1, 1); }
  return [I[0][0], I[0][1], I.length > 1 ? I[1][0] : NONE, I.length > 1 ? I[1][1] : NONE];
}
// the heights shaded at cell (i, j): [L1, H1, L2, H2]. Steps toward the sun, a cell at a time near by, longer far away
// (at most 6 m: no 12 m block is stepped over), as far as the tallest block can throw a shadow
export function shadowCell(g, i, j) {
  const px = g.x0 + (i + 0.5) * g.c, pz = g.z0 + (j + 0.5) * g.c, maxD = g.maxTop / TAN_E + g.c;
  let S = [NONE, NONE, NONE, NONE], s = 0;
  for (let k = 0; k < 600; k++) {
    s += Math.max(g.c, Math.min(6, s * 0.02)); if (s > maxD) break;
    const qi = Math.floor((px + SUN_XZ[0] * s - g.x0) / g.c), qj = Math.floor((pz + SUN_XZ[1] * s - g.z0) / g.c);
    if (qi < 0 || qj < 0 || qi >= g.nx || qj >= g.nz) break;
    for (const [b, t] of partsAt(g, qi, qj)) { const l = b - s * TAN_E, h = t - s * TAN_E; if (h >= -1) S = addRange(S, l, h); }
  }
  return S;
}
// how much sun reaches height y over a spot of the cell (0 .. 1, soft over 0.8 m)
const shadeIn = (l, h, y) => (1 - smooth(h - 0.4, h + 0.4, y)) * smooth(l - 0.4, l + 0.4, y);
export const sunIn = (S, y) => 1 - Math.max(shadeIn(S[0], S[1], y), S[3] > NONE ? shadeIn(S[2], S[3], y) : 0);
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
// the sun at a point: the shadow map looked up a little in front of a wall (so it does not shade itself), the height
// corrected for that step. (The shaders blur it over a disc of 12 spots instead of these 4 neighbours: softer edges)
export function sunAt(g, shadow, x, y, z, nx = 0, nz = 0) {
  const off = 1.5 * g.c, sx = x + nx * off, sz = z + nz * off, ys = y + (nx * SUN_XZ[0] + nz * SUN_XZ[1]) * off * TAN_E + 0.2;
  const gx = (sx - g.x0) / g.c - 0.5, gz = (sz - g.z0) / g.c - 0.5, i0 = Math.floor(gx), j0 = Math.floor(gz), fx = gx - i0, fz = gz - j0;
  let v = 0;
  for (const [di, dj, w] of [[0, 0, (1 - fx) * (1 - fz)], [1, 0, fx * (1 - fz)], [0, 1, (1 - fx) * fz], [1, 1, fx * fz]]) {
    const i = i0 + di, j = j0 + dj, S = i < 0 || j < 0 || i >= g.nx || j >= g.nz ? [NONE, NONE, NONE, NONE] : shadow(i, j); v += w * sunIn(S, ys);
  }
  return v;
}

// the light of an even sky over a slice of it from elevation a up: on a roof (cos^2 a), on a wall facing the slice
// (normalised so the open sky gives 1)
const upFrom = (a) => Math.cos(a) ** 2;
const wallFrom = (a) => (Math.PI / 4 - a / 2 - Math.sin(2 * a) / 4) / (Math.PI / 4);
// the sky from height y over (x, z): { up, walls: [+x, -x, +z, -z] }. Steps that start inside a block (a spot in a
// wall) only count once out of it, so the block itself does not hide the sky. Something overhead (a bridge) hides a
// band of the sky, from the lowest angle it is seen at to the highest (straight up when the spot is under it): the
// samples under one overhang in a row make one band
export function skyFrom(g, x, y, z) {
  const ups = [], wls = [];
  const P0 = partsXZ(g, x, z), inside0 = P0.some(([b, t]) => b <= y && y <= t), roof0 = !inside0 && P0.some(([b]) => b > y);
  for (let d = 0; d < DIRS; d++) {
    const a = (d / DIRS) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let hz = 0, oUp = 0, oWall = 0, s = g.c, out = !inside0, lo = roof0 ? Math.PI / 2 : 0, hi = roof0 ? Math.PI / 2 : -1;   // hi < 0: no band going
    const close = () => { if (hi < 0) return; if (lo <= hz) hz = Math.max(hz, hi); else { oUp = Math.max(oUp, upFrom(lo) - upFrom(hi)); oWall = Math.max(oWall, wallFrom(lo) - wallFrom(hi)); } hi = -1; };
    for (let k = 0; k < SKY_STEPS; k++, s *= SKY_GROW) {
      const P = partsXZ(g, x + dx * s, z + dz * s);
      const solid = P.some(([b, t]) => b <= y && y <= t);
      if (!out) { if (!solid) out = true; else continue; }
      if (!P.some(([, t]) => t > y)) { close(); continue; }
      for (const [b, t] of P) {                                    // (the part below a hole, then the one above it)
        if (t <= y) continue;
        const a2 = Math.atan((t - y) / s);
        if (b <= y) { close(); hz = Math.max(hz, a2); }
        else { const a1 = Math.atan((b - y) / s); if (hi < 0) { lo = a1; hi = a2; } else { lo = Math.min(lo, a1); hi = Math.max(hi, a2); } }
      }
    }
    close();
    ups.push(Math.max(0, upFrom(hz) - oUp)); wls.push(Math.max(0, wallFrom(hz) - oWall));
  }
  const up = ups.reduce((s1, v) => s1 + v, 0) / DIRS;
  const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([nx, nz]) => {
    let s1 = 0, w = 0;
    for (let d = 0; d < DIRS; d++) { const a = (d / DIRS) * Math.PI * 2, k = Math.max(0, Math.cos(a) * nx + Math.sin(a) * nz); s1 += k * wls[d]; w += k; }
    return s1 / w;
  });
  return { up, walls };
}
// where a cell's layers start: the roof on it, or its ground under a bridge, or the floor of a hole through it
export const baseOf = (b, t, g0 = 0, g1 = 0) => (g1 > g0 ? g0 : b > 0.5 ? 0 : t);
// a height above a cell's base -> where it falls among the LAYERS (a fraction: 2.5 is half way from the 3rd to the 4th)
export function layerPos(h) {
  if (h <= 0) return 0;
  for (let k = 1; k < LAYERS.length; k++) if (h < LAYERS[k]) return k - 1 + (h - LAYERS[k - 1]) / (LAYERS[k] - LAYERS[k - 1]);
  return LAYERS.length - 1;
}
// the light of the sky on a surface facing n at a point, from the four wall directions and up (as the shaders mix them);
// a face looking down gets the light off the ground below, ground = [sun, sky] on it (in the open [1, 1]: 0.6)
export function skyMix(s, n, ground = [1, 1]) {
  const w = [Math.max(n[0], 0), Math.max(-n[0], 0), Math.max(n[2], 0), Math.max(-n[2], 0)], ws = w[0] + w[1] + w[2] + w[3];
  const wall = ws > 1e-3 ? (w[0] * s.walls[0] + w[1] * s.walls[1] + w[2] * s.walls[2] + w[3] * s.walls[3]) / ws : s.up;
  const a = Math.max(n[1], 0), b = Math.hypot(n[0], n[2]), d = Math.max(-n[1], 0);
  return (a * s.up + b * wall + d * 0.6 * (0.6 * ground[1] + 0.4 * ground[0])) / Math.max(a + b + d, 1e-6);
}

// aerial perspective: the haze per colour channel, blue faster than red (air scatters blue the most), so things in the
// middle distance turn bluish; close by none, far off all of it, as before. f: the haze's amount (0 .. 1) -> per channel
export const AERIAL = [0.8, 0.95, 1.3];
export const aerial = (f, k = AERIAL) => k.map((e) => 1 - Math.pow(1 - Math.max(0, Math.min(1, f)), e));
