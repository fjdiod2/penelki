# Панельки

A building toy for Soviet panel-block towns, in the spirit of Townscaper and Tiny Glade. Drag out blocks, pull them up
floor by floor, stack, step back, extrude and dig them into absurd shapes, then add trees, water, bogs and paths.

It is a static web page (three.js from a CDN, no build step). Run it locally with any static server, for example:

    python3 -m http.server 8000

and open http://localhost:8000. Towns are saved in the browser.

## Files

- `index.html` — the page and its interface styles
- `sandbox.js` — the game: tools, snapping, input (mouse and touch), saving, undo
- `sandbox_blocks.js` — panel blocks: layout of the pieces, holes, merging of blocks that run into each other
- `sandbox_nature.js` — trees, the painted ground (grass, fields, bog, reeds, water, paths) and the water mirror
- `apartments.js`, `forest_gen.js` — panel pieces and tree generator, shared with the train simulator this came from
- `assets/` — textures and the panel pieces
