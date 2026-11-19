// Панельки, the street-level photo mode: stand in the town at eye height and look up (or down, from a ledge).
//   Walk (V)    first choose where to stand (as in Street View): a street, a roof, a ledge (a lower tier's roof, the top
//               of an extrusion), the floor of a hole. A marker shows the spot; the camera moves as usual meanwhile.
//   drag        look around (one finger on a phone)          click / tap   walk there (another roof or the ground: go there)
//   W A S D     walk, 4 m/s (Shift: 12)                         wheel / pinch the lens, 14 to 50 mm
//   Esc, Exit   back to where the camera was                 the shutter (or P) saves the picture
// While it is on it takes all input on the canvas and the keyboard, so the tools never see it.
import { THREE, renderer, camera, controls, cursor as mouse, now, ui, pick, onPlane, cancel, showHover, photo, flash, freeCamera,
  overlayRoot, guideRoot, gridMesh, brushRing, blockField, town, scene, on } from "./sandbox_core.js";
import { setTool } from "./sandbox_ui.js";
import { EYE, BODY, lensFov, fovLens, lookDir, yawPitch, clampPitch, walkStep, walkTo } from "./sandbox_walk.js";
import { nearestOnPath, V } from "./sandbox_blocks.js";

const cvs = renderer.domElement, $ = (s) => document.querySelector(s);
let st = null;                                     // { saved, p: [x, z], y0, roof (block stood on), yaw, pitch, mm, glide }
let told = false;

// where a picked point lets you stand: the ground, a roof (or a ledge: any block's roof), the floor of a hole -> or null
function spot(at) {
  if (!at) return null;
  if (!at.block) return { kind: "ground", p: at.p, y: 0 };
  if (!at.roof) return null;                       // (a wall)
  if (at.floor != null) { const r = town.holeAt(at.block, at.p, at.floor); return r ? { kind: "hole", b: at.block, r, p: at.p, y: at.y } : null; }
  return { kind: "roof", b: at.block, p: at.p, y: at.y };
}
// how much room there is at q: on the ground, metres to the nearest wall; on a roof, metres inside its edge (up to the
// parapet); in a hole, metres inside its floor
function roomFn(sp) {
  if (sp.kind === "roof") {
    const b = sp.b, h = (b.D || 12) / 2, n = b.pts.length;
    return (q) => {
      let r = h - nearestOnPath(b.pts, b.closed, q).d;
      if (!b.closed) {                             // square ends: not past the end walls
        const u0 = V.norm(V.sub(b.pts[1], b.pts[0])), u1 = V.norm(V.sub(b.pts[n - 1], b.pts[n - 2]));
        r = Math.min(r, V.dot(V.sub(q, b.pts[0]), u0), V.dot(V.sub(b.pts[n - 1], q), u1));
      }
      return r - 0.3 + BODY;
    };
  }
  if (sp.kind === "hole") { const b = sp.b, r = sp.r, u = V.norm(V.sub(b.pts[1], b.pts[0])); return (q) => { const d = V.sub(q, b.pts[0]), s1 = V.dot(d, u), w1 = V.dot(d, V.left(u)); return Math.min(s1 - r.s0, r.s1 - s1, w1 - r.w0, r.w1 - w1) - 0.2 + BODY; }; }
  const F = blockField(now.S.blocks); return (q) => F.dist(q);
}
function stand(sp) {                               // stand at a spot
  st.where = sp; st.roof = sp.kind === "ground" ? null : sp.b; st.y0 = sp.y; st.room = roomFn(sp);
  const at = sp;
  let p = at.p; if (st.room(p) < BODY) { for (let r = 1; r < 30 && st.room(p) < BODY; r += 1) for (let k = 0; k < 16; k++) { const q = [at.p[0] + r * Math.cos(k * 0.39), at.p[1] + r * Math.sin(k * 0.39)]; if (st.room(q) >= BODY) { p = q; break; } } }
  st.p = p; st.glide = null;
}
// ---- choosing where to stand: the tool is set aside (so a click builds nothing) and a marker follows the pointer
let choosing = null;                               // { tool: the tool to go back to }
const marker = new THREE.Group(); marker.visible = false; scene.add(marker);
{ const m = new THREE.MeshBasicMaterial({ color: 0xffd75e, fog: false }), r = new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.6, side: THREE.DoubleSide, fog: false });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.2, 12), m); body.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), m); head.position.y = 1.5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32), r); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; marker.add(body, head, ring); }
export function chooseSpot() {
  if (st || choosing) return; cancel(); choosing = { tool: ui.tool }; ui.tool = "walk";
  document.body.classList.add("choosing"); $("#hint").textContent = "Click where to stand: a street, a roof, a ledge, the floor of a hole · Esc to cancel";
  mouse.in = false; showHover(); flash("Where do you want to stand?");
}
function stopChoosing() { if (!choosing) return; const t = choosing.tool; choosing = null; marker.visible = false; document.body.classList.remove("choosing"); setTool(t); }
function showMarker(x, y) {                       // (grows with distance, so it can be seen from far up)
  mouse.x = x; mouse.y = y; const sp = spot(pick()); marker.visible = !!sp;
  if (sp) { marker.position.set(sp.p[0], sp.y, sp.p[1]); marker.scale.setScalar(Math.max(1, camera.position.distanceTo(marker.position) / 45)); }
}
export function enterPhoto(sp) {
  if (st || !sp) return; stopChoosing(); cancel();
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  st = { saved: { pos: camera.position.clone(), tgt: controls.target.clone(), fov: camera.fov }, yaw: yawPitch([d.x, d.y, d.z]).yaw, pitch: 0.12, mm: 24, keys: new Set() };
  stand(sp);
  freeCamera(true); document.body.classList.add("clean", "photo"); mouse.in = false; showHover();
  for (const o of [overlayRoot, guideRoot, gridMesh, brushRing]) o.visible = false;
  setLens(st.mm); place();
  if (!told) { told = true; flash(matchMedia("(pointer: coarse)").matches ? "Drag to look · tap to walk there · pinch for the lens" : "Drag to look · click to walk there · W A S D · wheel: lens · Esc to leave"); }
}
export function exitPhoto() {
  if (!st) return; const s = st.saved; st = null;
  camera.position.copy(s.pos); controls.target.copy(s.tgt); camera.fov = s.fov; camera.updateProjectionMatrix();
  freeCamera(false); controls.update(); document.body.classList.remove("clean", "photo"); overlayRoot.visible = guideRoot.visible = true; showHover();
}
function setLens(mm) { st.mm = Math.max(14, Math.min(50, mm)); camera.fov = lensFov(st.mm); camera.updateProjectionMatrix(); $("#ph-lens").value = st.mm; $("#ph-mm").textContent = `${Math.round(st.mm)} mm`; }
function place() {                                 // the camera where you stand, looking where you look
  const y = st.y0 + EYE, d = lookDir(st.yaw, st.pitch);
  camera.position.set(st.p[0], y, st.p[1]); camera.lookAt(st.p[0] + d[0], y + d[1], st.p[1] + d[2]);
}
let lastT = 0;
on("frame", (dt) => {
  if (choosing && !st && ui.tool !== "walk") { choosing = null; marker.visible = false; document.body.classList.remove("choosing"); }   // another tool was picked
  if (!st) { lastT = 0; return; }
  const tn = performance.now(); dt = lastT ? Math.min(0.25, (tn - lastT) / 1000) : dt; lastT = tn;      // real time, so walking keeps its pace at any frame rate
  const f = [Math.cos(st.yaw), Math.sin(st.yaw)], r = [-Math.sin(st.yaw), Math.cos(st.yaw)], k = st.keys;
  let mv = [0, 0]; if (k.has("w")) mv = [mv[0] + f[0], mv[1] + f[1]]; if (k.has("s")) mv = [mv[0] - f[0], mv[1] - f[1]]; if (k.has("d")) mv = [mv[0] + r[0], mv[1] + r[1]]; if (k.has("a")) mv = [mv[0] - r[0], mv[1] - r[1]];
  const L = Math.hypot(mv[0], mv[1]), speed = k.has("shift") ? 12 : 4;
  if (L) { st.glide = null; st.p = walkStep(st.p, [(mv[0] / L) * speed * dt, (mv[1] / L) * speed * dt], st.room); }
  else if (st.glide) {                             // walking to a clicked spot
    const d = [st.glide[0] - st.p[0], st.glide[1] - st.p[1]], D = Math.hypot(d[0], d[1]), s = Math.min(D, Math.max(2, D * 2.5) * dt);
    if (D < 0.05) st.glide = null; else st.p = walkStep(st.p, [(d[0] / D) * s, (d[1] / D) * s], st.room);
  }
  place();
});

// ---------------------------------------------------------------- input: everything on the canvas, while it is on
const fingers = new Map(); let drag = null, pinch = null;
const opt = { capture: true };
let pick0 = null;                                  // (choosing) where a press began
cvs.addEventListener("pointerdown", (e) => { if (choosing && !st) pick0 = e.isPrimary && (e.pointerType === "touch" || e.button === 0) ? [e.clientX, e.clientY] : null; }, opt);
cvs.addEventListener("pointermove", (e) => { if (choosing && !st) { if (e.pointerType !== "touch") showMarker(e.clientX, e.clientY); if (pick0 && Math.hypot(e.clientX - pick0[0], e.clientY - pick0[1]) > 8) pick0 = null; } }, opt);
cvs.addEventListener("pointerup", (e) => { if (choosing && !st && pick0) { pick0 = null; mouse.x = e.clientX; mouse.y = e.clientY; const sp = spot(pick()); if (sp) enterPhoto(sp); } }, opt);
cvs.addEventListener("pointerdown", (e) => {
  if (!st) return; e.stopImmediatePropagation(); try { cvs.setPointerCapture(e.pointerId); } catch (_) {}
  fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size === 2) { const [a, b] = [...fingers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mm: st.mm }; drag = null; return; }
  if (e.button === 0 || e.pointerType === "touch") drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false };
}, opt);
cvs.addEventListener("pointermove", (e) => {
  if (!st) return; e.stopImmediatePropagation(); if (fingers.has(e.pointerId)) fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && fingers.size >= 2) { const [a, b] = [...fingers.values()]; setLens(pinch.mm * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)); return; }
  if (!drag) return;
  const kk = ((camera.fov * Math.PI) / 180) / innerHeight;                          // a pixel's worth of angle
  st.yaw += (e.clientX - drag.x) * kk * -1; st.pitch = clampPitch(st.pitch + (e.clientY - drag.y) * kk);
  drag.x = e.clientX; drag.y = e.clientY; if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) drag.moved = true;
}, opt);
const up = (e) => {
  if (!st) return; e.stopImmediatePropagation(); fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null;
  if (drag && !drag.moved && e.type === "pointerup") {                              // a click: go there
    mouse.x = e.clientX; mouse.y = e.clientY; const sp = spot(pick());
    if (sp) { if (sp.kind !== st.where.kind || sp.b !== st.where.b || (sp.kind === "hole" && sp.r !== st.where.r)) stand(sp); else st.glide = walkTo(st.p, sp.p, st.room); }
  }
  if (!fingers.size) drag = null;
};
cvs.addEventListener("pointerup", up, opt); cvs.addEventListener("pointercancel", up, opt);
cvs.addEventListener("wheel", (e) => { if (!st) return; e.stopImmediatePropagation(); e.preventDefault(); setLens(st.mm * (e.deltaY > 0 ? 1.08 : 1 / 1.08)); }, { capture: true, passive: false });
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" && e.target.id !== "ph-lens") return;
  const k = e.key.toLowerCase();
  if (choosing && !st) { if (k === "escape" || k === "v") { e.stopImmediatePropagation(); stopChoosing(); } return; }
  if (!st) { if (k === "v" && !e.metaKey && !e.ctrlKey && !now.busy) { e.stopImmediatePropagation(); chooseSpot(); } return; }
  e.stopImmediatePropagation(); if (e.metaKey || e.ctrlKey) return; e.preventDefault();
  if (k === "escape" || k === "v") exitPhoto(); else if (k === "p") photo(); else st.keys.add(k);
}, true);
addEventListener("keyup", (e) => { if (!st) return; e.stopImmediatePropagation(); st.keys.delete(e.key.toLowerCase()); }, true);
addEventListener("blur", () => { if (st) st.keys.clear(); });

$("#walk").onclick = () => (choosing ? stopChoosing() : chooseSpot());
$("#ph-exit").onclick = () => exitPhoto();
$("#ph-shot").onclick = () => photo();
$("#ph-lens").addEventListener("input", (e) => st && setLens(+e.target.value));
window.__photo = { choose: chooseSpot, enterAt: (x, y) => { mouse.x = x; mouse.y = y; enterPhoto(spot(pick())); }, exit: exitPhoto, choosing: () => !!choosing, state: () => st && { p: st.p, y0: st.y0, yaw: st.yaw, pitch: st.pitch, mm: st.mm, roof: st.roof && st.roof.id } };
