// Roads (sandbox_streets.js): surfaces and kerbs at junctions, snapping, and what stands along them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { V } from "../sandbox_blocks.js";
import { endExt, roadStrip, onRoad, kerbs, snapToRoads, roadAt, roadProps, KERB } from "../sandbox_streets.js";

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const road = (id, a, b, w = 7) => ({ id, pts: [a, b], w });
const len = (k) => k.slice(1).reduce((a, p, i) => a + V.dist(k[i], p), 0);

test("a road on its own: a w-wide strip, kerbs the whole length on both sides", () => {
  const r = road(1, [0, 0], [50, 0]), st = roadStrip(r, [r]);
  assert.ok(near(V.dist(st.left[0], st.right[0]), 7) && near(st.s[st.s.length - 1], 50));
  const k = kerbs(r, [r]); assert.equal(k.length, 2); for (const run of k) assert.ok(near(len(run), 50, 0.01));
});

test("a bent road is one strip: mitred, the same width all along, one unbroken kerb each side", () => {
  const r = { id: 1, pts: [[0, 0], [30, 0], [50, 20], [50, 50]], w: 4 }, st = roadStrip(r, [r]);
  assert.equal(st.left.length, 4);
  for (let i = 1; i < 3; i++) { const c = r.pts[i]; assert.ok(V.dist(st.left[i], c) > 2 - 1e-6 && V.dist(st.left[i], c) < 2 / Math.cos(Math.PI / 8) + 1e-6, "mitred joint"); }
  const k = kerbs(r, [r]); assert.equal(k.length, 2, "unbroken");
  assert.ok(onRoad([40, 9], r, [r]) && !onRoad([40, 0], r, [r]), "the bend is on it, its outside corner is not");
});

test("where two roads meet end to end only one covers the corner: the lower id reaches over, the other stops at its edge", () => {
  const a = road(1, [0, 0], [50, 0]), b = road(2, [50, 0], [50, 40], 4), roads = [a, b];
  assert.deepEqual(endExt(a, roads), [0, 2]); assert.deepEqual(endExt(b, roads), [-3.5, 0]);
  assert.ok(onRoad([51.9, -3.4], a, roads) && !onRoad([51.9, -3.4], b, roads), "the outer corner: a only");
  assert.ok(!onRoad([50, 2], b, roads) && onRoad([50, 4], b, roads), "b starts at a's edge");
});

test("a T junction: the side road stops at the through road's edge; the through road's kerb stops for it", () => {
  const main = road(1, [0, 0], [60, 0]), side = road(2, [30, 0], [30, 40], 4), roads = [main, side];
  assert.deepEqual(endExt(side, roads), [-3.5, 0]);
  assert.ok(!onRoad([30, 2], side, roads), "no second surface on the main road");
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

test("along a bent road the props follow the bends", () => {
  const r = { id: 7, pts: [[0, 0], [60, 0], [100, 40], [100, 120]], w: 7 }, { items } = roadProps(r, { roads: [r], blocks: [{ id: 1, pts: [[110, 0], [110, 120]], D: 12, closed: false, parent: null }], attach });
  assert.ok(items.length > 4);
  for (const i of items) { const n = (pts, p) => Math.min(...pts.slice(1).map((q, k) => { const a = pts[k], d = V.sub(q, a), t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), d) / V.dot(d, d))); return V.dist(p, V.add(a, V.mul(d, t))); }));
    const d = n(r.pts, [i.p[0], i.p[2]]); assert.ok(i.name.startsWith("car") ? d < 3.5 : d > 3.5 && d < 7, `${i.name} ${d.toFixed(2)} m from the centre line`); }
});

test("a loop: a strip all the way round, kerbs unbroken (one inside, one outside), no ends to join", () => {
  const pts = []; for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push([30 * Math.cos(a), 30 * Math.sin(a)]); }
  const r = { id: 3, pts, w: 4, closed: true }, st = roadStrip(r, [r]);
  assert.equal(st.left.length, 41); assert.ok(V.dist(st.left[0], st.left[40]) < 1e-9, "closed up");
  const k = kerbs(r, [r]); assert.equal(k.length, 2); assert.deepEqual(endExt(r, [r]), [0, 0]);
  assert.ok(onRoad([30, 0], r, [r]) && onRoad([0, -31], r, [r]) && !onRoad([0, 0], r, [r]));
  const link = road(4, [0, 60], [0, 30]); assert.deepEqual(endExt(link, [r, link]), [0, -2], "a road ending on the loop stops at its edge");
});
