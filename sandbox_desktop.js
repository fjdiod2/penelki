// Панельки, mouse and keyboard. Left button: the active tool. Right-drag orbits, middle-drag (or Shift + right-drag)
// slides, the wheel zooms (OrbitControls). Keys: see the help panel in index.html.
import { THREE, renderer, camera, controls, grid, ui, cursor as mouse, now, setInput, setMods, press, move, release, cancel, showHover,
  updateDraft, undo, redo, pick, alignGrid, demolish, photo, flash, scheduleSave, on } from "./sandbox_core.js";
import { TOOLS, setTool, renderSub } from "./sandbox_ui.js";

controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

// ---------------------------------------------------------------- mouse (fingers go to sandbox_touch.js)
const cvs = renderer.domElement;
const readMods = (e) => setMods(e.shiftKey, e.altKey);
cvs.addEventListener("pointermove", (e) => { if (e.pointerType === "touch") return; setInput("mouse"); mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true; readMods(e); move(); });
cvs.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") mouse.in = false; });
cvs.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") return;
  setInput("mouse"); mouse.x = e.clientX; mouse.y = e.clientY; readMods(e);
  if (e.button !== 0) return;
  cvs.setPointerCapture(e.pointerId); press();
});
cvs.addEventListener("pointerup", (e) => { if (e.pointerType === "touch") return; if (e.button !== 0) return; readMods(e); release(); });

// ---------------------------------------------------------------- keys and camera
const keys = new Set();
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  readMods(e); const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); if (now.busy) return; e.shiftKey ? redo() : undo(); return; }
  if ((e.metaKey || e.ctrlKey) && k === "y") { e.preventDefault(); redo(); return; }
  if (e.metaKey || e.ctrlKey) return;
  if (k === "escape") { cancel(); showHover(); return; }
  const tool = TOOLS.find((x) => x.key === k); if (tool) { setTool(tool.id); return; }
  if (k === "h") { document.body.classList.toggle("clean"); showHover(); return; }
  if (k === "g" && !e.shiftKey) { grid.on = !grid.on; flash(grid.on ? "Grid on" : "Grid off · blocks snap to 15° and whole panels"); renderSub(); showHover(); scheduleSave(); return; }
  if (k === "g" && e.shiftKey) { alignGrid(pick()); return; }
  if (k === "p") { photo(); return; }
  if (k === "[" || k === "]") { const f = k === "]" ? 1.25 : 0.8; if (ui.tool === "ground") ui.groundR = Math.max(1, Math.min(30, ui.groundR * f)); else ui.treeR = Math.max(2, Math.min(60, ui.treeR * f)); renderSub(); showHover(); return; }
  if ((k === "delete" || k === "backspace") && !now.draft) { const at = pick(); if (at && at.block) { demolish(at.block); showHover(); } return; }
  keys.add(k);
});
addEventListener("keyup", (e) => { readMods(e); keys.delete(e.key.toLowerCase()); if (now.draft) updateDraft(); });
addEventListener("blur", () => keys.clear());
on("frame", (dt) => {                              // W A S D slide, Q E turn
  const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize(); const r = new THREE.Vector3().crossVectors(f, camera.up), mv = new THREE.Vector3();
  if (keys.has("w")) mv.add(f); if (keys.has("s")) mv.sub(f); if (keys.has("d")) mv.add(r); if (keys.has("a")) mv.sub(r);
  const dist = camera.position.distanceTo(controls.target);
  if (mv.lengthSq()) { mv.normalize().multiplyScalar(dist * 0.9 * dt); camera.position.add(mv); controls.target.add(mv); }
  const rot = (keys.has("q") ? 1 : 0) - (keys.has("e") ? 1 : 0);
  if (rot) { const o = camera.position.clone().sub(controls.target).applyAxisAngle(camera.up, rot * 1.4 * dt); camera.position.copy(controls.target).add(o); }
});
