// Панельки, fingers. The camera works as in map apps: one finger slides the view, two fingers pinch to zoom, twist
// to turn, and move up or down together to tilt. Building is done by tapping and by handles:
//   Block    tap the ground for a block, tap a block to select it; its arrows push and pull its walls, the arrow above
//            it sets the floors, the blue tabs on its roof step back (drag inward); tap its roof to build on top
//   Extrude  tap a panel, tap another on that wall to choose the rectangle between; drag the arrow to build out or dig
//   Paint, Demolish  tap a block
//   Curve, Ring, Trees, Land  one finger draws or paints (as the mouse does); two fingers move the view
// A one-finger drag that does not start on a handle slides the view, so the town can't be changed by accident.
import { THREE, renderer, camera, controls, ui, grid, kit, cursor as mouse, now, setInput, setMods, press, move, release, abortPress, cancel,
  showHover, updateDraft, commitDraft, startHeight, flash, on, pick, scene, overlayRoot, town, rebuild, snapshot, pushUndo, applyState, tip,
  snapPoint, screenOf, onPlane, randFin, selOverlay, OV, cellAt, setSel, beginPush, beginPull, layOf, edit, ghost } from "./sandbox_core.js";
import { renderSub } from "./sandbox_ui.js";
import { sameWall } from "./sandbox_town.js";
import { classifyTwo, blockHandles, cull, hitHandle } from "./sandbox_handles.js";
import { V } from "./sandbox_blocks.js";

controls.touches = { ONE: -1, TWO: -1 };           // OrbitControls leaves fingers alone: they are handled here
const cvs = renderer.domElement, $ = (s) => document.querySelector(s);
const { W, H } = kit;
const DRAWS = new Set(["curve", "ring", "trees", "ground"]);   // tools where one finger draws or paints
const HANDLE_PX = 46, HIT_PX = 34;

cvs.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") touchDown(e); });
cvs.addEventListener("pointermove", (e) => { if (e.pointerType === "touch") touchMove(e); });
cvs.addEventListener("pointerup", (e) => { if (e.pointerType === "touch") touchUp(e); });
cvs.addEventListener("pointercancel", (e) => { if (e.pointerType === "touch") touchUp(e, true); });

let selId = null;                                  // the block selected in the Block tool
const selBlock = () => (selId == null ? null : now.S.blocks.find((b) => b.id === selId) || null);
function select(id) { selId = id; updateTouchbar(); }

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
  const pts = [...fingers.values()].slice(0, 2).map((q) => [...q]); two = { a: pts, prev: pts, mode: null };
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
  if (g.kind === "handle" && g.moved) { if (!g.drag) startHandle(g.h); dragHandle(); }
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
  } else if (g.kind === "handle" && g.drag) { cancelled ? abortHandle() : endHandle(); mouse.in = false; showHover(); }
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
  if (t === "line") tapBuild(pick());
  else if (t === "carve") tapCarve(pick());
  else if (t === "paint" || t === "erase") { mouse.in = true; press(); release(); mouse.in = false; showHover(); }
}
let told = false;
function tapBuild(at) {
  if (!at) return;
  const sb = selBlock();
  if (at.block && at.block !== sb) { select(at.block.id); return; }
  if (at.block && at.roof && at.floor == null) {                       // the selected block's roof: a block on top of it
    const r = town.roofBlock(at.block, at.p, { fl: 3, fin: ui.fin === "random" ? at.block.fin : ui.fin, seed: seed() });
    if (r) { edit((S) => { S.blocks.push(r); S.nextId++; }); select(r.id); }
    return;
  }
  if (at.block) return;
  if (sb) { select(null); return; }                                    // tapping away lets go first
  const ang = grid.on ? grid.ang : 0, u = [Math.cos(ang), Math.sin(ang)], n = 8, D = 12;
  let c = V.sub(V.sub(at.p, V.mul(u, (n * W) / 2)), V.mul(V.left(u), D / 2));   // centred on the tap
  if (!ui.free) c = snapPoint(c, 0).p;
  const b = town.newBlock(c, ang, { n, D, fl: now.lastFloors, fin: ui.fin === "random" ? randFin() : ui.fin, seed: seed() });
  edit((S) => { S.blocks.push(b); S.nextId++; }); select(b.id);
  if (!told) { told = true; flash("Drag its arrows to shape it · blue tabs on the roof step back"); }
}
const seed = () => (Math.random() * 2 ** 31) | 0;
function tapCarve(at) {
  const c = cellAt(at), s = now.sel;
  if (!c) { setSel(null); return; }
  if (s && s.b === c.b && sameWall(s.wall, c.wall)) {
    if (s.k0 === s.k1 && s.f0 === s.f1 && s.k0 === c.k && s.f0 === c.f) { setSel(null); return; }   // the one chosen panel again: none
    setSel({ ...s, k1: c.k, f1: c.f });                                 // the rectangle from the first panel to this one
  } else setSel({ b: c.b, wall: c.wall, k0: c.k, k1: c.k, f0: c.f, f1: c.f });
  const n = now.sel, k = Math.abs(n.k1 - n.k0) + 1, f = Math.abs(n.f1 - n.f0) + 1;
  tip(`${k} × ${f} panel${k * f > 1 ? "s" : ""}<small>${k * f === 1 ? "tap another for a rectangle · " : ""}drag the arrow ${ui.carve === "out" ? "out to build" : "in to dig"}</small>`);
}

// ---------------------------------------------------------------- handles
// shown for the selected block (Block tool) or the chosen panels (Extrude); drawn as round badges that stay the same
// size on screen, found by distance on screen
function handles() {
  if (document.body.classList.contains("clean") || stepping()) return [];
  if (ui.tool === "line") { const b = selBlock(), lay = b && layOf(b.id); return lay ? blockHandles(b, lay) : []; }
  if (ui.tool === "carve" && now.sel && now.S.blocks.includes(now.sel.b)) {
    const { F, t0, t1, f0, f1 } = town.selBox(now.sel), p = V.add(V.add(F.o, V.mul(F.ax, (t0 + t1) / 2)), V.mul(F.N, 1.5)), dir = ui.carve === "out" ? F.N : V.mul(F.N, -1);
    return [{ kind: "pull", at: [p[0], F.y0 + ((f0 + f1) / 2) * H, p[1]], dir }];
  }
  return [];
}
let shown = { list: [], pts: [], keep: [] };
function layoutHandles() {
  const list = handles(), pts = list.map((h) => { const v = new THREE.Vector3(...h.at).project(camera); return v.z > 1 ? null : [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
  shown = { list, pts, keep: cull(pts, HANDLE_PX * 0.9, innerWidth, innerHeight) };
}
function handleAt(q) { layoutHandles(); const i = hitHandle(shown.pts, shown.keep, q, HIT_PX); return i < 0 ? null : shown.list[i]; }

// drags. push and pull go through the core (its snapping and guides); floors and steps are done here
let hd = null;
function startHandle(h) {
  const b = h.kind === "pull" ? now.sel.b : selBlock(); mouse.in = true; mouse.x = g.x0; mouse.y = g.y0;
  if (h.kind === "push") { const p = onPlane(h.at[1]); if (!p) return; beginPush(b, h.wall, p, h.at[1]); g.drag = true; hd = { h }; return; }
  if (h.kind === "pull") { beginPull(now.sel); g.drag = true; hd = { h }; return; }
  const before = snapshot();
  if (h.kind === "floors") {
    const s0 = screenOf(h.at[0], h.at[1], h.at[2]), s1 = screenOf(h.at[0], h.at[1] + H, h.at[2]);
    hd = { h, b, before, fl0: b.fl, y0: g.y0, ppf: Math.min(40, Math.max(14, Math.abs(s0[1] - s1[1]))) };
  } else if (h.kind === "step") { const grab = onPlane(h.at[1]); if (!grab) return; hd = { h, b, before, grab, inset: 0 }; }
  g.drag = true;
}
function dragHandle() {
  if (!hd) return; const { h } = hd;
  if (h.kind === "push" || h.kind === "pull") { move(); return; }
  if (h.kind === "floors") {
    const fl = Math.max(1, Math.min(200, hd.fl0 + Math.round((hd.y0 - mouse.y) / hd.ppf)));
    if (fl !== hd.b.fl) { hd.b.fl = fl; rebuild(); }
    tip(`${fl} floor${fl > 1 ? "s" : ""}<small>drag up or down</small>`); return;
  }
  const cur = onPlane(h.at[1]); if (!cur) return;                      // a step back: follow the finger inward
  const b = hd.b, raw = V.dot(V.sub(cur, hd.grab), h.n), inset = ui.free ? Math.round(raw * 10) / 10 : town.stepSnap(b, raw, h.mode);
  hd.inset = inset;
  if (inset < 0.5) { ghost(null); tip("<small>drag inward to step back</small>"); return; }
  const t = town.terracePts(b, inset, h.mode, h.k); hd.t = t;
  ghost({ id: -1, pts: t.pts, closed: b.closed, D: t.D, fl: 3, fin: b.fin, seed: 1, parent: b.id });
  tip(`step in ${+t.inset.toFixed(1)} m<small>${h.mode === "side" || h.mode === "corner" ? `${+t.D.toFixed(1)} m wide · ` : ""}release to build it</small>`);
}
function endHandle() {
  const x = hd; hd = null; if (!x) return;
  if (x.h.kind === "push" || x.h.kind === "pull") { release(); return; }
  if (x.h.kind === "floors") { if (x.b.fl !== x.fl0) pushUndo(x.before); tip(""); return; }
  ghost(null); tip("");
  if (x.inset >= 0.5 && x.t) {                     // the step back is built as a block on the roof, three floors, and selected
    const b = x.b, nb = { id: now.S.nextId, pts: x.t.pts, closed: b.closed, D: x.t.D, fl: 3, fin: ui.fin === "random" ? b.fin : ui.fin, seed: seed(), parent: b.id };
    edit((S) => { S.blocks.push(nb); S.nextId++; }); select(nb.id);
  }
}
function abortHandle() {
  const x = hd; hd = null; if (!x) return;
  if (x.h.kind === "push" || x.h.kind === "pull") { abortPress(); return; }
  ghost(null); tip(""); if (x.h.kind === "floors" && x.b.fl !== x.fl0) applyState(x.before);
}

// the badges: one sprite each, its own material (each turns its arrow its own way)
const hud = new THREE.Group(); hud.renderOrder = 1001; overlayRoot.add(hud);
function badge(kind) {
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
  const fill = { push: "#ffffff", pull: "#ffd75e", floors: "#ffd75e", step: "#7ad8ff" }[kind];
  x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.fillStyle = fill; x.globalAlpha = 0.92; x.fill(); x.globalAlpha = 1;
  x.lineWidth = 6; x.strokeStyle = "rgba(20,22,26,.75)"; x.stroke(); x.fillStyle = "#1c1f24";
  if (kind === "floors") { x.beginPath(); x.moveTo(64, 18); x.lineTo(92, 54); x.lineTo(36, 54); x.fill(); x.beginPath(); x.moveTo(64, 110); x.lineTo(92, 74); x.lineTo(36, 74); x.fill(); }
  else if (kind === "step") { x.lineWidth = 13; x.lineCap = "round"; x.lineJoin = "round"; x.beginPath(); x.moveTo(52, 34); x.lineTo(82, 64); x.lineTo(52, 94); x.strokeStyle = "#1c1f24"; x.stroke(); }
  else { x.beginPath(); x.moveTo(104, 64); x.lineTo(66, 30); x.lineTo(66, 50); x.lineTo(26, 50); x.lineTo(26, 78); x.lineTo(66, 78); x.lineTo(66, 98); x.closePath(); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = {}, pool = [];
function sprite(i, kind) {
  while (pool.length <= i) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false })); s.renderOrder = 1001; hud.add(s); pool.push(s); }
  const s = pool[i]; s.material.map = TEX[kind] ||= badge(kind); s.material.needsUpdate = true; s.visible = true; return s;
}
let selMesh = null, selKey = "";
function drawHud() {
  layoutHandles();
  const k = Math.tan((camera.fov * Math.PI) / 360) * 2 / innerHeight;
  pool.forEach((s) => (s.visible = false));
  shown.keep.forEach((i, n) => {
    const h = shown.list[i], s = sprite(n, h.kind), active = hd && hd.h === h;
    s.position.set(...h.at); s.scale.setScalar(HANDLE_PX * (active ? 1.2 : 1) * k);
    if (h.dir) { const a = screenOf(...h.at), b = screenOf(h.at[0] + h.dir[0] * 3, h.at[1], h.at[2] + h.dir[1] * 3); s.material.rotation = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); }
    else s.material.rotation = 0;
  });
  // the selected block, or the chosen panels, tinted
  const b = ui.tool === "line" ? selBlock() : null, sl = ui.tool === "carve" && !(now.action && now.action.kind === "pull") ? now.sel : null;
  const key = document.body.classList.contains("clean") ? "" : b ? `b${b.id}:${JSON.stringify(layOf(b.id) && [b.pts, b.D, b.fl, b.cuts])}` : sl ? `s${JSON.stringify([sl.b.id, sl.wall, sl.k0, sl.k1, sl.f0, sl.f1])}` : "";
  if (key !== selKey) {
    selKey = key; if (selMesh) { hud.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
    if (b && key) { const lay = layOf(b.id); if (lay) selMesh = kit.overlay(lay, OV.edge, 0.65); }
    else if (sl && key) selMesh = selOverlay(sl, OV.edge);
    if (selMesh) hud.add(selMesh);
  }
}
on("frame", () => {
  if (now.input !== "touch") return;
  if (selId != null && (!selBlock() || ui.tool !== "line")) select(null);
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
function cameraTwo(a, b) {                         // slide, pinch and twist at once
  const mid = (q) => [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], len = (q) => Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]), ang = (q) => Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]);
  const off = camera.position.clone().sub(controls.target);
  off.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * (len(a) / Math.max(1, len(b))))));
  let da = ang(b) - ang(a); da = Math.atan2(Math.sin(da), Math.cos(da)); off.applyAxisAngle(UPV, da);
  camera.position.copy(controls.target).add(off);
  const p0 = screenToTarget(...mid(a)), p1 = screenToTarget(...mid(b));
  if (p0 && p1) { const d = p0.sub(p1); d.y = 0; camera.position.add(d); controls.target.add(d); }
  controls.update();
}

// ---------------------------------------------------------------- the round buttons on the right
function updateTouchbar() {
  const d = now.draft, busy = !!(d && d.stage !== "base"), b = ui.tool === "line" && selBlock(), sl = ui.tool === "carve" && now.sel;
  $("#t-done").style.display = busy || b ? "" : "none";
  $("#t-del").style.display = b && !busy ? "" : "none";
  $("#t-cancel").style.display = (d || sl) && !b ? "" : "none";
}
on("tip", updateTouchbar);
$("#t-done").onclick = () => {
  const d = now.draft;
  if (d) { if (d.stage === "height") commitDraft(); else if (d.stage === "bend" || d.stage === "place") { d.drag = null; startHeight(); updateDraft(); } showHover(); }
  else select(null);
  updateTouchbar();
};
$("#t-del").onclick = () => { const b = selBlock(); if (!b) return; edit(() => town.demolish(b.id)); select(null); };
$("#t-cancel").onclick = () => { cancel(); setSel(null); showHover(); updateTouchbar(); };

// ---------------------------------------------------------------- rows that scroll sideways: fade the edge that has more
function fades(el) {
  const f = () => { el.classList.toggle("more-l", el.scrollLeft > 2); el.classList.toggle("more-r", el.scrollLeft + el.clientWidth < el.scrollWidth - 2); };
  el.addEventListener("scroll", f, { passive: true }); addEventListener("resize", f); new MutationObserver(f).observe(el, { childList: true }); f();
}
fades($("#bar")); fades($("#sub"));
$("#bar").addEventListener("click", (e) => { const t = e.target.closest(".tool"); if (t) t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); });

// for the tests: the handles on screen now
window.__touch = { handles: () => { layoutHandles(); return shown.keep.map((i) => ({ kind: shown.list[i].kind, mode: shown.list[i].mode || shown.list[i].wall?.mode, s: shown.list[i].wall?.s, end: shown.list[i].wall?.end, k: shown.list[i].k, at: shown.pts[i] })); }, selected: () => selId };
