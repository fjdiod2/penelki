// Procedural forest, second pass: built to be dense the way the real edge is.
//   - an edge "mantle" of young trees and shrubs with leaves from the ground up closes the view at eye level;
//   - trees get taller row by row going back, conifers mostly at the rear;
//   - every crown has a dark core inside the lighter leaf cards, so it is not see-through;
//   - cheap thin "pole" stems fill the stand (about one stem per 2-3 m2 where the stand is of that kind);
//   - everything darkens with depth, and a near-black curtain plus crown silhouettes close the back.
// Trees are grown from species recipes and seeds; placement comes from hashing the position, so a place always
// looks the same and no two places match. Slow noise along the line changes the kind of stand.
// Coordinates: x along the track, y up (rail level 0), +z to the right of travel.
import * as THREE from "three";

const round = (p) => (t) => Math.pow(Math.sin(Math.PI * (0.1 + 0.85 * t)), p);
export const PARAMS = {
  chunk: 100, depth: 20,
  edge: { right: 15, left: 24, wander: 4 },          // distance of the forest edge from the track, and how much it wanders
  variants: 8,
  order: true,                                       // draw near things before far things
  cull: true,                                        // skip what is outside the view
  photos: true,                                      // leaf and bark photo textures (false = the drawn stand-ins)
  force: null,                                       // { dens, mantle } to pin the stand for testing; null = let the noise decide
  bogPines: 2.5,
  // hooks for running inside the simulator (all optional; the test page leaves them unset)
  ground: true,                                      // build the generator's own ground mesh (the simulator draws its own terrain)
  landAt: null,                                      // (x, z) -> { forest, open, built, bog, reed, flood } from the landscape map (0..1), or null where nothing is mapped
  mapXZ: null,                                       // (x, z) -> [mx, mz]: where a spot lies on the map, so pools line up with the ground shader
  blockAt: null,                                     // (x, z, r) -> true where nothing may grow (roads, rivers)
  fog: [150, 650],                                      // how many pines stand on a raised bog (1 = the default amount)
  species: {
    //        height     trunk radius   crown starts   branches     branch length   angle up     droop  cards/branch  card size      leaf colour          atlas tile, crown shape, trunk detail, dark core
    birch:  { h: [12, 19], r: [0.13, 0.21], crown0: [0.3, 0.45], nBr: [14, 19], len: [2.2, 3.6], elev: [15, 50], droop: 0.35, cards: [2, 3], size: [2.0, 2.9], col: [0.36, 0.52, 0.18], tile: 0, shape: round(0.7), sides: 4, seg: 4, core: 0.8 },
    spruce: { h: [15, 26], r: [0.14, 0.22], crown0: [0.06, 0.16], nBr: [26, 34], len: [3.3, 4.6], elev: [-22, 0], droop: 0.22, cards: [2, 3], size: [2.3, 3.1], taper: 1, col: [0.10, 0.21, 0.14], tile: 2, shape: (t) => Math.pow(1 - t, 0.85) + 0.05, sides: 4, seg: 4, core: 1.0 },
    pine:   { h: [18, 26], r: [0.16, 0.24], crown0: [0.6, 0.72], nBr: [9, 13], len: [2.4, 3.8], elev: [5, 45], droop: 0.05, cards: [3, 4], size: [2.2, 3.2], col: [0.16, 0.30, 0.18], tile: 2, shape: round(0.6), sides: 4, seg: 4, core: 0.8 },
    alder:  { h: [8, 13], r: [0.10, 0.16], crown0: [0.15, 0.3], nBr: [13, 18], len: [1.9, 3.1], elev: [20, 60], droop: 0.1, cards: [2, 3], size: [2.0, 2.8], col: [0.20, 0.38, 0.15], tile: 0, shape: round(0.55), sides: 4, seg: 3, core: 0.9 },
    young:  { h: [5, 9], r: [0.05, 0.085], crown0: [0.03, 0.12], nBr: [13, 17], len: [1.3, 2.2], elev: [25, 60], droop: 0.12, cards: [2, 3], size: [1.6, 2.3], col: [0.34, 0.52, 0.19], tile: 0, shape: round(0.45), sides: 3, seg: 3, core: 1.0 },
    willow: { h: [3, 5.5], r: [0.04, 0.06], crown0: [0.0, 0.06], nBr: [12, 16], len: [1.6, 2.6], elev: [15, 55], droop: 0.1, cards: [2, 3], size: [1.6, 2.2], col: [0.33, 0.45, 0.27], tile: 0, shape: round(0.4), sides: 3, seg: 2, core: 1.1 },
    bush:   { h: [1.8, 3.4], r: [0.03, 0.05], crown0: [0.0, 0.05], nBr: [13, 18], len: [1.5, 2.5], elev: [8, 50], droop: 0.08, cards: [2, 3], size: [1.5, 2.1], col: [0.30, 0.44, 0.22], tile: 0, shape: round(0.3), sides: 3, seg: 2, core: 1.3 },
    snag:      { h: [5, 13], r: [0.06, 0.14], crown0: [0.45, 0.9], nBr: [0, 3], len: [0.4, 1.2], elev: [10, 60], droop: 0.1, cards: [0, 0], size: [1, 1], col: [0, 0, 0], tile: 0, shape: () => 1, sides: 3, seg: 2, core: 0, dead: true },
    snagcrown: { h: [6, 12], r: [0.06, 0.11], crown0: [0.35, 0.6], nBr: [5, 9], len: [0.8, 2.1], elev: [15, 65], droop: 0.25, cards: [0, 0], size: [1, 1], col: [0, 0, 0], tile: 0, shape: () => 1, sides: 3, seg: 3, core: 0, dead: true },
    stump:     { h: [0.5, 2.4], r: [0.08, 0.15], crown0: [0.5, 0.9], nBr: [0, 1], len: [0.3, 0.6], elev: [10, 50], droop: 0, cards: [0, 0], size: [1, 1], col: [0, 0, 0], tile: 0, shape: () => 1, sides: 4, seg: 1, core: 0, dead: true },
    pole:   { h: [6.5, 11], r: [0.05, 0.09], crown0: [0.45, 0.65], nBr: [5, 7], len: [1.1, 1.9], elev: [20, 60], droop: 0.1, cards: [1, 2], size: [1.5, 2.1], col: [0.36, 0.52, 0.18], tile: 0, shape: round(0.6), sides: 3, seg: 2, core: 0 },
    // raised bog: stunted, crooked, sparse little pines and their dead grey cousins
    bogpine: { h: [3, 9], r: [0.05, 0.11], crown0: [0.25, 0.45], nBr: [12, 18], len: [0.8, 1.8], elev: [0, 35], droop: 0.1, cards: [2, 3], size: [0.9, 1.4], col: [0.18, 0.31, 0.18], tile: 2, shape: round(0.6), sides: 3, seg: 3, core: 0.7 },
    bogsnag: { h: [2.0, 5.0], r: [0.03, 0.07], crown0: [0.3, 0.6], nBr: [3, 6], len: [0.3, 0.9], elev: [5, 50], droop: 0.1, cards: [0, 0], size: [1, 1], col: [0, 0, 0], tile: 0, shape: () => 1, sides: 3, seg: 3, core: 0, dead: true },
  },
};

// ---- randomness
export function hash(i, j, k) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const rngFrom = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export function noise(x, k) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i, k, 7) * (1 - u) + hash(i + 1, k, 7) * u; }

// ---- one tree, in its own coordinates (base at the origin)
export function makeTree(name, seed) {                // exported for the sandbox's tree brush
  const S = PARAMS.species[name], rnd = rngFrom(seed), R = (a) => a[0] + (a[1] - a[0]) * rnd();
  const H = R(S.h), r0 = R(S.r), c0 = R(S.crown0) * H, lean = (rnd() - 0.5) * (S.dead ? 0.4 : S.crook ? 0.3 : 0.14), bendA = rnd() * 6.28, bend = (rnd() - 0.5) * H * (S.crook ? 0.3 : 0.08);
  const tp = [], tc = [], tu = [], ti = [], fp = [], fc = [], fu = [], fi = [];
  const axis = (y) => { const b = Math.sin((y / H) * Math.PI) * bend; return [lean * y + Math.cos(bendA) * b, y, Math.sin(bendA) * b]; };
  // bark comes from a photo atlas (left strip white birch, right strip rough dark bark); these are tints over it
  const pale = name === "birch" || name === "young" || name === "pole", strip = S.dead ? 4 : pale ? 0 : name === "spruce" ? 2 : name === "pine" || name === "bogpine" ? 3 : 1, grey = 0.85 + rnd() * 0.4, bark = (yf) => {
    if (S.dead) return yf < 0.1 ? [0.6, 0.57, 0.5] : [grey, grey * 0.98, grey * 0.93];          // bleached dead wood, dark and wet at the foot
    if (pale) return yf < 0.12 ? [0.6, 0.58, 0.54] : [1, 1, 0.97];
    if (name === "pine" || name === "bogpine") return yf > 0.45 ? [1.35, 0.95, 0.68] : [0.9, 0.86, 0.8];
    return name === "spruce" ? [0.95, 0.92, 0.88] : [0.9, 0.9, 0.82];
  };
  for (let s = 0; s <= S.seg; s++) {                 // trunk: a tapered tube; the seam column is doubled so the bark wraps
    const yf = s / S.seg, [ax, ay, az] = axis(yf * H), rad = r0 * (1 - (S.dead ? 0.5 : 0.8) * yf), b = bark(yf), W1 = S.sides + 1;
    for (let k = 0; k <= S.sides; k++) { const a = (k / S.sides) * 6.283, sh = 0.6 + 0.4 * Math.cos(a - 0.8); tp.push(ax + Math.cos(a) * rad, ay, az + Math.sin(a) * rad); tc.push(b[0] * sh, b[1] * sh, b[2] * sh); tu.push((strip + 0.03 + 0.94 * k / S.sides) / 5, (yf * H) / 2.4); }
    if (s < S.seg) for (let k = 0; k < S.sides; k++) { const a = s * W1 + k; ti.push(a, a + 1, a + 1 + W1, a, a + 1 + W1, a + W1); }
  }
  const tint = [0.86 + rnd() * 0.28, 0.9 + rnd() * 0.2, 0.8 + rnd() * 0.3];
  const REF = S.tile === 0 ? [0.36, 0.52, 0.18] : [0.10, 0.21, 0.14], lc = PARAMS.photos ? S.col.map((v, i) => (S.tile === 0 ? 1.45 : 1.6) * Math.pow(v / REF[i], 0.45)) : S.col;   // photos keep their own colour; species only shift it
  function card(cx, cy, cz, w, h, shade, upright) {  // a leaf-cluster card; upright ones stand through the trunk axis
    const a = rnd() * 6.283, t = upright ? (rnd() - 0.5) * 0.25 : (rnd() - 0.5) * 1.3, ux = Math.cos(a), uz = Math.sin(a), vx = -Math.sin(a) * Math.sin(t), vy = Math.cos(t), vz = Math.cos(a) * Math.sin(t);
    const k = fp.length / 3, tile = S.tile + (rnd() < 0.5 ? 0 : 1), u0 = (tile % 2) * 0.5, v0 = tile < 2 ? 0.5 : 0;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      fp.push(cx + (ux * su * w + vx * sv * h) / 2, cy + (vy * sv * h) / 2, cz + (uz * su * w + vz * sv * h) / 2); fu.push(u0 + (su > 0 ? 0.5 : 0), v0 + (sv > 0 ? 0.5 : 0));
      const sh = shade * (0.9 + 0.12 * sv) * (0.88 + rnd() * 0.24); fc.push(lc[0] * tint[0] * sh, lc[1] * tint[1] * sh, lc[2] * tint[2] * sh);
    }
    fi.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const nBr = Math.round(R(S.nBr)), Lmax = R(S.len), golden = 2.39996, crownH = H - c0;
  if (S.core) for (let i = 0; i < 3; i++) {           // dark core: upright cards through the crown, so you cannot see through it
    const yc = c0 + crownH * (0.3 + 0.22 * i), [ax, , az] = axis(yc); card(ax, yc - (S.taper ? crownH * 0.12 : 0), az, Lmax * 1.5 * S.core * S.shape(0.3 + 0.2 * i) * (S.taper ? 0.8 : 1), crownH * (S.taper ? 0.5 : 0.62), 0.34, true);
  }
  for (let i = 0; i < nBr; i++) {
    const t = (i + rnd() * 0.8) / nBr, y = c0 + t * crownH * 0.96, L = Lmax * S.shape(t) * (0.65 + rnd() * 0.6), az = i * golden + rnd() * 0.9, el = (R(S.elev) * Math.PI) / 180;
    const [sx, sy, sz] = axis(y), ex = sx + Math.cos(az) * Math.cos(el) * L, ey = sy + Math.sin(el) * L - S.droop * L, ez = sz + Math.sin(az) * Math.cos(el) * L;
    const k = tp.length / 3, w = 0.03 + r0 * 0.18 * (1 - t), b = bark(0.9);
    tp.push(sx, sy - w, sz, sx, sy + w, sz, ex, ey + w * 0.3, ez, ex, ey - w * 0.3, ez); for (let q = 0; q < 4; q++) { tc.push(b[0] * 0.5, b[1] * 0.5, b[2] * 0.5); tu.push((S.dead ? 0.9 : 0.3) + (q % 2) * 0.01, q > 1 ? L / 2.4 : 0); } ti.push(k, k + 1, k + 2, k, k + 2, k + 3);
    const m = Math.round(R(S.cards));
    for (let c = 1; c <= m; c++) {
      const f = 0.3 + (0.75 * c) / m, j = L * 0.12, s = R(S.size) * (S.taper ? 0.22 + 0.85 * S.shape(t) : 0.6 + 0.5 * S.shape(t)), py = sy + (ey - sy) * f + (rnd() - 0.5) * j;
      card(sx + (ex - sx) * f + (rnd() - 0.5) * j, py, sz + (ez - sz) * f + (rnd() - 0.5) * j, s, s, (0.55 + 0.45 * Math.min(1, Math.max(0, (py - c0) / crownH))) * (0.72 + 0.28 * f), false);
    }
  }
  if (S.dead) return { H, tp: new Float32Array(tp), tc: new Float32Array(tc), tu: new Float32Array(tu), ti, fp: new Float32Array(0), fc: new Float32Array(0), fu: new Float32Array(0), fi: [] };
  const top = axis(H), ts = R(S.size) * (S.taper ? 0.35 : 1); card(top[0], H - 0.3, top[2], ts * 0.7, ts * 0.7, 1, false); card(top[0], H - 1.1, top[2], ts * 0.85, ts * 0.85, 0.9, false);
  return { H, tp: new Float32Array(tp), tc: new Float32Array(tc), tu: new Float32Array(tu), ti, fp: new Float32Array(fp), fc: new Float32Array(fc), fu: new Float32Array(fu), fi };
}

// ---- textures drawn in code for now (photos of leaf clusters and bark can replace them later)
function leafAtlas() {                                // 2x2 tiles: top row broadleaf clusters, bottom row needle sprays
  const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d"), rnd = rngFrom(11);
  for (let t = 0; t < 4; t++) {
    const ox = (t % 2) * 256, oy = t < 2 ? 0 : 256; g.save(); g.beginPath(); g.rect(ox, oy, 256, 256); g.clip();
    for (let i = 0; i < (t < 2 ? 300 : 420); i++) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.55) * 116, x = ox + 128 + Math.cos(a) * d, y = oy + 128 + Math.sin(a) * d * 0.95, v = 120 + rnd() * 135;
      g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      if (t < 2) { g.beginPath(); g.ellipse(x, y, 7 + rnd() * 9, 4 + rnd() * 6, rnd() * 3.14, 0, 6.283); g.fill(); }
      else { g.strokeStyle = g.fillStyle; g.lineWidth = 3; const b = rnd() * 6.283, l = 14 + rnd() * 18; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l); g.stroke(); }
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}
function backdropAtlas() {                            // 8 crown silhouettes 128 px wide: 0-4 rounded, 5-7 pointed
  const c = document.createElement("canvas"); c.width = 1024; c.height = 256; const g = c.getContext("2d"), rnd = rngFrom(23);
  for (let t = 0; t < 8; t++) {
    const ox = t * 128; g.save(); g.beginPath(); g.rect(ox, 0, 128, 256); g.clip();
    const blob = (x, y, rx, ry) => { const v = 150 + rnd() * 90; g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 6.283); g.fill(); };
    if (t < 5) { const top = 30 + rnd() * 50; for (let i = 0; i < 220; i++) { const y = top + Math.pow(rnd(), 0.8) * (256 - top), wd = 20 + 44 * Math.min(1, (y - top) / 70); blob(ox + 64 + (rnd() - 0.5) * 2 * wd, y, 7 + rnd() * 9, 5 + rnd() * 7); } }
    else { const top = 8 + rnd() * 30; for (let i = 0; i < 260; i++) { const y = top + rnd() * (256 - top), wd = 4 + 52 * ((y - top) / (256 - top)); blob(ox + 64 + (rnd() - 0.5) * 2 * wd, y, 7 + rnd() * 8, 3 + rnd() * 5); } }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// ---- the forest: builds one chunk of trees and backdrop for a stretch of track
export function createForest() {
  const P = PARAMS, names = Object.keys(P.species), pool = {};
  const E = new Float32Array(0), crossTree = (seed) => { const rnd = rngFrom(seed), S = P.species.spruce; return { cross: true, H: S.h[0] + (S.h[1] - S.h[0]) * rnd(), tile: 4 + Math.floor(rnd() * 4), flip: rnd() < 0.5, tp: E, tc: E, tu: E, ti: [], fp: E, fc: E, fu: E, fi: [] }; };
  for (const n of names) pool[n] = [...Array(P.variants)].map((_, i) => (n === "spruce" && P.photos ? crossTree(2000 + i * 17) : makeTree(n, 1000 * (names.indexOf(n) + 1) + i * 17)));
  const TL = new THREE.TextureLoader(), photo = (u) => { const t = TL.load("./assets/forest/" + u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const barkTex = photo("bark_atlas.jpg"); barkTex.wrapT = THREE.RepeatWrapping;
  const leafMat = new THREE.MeshBasicMaterial({ map: P.photos ? photo("leaf_atlas.png") : leafAtlas(), vertexColors: true, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide });
  const barkMat = new THREE.MeshBasicMaterial({ map: P.photos ? barkTex : null, vertexColors: true, side: THREE.DoubleSide });
  const backMat = new THREE.MeshBasicMaterial({ map: P.photos ? photo("backdrop.png") : backdropAtlas(), vertexColors: true, alphaTest: 0.34, alphaToCoverage: true, side: THREE.DoubleSide });
  // ground: four tiling photo textures blended by weights stored on the mesh (x = leaf litter, y = hay field, z = gravel; the rest is grass)
  const gtex = (u) => { const t = photo(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  const ground = { camPos: { value: new THREE.Vector3() } };
  // The photo tiles are flattened (nothing in them broader than a tuft), so they can repeat without banding. The natural
  // unevenness of real ground is put back in the shader by "vary": smooth noise worked out from the position on the map
  // by formula. There is no stored image behind it, so it has no tile and never repeats.
  // Ground shader, written to do as little as possible per pixel:
  //   - a layer's photo is only read where that layer is actually present;
  //   - beyond about 100 m, where blades cannot be seen, each layer is one read of its smallest version (a single
  //     averaged colour, so no repeating pattern can show);
  //   - close up, grass and hay field use stochastic tiling (three reads), so the photo has no repeat distance.
  // One ground material for the test page and the simulator. Per vertex: w = (leaf litter, hay field, gravel), m = slow
  // brightness drift, b = (raised bog, reeds, flooded forest), cor = (metres along the chunk, metres left of the track).
  // opts.mapLocal: pattern coordinates are the mesh's own coordinates (the simulator moves the map under the train);
  // opts.roads: road masks painted per chunk (see world.js).
  function makeGroundMaterial(opts = {}) {
    const R = opts.roads, u = { tGrass: { value: GT.grass }, tField: { value: GT.field }, tLitter: { value: GT.litter }, tGravel: { value: GT.gravel }, tMoss: { value: GT.moss },
      camPos: ground.camPos, fogC: { value: opts.fogC || new THREE.Color(0xc7d2da) }, fogR: { value: new THREE.Vector2(...P.fog) } };
    if (R) Object.assign(u, { maskNear: { value: R.maskNear }, maskFar: { value: R.maskFar }, tAsphalt: { value: R.tAsphalt }, tDirt: { value: R.tDirt }, roadK: { value: new THREE.Vector4(R.len, R.near, R.half, 0) }, roadTile: { value: new THREE.Vector2(R.asphaltTile, R.dirtTile) } });
    const m = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: u, defines: Object.assign({}, R ? { ROADS: 1 } : {}, opts.mapLocal ? { MAPLOCAL: 1 } : {}),
      vertexShader: `attribute vec3 w; attribute float m; attribute vec3 b; attribute vec2 cor; attribute float fl; varying vec3 vW; varying vec2 vP; varying vec3 vWt; varying float vMac; varying vec3 vB; varying vec2 vCor; varying float vFl;
        void main() { vWt = w; vMac = m; vB = b; vCor = cor; vFl = fl; vec4 p = modelMatrix * vec4(position, 1.0); vW = p.xyz;
#ifdef MAPLOCAL
          vP = position.xz;
#else
          vP = p.xz;
#endif
          gl_Position = projectionMatrix * viewMatrix * p; }`,
      fragmentShader: `uniform sampler2D tGrass; uniform sampler2D tField; uniform sampler2D tLitter; uniform sampler2D tGravel; uniform sampler2D tMoss; uniform vec3 camPos; uniform vec3 fogC; uniform vec2 fogR; varying vec3 vW; varying vec2 vP; varying vec3 vWt; varying float vMac; varying vec3 vB; varying vec2 vCor; varying float vFl;
#ifdef ROADS
      uniform sampler2D maskNear; uniform sampler2D maskFar; uniform sampler2D tAsphalt; uniform sampler2D tDirt; uniform vec4 roadK;   // chunk length, near half-width, far half-width, -
      uniform vec2 roadTile;
#endif
      float h2(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }      // a repeatable pseudo-random number for a grid corner
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);                                              // smooth blend between the four corners around p
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      // Stochastic (hex) tiling: the ground is cut into a triangle grid; every grid point shows the photo shifted by its own
      // random amount, and each pixel blends the three nearest. The photo never lines up with itself, so it has no repeat.
      // Blending three samples would wash out the detail, so the result is stretched back around the photo's average colour.
      vec3 stoch(sampler2D t, vec2 uv, vec2 dx, vec2 dy, vec3 mean) {
        vec2 sk = vec2(uv.x, -0.57735027 * uv.x + 1.15470054 * uv.y) * 3.464, b = floor(sk), f = fract(sk); float z = 1.0 - f.x - f.y, w1, w2, w3; vec2 v1, v2, v3;
        if (z > 0.0) { w1 = z; w2 = f.y; w3 = f.x; v1 = b; v2 = b + vec2(0.0, 1.0); v3 = b + vec2(1.0, 0.0); }
        else { w1 = -z; w2 = 1.0 - f.y; w3 = 1.0 - f.x; v1 = b + vec2(1.0, 1.0); v2 = b + vec2(1.0, 0.0); v3 = b + vec2(0.0, 1.0); }
        vec3 c = w1 * (textureGrad(t, uv + vec2(h2(v1), h2(v1 + 17.3)), dx, dy).rgb - mean) + w2 * (textureGrad(t, uv + vec2(h2(v2), h2(v2 + 17.3)), dx, dy).rgb - mean)
               + w3 * (textureGrad(t, uv + vec2(h2(v3), h2(v3 + 17.3)), dx, dy).rgb - mean);
        return max(mean + c / sqrt(w1 * w1 + w2 * w2 + w3 * w3), 0.0);
      }
      // Raised-bog pools: one chance of a pool per 13 m cell, an ellipse lying along a direction shared by the
      // neighbourhood (so they line up in rows), with a wobbly edge. Returns metres inside the nearest pool
      // (negative outside). The same function is in JS (poolAt) so trees keep out of the water.
      // sc scales the whole pattern (1 = bog pools, larger = open water among reeds); off moves to an unrelated layout.
      float poolS(vec2 pw, float bog, float td, float sc, vec2 off) {      // td: distance from the track
        float amt = smoothstep(0.55, 0.95, bog) * smoothstep(10.0, 22.0, td); if (amt < 0.01) return -9.0;      // shrink away near the track and toward the bog's edge
        vec2 p = pw / sc + off;
        float ang = vn(p / 260.0 + 4.1) * 3.0, best = -9.0; vec2 g = floor(p / 13.0);
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) { vec2 id = g + vec2(float(i), float(j));
          float pd = smoothstep(0.25, 0.75, vn((id + 0.5) * 13.0 / 220.0 + 13.3));      // how pooled this part of the bog is: from a few small pools to a crowd of large ones
          if (h2(id + 5.1) > 0.1 + 0.75 * pd) continue;
          vec2 c = (id + 0.2 + 0.6 * vec2(h2(id + 1.3), h2(id + 3.7))) * 13.0, d = p - c;
          float a = ang + (h2(id + 2.2) - 0.5) * 0.7, k = 1.0 + 1.5 * h2(id + 7.7), R = 13.0 * (0.05 + 0.2 * pow(h2(id + 11.1), 2.0)) * amt * (0.7 + 0.6 * pd);
          d = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y); best = max(best, R - length(vec2(d.x / k, d.y)));
        }
        return (best + (vn(p / 1.9 + 5.5) - 0.5) * 0.8 * amt) * sc;
      }
      vec3 layer(sampler2D t, vec2 uv, vec2 dx, vec2 dy, float near) {            // far: smallest version only; near: the real photo
        vec3 far = textureLod(t, uv, 9.0).rgb; if (near < 0.002) return far;
        return mix(far, textureGrad(t, uv, dx, dy).rgb, near);
      }
      void main() {
        vec2 p = vP, dx = dFdx(p), dy = dFdy(p); float td = abs(vCor.y); float dist = length(camPos - vW), near = 1.0 - smoothstep(45.0, 110.0, dist);
        float broad = vn(p / 34.0), mid = vn(p / 9.0 + 7.3), fine = vn(p / 2.1 + 3.1);                       // patches tens of metres across, a few metres, and under a metre
        float mac = 0.16 + (broad - 0.5) * 0.12 + (mid - 0.5) * 0.08 + (fine - 0.5) * 0.05, mac2 = vMac, rag = (mac - 0.16) * 2.2;
        float dry = vn(p / 55.0 + 21.7) * 0.7 + mid * 0.3;                                                    // where the grass is drier and yellower
        vec3 col = textureLod(tGrass, p / 1.5, 9.0).rgb;
        const vec3 LUM = vec3(0.3, 0.6, 0.1); float gMean = dot(col, LUM);
        if (near > 0.002) col = mix(col, stoch(tGrass, p / 1.5, dx / 1.5, dy / 1.5, col), near);
        float hGrass = clamp(0.5 + (dot(col, LUM) / max(gMean, 1e-4) - 1.0) * 0.6, 0.0, 1.0);          // "height" of the grass here: lit blades stand above the dark gaps
        col *= (0.63 + 1.2 * mac) * (0.8 + 0.5 * mac2) * mix(vec3(0.95, 1.0, 1.05), vec3(1.10, 1.02, 0.84), smoothstep(0.3, 0.75, dry));
        float wf = smoothstep(0.35, 0.65, vWt.y * (1.0 + rag * 0.5)), wl = smoothstep(0.35, 0.65, vWt.x * (1.0 + rag));
        if (wf > 0.004) { vec3 fm = textureLod(tField, p / 2.5, 9.0).rgb; if (near > 0.002) fm = mix(fm, stoch(tField, p / 2.5, dx / 2.5, dy / 2.5, fm), near); col = mix(col, fm * (0.8 + 0.5 * mac2), wf); }
        if (wl > 0.004) col = mix(col, layer(tLitter, p / 3.0, dx / 3.0, dy / 3.0, near) * (0.7 + 0.8 * mac), wl);
        // Raised bog: sphagnum lawn, drier hummocks of sedge and heather, rust and yellow patches, and round dark pools.
        // Near the train the pools are holes in the ground showing the mirror water below; further out, where a pool is
        // only a few pixels, it is painted in its place (a hole that small would shimmer).
        float ps = -9.0;
        float vBog = vB.x, vReed = vB.y;
        if (vBog > 0.02) {
          vec3 mm = textureLod(tMoss, p / 1.3, 9.0).rgb; if (near > 0.002) mm = mix(mm, stoch(tMoss, p / 1.3, dx / 1.3, dy / 1.3, mm), near);
          vec3 sd = textureLod(tField, p / 2.0, 9.0).rgb; if (near > 0.002) sd = mix(sd, textureGrad(tField, p / 2.0, dx / 2.0, dy / 2.0).rgb, near);
          float hum = smoothstep(0.45, 0.72, vn(p / 3.5 + 1.7) * 0.75 + fine * 0.25), rust = smoothstep(0.55, 0.8, vn(p / 7.0 + 9.1)), yel = vn(p / 23.0 + 2.9);
          vec3 bc = mix(mm, sd * vec3(0.78, 0.66, 0.5), hum * 0.8);
          bc *= mix(vec3(1.0), vec3(1.12, 0.8, 0.62), rust * 0.6) * mix(vec3(0.84, 0.95, 0.86), vec3(1.0, 1.0, 0.8), yel) * (0.8 + 1.5 * (mac - 0.16));
          col = mix(col, bc, smoothstep(0.15, 0.55, vBog)); ps = poolS(p, vBog, td, 1.0, vec2(0.0));
        }
        // Reed bed: dark wet ground under the reeds (seen from afar, the reed tops), and open water in channels and pools
        if (vReed > 0.02) {
          vec3 rc = mix(col * vec3(0.5, 0.52, 0.38), vec3(0.24, 0.29, 0.13) * (0.85 + 1.5 * (mac - 0.16)) * mix(vec3(1.0), vec3(1.15, 1.0, 0.85), dry), smoothstep(60.0, 120.0, dist));
          col = mix(col, rc, smoothstep(0.15, 0.55, vReed)); ps = max(ps, poolS(p, vReed, td, 2.4, vec2(91.7, 37.1)));
        }
        // Flooded forest drawn by the shader (the simulator; the test page dips its ground mesh instead): the same
        // formula as dipAt() in JS, so trees know where the water is
        if (vB.z > 0.01) ps = max(ps, ((vB.z * 0.95 - vn(p / 9.0 + 31.7) * 0.9) * 1.4 - 0.15) * 6.0);
#ifdef ROADS
        vec2 mk = td < roadK.y ? texture2D(maskNear, vec2(vCor.x / roadK.x, (vCor.y + roadK.y) / (2.0 * roadK.y))).rg : texture2D(maskFar, vec2(vCor.x / roadK.x, (vCor.y + roadK.z) / (2.0 * roadK.z))).rg;
        float rg_ = (fine - 0.5) * 0.9, rd = smoothstep(0.30, 0.70, mk.g + rg_), ra = smoothstep(0.35, 0.65, mk.r + rg_ * 0.5);
        if (rd + ra > 0.05) ps = -9.0;                                                                       // no pools on a road
#endif
        float flat_ = smoothstep(0.8, 0.97, vFl); if (flat_ < 1.0) ps = mix(-9.0, ps, flat_) - (1.0 - flat_) * 2.0;   // pools only where the ground is held flat at the water level
        if (ps > -2.0) {
          float fw = max(fwidth(ps), 1e-3);
          col *= mix(vec3(1.0), vec3(0.42, 0.40, 0.33), smoothstep(-0.6, -0.05, ps));                    // dark wet ground right at the waterline
          if (ps > 0.0 && dist < 140.0) discard;
          if (dist >= 140.0) { float fr = pow(1.0 - abs(normalize(camPos - vW).y), 4.0);
            col = mix(col, mix(vec3(0.05, 0.045, 0.035), fogC * 0.9, 0.25 + 0.65 * fr), smoothstep(-fw, fw, ps) * smoothstep(140.0, 160.0, dist)); }
        }
        // Gravel against grass is a HEIGHT BLEND, not a cross-fade: each photo's brightness stands in for how far it sticks up
        // (stone tops above crevices, blades above gaps). Across the border the taller one is shown, so grass first comes up
        // between the stones and the last stones stand clear of the grass; no pixel is a see-through mix of the two.
        float tg = clamp((vWt.z * (1.0 + rag * 0.9) - 0.5) * 2.5 + 0.5, 0.0, 1.0);        // the border wanders in and out by a few tens of centimetres
        if (tg > 0.001) {
          vec3 sm = textureLod(tGravel, p / 1.6, 9.0).rgb, st = near > 0.002 ? mix(sm, textureGrad(tGravel, p / 1.6, dx / 1.6, dy / 1.6).rgb, near) : sm;
          float hStone = clamp(0.5 + (dot(st, LUM) / max(dot(sm, LUM), 1e-4) - 1.0) * 0.6, 0.0, 1.0);
          // A hard stone-or-grass choice only makes sense while a stone is bigger than a pixel. Where one pixel covers
          // several stones the choice would flip from frame to frame, so there the heights fade to neutral and the band widens.
          float crisp = clamp(1.5 - max(length(dx), length(dy)) / 0.03, 0.0, 1.0), soft = mix(0.6, 0.12, crisp);
          float ha = mix(0.5, hStone, crisp) + tg, hb = mix(0.5, hGrass, crisp) + (1.0 - tg), top = max(ha, hb) - soft, wa = max(ha - top, 0.0), wb = max(hb - top, 0.0);
          col = mix(col, st, wa / (wa + wb));
        }
#ifdef ROADS
        col = mix(col, texture2D(tDirt, p / roadTile.y).rgb, rd); col = mix(col, texture2D(tAsphalt, p / roadTile.x).rgb, ra);   // dirt first, asphalt over it
#endif
        gl_FragColor = vec4(mix(col, fogC, smoothstep(fogR.x, fogR.y, dist)), 1.0);
        #include <colorspace_fragment>
      }` });
    m.toneMapped = false; return m;
  }
  const GT = { grass: gtex("g_grass.jpg"), field: gtex("g_field.jpg"), litter: gtex("g_litter.jpg"), gravel: gtex("g_gravel.jpg"), moss: gtex("g_moss.jpg") };
  const groundMat = makeGroundMaterial();
  const reedMat = new THREE.MeshBasicMaterial({ map: photo("reed.png"), vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide });
  const reedBedMat = new THREE.MeshBasicMaterial({ map: photo("reedbed.png"), vertexColors: true, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x18200f, side: THREE.DoubleSide }), curtainMat = new THREE.MeshBasicMaterial({ color: 0x0b110a, side: THREE.DoubleSide });
  // What stands at a spot on the map. Everything is a smooth function of position in BOTH directions (x along the
  // track, z across it), so the borders between forest, field and flooded ground wander at any angle like real ones.
  //   dens   0 = open land ... 1 = full forest          mantle 0 = open pole stand ... 1 = edge closed by scrub
  //   field  0 = green meadow ... 1 = dry hay field      wet 0 = dry ... 1 = flooded; snag = how many dead trees stand in it
  const sst = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const N = (x, z, k) => { const wx = x + 0.45 * (n2(x * 1.9 + 3.1, z * 1.9, k + 50) - 0.5), wz = z + 0.45 * (n2(x * 1.9, z * 1.9 + 5.7, k + 51) - 0.5);      // warped, two scales
    return 0.62 * n2(wx, wz, k) + 0.38 * n2(wx * 2.7 + 11.3, wz * 2.7 - 4.1, k + 52); };
  const stand = (x, z = 1) => { if (Math.abs(z) <= 1) z *= 30;                   // called with just a side (+1 / -1): sample 30 m out
    const a = N(x / 420, z / 420, 1), b = N(x / 300, z / 300, 2), c = N(x / 650, z / 650, 3);
    let dens = sst(0.43, 0.55, N(x / 270, z / 270, 30)), mantle = Math.min(1, Math.max(0, 2.2 * N(x / 380, z / 380, 6) - 0.55));
    let reed = sst(0.58, 0.66, N(x / 500, z / 500, 85)), bog = sst(0.56, 0.66, N(x / 700, z / 700, 80)), field = sst(0.42, 0.58, N(x / 520, z / 520, 60)), wet = sst(0.5, 0.6, N(x / 250, z / 250, 70)), snag = Math.min(1, Math.max(0.08, (N(x / 170, z / 170, 72) - 0.3) * 2.6));
    const L = !P.force && P.landAt ? P.landAt(x, z) : null;
    if (L) {                                                                       // the landscape map decides what is here; noise only roughens its borders
      const rough = (N(x / 45, z / 45, 31) - 0.5) * 0.4;
      dens = sst(0.35, 0.65, L.forest + rough) * (1 - L.built); field = L.open > 0.75 ? 1 : L.open > 0.2 ? 0 : field;
      bog = sst(0.3, 0.6, L.bog + rough) * Math.min(1, L.bog * 1.6); reed = sst(0.35, 0.6, L.reed + rough);
      wet = L.flood * wet;                                                         // flooded forest: random patches, only where the map allows it
    } else if (P.landAt && !P.force) { bog = reed = wet = 0; if (Math.abs(z) < 35) { dens = 0; field = 0; } }   // nothing mapped: noise, but the railway's own strip stays clear (mown grass, not a hay field)
    if (P.force) { dens = P.force.dens; mantle = P.force.mantle; if (P.force.field != null) field = P.force.field; wet = P.force.wet || 0; snag = P.force.snag == null ? 0.6 : P.force.snag; bog = P.force.bog || 0; reed = P.force.reed || 0; }
    bog *= 1 - reed; wet *= (1 - bog) * (1 - reed); dens *= (1 - sst(0.25, 0.6, bog)) * (1 - sst(0.25, 0.6, reed));                                // an open bog carries no closed forest and no flooded one
    dens *= 1 - 0.9 * wet;                                                         // flooded ground does not carry a closed forest
    return { spruce: Math.max(0, a * 2.2 - 0.75), pine: Math.max(0, b * 1.5 - 0.75), alder: 0.25 + 0.5 * (1 - a), birch: 0.35 + 0.9 * c, tall: 0.8 + 0.4 * N(x / 500, z / 500, 4),
      dens, mantle, field, wet, snag, bog, reed, poles: Math.max(0.1, 0.8 - 0.75 * mantle) }; };
  // just the forest density, for mapping out where the forest patches are (same numbers as in stand(), far cheaper)
  const densOnly = (x, z) => { if (P.landAt && !P.force) return stand(x, z).dens;
    const rd = P.force ? P.force.reed || 0 : sst(0.58, 0.66, N(x / 500, z / 500, 85)), bg = sst(0.25, 0.6, (P.force ? P.force.bog || 0 : sst(0.56, 0.66, N(x / 700, z / 700, 80))) * (1 - rd)) + sst(0.25, 0.6, rd);
    return (P.force ? P.force.dens * (1 - 0.9 * (P.force.wet || 0) * (1 - (P.force.bog || 0))) : sst(0.43, 0.55, N(x / 270, z / 270, 30)) * (1 - 0.9 * sst(0.5, 0.6, N(x / 250, z / 250, 70)))) * Math.max(0, 1 - bg); };
  const FZ = new Set([1, 2, 3, 4, 6]);            // zones that follow the edges of forest patches (the rest follow the track or the water)
  // flooded ground: how wet a spot is, and how far the ground dips there (pools with islands; water stands at WATER_Y)
  const n2 = (x, z, k) => { const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
    return (hash(i, j, k) * (1 - a) + hash(i + 1, j, k) * a) * (1 - b) + (hash(i, j + 1, k) * (1 - a) + hash(i + 1, j + 1, k) * a) * b; };
  const WATER_Y = -0.95;
  const fr = (v) => v - Math.floor(v), h2 = (x, y) => { let px = fr(x * 0.1031), py = fr(y * 0.1030); const d = px * (py + 33.33) + py * (px + 33.33); px += d; py += d; return fr((px + py) * py); };
  const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y); let u = x - i, v = y - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    return (h2(i, j) * (1 - u) + h2(i + 1, j) * u) * (1 - v) + (h2(i, j + 1) * (1 - u) + h2(i + 1, j + 1) * u) * v; };
  const MXZ = (x, z) => (P.mapXZ ? P.mapXZ(x, z) : [x, z]);
  const poolAt = (xw, zw, bog, td, sc = 1, ox = 0, oz = 0) => { const amt = sst(0.55, 0.95, bog) * sst(10, 22, td); if (amt < 0.01) return -9;     // xw, zw: map coordinates      // same as poolS() in the ground shader
    const x = xw / sc + ox, z = zw / sc + oz, ang = vn(x / 260 + 4.1, z / 260 + 4.1) * 3, gx = Math.floor(x / 13), gz = Math.floor(z / 13); let best = -9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const ix = gx + i, iz = gz + j, pd = sst(0.25, 0.75, vn((ix + 0.5) * 13 / 220 + 13.3, (iz + 0.5) * 13 / 220 + 13.3)); if (h2(ix + 5.1, iz + 5.1) > 0.1 + 0.75 * pd) continue;
      const cx = (ix + 0.2 + 0.6 * h2(ix + 1.3, iz + 1.3)) * 13, cz = (iz + 0.2 + 0.6 * h2(ix + 3.7, iz + 3.7)) * 13, dx = x - cx, dz = z - cz;
      const a = ang + (h2(ix + 2.2, iz + 2.2) - 0.5) * 0.7, k = 1 + 1.5 * h2(ix + 7.7, iz + 7.7), R = 13 * (0.05 + 0.2 * Math.pow(h2(ix + 11.1, iz + 11.1), 2)) * amt * (0.7 + 0.6 * pd);
      const ux = Math.cos(a) * dx + Math.sin(a) * dz, uz = -Math.sin(a) * dx + Math.cos(a) * dz; best = Math.max(best, R - Math.hypot(ux / k, uz)); }
    return (best + (vn(x / 1.9 + 5.5, z / 1.9 + 5.5) - 0.5) * 0.8 * amt) * sc; };
  const reedWater = (x, z, reed) => { const [mx, mz] = MXZ(x, z); return poolAt(mx, mz, reed, Math.abs(z), 2.4, 91.7, 37.1); };
  const bogWater = (x, z, bog) => { const [mx, mz] = MXZ(x, z); return poolAt(mx, mz, bog, Math.abs(z)); };
  const humAt = (x, z, bog) => bog * n2(x / 6, z / 6, 97) * 0.25;                                     // hummocks: the bog surface rises and falls a little
  const wetAt = (st, e, d) => st.wet * sst(-11, -7, d) * (1 - sst(95, 125, e + d));      // pools begin a few metres in front of where the tree line would be
  const dipAt = (x, side, st, e, d) => { const w = wetAt(st, e, d); if (w <= 0) return 0; const [mx, mz] = MXZ(x, side * (e + d)); return Math.min(0.7, Math.max(0, w * 0.95 - vn(mx / 9 + 31.7, mz / 9 + 31.7) * 0.9) * 1.4); };   // same formula as the ground shader's flooded water
  const edgeAt = (x, side) => (side > 0 ? P.edge.right : P.edge.left) + (noise(x / 45, side > 0 ? 8 : 9) - 0.5) * 2 * P.edge.wander;
  const mix = (st, u) => { const w = [["spruce", st.spruce + (P.photos ? st.pine * 0.6 : 0)], ["pine", P.photos ? 0 : st.pine],   // no pine photo yet: spruce stands in
    ["alder", st.alder * 0.6], ["birch", st.birch]], tot = w.reduce((s, e) => s + e[1], 0); let acc = 0; for (const [n, v] of w) { acc += v / tot; if (u < acc) return n; } return "birch"; };
  // zones going back from the edge: [id, grid spacing, from, to, what grows there]
  const ZONES = [
    [1, 1.7, 0, 4.5, (st, u) => { const p = st.mantle * 0.95 * sst(0.3, 0.75, st.dens); return u > p ? null : hashPick(u / p, ["willow", "young", "young", "alder"]); }],
    [2, 2.5, 3.5, 10, (st, u) => { const p = 0.75 * st.dens * (0.55 + 0.45 * st.mantle); return u > p ? null : hashPick(u / p, st.mantle > 0.45 ? ["alder", "birch", "alder", "young", "birch"] : ["birch", "pole", "birch", "pole", "alder"]); }],
    [3, 3.2, 9, 20, (st, u) => { const p = 0.85 * st.dens; return u > p ? null : mix(st, u / p); }],
    [4, 1.9, 1, 20, (st, u) => (u > st.poles * st.dens ? null : "pole")],
    [6, 2.3, -5, 1.5, (st, u) => { const p = 0.6 * sst(0.25, 0.7, st.dens) * (0.35 + 0.65 * st.mantle); return u > p ? null : hashPick(u / p, ["bush", "bush", "willow", "bush"]); }],   // skirt of scrub in front of the trees
    [7, 7.0, -9, 70, (st, u) => { const p = 0.11 * (1 - sst(0.4, 0.8, st.dens)) * (1 - st.wet) * (1 - sst(0.1, 0.4, st.bog + st.reed)); return u > p ? null : hashPick(u / p, ["bush", "bush", "willow", "young"]); }],                          // lone bushes on open ground
    [8, 1.8, -9, 45, (st, u, d, w) => { const p = 0.85 * st.snag * w; return u > p ? null : hashPick(u / p, ["snag", "snag", "snag", "snagcrown", "stump", "snag", "stump"]); }],      // standing dead trees
    [9, 5.0, -9, 45, (st, u, d, w) => (u > 0.28 * st.snag * w ? null : "log")],                                                                        // fallen trunks
    [10, 3.6, -9, 45, (st, u, d, w) => { const p = 0.06 * w; return u > p ? null : hashPick(u / p, ["young", "pole", "willow", "birch", "bush"]); }],    // living trees and scrub standing in the water
    [11, 2.0, -11, 50, (st, u, d, w) => (u > (d < -4 ? 0.45 : 0.22) * w ? null : "reed")],                                                                                  // reed and sedge clumps
    [5, 4.0, 0, 20, (st, u) => { const p = 0.3 * sst(0.02, 0.2, st.dens) * (1 - sst(0.35, 0.7, st.dens)) * (1 - 0.85 * st.wet) * (1 - sst(0.1, 0.4, st.bog + st.reed)); return u > p ? null : hashPick(u / p, ["young", "willow", "birch", "young", "alder"]); }],   // scattered trees where forest gives way to field
  ];
  function hashPick(u, list) { return list[Math.min(list.length - 1, Math.floor(u * list.length))]; }
  function build(ci) {
    const x0 = ci * P.chunk, rb = { p: [], c: [], u: [], s: { 1: [], [-1]: [] } }, list = [], back = { p: [], c: [], u: [], i: [], s: { 1: [], [-1]: [] } }, reed = { p: [], c: [], u: [], i: [], s: { 1: [], [-1]: [] } }, floor = [], curtain = [], split = {};
    for (const side of [1, -1]) {
      if (side < 0) split.list = list.length;                     // everything on the right-hand side has been listed by now
      // Where the forest patches are on this side, out to about 210 m, and for every spot its depth into the forest: +metres
      // inside a patch, -metres outside, measured to the nearest border in ANY direction. The cleared strip by the track
      // counts as open ground. Real trees are grown in a band along every border that can be seen, not just beside the track.
      const GS = 4, GX0 = x0 - 44, GNX = Math.ceil((P.chunk + 88) / GS) + 1, GNZ = 64, INF = 1e4, fin = new Float32Array(GNX * GNZ), fout = new Float32Array(GNX * GNZ);
      for (let i = 0; i < GNX; i++) { const gx = GX0 + i * GS, ee = edgeAt(gx, side); for (let j = 0; j < GNZ; j++) { const f = j * GS >= ee && densOnly(gx, side * j * GS) > 0.25; fin[i * GNZ + j] = f ? INF : 0; fout[i * GNZ + j] = f ? 0 : INF; } }
      for (const a of [fin, fout]) { const D = GS * 1.414, at = (i, j) => (i < 0 || j < 0 || i >= GNX || j >= GNZ ? INF : a[i * GNZ + j]);
        for (let i = 0; i < GNX; i++) for (let j = 0; j < GNZ; j++) a[i * GNZ + j] = Math.min(a[i * GNZ + j], at(i - 1, j) + GS, at(i, j - 1) + GS, at(i - 1, j - 1) + D, at(i - 1, j + 1) + D);
        for (let i = GNX - 1; i >= 0; i--) for (let j = GNZ - 1; j >= 0; j--) a[i * GNZ + j] = Math.min(a[i * GNZ + j], at(i + 1, j) + GS, at(i, j + 1) + GS, at(i + 1, j + 1) + D, at(i + 1, j - 1) + D); }
      const sdg = (i, j) => { i = Math.max(0, Math.min(GNX - 1, i)); j = Math.max(0, Math.min(GNZ - 1, j)); const k = i * GNZ + j; return fin[k] > 0 ? Math.min(fin[k] - GS / 2, 99) : -Math.min(fout[k] - GS / 2, 99); };
      const sdAt = (x, az) => { const fx = (x - GX0) / GS, fz = az / GS, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j; return (sdg(i, j) * (1 - u) + sdg(i + 1, j) * u) * (1 - v) + (sdg(i, j + 1) * (1 - u) + sdg(i + 1, j + 1) * u) * v; };
      const clear = (side > 0 ? 2.5 : 7.1) + 3.5;
      for (const [zid, cell, s0_, s1_, grow] of ZONES) { if (!FZ.has(zid)) continue;
        for (let ix = Math.floor(x0 / cell); ix * cell < x0 + P.chunk; ix++) for (let iz = Math.floor(clear / cell); iz * cell < 212; iz++) {
          const k = (side > 0 ? iz : -iz - 1) * 13 + zid, az = (iz + hash(ix, k, 5)) * cell, px = ix * cell + (hash(ix, k, 4) - 0.5) * cell, sd = sdAt(px, az);
          if (az < clear || sd < s0_ || sd >= (zid === 3 || zid === 4 ? 40 : s1_)) continue;
          if (sdAt(px, az - 12) > 8 && sdAt(px, az - 24) > 8) continue;                 // a border facing away from the track, behind 24 m of forest: never seen
          const st = stand(px, side * az);
          if (sd >= s1_ && (sd >= 20 + 20 * (1 - sst(0.3, 0.6, st.mantle)) || (zid === 3 && hash(ix, k, 14) > 0.5))) continue;   // open pole stands are seen into, so they go deeper
          const name = grow(st, hash(ix, k, 2), sd); if (!name) continue;
          const e = edgeAt(px, side), small = name === "young" || name === "willow" || name === "bush", depth = Math.max(0, Math.min(1, sd / P.depth));
          list.push({ T: pool[name][Math.floor(hash(ix, k, 3) * P.variants)], x: px - x0, z: side * az, rot: hash(ix, k, 8) * 6.283, yoff: -dipAt(px, side, st, e, az - e), fall: 0,
            s: (0.8 + hash(ix, k, 9) * 0.4) * (small ? 1 : st.tall * (0.72 + 0.28 * Math.min(1, Math.max(0, sd) / 9))), tint: (0.86 + hash(ix, k, 10) * 0.26) * (1 - 0.5 * depth * (0.4 + 0.6 * st.mantle)), warm: hash(ix, k, 11) });
        } }
      for (const [zid, cell, d0, d1, grow] of ZONES.filter((zn) => !FZ.has(zn[0]))) for (let ix = Math.floor(x0 / cell); ix * cell < x0 + P.chunk; ix++) {
        const xc = ix * cell, e = edgeAt(xc, side);
        for (let iz = 0; d0 + iz * cell < d1; iz++) { const st = stand(xc, side * (e + d0 + (iz + 0.5) * cell));
          const k = (side > 0 ? iz : -iz - 1) * 13 + zid, d = d0 + (iz + hash(ix, k, 5)) * cell, w = wetAt(st, e, d);
          if (zid >= 8 && w < 0.05) continue;
          let name = grow(st, hash(ix, k, 2), d, w); if (!name) continue;
          const px = xc + (hash(ix, k, 4) - 0.5) * cell, yoff = -dipAt(px, side, st, e, d);
          if (name === "reed") { const h = 0.6 + hash(ix, k, 9) * 0.9, v = 0.75 + hash(ix, k, 10) * 0.45, by = Math.max(yoff - 0.8, WATER_Y - 0.05), a0 = hash(ix, k, 8) * 3.14;
            for (let q = 0; q < 2; q++) { const a = a0 + q * 1.571, cx = Math.cos(a) * h * 0.45, cz = Math.sin(a) * h * 0.45, kk = reed.p.length / 3, zz = side * (e + d);
              reed.p.push(px - x0 - cx, by, zz - cz, px - x0 + cx, by, zz + cz, px - x0 + cx, by + h, zz + cz, px - x0 - cx, by + h, zz - cz); reed.u.push(0, 0, 1, 0, 1, 1, 0, 1);
              for (let c = 0; c < 4; c++) reed.c.push(v * (c > 1 ? 1.15 : 0.8), v * (c > 1 ? 1.15 : 0.85), v * 0.9); reed.s[side].push(kk, kk + 1, kk + 2, kk, kk + 2, kk + 3); }
            continue; }
          const fall = name === "log"; if (fall) name = "snag";
          { const Tn = pool[name][Math.floor(hash(ix, k, 3) * P.variants)], reach = Tn.H * 1.2 * (fall ? 1 : P.species[name].dead ? 0.3 : 0.12);      // nothing may reach the track, standing, leaning or fallen
            if (zid >= 8 && e + d - reach < (side > 0 ? 2.5 : 7.1) + 2.5) continue; }
          const small = name === "young" || name === "willow" || name === "bush" || P.species[name].dead, depth = Math.max(0, Math.min(1, d / P.depth));
          list.push({ T: pool[name][Math.floor(hash(ix, k, 3) * P.variants)], x: px - x0, z: side * (e + d), rot: hash(ix, k, 8) * 6.283, yoff, fall: fall ? 1.4 + hash(ix, k, 12) * 0.15 : 0,
            s: (0.8 + hash(ix, k, 9) * 0.4) * (small ? 1 : st.tall * (0.72 + 0.28 * Math.min(1, d / 9))), tint: (0.86 + hash(ix, k, 10) * 0.26) * (1 - 0.5 * depth * (0.4 + 0.6 * st.mantle)), warm: hash(ix, k, 11) });
        }
      }
      // Raised bog: stunted pines, sparse in the open middle and clumped along the drier ridges, closing up and growing
      // taller toward the rim where the bog turns into forest; some of them dead. None stand in the pools.
      for (let ix = Math.floor(x0 / 3); ix * 3 < x0 + P.chunk; ix++) for (let iz = 0; iz < 56; iz++) {
        const k = (side > 0 ? iz : -iz - 1) * 13 + 12, az = (iz + hash(ix, k, 5)) * 3, px = ix * 3 + (hash(ix, k, 4) - 0.5) * 3;
        if (az < (side > 0 ? 2.5 : 7.1) + 5) continue;
        const st = stand(px, side * az); if (st.bog < 0.08) continue;
        const rim = 1 - sst(0.55, 0.95, st.bog), clump = n2(px / 14, (side * az) / 14, 98), u = hash(ix, k, 2);
        const p = sst(0.08, 0.3, st.bog) * (0.05 + 0.3 * rim) * sst(0.3, 0.75, clump + 0.3 * rim) * P.bogPines; if (u > p) continue;
        if (bogWater(px, side * az, st.bog) > -0.9) continue;
        const name = hash(ix, k, 6) < 0.16 ? "bogsnag" : hash(ix, k, 7) < rim * 0.3 ? "birch" : "bogpine", T = pool[name][Math.floor(hash(ix, k, 3) * P.variants)];
        list.push({ T, x: px - x0, z: side * az, rot: hash(ix, k, 8) * 6.283, yoff: humAt(px, side * az, st.bog) * 0.6, fall: 0,
          s: name === "birch" ? 0.45 + 0.3 * hash(ix, k, 9) : (0.7 + hash(ix, k, 9) * 0.5) * (1 + 0.8 * rim), tint: 0.9 + hash(ix, k, 10) * 0.25, warm: 0.3 + 0.7 * hash(ix, k, 11) });
      }
      // Reed bed: crossed photo cards of reed, finer near the train and coarser and wider further out. Reeds stand into
      // the shallow edge of the open water, but not out in it.
      for (const [cell, d0, d1, wsc] of [[1.9, 0, 40, 1], [3.0, 40, 90, 1.3], [5.0, 90, 180, 1.9]])
        for (let ix = Math.floor(x0 / cell); ix * cell < x0 + P.chunk; ix++) for (let iz = 0; d0 + iz * cell < d1; iz++) {
          const k = (side > 0 ? iz : -iz - 1) * 17 + Math.round(cell * 10), az = d0 + (iz + hash(ix, k, 5)) * cell, px = ix * cell + (hash(ix, k, 4) - 0.5) * cell;
          if (az < (side > 0 ? 2.5 : 7.1) + 4) continue;
          const st = stand(px, side * az); if (st.reed < 0.08) continue;
          if (hash(ix, k, 2) > sst(0.1, 0.85, st.reed) * sst(0.25, 0.65, n2(px / 11, (side * az) / 11, 99) + (st.reed - 0.5) * 0.8)) continue;      // thinner reed weight: clumps and gaps
          if (reedWater(px, side * az, st.reed) > 1.2 || (P.blockAt && P.blockAt(px, side * az, 1.5))) continue;
          const s = 0.8 + 0.45 * hash(ix, k, 9), h = 2.7 * s, w = 2.5 * s * wsc, a0 = hash(ix, k, 8) * 3.14, tile = hash(ix, k, 3) < 0.5 ? 0 : 0.5, fl = hash(ix, k, 6) < 0.5;
          const v = 0.82 + 0.3 * hash(ix, k, 10), yel = hash(ix, k, 11) * 0.12, by = -0.85;
          for (let q = 0; q < 2; q++) { const a = a0 + q * 1.571, cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2, kk = rb.p.length / 3, zz = side * az, xx = px - x0;
            rb.p.push(xx - cx, by, zz - cz, xx + cx, by, zz + cz, xx + cx, by + h, zz + cz, xx - cx, by + h, zz - cz);
            const u0 = tile + (fl ? 0.5 : 0), u1 = tile + (fl ? 0 : 0.5); rb.u.push(u0, 0, u1, 0, u1, 1, u0, 1);
            for (let c = 0; c < 4; c++) rb.c.push(v * (1 + yel), v, v * (1 - yel)); rb.s[side].push(kk, kk + 1, kk + 2, kk, kk + 2, kk + 3); }
        }
      // back of the stand: crown silhouettes in two rows where there is forest, and always a far treeline beyond any field
      for (const [row, off, dark] of [[0, 19, 0.34], [1, 26, 0.22], [3, 45, 0.26], [4, 70, 0.27], [5, 100, 0.28], [6, 140, 0.29], [7, 190, 0.3], [2, 0, 0.3]]) for (let ib = Math.floor(x0 / 4.5); ib * 4.5 < x0 + P.chunk; ib++) {
        const xb = ib * 4.5 + (hash(ib, row, 21 + side) - 0.5) * 3, far = row === 2, dist = far ? 230 + noise(xb / 220, side > 0 ? 50 : 51) * 170 : edgeAt(xb, side) + off + (hash(ib, row, 31) - 0.5) * (off > 30 ? 14 : 0);
        // Overlapping flat silhouettes must never share a depth, or they flicker through each other. Each one's distance is
        // snapped to a 7.2 m grid and then given one of six 1.2 m steps in turn, so two can only coincide if they are 27 m apart.
        const zq = 7.2 * Math.round(dist / 7.2) + ((((ib + row) % 6) + 6) % 6) * 1.2;
        const sdc = far ? 99 : sdAt(xb, zq); if (sdc < 17) continue;                                // a flat silhouette is only allowed with a band of real trees in front of it
        const st = stand(xb, side * dist), behind = off > 30 ? stand(xb, side * (dist - 16)) : null;
        if (!far && sdc < 17 + 20 * (1 - sst(0.3, 0.6, st.mantle))) continue;
        let tx = 1, tz = 0; if (!far && sdc < 60) { const gx = sdAt(xb + 4, dist) - sdAt(xb - 4, dist), gz = side * (sdAt(xb, dist + 4) - sdAt(xb, dist - 4)), gl = Math.hypot(gx, gz); if (gl > 0.5) { tx = -gz / gl; tz = gx / gl; } }   // stand across the direction to the nearest border, so it is never seen edge-on
        if (!far && hash(ib, row, 29 + side) > sst(0.3, 0.65, st.dens) * (1 - st.wet)) continue;
        if (behind && behind.dens > 0.75 && hash(ib, row, 33) < 0.7) continue;                       // deep inside a forest most of it is hidden anyway
        // neighbouring silhouettes overlap, so each takes its own depth step (six steps of 1.2 m in turn); at nearly the same distance they would flicker through each other
        if (P.blockAt && P.blockAt(xb, side * zq, 3)) continue;
        const z = side * (zq + hash(ib, row, 22) * 0.25), w = (8 + hash(ib, row, 23) * 7) * (far ? 1.6 : off > 30 ? 1.25 : 1);
        const conifer = hash(ib, row, 24) < (st.spruce + st.pine) / (st.spruce + st.pine + st.birch + st.alder) + 0.15, tile = P.photos ? (conifer ? 4 : 0) + Math.floor(hash(ib, row, 25) * 4) : conifer ? 5 + Math.floor(hash(ib, row, 25) * 3) : Math.floor(hash(ib, row, 25) * 5);
        const h = (conifer ? 23 : 18) * st.tall * (0.8 + hash(ib, row, 26) * 0.35), v = dark * (0.8 + hash(ib, row, 27) * 0.4), col = P.photos ? [v * (far ? 2.9 : 2.3), v * (far ? 3.0 : 2.4), v * (far ? 3.0 : 2.3)].map((c) => c * (conifer ? 1.25 : 1)) : conifer ? [0.28 * v, 0.5 * v, 0.36 * v] : [0.5 * v, 0.72 * v, 0.32 * v], k = back.p.length / 3, fl = hash(ib, row, 28) < 0.5;
        { const ax = (tx * w) / 2, bz = (tz * w) / 2; back.p.push(xb - x0 - ax, -1, z - bz, xb - x0 + ax, -1, z + bz, xb - x0 + ax, h - 1, z + bz, xb - x0 - ax, h - 1, z - bz); }
        const u0 = (tile + (fl ? 1 : 0)) / 8, u1 = (tile + (fl ? 0 : 1)) / 8; back.u.push(u0, 0, u1, 0, u1, 1, u0, 1); for (let q = 0; q < 4; q++) { const f = P.photos ? 1 : q > 1 ? 1.3 : 0.7; back.c.push(col[0] * f, col[1] * f, col[2] * f); } back.s[side].push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
      for (let xs = 0; xs < P.chunk; xs += 10) {     // dark floor and near-black curtain, only under real forest
        const d = stand(x0 + xs + 5, side * 30).dens, ea = edgeAt(x0 + xs, side), eb = edgeAt(x0 + xs + 10, side);
        if (!P.photos && d > 0.35) floor.push(xs, -0.72, side * (ea - 1), xs + 10, -0.72, side * (eb - 1), xs + 10, -0.72, side * (eb + P.depth + 12), xs, -0.72, side * (ea + P.depth + 12));
        if (d > 0.6) curtain.push(xs, -1, side * (ea + P.depth + 9), xs + 10, -1, side * (eb + P.depth + 9), xs + 10, 11, side * (eb + P.depth + 9), xs, 11, side * (ea + P.depth + 9));
      }
    }
    // ground mesh for the chunk: columns every 10 m, rows from the ballast edge out past the far treeline
    let groundMesh = null;
    if (P.photos && P.ground) {
      const gp = [], gw = [], gm = [], gb = [], gc = [], gf = [], gi = [], NR = 17, CS = 5, NC = P.chunk / CS; var pools = [];      // boxes round standing water, per 20 m of track, so they can be tested against the view
      for (const side of [1, -1]) { const base = gp.length / 3, cells = {};
        for (let c = 0; c <= NC; c++) { const xs = c * CS, e = edgeAt(x0 + xs, side), s0 = side > 0 ? 2.5 : 7.1;
          [s0, s0 + 1.5, s0 + 4, e - 9, e - 5, e - 1, e + 3, e + 7, e + 12, e + 18, e + 25, e + 32, e + 45, e + 60, e + 80, 130, 420].map((d, j, A) => (A[j] = j ? Math.max(d, A[j - 1] + 0.75) : d)).forEach((d, j) => {      // rows must run strictly outward: where the forest edge comes close to the track, 'e - 9' used to land inside the gravel rows and the sheet folded back over itself, two surfaces at one height flickering through each other
            const st = stand(x0 + xs, side * d), forest = sst(0.3, 0.6, st.dens), fld = (1 - sst(0.08, 0.4, st.dens)) * st.field * (1 - st.wet);
            const dip = j < 3 || j > 14 || d < s0 + 4.5 ? 0 : dipAt(x0 + xs, side, st, e, d - e), under = dip > 0.12 ? 1 : 0;
            const bogHere = j >= 2 ? st.bog : 0, reedHere = j >= 2 ? st.reed : 0; gb.push(bogHere, reedHere, 0); gc.push(xs, -side * d); gf.push(1);
            if (under || ((bogHere > 0.5 || reedHere > 0.5) && d < 165)) { const pc = cells[Math.floor(xs / 20)] || (cells[Math.floor(xs / 20)] = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }); pc.x0 = Math.min(pc.x0, xs - CS); pc.x1 = Math.max(pc.x1, xs + CS); pc.z0 = Math.min(pc.z0, side * d - 8); pc.z1 = Math.max(pc.z1, side * d + 8); }
            gm.push(0.16 + (n2((x0 + xs) / 60, (side * d) / 60, 95) - 0.5) * 0.14);
            gp.push(xs, j === 0 ? -0.6 : -0.8 - dip + humAt(x0 + xs, side * d, bogHere), side * d); gw.push(Math.max(d >= e + 1 ? forest : d >= e - 3 ? forest * 0.3 : 0, under), j >= 2 ? fld : 0, j === 0 ? 1 : j === 1 ? 0.5 : 0); });
          if (c < NC) for (let j = 0; j < NR - 1; j++) { const k = base + c * NR + j; gi.push(k, k + NR, k + NR + 1, k, k + NR + 1, k + 1); } } if (side > 0) split.gi = gi.length; for (const pc of Object.values(cells)) pools.push(new THREE.Box3(new THREE.Vector3(x0 + pc.x0, WATER_Y - 0.1, pc.z0), new THREE.Vector3(x0 + pc.x1, WATER_Y + 0.1, pc.z1))); }
      const gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.Float32BufferAttribute(gp, 3)); gg.setAttribute("w", new THREE.Float32BufferAttribute(gw, 3)); gg.setAttribute("m", new THREE.Float32BufferAttribute(gm, 1)); gg.setAttribute("b", new THREE.Float32BufferAttribute(gb, 3)); gg.setAttribute("cor", new THREE.Float32BufferAttribute(gc, 2)); gg.setAttribute("fl", new THREE.Float32BufferAttribute(gf, 1)); gg.setIndex(gi); groundMesh = gg;
    }
    // Nothing may reach over the railway: trunk plus crown (or a fallen trunk's length) clear of the ballast and the
    // catenary masts on either side, whatever zone planted it.
    { const keep = list.filter((e) => { const d = Math.abs(e.z), sd = e.z > 0 ? 1 : -1, nm = Object.keys(pool).find((n) => pool[n].includes(e.T)) || "",
        small = nm === "bush" || nm === "willow", reach = e.fall ? e.T.H * e.s : small ? 1.5 : 1 + e.T.H * e.s * 0.18;
        return d - reach >= (sd > 0 ? 2.5 : 7.1) + 6.5; });
      if (keep.length !== list.length) { const nR = keep.filter((e) => e.z > 0).length; list.length = 0; list.push(...keep); if (split.list !== undefined) split.list = nR; } }
    if (P.blockAt) { const keep = list.filter((e) => !P.blockAt(x0 + e.x, e.z, e.T.H * e.s * 0.12 + 1)); list.length = 0; list.push(...keep);
      if (split.list !== undefined) split.list = keep.filter((e) => e.z > 0).length; }
    // Draw order: within each side, trees are put in order of distance from the track, so the nearest foliage is drawn
    // first and what stands behind it can be rejected by depth before it is textured. (P.order = false keeps the old order.)
    if (P.order) { const nR = split.list === undefined ? list.length : split.list, byDist = (a, b) => Math.abs(a.z) - Math.abs(b.z);
      const R_ = list.slice(0, nR).sort(byDist), L_ = list.slice(nR).sort(byDist); list.length = 0; list.push(...R_, ...L_); split.list = nR; }
    // merge every tree of the chunk into two meshes (wood, leaves)
    let nt = 0, nti = 0, nf = 0, nfi = 0; for (const { T } of list) { nt += T.tp.length; nti += T.ti.length; nf += T.fp.length; nfi += T.fi.length; }
    const tp = new Float32Array(nt), tc = new Float32Array(nt), ti = new Uint32Array(nti), fp = new Float32Array(nf), fc = new Float32Array(nf), fu = new Float32Array((nf / 3) * 2), fi = new Uint32Array(nfi), tu = new Float32Array((nt / 3) * 2);
    let ot = 0, oti = 0, of = 0, ofi = 0;
    let li = 0;
    for (const { T, x, z, rot, s, tint, warm, yoff, fall } of list) {
      if (li++ === split.list) { split.ti = oti; split.fi = ofi; }
      if (T.cross) {
        const h = T.H * s, w = h * 0.43, v = tint * 2.0, u0 = (T.tile + (T.flip ? 1 : 0)) / 8, u1 = (T.tile + (T.flip ? 0 : 1)) / 8;
        for (let q = 0; q < 3; q++) { const a = rot + q * 1.047, cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2, k = back.p.length / 3;
          back.p.push(x - cx, -0.9, z - cz, x + cx, -0.9, z + cz, x + cx, h - 0.9, z + cz, x - cx, h - 0.9, z - cz); back.u.push(u0, 0, u1, 0, u1, 1, u0, 1);
          for (let c = 0; c < 4; c++) back.c.push(v * (0.94 + 0.08 * q), v * (0.94 + 0.06 * q), v * 0.84); back.s[z > 0 ? 1 : -1].push(k, k + 1, k + 2, k, k + 2, k + 3); }
        continue;
      }
      const cs = Math.cos(rot) * s, sn = Math.sin(rot) * s, cf = Math.cos(fall), sf = Math.sin(fall), by = fall ? Math.max(yoff - 0.8, WATER_Y) + 0.05 : yoff - 0.8;
      const put = (src, dst, o) => { for (let i = 0; i < src.length; i += 3) { const lx = src[i] * cf + src[i + 1] * sf, ly = -src[i] * sf + src[i + 1] * cf;      // a fallen trunk is the same tree tipped over
        dst[o + i] = x + lx * cs - src[i + 2] * sn; dst[o + i + 1] = ly * s + by; dst[o + i + 2] = z + lx * sn + src[i + 2] * cs; } };
      put(T.tp, tp, ot); for (let i = 0; i < T.tc.length; i++) tc[ot + i] = T.tc[i] * tint; for (let i = 0; i < T.ti.length; i++) ti[oti + i] = T.ti[i] + ot / 3; tu.set(T.tu, (ot / 3) * 2);
      put(T.fp, fp, of); for (let i = 0; i < T.fc.length; i += 3) { fc[of + i] = T.fc[i] * tint * (0.94 + warm * 0.2); fc[of + i + 1] = T.fc[i + 1] * tint; fc[of + i + 2] = T.fc[i + 2] * tint * (1.05 - warm * 0.2); }
      fu.set(T.fu, (of / 3) * 2); for (let i = 0; i < T.fi.length; i++) fi[ofi + i] = T.fi[i] + of / 3;
      ot += T.tp.length; oti += T.ti.length; of += T.fp.length; ofi += T.fi.length;
    }
    // One set of vertex data per layer, but a separate mesh for each side of the track with its own bounds, so the
    // renderer can skip whatever is outside the view (looking out of one window, the other side is not drawn at all).
    if (split.ti === undefined) { split.ti = oti; split.fi = ofi; }
    const grp = new THREE.Group(), U = grp.userData; grp.position.x = x0; U.trees = []; U.back = []; U.ground = [];
    const A = (arr, n) => new THREE.BufferAttribute(arr instanceof Float32Array ? arr : new Float32Array(arr), n);
    function layer(into, attrs, parts, mat, zc, zr, yr) {
      for (const side of [1, -1]) { const idx = parts[side]; if (!idx.length) continue;
        const g = new THREE.BufferGeometry(); for (const k in attrs) g.setAttribute(k, attrs[k]); g.setIndex(Array.isArray(idx) ? idx : new THREE.BufferAttribute(idx, 1));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(P.chunk / 2, yr / 2, side * zc), Math.hypot(P.chunk / 2, zr, yr / 2));
        const m = new THREE.Mesh(g, mat); grp.add(m); into.push(m); }
    }
    layer(U.trees, { position: A(tp, 3), color: A(tc, 3), uv: A(tu, 2) }, { 1: ti.subarray(0, split.ti), [-1]: ti.subarray(split.ti) }, barkMat, 108, 108, 30);
    layer(U.trees, { position: A(fp, 3), color: A(fc, 3), uv: A(fu, 2) }, { 1: fi.subarray(0, split.fi), [-1]: fi.subarray(split.fi) }, leafMat, 108, 108, 30);
    layer(U.trees, { position: A(reed.p, 3), color: A(reed.c, 3), uv: A(reed.u, 2) }, reed.s, reedMat, 52, 52, 4);
    layer(U.trees, { position: A(rb.p, 3), color: A(rb.c, 3), uv: A(rb.u, 2) }, rb.s, reedBedMat, 92, 92, 5);
    if (P.order) for (const sd of [1, -1]) { const ix = back.s[sd], q = []; for (let k = 0; k < ix.length; k += 6) q.push([Math.abs(back.p[ix[k] * 3 + 2]), ix.slice(k, k + 6)]);
      q.sort((a, b) => a[0] - b[0]); back.s[sd] = q.flatMap((e) => e[1]); }
    layer(U.back, { position: A(back.p, 3), color: A(back.c, 3), uv: A(back.u, 2) }, back.s, backMat, 205, 205, 30);
    if (groundMesh) layer(U.ground, { position: groundMesh.getAttribute("position"), w: groundMesh.getAttribute("w"), m: groundMesh.getAttribute("m"), b: groundMesh.getAttribute("b"), cor: groundMesh.getAttribute("cor"), fl: groundMesh.getAttribute("fl") }, { 1: groundMesh.index.array.slice(0, split.gi), [-1]: groundMesh.index.array.slice(split.gi) }, groundMat, 211, 210, 3);
    if (P.order) { U.trees.forEach((m) => (m.userData.pass = 0)); U.back.forEach((m) => (m.userData.pass = 1)); U.ground.forEach((m) => (m.userData.pass = 2)); }
    U.pools = typeof pools === "undefined" ? [] : pools;        // boxes around this chunk's standing water, in world coordinates
    for (const m of U.ground) m.layers.set(1);                  // the ground is not drawn into the water's reflection
    if (!P.cull) grp.traverse((o) => (o.frustumCulled = false));
    U.count = list.length; U.tris = (nti + nfi) / 3 + (back.s[1].length + back.s[-1].length + reed.s[1].length + reed.s[-1].length + rb.s[1].length + rb.s[-1].length) / 3;
    return grp;
  }
  // What the ground is like at a spot, for a terrain mesh made elsewhere (the simulator): the same rules as the test
  // page's ground mesh. x along the track, z = metres to the RIGHT of it.
  function groundAt(x, z) {
    const side = z >= 0 ? 1 : -1, d = Math.abs(z), e = edgeAt(x, side), s0 = side > 0 ? 2.5 : 7.1, st = stand(x, z);
    const forest = sst(0.3, 0.6, st.dens), fld = (1 - sst(0.08, 0.4, st.dens)) * st.field * (1 - st.wet), open = d >= s0 + 4 ? 1 : 0;
    const gravel = d <= s0 ? 1 : d <= s0 + 1.5 ? 1 - 0.5 * (d - s0) / 1.5 : d <= s0 + 4 ? 0.5 * (1 - (d - s0 - 1.5) / 2.5) : 0;
    return { litter: d >= e + 1 ? forest : d >= e - 3 ? forest * 0.3 : 0, field: d >= s0 + 2 ? fld : 0, gravel, mac: 0.16 + (n2(x / 60, z / 60, 95) - 0.5) * 0.14,
      bog: st.bog * open, reed: st.reed * open, flood: d > s0 + 4.5 ? wetAt(st, e, d - e) : 0 };
  }
  const materials = [leafMat, barkMat, backMat, reedMat, reedBedMat];
  return { build, stand, ground, groundAt, makeGroundMaterial, materials, WATER_Y };
}
