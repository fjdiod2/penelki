// Small things on and around blocks (sandbox_details.js): entrances, dishes, antennas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { V } from "../sandbox_blocks.js";
import { entranceDetails, facadeDishes, roofAntennas, inBlock, PORCH, PATH_W } from "../sandbox_details.js";

const block = { id: 1, pts: [[0, 0], [32, 0]], closed: false, D: 12, fl: 9, parent: null };
const door = (x, seed = 7) => ({ p: [x, -6], out: [0, -1], seed });          // on the wall at z = -6, facing -z

test("an entrance with no road in front: a 7 m path from the porch, benches facing it, a bin", () => {
  const { items, paths } = entranceDetails([door(8)], { blocks: [block] });
  assert.equal(paths.length, 1); const pth = paths[0];
  assert.ok(Math.abs(pth.a[1] - (-6 - PORCH)) < 1e-9 && Math.abs(V.dist(pth.a, pth.b) - 7) < 1e-9 && !pth.road);
  const benches = items.filter((i) => i.name.startsWith("bench"));
  assert.ok(benches.length >= 1 && items.some((i) => i.name.startsWith("bin")));
  for (const bn of benches) {
    const off = bn.p[0] - 8; assert.ok(Math.abs(off) > PATH_W / 2, "beside the path, not on it");
    const back = V.left(bn.a); assert.ok(V.dot(back, [Math.sign(off), 0]) > 0.99, "its back away from the path");
  }
});

test("a road in front: the path runs up to its kerb", () => {
  const road = { id: 5, pts: [[-20, -30], [60, -30]], w: 7 };
  const { paths } = entranceDetails([door(8)], { blocks: [block], roads: [road] });
  assert.ok(paths[0].road && Math.abs(paths[0].b[1] - (-30 + 3.5 + 0.25)) < 0.6, JSON.stringify(paths[0]));
});

test("nothing stands in water, in another block, or on a road; the same seed gives the same", () => {
  const other = { id: 2, pts: [[0, -16], [32, -16]], closed: false, D: 8, fl: 5, parent: null };      // a block 4 m in front of the porch ends
  const r = entranceDetails([door(8), door(20, 3)], { blocks: [block, other] });
  for (const i of r.items) assert.ok(!inBlock([i.p[0], i.p[2]], [block, other]), i.name);
  for (const pth of r.paths) assert.ok(!inBlock(pth.b, [other]), "the path stops before the block in front");
  assert.deepEqual(entranceDetails([door(8)], { blocks: [block] }), entranceDetails([door(8)], { blocks: [block] }));
  assert.equal(entranceDetails([door(8)], { blocks: [block], free: () => false }).paths.length, 0);
});

test("dishes: a few, on the wall face beside a window, their backs to the wall", () => {
  const ws = []; for (let k = 0; k < 10; k++) for (let f = 1; f < 9; f++) ws.push({ q: [1.6 + k * 3.2, -6], n: [0, 1], u: [1, 0], y: 0.8 + f * 2.8, f });
  const d = facadeDishes(ws, 11);
  assert.ok(d.length >= 1 && d.length <= 10, `${d.length} of 80 panels`);
  for (const x of d) { assert.ok(Math.abs(x.p[2] - (-6.06)) < 1e-9, "on the wall face"); assert.ok(V.dot(V.left(x.a), [0, 1]) > 0.99, "back to the wall"); }
  assert.deepEqual(facadeDishes(ws, 11), d);
});

test("antennas: on the roof, clear of the roof exits and of holes", () => {
  const long = { ...block, pts: [[0, 0], [96, 0]] }, exits = [[16, 0], [48, 0], [80, 0]], short = { ...block, pts: [[0, 0], [25.6, 0]] };
  let any = 0; for (let sd = 1; sd < 20; sd++) any += roofAntennas(short, 26, [[11.5, -1], [12.8, 0]], sd).length; assert.ok(any >= 10, "a short roof with an exit in the middle still gets antennas: " + any);
  const a = roofAntennas(long, 26, exits, 5);
  assert.ok(a.length >= 1); for (const x of a) { assert.equal(x.p[1], 26); assert.ok(exits.every((e) => V.dist(e, [x.p[0], x.p[2]]) >= 3.5) && Math.abs(x.p[2]) < 6); }
  assert.equal(roofAntennas(long, 26, exits, 5, () => true).length, 0);
});
