// The block rules (sandbox_blocks.js): which panels a block is made of, holes dug into it, blocks merging.
// Run: npm test   (Node, no browser, nothing drawn)
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockKit } from "./env.js";
import { V, offsetPoly, nearestOnPath, subPath, pathLen, cutRects } from "../sandbox_blocks.js";

const kit = await blockKit();
const { W, H, PL, E4 } = kit;
const count = (lay, pred) => lay.out.filter(typeof pred === "string" ? (p) => p.pc === pred : pred).length;
const STOREY = (p) => !p.roof && !/plinth|parapet|pipe/.test(p.pc);
const block = (o = {}) => ({ id: 1, pts: [[0, 0], [10 * W, 0]], closed: false, D: 12, fl: 5, fin: "concrete", seed: 7, parent: null, ...o });
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test("module sizes come from pieces.json", () => {
  assert.ok(near(W, 3.2) && near(H, 2.8) && near(PL, 0.8) && near(E4, 3.0), JSON.stringify({ W, H, PL, E4 }));
});

test("a 10-panel, 5-floor block: panels on both long walls and the ends, plinth, parapet", () => {
  const lay = kit.layout(block(), 0);
  assert.equal(count(lay, (p) => STOREY(p) && !/^end/.test(p.pc)), 2 * 10 * 5);           // long walls
  assert.equal(count(lay, (p) => /^end/.test(p.pc)), 2 * 4 * 5);                            // 12 m ends: four 3 m panels
  assert.equal(count(lay, "plinth"), 20); assert.equal(count(lay, "plinth_end"), 8);
  assert.equal(count(lay, "parapet"), 20); assert.equal(count(lay, "parapet_end"), 8);
  assert.ok(near(lay.top, PL + 5 * H));
  assert.ok(count(lay, "entrance") >= 1, "a ground block has an entrance");
});

test("the same seed gives the same block; another seed may differ", () => {
  const sig = (lay) => lay.out.map((p) => p.pc + p.win).join();
  assert.equal(sig(kit.layout(block(), 0)), sig(kit.layout(block(), 0)));
});

test("a block on a roof has no plinth and starts at its base", () => {
  const lay = kit.layout(block({ parent: 9 }), 20);
  assert.equal(count(lay, (p) => /plinth/.test(p.pc)), 0);
  assert.ok(near(lay.top, 20 + 5 * H));
  assert.equal(count(lay, "entrance"), 0);
});

test("a wide block (18 m and more) gets window panels on its ends", () => {
  const lay = kit.layout(block({ D: 19.2 }), 0);
  assert.equal(count(lay, (p) => /^end/.test(p.pc)), 0);
  assert.equal(count(lay, (p) => STOREY(p)), 2 * 10 * 5 + 2 * 6 * 5);
});

test("a ring has no end walls", () => {
  const pts = []; for (let i = 0; i < 48; i++) { const t = (i / 48) * Math.PI * 2; pts.push([30 * Math.cos(t), 30 * Math.sin(t)]); }
  const lay = kit.layout({ ...block(), pts, closed: true }, 0);
  assert.equal(count(lay, (p) => /^end/.test(p.pc)), 0);
  assert.ok(count(lay, STOREY) > 0);
});

// ---- holes
test("cutRects: cuts from either long wall and from an end, clamped to the block", () => {
  const L = 10 * W, b = block({ cuts: [{ side: 1, s0: 3.2, s1: 9.6, f0: 1, f1: 3, d: 3 }, { side: -1, s0: 0, s1: 6.4, f0: 0, f1: 9, d: 40 }, { end: 1, w0: -1.5, w1: 1.5, f0: 2, f1: 3, d: 6.4 }] });
  const [a, c, e] = cutRects(b);
  assert.deepEqual([a.w0, a.w1, a.f0, a.f1], [3, 6, 1, 3]);
  assert.deepEqual([c.w0, c.w1, c.f1], [-6, 6, 5]);                                          // no deeper than the block, no higher
  assert.ok(near(e.s0, L - 6.4) && near(e.s1, L));
  assert.deepEqual(cutRects(block({ closed: true })), []);
});

// pieces whose face sits inside the box (s along, w across, floors f0..f1), in the block's frame
const piecesIn = (lay, b, { s0, s1, w0, w1, f0, f1 }) => lay.out.filter((p) => {
  if (!p.q || p.roof) return false; const u = V.norm(V.sub(b.pts[1], b.pts[0])), d = V.sub(p.q, b.pts[0]), s = V.dot(d, u), w = V.dot(d, V.left(u)), f = Math.floor((p.y - PL) / H);
  return s > s0 + 0.01 && s < s1 - 0.01 && w > w0 + 0.01 && w < w1 - 0.01 && f >= f0 && f < f1;
});

test("digging right through takes the panels off both walls and lines the hole", () => {
  const plain = kit.layout(block(), 0), b = block({ cuts: [{ side: 1, s0: 3 * W, s1: 6 * W, f0: 1, f1: 3, d: 12 }] }), lay = kit.layout(b, 0);
  assert.equal(count(lay, (p) => STOREY(p) && !/^end/.test(p.pc)), 2 * 10 * 5 - 2 * 3 * 2);    // 3 panels x 2 floors, front and back
  assert.equal(count(lay, "end") - count(plain, "end") + count(lay, "end_narrow") - count(plain, "end_narrow"), 2 * 4 * 2);   // the hole's side walls: 12 m deep, 2 floors
  assert.ok(lay.quads.some((q) => !q.roof) && lay.hullQuads.length > 0);
  assert.equal(lay.roofCells.length > 0, true);
});

test("a hole dug into the top floor is open to the sky (its floor is roof)", () => {
  const lay = kit.layout(block({ cuts: [{ side: 1, s0: 0, s1: 3 * W, f0: 4, f1: 5, d: 6 }] }), 0);
  assert.ok(lay.quads.some((q) => q.roof));
});

test("two digs from opposite walls that meet make one clean tunnel (no walls left inside)", () => {
  const b = block({ cuts: [{ side: 1, s0: 3 * W, s1: 6 * W, f0: 0, f1: 2, d: 7 }, { side: -1, s0: 4 * W, s1: 7 * W, f0: 1, f1: 3, d: 7 }] });
  const lay = kit.layout(b, 0);
  // where both digs overlap (s 4W..6W, floor 1) the block is hollow right through: no pieces there at all
  assert.deepEqual(piecesIn(lay, b, { s0: 4 * W, s1: 6 * W, w0: -5.9, w1: 5.9, f0: 1, f1: 2 }), []);
});

// ---- merging
test("blocks crossing on one grid: buried pieces are dropped", () => {
  const A = block({ id: 1 }), B = block({ id: 2, pts: [[5 * W, -20], [5 * W, 20]] }), la = kit.layout(A, 0), lb = kit.layout(B, 0);
  const [ma, mb] = kit.mergeLays([{ id: 1, b: A, lay: la }, { id: 2, b: B, lay: lb }]);
  assert.ok(ma.out.length < la.out.length && mb.out.length < lb.out.length);
  const insideB = (p) => Math.abs(p.q[0] - 5 * W) < 5.9 && Math.abs(p.q[1]) < 19.9 && !p.roof && p.y > 0.5 && p.y < lb.top - 1;
  assert.equal(ma.out.filter((p) => p.q && insideB(p) && Math.abs(Math.abs(p.q[1]) - 6) < 0.01 && Math.abs(p.q[0] - 5 * W) < 5.5).length, 0, "A's walls inside B are gone");
});

test("an angled block is never merged", () => {
  const A = block({ id: 1 }), B = block({ id: 2, pts: [[0, -20], [30, 20]] }), la = kit.layout(A, 0), lb = kit.layout(B, 0);
  const [ma, mb] = kit.mergeLays([{ id: 1, b: A, lay: la }, { id: 2, b: B, lay: lb }]);
  assert.equal(ma.out.length, la.out.length); assert.equal(mb.out.length, lb.out.length);
});

test("two blocks end to end: the shared end walls disappear", () => {
  const A = block({ id: 1 }), B = block({ id: 2, pts: [[10 * W, 0], [20 * W, 0]] }), la = kit.layout(A, 0), lb = kit.layout(B, 0);
  const [ma, mb] = kit.mergeLays([{ id: 1, b: A, lay: la }, { id: 2, b: B, lay: lb }]);
  const atJoint = (lay) => lay.out.filter((p) => /^end/.test(p.pc) && Math.abs(p.q[0] - 10 * W) < 0.01).length;
  assert.equal(atJoint(la), 4 * 5); assert.equal(atJoint(ma) + atJoint(mb), 0);
});

// ---- plan geometry
test("offsetPoly, nearestOnPath, subPath", () => {
  const p = [[0, 0], [10, 0]];
  const lf = V.left([1, 0]), o = offsetPoly(p, false, 2);                                   // + goes to V.left
  assert.ok(near(o[0][0], 2 * lf[0]) && near(o[0][1], 2 * lf[1]) && near(o[1][0], 10 + 2 * lf[0]));
  const n = nearestOnPath(p, false, [4, 3]); assert.ok(near(n.d, 3) && near(n.q[0], 4));
  assert.ok(near(pathLen(subPath(p, 2, 7), false), 5));
});

test("a shallow dig at a corner lines its narrow sides with plain wall, not squeezed window panels", () => {
  const width = (p) => Math.hypot(p.m.elements[0], p.m.elements[2]) * ({ window: 3.2, end: 3, end_narrow: 3 }[p.pc] || 3.2);
  for (const cut of [{ end: 0, w0: 3, w1: 6, f0: 0, f1: 5, d: 1.6 }, { side: 1, s0: 0, s1: W, f0: 1, f1: 4, d: 1.6 }, { side: -1, s0: 9 * W, s1: 10 * W, f0: 0, f1: 3, d: 0.8 }]) {
    const lay = kit.layout(block({ cuts: [cut] }), 0);
    const narrow = lay.out.filter((p) => p.pc === "window" && width(p) < 0.75 * W);
    assert.deepEqual(narrow.map((p) => +width(p).toFixed(2)), [], JSON.stringify(cut));
  }
});

test("a dig whose edge cuts through a panel of the next wall keeps that panel's solid part (no see-through gap)", () => {
  // the part of wall `w` (+6 or -6 across) at floor f covered by pieces, along the block
  const covered = (lay, b, wAt, f) => lay.out.filter((p) => p.pa && !p.roof && Math.abs(Math.abs(V.dot(V.sub(p.q, b.pts[0]), V.left([1, 0]))) - 6) < 0.01 && Math.sign(V.dot(V.sub(p.q, b.pts[0]), V.left([1, 0]))) === Math.sign(wAt) && Math.abs(p.y - (PL + f * H)) < 0.01 && STOREY(p))
    .map((p) => [Math.min(p.pa[0], p.pb[0]), Math.max(p.pa[0], p.pb[0])]).sort((a, c) => a[0] - c[0]);
  const b = block({ cuts: [{ end: 0, w0: 3, w1: 6, f0: 0, f1: 5, d: 1.6 }] }), lay = kit.layout(b, 0);
  const runs = covered(lay, b, 6, 2);                                     // the long wall beside the dug corner, floor 2
  assert.ok(runs.length && near(runs[0][0], 1.6, 0.01), `starts where the hole ends: ${JSON.stringify(runs.slice(0, 2))}`);
  for (let i = 1; i < runs.length; i++) assert.ok(near(runs[i][0], runs[i - 1][1], 0.01), "no gaps along it");
  // and across: a corner dug 1.6 m into a long wall leaves the rest of the 3 m end-wall panel
  const b2 = block({ cuts: [{ side: 1, s0: 0, s1: W, f0: 0, f1: 5, d: 1.6 }] }), l2 = kit.layout(b2, 0);
  const ends = l2.out.filter((p) => p.pa && Math.abs(p.q[0]) < 0.01 && Math.abs(p.y - (PL + 2 * H)) < 0.01 && STOREY(p)).map((p) => [Math.min(p.pa[1], p.pb[1]), Math.max(p.pa[1], p.pb[1])]).sort((a, c) => a[0] - c[0]);
  const span = ends.reduce((s, r) => s + r[1] - r[0], 0); assert.ok(near(span, 12 - 1.6, 0.01), `end wall covered but for the dig: ${span}`);
});
