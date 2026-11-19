// Yards (sandbox_yards.js): the paint-bucket fill and what is laid out in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { V } from "../sandbox_blocks.js";
import { yardCells, yardLayout, REACH, DRIVE_OFF } from "../sandbox_yards.js";
import { onRoad } from "../sandbox_streets.js";
import { inBlock } from "../sandbox_details.js";

const slab = (id, z, x0 = -40, x1 = 40) => ({ id, pts: [[x0, z], [x1, z]], closed: false, D: 12, fl: 9, parent: null });
const ring = (id, r) => { const pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([r * Math.cos(a), r * Math.sin(a)]); } return { id, pts, closed: true, D: 12, fl: 9, parent: null }; };

test("inside a ring the fill is the courtyard, and only that", () => {
  const Y = yardCells([0, 0], { blocks: [ring(1, 40)] });
  assert.ok(Y && Y.at([20, 0]) && Y.at([-25, 10]) && !Y.at([50, 0]) && !Y.at([0, 40]));
  assert.ok(Math.abs(Y.area - Math.PI * 34 * 34) < 0.15 * Math.PI * 34 * 34, `${Y.area} m²`);
});

test("between two slabs: the strip between them; in front of one: no further than REACH from it", () => {
  const blocks = [slab(1, 0), slab(2, 50)], Y = yardCells([0, 25], { blocks });
  assert.ok(Y.at([30, 25]) && Y.at([0, 8]) && Y.at([0, 42]) && !Y.at([0, -8]));
  const lone = yardCells([0, -20], { blocks: [slab(1, 0)] });
  assert.ok(lone.at([0, -6 - REACH + 2]) && !lone.at([0, -6 - REACH - 3]), "stops REACH m out");
  assert.equal(yardCells([0, 0], { blocks: [slab(1, 0)] }), null, "inside a block: no yard");
  assert.equal(yardCells([300, 300], { blocks: [slab(1, 0)] }), null, "far from blocks: no yard");
});

test("a road splits a space into two yards; water is not yard", () => {
  const blocks = [slab(1, 0), slab(2, 50)], roads = [{ id: 9, pts: [[0, -60], [0, 110]], w: 7 }];
  const Y = yardCells([-20, 25], { blocks, roads });
  assert.ok(Y.at([-20, 25]) && !Y.at([20, 25]), "stops at the road");
  const wet = yardCells([-20, 25], { blocks, roads, free: (p) => p[0] > -30 });
  assert.ok(!wet.at([-35, 25]));
});

const door = (x, z, oz) => ({ p: [x, z], out: [0, oz] });
test("a driveway runs along the entrance side, DRIVE_OFF m out, and is joined to the nearest road", () => {
  const blocks = [slab(1, 0), slab(2, 60)], roads = [{ id: 9, pts: [[60, -60], [60, 120]], w: 7 }];
  const entrances = [door(-24, 6, 1), door(-8, 6, 1), door(8, 6, 1), door(24, 6, 1)];      // block 1's entrances face +z, into the yard
  const Y = yardCells([0, 30], { blocks, roads }), L = yardLayout(Y, { id: 4, seed: 9, entrances, blocks, roads });
  const drive = L.roads[0]; assert.ok(drive.yard && drive.w === 4);
  assert.ok(Math.abs(drive.pts[0][1] - (6 + DRIVE_OFF)) < 1e-6 && Math.abs(drive.pts[1][1] - (6 + DRIVE_OFF)) < 1e-6, "parallel to the wall");
  assert.ok(Math.min(drive.pts[0][0], drive.pts[1][0]) < -24 && Math.max(drive.pts[0][0], drive.pts[1][0]) > 24, "past the end entrances");
  const link = L.roads[1]; assert.ok(link && Math.abs(link.pts[1][0] - 60) < 1e-6, "linked to the road");
  for (const r of L.roads) assert.ok(new Set(r.pts.map((p) => p.join())).size === 2);
});

test("a playground in the quietest spot, a kiosk by the road with its back to the yard; nothing in a block or on a road", () => {
  const blocks = [slab(1, 0), slab(2, 70)], roads = [{ id: 9, pts: [[-60, -60], [-60, 130]], w: 7 }];
  const Y = yardCells([0, 35], { blocks, roads });
  let kiosks = 0;
  for (let seed = 1; seed < 12; seed++) {
    const L = yardLayout(Y, { id: 4, seed, entrances: [door(0, 6, 1)], blocks, roads }), all = [...roads, ...L.roads];
    const play = L.items.filter((i) => i.name.startsWith("play"));
    assert.ok(play.length >= 3, `seed ${seed}: ${play.length}`);
    for (const p of play) { const q = [p.p[0], p.p[2]]; assert.ok(q[1] > 6 + 7 && q[1] < 64 - 7, "away from both walls"); }
    for (const i of L.items) { const q = [i.p[0], i.p[2]]; assert.ok(!inBlock(q, blocks) && !all.some((o) => onRoad(q, o, all, -0.2)), i.name); }
    for (const k of L.items.filter((i) => i.name.startsWith("kiosk"))) { kiosks++; assert.ok(k.p[0] < -60 + 3.5 + 5, "by the road"); assert.ok(V.dot(V.left(k.a), [1, 0]) > 0.9, "its back to the yard"); }
  }
  assert.ok(kiosks >= 5, `${kiosks} kiosks in 11 yards`);
});

test("round a ring: one continuous driveway at a steady distance from the wall, not overlapping pieces", () => {
  const b = ring(1, 45), es = [];
  for (let k = 0; k < 12; k++) { if (k === 7) continue; const a = (k / 12) * Math.PI * 2, c = [Math.cos(a), Math.sin(a)]; es.push({ p: V.mul(c, 45 - 6), out: V.mul(c, -1), b: 1 }); }   // all round, one missing
  const Y = yardCells([0, 0], { blocks: [b] }), L = yardLayout(Y, { id: 3, seed: 2, entrances: es, blocks: [b] });
  const drives = L.roads.filter((r) => r.pts.length > 2);
  assert.equal(drives.length, 1, `one driveway, got ${L.roads.length} roads`);
  const d = drives[0], r0 = 45 - 6 - DRIVE_OFF;
  for (const p of d.pts) assert.ok(Math.abs(V.len(p) - r0) < 0.6, `radius ${V.len(p).toFixed(2)}`);
  for (let i = 1; i < d.pts.length; i++) assert.ok(V.dist(d.pts[i - 1], d.pts[i]) < 3.5, "continuous");
  const span = d.pts.slice(1).reduce((s, p, i) => s + V.dist(d.pts[i], p), 0); assert.ok(span > 0.7 * 2 * Math.PI * r0, `most of the way round: ${span.toFixed(0)} m`);
});
