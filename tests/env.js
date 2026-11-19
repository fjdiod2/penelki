// Lets the game's modules run in Node for the fast tests: files are read from the repo instead of fetched, and
// textures are never loaded (nothing is drawn). Import this before any game module.
import fs from "node:fs";

const ROOT = new URL("../", import.meta.url);
globalThis.fetch = async (u) => { const t = fs.readFileSync(new URL(String(u).replace(/^\.\//, ""), ROOT), "utf8"); return { ok: true, json: async () => JSON.parse(t), text: async () => t }; };
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {} }) };      // three's image loader

let kitP = null;
export async function blockKit() {                 // the block rules with the real pieces.json (shared by all tests)
  const { createBlockKit } = await import("../sandbox_blocks.js");
  const THREE = await import("three");
  return (kitP ||= createBlockKit({ color: new THREE.Color(0xbcc9d3), near: 380, far: 2600 }));
}
