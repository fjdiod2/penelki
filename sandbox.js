// Панельки: a building toy. Lay Soviet panel blocks by dragging lines, curves and rings, pull them up floor by floor,
// stack new blocks on any roof (or drag a roof edge inward to step back, Babel style), extrude and dig them, paint
// finishes, plant trees, lay paths and water. Saved in the browser; undo/redo for everything.
//   sandbox_core.js     the town and everything that changes it; no input handling
//   sandbox_ui.js       the tool bar, options row and buttons (both inputs)
//   sandbox_desktop.js  mouse and keyboard
//   sandbox_touch.js    fingers
import { start } from "./sandbox_core.js";
import { setTool } from "./sandbox_ui.js";
import "./sandbox_desktop.js";
import "./sandbox_touch.js";

await start();
setTool("line");
window.__ready = true;
