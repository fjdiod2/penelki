// Compiles the light's shaders offline with glslangValidator (brew install glslang), as WebGL2 would get them from
// three.js: no browser needed.   node tools/glslcheck.mjs
import "../tests/env.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import * as THREE from "three";
const { SHADERS, createTownLight } = await import("../sandbox_lightgl.js");
const PRE = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
out vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define texture2D texture
uniform vec3 cameraPosition; uniform mat4 viewMatrix; uniform vec3 fogC; uniform vec2 fogR;
`;
// a building piece's and the ground's shaders as patched (the bits of them the patch touches)
const L = createTownLight({ getRenderTarget: () => null }), LIT = "0.62 + 0.55 * max(dot(N, sun), 0.0) + 0.08 * N.y";
const piece = new THREE.ShaderMaterial({ uniforms: { tWalls: { value: null } }, vertexShader: "varying vec3 vM; void main() { vec4 m = vec4(0.0); vM = m.xyz; }",
  fragmentShader: `uniform vec3 sun; varying vec3 vM; void main() { vec3 col = vec3(1.0), N = normalize(cross(dFdx(vM), dFdy(vM))); float lit = ${LIT}; col *= lit; gl_FragColor = vec4(mix(col, fogC, 0.0), 1.0); }` });
const ground = new THREE.ShaderMaterial({ uniforms: {}, vertexShader: "void main() {}", fragmentShader: "varying vec3 vW; void main() { vec3 col = vec3(1.0); gl_FragColor = vec4(mix(col, fogC, 0.0), 1.0); }" });
const water = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null } }, vertexShader: "void main() {}", fragmentShader: "varying vec3 vW; void main() { vec3 col = vec3(1.0); gl_FragColor = vec4(mix(col, fogC, smoothstep(fogR.x, fogR.y, length(cameraPosition - vW))), 1.0); }" });
L.patch(piece); L.patch(ground); L.patch(water);
const sources = { shadow: SHADERS.SHADOW_F, sky: SHADERS.SKY_F, ground_bake: SHADERS.GROUND_F, piece: piece.fragmentShader.replace(/varying /g, "in "), ground: ground.fragmentShader.replace(/varying /g, "in "), water: water.fragmentShader.replace(/varying /g, "in ") };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glsl-")); let bad = 0;
for (const [name, src] of Object.entries(sources)) {
  const f = path.join(dir, name + ".frag"); fs.writeFileSync(f, PRE + src);
  try { execFileSync("glslangValidator", [f], { stdio: "pipe" }); console.log("ok    ", name); }
  catch (e) { bad++; console.log("FAILED", name + "\n" + String(e.stdout || e.message).split("\n").filter((l) => /ERROR/.test(l)).join("\n")); }
}
process.exit(bad ? 1 : 0);
