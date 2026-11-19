// Roads (sandbox_streets.js): surfaces and kerbs at junctions, snapping, and what stands along them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { V } from "../sandbox_blocks.js";
import { endExt, roadQuad, onRoad, kerbs, snapToRoads, roadAt, roadProps, KERB } from "../sandbox_streets.js";

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const road = (id, a, b, w = 7) => ({ id, pts: [a, b], w });
const len = (k) => V.dist(k[0], k[1]);

test("a road on its own: a w-wide strip, kerbs the whole length on both sides", () => {
  const r = road(1, [0, 0], [50, 0]), q = roadQuad(r, [r]);
  assert.ok(near(V.dist(q[0], q[3]), 7) && near(V.dist(q[0], q[1]), 50));
  const k = kerbs(r, [r]); assert.equal(k.length, 2); for (const run of k) assert.ok(near(len(run), 50, 0.01));
});

test("an L corner: both ends reach into the other road, so the corner is filled", () => {
  const a = road(1, [0, 0], [50, 0]), b = road(2, [50, 0], [50, 40], 4), roads = [a, b];
  assert.deepEqual(endExt(a, roads), [0, 2]); assert.deepEqual(endExt(b, roads), [3.5, 0]);
  assert.ok(onRoad([51.9, -3.4], a, roads) && onRoad([51.9, -3.4], b, roads), "the outer corner is covered");
});

test("a T junction: the through road's kerb stops where the side road joins, the side road's kerbs end at it", () => {
  const main = road(1, [0, 0], [60, 0]), side = road(2, [30, 0], [30, 40], 4), roads = [main, side];
  const km = kerbs(main, roads), lf = V.left([1, 0]);
  const sideOfMain = km.filter((k) => V.dot(k[0], lf) * Math.sign(V.dot([30, 40], lf)) > 0);
  assert.equal(sideOfMain.length, 2, "split in two around the junction");
  for (const k of sideOfMain) assert.ok(k.every((p) => Math.abs(p[0] - 30) > 2 - 0.3), "not across the side road");
  for (const k of kerbs(side, roads)) assert.ok(Math.min(...k.map((p) => p[1])) > 3.5 - 0.6, "the side road's kerbs start at the main road's edge");
});

test("snapping a road end: to another road's end first, then onto its centre line", () => {
  const a = road(1, [0, 0], [50, 0]), roads = [a];
  assert.deepEqual(snapToRoads([49, 1.5], roads, 3).p, [50, 0]);
  const t = snapToRoads([20, 2.5], roads, 3); assert.ok(near(t.p[0], 20) && near(t.p[1], 0) && t.why === "joins the road");
  assert.equal(snapToRoads([20, 20], roads, 3), null);
  assert.equal(roadAt([20, 3], roads), 0); assert.equal(roadAt([20, 10], roads), -1);
});

const blocks = [{ id: 1, pts: [[0, 15], [60, 15]], D: 12, closed: false, fl: 9, parent: null }];
const attach = { pole_0: [[0, 0.27, 9.2], [0, -0.27, 8.8]], pole_1: [[0, -0.85, 10.7], [0, 0.85, 10.7]], pole_2: [[0.38, 0.52, 8.8]] };

test("along a road: lamps on one side facing it, poles with wires on the other, cars only near blocks", () => {
  const r = road(7, [0, 0], [120, 0]), { items, wires } = roadProps(r, { roads: [r], blocks, attach });
  const lamps = items.filter((i) => i.name.startsWith("lamp")), poles = items.filter((i) => i.name.startsWith("pole")), cars = items.filter((i) => i.name.startsWith("car"));
  assert.ok(lamps.length >= 3 && poles.length >= 2 && cars.length >= 1, JSON.stringify([lamps.length, poles.length, cars.length]));
  const sideOf = (it) => Math.sign(it.p[2]);
  assert.ok(lamps.every((l) => sideOf(l) === sideOf(lamps[0])) && poles.every((p) => sideOf(p) === -sideOf(lamps[0])), "lamps and poles on opposite sides");
  for (const l of lamps) { const back = V.left(l.a); assert.ok(V.dot(back, [0, Math.sign(l.p[2])]) > 0.99, "a lamp's back to the verge, its arm over the road"); }
  for (const l of [...lamps, ...poles]) assert.ok(Math.abs(l.p[2]) > 3.5 + KERB.w, "off the road");
  for (const c of cars) { assert.ok(Math.abs(c.p[2]) < 3.5, "cars on the road's edge"); assert.ok(c.p[0] < 60 + 6 + 30 + 1, "and near the block"); }
  assert.ok(wires.length >= poles.length - 1 && wires.every((w) => w.length > 2), "wires between neighbouring poles");
  const w = wires[0], mid = w[Math.floor(w.length / 2)]; assert.ok(mid[1] < w[0][1] && mid[1] < w[w.length - 1][1], "sagging");
});

test("the same road always gets the same things; nothing stands in water or on another road", () => {
  const r = road(9, [0, 0], [90, 0]), cross = road(10, [45, -30], [45, 30]), roads = [r, cross];
  assert.deepEqual(roadProps(r, { roads, blocks, attach }), roadProps(r, { roads, blocks, attach }));
  const wet = roadProps(r, { roads, blocks, attach, free: (p) => p[0] < 30 });
  assert.ok(wet.items.every((i) => i.p[0] < 30), "none past x = 30 (water)");
  for (const i of roadProps(r, { roads, blocks, attach }).items) assert.ok(!onRoad([i.p[0], i.p[2]], cross, roads, -1), i.name);
});

test("a short road gets no poles", () => {
  const r = road(3, [0, 0], [30, 0]); assert.equal(roadProps(r, { roads: [r], blocks, attach }).items.filter((i) => i.name.startsWith("pole")).length, 0);
});
