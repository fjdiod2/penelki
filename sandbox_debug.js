// Панельки, debug sliders (open the game with ?debug): the aerial perspective's colour rates, live. Not part of the game.
import { scene } from "./sandbox_core.js";

export function debugPanel(light) {
  if (!new URLSearchParams(location.search).has("debug")) return;
  const A = light.uniforms.tlAer.value, box = document.createElement("div");
  box.className = "panel"; box.id = "debugbox";
  box.style.cssText = "position:fixed;left:16px;top:70px;padding:10px 14px;z-index:50;width:250px;font-size:12px";
  const rows = [["red rate", "x", 0.2, 4], ["green rate", "y", 0.2, 4], ["blue rate", "z", 0.2, 6], ["reach (sooner)", "w", 1, 12]];
  box.innerHTML = "<b>Aerial perspective</b>" + rows.map(([t, k, a, b]) => `<label style="display:block;margin-top:8px">${t} <span data-v="${k}"></span><input type="range" min="${a}" max="${b}" step="0.05" value="${A[k]}" data-k="${k}" style="width:100%"></label>`).join("")
    + `<div id="dbghaze" style="margin-top:8px;color:var(--dim)"></div><button id="dbgreset" style="margin-top:6px">Reset</button>`;
  document.body.appendChild(box);
  const show = () => {
    for (const [, k] of rows) box.querySelector(`[data-v=${k}]`).textContent = A[k].toFixed(2);
    const f = scene.fog; box.querySelector("#dbghaze").textContent = f ? `haze from ${Math.round(f.near)} m to ${Math.round(f.far)} m` : "";
  };
  for (const inp of box.querySelectorAll("input")) inp.oninput = () => { A[inp.dataset.k] = +inp.value; show(); };
  const D = A.clone(); box.querySelector("#dbgreset").onclick = () => { A.copy(D); for (const inp of box.querySelectorAll("input")) inp.value = A[inp.dataset.k]; show(); };
  for (const e of ["pointerdown", "wheel", "keydown"]) box.addEventListener(e, (ev) => ev.stopPropagation());
  show(); setInterval(show, 1000);
}
