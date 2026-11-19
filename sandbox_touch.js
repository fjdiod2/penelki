// Панельки, fingers. One finger is the active tool, as the left mouse button is; it starts once the finger has moved a
// little or rested a moment, so that a second finger arriving at once goes to the camera instead. Two fingers move the
// camera: pinch to zoom, drag to slide, twist to turn. With Orbit on (the round button) one finger turns and tilts it.
// Steps that follow the mouse between clicks (floors, a curve's bend) follow a drag instead, and a tap is the click.
import { THREE, renderer, camera, controls, ui, cursor as mouse, now, setInput, setMods, press, move, release, abortPress, cancel,
  showHover, updateDraft, commitDraft, startHeight, flash, on } from "./sandbox_core.js";

controls.touches = { ONE: -1, TWO: -1 };           // OrbitControls leaves fingers alone: they are handled here
const cvs = renderer.domElement, $ = (s) => document.querySelector(s);
cvs.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") touchDown(e); });
cvs.addEventListener("pointermove", (e) => { if (e.pointerType === "touch") touchMove(e); });
cvs.addEventListener("pointerup", (e) => { if (e.pointerType === "touch") touchUp(e); });
cvs.addEventListener("pointercancel", (e) => { if (e.pointerType === "touch") touchUp(e, true); });

// a finger goes down / comes up: as a mouse press and release, except in the steps that follow the mouse between clicks
function down() {
  const d = now.draft;
  if (d && d.stage === "bend") { d.armed = true; updateDraft(); return; }
  if (d && d.stage === "height") { d.my0 = mouse.y; d.fl0 = d.fl; d.armed = true; return; }
  press();
}
function up(tap) {                                 // there a drag only adjusts, and a tap goes on
  const d = now.draft;
  if (d && d.armed && (d.stage === "height" || d.stage === "bend")) {
    d.armed = false; if (tap) { if (d.stage === "height") commitDraft(); else { startHeight(); updateDraft(); } } showHover(); return;
  }
  release();
}

const fingers = new Map(); let tg = null, camG = null;
function startTool() { if (!tg || tg.started) return; tg.started = true; clearTimeout(tg.timer); const x = mouse.x, y = mouse.y; mouse.x = tg.x0; mouse.y = tg.y0; mouse.in = true; down(); if (x !== tg.x0 || y !== tg.y0) { mouse.x = x; mouse.y = y; move(); } }
function touchDown(e) {
  setInput("touch"); document.body.classList.add("touch"); fingers.set(e.pointerId, [e.clientX, e.clientY]); try { cvs.setPointerCapture(e.pointerId); } catch (_) {}
  if (fingers.size === 1 && !ui.orbit) { mouse.x = e.clientX; mouse.y = e.clientY; setMods(e.shiftKey, e.altKey); tg = { id: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, moved: false, timer: setTimeout(startTool, 120) }; return; }
  if (tg) { clearTimeout(tg.timer); if (tg.started) abortPress(); tg = null; }
  camG = [...fingers.values()].map((q) => [...q]);
}
function touchMove(e) {
  if (!fingers.has(e.pointerId)) return; fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size >= 2) { const two = [...fingers.values()].slice(0, 2); if (camG && camG.length >= 2) cameraTwo(camG, two); camG = two.map((q) => [...q]); return; }
  if (ui.orbit) { if (camG) cameraOrbit(camG[0], [e.clientX, e.clientY]); camG = [[e.clientX, e.clientY]]; return; }
  if (!tg || e.pointerId !== tg.id) return;
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (Math.hypot(mouse.x - tg.x0, mouse.y - tg.y0) > 8) tg.moved = true;
  if (!tg.started) { if (tg.moved) startTool(); return; }
  move();
}
function touchUp(e, cancelled = false) {
  fingers.delete(e.pointerId);
  if (tg && e.pointerId === tg.id) {
    const g = tg; tg = null; clearTimeout(g.timer);
    if (cancelled) { if (g.started) abortPress(); }
    else { if (!g.started) { tg = g; startTool(); tg = null; } mouse.x = e.clientX; mouse.y = e.clientY; up(!g.moved); }
    if (!now.draft) mouse.in = false;
    showHover();
  }
  camG = fingers.size ? [...fingers.values()].map((q) => [...q]) : null;
}

// ---------------------------------------------------------------- the camera
const UPV = new THREE.Vector3(0, 1, 0), camPlane = new THREE.Plane(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function screenToTarget(x, y) {                    // the point under (x, y) at the height the camera looks at
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
  camPlane.set(UPV, -controls.target.y); return ray.ray.intersectPlane(camPlane, new THREE.Vector3());
}
function cameraTwo(a, b) {
  const mid = (q) => [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], len = (q) => Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]), ang = (q) => Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]);
  const off = camera.position.clone().sub(controls.target);
  off.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * (len(a) / Math.max(1, len(b))))));      // pinch
  let da = ang(b) - ang(a); da = Math.atan2(Math.sin(da), Math.cos(da)); off.applyAxisAngle(UPV, da);                                 // twist
  camera.position.copy(controls.target).add(off);
  const p0 = screenToTarget(...mid(a)), p1 = screenToTarget(...mid(b));                                                               // slide
  if (p0 && p1) { const d = p0.sub(p1); d.y = 0; camera.position.add(d); controls.target.add(d); }
  controls.update();
}
function cameraOrbit(a, b) {
  const off = camera.position.clone().sub(controls.target), sp = new THREE.Spherical().setFromVector3(off);
  sp.theta -= (b[0] - a[0]) * 0.008; sp.phi = Math.min(controls.maxPolarAngle, Math.max(0.05, sp.phi - (b[1] - a[1]) * 0.006));
  camera.position.copy(controls.target).add(off.setFromSpherical(sp)); controls.update();
}

// ---------------------------------------------------------------- the round buttons on the right
function updateTouchbar() {
  const d = now.draft, busy = !!(d && d.stage !== "base"), any = !!(d || now.sel);
  $("#t-done").style.display = busy ? "" : "none"; $("#t-cancel").style.display = any ? "" : "none"; $("#t-orbit").classList.toggle("on", !!ui.orbit);
}
on("tip", updateTouchbar);
$("#t-done").onclick = () => { const d = now.draft; if (!d) return; if (d.stage === "height") commitDraft(); else if (d.stage === "bend" || d.stage === "place") { d.drag = null; startHeight(); updateDraft(); } showHover(); };
$("#t-cancel").onclick = () => { cancel(); showHover(); };
$("#t-orbit").onclick = () => { ui.orbit = !ui.orbit; updateTouchbar(); flash(ui.orbit ? "One finger turns the camera" : "One finger builds again"); };
