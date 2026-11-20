// Панельки, the town's light on the GPU: the sums of sandbox_light.js (keep them the same) baked into textures when
// the town changes, and the bit of shader that reads them, put into the materials that draw the town (buildings,
// props, ground, roads, trees) without touching the files they come from (apartments.js and props.js are copies of
// the simulator's). Per pixel it costs a handful of texture reads.
//   tlH  the height map: [bot, top, g0, g1] per cell (from JS; g0 .. g1 a hole through it)
//   tlS  sun shadows: [L1, H1, L2, H2] per cell, the heights shaded there
//   tlW  sky on walls facing +x, -x, +z, -z; tlU  sky on a roof. Both at half the map's resolution, the LAYERS stacked
//        one above the other in the image (layer k: rows k * sz ..)
import * as THREE from "three";
import { SUN, SUN_XZ, TAN_E, LAYERS, DIRS, SKY_STEPS, SKY_GROW } from "./sandbox_light.js";

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const CONSTS = `
  const vec3 TL_SUN = vec3(${SUN.map(f).join(", ")}); const vec2 TL_SD = vec2(${SUN_XZ.map(f).join(", ")}); const float TL_TANE = ${f(TAN_E)};
  const float TL_LAY[8] = float[8](${LAYERS.map(f).join(", ")});`;

// what the materials get: the sun and the sky at a point facing N (x: sky 0 .. 1, y: sun 0 .. 1), as sunAt and skyMix
const CHUNK = `
  uniform sampler2D tlH; uniform sampler2D tlS; uniform sampler2D tlW; uniform sampler2D tlU;
  uniform vec4 tlG; uniform vec4 tlN;          // x0, z0, cell, on · nx, nz, sky nx, sky nz
  ${CONSTS}
  float tlLayer(float h) { if (h <= 0.0) return 0.0; for (int k = 1; k < 8; k++) if (h < TL_LAY[k]) return float(k - 1) + (h - TL_LAY[k - 1]) / (TL_LAY[k] - TL_LAY[k - 1]); return 7.0; }
  float tlShade(vec2 LH, float y) { return (1.0 - smoothstep(LH.y - 0.4, LH.y + 0.4, y)) * smoothstep(LH.x - 0.4, LH.x + 0.4, y); }
  float tlSunIn(vec4 S, float y) { return 1.0 - max(tlShade(S.xy, y), S.w > -999.0 ? tlShade(S.zw, y) : 0.0); }
  vec2 townVis(vec3 W, vec3 N) {
    if (tlG.w < 0.5) return vec2(1.0);
    // the sun: the shadow map at 12 spots in a disc 1.5 cells across round the point (turned per pixel), each corrected for
    // where in its cell it is (nearer the sun, the shadows reach higher): soft edges instead of the cells' steps
    float c = tlG.z; vec2 nh = N.xz, o = nh * 1.5 * c, P = W.xz + o; float ys = W.y + dot(o, TL_SD) * TL_TANE + 0.2, sun = 0.0;
    float rot = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    for (int k = 0; k < 12; k++) {
      float r = sqrt((float(k) + 0.5) / 12.0) * 0.75 * c, a = float(k) * 2.3999632 + rot;
      vec2 q = P + r * vec2(cos(a), sin(a)); ivec2 t = ivec2(floor((q - tlG.xy) / c));
      if (t.x < 0 || t.y < 0 || t.x >= int(tlN.x) || t.y >= int(tlN.y)) { sun += 1.0; continue; }
      vec2 cc = tlG.xy + (vec2(t) + 0.5) * c;
      sun += tlSunIn(texelFetch(tlS, t, 0), ys - dot(q - cc, TL_SD) * TL_TANE);
    }
    sun /= 12.0;
    float sc = 2.0 * c, sky = 1.0; vec2 po = W.xz + nh * 1.5 * sc, uv = (po - tlG.xy) / (tlN.zw * sc);
    if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
      ivec2 hq = ivec2(floor((po - tlG.xy) / c)); vec4 bt = hq.x < int(tlN.x) && hq.y < int(tlN.y) ? texelFetch(tlH, hq, 0) : vec4(0.0);
      float lp = tlLayer(W.y - (bt.w > bt.z ? bt.z : bt.x > 0.5 ? 0.0 : bt.y)), k0 = floor(lp), fk = lp - k0, k1 = min(k0 + 1.0, 7.0);
      vec2 cu = clamp(uv, 0.5 / tlN.zw, 1.0 - 0.5 / tlN.zw), u0 = vec2(cu.x, (k0 + cu.y) / 8.0), u1 = vec2(cu.x, (k1 + cu.y) / 8.0);
      vec4 wv = mix(texture(tlW, u0), texture(tlW, u1), fk); float up = mix(texture(tlU, u0).x, texture(tlU, u1).x, fk);
      vec4 wg = vec4(max(N.x, 0.0), max(-N.x, 0.0), max(N.z, 0.0), max(-N.z, 0.0)); float ws = dot(wg, vec4(1.0));
      float wall = ws > 1e-3 ? dot(wv, wg) / ws : up, a = max(N.y, 0.0), b = length(nh), dn = max(-N.y, 0.0);
      sky = (a * up + b * wall + dn * 0.6 * wall) / max(a + b + dn, 1e-6);
    }
    return vec2(sky, sun);
  }
  // the light as before (0.62 sky, 0.55 sun, 0.08 from above: the same in the open), the sky part scaled by how much
  // sky there is, the sun by the shadows, and a little light thrown back off the walls into closed-in places. Shade is
  // a little bluer (TL_tint, multiply the colour by it too)
  vec3 TL_tint = vec3(1.0);
  float townLit(vec3 W, vec3 N, vec3 sunD) {
    vec2 v = townVis(W, N); float sd = max(dot(N, sunD), 0.0);
    float sk = (0.62 + 0.08 * N.y) * v.x, sn = 0.55 * sd * v.y, bo = 0.1 * (1.0 - v.x);
    TL_tint = mix(vec3(0.9, 0.96, 1.1), vec3(1.0), clamp(sn / 0.25, 0.0, 1.0));
    return sk + sn + bo;
  }
  float townFactor(vec3 W) { return townLit(W, vec3(0.0, 1.0, 0.0), TL_SUN) / (0.7 + 0.55 * TL_SUN.y); }   // (1 in the open sun)
  float townFactorDown(vec3 W) { return townLit(W, vec3(0.0, -1.0, 0.0), TL_SUN) / (0.54 * 0.6); }          // an underside (1 in the open)
`;

const QUAD_V = "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }";
const HAT = `
  uniform sampler2D tlH; uniform vec4 tlG; uniform vec4 tlN;
  ${CONSTS}
  vec4 hAt(vec2 p) { ivec2 q = ivec2(floor((p - tlG.xy) / tlG.z)); if (q.x < 0 || q.y < 0 || q.x >= int(tlN.x) || q.y >= int(tlN.y)) return vec4(0.0); return texelFetch(tlH, q, 0); }
  // partsAt: the solid over a cell as one or two ranges (n of them)
  int parts(vec4 h, out vec2 P0, out vec2 P1) { if (!(h.y > 0.0)) return 0; if (h.w > h.z) { P0 = h.xz; P1 = h.wy; return 2; } P0 = h.xy; P1 = vec2(0.0); return 1; }`;
// shadowCell, addRange
const SHADOW_F = `${HAT}
  uniform float maxD;
  vec4 addRange(vec4 S, float l, float h) {
    vec2 I[3]; int n = 0;
    if (S.y > -999.0) { I[n] = S.xy; n++; } if (S.w > -999.0) { I[n] = S.zw; n++; } I[n] = vec2(l, h); n++;
    for (int a = 0; a < 2; a++) for (int b = 0; b < 2; b++) if (b + 1 < n && I[b + 1].x < I[b].x) { vec2 t = I[b]; I[b] = I[b + 1]; I[b + 1] = t; }
    for (int it = 0; it < 2; it++) {
      int k = -1; for (int j = 0; j < 2; j++) if (k < 0 && j + 1 < n && I[j + 1].x <= I[j].y + 0.5) k = j;
      if (k < 0) break;
      I[k].y = max(I[k].y, I[k + 1].y); if (k == 0) I[1] = I[2]; n--;
    }
    if (n == 3) { int k = I[1].x - I[0].y <= I[2].x - I[1].y ? 0 : 1; I[k].y = I[k + 1].y; if (k == 0) I[1] = I[2]; n = 2; }
    return vec4(I[0], n > 1 ? I[1] : vec2(-1000.0));
  }
  void main() {
    float c = tlG.z; vec2 p = tlG.xy + (floor(gl_FragCoord.xy) + 0.5) * c;
    vec4 S = vec4(-1000.0); float s = 0.0;
    for (int k = 0; k < 600; k++) {
      s += max(c, min(6.0, s * 0.02)); if (s > maxD) break;
      ivec2 q = ivec2(floor((p + TL_SD * s - tlG.xy) / c)); if (q.x < 0 || q.y < 0 || q.x >= int(tlN.x) || q.y >= int(tlN.y)) break;
      vec2 P0, P1; int n = parts(texelFetch(tlH, q, 0), P0, P1);
      for (int m = 0; m < 2; m++) { if (m >= n) break; vec2 r = (m == 0 ? P0 : P1) - s * TL_TANE; if (r.y >= -1.0) S = addRange(S, r.x, r.y); }
    }
    gl_FragColor = S;
  }`;
// skyFrom, at the centre of a sky cell, at the height of its layer over the cell's base (mode 0: walls, 1: up)
const SKY_F = `${HAT}
  uniform int mode;
  float upF(float a) { float c = cos(a); return c * c; }
  float wallF(float a) { return (0.78539816 - a * 0.5 - sin(2.0 * a) * 0.25) / 0.78539816; }
  #define CLOSE if (hi >= 0.0) { if (lo <= hz) hz = max(hz, hi); else { oU = max(oU, upF(lo) - upF(hi)); oW = max(oW, wallF(lo) - wallF(hi)); } hi = -1.0; }
  void main() {
    ivec2 P = ivec2(gl_FragCoord.xy); int sz = int(tlN.w), k = P.y / sz, jj = P.y - k * sz;
    vec2 p = tlG.xy + (vec2(float(P.x), float(jj)) + 0.5) * 2.0 * tlG.z;
    vec4 bt0 = hAt(p); float y = (bt0.w > bt0.z ? bt0.z : bt0.x > 0.5 ? 0.0 : bt0.y) + TL_LAY[k];
    vec2 Q0, Q1; int n0 = parts(bt0, Q0, Q1);
    bool inside0 = (n0 > 0 && Q0.x <= y && y <= Q0.y) || (n0 > 1 && Q1.x <= y && y <= Q1.y);
    bool roof0 = !inside0 && ((n0 > 0 && Q0.x > y) || (n0 > 1 && Q1.x > y));
    float upS = 0.0; vec4 wS = vec4(0.0), wW = vec4(0.0);
    for (int d = 0; d < ${DIRS}; d++) {
      float a = float(d) / ${f(DIRS)} * 6.2831853; vec2 dir = vec2(cos(a), sin(a));
      float hz = 0.0, oU = 0.0, oW = 0.0, s = tlG.z, lo = roof0 ? 1.5707963 : 0.0, hi = roof0 ? 1.5707963 : -1.0; bool out_ = !inside0;
      for (int j = 0; j < ${SKY_STEPS}; j++) {
        vec2 P0, P1; int n = parts(hAt(p + dir * s), P0, P1); float s0 = s; s *= ${f(SKY_GROW)};
        bool solid = (n > 0 && P0.x <= y && y <= P0.y) || (n > 1 && P1.x <= y && y <= P1.y);
        if (!out_) { if (!solid) out_ = true; else continue; }
        if (!((n > 0 && P0.y > y) || (n > 1 && P1.y > y))) { CLOSE continue; }
        for (int m = 0; m < 2; m++) {                // (the part below a hole, then the one above it)
          if (m >= n) break; vec2 r = m == 0 ? P0 : P1; float b = r.x, t = r.y;
          if (t <= y) continue;
          float a2 = atan((t - y) / s0);
          if (b <= y) { CLOSE hz = max(hz, a2); }
          else { float a1 = atan((b - y) / s0); if (hi < 0.0) { lo = a1; hi = a2; } else { lo = min(lo, a1); hi = max(hi, a2); } }
        }
      }
      CLOSE
      float u = max(0.0, upF(hz) - oU), w = max(0.0, wallF(hz) - oW);
      vec4 kk = max(vec4(dir.x, -dir.x, dir.y, -dir.y), 0.0); upS += u; wS += kk * w; wW += kk;
    }
    gl_FragColor = mode == 0 ? wS / wW : vec4(upS / ${f(DIRS)}, 0.0, 0.0, 1.0);
  }`;

const LIT = "0.62 + 0.55 * max(dot(N, sun), 0.0) + 0.08 * N.y";
const OUT = /gl_FragColor = vec4\(mix\(col, fogC/;
const withChunk = (src, extra = "") => { const i = src.indexOf("void main()"); return src.slice(0, i) + extra + CHUNK + "\n" + src.slice(i); };

export function createTownLight(renderer) {
  const U = { tlH: { value: null }, tlS: { value: null }, tlW: { value: null }, tlU: { value: null }, tlG: { value: new THREE.Vector4() }, tlN: { value: new THREE.Vector4() } };
  const post = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false; post.add(quad);
  const bakeU = { tlH: U.tlH, tlG: U.tlG, tlN: U.tlN };
  const shadowMat = new THREE.ShaderMaterial({ uniforms: { ...bakeU, maxD: { value: 0 } }, vertexShader: QUAD_V, fragmentShader: SHADOW_F, depthTest: false, depthWrite: false });
  const skyMat = new THREE.ShaderMaterial({ uniforms: { ...bakeU, mode: { value: 0 } }, vertexShader: QUAD_V, fragmentShader: SKY_F, depthTest: false, depthWrite: false });
  let hTex = null, sRT = null, wRT = null, uRT = null;
  const rt = (w, h, filter) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false });
  function draw(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(post, cam); }

  // the height map (sandbox_light.js heightGrid) -> the textures; null: no town, light as in the open
  function update(g) {
    if (!g) { U.tlG.value.w = 0; return; }
    const sx = Math.ceil(g.nx / 2), sz = Math.ceil(g.nz / 2);
    if (!hTex || hTex.image.width !== g.nx || hTex.image.height !== g.nz) {
      if (hTex) { hTex.dispose(); sRT.dispose(); wRT.dispose(); uRT.dispose(); }
      hTex = new THREE.DataTexture(new Float32Array(g.nx * g.nz * 4), g.nx, g.nz, THREE.RGBAFormat, THREE.FloatType);
      hTex.minFilter = hTex.magFilter = THREE.NearestFilter; hTex.generateMipmaps = false;
      sRT = rt(g.nx, g.nz, THREE.NearestFilter); wRT = rt(sx, sz * 8, THREE.LinearFilter); uRT = rt(sx, sz * 8, THREE.LinearFilter);
    }
    const d = hTex.image.data; for (let k = 0; k < g.nx * g.nz; k++) { d[4 * k] = g.bot[k]; d[4 * k + 1] = g.top[k]; d[4 * k + 2] = g.g0[k]; d[4 * k + 3] = g.g1[k]; }
    hTex.needsUpdate = true;
    U.tlH.value = hTex; U.tlG.value.set(g.x0, g.z0, g.c, 0); U.tlN.value.set(g.nx, g.nz, sx, sz);
    const prev = renderer.getRenderTarget();
    shadowMat.uniforms.maxD.value = g.maxTop / TAN_E + g.c; draw(shadowMat, sRT);
    skyMat.uniforms.mode.value = 0; draw(skyMat, wRT);
    skyMat.uniforms.mode.value = 1; draw(skyMat, uRT);
    renderer.setRenderTarget(prev);
    U.tlS.value = sRT.texture; U.tlW.value = wRT.texture; U.tlU.value = uRT.texture; U.tlG.value.w = 1;
  }

  // put the light into a material, once: the shaders that light by LIT (buildings, props), the ones that do not light
  // at all but know their world point vW (ground, roads; not the water, whose picture is the lit town already), and
  // basic materials marked userData.townLight (trees, reeds)
  function patch(m) {
    if (m.userData.tl) return; m.userData.tl = true;
    if (m.isShaderMaterial && m.uniforms && !m.uniforms.tDiffuse) {
      let v = m.vertexShader, fr = m.fragmentShader;
      if (fr.includes(LIT) && v.includes("vM = m.xyz;") && OUT.test(fr)) {
        v = "varying vec3 vTW;\n" + v.replace("vM = m.xyz;", "vM = m.xyz; vTW = (modelMatrix * m).xyz;");
        fr = withChunk(fr, "varying vec3 vTW;\n").replace(LIT, "townLit(vTW, N, sun)").replace(OUT, "col *= TL_tint; $&");
      } else if (/varying vec3 vW;/.test(fr) && OUT.test(fr) && !fr.includes("townFactor")) {
        fr = withChunk(fr).replace(OUT, "{ float tlf = townFactor(vW); col *= tlf * TL_tint; } $&");
      } else return;
      m.vertexShader = v; m.fragmentShader = fr; Object.assign(m.uniforms, U); m.needsUpdate = true;
    } else if (m.isMeshBasicMaterial && m.userData.townLight) {
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = "varying vec3 vTW;\n" + sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n  vec4 tlw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n  tlw = instanceMatrix * tlw;\n#endif\n  vTW = (modelMatrix * tlw).xyz;");
        sh.fragmentShader = withChunk(sh.fragmentShader, "varying vec3 vTW;\n").replace("#include <opaque_fragment>", `#include <opaque_fragment>\n  { float tlf = ${m.userData.townLight === "down" ? "townFactorDown" : "townFactor"}(vTW); gl_FragColor.rgb *= tlf * TL_tint; }`);
      };
      m.customProgramCacheKey = () => "townLight-" + m.userData.townLight; m.needsUpdate = true;
    }
  }
  function patchAll(root) { root.traverse((o) => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) patch(m); }); }
  return { update, patch, patchAll, uniforms: U, targets: () => ({ hTex, sRT, wRT, uRT }) };
}
