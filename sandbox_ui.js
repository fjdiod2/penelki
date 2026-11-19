// Панельки, the interface both inputs share: the tool bar, the options row under it, and the buttons at the top.
import { setHaze, atmos, hazeParams } from "./sandbox_core.js";
import { ui, grid, LAND, kit, now, cursor as mouse, cancel, showHover, scheduleSave, undo, redo, photo, flash, clearTown, on } from "./sandbox_core.js";

export const TOOLS = [  { id: "line", key: "1", name: "Block", hint: "Drag a wall, swing out to widen · drag any wall to push or pull it · drag a roof edge inward to step back" },
  { id: "curve", key: "2", name: "Curve", hint: "Drag from end to end, then move to bend it and click" },
  { id: "ring", key: "3", name: "Ring", hint: "Drag from the centre outward" },
  { id: "floors", key: "4", name: "Floors", hint: "Drag a roof up or down for floors · walls push and pull here too" },
  { id: "carve", key: "9", name: "Extrude", hint: "Drag across a wall to choose panels · then drag them out to build, or in to dig (pick which below)" },
  { id: "paint", key: "5", name: "Paint", hint: "Click or sweep over blocks to repaint them" },
  { id: "trees", key: "6", name: "Trees", hint: "Paint trees on the ground or roofs · Shift to remove" },
  { id: "road", key: "r", name: "Road", hint: "Drag to lay a road · roads join where they meet · Shift + drag a road's end to move it · Demolish removes one" },
  { id: "yard", key: "y", name: "Yard", hint: "Click open ground between blocks to make it a yard: a driveway, parking, a playground, a kiosk · click a yard to rearrange it · Demolish removes it" },
  { id: "ground", key: "7", name: "Land", hint: "Paint water, bog, reeds, fields and paths · Grass rubs them out" },
  { id: "erase", key: "8", name: "Demolish", hint: "Click a block to knock it down (and everything standing on it), or a road" },
];
const TOUCH_HINT = {
  line: "Tap the ground for a block · tap a block, then drag its arrows · tap its roof to build on top",
  curve: "Drag from end to end, then drag to bend it and tap", floors: "Drag a roof up or down for floors",
  carve: "Tap a panel · drag the arrows round it to stretch the choice · Next · then drag the arrow", paint: "Tap blocks to repaint them",
  trees: "Paint trees with one finger · two fingers move the view", ground: "Paint with one finger · two fingers move the view",
  erase: "Tap a block or a road to knock it down",
  yard: "Tap open ground between blocks to make a yard · tap a yard to rearrange it",
  road: "Tap where a road starts, then tap for each bend · Done",
};
const isBuild = (t) => t === "line" || t === "curve" || t === "ring";
const $ = (s) => document.querySelector(s);
const ICONS = {
  line: '<path d="M4 15h16v4H4z"/><path d="M4 11h16" opacity=".5"/>',
  curve: '<path d="M3 18c3-9 15-9 18 0" fill="none" stroke="currentColor" stroke-width="3.2"/>',
  ring: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="3.2"/>',
  floors: '<path d="M7 21V8h10v13z" opacity=".55"/><path d="M12 1l3.5 4h-7zM1 14.5l4-3.5v7zM23 14.5l-4-3.5v7z"/>',
  carve: '<path d="M3 4h10v16H3z" opacity=".5"/><path d="M13 8h8v6h-8z"/><path d="M5 9h4v4H5z" fill="#000" opacity=".55"/>',
  paint: '<path d="M4 4h13v5H4z"/><path d="M17 6h3v6h-8v3"  fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 15h3v6h-3z"/>',
  trees: '<path d="M12 2l6 9h-4l5 7H5l5-7H6z"/><path d="M11 18h2v4h-2z"/>',
  road: '<path d="M7 2h3l-1 20H3zM14 2h3l4 20h-6z"/><path d="M11.2 3h1.6v4h-1.6zM11.2 10h1.6v4h-1.6zM11.2 17h1.6v4h-1.6z"/>',
  yard: '<path d="M3 3h18v18H3z" opacity=".35"/><path d="M6 17l3-7 3 7zM14 8h4v4h-4z"/><circle cx="16" cy="16" r="2"/>',
  ground: '<path d="M3 20l5-16h8l5 16z" opacity=".5"/><path d="M11 6h2v3h-2zM11 11h2v3h-2zM11 16h2v3h-2z"/>',
  erase: '<path d="M5 7h14l-1.2 14H6.2z"/><path d="M9 3h6v2H9z"/><path d="M3 5h18v2H3z"/>',
};
const SWATCH = { concrete: "#b9b7b0", tiles_beige: "#e2d4bb", tiles_white: "#eeece6", painted_pink: "#e3a996", painted_blue: "#a9c7dc", painted_yellow: "#e8d293", brick_white: "#d9d4c8", brick_red: "#a6533c" };
const LABEL = { concrete: "Concrete", tiles_beige: "Beige tiles", tiles_white: "White tiles", painted_pink: "Pink", painted_blue: "Blue", painted_yellow: "Yellow", brick_white: "White brick", brick_red: "Red brick" };
$("#bar").innerHTML = TOOLS.map((t) => `<button class="tool" data-tool="${t.id}" title="${t.name} (${t.key})"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS[t.id]}</svg><span>${t.name}</span><kbd>${t.key}</kbd></button>`).join("");
$("#bar").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); });
export function setTool(id) { cancel(); ui.tool = id; for (const b of document.querySelectorAll(".tool")) b.classList.toggle("on", b.dataset.tool === id); renderSub(); showHover(); }
function chip(group, val, label, on, style = "") { return `<button class="chip ${on ? "on" : ""}" data-g="${group}" data-v="${val}" ${style}>${label}</button>`; }
function slider(key, min, max) { return `<label class="sz">size <input type="range" min="${min}" max="${max}" step="0.5" value="${ui[key]}" data-k="${key}"><b>${Math.round(ui[key] * 2)} m</b></label>`; }
export function renderSub() {
  const t = ui.tool; let h = "";
  if (isBuild(t) || t === "paint") {
    h = (t === "paint" ? "" : `<button class="chip ${grid.on ? "on" : ""}" data-act="grid" title="Snap to a grid (G) · Shift+G turns it to the block under the cursor"><i class="sw dice">#</i>Grid</button><button class="chip ${ui.free ? "on" : ""}" data-act="free" title="No snapping (or hold Alt)"><i class="sw dice">~</i>Free</button><span class="sep"></span>`) + chip("fin", "random", '<i class="sw dice">⚄</i>Mixed', ui.fin === "random") + kit.FIN.map((f) => chip("fin", f, `<i class="sw" style="background:${SWATCH[f]}${f.startsWith("brick") ? ";background-image:repeating-linear-gradient(0deg,transparent 0 3px,rgba(0,0,0,.18) 3px 4px)" : ""}"></i>${LABEL[f]}`, ui.fin === f)).join("");
  } else if (t === "trees") h = ["birches", "pines", "bushes", "mixed"].map((k) => chip("trees", k, k[0].toUpperCase() + k.slice(1), ui.trees === k)).join("") + `<button class="chip ${ui.treeErase ? "on" : ""}" data-act="erase" title="Remove trees (or hold Shift)"><i class="sw dice">✕</i>Remove</button>` + slider("treeR", 2, 40);
  else if (t === "carve") h = chip("carve", "out", '<i class="sw dice">⊞</i>Build out', ui.carve === "out") + chip("carve", "dig", '<i class="sw dice">⊟</i>Dig', ui.carve === "dig");
  else if (t === "road") h = [["drive", 4, "Driveway"], ["street", 7, "Street"], ["wide", 11, "Wide"]].map(([k, w, l]) => `<button class="chip ${ui.roadW === w ? "on" : ""}" data-act="roadw" data-w="${w}"><i class="sw dice">${w}</i>${l} · ${w} m</button>`).join("") + `<span class="sep"></span><button class="chip ${grid.on ? "on" : ""}" data-act="grid"><i class="sw dice">#</i>Grid</button><button class="chip ${ui.free ? "on" : ""}" data-act="free"><i class="sw dice">~</i>Free</button>`;
  else if (t === "ground") h = LAND.map(([k, l, , , c]) => chip("groundKind", k, `<i class="sw" style="background:${c}"></i>${l}`, ui.groundKind === k)).join("") + slider("groundR", 1, 40);
  if (t === "trees" || t === "ground") h += `<button class="chip ${ui.line ? "on" : ""}" data-act="line" title="Drag a straight line instead of brushing"><i class="sw dice">/</i>Line</button>`;
  $("#sub").innerHTML = h; $("#sub").style.display = h ? "" : "none";
  const tool = TOOLS.find((x) => x.id === t); if (!tool) return;            // (the photo mode's "walk": not a tool of the bar)
  $("#hint").textContent = (now.input === "touch" && TOUCH_HINT[t]) || tool.hint;
}
$("#sub").addEventListener("click", (e) => { if (e.target.closest("[data-act=grid]")) { grid.on = !grid.on; renderSub(); scheduleSave(); return; }
  if (e.target.closest("[data-act=free]")) { ui.free = !ui.free; mouse.alt = ui.free; renderSub(); return; }
  if (e.target.closest("[data-act=line]")) { ui.line = !ui.line; renderSub(); return; }
  { const rw = e.target.closest("[data-act=roadw]"); if (rw) { ui.roadW = +rw.dataset.w; renderSub(); return; } }
  if (e.target.closest("[data-act=erase]")) { ui.treeErase = !ui.treeErase; mouse.shift = ui.treeErase; renderSub(); return; } const b = e.target.closest("[data-g]"); if (!b) return; ui[b.dataset.g] = b.dataset.v; renderSub(); });
$("#sub").addEventListener("input", (e) => { if (e.target.dataset.k) { ui[e.target.dataset.k] = +e.target.value; e.target.nextElementSibling.textContent = `${e.target.dataset.k === "width" ? ui.width : Math.round(ui[e.target.dataset.k] * 2)} m`; } });
$("#undo").onclick = () => undo(); $("#redo").onclick = () => redo(); $("#photo").onclick = () => photo();
$("#new").onclick = () => { clearTown(); flash("Cleared · Ctrl/⌘ Z brings it back"); };
$("#helpbtn").onclick = () => $("#help").classList.toggle("open");
on("options", renderSub);

// the haze: a slider behind the Haze button, and another in the Walk bar, kept in step
function showHaze() {
  const v = Math.round(atmos.haze * 100), { far } = hazeParams(atmos.haze);
  for (const el of document.querySelectorAll("input.haze")) el.value = v;
  for (const el of document.querySelectorAll(".hazev")) el.textContent = `${v}%`;
  $("#hazebox .hazed").textContent = `things fade out by ${far >= 1000 ? (far / 1000).toFixed(1) + " km" : Math.round(far / 10) * 10 + " m"}`;
}
for (const el of document.querySelectorAll("input.haze")) el.addEventListener("input", (e) => setHaze(+e.target.value / 100));
on("atmos", showHaze);
$("#hazebtn").onclick = () => { $("#hazebox").classList.toggle("open"); showHaze(); };
