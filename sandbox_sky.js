// Панельки, a low cloud deck, drawn over the finished picture: the scene is drawn into an image with its depth, and then
// one pass over the screen works out, for every pixel, how much of the line from the eye to what it shows runs through
// the cloud (a slab between a base and a top, made uneven and patchy by noise, drifting slowly) and covers it by that
// much. So towers fade into the cloud as they rise into it, the sky seen from the street is a grey ceiling, and seen
// from above the cloud is a sea with the tallest blocks standing out of it. No material had to change for it.
// When the clouds are off the scene is drawn straight to the screen as before.
// The cloud is worked out at half the screen's resolution (a quarter on phones): it is soft, and a full-resolution pass
// puts it over the picture taking each pixel's cloud from the nearby low-resolution ones at about its own depth, so the
// edges of buildings stay sharp (no halo of cloud across them). Each low-resolution pixel works its cloud out to the
// nearest thing under it (of the full-resolution pixels it covers; kept in lowD as a distance): one straddling a
// building's outline does not look past the building, and a facade pixel there finds a neighbour at its own depth, so
// the cloud behind a tower does not smear onto its walls.
import * as THREE from "three";

export function createClouds(renderer, fog) {
  const size = new THREE.Vector2(), coarse = matchMedia("(pointer: coarse)").matches;
  const SCALE = coarse ? 4 : 2;
  let rt = null, low = null, lowD = null;
  function target() {
    renderer.getDrawingBufferSize(size);
    if (rt && rt.width === size.x && rt.height === size.y) return rt;
    if (rt) { rt.dispose(); low.dispose(); lowD.dispose(); }
    rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
    low = new THREE.WebGLRenderTarget(Math.ceil(size.x / SCALE), Math.ceil(size.y / SCALE), { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    lowD = new THREE.WebGLRenderTarget(low.width, low.height, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    return rt;
  }
  // the nearest of the depths under each low-resolution pixel (its corners' full-resolution pixels), as a distance along
  // the view (as distAt below; 1e4: sky)
  const near = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tDepth: { value: null }, full: { value: new THREE.Vector2() }, hf: { value: (SCALE - 1) / 2 }, nf: { value: new THREE.Vector2() } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform sampler2D tDepth; uniform vec2 full; uniform float hf; uniform vec2 nf; varying vec2 vUv;
      void main() {
        float d = 1.0;
        for (int k = 0; k < 4; k++) { vec2 o = vec2(k & 1, k >> 1) * 2.0 - 1.0; d = min(d, texture2D(tDepth, vUv + o * hf * full).x); }
        float z = d * 2.0 - 1.0; gl_FragColor = vec4(d >= 1.0 ? 1e4 : 2.0 * nf.x * nf.y / (nf.y + nf.x - z * (nf.y - nf.x)), 0.0, 0.0, 1.0);
      }` });
  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, tNear: { value: null }, projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() },
      base: { value: 300 }, thick: { value: 140 }, cover: { value: 0.7 }, time: { value: 0 }, steps: { value: coarse ? 12 : 20 },
      fogC: { value: fog.color }, fogR: { value: new THREE.Vector2(fog.near, fog.far) },
    },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tNear; uniform mat4 projInv; uniform mat4 camWorld; uniform vec3 camPos;
      uniform float base; uniform float thick; uniform float cover; uniform float time; uniform int steps; uniform vec3 fogC; uniform vec2 fogR;
      varying vec2 vUv;
      const vec3 SUN = vec3(0.37, 0.56, 0.74);
      float h2(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p) { return 0.55 * vn(p) + 0.28 * vn(p * 2.03 + 7.1) + 0.17 * vn(p * 4.07 + 3.3); }
      // Worley (cellular) noise: the distance to the nearest of points scattered one to a cell -> puffs where inverted
      float worley(vec2 p) {
        vec2 i = floor(p), f = fract(p); float m = 1.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)), r = g + vec2(h2(i + g), h2(i + g + 17.3)) - f; m = min(m, dot(r, r)); }
        return sqrt(m);
      }
      float remap(float v, float a, float b) { return clamp((v - a) / max(b - a, 1e-4), 0.0, 1.0); }
      // how much cloud there is at w (0 .. 1). Separate clouds, as in games' cloud systems: a shape of puffs (Worley noise,
      // roughed up by the smooth noise); the cover cuts it off below (1 - cover), so between clouds there is no cloud at
      // all; each cloud a dome on a flat base (thick puffs rise high, thin ones stay low); edges eaten away by finer noise
      float dens(vec3 w) {
        vec2 q = w.xz + vec2(time * 2.2, time * 0.8);                                  // (drifting)
        float shape = (1.0 - worley(q / 260.0)) * 0.6 + (1.0 - worley(q / 110.0 + 3.7)) * 0.25 + fbm(q / 400.0) * 0.35;
        shape = remap(shape, 1.0 - cover * 0.95, 1.05) + smoothstep(0.88, 1.0, cover) * 0.5;   // (near full cover the gaps close)
        float h = (w.y - base) / thick;
        float d = clamp((shape - h * 0.85) * 3.0, 0.0, 1.0) * smoothstep(0.0, 0.08, h) * step(h, 1.4);   // a dome on a flat base
        float detail = vn(q / 31.0 + w.y / 23.0) * 0.6 + vn(q / 13.0 - w.y / 11.0) * 0.4;
        return remap(d, detail * 0.45, 1.0);                                          // frayed edges
      }
      void main() {
        float lin = texture2D(tNear, vUv).x;                                           // the nearest thing under this pixel, along the view
        vec4 v = projInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); v /= v.w; v.xyz *= lin / max(-v.z, 1e-6);
        vec3 w = (camWorld * vec4(v.xyz, 1.0)).xyz, dir = normalize(w - camPos); float far = lin >= 9999.0 ? 9000.0 : length(w - camPos);
        // the stretch of the line of sight inside the slab
        float lo = base, hi = base + thick * 1.4, t0 = 0.0, t1 = -1.0;
        if (abs(dir.y) < 1e-4) { if (camPos.y >= lo && camPos.y <= hi) t1 = far; }
        else { float ta = (lo - camPos.y) / dir.y, tb = (hi - camPos.y) / dir.y; t0 = max(0.0, min(ta, tb)); t1 = min(far, max(ta, tb)); }
        t1 = min(t1, t0 + 4000.0);
        vec3 acc = vec3(0.0); float T = 1.0;
        if (t1 > t0) {
          // steps of at most 50 m (a slanting look through the deck is long: farther than that it is hidden or hazed anyway);
          // each pixel starts at its own spot along the way (interleaved gradient noise: even among neighbours, no banding)
          float dt = min((t1 - t0) / float(steps), 50.0), j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          for (int i = 0; i < 64; i++) {
            if (i >= steps || T < 0.02) break;
            float t = t0 + (float(i) + j) * dt; vec3 p = camPos + dir * t; float k = dens(p);
            if (k > 0.001) {
              float a = 1.0 - exp(-k * 0.09 * dt), hgt = clamp((p.y - base) / thick, 0.0, 1.0);
              float lit = exp(-3.0 * dens(p + SUN * 45.0));                                    // how much cloud stands between it and the sun
              vec3 c = mix(vec3(0.55, 0.57, 0.6), vec3(0.95, 0.95, 0.96), smoothstep(0.0, 1.0, hgt) * 0.5 + lit * 0.5) * (0.88 + 0.12 * k);
              c = mix(c, fogC, smoothstep(fogR.x, fogR.y, t) * 0.85);             // far cloud is hazed too
              acc += T * a * c; T *= 1.0 - a;
            }
          }
        }
        gl_FragColor = vec4(acc, T);                 // the cloud's colour, and how much of what is behind still shows
      }` });
  // the full-resolution pass: the picture, dimmed under a deck, covered by the cloud taken from the four nearest
  // low-resolution pixels, each weighted by how near its depth is to this pixel's
  const comp = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tColor: { value: null }, tDepth: { value: null }, tCloud: { value: null }, tNear: { value: null }, lowSize: { value: new THREE.Vector2() }, nf: { value: new THREE.Vector2() }, dim: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tCloud; uniform sampler2D tNear; uniform vec2 lowSize; uniform vec2 nf; uniform float dim; varying vec2 vUv;
      float distAt(vec2 uv) { float d = texture2D(tDepth, uv).x; if (d >= 1.0) return 9000.0; float z = d * 2.0 - 1.0; return 2.0 * nf.x * nf.y / (nf.y + nf.x - z * (nf.y - nf.x)); }   // (depth along the view: cheap, and as good for comparing)
      void main() {
        vec3 scene = texture2D(tColor, vUv).rgb * (1.0 - dim); float D = distAt(vUv);
        vec2 p = vUv * lowSize - 0.5, i0 = floor(p + 0.5); vec4 sum = vec4(0.0), best = vec4(0.0, 0.0, 0.0, 1.0); float ws = 0.0, bestD = 1e9, wmax = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {            // the 3 x 3 nearest: smooths what is left of the stepping noise
          vec2 c = i0 + vec2(float(x), float(y)), uv = (c + 0.5) / lowSize, dd = c - p;
          float dn = texture2D(tNear, uv).x, e = abs(min(D, 9000.0) - min(dn, 9000.0));
          float wb = exp(-dot(dd, dd) / 1.1), wd = exp(-e / (0.04 * D + 1.5)), w = wb * (wd + 1e-4);
          vec4 cl = texture2D(tCloud, uv); sum += w * cl; ws += w; wmax = max(wmax, wd);
          if (e < bestD) { bestD = e; best = cl; }
        }
        vec4 c = mix(best, sum / max(ws, 1e-6), smoothstep(0.05, 0.3, wmax));   // none at about its depth: the one nearest it
        gl_FragColor = vec4(scene * c.a + c.rgb, 1.0);
        #include <colorspace_fragment>
      }` });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const post = new THREE.Scene(); post.add(quad); const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const state = { on: false, base: 300, cover: 0.7 };
  function render(scene, camera, t = performance.now() / 1000) {
    if (!state.on) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    const r = target(); renderer.setRenderTarget(r); renderer.render(scene, camera); renderer.setRenderTarget(null);
    const u = mat.uniforms; u.tColor.value = r.texture; u.tDepth.value = r.depthTexture; u.projInv.value.copy(camera.projectionMatrixInverse); u.camWorld.value.copy(camera.matrixWorld);
    u.camPos.value.copy(camera.position); u.time.value = t; u.base.value = state.base; u.thick.value = Math.max(60, state.base * 0.45); u.cover.value = state.cover;
    u.fogR.value.set(fog.near, fog.far);
    const n = near.uniforms; n.tDepth.value = r.depthTexture; n.full.value.set(1 / r.width, 1 / r.height); n.nf.value.set(camera.near, camera.far);
    quad.material = near; renderer.setRenderTarget(lowD); renderer.render(post, postCam); quad.material = mat;   // the nearest depths
    u.tNear.value = lowD.texture;
    renderer.setRenderTarget(low); renderer.render(post, postCam);                       // the cloud, at low resolution
    const c = comp.uniforms; c.tColor.value = r.texture; c.tDepth.value = r.depthTexture; c.tCloud.value = low.texture; c.tNear.value = lowD.texture; c.lowSize.value.set(low.width, low.height);
    c.nf.value.set(camera.near, camera.far); c.dim.value = camera.position.y < state.base ? 0.22 * state.cover : 0;   // under a deck the day is dimmer
    quad.material = comp; renderer.setRenderTarget(null); renderer.render(post, postCam); quad.material = mat;
  }
  return { render, state, materials: { near, cloud: mat, comp } };
}
