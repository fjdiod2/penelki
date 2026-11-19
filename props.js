// Yard and street props (benches, bins, ...) from assets/props/props.json (props/build_props.py in Blender).
// Every prop variant is ONE InstancedMesh per chunk. Per instance: a paint colour (the 'paint' materials) and a random.
// Prop frame (Blender): x along, y its back, z up, origin on the ground. UVs are metres; textures tile.
import * as THREE from "three";

const SUN = new THREE.Vector3(30, 45, 62).normalize();
export const PAINT = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];       // photo paint variants: metal green, blue, yellow, red; wood green, blue, red-brown, yellow

const VERT = `
  attribute float mid; attribute vec4 iPaint;
  varying vec3 vM; varying vec2 vUv; varying float vMid; varying vec4 vPaint; varying float vDist;
  void main() {
    vec4 m = instanceMatrix * vec4(position, 1.0); vM = m.xyz;
    vec4 mv = modelViewMatrix * m; vDist = length(mv.xyz);
    vUv = uv; vMid = mid; vPaint = iPaint;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform sampler2D tWood; uniform sampler2D tPlanks; uniform sampler2D tConc; uniform sampler2D tMetal; uniform sampler2D tGalv; uniform sampler2D tPole; uniform sampler2D tPoleW; uniform sampler2D tKiosk; uniform sampler2D tSand; uniform sampler2D tCar;
  uniform vec3 fogC; uniform vec2 fogR; uniform vec3 sun;
  varying vec3 vM; varying vec2 vUv; varying float vMid; varying vec4 vPaint; varying float vDist;
  vec3 painted(sampler2D t, vec2 p) {                     // one of the 4 photo paint variants in a 2 x 2 atlas (iPaint.x), tiling
    float k = mod(floor(vPaint.x + 0.5), 4.0); vec2 g = vec2(mod(k, 2.0), floor(k / 2.0)), f = fract(p) * 0.996 + 0.002;
    return textureGrad(t, vec2((g.x + f.x) / 2.0, (1.0 - g.y + f.y) / 2.0), dFdx(p) / 2.0, dFdy(p) / 2.0).rgb;
  }
  const vec3 CARS[10] = vec3[10](vec3(0.85, 0.85, 0.82), vec3(0.75, 0.68, 0.5), vec3(0.5, 0.06, 0.05), vec3(0.06, 0.12, 0.3), vec3(0.12, 0.3, 0.16),
    vec3(0.25, 0.06, 0.15), vec3(0.55, 0.57, 0.58), vec3(0.04, 0.04, 0.04), vec3(0.65, 0.5, 0.15), vec3(0.2, 0.42, 0.5));   // white, beige, cherry, navy, green, aubergine, silver, black, mustard, sea blue
  void main() {
    int id = int(vMid + 0.5);
    vec3 N = normalize(cross(dFdx(vM), dFdy(vM)));
    vec2 o = vec2(vPaint.a * 7.0, vPaint.a * 3.0);                 // each instance its own patch of the texture
    vec3 col;
    if (id == 0) col = painted(tWood, vUv / 1.2 + o);
    else if (id == 1) col = texture2D(tPlanks, vUv / 1.5 + o).rgb;
    else if (id == 2) col = texture2D(tConc, vUv / 1.5 + o).rgb * 0.95;
    else if (id == 3) col = painted(tMetal, vUv / 1.5 + o);
    else if (id == 4) col = vec3(0.07, 0.07, 0.07);
    else if (id == 5) col = texture2D(tGalv, vUv / 1.5 + o).rgb * 0.85;
    else if (id == 6) col = vec3(0.025);                           // inside of a bin
    else if (id == 7) col = vec3(0.74, 0.74, 0.72) * (0.85 + 0.15 * vPaint.a);   // satellite dish: white / light grey plastic-painted steel
    else if (id == 8) col = vec3(0.8, 0.8, 0.76);                  // street lamp glass (lit at night: later)
    else if (id == 9) col = texture2D(tPole, vUv / 1.5 + o).rgb;   // smooth concrete of poles
    else if (id == 10) col = texture2D(tPoleW, vUv / 1.2 + o).rgb; // wooden power pole
    else if (id == 11) col = vec3(0.8, 0.78, 0.72);                // porcelain insulator
    else if (id == 12) col = vec3(0.3, 0.5, 0.42);                 // green glass insulator
    else if (id == 13) col = texture2D(tKiosk, vUv).rgb;           // kiosk glass, door, shutter, sign (atlas)
    else if (id == 14) col = texture2D(tSand, vUv / 1.5 + o).rgb;  // sandbox sand
    else if (id == 15) { int k = int(vPaint.a * 10.0); vec4 t = texture2D(tCar, vUv); col = mix(t.rgb, CARS[k > 9 ? 9 : k] * t.rgb, t.a); }   // car body: atlas (car_tex.py), paint where alpha
    else if (id == 16) col = mix(vec3(0.05, 0.07, 0.08), vec3(0.45, 0.5, 0.55), 0.35 + 0.4 * max(N.y, 0.0));   // car glass: dark, sky in it
    else if (id == 17) col = vec3(0.04);                           // tyre
    else if (id == 18) col = vec3(0.62, 0.63, 0.64);               // chrome
    else if (id == 19) col = vec3(0.85, 0.85, 0.8);                // headlight
    else if (id == 20) col = vec3(0.6, 0.06, 0.04);                // tail light
    else col = vec3(0.88, 0.88, 0.86);                             // number plate
    col *= 0.62 + 0.55 * max(dot(N, sun), 0.0) + 0.08 * N.y;
    gl_FragColor = vec4(mix(col, fogC, smoothstep(fogR.x, fogR.y, vDist)), 1.0);
    #include <colorspace_fragment>
  }`;

export async function createProps(fog) {
  const P = await fetch("./assets/props/props.json").then((r) => r.json());
  const TL = new THREE.TextureLoader(), tex = (f) => { const t = TL.load("./assets/props/" + f); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const raw = (f) => { const t = tex(f); t.colorSpace = THREE.NoColorSpace; return t; };      // painted textures hold a mask, not a colour
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.FrontSide,
    uniforms: { tWood: { value: tex("wood_paint_atlas.png") }, tPlanks: { value: tex("planks.png") }, tConc: { value: tex("concrete.png") }, tMetal: { value: tex("metal_paint_atlas.png") }, tGalv: { value: tex("galv.png") }, tPole: { value: tex("pole_concrete.png") }, tPoleW: { value: tex("pole_wood.png") }, tKiosk: { value: tex("kiosk.png") }, tSand: { value: tex("sand.png") }, tCar: { value: (() => { const t = tex("car.png"); t.premultiplyAlpha = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; })() },
      fogC: { value: fog.color }, fogR: { value: new THREE.Vector2(fog.near, fog.far) }, sun: { value: SUN } } });
  const geo = {}, own = {};
  for (const [name, p] of Object.entries(P.props)) {
    const g = new THREE.BufferGeometry(), n = p.mat.length;
    g.setAttribute("position", new THREE.Float32BufferAttribute(p.pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(p.uv, 2));
    const mid = new Float32Array(n * 3); p.mat.forEach((m, i) => mid.fill(m, i * 3, i * 3 + 3)); g.setAttribute("mid", new THREE.BufferAttribute(mid, 1));
    geo[name] = g;
    if (p.tex) {                                                     // a photo car: its own atlas in place of the shared car texture
      const m = mat.clone(); m.uniforms = Object.assign({}, mat.uniforms, { tCar: { value: (() => { const t = tex(p.tex); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; })() } });
      own[name] = m;
    }
  }
  // items: [{ name, p: position (map frame), a: unit vector along the prop (map frame, horizontal), paint: [variant 0..3, 0, 0], r: random 0..1 }]
  const M4 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), Y = new THREE.Vector3(), O = new THREE.Vector3();
  function build(items, org = new THREE.Vector3()) {
    const per = {};
    for (const it of items) if (geo[it.name]) (per[it.name] ||= []).push(it);
    const grp = new THREE.Group(); grp.position.copy(org);
    for (const [name, list] of Object.entries(per)) {
      const g = geo[name].clone(), im = new THREE.InstancedMesh(g, own[name] || mat, list.length), paint = new Float32Array(list.length * 4);
      list.forEach((it, i) => {
        Y.crossVectors(UP, it.a); O.copy(it.p).sub(org);                     // the prop's back (+y): up x along
        im.setMatrixAt(i, M4.makeBasis(it.a, Y, UP).setPosition(O)); paint.set([...it.paint, it.r], i * 4);
      });
      g.setAttribute("iPaint", new THREE.InstancedBufferAttribute(paint, 4)); im.frustumCulled = false; grp.add(im);
    }
    return grp;
  }
  return { build, geo, mat, names: Object.keys(P.props) };
}
