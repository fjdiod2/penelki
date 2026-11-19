// Sandbox nature: trees from the simulator's forest generator (makeTree, photo leaf and bark atlases), drawn as one
// InstancedMesh per species variant; and the ground, a big field of grass with asphalt and dirt painted into a splat map.
import * as THREE from "three";
import { makeTree } from "./forest_gen.js";
import { Reflector } from "three/addons/objects/Reflector.js";

export const TREE_NAMES = ["birch", "pine", "spruce", "alder", "young", "bush", "willow"];
export const TREE_SETS = {                       // brush option -> which species it plants (repeats = more often)
  birches: ["birch", "birch", "birch", "young", "alder"], pines: ["pine", "pine", "spruce"], bushes: ["bush", "bush", "willow", "young"],
  mixed: ["birch", "birch", "pine", "spruce", "alder", "young", "bush"],
};
const VARIANTS = 6;

export function createTrees(scene) {
  const TL = new THREE.TextureLoader(), photo = (u) => { const t = TL.load("./assets/forest/" + u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const barkTex = photo("bark_atlas.jpg"); barkTex.wrapT = THREE.RepeatWrapping;
  const leafMat = new THREE.MeshBasicMaterial({ map: photo("leaf_atlas.png"), vertexColors: true, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide });
  const barkMat = new THREE.MeshBasicMaterial({ map: barkTex, vertexColors: true, side: THREE.DoubleSide });
  const geo = (p, c, u, i) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("color", new THREE.BufferAttribute(c, 3)); g.setAttribute("uv", new THREE.BufferAttribute(u, 2)); g.setIndex(i); g.computeBoundingSphere(); return g; };
  const protos = TREE_NAMES.map((n, ni) => [...Array(VARIANTS)].map((_, v) => {
    const t = makeTree(n, 7000 + ni * 1000 + v * 37);
    return { bark: geo(t.tp, t.tc, t.tu, t.ti), leaf: t.fi.length ? geo(t.fp, t.fc, t.fu, t.fi) : null };
  }));
  const group = new THREE.Group(); scene.add(group);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  // trees: [{ x, z, n (species index), v (variant), rot, sc, b (block id it stands on, or null) }]; yOf(t) gives its foot
  function rebuild(trees, yOf) {
    for (const c of [...group.children]) { group.remove(c); c.dispose(); }
    const per = new Map();
    for (const t of trees) { const k = t.n * VARIANTS + t.v; if (!per.has(k)) per.set(k, []); per.get(k).push(t); }
    for (const [k, list] of per) {
      const pr = protos[Math.floor(k / VARIANTS)][k % VARIANTS];
      for (const [g, mat] of [[pr.bark, barkMat], [pr.leaf, leafMat]]) {
        if (!g) continue;
        const im = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach((t, i) => im.setMatrixAt(i, M.compose(P.set(t.x, yOf(t), t.z), Q.setFromAxisAngle(UP, t.rot), S.setScalar(t.sc))));
        im.frustumCulled = false; group.add(im);
      }
    }
  }
  return { rebuild };
}

// ---------------------------------------------------------------- the land
// Every kind of land the simulator has, painted into three RGB splat maps over a 800 m square (0.78 m a pixel):
//   A = asphalt, dirt path, gravel · B = hay field, forest floor, raised bog · C = reeds, open water, flooded ground.
// Grass is all channels at zero. A dab is drawn on all three maps at once with the same soft alpha: its own channel is
// pushed toward full and every other one is faded by the same amount, so the weights always add up to at most one.
// Water is not a texture: the ground is cut away (discard) and a mirror lying WATER_Y below shows through the hole.
// Bog, reeds and flooded ground also get their own pools of standing water, with the same formulas as the simulator.
export const WATER_Y = -0.4;
export const LAND = [                             // [id, label, map, channel, swatch colour]
  ["grass", "Grass", -1, -1, "#6f8a4e"], ["field", "Hay field", 1, 0, "#b4a565"], ["litter", "Forest floor", 1, 1, "#6e5a3c"],
  ["bog", "Bog", 1, 2, "#8c8a4f"], ["reeds", "Reeds", 2, 0, "#5f6a37"], ["flood", "Flooded", 2, 2, "#3f4a35"], ["water", "Water", 2, 1, "#2c3f4a"],
  ["gravel", "Gravel", 0, 2, "#9a968c"], ["dirt", "Dirt path", 0, 1, "#8a6a48"], ["asphalt", "Asphalt", 0, 0, "#6b6e72"],
];
const fr = (v) => v - Math.floor(v), sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const h2 = (x, y) => { let px = fr(x * 0.1031), py = fr(y * 0.1030); const d = px * (py + 33.33) + py * (px + 33.33); px += d; py += d; return fr((px + py) * py); };
const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y); let u = x - i, v = y - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  return (h2(i, j) * (1 - u) + h2(i + 1, j) * u) * (1 - v) + (h2(i, j + 1) * (1 - u) + h2(i + 1, j + 1) * u) * v; };
// bog and reed pools: same as poolS() in the shader below and poolAt() in forest_gen.js (metres inside the nearest pool)
function poolAt(xw, zw, w, sc = 1, ox = 0, oz = 0) {
  const amt = sst(0.55, 0.95, w); if (amt < 0.01) return -9;
  const x = xw / sc + ox, z = zw / sc + oz, ang = vn(x / 260 + 4.1, z / 260 + 4.1) * 3, gx = Math.floor(x / 13), gz = Math.floor(z / 13); let best = -9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const ix = gx + i, iz = gz + j, pd = sst(0.25, 0.75, vn((ix + 0.5) * 13 / 220 + 13.3, (iz + 0.5) * 13 / 220 + 13.3)); if (h2(ix + 5.1, iz + 5.1) > 0.1 + 0.75 * pd) continue;
    const cx = (ix + 0.2 + 0.6 * h2(ix + 1.3, iz + 1.3)) * 13, cz = (iz + 0.2 + 0.6 * h2(ix + 3.7, iz + 3.7)) * 13, dx = x - cx, dz = z - cz;
    const a = ang + (h2(ix + 2.2, iz + 2.2) - 0.5) * 0.7, k = 1 + 1.5 * h2(ix + 7.7, iz + 7.7), R = 13 * (0.05 + 0.2 * Math.pow(h2(ix + 11.1, iz + 11.1), 2)) * amt * (0.7 + 0.6 * pd);
    const ux = Math.cos(a) * dx + Math.sin(a) * dz, uz = -Math.sin(a) * dx + Math.cos(a) * dz; best = Math.max(best, R - Math.hypot(ux / k, uz)); }
  return (best + (vn(x / 1.9 + 5.5, z / 1.9 + 5.5) - 0.5) * 0.8 * amt) * sc;
}

// still, dark water with a real reflection (as the simulator's, world.js)
const WATER_VERT = `varying vec3 vW; varying vec3 vP; varying vec4 vUvR; uniform mat4 textureMatrix;
  void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vUvR = textureMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * w; }`;
const WATER_FRAG = `uniform sampler2D map; uniform sampler2D tDiffuse; uniform float time; uniform vec3 skyH; uniform vec3 skyZ; uniform vec3 fogC; uniform vec2 fogR;
  varying vec3 vW; varying vec3 vP; varying vec4 vUvR;
  void main() {
    vec2 p = vP.xy;
    vec3 ph = mix(texture2D(map, p / 9.0 + vec2(time * 0.004, 0.0)).rgb, texture2D(map, p.yx / 31.0 + 0.4 - vec2(0.0, time * 0.002)).rgb, 0.5);
    vec3 V = normalize(cameraPosition - vW); float c = clamp(V.y, 0.0, 1.0), F = 0.04 + 0.96 * pow(1.0 - c, 4.0);
    vec3 refl = texture2DProj(tDiffuse, vec4(vUvR.xy + (ph.rg - 0.45) * vUvR.w * 0.008, vUvR.zw)).rgb;
    vec3 deep = vec3(0.030, 0.026, 0.018) * (0.7 + 0.9 * ph.g);
    vec3 col = mix(deep, refl * vec3(0.58, 0.60, 0.56), clamp(0.07 + F * 0.8, 0.0, 0.8));
    gl_FragColor = vec4(mix(col, fogC, smoothstep(fogR.x, fogR.y, length(cameraPosition - vW))), 1.0);
    #include <colorspace_fragment>
  }`;

export function createGround(scene, fog, sky) {
  const HALF = 400, RES = 1024;
  const maps = [0, 1, 2].map(() => { const c = document.createElement("canvas"); c.width = c.height = RES; const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, RES, RES);
    const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.NoColorSpace; return { c, ctx, t, px: null }; });
  const TL = new THREE.TextureLoader(), tile = (u) => { const t = TL.load(u); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  const F = "./assets/forest/";
  const GLSL_TILE = `
      float h2(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      // Stochastic (hex) tiling, the same as the simulator's ground (forest_gen.js): the plane is cut into a triangle grid,
      // every grid point shows the photo shifted by its own random amount, and each pixel blends the three nearest, so the
      // photo never lines up with itself. The blend is stretched back around the photo's average colour to keep contrast.
      vec3 stoch(sampler2D t, vec2 uv, vec2 dx, vec2 dy, vec3 mean) {
        vec2 sk = vec2(uv.x, -0.57735027 * uv.x + 1.15470054 * uv.y) * 3.464, b = floor(sk), f = fract(sk); float z = 1.0 - f.x - f.y, w1, w2, w3; vec2 v1, v2, v3;
        if (z > 0.0) { w1 = z; w2 = f.y; w3 = f.x; v1 = b; v2 = b + vec2(0.0, 1.0); v3 = b + vec2(1.0, 0.0); }
        else { w1 = -z; w2 = 1.0 - f.y; w3 = 1.0 - f.x; v1 = b + vec2(1.0, 1.0); v2 = b + vec2(1.0, 0.0); v3 = b + vec2(0.0, 1.0); }
        vec3 c = w1 * (textureGrad(t, uv + vec2(h2(v1), h2(v1 + 17.3)), dx, dy).rgb - mean) + w2 * (textureGrad(t, uv + vec2(h2(v2), h2(v2 + 17.3)), dx, dy).rgb - mean)
               + w3 * (textureGrad(t, uv + vec2(h2(v3), h2(v3 + 17.3)), dx, dy).rgb - mean);
        return max(mean + c / sqrt(w1 * w1 + w2 * w2 + w3 * w3), 0.0);
      }
      vec3 tile(sampler2D t, vec2 p, float m, vec2 dx, vec2 dy) { vec3 mean = textureLod(t, p / m, 12.0).rgb; return stoch(t, p / m, dx / m, dy / m, mean); }
`;
  const mat = new THREE.ShaderMaterial({
    uniforms: { tGrass: { value: tile(F + "g_grass.jpg") }, tField: { value: tile(F + "g_field.jpg") }, tLitter: { value: tile(F + "g_litter.jpg") }, tGravel: { value: tile(F + "g_gravel.jpg") }, tMoss: { value: tile(F + "g_moss.jpg") },
      tAsph: { value: tile("./assets/asphalt.jpg") }, tDirt: { value: tile("./assets/dirt.jpg") },
      sA: { value: maps[0].t }, sB: { value: maps[1].t }, sC: { value: maps[2].t }, uHalf: { value: HALF }, fogC: { value: fog.color }, fogR: { value: new THREE.Vector2(fog.near, fog.far) } },
    vertexShader: "varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `uniform sampler2D tGrass; uniform sampler2D tField; uniform sampler2D tLitter; uniform sampler2D tGravel; uniform sampler2D tMoss; uniform sampler2D tAsph; uniform sampler2D tDirt;
      uniform sampler2D sA; uniform sampler2D sB; uniform sampler2D sC; uniform float uHalf; uniform vec3 fogC; uniform vec2 fogR; varying vec3 vW;
      ${GLSL_TILE}
      // bog and reed pools (the simulator's poolS): metres inside the nearest pool, negative outside
      float poolS(vec2 pw, float w, float sc, vec2 off) {
        float amt = smoothstep(0.55, 0.95, w); if (amt < 0.01) return -9.0;
        vec2 p = pw / sc + off; float ang = vn(p / 260.0 + 4.1) * 3.0, best = -9.0; vec2 g = floor(p / 13.0);
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) { vec2 id = g + vec2(float(i), float(j));
          float pd = smoothstep(0.25, 0.75, vn((id + 0.5) * 13.0 / 220.0 + 13.3));
          if (h2(id + 5.1) > 0.1 + 0.75 * pd) continue;
          vec2 c = (id + 0.2 + 0.6 * vec2(h2(id + 1.3), h2(id + 3.7))) * 13.0, d = p - c;
          float a = ang + (h2(id + 2.2) - 0.5) * 0.7, k = 1.0 + 1.5 * h2(id + 7.7), R = 13.0 * (0.05 + 0.2 * pow(h2(id + 11.1), 2.0)) * amt * (0.7 + 0.6 * pd);
          d = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y); best = max(best, R - length(vec2(d.x / k, d.y)));
        }
        return (best + (vn(p / 1.9 + 5.5) - 0.5) * 0.8 * amt) * sc;
      }
      void main() {
        vec2 p = vW.xz, dx = dFdx(p), dy = dFdy(p); float dist = length(cameraPosition - vW);
        vec2 uv = (p + uHalf) / (2.0 * uHalf); vec3 A = vec3(0.0), B = vec3(0.0), C = vec3(0.0);
        if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) { A = texture2D(sA, uv).rgb; B = texture2D(sB, uv).rgb; C = texture2D(sC, uv).rgb; }
        float n = (vn(p * 1.4) - 0.5) * 0.3 + (vn(p / 3.5) - 0.5) * 0.25;                       // borders wander a little
        float broad = vn(p / 31.0), mid = vn(p / 7.0 + 7.3), mac = broad * 0.6 + mid * 0.4, dry = vn(p / 70.0 + 3.1);
        vec3 g = tile(tGrass, p, 1.5, dx, dy);
        g *= (0.78 + 0.45 * mac) * mix(vec3(0.97, 1.0, 1.02), vec3(1.1, 1.03, 0.82), smoothstep(0.45, 0.8, dry));
        vec3 col = mix(vec3(dot(g, vec3(0.3, 0.6, 0.1))), g, 0.62) * vec3(0.9, 0.88, 0.8);       // muted, a little dry, like the simulator
        float wf = smoothstep(0.3, 0.6, B.r + n), wl = smoothstep(0.3, 0.6, B.g + n), wb = smoothstep(0.15, 0.55, B.b + n * 0.5), wr = smoothstep(0.15, 0.55, C.r + n * 0.5);
        float wg = smoothstep(0.3, 0.6, A.b + n), wd = smoothstep(0.32, 0.62, A.g + n), wa = smoothstep(0.42, 0.58, A.r + n * 0.4);
        if (wf > 0.004) col = mix(col, tile(tField, p, 2.5, dx, dy) * (0.8 + 0.4 * mac), wf);
        if (wl > 0.004) col = mix(col, tile(tLitter, p, 3.0, dx, dy) * (0.7 + 0.5 * mac), wl);
        if (wg > 0.004) {                         // gravel: a height blend, so stones stand clear of the grass at the border
          vec3 sm = textureLod(tGravel, p / 1.6, 12.0).rgb, st = tile(tGravel, p, 1.6, dx, dy);
          float hs = (dot(st, vec3(0.3, 0.6, 0.1)) / max(dot(sm, vec3(0.3, 0.6, 0.1)), 1e-4) - 1.0);
          col = mix(col, st, clamp((wg - 0.5) * 3.0 + 0.5 + hs * 1.2, 0.0, 1.0));
        }
        if (wb > 0.004) {                         // raised bog: sphagnum lawn, sedge hummocks, rust and yellow patches
          vec3 mm = tile(tMoss, p, 1.3, dx, dy), sd = tile(tField, p, 2.0, dx, dy);
          float hum = smoothstep(0.45, 0.72, vn(p / 3.5 + 1.7) * 0.75 + vn(p / 2.1 + 3.1) * 0.25), rust = smoothstep(0.55, 0.8, vn(p / 7.0 + 9.1)), yel = vn(p / 23.0 + 2.9);
          vec3 bc = mix(mm, sd * vec3(0.78, 0.66, 0.5), hum * 0.8) * mix(vec3(1.0), vec3(1.12, 0.8, 0.62), rust * 0.6) * mix(vec3(0.84, 0.95, 0.86), vec3(1.0, 1.0, 0.8), yel) * (0.75 + 0.5 * mac);
          col = mix(col, bc, wb);
        }
        if (wr > 0.004) col = mix(col, mix(col * vec3(0.5, 0.52, 0.38), vec3(0.24, 0.29, 0.13) * (0.85 + 0.4 * mac), smoothstep(60.0, 160.0, dist)), wr);   // wet dark ground under the reeds
        // standing water: open water where it was painted, pools in bog and reeds, pools with islands in flooded ground
        float ps = max(poolS(p, B.b, 1.0, vec2(0.0)), poolS(p, C.r, 2.4, vec2(91.7, 37.1)));
        if (C.b > 0.02) { col = mix(col, col * vec3(0.62, 0.64, 0.55), smoothstep(0.1, 0.5, C.b)); ps = max(ps, ((C.b * 0.62 - vn(p / 9.0 + 31.7) * 0.9 + 0.12) * 1.4 - 0.15) * 6.0); }
        if (wd + wa > 0.05) ps = -9.0;            // no pools on a road
        ps = max(ps, (C.g - 0.5 + n * 0.35) * 8.0);
        if (ps > -2.0) { col *= mix(vec3(1.0), vec3(0.42, 0.40, 0.33), smoothstep(-0.8, -0.05, ps)); if (ps > 0.0) discard; }   // dark wet ground at the waterline
        if (wd > 0.004) col = mix(col, tile(tDirt, p, 3.0, dx, dy) * (0.85 + 0.3 * vn(p / 5.0)), wd);
        if (wa > 0.004) col = mix(col, tile(tAsph, p, 4.0, dx, dy) * (0.86 + 0.16 * vn(p / 9.0 + 7.0) + 0.1 * vn(p / 1.7 + 2.0)), wa);   // patched, unevenly worn
        gl_FragColor = vec4(mix(col, fogC, smoothstep(fogR.x, fogR.y, dist)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mat); mesh.rotation.x = -Math.PI / 2; scene.add(mesh);

  // the water surface: one mirror under the whole paintable square, seen only through the holes in the ground
  const waterTex = TL.load("./assets/water.jpg"); waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping; waterTex.colorSpace = THREE.SRGBColorSpace;
  const mirror = new Reflector(new THREE.PlaneGeometry(2 * HALF, 2 * HALF), { textureWidth: 1024, textureHeight: 1024, clipBias: 0.003,
    shader: { uniforms: { map: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, color: { value: null }, time: { value: 0 }, skyH: { value: new THREE.Color() }, skyZ: { value: new THREE.Color() }, fogC: { value: new THREE.Color() }, fogR: { value: new THREE.Vector2() } },
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG } });
  const U = mirror.material.uniforms; U.map.value = waterTex; U.skyH.value.copy(sky); U.skyZ.value.set(0x8ea6bd); U.fogC.value.copy(fog.color); U.fogR.value.set(fog.near, fog.far);
  mirror.rotation.x = -Math.PI / 2; mirror.position.y = WATER_Y; mirror.visible = false; scene.add(mirror);

  // reeds: crossed photo cards, scattered over the painted reed beds (and into the shallow edge of their pools)
  const reedTex = TL.load(F + "reed.png"); reedTex.colorSpace = THREE.SRGBColorSpace;
  const reedMat = new THREE.MeshBasicMaterial({ map: reedTex, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide });
  const reedGeo = new THREE.BufferGeometry(); {
    const p = [], u = [], ix = []; for (let q = 0; q < 2; q++) { const a = q * Math.PI / 2, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, k = q * 4;
      p.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz); u.push(0, 0, 1, 0, 1, 1, 0, 1); ix.push(k, k + 1, k + 2, k, k + 2, k + 3); }
    reedGeo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); reedGeo.setAttribute("uv", new THREE.Float32BufferAttribute(u, 2)); reedGeo.setIndex(ix); }
  let reeds = null;

  const toPx = (x, z) => [((x + HALF) / (2 * HALF)) * RES, ((z + HALF) / (2 * HALF)) * RES];
  const KIND = Object.fromEntries(LAND.map(([id, , m, ch]) => [id, [m, ch]]));
  function dab(x, z, r, kind) {                   // one soft round dab on all three maps; returns the pixel box it touched
    const [px, py] = toPx(x, z), pr = (r / (2 * HALF)) * RES, [km, kc] = KIND[kind];
    maps.forEach((M, mi) => {
      const rgb = [0, 0, 0]; if (mi === km) rgb[kc] = 255; const c = rgb.join(","), gr = M.ctx.createRadialGradient(px, py, 0, px, py, pr);
      gr.addColorStop(0, `rgba(${c},1)`); gr.addColorStop(0.55, `rgba(${c},0.9)`); gr.addColorStop(1, `rgba(${c},0)`);
      M.ctx.fillStyle = gr; M.ctx.beginPath(); M.ctx.arc(px, py, pr, 0, Math.PI * 2); M.ctx.fill(); M.t.needsUpdate = true;
    });
    if (kind === "water" || kind === "flood" || kind === "bog" || kind === "reeds") mirror.visible = true;
    return [Math.floor(px - pr - 1), Math.floor(py - pr - 1), Math.ceil(px + pr + 1), Math.ceil(py + pr + 1)];
  }
  // undo support: the whole land before a stroke, and the changed box before and after it
  const grabAll = () => maps.map((M) => M.ctx.getImageData(0, 0, RES, RES));
  function crop(img, x, y, w, h) { const o = new ImageData(w, h); for (let j = 0; j < h; j++) o.data.set(img.data.subarray(((y + j) * RES + x) * 4, ((y + j) * RES + x + w) * 4), j * w * 4); return o; }
  function patch(before, box) {
    const x0 = Math.max(0, box[0]), y0 = Math.max(0, box[1]), x1 = Math.min(RES, box[2]), y1 = Math.min(RES, box[3]); if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, before: before.map((im) => crop(im, x0, y0, x1 - x0, y1 - y0)), after: maps.map((M) => M.ctx.getImageData(x0, y0, x1 - x0, y1 - y0)) };
  }
  function put(pt, which) { maps.forEach((M, i) => { M.ctx.putImageData(pt[which][i], pt.x, pt.y); M.t.needsUpdate = true; }); sync(); }
  function clear() { for (const M of maps) { M.ctx.fillStyle = "#000"; M.ctx.fillRect(0, 0, RES, RES); M.t.needsUpdate = true; } sync(); }
  const serialize = () => maps.map((M) => M.c.toDataURL("image/png"));
  async function deserialize(urls) {              // an old save has one map (asphalt and dirt), which is map A
    if (typeof urls === "string") urls = [urls];
    await Promise.all(urls.map((u, i) => new Promise((res) => { const im = new Image(); im.onload = () => { maps[i].ctx.drawImage(im, 0, 0); maps[i].t.needsUpdate = true; res(); }; im.onerror = res; im.src = u; })));
    sync();
  }
  // What stands at (x, z): the channel weights (0..1) read back from the maps, and whether there is water there
  const at = (x, z) => { const [px, py] = toPx(x, z), i = Math.floor(px), j = Math.floor(py); if (i < 0 || j < 0 || i >= RES || j >= RES || !maps[0].px) return null; const o = (j * RES + i) * 4; return maps.map((M) => [M.px[o] / 255, M.px[o + 1] / 255, M.px[o + 2] / 255]); };
  function waterDepth(x, z, w = at(x, z)) {       // metres inside standing water (negative on dry land), as the shader works it out
    if (!w) return -9; const [A, B, C] = w; if (A[0] + A[1] > 0.1) return Math.max(-9, (C[1] - 0.5) * 8);
    let ps = Math.max(poolAt(x, z, B[2]), poolAt(x, z, C[0], 2.4, 91.7, 37.1), (C[1] - 0.5) * 8);
    if (C[2] > 0.02) ps = Math.max(ps, ((C[2] * 0.62 - vn(x / 9 + 31.7, z / 9 + 31.7) * 0.9 + 0.12) * 1.4 - 0.15) * 6);
    return ps;
  }
  // after any change: read the maps back, show the mirror only if there is water, and re-sow the reeds
  function sync() {
    let wet = false; for (const M of maps) M.px = M.ctx.getImageData(0, 0, RES, RES).data;
    const B = maps[1].px, C = maps[2].px;
    for (let o = 0; o < C.length; o += 4) if (C[o] > 140 || C[o + 1] > 100 || C[o + 2] > 60 || B[o + 2] > 140) { wet = true; break; }
    mirror.visible = wet;
    if (reeds) { scene.remove(reeds); reeds.dispose(); reeds = null; }
    const list = [], step = (2 * HALF) / RES;
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const o = (j * RES + i) * 4, r = C[o] / 255; if (r < 0.1) continue;
      const x = -HALF + (i + h2(i, j + 0.5)) * step, z = -HALF + (j + h2(i + 0.5, j)) * step;
      if (h2(i + 3.3, j + 7.1) > 0.22 * sst(0.1, 0.85, r) * sst(0.25, 0.65, vn(x / 11, z / 11) + (r - 0.5) * 0.8)) continue;     // clumps and gaps
      const d = waterDepth(x, z); if (d > 1.2 || maps[0].px[o] + maps[0].px[o + 1] > 60) continue;                              // not out in the open water, not on a road
      list.push([x, z, d > -0.3 ? WATER_Y - 0.05 : -0.2, 0.7 + h2(i + 9.1, j) * 1.1, h2(i, j + 4.4) * 3.14, 0.75 + h2(i + 1.7, j + 2.9) * 0.45]);
      if (list.length > 150000) break;
    }
    if (list.length) {
      reeds = new THREE.InstancedMesh(reedGeo, reedMat, list.length); const M = new THREE.Matrix4(), Qn = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
      list.forEach(([x, z, y, h, rot, v], k) => { reeds.setMatrixAt(k, M.compose(P.set(x, y, z), Qn.setFromAxisAngle(UP, rot), Sc.set(h * 0.9, h, h * 0.9))); reeds.setColorAt(k, c.setRGB(v * 0.9, v * 0.86, v * 0.6)); });
      reeds.frustumCulled = false; scene.add(reeds);
    }
  }
  const update = (t) => { U.time.value = t; };
  // the surface of roads (and their kerbs): dark worn asphalt, with patches, lighter wheel tracks and grime at the edges;
  // kerbs of 1 m concrete stones. attribute rk: on a road x -1..1 across it and y = -its width; on a kerb x metres along
  // it and y 1 (top) or 0.6 (side)
  const roadMat = new THREE.ShaderMaterial({
    uniforms: { tAsph: mat.uniforms.tAsph, fogC: { value: fog.color }, fogR: { value: new THREE.Vector2(fog.near, fog.far) } },
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: "attribute vec2 rk; varying vec3 vW; varying vec2 vRk; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vRk = rk; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `uniform sampler2D tAsph; uniform vec3 fogC; uniform vec2 fogR; varying vec3 vW; varying vec2 vRk;
      ${GLSL_TILE}
      void main() {
        vec2 p = vW.xz, dx = dFdx(p), dy = dFdy(p); vec3 col;
        if (vRk.y < 0.3) {
          float w = max(-vRk.y, 1.0), x = abs(vRk.x) * w * 0.5;                         // metres from the centre line
          vec3 t = tile(tAsph, p, 1.7, dx, dy); float l = dot(t, vec3(0.3, 0.6, 0.1));
          col = mix(vec3(l), t, 0.3) * 0.62 * (0.9 + 0.2 * vn(p / 11.0 + 3.0));
          col *= mix(1.0, 0.8, smoothstep(0.6, 0.64, vn(p / 7.0 + 11.0)));             // patched
          float c1 = w >= 6.0 ? 1.0 : 0.75, c2 = w >= 6.0 ? 2.5 : 0.75;
          float tr = exp(-pow((x - c1) / 0.35, 2.0)) + exp(-pow((x - c2) / 0.35, 2.0));
          col *= 1.0 + 0.13 * min(tr, 1.0) * (0.6 + 0.4 * vn(p * 0.4));                 // polished where the wheels go
          col *= mix(1.0, 0.78, smoothstep(w * 0.5 - 0.7, w * 0.5, x));                 // grime along the kerb
        } else {
          float st = floor(vRk.x), f = fract(vRk.x);
          col = vec3(0.37, 0.36, 0.34) * (0.84 + 0.22 * vn(p * 2.3 + st * 7.1)) * (0.93 + 0.07 * vn(p * 23.0 + vW.y * 17.0)) * (0.86 + 0.24 * h2(vec2(st, 3.7)));
          col *= mix(0.55, 1.0, smoothstep(0.0, 0.03, f) * smoothstep(1.0, 0.97, f));   // the joints between stones
          col *= vRk.y > 0.9 ? 1.0 : 0.72;
        }
        gl_FragColor = vec4(mix(col, fogC, smoothstep(fogR.x, fogR.y, length(cameraPosition - vW))), 1.0);
        #include <colorspace_fragment>
      }` });
  return { roadMat, mesh, dab, grabAll, patch, put, clear, serialize, deserialize, sync, at, waterDepth, update, HALF, RES };
}
