// The town's rules (sandbox_town.js): stacking, step backs, wall panel grids, extrude and dig, demolishing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockKit } from "./env.js";
import { V, pathLen } from "../sandbox_blocks.js";
import { createTown, MIN_D } from "../sandbox_town.js";

const kit = await blockKit();
const { W, H, PL } = kit;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const block = (o = {}) => ({ id: 1, pts: [[0, 0], [10 * W, 0]], closed: false, D: 12, fl: 5, fin: "concrete", seed: 7, parent: null, ...o });
function townOf(blocks, trees = []) { const S = { blocks, trees, nextId: Math.max(0, ...blocks.map((b) => b.id)) + 1 }, T = createTown(kit, () => S); T.reindex(); return { S, T }; }

test("heights: on the ground, on a roof, out of a wall", () => {
  const { T } = townOf([block(), block({ id: 2, parent: 1, fl: 3 }), block({ id: 3, at: { id: 1, f: 2 }, fl: 2 })]);
  const [a, b, c] = [1, 2, 3].map((i) => T.byId.get(i));
  assert.ok(near(T.topOf(a), PL + 5 * H));
  assert.ok(near(T.baseOf(b), PL + 5 * H) && near(T.topOf(b), PL + 8 * H));
  assert.ok(near(T.baseOf(c), PL + 2 * H) && near(T.topOf(c), PL + 4 * H), "an extrusion starts at its wall's floor 2, no plinth");
  assert.ok(T.isGround(a) && !T.isGround(b) && !T.isGround(c));
});

test("demolish takes what stands on the block and the trees on it", () => {
  const { S, T } = townOf([block(), block({ id: 2, parent: 1 }), block({ id: 3, at: { id: 2, f: 0 } }), block({ id: 4, pts: [[0, 50], [32, 50]] })],
    [{ x: 1, z: 1, b: 2 }, { x: 5, z: 80 }]);
  assert.deepEqual([...T.demolish(1)].sort(), [1, 2, 3]);
  assert.deepEqual(S.blocks.map((b) => b.id), [4]); assert.equal(S.trees.length, 1);
});

test("step back from an end: shorter by the inset, never below two panels", () => {
  const { T } = townOf([block()]), b = T.byId.get(1);
  const t = T.terracePts(b, 3 * W, "end", 1);
  assert.ok(near(pathLen(t.pts, false), 7 * W) && near(t.pts[0][0], 0), "end 1 trimmed, end 0 stays");
  assert.ok(near(pathLen(T.terracePts(b, 100, "end", 0).pts, false), 2 * W));
});

test("step back a long wall: narrower on that side only", () => {
  const { T } = townOf([block()]), b = T.byId.get(1), lf = V.left([1, 0]);
  const t = T.terracePts(b, 3, "side", 1);                                               // the left wall comes in by 3
  assert.equal(t.D, 9);
  const left = (pts, D) => V.dot(pts[0], lf) + D / 2, right = (pts, D) => V.dot(pts[0], lf) - D / 2;
  assert.ok(near(left(t.pts, t.D), 6 - 3) && near(right(t.pts, t.D), -6), "right wall where it was");
  assert.equal(T.terracePts(b, 100, "side", 1).D, MIN_D);
});

test("step back all round (a pyramid step): shorter at both ends and narrower", () => {
  const { T } = townOf([block()]), t = T.terracePts(T.byId.get(1), 2, "corner");
  assert.ok(near(pathLen(t.pts, false), 10 * W - 4) && t.D === 8);
});

test("a ring steps in all round, but never closes up", () => {
  const pts = []; for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push([40 * Math.cos(a), 40 * Math.sin(a)]); }
  const { T } = townOf([block({ pts, closed: true })]), b = T.byId.get(1);
  const r = (q) => Math.hypot(q[0], q[1]);
  assert.ok(near(r(T.terracePts(b, 5).pts[0]), 35, 0.5));
  const t = T.terracePts(b, 39); assert.ok(t.inset < 39 && r(t.pts[0]) > 6, `inset ${t.inset}`);
});

test("wall frames: a long wall has a panel per module, an end wall four 3 m panels", () => {
  const { T } = townOf([block()]), b = T.byId.get(1);
  const L = T.wallFrame(b, { long: 1 }), E = T.wallFrame(b, { end: 0 });
  assert.equal(L.n, 10); assert.ok(near(L.m, W) && near(L.y0, PL) && L.deep === 12);
  assert.equal(E.n, 4); assert.ok(near(E.m, 3) && near(E.deep, 10 * W));
  assert.equal(T.wallFrame(block({ closed: true }), { long: 1 }), null);
});

test("cellAt finds the panel under a point on the wall", () => {
  const { T } = townOf([block()]), b = T.byId.get(1), F = T.wallFrame(b, { long: -1 });
  const p = V.add(F.o, V.mul(F.ax, 4.5 * W)), c = T.cellAt(b, p, PL + 2.5 * H);
  assert.deepEqual([c.wall, c.k, c.f], [{ long: -1 }, 4, 2]);
  assert.equal(T.cellAt(b, [5 * W, 0], 5), null, "inside the block: no wall");
});

test("extrude: a choice of 3 x 2 panels pulled out 4.8 m makes a block on that wall at that floor", () => {
  const { T } = townOf([block()]), b = T.byId.get(1), sl = { b, wall: { long: 1 }, k0: 5, k1: 3, f0: 2, f1: 1 };
  const x = T.extrudeBlock(sl, 4.8, 99), F = T.wallFrame(b, sl.wall);
  assert.deepEqual(x.at, { id: 1, f: 1 }); assert.equal(x.fl, 2); assert.equal(x.id, 2);
  assert.ok(near(pathLen(x.pts, false), 3 * W) && near(x.D, 4.8), "wider than deep: runs along the wall");
  const mid = V.lerp(x.pts[0], x.pts[1], 0.5), out = V.dot(V.sub(mid, F.o), F.N);
  assert.ok(near(out, 2.4), "its middle is half its depth out from the wall");
  const deep = T.extrudeBlock({ ...sl, k0: 4, k1: 4 }, 20, 1);                            // deeper than wide: runs out from the wall
  assert.ok(near(pathLen(deep.pts, false), 20) && near(deep.D, W));
});

test("dig: a cut from a long wall or an end, as cutRects reads it", () => {
  const { T } = townOf([block()]), b = T.byId.get(1);
  assert.deepEqual(T.digCut({ b, wall: { long: -1 }, k0: 2, k1: 4, f0: 0, f1: 1 }, 3.2), { side: -1, s0: 2 * W, s1: 5 * W, f0: 0, f1: 2, d: 3.2 });
  const e = T.digCut({ b, wall: { end: 1 }, k0: 1, k1: 2, f0: 3, f1: 3 }, 6.4);
  assert.equal(e.end, 1); assert.ok(near(e.w0, -3) && near(e.w1, 3) && e.f0 === 3 && e.f1 === 4);
});

test("pull depth: half-panel steps, only out in Build out, only in for Dig, right through when nearly through", () => {
  const { T } = townOf([block()]);
  assert.equal(T.pullDepth(0.5, "out", 12), 0);
  assert.ok(near(T.pullDepth(4, "out", 12), 4.8));
  assert.equal(T.pullDepth(-4, "out", 12), 0);
  assert.equal(T.pullDepth(4, "dig", 12), 0);
  assert.ok(near(T.pullDepth(-4.5, "dig", 12), -4.8));
  assert.equal(T.pullDepth(-11.5, "dig", 12), -12);
  assert.equal(T.pullDepth(-50, "dig", 12), -12);
  assert.equal(T.pullDepth(3.33, "out", 12, true), 3.33);
});

test("holes: the hole under a point on a dug floor, and which edge of it is near", () => {
  const { T } = townOf([block({ cuts: [{ side: 1, s0: 3 * W, s1: 6 * W, f0: 2, f1: 4, d: 12 }] })]), b = T.byId.get(1);
  const r = T.holeAt(b, [4.5 * W, 0], 2); assert.ok(r && near(r.s0, 3 * W) && r.f0 === 2);
  assert.equal(T.holeAt(b, [8 * W, 0], 2), null);
  assert.equal(T.holeEdgeAt(b, [3 * W + 1, 0], r, 2.4), "s0");
  assert.equal(T.holeEdgeAt(b, [4.5 * W, 0], r, 2.4), null);
});
