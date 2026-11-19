// Панельки, a low cloud deck, drawn over the finished picture: the scene is drawn into an image with its depth, and then
// one pass over the screen works out, for every pixel, how much of the line from the eye to what it shows runs through
// the cloud (a slab between a base and a top, made uneven and patchy by noise, drifting slowly) and covers it by that
// much. So towers fade into the cloud as they rise into it, the sky seen from the street is a grey ceiling, and seen
// from above the cloud is a sea with the tallest blocks standing out of it. No material had to change for it.
// When the clouds are off the scene is drawn straight to the screen as before.
import * as THREE from "three";

export function createClouds(renderer, fog) {
  const size = new THREE.Vector2(), coarse = matchMedia("(pointer: coarse)").matches;
  let rt = null;
  function target() {
    renderer.getDrawingBufferSize(size);
    if (rt && rt.width === size.x && rt.height === size.y) return rt;
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
    return rt;
  }
  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() },
      base: { value: 300 }, thick: { value: 140 }, cover: { value: 0.7 }, time: { value: 0 }, steps: { value: coarse ? 12 : 20 },
      fogC: { value: fog.color }, fogR: { value: new THREE.Vector2(fog.near, fog.far) }, under: { value: 0.2 },
    },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 projInv; uniform mat4 camWorld; uniform vec3 camPos;
      uniform float base; uniform float thick; uniform float cover; uniform float time; uniform int steps; uniform vec3 fogC; uniform vec2 fogR; uniform float under;
      varying vec2 vUv;
      const vec3 SUN = vec3(0.37, 0.56, 0.74);
      float h2(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p) { return 0.55 * vn(p) + 0.28 * vn(p * 2.03 + 7.1) + 0.17 * vn(p * 4.07 + 3.3); }
      // how much cloud there is at w (0 .. 1): patches from the cover, a base and a top that rise and fall a little
      float dens(vec3 w) {
        vec2 q = w.xz / 520.0 + vec2(time * 0.004, time * 0.0015);
        float n = fbm(q), m = vn(w.xz / 150.0 + 11.0), bil = vn(w.xz / 42.0 + 5.0) * 0.6 + vn(w.xz / 17.0 + 2.0) * 0.4;   // (billows on top)
        float b = base + (m - 0.5) * thick * 0.5, t = base + thick * (0.6 + 0.45 * n + 0.3 * bil);
        float prof = smoothstep(b, b + thick * 0.25, w.y) * (1.0 - smoothstep(t - thick * 0.3, t, w.y));
        return smoothstep(1.0 - cover, 1.0 - cover + 0.28, n + 0.1 * m) * prof;
      }
      void main() {
        vec3 scene = texture2D(tColor, vUv).rgb; float d = texture2D(tDepth, vUv).x;
        vec4 v = projInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w;
        vec3 w = (camWorld * v).xyz, dir = normalize(w - camPos); float far = d >= 1.0 ? 9000.0 : length(w - camPos);
        // under a solid deck the day is dimmer
        if (camPos.y < base) scene *= 1.0 - under;
        // the stretch of the line of sight inside the slab
        float lo = base - thick * 0.3, hi = base + thick * 1.25, t0 = 0.0, t1 = -1.0;
        if (abs(dir.y) < 1e-4) { if (camPos.y >= lo && camPos.y <= hi) t1 = far; }
        else { float ta = (lo - camPos.y) / dir.y, tb = (hi - camPos.y) / dir.y; t0 = max(0.0, min(ta, tb)); t1 = min(far, max(ta, tb)); }
        t1 = min(t1, t0 + 4000.0);
        vec3 acc = vec3(0.0); float T = 1.0;
        if (t1 > t0) {
          float dt = (t1 - t0) / float(steps), j = h2(gl_FragCoord.xy + fract(time)) ;   // (each pixel starts at its own spot along the way: no banding)
          for (int i = 0; i < 64; i++) {
            if (i >= steps || T < 0.02) break;
            float t = t0 + (float(i) + j) * dt; vec3 p = camPos + dir * t; float k = dens(p);
            if (k > 0.001) {
              float a = 1.0 - exp(-k * 0.06 * dt), hgt = clamp((p.y - base) / thick, 0.0, 1.0);
              float lit = exp(-3.0 * dens(p + SUN * 45.0));                                    // how much cloud stands between it and the sun
              vec3 c = mix(vec3(0.42, 0.44, 0.47), vec3(0.95, 0.95, 0.96), smoothstep(0.0, 1.0, hgt) * 0.5 + lit * 0.5) * (0.88 + 0.12 * k);
              c = mix(c, fogC, smoothstep(fogR.x, fogR.y, t) * 0.85);             // far cloud is hazed too
              acc += T * a * c; T *= 1.0 - a;
            }
          }
        }
        gl_FragColor = vec4(scene * T + acc, 1.0);
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
    u.under.value = 0.22 * state.cover; u.fogR.value.set(fog.near, fog.far);
    renderer.render(post, postCam);
  }
  return { render, state };
}
