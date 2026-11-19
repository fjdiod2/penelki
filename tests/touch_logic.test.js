// The touch interface's arithmetic (sandbox_handles.js) and quick-building rules (sandbox_town.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockKit } from "./env.js";
import { V, pathLen } from "../sandbox_blocks.js";
import { createTown } from "../sandbox_town.js";
import { classifyTwo, blockHandles, cull, hitHandle } from "../sandbox_handles.js";

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
test("a straight block: floors above the roof, a push arrow on every wall, step tabs on the roof", () => {
  const b = block(), lay = kit.layout(b, 0), h = blockHandles(b, lay);
  assert.equal(h[0].kind, "floors"); assert.ok(h[0].at[1] > lay.top);
  const push = h.filter((x) => x.kind === "push");
  assert.equal(push.length, 4);
  for (const p of push) {                         // each push arrow stands just outside its wall and points away from the block
    const c = [5 * W, 0], q = [p.at[0], p.at[2]];
    assert.ok(V.dot(V.sub(q, c), p.dir) > 0, JSON.stringify(p));
    assert.ok(p.at[1] > lay.base && p.at[1] < lay.top);
  }
  const left = push.find((p) => p.wall.mode === "width" && p.wall.s === 1);
  assert.deepEqual(left.wall.n, V.left([1, 0]), "the +1 wall is the one to the left, as the core's push expects");
  const steps = h.filter((x) => x.kind === "step");
  assert.deepEqual(steps.map((x) => x.mode).sort(), ["corner", "end", "end", "side", "side"]);
  for (const s of steps) {                        // on the roof, inside it, pointing inward
    assert.ok(near(s.at[1], lay.top));
    const q = [s.at[0], s.at[2]]; assert.ok(q[0] > 0 && q[0] < 10 * W && Math.abs(q[1]) < 6);
    assert.ok(V.dot(V.sub([5 * W, 0], q), s.n) > 0, s.mode);
  }
});
test("a ring: floors, a push arrow outside its outer wall, a step tab", () => {
  const pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([30 * Math.cos(a), 30 * Math.sin(a)]); }
  for (const P of [pts, [...pts].reverse()]) {    // either way round
    const b = block({ pts: P, closed: true }), h = blockHandles(b, kit.layout(b, 0)), push = h.find((x) => x.kind === "push");
    assert.ok(Math.hypot(push.at[0], push.at[2]) > 36, "outside the outer wall (radius 36)");
    const step = h.find((x) => x.kind === "step"); assert.ok(Math.hypot(step.at[0], step.at[2]) < 36 && Math.hypot(step.at[0], step.at[2]) > 24);
  }
});
test("crowded handles: the earlier ones win, off-screen ones go", () => {
  assert.deepEqual(cull([[100, 100], [110, 100], [200, 100], null, [5000, 10]], 40, 400, 800), [0, 2]);
  assert.equal(hitHandle([[100, 100], [200, 100]], [0, 1], [190, 110], 30), 1);
  assert.equal(hitHandle([[100, 100], [200, 100]], [0], [190, 110], 30), -1, "a hidden handle is not hit");
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
