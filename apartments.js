// Soviet panel apartment blocks, assembled on the fly from pre-made pieces (assets/apt/pieces.json, exported from
// Blender by apartments/export_pieces.py). A block in the map data is only a rectangle, a number of floors, a wall
// finish and a seed (assets/buildings.json, terrain/buildings_map.py); the rules here turn it into a list of pieces —
// window panels, balconies, stairwell and entrance, end walls, plinth, parapet, roof boxes, drainpipes.
// Every piece type is ONE InstancedMesh for a whole stretch of the route. Per instance: which window photo, door,
// glazing or balcony front, the wall finish and tint, a random number (seams), and where the block's roof is (grime).
// Piece frame (Blender): x along the facade, y into the building, z up. Map frame here: x east, y up, z = -north.
import * as THREE from "three";

const SUN = new THREE.Vector3(30, 45, 62).normalize();      // in the map frame (main.js swings the scene light round instead)
const FIN = ["concrete", "tiles_beige", "tiles_white", "painted_pink", "painted_blue", "painted_yellow", "brick_white", "brick_red"];
// finish -> [wall atlas tile (0 concrete, 1 painted, 2 tiles, 3 white brick, 4 red brick, 5 siding), tint (linear), seams]
const FINISH = { concrete: [0, [1, 1, 1], 1], tiles_beige: [2, [0.95, 0.88, 0.76], 1], tiles_white: [2, [0.98, 0.98, 0.97], 1], painted_pink: [1, [0.92, 0.66, 0.58], 1],
  painted_blue: [1, [0.66, 0.8, 0.9], 1], painted_yellow: [1, [0.95, 0.86, 0.6], 1], brick_white: [3, [1, 1, 1], 0], brick_red: [4, [1, 1, 1], 0] };
const MAIN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12], TWO = [5, 6, 7, 8, 9, 11, 12], BARS = 10;

const VERT = `
  attribute float mid; attribute vec4 iVar; attribute vec4 iWall; attribute vec4 iUv;
  varying vec3 vM; varying vec2 vUv; varying vec2 vLoc; varying float vMid; varying vec4 vVar; varying vec4 vWall; varying vec4 vSh; varying float vDist;
  void main() {
    vec4 m = instanceMatrix * vec4(position, 1.0); vM = m.xyz;                     // relative to the chunk's origin (small numbers: no float jitter); textures stay put while the map moves
    vec4 mv = modelViewMatrix * m; vDist = length(mv.xyz);
    vUv = uv; vLoc = position.xz; vMid = mid; vVar = iVar; vWall = iWall; vSh = iUv;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform sampler2D tWalls; uniform sampler2D tWin; uniform sampler2D tGlz; uniform sampler2D tDoor; uniform sampler2D tFront; uniform sampler2D tStuff; uniform sampler2D tPipe; uniform sampler2D tEnt;
  uniform vec3 fogC; uniform vec2 fogR; uniform vec3 camM; uniform vec2 psize; uniform vec3 sun;
  varying vec3 vM; varying vec2 vUv; varying vec2 vLoc; varying float vMid; varying vec4 vVar; varying vec4 vWall; varying vec4 vSh; varying float vDist;
  float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  vec3 wallTex(float tile, vec2 p) {                      // one tile of the 3 x 2 wall atlas, repeating every 2 m
    vec2 q = p / 2.0, g = vec2(mod(tile, 3.0), floor(tile / 3.0)), f = fract(q) * 0.996 + 0.002;
    return textureGrad(tWalls, vec2((g.x + f.x) / 3.0, (1.0 - g.y + f.y) / 2.0), dFdx(q) / vec2(3.0, 2.0), dFdy(q) / vec2(3.0, 2.0)).rgb;   // top row of the image = tiles 0-2
  }
  void main() {
    int id = int(vMid + 0.5);
    vec3 N = normalize(cross(dFdx(vM), dFdy(vM)));
    vec3 T = abs(N.y) > 0.7 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), N));
    vec2 wp = abs(N.y) > 0.7 ? vM.xz : vec2(dot(vM, T), vM.y);                         // texture coordinates on whatever plane this face lies in
    vec3 col; float a = 1.0;
    if (id <= 1) {                                         // wall and window reveals: the block's finish
      col = wallTex(vWall.x, wp) * vWall.yzw;
      if (vVar.z > 0.5 && id == 0) {                        // panel joints, then grime (vVar.w: this panel's random; vVar.z: seams on)
        float e = min(min(vLoc.x, psize.x - vLoc.x), min(vLoc.y, psize.y - vLoc.y)), thick = step(0.9, vVar.w);
        float f = clamp((e - 0.012 - thick * 0.02) / 0.03, 0.0, 1.0);
        col = mix(mix(vec3(0.16, 0.16, 0.15), vec3(0.5, 0.5, 0.48), step(vVar.w, 0.18)), col, f);
      }
      float streak = max((h1(floor(wp.x * 9.0)) * 0.6 + h1(floor(wp.x * 23.0) + 3.0) * 0.4 - 0.62) * 3.0, 0.0);
      float under = step(0.65, vLoc.x) * step(vLoc.x, 2.55) * step(vLoc.y, 0.8) * (vLoc.y / 0.8) * step(3.1, psize.x);
      float roof = max(1.0 - (vVar.y - vM.y) / 3.0, 0.0), foot = max(1.0 - (vM.y - vVar.x) / 2.2, 0.0);
      col = mix(col, vec3(0.22, 0.21, 0.19), min(streak * (under * 1.2 + roof * 0.7) + foot * 0.22, 0.6));
    } else if (id == 2) {                                  // window: the photo in the tile this instance picked
      col = texture2D(tWin, vUv + vSh.xy).rgb * vec3(0.82, 0.83, 0.85);
    } else if (id == 4 || id == 9) { col = wallTex(0.0, wp) * (id == 4 ? vec3(0.82, 0.81, 0.78) : vec3(0.72, 0.71, 0.68)); }
    else if (id == 5) col = vec3(0.12, 0.13, 0.13);
    else if (id == 6) col = wallTex(1.0, wp) * vec3(0.7, 0.74, 0.7);
    else if (id == 7) col = wallTex(5.0, wp) * 0.95;
    else if (id == 8) col = vec3(0.09, 0.09, 0.1);
    else if (id == 10) col = vec3(0.2, 0.13, 0.1);
    else if (id == 11) col = vec3(0.02);
    else if (id == 12) col = vec3(0.55, 0.56, 0.56);
    else if (id == 3) col = vec3(0.85, 0.85, 0.82);
    else if (id == 13) col = texture2D(tGlz, vUv - vec2(0.0, vSh.w / 4.0)).rgb;
    else if (id == 14) col = texture2D(tDoor, vUv + vec2(vSh.z / 4.0, 0.0)).rgb * 0.9;
    else if (id == 15) col = texture2D(tFront, vUv - vec2(0.0, vSh.w / 4.0)).rgb;
    else if (id == 16) { vec4 s = texture2D(tStuff, vUv); if (s.a < 0.5) discard; col = s.rgb; }
    else if (id == 18) col = texture2D(tEnt, vUv + vec2(vSh.z / 4.0, 0.0)).rgb * 0.92;   // entrance door: one of 4 (iUv.z)
    else { vec4 s = texture2D(tPipe, vUv); if (s.a < 0.5) discard; col = s.rgb; }
    float lit = 0.62 + 0.55 * max(dot(N, sun), 0.0) + 0.08 * N.y;                     // soft sky light plus the sun
    col *= lit;
    gl_FragColor = vec4(mix(col, fogC, smoothstep(fogR.x, fogR.y, vDist)), a);
    #include <colorspace_fragment>
  }`;

export async function createApartments(fog) {
  const P = await fetch("./assets/apt/pieces.json").then((r) => r.json());
  const TL = new THREE.TextureLoader(), tex = (f, rep) => { const t = TL.load("./assets/apt/" + f); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const camM = { value: new THREE.Vector3() };
  const uniBase = { tWalls: { value: tex("walls.jpg") }, tWin: { value: tex("windows.png") }, tGlz: { value: tex("glazing.png") }, tDoor: { value: tex("doors.png") },
    tFront: { value: tex("fronts.png") }, tStuff: { value: tex("stuff.png") }, tPipe: { value: tex("pipe.png", true) }, tEnt: { value: tex("entrance.png") }, fogC: { value: fog.color }, fogR: { value: new THREE.Vector2(fog.near, fog.far) },
    camM, sun: { value: SUN } };
  // one geometry per piece type; its atlas UVs point at the first tile, and are shifted per instance in the vertex data
  // of a COPY per variant would be wasteful, so the shift is done here by giving each instance its own uv offset attribute
  const geo = {};
  for (const [name, p] of Object.entries(P.pieces)) {
    const g = new THREE.BufferGeometry(), n = p.mat.length;
    g.setAttribute("position", new THREE.Float32BufferAttribute(p.pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(p.uv, 2));
    const mid = new Float32Array(n * 3); p.mat.forEach((m, i) => mid.fill(m, i * 3, i * 3 + 3)); g.setAttribute("mid", new THREE.BufferAttribute(mid, 1));
    geo[name] = { g, pw: p.pw, ph: p.ph, mat: new THREE.ShaderMaterial({ uniforms: Object.assign({}, uniBase, { psize: { value: new THREE.Vector2(p.pw, p.ph) } }), vertexShader: VERT, fragmentShader: FRAG, side: THREE.FrontSide }) };
  }
  const W = P.module, H = P.storey, PL = P.plinth, E4 = P.end_width;

  // ---- the rules: one block -> a list of placements [piece, origin (block frame), along-axis sign/axis, scale, variant]
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }
  function layout(b) {
    const r = rng(b.seed), out = [], sec = Math.max(1, b.sec), NM = 5 * sec, sx = b.L / (NM * W), FL = Math.max(1, b.fl), top = PL + FL * H, D = b.D, se = D / 4 / E4;
    const glazedShare = 0.4 + 0.4 * r();
    // facades as runs of modules: [start corner (bx, by), axis 0 = along the block (+x), 1 = along the end (+y); direction ±1; side]
    const sides = [["front", 0, 0, 0, 1], ["back", b.L, D, 0, -1]];
    for (const [side, ox, oy, ax, dir] of sides) for (let m = 0; m < NM; m++) {
      const sp = m % 5, x = ox + dir * m * W * sx;
      for (let f = 0; f < FL; f++) {
        let pc = "window", win = MAIN[Math.floor(r() * MAIN.length)], v2 = 0;
        if (side === "front" && sp === 2) { pc = f === 0 ? "entrance" : "stair"; win = TWO[Math.floor(r() * TWO.length)]; }
        else if (side === "back" && (sp === 1 || sp === 3) && f > 0) {
          win = TWO[Math.floor(r() * TWO.length)];
          if (r() < glazedShare) { pc = f === FL - 1 ? "balcony_glazed_top" : "balcony_glazed"; v2 = Math.floor(r() * 4); }
          else { const q = r(); pc = q < 0.35 ? "balcony_open_laundry" : q < 0.6 ? "balcony_open_junk" : "balcony_open"; v2 = Math.floor(r() * 4); }
        } else if (f === 0 && r() < 0.25) win = BARS;
        out.push([pc, x, oy, PL + f * H, ax, dir, sx, 1, win, v2, Math.floor(r() * 4)]);
      }
      out.push(["plinth", x, oy, 0, ax, dir, sx, 1, 0, 0, 0]); out.push(["parapet", x, oy, top, ax, dir, sx, 1, 0, 0, 0]);
    }
    for (const [ox, oy, dir] of [[0, D, -1], [b.L, 0, 1]]) for (let j = 0; j < 4; j++) {     // end walls: 4 panels across the depth
      const y = oy + dir * j * D / 4;
      for (let f = 0; f < FL; f++) { const nw = (j === 1 || j === 2) && r() < 0.3; out.push([nw ? "end_narrow" : "end", ox, y, PL + f * H, 1, dir, se, 1, TWO[Math.floor(r() * TWO.length)], 0, 0]); }
      out.push(["plinth_end", ox, y, 0, 1, dir, se, 1, 0, 0, 0]); out.push(["parapet_end", ox, y, top, 1, dir, se, 1, 0, 0, 0]);
    }
    out.push(["roof", 0, 0, top, 0, 1, b.L, D, 0, 0, 0, "flat"]);
    for (let s = 0; s < sec; s++) {
      out.push(["roof_exit", (s * 5 + 2.5) * W * sx - 1.3, D / 2 - 1.1, top, 0, 1, 1, 1, 0, 0, 0, "flat"]);
      for (const v of [0.8, 3.6]) out.push(["vent", (s * 5 + v) * W * sx, D * 0.3, top, 0, 1, 1, 1, 0, 0, 0, "flat"]);
    }
    for (const [ox, oy, dir] of [[0, 0, 1], [b.L, D, -1]]) for (const k of [0.35, b.L - 0.35])
      if (r() < 0.8) out.push(["pipe", k, oy, 0, 0, dir, 1, (top + 0.3) / (PL + 5 * H + 0.3), 0, 0, 0]);
    return { out, top, fin: FINISH[b.fin] || FINISH.concrete };
  }

  // ---- build the instanced meshes for a set of blocks. place(b) gives the block's corner in the map frame, the unit
  // vector along its long side and the unit vector into it from the front, and the ground height (all map frame).
  const M4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(0, 1, 0), O = new THREE.Vector3(), Zs = new THREE.Vector3();
  const BASE_TILE = { window: 0 };                                // the window tile each piece was exported with (balcony, stair, end walls: tile 5)
  function build(blocks, place, org = new THREE.Vector3()) {      // org: the group's origin in the map frame (instances are stored relative to it)
    const per = {};
    for (const b of blocks) {
      const { out, top, fin } = layout(b), pl = place(b), base = pl.y;
      for (const [pc, bx, by, bz, ax, dir, sxx, szz, win, v2, door, flat] of out) {
        if (flat) { X.copy(pl.u).multiplyScalar(sxx); Y.copy(pl.v).multiplyScalar(szz); Zs.copy(Z); }
        else { X.copy(ax === 0 ? pl.u : pl.v).multiplyScalar(dir); Y.crossVectors(Z, X); X.multiplyScalar(sxx); Zs.copy(Z).multiplyScalar(szz); }   // y into the building = up x along
        O.copy(pl.o).addScaledVector(pl.u, bx).addScaledVector(pl.v, by); O.y = base + bz; O.sub(org);
        (per[pc] ||= []).push([M4.makeBasis(X, Y, Zs).setPosition(O).clone(), win, v2, door, b, base, top, fin]);
      }
    }
    const grp = new THREE.Group(); grp.position.copy(org);
    for (const [pc, list] of Object.entries(per)) {
      const G = geo[pc], g = G.g.clone(), n = list.length, im = new THREE.InstancedMesh(g, G.mat, n), bt = BASE_TILE[pc] ?? 5;
      const iVar = new Float32Array(n * 4), iWall = new Float32Array(n * 4), iUv = new Float32Array(n * 4);
      list.forEach(([m, win, v2, door, b, base, top, fin], i) => {
        im.setMatrixAt(i, m); const rr = (Math.imul(b.seed + 1, 2654435761) ^ Math.imul(i + 7, 97)) >>> 0;
        iVar.set([base, base + top, fin[2], (rr % 1000) / 1000], i * 4); iWall.set([fin[0], ...fin[1]], i * 4);
        iUv.set([(win % 4 - bt % 4) / 4, -(Math.floor(win / 4) - Math.floor(bt / 4)) / 4, door, v2], i * 4);
      });
      g.setAttribute("iVar", new THREE.InstancedBufferAttribute(iVar, 4)); g.setAttribute("iWall", new THREE.InstancedBufferAttribute(iWall, 4));
      g.setAttribute("iUv", new THREE.InstancedBufferAttribute(iUv, 4));
      im.frustumCulled = false; grp.add(im);
    }
    return grp;
  }
  return { build, camM, FIN, geo, FINISH, P };      // geo, FINISH, P: for the sandbox (sandbox_blocks.js), which lays pieces along any path
}
