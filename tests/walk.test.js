// Walking about at street level (sandbox_walk.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lensFov, fovLens, lookDir, yawPitch, clampPitch, walkStep, walkTo, BODY, PITCH_MAX } from "../sandbox_walk.js";

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const wallAtX10 = (q) => 10 - q[0];               // a wall along x = 10 (inside beyond it)

test("lenses: 24 mm is about 53 degrees tall, 50 mm about 27; and back", () => {
  assert.ok(near(lensFov(24), 53.13, 0.01) && near(lensFov(50), 26.99, 0.01));
  assert.ok(near(fovLens(lensFov(18)), 18, 1e-9));
});
test("looking: yaw and pitch to a direction and back; never quite straight up", () => {
  const d = lookDir(0.7, 0.4); assert.ok(near(Math.hypot(...d), 1)); const yp = yawPitch(d); assert.ok(near(yp.yaw, 0.7) && near(yp.pitch, 0.4));
  assert.equal(clampPitch(2), PITCH_MAX); assert.equal(clampPitch(-2), -PITCH_MAX);
});
test("walking into a wall stops short of it; at an angle it slides along it", () => {
  assert.deepEqual(walkStep([5, 0], [1, 0], wallAtX10), [6, 0]);
  const at = walkStep([9.4, 0], [0.5, 0], wallAtX10); assert.deepEqual(at, [9.4, 0], "no closer than BODY");
  const slid = walkStep([9.4, 0], [0.5, 0.5], wallAtX10); assert.deepEqual(slid, [9.4, 0.5], "slides along");
  assert.ok(10 - walkTo([0, 0], [20, 0], wallAtX10)[0] >= BODY - 1e-9 && walkTo([0, 0], [20, 0], wallAtX10)[0] > 9);
  assert.deepEqual(walkTo([0, 0], [3, 4], () => 99), [3, 4]);
});
