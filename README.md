# Панельки

A building toy for Soviet panel-block towns, in the spirit of Townscaper and Tiny Glade. Drag out blocks, pull them up
floor by floor, stack, step back, extrude and dig them into absurd shapes, then add trees, water, bogs and paths.

It is a static web page (three.js from a CDN, no build step). Run it locally with any static server, for example:

    python3 -m http.server 8000

and open http://localhost:8000. Towns are saved in the browser.

## Tests

    npm install        # once: three.js for Node (the page itself loads it from a CDN)
    npm test           # the rules: block layouts, holes, merging, step backs, extrude and dig (Node, under a second)

Slower end-to-end checks drive the real page in a headless browser and compare with a recorded run (about 2 minutes
each; run them before a release, not after every change). They need Python with playwright:

    python3 tests/desktop.py check     # mouse and keyboard
    python3 tests/touch.py check       # fingers on a phone-sized page: camera gestures, tap to place, handles, extrude
    python3 tests/desktop.py record    # after an intended change: record the new baseline

## Files

- `index.html` — the page and its interface styles
- `sandbox.js` — starts the game
- `sandbox_core.js` — the scene and the town: building, snapping, picking, highlights, undo and saving; reads no input
- `sandbox_town.js` — the town's rules as plain functions: stacking, step backs, walls as panel grids, extrude and dig
- `sandbox_ui.js` — the tool bar, options row and buttons (shared by mouse and touch)
- `sandbox_desktop.js` — mouse and keyboard
- `sandbox_touch.js` — fingers: map-style camera, tap to place, handles
- `sandbox_streets.js` — roads: surfaces, kerbs, junctions, and the lamps, poles, wires and parked cars along them
- `sandbox_yards.js` — yards: the paint-bucket fill from a tapped point, and the driveway, link road, playground and kiosk in it
- `sandbox_details.js` — entrance paths, benches, bins and lamps; dishes on facades; antennas on roofs
- `props.js` — the simulator's props loader (benches, lamps, cars...); the models themselves are not in git yet
- `sandbox_handles.js` — the touch arithmetic (two-finger gestures, where handles go), tested in Node
- `sandbox_blocks.js` — panel blocks: layout of the pieces, holes, merging of blocks that run into each other
- `sandbox_nature.js` — trees, the painted ground (grass, fields, bog, reeds, water, paths) and the water mirror
- `apartments.js`, `forest_gen.js` — panel pieces and tree generator, shared with the train simulator this came from
- `assets/` — textures and the panel pieces
