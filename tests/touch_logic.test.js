// The touch interface's arithmetic (sandbox_handles.js) and quick-building rules (sandbox_town.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockKit } from "./env.js";
import { V, pathLen } from "../sandbox_blocks.js";
import { createTown } from "../sandbox_town.js";
import { classifyTwo, blockHandles, outline, selHandles, arrange, hitHandle } from "../sandbox_handles.js";

const kit = await blockKit();
const { W, E4 } = kit;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const block = (o = {}) => ({ id: 1, pts: [[0, 0], [10 * W, 0]], closed: false, D: 12, fl: 5, fin: "concrete", seed: 7, parent: null, ...o });
function townOf(blocks) { const S = { blocks, trees: [], nextId: Math.max(0, ...blocks.map((b) => b.id)) + 1 }, T = createTown(kit, () => S); T.reindex(); return { S, T }; }

// ---- two fingers
const start = [[100, 400], [250, 400]];
test("two fingers going up together, side by side, tilt", () => {
  assert.equal(classifyTwo(start, [[101, 360], [249, 362]]), "tilt");
  assert.equal(classifyTwo(start, [[100, 440], [250, 441]]), "tilt");
});
test("too little movement: not decided yet", () => assert.equal(classifyTwo(start, [[103, 396], [252, 398]]), null));
test("sliding sideways, pinching, twisting, or one finger up and one down: move", () => {
  assert.equal(classifyTwo(start, [[140, 400], [290, 401]]), "move");
  assert.equal(classifyTwo(start, [[70, 400], [280, 400]]), "move");
  assert.equal(classifyTwo(start, [[100, 360], [250, 440]]), "move");
  assert.equal(classifyTwo(start, [[100, 360], [250, 330]]), "move", "fingers moving apart up the screen (pinch while moving)");
});
test("fingers one above the other moving up: a slide, not a tilt", () => {
  assert.equal(classifyTwo([[200, 300], [210, 500]], [[200, 260], [210, 460]]), "move");
});

// ---- handles
const centre = [5 * W, 0];
test("a block just placed: walls, move, floors; no step backs yet", () => {
  const b = block(), lay = kit.layout(b, 0), h = blockHandles(b, lay, "place");
  assert.deepEqual(h.map((x) => x.kind), ["push", "push", "push", "push", "move", "floors"]);
  for (const p of h.filter((x) => x.kind === "push")) assert.ok(V.dot(V.sub([p.at[0], p.at[2]], centre), [p.dir[0], p.dir[2]]) > 0, "each arrow points away from the block");
  const left = h.find((p) => p.kind === "push" && p.wall.mode === "width" && p.wall.s === 1);
  assert.deepEqual(left.wall.n, V.left([1, 0]), "the +1 wall is the one to the left, as the core's push expects");
});
test("a built block, selected: walls, floors and step-back tabs on the roof pointing inward", () => {
  const b = block(), lay = kit.layout(b, 0), h = blockHandles(b, lay, "select");
  assert.ok(!h.some((x) => x.kind === "move"));
  const steps = h.filter((x) => x.kind === "step");
  assert.deepEqual(steps.map((x) => x.mode).sort(), ["corner", "end", "end", "side", "side"]);
  for (const s of steps) { const q = [s.at[0], s.at[2]]; assert.ok(near(s.at[1], lay.top) && Math.abs(q[1]) < 6 && V.dot(V.sub(centre, q), s.n) > 0, s.mode); }
});
test("a ring: a push arrow on its outer wall, either way round", () => {
  const pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([30 * Math.cos(a), 30 * Math.sin(a)]); }
  for (const P of [pts, [...pts].reverse()]) {
    const b = block({ pts: P, closed: true }), h = blockHandles(b, kit.layout(b, 0), "select"), push = h.find((x) => x.kind === "push");
    assert.ok(near(Math.hypot(push.at[0], push.at[2]), 36, 0.2) && V.dot([push.at[0], push.at[2]], [push.dir[0], push.dir[2]]) > 0);
    const step = h.find((x) => x.kind === "step"); assert.ok(Math.hypot(step.at[0], step.at[2]) < 36 && Math.hypot(step.at[0], step.at[2]) > 24);
  }
});
// a camera looking straight down: x right, z down the screen, 10 px a metre; or from the front, low
const topView = (q) => [200 + 10 * q[0], 400 + 10 * q[2]];
const frontView = (q) => [200 + 10 * q[0], 400 - 10 * q[1] + 2 * q[2]];
test("on screen every wall's arrow sits outside the block, on its own side, none overlapping", () => {
  for (const view of [topView, frontView]) {
    const b = block({ pts: [[-12.8, 0], [12.8, 0]] }), lay = kit.layout(b, 0), hs = blockHandles(b, lay, "place"), pts = arrange(hs, view, outline(lay), { gap: 44 });
    const box = outline(lay).map(view), xs = box.map((q) => q[0]), ys = box.map((q) => q[1]);
    hs.forEach((h, i) => {
      assert.ok(pts[i], `${h.kind} ${JSON.stringify(h.wall)} shown`);
      if (h.kind === "push") assert.ok(pts[i][0] < Math.min(...xs) || pts[i][0] > Math.max(...xs) || pts[i][1] < Math.min(...ys) || pts[i][1] > Math.max(...ys), "outside");
    });
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(V.dist(pts[i], pts[j]) >= 44);
  }
  const b = block(), lay = kit.layout(b, 0), hs = blockHandles(b, lay, "place"), pts = arrange(hs, topView, outline(lay));
  const end1 = pts[hs.findIndex((h) => h.wall && h.wall.end === 1)], end0 = pts[hs.findIndex((h) => h.wall && h.wall.end === 0)];
  assert.ok(end1[0] > end0[0] + 300, "the end arrows on their ends");
});
test("handles off the screen or behind the camera are not shown; hits find the nearest shown one", () => {
  const hs = [{ kind: "move", place: "at", at: [0, 0, 0] }, { kind: "move", place: "at", at: [1000, 0, 0] }, { kind: "move", place: "at", at: [5, 0, 0] }];
  const pts = arrange(hs, (q) => (q[0] === 5 ? null : topView(q)), [], { w: 400, h: 800 });
  assert.deepEqual(pts.map(Boolean), [true, false, false]);
  assert.equal(hitHandle([[100, 100], null, [200, 100]], [190, 110], 30), 2);
  assert.equal(hitHandle([[100, 100], null], [190, 110], 30), -1);
});
test("a choice of panels: arrows on its four edges and a move handle; then one pull arrow, out or in", () => {
  const { T } = townOf([block()]), F = T.wallFrame(T.byId.get(1), { long: -1 }), box = { t0: 2 * W, t1: 5 * W, f0: 1, f1: 3 };
  const h = selHandles(F, box, kit.H, "choose");
  assert.deepEqual(h.map((x) => x.edge || x.kind), ["k1", "k0", "f1", "f0", "move"]);
  const up = h.find((x) => x.edge === "f1"); assert.ok(near(up.at[1], F.y0 + 3 * kit.H));
  const [out] = selHandles(F, box, kit.H, "pull", true), [dig] = selHandles(F, box, kit.H, "pull", false);
  assert.deepEqual([out.dir[0], out.dir[2]], F.N); assert.deepEqual([dig.dir[0], dig.dir[2]], V.mul(F.N, -1));
});
// ---- quick building
test("a new block from a tap: 8 panels by 12 m, its corner where asked", () => {
  const { T } = townOf([]), b = T.newBlock([10, 20], 0);
  assert.ok(near(pathLen(b.pts, false), 8 * W) && b.D === 12 && b.fl === 5);
  const corner = V.add(b.pts[0], V.mul(V.left([1, 0]), -6)); assert.ok(near(corner[0], 10) && near(corner[1], 20));
});
test("a block on a roof: along it, over its panels, kept on it, centred across", () => {
  const { T } = townOf([block({ D: 18 })]), P = T.byId.get(1);
  const r = T.roofBlock(P, [5 * W + 0.4, 3]);
  assert.equal(r.parent, 1); assert.equal(r.D, 12);
  assert.ok(near(pathLen(r.pts, false), 4 * W) && near(r.pts[0][1], 0), "centred across");
  assert.ok(near(r.pts[0][0] / W, Math.round(r.pts[0][0] / W)), "starts on a panel joint");
  const atEnd = T.roofBlock(P, [10 * W - 0.5, 0]); assert.ok(near(atEnd.pts[1][0], 10 * W), "kept on the roof");
  const short = T.roofBlock(townOf([block({ pts: [[0, 0], [3 * W, 0]] })]).T.byId.get(1), [1, 0]); assert.ok(near(pathLen(short.pts, false), 3 * W));
  assert.equal(T.roofBlock(block({ closed: true }), [0, 0]), null);
});
test("step back snapping: whole panels at the ends, whole end-wall panels at the sides", () => {
  const { T } = townOf([block()]), b = T.byId.get(1);
  assert.ok(near(T.stepSnap(b, 7, "end"), 2 * W));
  assert.ok(near(T.stepSnap(b, 4.4, "side"), E4));
  assert.ok(near(T.stepSnap(b, 1, "corner"), 0));
});

test("moving a tier on its roof: whole panels, flush with an edge, or centred", () => {
  const { T } = townOf([block(), block({ id: 2, parent: 1, pts: [[0, 0], [4 * W, 0]], D: 6 })]), P = T.byId.get(1), t = T.byId.get(2);
  let r = T.tierMove(t, P, [1.3 * W, 0], 0.5); assert.ok(near(r.delta[0], W) && near(r.delta[1], 0), "one panel along");
  r = T.tierMove(t, P, [3 * W - 0.2, 0], 0.5); assert.ok(near(r.delta[0], 3 * W) && r.why.includes("centred"), r.why);
  r = T.tierMove(t, P, [5.9 * W, 0], 0.5); assert.ok(near(r.delta[0], 6 * W) && r.why.startsWith("flush"), "flush with the far end");
  const lf = V.left([1, 0]); r = T.tierMove(t, P, V.mul(lf, 2.9), 0.5); assert.ok(near(V.dot(r.delta, lf), 3) && r.why === "flush", "flush with the side");
});
test("translate moves the block, what stands on it and its trees", () => {
  const { S, T } = townOf([block(), block({ id: 2, parent: 1 }), block({ id: 3, pts: [[0, 50], [10, 50]] })]); S.trees = [{ x: 1, z: 1, b: 2 }, { x: 1, z: 1 }];
  T.translate(1, [10, 5]);
  assert.deepEqual(S.blocks.map((b) => b.pts[0]), [[10, 5], [10, 5], [0, 50]]); assert.deepEqual([S.trees[0].x, S.trees[1].x], [11, 1]);
});

test("a tier is only centred along its roof where that keeps its panels over the panels below", () => {
  const odd = townOf([block({ pts: [[0, 0], [14 * W, 0]] }), block({ id: 2, parent: 1, pts: [[0, 0], [7 * W, 0]] })]);
  const r = odd.T.tierMove(odd.T.byId.get(2), odd.T.byId.get(1), [3.5 * W, 0], 1);    // 7 on 14: centred would be 3.5 panels in
  assert.ok(!r.why.includes("centred") || Math.abs(r.delta[0] / W - Math.round(r.delta[0] / W)) < 1e-6);
  assert.ok(Math.abs(r.delta[0] / W - Math.round(r.delta[0] / W)) < 1e-6, `on a joint: ${r.delta[0] / W} panels`);
  const even = townOf([block({ pts: [[0, 0], [14 * W, 0]] }), block({ id: 2, parent: 1, pts: [[0, 0], [6 * W, 0]] })]);
  const e = even.T.tierMove(even.T.byId.get(2), even.T.byId.get(1), [3.9 * W, 0], 1); assert.ok(near(e.delta[0], 4 * W) && e.why.includes("centred"));
});
