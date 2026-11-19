// Панельки, fingers. The camera works as in map apps: one finger slides the view, two fingers pinch to zoom, twist
// to turn, and move up or down together to tilt. Building is done by tapping and by handles:
//   Block    tap the ground: a new block, being placed: drag its middle to move it, its arrows to push its walls, the
//            arrow above it for floors; Done (or tap away) builds it, Cancel takes it back. Tap a built block to select
//            it: its walls and floors again, and blue tabs on its roof: drag one inward to step back (the new tier is
//            then being placed: move it, size it, Done). Tap a selected block's roof to build a block on top.
//   Extrude  tap a panel: a choice of panels: drag its edges to stretch it, its middle to move it; Next; then drag the
//            arrow out to build or in to dig
//   Paint, Demolish  tap a block
//   Curve, Ring, Trees, Land  one finger draws or paints (as the mouse does); two fingers move the view
// A one-finger drag that does not start on a handle slides the view, so the town can't be changed by accident.
import { THREE, renderer, camera, controls, ui, grid, kit, cursor as mouse, now, setInput, setMods, press, move, release, abortPress, cancel,
  showHover, updateDraft, commitDraft, startHeight, flash, on, pick, overlayRoot, town, rebuild, snapshot, pushUndo, applyState, tip,
  snapPoint, tolAt, screenOf, onPlane, randFin, selOverlay, OV, cellAt, cellOnWall, setSel, beginPush, beginPull, layOf, edit, ghost,
  undoMark, squashUndo, dropUndo, showGuides, addRoad, roadStart, roadEnd, holdStreets, HOME } from "./sandbox_core.js";
import { renderSub } from "./sandbox_ui.js";
import { sameWall, arc, ring } from "./sandbox_town.js";
import { classifyTwo, twoStep, blockHandles, outline, selHandles, arrange, hitHandle, roadHandles } from "./sandbox_handles.js";
import { roadAt } from "./sandbox_streets.js";
import { V } from "./sandbox_blocks.js";

controls.touches = { ONE: -1, TWO: -1 };           // OrbitControls leaves fingers alone: they are handled here
const cvs = renderer.domElement, $ = (s) => document.querySelector(s);
const { W, H } = kit;
const DRAWS = new Set(["trees", "ground"]);        // tools where one finger paints
const BUILDS = new Set(["line", "curve", "ring"]); // tools that place blocks by tapping
const HANDLE_PX = 46, HIT_PX = 32, GAP_PX = 50;

cvs.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") touchDown(e); });
cvs.addEventListener("pointermove", (e) => { if (e.pointerType === "touch") touchMove(e); });
cvs.addEventListener("pointerup", (e) => { if (e.pointerType === "touch") touchUp(e); });
cvs.addEventListener("pointercancel", (e) => { if (e.pointerType === "touch") touchUp(e, true); });

// ---------------------------------------------------------------- what is being worked on
// blk: the block in hand in the Block tool: { id, phase: "place" (new: move it, size it; Done or Cancel) or "select"
// (built: size it, step back from it), before / mark: the town and the undo stack before it was placed }
// cv: the Extrude tool's stage: "choose" (the choice of panels: stretch it, move it) or "pull" (the arrow)
let blk = null, cv = null, rc = null, rs = null;   // rc: a road being laid, tap by tap: { a: where the next piece starts }; rs: the id of the road selected
const selRoad = () => (rs == null ? null : now.S.roads.find((r) => r.id === rs) || null);
const blkBlock = () => (blk ? now.S.blocks.find((b) => b.id === blk.id) || null : null);
function placeNew(b) {                             // put a new block in the town, being placed
  const before = snapshot(), mark = undoMark(); edit((S) => { S.blocks.push(b); S.nextId++; });
  blk = { id: b.id, phase: "place", before, mark }; status();
}
function finishPlace() { if (blk && blk.phase === "place") { squashUndo(blk.mark); blk.phase = "select"; } }   // placed: one undo step
function letGo() { finishPlace(); blk = null; status(); }
function cancelPlace() { if (!blk || blk.phase !== "place") return; applyState(blk.before); dropUndo(blk.mark); blk = null; status(); }
function status() {                                // the tip and the buttons for what is in hand
  updateTouchbar();
  if (hd) return;
  if (blk && blk.phase === "place") tip("place it<small>drag the middle to move it · the arrows for its walls and floors · Done</small>");
  else if (blk) tip("<small>arrows: walls and floors · blue tabs on the roof: drag inward to step back · tap the roof to build on it</small>");
  else if (rc) tip("tap where the road goes<small>each tap lays the next piece · Done to finish</small>");
  else if (selRoad()) tip("<small>drag an end to move it · tap an end to carry on from it · Delete removes the road</small>");
  else if (cv && now.sel) { const s = now.sel, k = Math.abs(s.k1 - s.k0) + 1, f = Math.abs(s.f1 - s.f0) + 1;
    tip(cv === "choose" ? `${k} × ${f} panel${k * f > 1 ? "s" : ""}<small>drag the edges to stretch it, the middle to move it · Next</small>` : `${k} × ${f} panel${k * f > 1 ? "s" : ""}<small>drag the arrow ${ui.carve === "out" ? "out to build" : "in to dig"}</small>`); }
  else tip("");
  if (now.input === "touch") placeTip();
}
function placeTip() { const el = $("#tip"); if (el.style.display === "none") return; el.style.left = Math.max(8, (innerWidth - el.offsetWidth) / 2) + "px"; el.style.top = "64px"; }

// ---------------------------------------------------------------- fingers
// g: the one-finger gesture: "wait" (not yet a tap or a drag), "pan", "tool" (the tool, as a mouse press), "handle"
const fingers = new Map(); let g = null, two = null;
if (matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches) { setInput("touch"); document.body.classList.add("touch"); }   // a phone or tablet: touch from the start
function touchDown(e) {
  if (now.input !== "touch") { setInput("touch"); document.body.classList.add("touch"); renderSub(); }
  fingers.set(e.pointerId, [e.clientX, e.clientY]); try { cvs.setPointerCapture(e.pointerId); } catch (_) {}
  if (fingers.size === 1) {
    mouse.x = e.clientX; mouse.y = e.clientY; setMods(e.shiftKey, e.altKey);
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, last: [e.clientX, e.clientY], kind: "wait", moved: false };
    const h = handleAt([e.clientX, e.clientY]);
    if (h) { g.kind = "handle"; g.h = h; return; }
    if (stepping() || DRAWS.has(ui.tool) || (ui.tool === "floors" && overBlock())) { g.kind = "tool"; g.started = false; g.timer = setTimeout(startTool, 120); }
    return;
  }
  if (g) { endOne(true); g = null; }               // a second finger: the camera, and whatever the first one began is undone
  const pts = [...fingers.values()].slice(0, 2).map((q) => [...q]); two = { a: pts, prev: pts, mode: null, st: {} };
}
function touchMove(e) {
  if (!fingers.has(e.pointerId)) return; fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size >= 2) { if (two) twoMove([...fingers.values()].slice(0, 2).map((q) => [...q])); return; }
  if (!g || e.pointerId !== g.id) return;
  const q = [e.clientX, e.clientY]; if (Math.hypot(q[0] - g.x0, q[1] - g.y0) > 8) g.moved = true;
  if (g.kind === "wait" && g.moved) g.kind = "pan";
  if (g.kind === "pan") { pan(g.last, q); g.last = q; return; }
  mouse.x = q[0]; mouse.y = q[1]; g.last = q;
  if (g.kind === "tool") { if (!g.started) { if (g.moved) startTool(); return; } move(); return; }
  if (g.kind === "handle" && (g.moved || hd)) { if (!hd) startHandle(g.h); dragHandle(); }
}
function touchUp(e, cancelled = false) {
  fingers.delete(e.pointerId);
  if (g && e.pointerId === g.id) { mouse.x = e.clientX; mouse.y = e.clientY; endOne(cancelled); g = null; }
  if (fingers.size < 2) two = null;
}
function endOne(cancelled) {                       // the one-finger gesture ends: lifted, or a second finger came
  clearTimeout(g.timer);
  if (g.kind === "tool") {
    if (cancelled) { if (g.started) abortPress(); }
    else { if (!g.started) startTool(); up(!g.moved); }
    mouse.in = false; showHover();
  } else if (g.kind === "handle") {
    if (hd) { cancelled ? abortHandle() : endHandle(); mouse.in = false; showHover(); status(); }
    else if (!cancelled && g.h.kind === "roadEnd") { const r = g.h.road; rc = { a: [...r.pts[g.h.k ? r.pts.length - 1 : 0]] }; rs = null; status(); }   // tap a road's end: carry on from it
  }   // (a tap on any other handle does nothing)
  else if (!cancelled && !g.moved) tap(g.x0, g.y0);
  updateTouchbar();
}
function startTool() { if (!g || g.started) return; g.started = true; clearTimeout(g.timer); const x = mouse.x, y = mouse.y; mouse.x = g.x0; mouse.y = g.y0; mouse.in = true; down(); if (x !== g.x0 || y !== g.y0) { mouse.x = x; mouse.y = y; move(); } }
// as a mouse press and release, except in the steps that follow the mouse between clicks (floors, a curve's bend)
function down() {
  const d = now.draft;
  if (d && d.stage === "bend") { d.armed = true; updateDraft(); return; }
  if (d && d.stage === "height") { d.my0 = mouse.y; d.fl0 = d.fl; d.armed = true; return; }
  press();
}
function up(tap) {                                 // there a drag only adjusts, and a tap goes on
  const d = now.draft;
  if (d && d.armed && (d.stage === "height" || d.stage === "bend")) { d.armed = false; if (tap) { if (d.stage === "height") commitDraft(); else { startHeight(); updateDraft(); } } showHover(); return; }
  release();
}
const stepping = () => !!(now.draft && now.draft.stage !== "base");      // a curve or ring between its steps
function overBlock() { const at = pick(); return !!(at && at.block); }

// ---------------------------------------------------------------- taps
function tap(x, y) {
  mouse.x = x; mouse.y = y; const t = ui.tool;
  if (BUILDS.has(t)) tapBuild(pick(), t);
  else if (t === "carve") tapCarve(pick());
  else if (t === "road") {
    const p = onPlane(0); if (!p) return;
    if (rc) { const e = roadEnd(rc.a, p), r = addRoad(rc.a, e.p); if (r) rc.a = e.p; }
    else { const i = roadAt(p, now.S.roads); if (i >= 0) rs = now.S.roads[i].id; else if (rs != null) rs = null; else rc = { a: roadStart(p) }; }   // a road: select it; else (let go, or) start one
    status();
  }
  else if (t === "paint" || t === "erase" || t === "yard") { mouse.in = true; press(); release(); mouse.in = false; showHover(); }
}
let told = false;
const seed = () => (Math.random() * 2 ** 31) | 0;
function tapBuild(at, kind = "line") {
  if (!at) return;
  const cur = blkBlock(), fin = (b) => (ui.fin === "random" ? (b ? b.fin : randFin()) : ui.fin);
  if (at.block && cur && at.block.id === cur.id && at.roof && at.floor != null) {     // the floor of a hole in the block in hand: a block there
    const r = town.holeAt(at.block, at.floor != null ? at.p : at.p, at.floor), b = at.block; if (!r) return;
    const u = V.norm(V.sub(b.pts[1], b.pts[0])), lf = V.left(u), wm = (r.w0 + r.w1) / 2, P = (s1) => V.add(V.add(b.pts[0], V.mul(u, s1)), V.mul(lf, wm));
    finishPlace(); placeNew({ id: now.S.nextId, pts: [P(r.s0), P(r.s1)], closed: false, D: r.w1 - r.w0, fl: Math.max(1, r.f1 - at.floor), fin: fin(b), seed: seed(), parent: null, at: { id: b.id, f: at.floor } });
    return;
  }
  if (at.block && cur && at.block.id === cur.id && at.roof && at.floor == null) {     // the roof of the block in hand: a block on top
    finishPlace();
    const r = town.roofBlock(at.block, at.p, { fl: 3, fin: ui.fin === "random" ? at.block.fin : ui.fin, seed: seed() });
    if (r) placeNew(r);
    return;
  }
  if (at.block) { if (!cur || at.block.id !== cur.id) { finishPlace(); blk = { id: at.block.id, phase: "select" }; status(); } return; }
  if (blk) { letGo(); return; }                    // tapping away lets go first
  const ang = grid.on ? grid.ang : 0, u = [Math.cos(ang), Math.sin(ang)], n = 8, D = 12;
  if (kind === "ring") {                          // a ring round the tap, 30 m across the middle of its walls
    const c = ui.free ? at.p : snapPoint(at.p, 0).p;
    placeNew({ id: now.S.nextId, pts: ring(c, 30), closed: true, D, fl: now.lastFloors, fin: fin(), seed: seed(), parent: null });
  } else if (kind === "curve") {                  // a curved block along the grid through the tap, bowed 7 m
    const p = ui.free ? at.p : snapPoint(at.p, 0).p, a = V.sub(p, V.mul(u, (n * W) / 2)), c = V.add(p, V.mul(u, (n * W) / 2));
    placeNew({ id: now.S.nextId, pts: arc(a, c, V.add(p, V.mul(V.left(u), 7))), closed: false, D, fl: now.lastFloors, fin: fin(), seed: seed(), parent: null });
  } else {
    let c = V.sub(V.sub(at.p, V.mul(u, (n * W) / 2)), V.mul(V.left(u), D / 2));   // centred on the tap
    if (!ui.free) c = snapPoint(c, 0).p;
    placeNew(town.newBlock(c, ang, { n, D, fl: now.lastFloors, fin: fin(), seed: seed() }));
  }
  if (!told) { told = true; flash("Move it, size it, then Done"); }
}
function tapCarve(at) {
  const c = cellAt(at);
  if (cv === "pull" && !c) return;                 // (the arrow stage: a stray tap does not lose the choice)
  if (!c) { setSel(null); cv = null; status(); return; }
  setSel({ b: c.b, wall: c.wall, k0: c.k, k1: c.k, f0: c.f, f1: c.f }); cv = "choose"; status();
}

// ---------------------------------------------------------------- handles
// shown for the block in hand (Block tool) or the choice of panels (Extrude); drawn as round badges that stay the same
// size on screen, laid out on screen (sandbox_handles.js arrange) and found by distance on screen
function handles() {
  if (document.body.classList.contains("clean") || stepping()) return { list: [], hull: [] };
  if (ui.tool === "road" && rc) return { list: [{ kind: "pin", place: "at", at: [rc.a[0], 0.3, rc.a[1]] }], hull: [] };
  if (ui.tool === "road" && selRoad()) return { list: roadHandles(selRoad()), hull: [] };
  if (BUILDS.has(ui.tool)) { const b = blkBlock(), lay = b && layOf(b.id); return lay ? { list: blockHandles(b, lay, blk.phase), hull: outline(lay) } : { list: [], hull: [] }; }
  const s = now.sel;
  if (ui.tool === "carve" && cv && s && now.S.blocks.includes(s.b)) {
    const { F, t0, t1, f0, f1 } = town.selBox(s), P = (t, f) => { const q = V.add(F.o, V.mul(F.ax, t)); return [q[0], F.y0 + f * H, q[1]]; };
    return { list: selHandles(F, { t0, t1, f0, f1 }, H, cv, ui.carve === "out"), hull: [P(t0, f0), P(t1, f0), P(t1, f1), P(t0, f1)] };
  }
  return { list: [], hull: [] };
}
const project = (q) => { const v = new THREE.Vector3(...q).project(camera); return v.z > 1 ? null : [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
let shown = { list: [], pts: [] };
function freeArea() {                             // the screen not covered by the bars (with the buttons) and the tip
  const r = (s) => { const e = $(s), q = e && e.getBoundingClientRect(); return q && q.width > 0 && q.height > 0 ? q : null; }, top = r("#topright"), tp = r("#tip"), dock = r("#dock");
  return { x0: 0, y0: Math.max(top ? top.bottom : 0, tp && tp.top < innerHeight / 3 ? tp.bottom : 0), w: innerWidth, h: dock ? dock.top : innerHeight };
}
function layoutHandles() { camera.updateMatrixWorld(); const { list, hull } = handles(); shown = { list, pts: arrange(list, project, hull, { gap: GAP_PX, ...freeArea() }) }; }
function handleAt(q) { layoutHandles(); const i = hitHandle(shown.pts, q, HIT_PX); return i < 0 ? null : shown.list[i]; }

// drags. push and pull go through the core (its snapping and guides); the rest are done here
let hd = null;
function startHandle(h) {
  mouse.in = true; mouse.x = g.x0; mouse.y = g.y0;
  if (h.kind === "roadEnd") {                     // a road's end, with the ends of the roads that meet it there
    const r = h.road, j = h.k ? r.pts.length - 1 : 0, at = r.pts[j], ends = [];
    for (const o of now.S.roads) for (const i of [0, o.pts.length - 1]) if (V.dist(o.pts[i], at) < 0.05) ends.push([o, i]);
    hd = { h, before: snapshot(), ends, other: r.pts[j ? 0 : r.pts.length - 1] }; return;
  }
  if (h.kind === "pull") { beginPull(now.sel); hd = { h }; return; }
  if (h.kind === "edge" || (h.kind === "move" && ui.tool === "carve")) { const s = now.sel, c = cellOnWall(s.b, s.wall); if (!c) return; hd = { h, s0: { ...s }, c0: c }; return; }
  const b = blkBlock(); if (!b) return;
  if (h.kind === "push") { const p = onPlane(h.at[1]); if (!p) return; beginPush(b, h.wall, p, h.at[1]); hd = { h }; return; }
  const before = snapshot();
  if (h.kind === "floors") {
    const s0 = screenOf(h.at[0], h.at[1], h.at[2]), s1 = screenOf(h.at[0], h.at[1] + H, h.at[2]);
    hd = { h, b, before, fl0: b.fl, y0: g.y0, ppf: Math.min(40, Math.max(14, Math.abs(s0[1] - s1[1]))) };
  } else if (h.kind === "move") { const grab = onPlane(h.at[1]); if (!grab) return; hd = { h, b, before, grab, b0: JSON.parse(JSON.stringify(b)), applied: [0, 0] }; holdStreets(true); }
  else if (h.kind === "step") { const grab = onPlane(h.at[1]); if (!grab) return; hd = { h, b, before, grab, inset: 0 }; }
  else if (h.kind === "radius") { const grab = onPlane(h.at[1]); if (!grab) return; hd = { h, b, before, grab, r0: V.dist(b.pts[0], h.c) }; holdStreets(true); }
  else if (h.kind === "curveEnd" || h.kind === "bend") { const n = b.pts.length; hd = { h, b, before, y: layOf(b.id).base, a: b.pts[0], c: b.pts[n - 1], m: b.pts[Math.floor(n / 2)] }; holdStreets(true); }
}
const clampi = (v, a, b) => Math.max(a, Math.min(b, v));
function dragHandle() {
  if (!hd) return; const { h } = hd;
  if (h.kind === "push" || h.kind === "pull") { move(); placeTip(); return; }
  if (h.kind === "edge" || (h.kind === "move" && ui.tool === "carve")) {          // the choice of panels: an edge, or all of it
    const s = hd.s0, c = cellOnWall(s.b, s.wall); if (!c) return; const F = town.wallFrame(s.b, s.wall);
    let k0 = Math.min(s.k0, s.k1), k1 = Math.max(s.k0, s.k1), f0 = Math.min(s.f0, s.f1), f1 = Math.max(s.f0, s.f1);
    if (h.edge === "k1") k1 = Math.max(k0, c.k); else if (h.edge === "k0") k0 = Math.min(k1, c.k); else if (h.edge === "f1") f1 = Math.max(f0, c.f); else if (h.edge === "f0") f0 = Math.min(f1, c.f);
    else { const dk = clampi(c.k - hd.c0.k, -k0, F.n - 1 - k1), df = clampi(c.f - hd.c0.f, -f0, F.fl - 1 - f1); k0 += dk; k1 += dk; f0 += df; f1 += df; }
    setSel({ ...s, k0, k1, f0, f1 }); status(); return;
  }
  if (h.kind === "roadEnd") {
    const cur = onPlane(0); if (!cur) return; const e = roadEnd(hd.other, cur, hd.ends.map((x) => x[0]));
    if (V.dist(e.p, hd.other) > 2) { for (const [o, i] of hd.ends) o.pts[i] = e.p; rebuild(); }
    tip(`${Math.round(V.dist(hd.other, e.p))} m road<small>${e.why || "release to leave the end here"}</small>`); placeTip(); return;
  }
  if (h.kind === "radius" || h.kind === "curveEnd" || h.kind === "bend") { shapeDrag(); return; }
  if (h.kind === "floors") {
    const fl = Math.max(1, Math.min(200, hd.fl0 + Math.round((hd.y0 - mouse.y) / hd.ppf)));
    if (fl !== hd.b.fl) { hd.b.fl = fl; rebuild(); }
    tip(`${fl} floor${fl > 1 ? "s" : ""}<small>drag up or down</small>`); placeTip(); return;
  }
  const cur = onPlane(h.at[1]); if (!cur) return;
  if (h.kind === "move") { moveBlock(V.sub(cur, hd.grab)); return; }
  const b = hd.b, raw = V.dot(V.sub(cur, hd.grab), h.n), inset = ui.free ? Math.round(raw * 10) / 10 : town.stepSnap(b, raw, h.mode);   // a step back: follow the finger inward
  hd.inset = inset;
  if (inset < 0.5) { ghost(null); hd.t = null; tip("<small>drag inward to step back</small>"); placeTip(); return; }
  const t = town.terracePts(b, inset, h.mode, h.k); hd.t = t;
  ghost({ id: -1, pts: t.pts, closed: b.closed, D: t.D, fl: 3, fin: b.fin, seed: 1, parent: b.id });
  tip(`step in ${+t.inset.toFixed(1)} m<small>${h.mode === "side" || h.mode === "corner" ? `${+t.D.toFixed(1)} m wide · ` : ""}release, then place it</small>`); placeTip();
}
// a ring's radius, a curve's ends and its bend (the arc through its ends and its middle, worked out again)
function shapeDrag() {
  const { h, b } = hd, D = b.D || 12;
  if (h.kind === "radius") {
    const cur = onPlane(h.at[1]); if (!cur) return; let r = hd.r0 + V.dot(V.sub(cur, hd.grab), h.n);
    r = Math.max(10, D / 2 + 4, ui.free ? r : Math.round(r / 1.6) * 1.6); b.pts = ring(h.c, r); rebuild();
    tip(`ring ⌀ ${Math.round(2 * r)} m<small>drag in or out</small>`); placeTip(); return;
  }
  let cur = onPlane(hd.y); if (!cur) return; if (!ui.free) cur = snapPoint(cur, hd.y, b.id).p;
  let { a, c, m } = hd;
  if (h.kind === "bend") m = cur;
  else {                                          // an end: the bend keeps its share of the chord
    const L = V.dist(a, c), u = V.norm(V.sub(c, a)), sag = V.dot(V.sub(m, V.lerp(a, c, 0.5)), V.left(u));
    if (h.k) c = cur; else a = cur; const L2 = V.dist(a, c); if (L2 < 2 * W) return;
    m = V.add(V.lerp(a, c, 0.5), V.mul(V.left(V.norm(V.sub(c, a))), (sag * L2) / L));
  }
  b.pts = arc(a, c, m); rebuild();
  const len = b.pts.slice(1).reduce((s1, p, i) => s1 + V.dist(b.pts[i], p), 0);
  tip(`${Math.round(len)} m${b.pts.length === 2 ? " · straight" : ""}<small>${h.kind === "bend" ? "drag to bend it" : "drag to move this end"}</small>`); placeTip();
}
// moving the block in hand by raw (m): on a roof it snaps flush or centred on it; on the ground it lines up with the
// blocks around (and the grid), as a new block's corner does
function moveBlock(raw) {
  const b0 = hd.b0, P = b0.parent && now.S.blocks.find((x) => x.id === b0.parent), straight = (x) => x && !x.closed && x.pts.length === 2;
  let delta = raw, why = "", guides = [];
  if (!ui.free) {
    if (straight(P) && straight(b0)) { const r = town.tierMove(b0, P, raw, tolAt(V.add(b0.pts[0], raw), hd.h.at[1])); delta = r.delta; why = r.why; }
    else {
      const D = b0.D || 12, u = V.norm(V.sub(b0.pts[1], b0.pts[0])), ref = b0.closed ? V.mul(b0.pts.reduce((a, q) => V.add(a, q), [0, 0]), 1 / b0.pts.length) : V.sub(b0.pts[0], V.mul(V.left(u), D / 2));
      const sp = snapPoint(V.add(ref, raw), hd.h.at[1], b0.id); delta = V.sub(sp.p, ref); guides = sp.guides; why = [...new Set(guides.map((x) => x.why).filter(Boolean))].join(" · ");
    }
  }
  const step = V.sub(delta, hd.applied); if (V.len(step) > 1e-6) { town.translate(b0.id, step); hd.applied = delta; rebuild(); }
  showGuides(guides, hd.h.at[1]);
  tip(`move${why ? " · " + why : ""}<small>Done when it is right</small>`); placeTip();
}
function endHandle() {
  const x = hd; hd = null; if (!x) return;
  if (x.h.kind === "push" || x.h.kind === "pull") { release(); if (x.h.kind === "pull" && !now.sel) cv = null; return; }
  if (x.h.kind === "edge" || x.h.kind === "move" && ui.tool === "carve") return;
  if (x.h.kind === "floors") { if (x.b.fl !== x.fl0) pushUndo(x.before); return; }
  if (x.h.kind === "move") { showGuides([]); holdStreets(false); if (V.len(x.applied) > 1e-6) pushUndo(x.before); return; }
  if (x.h.kind === "roadEnd") { if (snapshot() !== x.before) pushUndo(x.before); return; }
  if (x.h.kind === "radius" || x.h.kind === "curveEnd" || x.h.kind === "bend") { holdStreets(false); if (snapshot() !== x.before) pushUndo(x.before); return; }
  ghost(null);
  if (x.inset >= 0.5 && x.t) {                     // the step back: a block on the roof, three floors, now being placed
    const b = x.b; finishPlace();
    placeNew({ id: now.S.nextId, pts: x.t.pts, closed: b.closed, D: x.t.D, fl: 3, fin: ui.fin === "random" ? b.fin : ui.fin, seed: seed(), parent: b.id });
  }
}
function abortHandle() {
  const x = hd; hd = null; if (!x) return;
  if (x.h.kind === "push" || x.h.kind === "pull") { abortPress(); return; }
  if (x.h.kind === "edge" || x.h.kind === "move" && ui.tool === "carve") { setSel(x.s0); return; }
  if (x.h.kind === "roadEnd") { applyState(x.before); return; }
  if (x.h.kind === "radius" || x.h.kind === "curveEnd" || x.h.kind === "bend") { holdStreets(false); applyState(x.before); return; }
  ghost(null); showGuides([]); if (x.h.kind === "move") holdStreets(false);
  if ((x.h.kind === "floors" && x.b.fl !== x.fl0) || (x.h.kind === "move" && V.len(x.applied) > 1e-6)) applyState(x.before);
}

// the badges: one sprite each, its own material (each turns its arrow its own way)
const hud = new THREE.Group(); overlayRoot.add(hud);
function badge(kind) {
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
  const fill = { pin: "#ffd75e", roadEnd: "#ffd75e", radius: "#ffffff", curveEnd: "#ffffff", bend: "#7ad8ff", push: "#ffffff", edge: "#ffffff", move: "#ffffff", pull: "#ffd75e", floors: "#ffd75e", step: "#7ad8ff" }[kind];
  x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.fillStyle = fill; x.globalAlpha = 0.92; x.fill(); x.globalAlpha = 1;
  x.lineWidth = 6; x.strokeStyle = "rgba(20,22,26,.75)"; x.stroke(); x.fillStyle = "#1c1f24";
  const tri = (ax, ay, bx, by, cx, cy) => { x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.lineTo(cx, cy); x.fill(); };
  if (kind === "pin" || kind === "roadEnd") { x.beginPath(); x.arc(64, 64, 14, 0, Math.PI * 2); x.fill(); }
  else if (kind === "floors") { tri(64, 18, 92, 54, 36, 54); tri(64, 110, 92, 74, 36, 74); }
  else if (kind === "move") { tri(64, 14, 84, 38, 44, 38); tri(64, 114, 84, 90, 44, 90); tri(14, 64, 38, 44, 38, 84); tri(114, 64, 90, 44, 90, 84); x.fillRect(56, 36, 16, 56); x.fillRect(36, 56, 56, 16); }
  else if (kind === "step") { x.lineWidth = 13; x.lineCap = "round"; x.lineJoin = "round"; x.beginPath(); x.moveTo(52, 34); x.lineTo(82, 64); x.lineTo(52, 94); x.strokeStyle = "#1c1f24"; x.stroke(); }
  else { x.beginPath(); x.moveTo(104, 64); x.lineTo(66, 30); x.lineTo(66, 50); x.lineTo(26, 50); x.lineTo(26, 78); x.lineTo(66, 78); x.lineTo(66, 98); x.closePath(); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = {}, pool = [];
function sprite(i, kind) {
  while (pool.length <= i) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false })); s.renderOrder = 1001; hud.add(s); pool.push(s); }
  const s = pool[i]; if (s.material.map !== (TEX[kind] ||= badge(kind))) { s.material.map = TEX[kind]; s.material.needsUpdate = true; } s.visible = true; return s;
}
let selMesh = null, selKey = "";
const tmp = new THREE.Vector3();
function drawHud() {
  layoutHandles();
  const k = Math.tan((camera.fov * Math.PI) / 360) * 2 / innerHeight; let n = 0;
  pool.forEach((s) => (s.visible = false));
  shown.list.forEach((h, i) => {
    const q = shown.pts[i]; if (!q) return;
    const s = sprite(n++, h.kind), active = hd && hd.h === h, z = tmp.set(...h.at).project(camera).z;
    s.position.set((q[0] / innerWidth) * 2 - 1, -(q[1] / innerHeight) * 2 + 1, z).unproject(camera);          // the spot on screen, at the anchor's depth
    s.scale.setScalar(HANDLE_PX * (active ? 1.2 : 1) * k);                                              // (sizeAttenuation off: a fixed size on screen)
    if (h.dir) { const a = project(h.at), b = project(h.at.map((v, j) => v + h.dir[j] * 3)); s.material.rotation = a && b ? Math.atan2(-(b[1] - a[1]), b[0] - a[0]) : 0; }
    else s.material.rotation = 0;
  });
  // the block in hand, or the choice of panels, tinted (yellow while it is being placed)
  const b = BUILDS.has(ui.tool) ? blkBlock() : null, sl = ui.tool === "carve" && cv && !(now.action && now.action.kind === "pull") ? now.sel : null;
  const key = document.body.classList.contains("clean") ? "" : b ? `b${b.id}:${blk.phase}:${JSON.stringify([b.pts, b.D, b.fl, b.cuts])}` : sl ? `s${JSON.stringify([sl.b.id, sl.wall, sl.k0, sl.k1, sl.f0, sl.f1])}` : "";
  if (key !== selKey) {
    selKey = key; if (selMesh) { hud.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
    if (b && key) { const lay = layOf(b.id); if (lay) selMesh = kit.overlay(lay, blk.phase === "place" ? OV.build : OV.edge, 0.65); }
    else if (sl && key) selMesh = selOverlay(sl, OV.edge);
    if (selMesh) hud.add(selMesh);
  }
}
on("frame", () => {
  if (now.input !== "touch") return;
  if (blk && (!blkBlock() || !BUILDS.has(ui.tool))) { if (!BUILDS.has(ui.tool)) finishPlace(); blk = null; status(); }
  if (rs != null && (ui.tool !== "road" || !selRoad())) { rs = null; status(); }
  if (cv && (ui.tool !== "carve" || !now.sel)) { cv = null; status(); }
  if (rc && ui.tool !== "road") { rc = null; status(); }
  drawHud();
});

// ---------------------------------------------------------------- the camera
const UPV = new THREE.Vector3(0, 1, 0), camPlane = new THREE.Plane(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function screenToTarget(x, y) {                    // the point under (x, y) at the height the camera looks at
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
  camPlane.set(UPV, -controls.target.y); return ray.ray.intersectPlane(camPlane, new THREE.Vector3());
}
function pan(a, b) {                               // the ground under the finger stays under it
  const p0 = screenToTarget(...a), p1 = screenToTarget(...b); if (!p0 || !p1) return;
  const d = p0.sub(p1); d.y = 0; const lim = camera.position.distanceTo(controls.target) * 0.25; if (d.length() > lim) d.setLength(lim);   // near the horizon a pixel is a long way
  camera.position.add(d); controls.target.add(d); controls.update();
}
function twoMove(cur) {
  if (!two.mode) { two.mode = classifyTwo(two.a, cur); if (!two.mode) return; }
  if (two.mode === "tilt") {
    const dy = (cur[0][1] - two.prev[0][1] + cur[1][1] - two.prev[1][1]) / 2;
    const off = camera.position.clone().sub(controls.target), sp = new THREE.Spherical().setFromVector3(off);
    sp.phi = Math.min(controls.maxPolarAngle, Math.max(0.05, sp.phi - dy * 0.006));    // fingers up: toward the horizon
    camera.position.copy(controls.target).add(off.setFromSpherical(sp)); controls.update();
  } else cameraTwo(two.prev, cur);
  two.prev = cur;
}
// slide, and once clearly started (twoStep) pinch and twist, all about the ground between the fingers: it stays under them
function cameraTwo(a, b) {
  const mid = (q) => [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2];
  const { rot, zoom } = twoStep(two.st, two.a, a, b);
  const P = screenToTarget(...mid(a)); if (!P) return;
  const dist = camera.position.distanceTo(controls.target);
  const k = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist * zoom)) / dist;
  for (const v of [camera.position, controls.target]) { v.sub(P).multiplyScalar(k).applyAxisAngle(UPV, rot).add(P); }   // zoom and turn about P
  controls.update();
  const p1 = screenToTarget(...mid(b));            // then slide, so P is under the fingers' middle again
  if (p1) { const d = P.clone().sub(p1); d.y = 0; const lim = camera.position.distanceTo(controls.target) * 0.25; if (d.length() > lim) d.setLength(lim); camera.position.add(d); controls.target.add(d); }
  controls.update();
}


// the home button: back to where the camera starts, as it starts, in half a second (eased); any touch stops it
let homing = null;
$("#t-home").onclick = () => {
  homing = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: new THREE.Vector3(...HOME.pos), q1: new THREE.Vector3(...HOME.target) };
};
on("frame", () => {
  const dock = $("#dock").getBoundingClientRect(); $("#t-home").style.bottom = `${Math.round(innerHeight - dock.top + 12)}px`;   // just above the dock
  if (!homing) return; if (fingers.size) { homing = null; return; }
  const k = Math.min(1, (performance.now() - homing.t0) / 500), e = k * k * (3 - 2 * k);
  camera.position.lerpVectors(homing.p0, homing.p1, e); controls.target.lerpVectors(homing.q0, homing.q1, e); controls.update();
  if (k >= 1) homing = null;
});

// ---------------------------------------------------------------- the round buttons on the right
// a curve or ring between steps: Done, Cancel · a block being placed: Done, Cancel · selected: Done, Delete
// a choice of panels: Next, Cancel · the arrow: Cancel
function updateTouchbar() {
  const d = now.draft, busy = !!(d && d.stage !== "base"), b = BUILDS.has(ui.tool) && blkBlock(), road = ui.tool === "road" && selRoad();
  const done = busy || b || cv === "choose" || rc || road, del = !busy && ((b && blk.phase === "select") || road), can = (d && !b) || (b && blk.phase === "place") || cv;
  $("#t-done").style.display = done ? "" : "none"; $("#t-done").textContent = cv === "choose" && !busy ? "Next" : "Done";
  $("#t-del").style.display = del ? "" : "none";
  $("#t-cancel").style.display = can ? "" : "none";
}
on("tip", () => { updateTouchbar(); if (now.input === "touch" && (blk || cv) && !now.draft) placeTip(); });
$("#t-done").onclick = () => {
  const d = now.draft;
  if (d) { if (d.stage === "height") commitDraft(); else if (d.stage === "bend" || d.stage === "place") { d.drag = null; startHeight(); updateDraft(); } showHover(); }
  else if (cv === "choose") cv = "pull";
  else if (rc) rc = null;
  else if (rs != null) rs = null;
  else if (blk && blk.phase === "place") finishPlace();
  else letGo();
  status();
};
$("#t-del").onclick = () => {
  const r = ui.tool === "road" && selRoad(); if (r) { edit((S) => { S.roads = S.roads.filter((x) => x !== r); }); rs = null; status(); return; }
  const b = blkBlock(); if (!b) return; edit(() => town.demolish(b.id)); blk = null; status();
};
$("#t-cancel").onclick = () => {
  if (blk && blk.phase === "place") cancelPlace();
  else if (cv) { setSel(null); cv = null; }
  else { cancel(); showHover(); }
  status();
};
$("#sub").addEventListener("click", () => setTimeout(status));      // (Build out / Dig switched: the tip says so)

// ---------------------------------------------------------------- rows that scroll sideways: fade the edge that has more
function fades(el) {
  const f = () => { el.classList.toggle("more-l", el.scrollLeft > 2); el.classList.toggle("more-r", el.scrollLeft + el.clientWidth < el.scrollWidth - 2); };
  el.addEventListener("scroll", f, { passive: true }); addEventListener("resize", f); new MutationObserver(f).observe(el, { childList: true }); f();
}
fades($("#bar")); fades($("#sub"));
$("#bar").addEventListener("click", (e) => { const t = e.target.closest(".tool"); if (t) t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); });

// for the tests: the handles on screen now, and what is in hand
window.__touch = {
  handles: () => { layoutHandles(); return shown.list.map((h, i) => ({ kind: h.kind, mode: h.mode || h.wall?.mode, s: h.wall?.s, end: h.wall?.end, k: h.k, edge: h.edge, at: shown.pts[i] })).filter((h) => h.at); },
  held: () => blk && { ...blk, before: undefined }, stage: () => cv, sel: () => now.sel && [now.sel.k0, now.sel.k1, now.sel.f0, now.sel.f1],
};
