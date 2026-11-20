// Панельки, debug sliders (open the game with ?debug): the facades' knobs (sandbox_facade.js), live. Not part of the game.
export function debugPanel(light) {
  if (!new URLSearchParams(location.search).has("debug")) return;
  const U = light.uniforms, box = document.createElement("div");
  box.className = "panel"; box.id = "debugbox";
  box.style.cssText = "position:fixed;left:16px;top:70px;padding:10px 14px;z-index:50;width:260px;font-size:12px;max-height:calc(100vh - 220px);overflow:auto";
  // [label, uniform, component, min, max, step]
  const rows = [
    ["Streaks"], ["share of columns", "faA", "x", 0, 1, 0.01], ["darkness", "faA", "y", 0, 2, 0.01], ["longest (m)", "faA", "z", 6, 200, 1],
    ["Tone"], ["unevenness", "faA", "w", 0, 1, 0.01], ["patch size (m)", "faB", "x", 3, 200, 1], ["dirt low down", "faB", "y", 0, 0.6, 0.01],
    ["Calm far off"], ["starts at (m per pixel)", "faB", "z", 0, 1, 0.01], ["full at (m per pixel)", "faB", "w", 0.01, 2, 0.01], ["windows to average", "faC", "x", 0, 1, 0.01],
  ];
  box.innerHTML = rows.map((r) => r.length === 1 ? `<b style="display:block;margin-top:8px">${r[0]}</b>`
    : `<label style="display:block;margin-top:5px">${r[0]} <span data-v="${r[1]}.${r[2]}"></span><input type="range" min="${r[3]}" max="${r[4]}" step="${r[5]}" value="${U[r[1]].value[r[2]]}" data-u="${r[1]}" data-c="${r[2]}" style="width:100%"></label>`).join("")
    + `<button id="dbgreset" style="margin-top:8px">Reset</button> <button id="dbgcopy">Copy values</button>`;
  document.body.appendChild(box);
  const keys = [...new Set(rows.filter((r) => r.length > 1).map((r) => r[1]))], D = Object.fromEntries(keys.map((k) => [k, U[k].value.clone()]));
  const show = () => { for (const inp of box.querySelectorAll("input")) box.querySelector(`[data-v="${inp.dataset.u}.${inp.dataset.c}"]`).textContent = (+U[inp.dataset.u].value[inp.dataset.c]).toFixed(2); };
  for (const inp of box.querySelectorAll("input")) inp.oninput = () => { U[inp.dataset.u].value[inp.dataset.c] = +inp.value; show(); };
  box.querySelector("#dbgreset").onclick = () => { for (const k of keys) U[k].value.copy(D[k]); for (const inp of box.querySelectorAll("input")) inp.value = U[inp.dataset.u].value[inp.dataset.c]; show(); };
  box.querySelector("#dbgcopy").onclick = () => navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(Object.fromEntries(keys.map((k) => [k, U[k].value.toArray().map((v) => +v.toFixed(3))]))));
  for (const e of ["pointerdown", "wheel", "keydown"]) box.addEventListener(e, (ev) => ev.stopPropagation());
  show();
}
