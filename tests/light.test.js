// Light that knows about the town (sandbox_light.js): the height map, sun shadows, how much sky a spot sees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heightGrid, cellAt, partsAt, shadowCell, sunAt, sunIn, addRange, skyFrom, skyMix, layerPos, baseOf, SUN_XZ, TAN_E, NONE } from "../sandbox_light.js";

const block = (pts, y1, o = {}) => ({ pts, closed: false, D: 12, y0: 0, y1, ...o });
const shadowOf = (g) => { const memo = new Map(); return (i, j) => { const k = j * g.nx + i; if (!memo.has(k)) memo.set(k, shadowCell(g, i, j)); return memo.get(k); }; };
const cellOf = (g, x, z) => [Math.floor((x - g.x0) / g.c), Math.floor((z - g.z0) / g.c)];

test("the height map: a block's cells hold its range, the street none; a bridge starts above the street", () => {
  const g = heightGrid([block([[-20, 0], [20, 0]], 30), block([[0, 0], [0, 40]], 50, { D: 8, y0: 40 })]);
  assert.equal(g.c, 2);
  assert.deepEqual(cellAt(g, ...cellOf(g, -15, 0)), [0, 30]);
  assert.deepEqual(cellAt(g, ...cellOf(g, 30, 30)), [0, 0]);
  assert.deepEqual(cellAt(g, ...cellOf(g, 1, 30)), [40, 50]);
  assert.deepEqual(cellAt(g, ...cellOf(g, 1, 5)), [0, 50], "where the bridge meets the block: one range, ground to bridge top");
  assert.ok(g.x0 < -20 - TAN_E && g.z0 < -60 - 30 / TAN_E * SUN_XZ[1] + 1, "the map reaches as far as the shadow");
});
test("a curved block has no gaps on the outside of its bends", () => {
  const pts = []; for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI; pts.push([40 * Math.cos(a), 40 * Math.sin(a)]); }
  const g = heightGrid([block(pts, 20)]);
  for (let k = 0; k < 60; k++) { const a = (k / 59) * Math.PI, r = 43; assert.equal(cellAt(g, ...cellOf(g, r * Math.cos(a), r * Math.sin(a)))[1], 20, `at ${k}`); }
});
test("sun: a tower shades the ground on its side away from the sun, not on its sunny side; high up it is sunny", () => {
  const g = heightGrid([block([[-20, 0], [20, 0]], 60)]), sh = shadowOf(g);
  assert.ok(SUN_XZ[1] > 0, "(the sun is toward +z)");
  assert.ok(sunAt(g, sh, 0, 0, -20) < 0.05, "behind it");
  assert.ok(sunAt(g, sh, 0, 0, 20) > 0.95, "in front");
  assert.ok(sunAt(g, sh, 0, 0, -20 - 60 / TAN_E / SUN_XZ[1] - 20) > 0.95, "past the end of the shadow");
  assert.ok(sunAt(g, sh, 0, 61, -20) > 0.95, "above the roof's height");
  assert.ok(sunAt(g, sh, 0, 60, 0) > 0.95, "its own roof");
  assert.ok(sunAt(g, sh, 0, 30, 6, 0, 1) > 0.95, "its sunny wall does not shade itself");
});
test("sun: a lower block behind a tower is shaded up to the height the tower's shadow reaches", () => {
  const g = heightGrid([block([[-30, 0], [30, 0]], 90), block([[-30, -40], [30, -40]], 60)]), sh = shadowOf(g);
  const z = -34, d = (0 - z) / SUN_XZ[1] - 6 / SUN_XZ[1], edge = 90 - d * TAN_E;   // the tower's wall facing it is 6 m from its centre line
  assert.ok(sunAt(g, sh, 0, edge - 4, z, 0, 1) < 0.1 && sunAt(g, sh, 0, edge + 4, z, 0, 1) > 0.9, `edge near ${edge.toFixed(1)} m`);
});
test("sun: a bridge shades the street under it, and the street beside its shadow is sunny", () => {
  const g = heightGrid([block([[-40, 0], [40, 0]], 52, { D: 8, y0: 40 })]), sh = shadowOf(g);
  const under = -(40 / TAN_E) * SUN_XZ[1];                                    // its shadow falls this far toward -z
  // its shadow: from where the sun line past its near bottom edge lands to where the one past its far top edge does
  assert.ok(sunAt(g, sh, 0, 0, under - 10) < 0.1, "its shadow on the street");
  assert.ok(sunAt(g, sh, 0, 0, under + 10) > 0.9 && sunAt(g, sh, 0, 0, under - 30) > 0.9, "beside its shadow (about 28 m long)");
  assert.ok(sunAt(g, sh, 0, 0, 0) > 0.9, "right under it the sun comes in at a slant");
  assert.ok(sunAt(g, sh, 0, 30, under - 10) > 0.9, "the shadow is of something up in the air: above the street it is sunny again");
});
test("sky: in the open everything is lit; a street between two tall blocks sees little sky; walls see what is in front", () => {
  const g = heightGrid([block([[-150, 13], [150, 13]], 90), block([[-150, -13], [150, -13]], 90)]);
  const open = skyFrom(g, 2000, 0.5, 2000); assert.ok(Math.abs(open.up - 1) < 1e-9 && open.walls.every((w) => Math.abs(w - 1) < 1e-9));
  const street = skyFrom(g, 0, 0.5, 0); assert.ok(street.up < 0.2, `street ${street.up.toFixed(3)}`);
  const hi = skyFrom(g, 0, 60, 0); assert.ok(hi.up > street.up + 0.05 && skyFrom(g, 0, 85, 0).up > 0.4, "brighter higher up");
  const roof = skyFrom(g, 0, 90.5, 13); assert.ok(roof.up > 0.97, "the roof");
  const inner = skyFrom(g, 0, 10, -4), outer = skyFrom(g, 0, 10, -22);
  assert.ok(inner.walls[2] < 0.25, `the wall facing the street ${inner.walls[2].toFixed(2)}`);
  assert.ok(outer.walls[3] > 0.95, `its back, facing the open ${outer.walls[3].toFixed(2)}`);
});
test("sky: a spot inside a block's wall does not count that block (it looks out of it)", () => {
  const g = heightGrid([block([[-30, 0], [30, 0]], 60)]);
  const s = skyFrom(g, 0, 20, 5.5); assert.ok(s.walls[2] > 0.95, `wall facing the open ${s.walls[2].toFixed(2)}`);
});
test("sky: under a low archway the street sees much less sky than beside it; a high, narrow bridge hides little", () => {
  const low = heightGrid([block([[-15, 0], [15, 0]], 10, { D: 10, y0: 4 })]), high = heightGrid([block([[-15, 0], [15, 0]], 30, { D: 10, y0: 20 })]);
  const under = skyFrom(low, 0, 0.5, 0).up, beside = skyFrom(low, 0, 0.5, 30).up, hi = skyFrom(high, 0, 0.5, 0).up;
  assert.ok(under < 0.5 && beside > 0.9, `under ${under.toFixed(2)} beside ${beside.toFixed(2)}`);
  assert.ok(hi > 0.7 && hi < 0.9, `high bridge ${hi.toFixed(2)}`);
});
test("mixing: a wall uses its direction's sky, a roof up, a slanted face in between; layers", () => {
  const s = { up: 0.2, walls: [0.9, 0.1, 0.5, 0.3] };
  assert.equal(skyMix(s, [0, 1, 0]), 0.2); assert.equal(skyMix(s, [1, 0, 0]), 0.9); assert.equal(skyMix(s, [0, 0, -1]), 0.3);
  assert.ok(Math.abs(skyMix(s, [Math.SQRT1_2, 0, Math.SQRT1_2]) - 0.7) < 1e-9);
  assert.equal(layerPos(0), 0); assert.equal(layerPos(5), 1); assert.equal(layerPos(37.5), 3.5); assert.equal(layerPos(1e4), 7);
});

// a block 60 m tall with a hole dug right through it, 10 m wide, from 20 to 35 m up (u along x, lf = V.left(u) = -z)
const holed = (hole = true) => heightGrid([block([[-30, 0], [30, 0]], 60, { holes: hole ? [{ a: [-30, 0], u: [1, 0], lf: [0, -1], s0: 25, s1: 35, w0: -6, w1: 6, y0: 20, y1: 35 }] : [] })]);
test("holes: the cells of a hole keep their solid below and above it; a hole dug from the ground makes an archway", () => {
  const g = holed(); assert.deepEqual(partsAt(g, ...cellOf(g, 0, 0)), [[0, 20], [35, 60]]); assert.deepEqual(partsAt(g, ...cellOf(g, -20, 0)), [[0, 60]]);
  const arch = heightGrid([block([[-30, 0], [30, 0]], 60, { holes: [{ a: [-30, 0], u: [1, 0], lf: [0, -1], s0: 25, s1: 35, w0: -6, w1: 6, y0: 0, y1: 12 }] })]);
  assert.deepEqual(partsAt(arch, ...cellOf(arch, 0, 0)), [[12, 60]]);
});
test("holes: the sun comes through a hole onto the ground in the block's shadow; around that patch it is still shade", () => {
  const sunny = (g) => { const sh = shadowOf(g); let n = 0; for (let z = -60; z <= -10; z += 2) { const dx = (z * SUN_XZ[0]) / SUN_XZ[1]; for (let x = -26 + dx; x <= 26 + dx; x += 2) if (sunAt(g, sh, x, 0, z) > 0.5) n++; } return n; };   // (in the slanting shadow)
  assert.equal(sunny(holed(false)), 0, "no hole: all shade");
  const n = sunny(holed()); assert.ok(n > 10 && n < 120, `a patch of sun: ${n} spots`);
  const g = holed(), sh = shadowOf(g); assert.ok(sunAt(g, sh, -17, 0, -35) > 0.5 && sunAt(g, sh, -17, 0, -25) < 0.5, "where the line to the sun goes through the hole, and where it hits the wall under it");
});
test("holes: two shaded ranges at one spot, with sun between them; ranges that touch become one", () => {
  assert.deepEqual(addRange([0, 10, NONE, NONE], 30, 40), [0, 10, 30, 40]);
  assert.deepEqual(addRange([0, 10, 30, 40], 9, 31), [0, 40, NONE, NONE]);
  assert.deepEqual(addRange([0, 10, 30, 40], 50, 60), [0, 10, 30, 60], "three apart: the nearest two become one");
  assert.ok(sunIn([0, 10, 30, 40], 20) > 0.99 && sunIn([0, 10, 30, 40], 35) < 0.01 && sunIn([0, 10, 30, 40], 5) < 0.01);
});
test("holes: the floor of a hole sees the sky out of its open ends, and its layers start at its floor", () => {
  const g = holed(), s = skyFrom(g, 0, 20.5, 0); assert.ok(s.walls[2] > 0.5 && s.walls[3] > 0.5, `out of both ends ${s.walls.map((v) => v.toFixed(2))}`);
  assert.ok(s.up < 0.65, `a ceiling over it ${s.up.toFixed(2)}`);
  const k = (j) => j; const [i, j] = cellOf(g, 0, 0), q = j * g.nx + i; assert.equal(baseOf(g.bot[q], g.top[q], g.g0[q], g.g1[q]), 20);
});

// the shaders get the light put in (sandbox_lightgl.js): building pieces look their small faces' sky up by their wall
import * as THREE from "three";
const { createTownLight } = await import("../sandbox_lightgl.js");
test("patching: building pieces get their wall's direction for the sky; props their own faces'; the ground its baked light", () => {
  const L = createTownLight({ getRenderTarget: () => null }), LIT = "0.62 + 0.55 * max(dot(N, sun), 0.0) + 0.08 * N.y";
  const v = "varying vec3 vM; void main() { vec4 m = instanceMatrix * vec4(position, 1.0); vM = m.xyz; gl_Position = vec4(0.0); }";
  const f = `uniform vec3 sun; varying vec3 vM; void main() { vec3 col = vec3(1.0), N = vec3(0.0, 1.0, 0.0); col *= ${LIT}; gl_FragColor = vec4(mix(col, fogC, 0.0), 1.0); }`;
  const wall = new THREE.ShaderMaterial({ uniforms: { tWalls: { value: null } }, vertexShader: v, fragmentShader: f }), prop = new THREE.ShaderMaterial({ uniforms: {}, vertexShader: v, fragmentShader: f });
  L.patch(wall); L.patch(prop);
  assert.ok(wall.vertexShader.includes("instanceMatrix[1].xyz") && wall.fragmentShader.includes("townLitWall(vTW, N, vTN, sun)"));
  assert.ok(prop.vertexShader.includes("vTN = vec3(0.0);") && !prop.vertexShader.includes("instanceMatrix[1]"));
  const ground = new THREE.ShaderMaterial({ uniforms: {}, vertexShader: "void main() {}", fragmentShader: "varying vec3 vW; void main() { vec3 col = vec3(1.0); gl_FragColor = vec4(mix(col, fogC, 0.0), 1.0); }" });
  L.patch(ground); assert.ok(ground.fragmentShader.includes("townFactorGround(vW)"));
});
