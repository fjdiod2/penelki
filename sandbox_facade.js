// Панельки, facades that vary at the scale of the building, not only panel by panel: put into apartments.js's shader
// (a copy of the simulator's, left untouched) by sandbox_lightgl.js's patch, after the light. Three things:
//   streaks  dark streaks from the parapet, or from somewhere up the wall, running down many floors, fading out
//   tone     slow patches of lighter and darker concrete across a facade (batches, repairs, weather), dirtier low down
//   calm     far off (or at a slant), where a pixel covers much wall, the window photos go toward their average and the
//            thin panel seams fade: no flicker of tiny detail
// They go by the point in the world (vTW) and the wall's direction (vTN, from the light's patch), so the patterns run
// on across pieces and blocks.

const GLSL = `
  float faH(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
  float faN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(faH(i), faH(i + vec2(1.0, 0.0)), f.x), mix(faH(i + vec2(0.0, 1.0)), faH(i + vec2(1.0, 1.0)), f.x), f.y); }
  // a facade's tone at a (metres along it) and height y: slow patches, and the lowest floors dirtier
  float facadeTone(float a, float y, float base) {
    float n = faN(vec2(a / 37.0, y / 23.0)) * 0.6 + faN(vec2(a / 11.0 + 5.3, y / 8.0)) * 0.4;
    return (1.0 + (n - 0.5) * 0.22) * (1.0 - 0.12 * (1.0 - smoothstep(0.0, 9.0, y - base)));
  }
  // how much streak there is at a, y: in narrow columns (two widths), a few of them with a streak starting at the
  // parapet or somewhere up the wall and running down 6 .. 50 m, fading, a little wavy
  float facadeStreaks(float a, float y, float top, float base) {
    float s = 0.0;
    for (int k = 0; k < 2; k++) {
      float w = k == 0 ? 0.9 : 2.3, u = a / w + float(k) * 0.37, c = floor(u), fx = fract(u);
      if (faH(vec2(c, 11.0 + float(k))) > 0.45) continue;                       // most columns have none
      float h2 = faH(vec2(c, 23.0 + float(k))), start = top - (h2 < 0.5 ? 0.3 : h2 * (top - base) * 0.8);
      float len = 6.0 + faH(vec2(c, 37.0 + float(k))) * 44.0, d = start - y;
      if (d < 0.0 || d > len) continue;
      float width = 0.12 + 0.25 * faH(vec2(c, 51.0 + float(k)));
      float x = abs((fx - 0.5) * w + (faN(vec2(c * 7.1, y / 3.0)) - 0.5) * 0.15);
      float fade = 1.0 - d / len;
      s = max(s, (1.0 - smoothstep(width * 0.5, width * 0.5 + 0.08, x)) * fade * fade * (0.5 + 0.5 * faN(vec2(a * 3.0, y / 2.0))));
    }
    return s * 0.55;
  }
`;
// apartments.js's shader, the lines this hooks onto (if one is not found, that part is left out)
const SEAMS = "col = mix(mix(vec3(0.16, 0.16, 0.15), vec3(0.5, 0.5, 0.48), step(vVar.w, 0.18)), col, f);";
const GRIME = "col = mix(col, vec3(0.22, 0.21, 0.19), min(streak * (under * 1.2 + roof * 0.7) + foot * 0.22, 0.6));";
const LITLINE = /\n(\s*)float lit = /;

export function facadePatch(fr) {
  const i = fr.indexOf("void main()"); if (i < 0) return fr;
  let out = fr.slice(0, i) + GLSL + "\n" + fr.slice(i);
  // how much wall a pixel covers (m) -> far: 0 near .. 1 far, for the windows; and for the seams, a few cm wide
  out = out.replace(/void main\(\)\s*\{/, (m) => m + `
    float FA_px = length(fwidth(vTW)), FA_far = smoothstep(0.15, 0.6, FA_px), FA_seam = smoothstep(0.03, 0.12, FA_px);`);
  if (out.includes(SEAMS)) out = out.replace(SEAMS, SEAMS.replace("col, f);", "col, max(f, FA_seam));"));
  if (out.includes(GRIME)) out = out.replace(GRIME, GRIME + `
      { vec3 fn = dot(vTN, vTN) > 0.5 ? vTN : N;                    // (the wall's direction: window sides go with it)
        if (abs(fn.y) < 0.7) {
          vec2 T = normalize(vec2(-fn.z, fn.x)); float a = dot(vTW.xz, T);
          col *= facadeTone(a, vTW.y, vVar.x);
          col = mix(col, col * vec3(0.62, 0.6, 0.57), facadeStreaks(a, vTW.y, vVar.y, vVar.x) * (1.0 - 0.5 * FA_far));
        } }`);
  // windows, glazed balconies, balcony fronts: toward the average of their photos far off (the whole atlas's: the
  // differences between windows are what flickers)
  out = out.replace(LITLINE, (m, sp) => `
${sp}if (id == 2) col = mix(col, textureLod(tWin, vec2(0.5), 16.0).rgb * vec3(0.82, 0.83, 0.85), 0.75 * FA_far);
${sp}else if (id == 13) col = mix(col, textureLod(tGlz, vec2(0.5), 16.0).rgb, 0.6 * FA_far);
${sp}else if (id == 15) col = mix(col, textureLod(tFront, vec2(0.5), 16.0).rgb, 0.6 * FA_far);` + m);
  return out;
}
