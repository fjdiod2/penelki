// Панельки, the core: the scene, the town and everything that changes it (building, pushing walls, stepping back,
// extruding, digging, painting, planting), snapping, picking, undo and saving, and the highlights and tips that show
// what a press would do. It reads no input itself: sandbox_desktop.js (mouse and keys) and sandbox_touch.js (fingers)
// move the cursor and call press / move / release, or the operations directly. How near counts as "on" something
// differs for a finger and a mouse: that is the input profile (setInput).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createBlockKit, V, offsetPoly, polyArea, pathLen, nearestOnPath, subPath, cutRects } from "./sandbox_blocks.js";
import { createTown, MIN_D, sameWall } from "./sandbox_town.js";
import { roadStrip, kerbs, prepRoads, snapToRoads, roadAt, roadProps, KERB } from "./sandbox_streets.js";
import { createProps } from "./props.js";
import { entranceDetails, facadeDishes, roofAntennas, blockField, PATH_W } from "./sandbox_details.js";
import { yardCells, yardLayout, CELL } from "./sandbox_yards.js";
import { createTrees, createGround, TREE_NAMES, TREE_SETS, LAND, WATER_Y } from "./sandbox_nature.js";

const Q = new URLSearchParams(location.search);
const SAVE_KEY = "panelki_sandbox_v1";
const SKY = new THREE.Color(0xc3d0da), FOG = { color: new THREE.Color(0xbcc9d3), near: 380, far: 2600 };

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia("(pointer: coarse)").matches ? 1.5 : 2)); renderer.setSize(innerWidth, innerHeight);   // a phone: fewer pixels
renderer.outputColorSpace = THREE.SRGBColorSpace; document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = SKY; scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 9000);
camera.position.set(150, 130, 190);
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 8; controls.maxDistance = 2000; controls.screenSpacePanning = false;
controls.target.set(0, 0, 0); controls.update();

const kit = await createBlockKit(FOG);
const { W, H, PL } = kit;
const ground = createGround(scene, FOG, SKY), trees = createTrees(scene);
// props (benches, lamps, cars, poles...): the simulator's props.json. The game also works without them (not deployed yet)
let props = null; const propAttach = {};
try { props = await createProps(FOG); const PJ = await fetch("./assets/props/props.json").then((r) => r.json()); for (const [k, v] of Object.entries(PJ.props)) if (v.attach) propAttach[k] = v.attach; }
catch (e) { props = null; console.info("props not loaded:", e.message); }
const cityRoot = new THREE.Group(), hullGroup = new THREE.Group(), roofGroup = new THREE.Group(), previewRoot = new THREE.Group(), overlayRoot = new THREE.Group();
scene.add(cityRoot, hullGroup, roofGroup, previewRoot, overlayRoot);
const ovMat = (c, o = 0.35) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, fog: false });
const OV = { build: ovMat(0xffe27a, 0.4), edge: ovMat(0x7ad8ff, 0.5), erase: ovMat(0xff4a3a, 0.45), floors: ovMat(0xffe27a, 0.35), paint: ovMat(0xffffff, 0.3) };
const brushRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, fog: false }));
brushRing.rotation.x = -Math.PI / 2; brushRing.renderOrder = 999; brushRing.visible = false; scene.add(brushRing);
// the snapping grid: drawn by a shader on a plane, only around the cursor, so it never clutters the whole view
const gridMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  uniforms: { o: { value: new THREE.Vector2() }, ang: { value: 0 }, step: { value: 3.2 }, ctr: { value: new THREE.Vector2() }, rad: { value: 120 } },
  vertexShader: "varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
  fragmentShader: `uniform vec2 o; uniform float ang; uniform float step; uniform vec2 ctr; uniform float rad; varying vec3 vW;
    float grid(vec2 u, float st, float px) { vec2 g = abs(fract(u / st - 0.5) - 0.5) * st / fwidth(u); return 1.0 - smoothstep(px - 0.5, px + 0.5, min(g.x, g.y)); }
    void main() {
      vec2 d = vW.xz - o; float c = cos(ang), s = sin(ang); vec2 u = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
      float fw = max(fwidth(u.x), fwidth(u.y)), minor = grid(u, step, 0.6) * (1.0 - smoothstep(0.08, 0.25, fw / step)), major = grid(u, step * 10.0, 1.1);
      float a = max(minor * 0.32, major * 0.6) * (1.0 - smoothstep(rad * 0.35, rad, length(vW.xz - ctr)));
      if (a < 0.003) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, a);
    }` });
const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), gridMat); gridMesh.rotation.x = -Math.PI / 2; gridMesh.renderOrder = 5; gridMesh.visible = false; scene.add(gridMesh);
const guideMat = new THREE.LineBasicMaterial({ color: 0xff6ad5, depthTest: false, transparent: true, fog: false }), dotMat = new THREE.MeshBasicMaterial({ color: 0xff6ad5, depthTest: false, transparent: true, fog: false });
const guideRoot = new THREE.Group(); scene.add(guideRoot);
function showGuides(list, y, at) {                // magenta lines for what the new block lines up with, and a dot where it will start
  for (const c of [...guideRoot.children]) { guideRoot.remove(c); if (c.geometry !== dotGeo) c.geometry.dispose(); }
  const yy = y + 0.15;
  for (const g of list) {
    if (g.kind === "pt") { const m = new THREE.Mesh(dotGeo, dotMat); m.position.set(g.a[0], yy, g.a[1]); m.scale.setScalar(tolAt(g.a, y) * 0.35); m.renderOrder = 1000; guideRoot.add(m); continue; }
    let a = g.a, b = g.b; if (g.kind === "line") { const t0 = V.dot(V.sub(b, g.l.a), g.l.u), ext = 25; a = V.add(g.l.a, V.mul(g.l.u, Math.min(0, t0) - ext)); b = V.add(g.l.a, V.mul(g.l.u, Math.max(0, t0) + ext)); }
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], yy, a[1]), new THREE.Vector3(b[0], yy, b[1])]), guideMat); ln.renderOrder = 1000; guideRoot.add(ln);
  }
  if (at) { const m = new THREE.Mesh(dotGeo, dotMat); m.position.set(at[0], yy, at[1]); m.scale.setScalar(tolAt(at, y) * 0.22); m.renderOrder = 1000; guideRoot.add(m); }
}
const dotGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);

// ---------------------------------------------------------------- the town
let S = { blocks: [], trees: [], roads: [], yards: [], nextId: 1 };
const town = createTown(kit, () => S);                 // the rules (sandbox_town.js), sharing S
const { byId, reindex, isGround, baseOf, topOf, subtree, holeAt, inSign, terracePts, wallFrame, selBox, digCut } = town;
const treeY = (t) => (t.b && byId.has(t.b) ? (t.f != null ? baseOf(byId.get(t.b)) + (isGround(byId.get(t.b)) ? PL : 0) + t.f * H : topOf(byId.get(t.b))) : ground.waterDepth(t.x, t.z) > 0 ? WATER_Y - 0.1 : 0);   // trees in water stand on its bottom

const cache = new Map();                          // block id -> { key, lay, hull, roof }
let city = null;
function dropCache(id) { const c = cache.get(id); if (!c) return; hullGroup.remove(c.hull); roofGroup.remove(c.roof); kit.disposeGroup(c.hull); kit.disposeGroup(c.roof); cache.delete(id); }
function rebuild() {
  reindex(); featMemo = null;
  const lays = [], seen = new Set();
  for (const b of S.blocks) {
    const base = baseOf(b), key = JSON.stringify([b.pts, b.closed, b.fl, b.fin, b.seed, isGround(b), base, b.D, b.cuts]);
    let c = cache.get(b.id);
    if (!c || c.key !== key) {
      dropCache(b.id); const lay = kit.layout(b, base);
      c = { key, lay, hull: kit.hullMesh(lay), roof: kit.roofMesh(lay) }; c.hull.userData.id = b.id;
      hullGroup.add(c.hull); roofGroup.add(c.roof); cache.set(b.id, c);
    }
    lays.push({ id: b.id, b, lay: c.lay }); seen.add(b.id);
  }
  for (const id of [...cache.keys()]) if (!seen.has(id)) dropCache(id);
  if (city) { cityRoot.remove(city); kit.disposeGroup(city); }
  const merged = kit.mergeLays(lays); cityLays = merged.map((lay, i) => ({ b: lays[i].b, lay }));
  city = kit.buildMeshes(merged); cityRoot.add(city);       // blocks on one grid that run into each other: drawn as one
  trees.rebuild(S.trees, treeY);
  rebuildStreets();
  updateStats();
}

// ---------------------------------------------------------------- roads, and what stands along them
// Roads are straight lines of a width (S.roads: { id, pts: [a, b], w }); their surfaces, kerbs, and the lamps, poles,
// wires and parked cars along them (sandbox_streets.js) are made again whenever the roads or the blocks change.
const streetRoot = new THREE.Group(); scene.add(streetRoot);
const wireMat = new THREE.LineBasicMaterial({ color: 0x262626 });
const ROAD_Y = 0.05;
function roadMesh(list, all, mat = ground.roadMat, y = ROAD_Y) {   // the surfaces and kerbs of the roads in list, among all, as one mesh
  const pos = [], rk = [], ra = [], idx = [], kprep = prepRoads(all);
  const quad = (ps, ys, ks, ky, al = [0, 0, 0, 0], L = 0) => { const o = pos.length / 3; ps.forEach((p, n) => { pos.push(p[0], ys[n], p[1]); rk.push(ks[n], ky); ra.push(al[n], L); }); idx.push(o, o + 2, o + 1, o, o + 3, o + 2, o, o + 1, o + 2, o, o + 2, o + 3); };
  for (const r of list) {
    const { left, right, s, len } = roadStrip(r, all);       // (rk: across -1..1, -width; ra: metres along, length)
    for (let i = 0; i + 1 < left.length; i++) quad([left[i], left[i + 1], right[i + 1], right[i]], [y, y, y, y], [1, 1, -1, -1], -r.w, [s[i], s[i + 1], s[i + 1], s[i]], len);
    if (mat !== ground.roadMat) continue;
    for (const run of kerbs(r, all, kprep)) {                // a kerb: its top and both sides; rk.x counts metres along it (1 m stones)
      let acc = 0;
      for (let i = 0; i + 1 < run.length; i++) {
        const a = run[i], b = run[i + 1], d = V.norm(V.sub(b, a)), n = V.mul(V.left(d), KERB.w / 2), A = V.add(a, n), B = V.add(b, n), C = V.sub(b, n), Dd = V.sub(a, n), h = KERB.h, s0 = acc, s1 = (acc += V.dist(a, b));
        quad([A, B, C, Dd], [h, h, h, h], [s0, s1, s1, s0], 1);
        quad([A, B, B, A], [0, 0, h, h], [s0, s1, s1, s0], 0.6); quad([Dd, C, C, Dd], [h, h, 0, 0], [s0, s1, s1, s0], 0.6);
      }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("rk", new THREE.Float32BufferAttribute(rk, 2)); geo.setAttribute("ra", new THREE.Float32BufferAttribute(ra, 2)); geo.setIndex(idx);
  const g = new THREE.Group(); g.add(new THREE.Mesh(geo, mat)); return g;
}
let streetKey = "", streetObj = null, cityLays = [], detailPaths = [];
// the paths from entrances: concrete slabs a little above the ground (the kerb stones' look, 1 m slabs)
function pathMesh(paths) {
  const pos = [], rk = [], ra = [], idx = [], y = 0.07;
  for (const { a, b, w } of paths) {
    const d = V.norm(V.sub(b, a)), n = V.mul(V.left(d), w / 2), L = V.dist(a, b), q = [V.add(a, n), V.add(b, n), V.sub(b, n), V.sub(a, n)], o = pos.length / 3;
    q.forEach((c, i) => { pos.push(c[0], y, c[1]); rk.push(i === 0 || i === 3 ? 0 : L, 1); ra.push(0, 0); }); idx.push(o, o + 2, o + 1, o, o + 3, o + 2, o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("rk", new THREE.Float32BufferAttribute(rk, 2)); g.setAttribute("ra", new THREE.Float32BufferAttribute(ra, 2)); g.setIndex(idx);
  return new THREE.Mesh(g, ground.roadMat);
}
// The things around blocks, read from the blocks as drawn (after merging: a buried or dug-out entrance gets nothing).
// Two layers, each made again only when what it depends on changes: the street layer (roads, yards, entrance paths and
// everything along them) depends only on where blocks stand, not on their floors or paint, so dragging floors or
// repainting does not redo it; the block layer (dishes, antennas) depends on the blocks and is cheap.
const entrancesNow = () => cityLays.flatMap(({ b, lay }) => lay.out.flatMap((p, i) => (p.pc === "entrance" ? [{ p: p.q, out: V.mul(p.n, -1), seed: (b.seed + i * 7919) >>> 0, b: b.id }] : [])));
function blockExtras() {                           // dishes on facades, antennas on roofs
  const items = [];
  for (const { b, lay } of cityLays) {
    const kids = S.blocks.filter((x) => x.parent === b.id), ws = [], exits = [], pl = isGround(b) ? PL : 0;
    for (const p of lay.out) {
      if (p.pc === "window" && p.pa) ws.push({ q: p.q, n: p.n, u: V.norm(V.sub(p.pb, p.pa)), y: p.y, f: Math.round((p.y - lay.base - pl) / H) });
      else if (p.pc === "roof_exit") exits.push(p.q);
    }
    items.push(...facadeDishes(ws, b.seed));
    const holes = cutRects(b).filter((r) => r.f1 >= b.fl), u = b.closed || b.pts.length !== 2 ? null : V.norm(V.sub(b.pts[1], b.pts[0]));
    const open = (q) => kids.some((k) => nearestOnPath(k.pts, k.closed, q).d < (k.D || 12) / 2 + 1.5)
      || (u && holes.some((r) => { const d = V.sub(q, b.pts[0]), s1 = V.dot(d, u), w1 = V.dot(d, V.left(u)); return s1 > r.s0 - 2 && s1 < r.s1 + 2 && w1 > r.w0 - 2 && w1 < r.w1 + 2; }));
    items.push(...roofAntennas(b, lay.top, exits, b.seed, open));
  }
  return items;
}
const propMeshes = (items) => props.build(items.map((it) => ({ name: it.name, p: new THREE.Vector3(...it.p), a: new THREE.Vector3(it.a[0], 0, it.a[1]), paint: [Math.floor(it.r * 4), 0, 0], r: it.r })));
let yardRegions = [], allRoads = [], extraKey = "", extraObj = null, field = null, roadPrep = [];   // the yards as worked out now ({ y, Y }), the roads with their driveways
// the camera free of the orbit controls (the street-level photo mode moves it itself)
let freeCam = false;
function freeCamera(on) { freeCam = on; controls.enabled = !on; }
// While a drag moves blocks or roads (a wall, a block, a road's end), the street layer is held and made once on release.
let streetsHeld = false;
function holdStreets(on) { streetsHeld = on; if (!on) rebuildStreets(); }
function rebuildStreets(force = false) {
  const free = (p) => ground.waterDepth(p[0], p[1]) <= 0;
  const key = JSON.stringify([S.roads, S.yards, S.blocks.map((b) => [b.id, b.pts, b.D, b.closed, b.parent, b.at, b.seed, b.cuts])]);
  if ((force || key !== streetKey) && !(streetsHeld && !force)) {
    streetKey = key; field = blockField(S.blocks); roadPrep = prepRoads(S.roads);
    if (streetObj) { streetRoot.remove(streetObj); kit.disposeGroup(streetObj); streetObj = null; }
    detailPaths = []; yardRegions = []; allRoads = S.roads;
    if (S.roads.length || S.blocks.length) {
      const es = entrancesNow(), items = [], yardRoads = [];
      for (const y of S.yards) {                    // each yard: its shape now, and what is laid out in it
        const Y = yardCells(y.p, { blocks: S.blocks, roads: S.roads, free, field, prep: roadPrep }); if (!Y) continue; yardRegions.push({ y, Y });
        const L = yardLayout(Y, { id: y.id, seed: y.seed, entrances: es, blocks: S.blocks, roads: [...S.roads, ...yardRoads], free, field });
        yardRoads.push(...L.roads); items.push(...L.items);
      }
      allRoads = [...S.roads, ...yardRoads];
      const prep = prepRoads(allRoads), ent = entranceDetails(es, { roads: allRoads, blocks: S.blocks, free, field, prep }); detailPaths = ent.paths;
      streetObj = new THREE.Group(); if (allRoads.length) streetObj.add(roadMesh(allRoads, allRoads));
      if (ent.paths.length) streetObj.add(pathMesh(ent.paths));
      if (props) {
        const wires = [], ctx = { roads: allRoads, blocks: S.blocks, attach: propAttach, free, field, prep };
        for (const r of allRoads) { const o = roadProps(r, ctx); items.push(...o.items); wires.push(...o.wires); }
        items.push(...ent.items); streetObj.add(propMeshes(items));
        if (wires.length) { const wp = []; for (const w of wires) for (let i = 0; i + 1 < w.length; i++) wp.push(...w[i], ...w[i + 1]); const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3)); streetObj.add(new THREE.LineSegments(wg, wireMat)); }
      }
      streetRoot.add(streetObj);
    }
  }
  const ekey = JSON.stringify(S.blocks);
  if (force || ekey !== extraKey) {
    extraKey = ekey; if (extraObj) { streetRoot.remove(extraObj); kit.disposeGroup(extraObj); extraObj = null; }
    if (props && S.blocks.length) { extraObj = propMeshes(blockExtras()); streetRoot.add(extraObj); }
  }
}
// where a road from a toward cur ends: on another road (its end, or joining it), else as a block's wall would (square
// to the grid or a neighbour, in whole panels, or up to a guide) -> { p, why, guides }
function roadEnd(a, cur, except = null) {
  if (mouse.alt) return { p: cur, why: "", guides: [] };
  const sn = snapToRoads(cur, S.roads, tolAt(cur, 0), except); if (sn) return { p: sn.p, why: sn.why, guides: [] };
  const st = straight(a, cur); if (!st) return { p: cur, why: "", guides: [] };
  return { p: st.pts[1], why: [...new Set(st.guides.map((g) => g.why).filter(Boolean))].join(" · "), guides: st.guides };
}
function roadStart(p) { if (mouse.alt) return p; const sn = snapToRoads(p, S.roads, tolAt(p, 0)); return sn ? sn.p : snapPoint(p, 0).p; }
function addRoad(a, b, w = ui.roadW) {             // a new road from a to b (undoable) -> it, or null when too short
  if (V.dist(a, b) < 2) return null; const before = snapshot(), r = { id: S.nextId++, pts: [a, b], w }; S.roads.push(r); rebuild(); pushUndo(before); return r;
}
// a press in the Road tool lays a road (from a road's end, it carries on from there); Shift on a road's end drags the
// end instead, with the ends of the roads that meet it there
function roadPress() {
  const p = onPlane(0); if (!p) return; const tol = tolAt(p, 0);
  if (mouse.shift) for (const r of S.roads) for (let k = 0; k < 2; k++) if (V.dist(p, r.pts[k]) < tol) {
    const at = r.pts[k], ends = []; for (const o of S.roads) for (let j = 0; j < 2; j++) if (V.dist(o.pts[j], at) < 0.05) ends.push([o, j]);
    action = { kind: "roadEnd", r, k, ends, before: snapshot(), guides: [], why: "" }; streetsHeld = true; return;
  }
  action = { kind: "road", a: roadStart(p), a0: p, b: null, why: "", guides: [] };
}
// ---- yards: a click in open ground near blocks lays one out there; in a yard, it shuffles what is in it
const yardFree = (p) => ground.waterDepth(p[0], p[1]) <= 0;
let yardPreview = { key: "", Y: null };
function yardAtCursor(p) {                          // the yard a click at p would make (cached per cell)
  const key = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}|${streetKey.length}`;
  if (yardPreview.key !== key) yardPreview = { key, Y: yardCells(p, { blocks: S.blocks, roads: S.roads, free: yardFree, field: field || blockField(S.blocks), prep: roadPrep }) };
  return yardPreview.Y;
}
function yardPress() {
  const p = onPlane(0); if (!p) return; const hit = yardRegions.find((r) => r.Y.at(p)), before = snapshot();
  if (hit) { hit.y.seed = (Math.random() * 2 ** 31) | 0; rebuild(); pushUndo(before); flash("Yard rearranged"); return; }
  const Y = yardAtCursor(p);
  if (!Y || Y.count < 25) { flash("No yard here · tap open ground near blocks (not a road, water or an empty field)"); return; }
  S.yards.push({ id: S.nextId++, p, seed: (Math.random() * 2 ** 31) | 0 }); rebuild(); pushUndo(before);
}
function cellsMesh(Y, mat, y = 0.16) {              // a yard's cells as a tinted patch
  const pos = [], h = CELL / 2;
  for (let j = 0; j < Y.n; j++) for (let i = 0; i < Y.n; i++) if (Y.mask[j * Y.n + i]) { const [x, z] = Y.centre(i, j); pos.push(x - h, y, z - h, x + h, y, z - h, x + h, y, z + h, x - h, y, z - h, x + h, y, z + h, x - h, y, z + h); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); return new THREE.Mesh(g, mat);
}
const quadMesh = (q, y, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(q.flatMap((c) => [c[0], y, c[1]]), 3)); g.setIndex([0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3]); return new THREE.Mesh(g, mat); };
function lineQuad(a, b, hw) { const n = V.mul(V.left(V.norm(V.sub(b, a))), hw); return [V.add(a, n), V.add(b, n), V.sub(b, n), V.sub(a, n)]; }
// a row of trees from a to b: an alley (Line mode of the Trees brush)
function plantLine(a, b) {
  const set = TREE_SETS[ui.trees], gap = ui.trees === "bushes" ? 2.2 : 5.5, L = V.dist(a, b); if (L < 0.5) return false;
  const n = Math.max(1, Math.round(L / gap)), grounded = S.blocks.filter(isGround); let added = false;
  for (let i = 0; i <= n; i++) {
    const q = V.lerp(a, b, i / n);
    if (grounded.some((bb) => insideBlock(bb, q, 2)) || roadAt(q, S.roads, 1) >= 0 || S.trees.some((t) => !t.b && (t.x - q[0]) ** 2 + (t.z - q[1]) ** 2 < 2.5)) continue;
    const name = set[Math.floor(Math.random() * set.length)];
    S.trees.push({ x: q[0], z: q[1], n: TREE_NAMES.indexOf(name), v: Math.floor(Math.random() * 6), rot: Math.random() * 6.283, sc: 0.85 + Math.random() * 0.25, b: null }); added = true;
  }
  return added;
}
let roadGhost = null;
function showRoadGhost(r) {
  if (roadGhost) { previewRoot.remove(roadGhost); roadGhost.traverse((o) => o.geometry && o.geometry.dispose()); roadGhost = null; }
  if (r) { roadGhost = roadMesh([r], [...S.roads, r], OV.build); previewRoot.add(roadGhost); }
}

// ---------------------------------------------------------------- undo, redo, saving
const undoStack = [], redoStack = [];
const snapshot = () => JSON.stringify(S);
function pushUndo(before, splat = null) { undoStack.push({ before, after: snapshot(), splat }); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; scheduleSave(); }
const undoMark = () => undoStack.length;            // several changes as one: squash them, or drop them (Cancel)
function squashUndo(m) { if (undoStack.length - m < 2) return; const es = undoStack.splice(m); undoStack.push({ before: es[0].before, after: es[es.length - 1].after, splat: null }); }
function dropUndo(m) { if (undoStack.length > m) undoStack.length = m; }
function applyState(json) { S = JSON.parse(json); rebuild(); }
function undo() { sel = null; const e = undoStack.pop(); if (!e) return; if (e.splat) putSplat(e.splat, "before"); if (e.before !== e.after) applyState(e.before); redoStack.push(e); scheduleSave(); }
function redo() { sel = null; const e = redoStack.pop(); if (!e) return; if (e.splat) putSplat(e.splat, "after"); if (e.before !== e.after) applyState(e.after); undoStack.push(e); scheduleSave(); }
function putSplat(p, which) { ground.put(p, which); trees.rebuild(S.trees, treeY); }
let saveT = 0;
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(save, 700); }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, S, land: ground.serialize(), cam: [...camera.position.toArray(), ...controls.target.toArray()], grid, atmos })); } catch (e) { console.warn("save failed", e); } }
async function load() {
  let o = null; try { o = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { o = null; }
  if (!o || Q.has("fresh")) return false;
  S = o.S; S.roads ||= []; S.yards ||= []; if (o.cam) { camera.position.fromArray(o.cam.slice(0, 3)); controls.target.fromArray(o.cam.slice(3)); controls.update(); }
  if (o.grid) Object.assign(grid, o.grid);
  if (o.atmos) atmos.haze = o.atmos.haze;
  const land = o.land || o.splat; if (land) await ground.deserialize(land);
  return true;
}

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), mouse = { x: 0, y: 0, in: false, shift: false, alt: false };
function setRay() { ndc.set((mouse.x / innerWidth) * 2 - 1, -(mouse.y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); }
function pick() {                                 // what is under the cursor: { p: [x, z], y, block, roof }
  setRay(); const hits = ray.intersectObjects([...hullGroup.children, ground.mesh], false);
  if (!hits.length) return null;
  const h = hits[0], p = [h.point.x, h.point.z];
  if (h.object === ground.mesh) return { p, y: 0, block: null, roof: false };
  const b = byId.get(h.object.userData.id), top = topOf(b), flat = Math.abs(h.face.normal.y) > 0.7 && ray.ray.direction.y < 0;
  if (flat && h.point.y > top - 0.3) return { p, y: top, block: b, roof: true };
  if (flat && b.cuts) {                            // the floor of a hole dug into the block: it can be built on and planted like a roof
    const y0 = baseOf(b) + (isGround(b) ? PL : 0), f = Math.round((h.point.y - y0) / H);
    if (f > 0 && Math.abs(h.point.y - (y0 + f * H)) < 0.3) return { p, y: y0 + f * H, block: b, roof: true, floor: f };
  }
  return { p, y: h.point.y, block: b, roof: false };
}
// is p near an edge of that hole's floor? -> the edge ("s0" "s1" "w0" "w1")
const holeEdgeAt = (b, p, r) => town.holeEdgeAt(b, p, r, EDGE());
const planeY = new THREE.Plane(), tmpV = new THREE.Vector3();
function onPlane(y) { setRay(); planeY.set(new THREE.Vector3(0, 1, 0), -y); return ray.ray.intersectPlane(planeY, tmpV) ? [tmpV.x, tmpV.z] : null; }
function screenOf(x, y, z) { const v = new THREE.Vector3(x, y, z).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }

// ---------------------------------------------------------------- shapes
const GRID = 1.6;                                 // half a panel module: ring radii; and the hidden grid when the visible one is off
// ---- snapping. The visible grid (G) is one panel (3.2 m) a square, heavier every 10 panels; Shift+G turns it to
// the block under the cursor. Guides line the new block up with the ones already built: in line with a block,
// ends flush, end to end, centred on a ring, parallel or square to a neighbour, and at the same gap as two
// parallel blocks nearby. Alt switches all snapping off.
const grid = { on: true, o: [0, 0], ang: 0 };
const toG = (p) => { const c = Math.cos(grid.ang), s = Math.sin(grid.ang), d = V.sub(p, grid.o); return [c * d[0] + s * d[1], -s * d[0] + c * d[1]]; };
const fromG = (u) => { const c = Math.cos(grid.ang), s = Math.sin(grid.ang); return [grid.o[0] + c * u[0] - s * u[1], grid.o[1] + s * u[0] + c * u[1]]; };
function gridSnap(p) {
  if (mouse.alt) return p;
  if (!grid.on) return [Math.round(p[0] / GRID) * GRID, Math.round(p[1] / GRID) * GRID];
  const u = toG(p); return fromG([Math.round(u[0] / W) * W, Math.round(u[1] / W) * W]);
}
const snap = gridSnap;
let featMemo = null;                              // what new blocks can line up with; worked out again after every rebuild
// Guides come from the walls: corners, wall lines, end lines, ring centres, and the gaps between parallel walls.
function features(except = null) {                // except: a block (and what stands on it) to leave out, as when moving it
  if (!except && featMemo) return featMemo;
  const pts = [], lines = [], dirs = [], segs = [], skip = except ? subtree(except) : null;
  for (const b of S.blocks) {
    if (skip && skip.has(b.id)) continue;
    const c = cache.get(b.id); if (!c) continue; const { Lp, Rp } = c.lay;
    if (b.closed) { const P = b.pts, cc = P.reduce((a, q) => V.add(a, q), [0, 0]); pts.push({ p: V.mul(cc, 1 / P.length), why: "centred" }); continue; }
    const n = Lp.length;
    for (const q of [Lp[0], Rp[0], Lp[n - 1], Rp[n - 1]]) pts.push({ p: q, why: "corner to corner" });
    for (const F of [Lp, Rp]) for (let i = 0; i < n - 1; i++) {
      const d = V.sub(F[i + 1], F[i]), L = V.len(d); if (L < 2 * W) continue;
      const u = V.mul(d, 1 / L); segs.push({ a: F[i], b: F[i + 1], u, L, id: b.id }); dirs.push(u); lines.push({ a: F[i], u, why: "walls in line" });
    }
    for (const [p, q] of [[Lp[0], Rp[0]], [Lp[n - 1], Rp[n - 1]]]) lines.push({ a: p, u: V.norm(V.sub(q, p)), why: "ends flush" });
  }
  const gaps = new Map();                         // spacing between parallel walls of neighbouring blocks -> how often it occurs
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j]; if (A.id === B.id || Math.abs(A.u[0] * B.u[1] - A.u[1] * B.u[0]) > 0.035) continue;
    const g = Math.abs(V.dot(V.sub(B.a, A.a), V.left(A.u))); if (g < 3 || g > 160) continue;
    const t0 = V.dot(V.sub(B.a, A.a), A.u), t1 = V.dot(V.sub(B.b, A.a), A.u); if (Math.max(t0, t1) < -5 || Math.min(t0, t1) > A.L + 5) continue;
    const k = Math.round(g * 10) / 10; gaps.set(k, (gaps.get(k) || 0) + 1);
  }
  const top = [...gaps.keys()].sort((a, b) => gaps.get(b) - gaps.get(a)).slice(0, 4);
  for (const sg of segs) for (const g of top) for (const k of [1, -1]) lines.push({ a: V.add(sg.a, V.mul(V.left(sg.u), g * k)), u: sg.u, why: `same gap · ${Math.round(g)} m`, gap: true });
  const F = { pts, lines, dirs }; if (!except) featMemo = F; return F;
}
function tolAt(p, y) {                            // 14 screen pixels (30 for a finger), in metres, at that spot
  const d = camera.position.distanceTo(tmpV.set(p[0], y, p[1])), m = (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
  return Math.min(prof.tolMax, Math.max(0.6, prof.tolPx * m));
}
// The input profile: how near counts as on something, and how tips are worded and placed. The input modules switch it.
const PROFILES = {
  mouse: { name: "mouse", tolPx: 14, tolMax: 10, edge: 2.4, handle: 2.5, tipAbove: false, share: false,
    place: "drag its walls or slide it · click beside it for floors", height: "move up or down · click to build · Esc to cancel", bend: "move to bend · click when happy" },
  touch: { name: "touch", tolPx: 30, tolMax: 16, edge: 3.6, handle: 4, tipAbove: true, share: true,
    place: "drag its walls or slide it · tap beside it for floors", height: "drag up or down · tap to build", bend: "drag to bend · tap when happy" },
};
let prof = PROFILES.mouse;
export function setInput(kind) { prof = PROFILES[kind]; }
const EDGE = () => prof.edge;                     // how near a roof or hole edge counts as grabbing it
const along = (l, p) => V.add(l.a, V.mul(l.u, V.dot(V.sub(p, l.a), l.u)));      // p dropped onto the guide line
function meet(l1, l2) { const c = l1.u[0] * l2.u[1] - l1.u[1] * l2.u[0]; if (Math.abs(c) < 0.1) return null; const d = V.sub(l2.a, l1.a), t = (d[0] * l2.u[1] - d[1] * l2.u[0]) / c; return V.add(l1.a, V.mul(l1.u, t)); }
function snapPoint(p, y, except = null) {          // a start point or ring centre: -> { p, guides: [{ kind, a, b, why }] }
  if (mouse.alt) return { p, guides: [] };
  const tol = tolAt(p, y), F = features(except);
  let best = null; for (const f of F.pts) { const d = V.dist(f.p, p); if (d < tol && (!best || d < best.d)) best = { d, f }; }
  if (best) return { p: best.f.p, guides: [{ kind: "pt", a: best.f.p, why: best.f.why }] };
  const near = F.lines.map((l) => ({ l, d: V.dist(along(l, p), p) })).filter((x) => x.d < tol).sort((a, b) => a.d - b.d);
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
    const q = meet(near[i].l, near[j].l); if (q && V.dist(q, p) < tol * 1.5) return { p: q, guides: [line(near[i].l, q), line(near[j].l, q)] };
  }
  if (near.length) {
    const l = near[0].l; let q = along(l, p);
    if (grid.on) { const g = gridSnap(q); if (V.dist(along(l, g), g) < 0.05) q = g; else { const t = Math.round(V.dot(V.sub(q, l.a), l.u) / W) * W; q = V.add(l.a, V.mul(l.u, t)); } }   // and in whole panels along it
    return { p: q, guides: [line(l, q)] };
  }
  return { p: gridSnap(p), guides: [] };
}
function line(l, q) { return { kind: "line", a: along(l, l.a), b: q, l, why: l.why }; }
// direction from a toward cur: square to the grid, or parallel / square to a block nearby; else 15 degree steps
function dirSnap(a, cur) {
  const d = V.sub(cur, a), L = V.len(d), ang = Math.atan2(d[1], d[0]);
  if (mouse.alt) return { ang, why: "" };
  const F = features(), tol = tolAt(cur, draft ? draft.y : 0), cands = [];
  if (grid.on) for (let k = 0; k < 4; k++) cands.push({ t: grid.ang + (k * Math.PI) / 2, why: "" });
  for (const u of F.dirs) { const t = Math.atan2(u[1], u[0]); for (let k = 0; k < 4; k++) cands.push({ t: t + (k * Math.PI) / 2, why: k % 2 ? "square" : "parallel" }); }
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x)), lim = Math.min(0.12, Math.atan(tol / Math.max(L, 1)) * 1.2);
  let best = null; for (const c of cands) { const e = Math.abs(wrap(c.t - ang)); if (e < lim && (!best || e < best.e - 1e-4 || (Math.abs(e - best.e) < 1e-4 && !c.why))) best = { e, c }; }
  if (best) return { ang: best.c.t, why: best.c.why };
  const base = grid.on ? grid.ang : 0; return { ang: base + Math.round((ang - base) / (Math.PI / 12)) * (Math.PI / 12), why: "" };
}
// length along u from a, near L: up to a guide the line crosses, else whole panels (at least two)
function lenSnap(a, u, L, tol) {
  if (mouse.alt) return { L: Math.max(L, 2 * W), g: null };
  const F = features(); let best = null;
  for (const l of F.lines) { const q = meet({ a, u }, l); if (!q) continue; const t = V.dot(V.sub(q, a), u); if (t > 2 * W - 0.01 && Math.abs(t - L) < tol && (!best || Math.abs(t - L) < Math.abs(best.t - L))) best = { t, g: line(l, q) }; }
  for (const f of F.pts) { const t = V.dot(V.sub(f.p, a), u); if (t > 2 * W - 0.01 && Math.abs(t - L) < tol && V.dist(V.add(a, V.mul(u, t)), f.p) < 0.05) best = { t, g: { kind: "pt", a: f.p, why: f.why } }; }
  return best ? { L: best.t, g: best.g } : { L: Math.max(2, Math.round(L / W)) * W, g: null };
}
function straight(a, cur) {                       // a centre line from a toward cur (the curve tool's chord) -> { pts, guides }
  const L = V.dist(cur, a); if (L < 0.01) return null;
  const ds = dirSnap(a, cur), u = [Math.cos(ds.ang), Math.sin(ds.ang)], ls = lenSnap(a, u, L, tolAt(cur, draft ? draft.y : 0)), b = V.add(a, V.mul(u, ls.L));
  return { pts: [a, b], guides: [ls.g, ds.why ? { kind: "dir", a, b, why: ds.why } : null].filter(Boolean) };
}
// The Block tool lays a block from one corner. Drag along its first wall: once the drag is two panels long its
// direction locks (snapped as above). Then the distance along that direction is the length, and swinging out
// sideways widens it (12 m at least; wider in whole end-wall panels). With no swing the block lies on the far side of
// the line from the viewer, so the line drawn is the wall facing you. Coming back near the start unlocks it again.
function rectUpdate(cur) {
  const a = draft.a, a0 = draft.a0 || a, v = V.sub(cur, a), dl = V.dist(cur, a0), lockR = Math.max(3 * W, tolAt(a, draft.y) * 2);
  if (draft.u && dl < lockR * 0.6) draft.u = null;
  if (!draft.u) {                                 // the direction is read from where the press really was, not the snapped corner
    if (dl < lockR) { draft.pts = null; draft.guides = []; return; }
    const ds = dirSnap(a0, cur); draft.u = [Math.cos(ds.ang), Math.sin(ds.ang)]; draft.dirWhy = ds.why;
    const cam = [camera.position.x, camera.position.z]; draft.side = V.dot(V.sub(cam, a), V.left(draft.u)) > 0 ? -1 : 1;
  }
  const u = draft.u, lf = V.left(u), t = V.dot(v, u), perp = V.dot(v, lf), tol = tolAt(cur, draft.y);
  if (Math.abs(perp) > 4 && Math.sign(perp) !== draft.side) draft.side = Math.sign(perp);
  const dir = t >= 0 ? u : V.mul(u, -1), ls = lenSnap(a, dir, Math.abs(t), tol), off = perp * draft.side;
  let Dw = Math.max(12, off), wg = null;
  if (!mouse.alt) {
    Dw = grid.on ? Math.round(Dw / kit.E4) * kit.E4 : Math.round(Dw);
    for (const l of features().lines) {           // or so that the far wall meets a guide
      if (Math.abs(l.u[0] * u[1] - l.u[1] * u[0]) > 0.03) continue;
      const g = V.dot(V.sub(l.a, a), lf) * draft.side; if (g >= MIN_D && Math.abs(g - off) < tol && Math.abs(g - off) < Math.abs(Dw - off) && (!wg || Math.abs(g - off) < Math.abs(wg.g - off))) wg = { g, l };
    }
    if (wg) Dw = wg.g;
  }
  Dw = Math.min(90, Dw);
  const sh = V.mul(lf, (draft.side * Dw) / 2), end = V.add(a, V.mul(dir, ls.L));
  draft.pts = [V.add(a, sh), V.add(end, sh)]; draft.D = Dw;
  draft.guides = [ls.g, wg ? line(wg.l, V.add(V.lerp(a, end, 0.5), V.mul(lf, draft.side * Dw))) : null, draft.dirWhy ? { kind: "dir", a, b: end, why: draft.dirWhy } : null].filter(Boolean);
}
function arc(a, c, m) {                           // the circle arc from a to c through m (straight if m is near the chord)
  const ax = a[0], az = a[1], bx = m[0], bz = m[1], cx = c[0], cz = c[1], d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  const chord = V.dist(a, c), sag = Math.abs(V.dot(V.sub(m, a), V.left(V.norm(V.sub(c, a)))));
  if (Math.abs(d) < 1e-6 || sag < 1.5) return [a, c];
  const ux = ((ax * ax + az * az) * (bz - cz) + (bx * bx + bz * bz) * (cz - az) + (cx * cx + cz * cz) * (az - bz)) / d;
  const uz = ((ax * ax + az * az) * (cx - bx) + (bx * bx + bz * bz) * (ax - cx) + (cx * cx + cz * cz) * (bx - ax)) / d;
  const R = Math.hypot(ax - ux, az - uz), A0 = Math.atan2(az - uz, ax - ux), A1 = Math.atan2(cz - uz, cx - ux), Am = Math.atan2(bz - uz, bx - ux);
  const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(A1 - A0); if (norm(Am - A0) > sweep) sweep -= 2 * Math.PI;      // go the way that passes through m
  const n = Math.max(6, Math.ceil((Math.abs(sweep) * R) / 1.2)), out = [];
  for (let i = 0; i <= n; i++) { const t = A0 + (sweep * i) / n; out.push([ux + R * Math.cos(t), uz + R * Math.sin(t)]); }
  return chord > 1 ? out : [a, c];
}
function ring(c, r) { const n = Math.max(48, Math.round((2 * Math.PI * r) / 1.2)), out = []; for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); } return out; }
// how far a step back goes. Grid on: ends in whole panels of the block below (so on a straight block the panels of the
// tier above stand right over the ones below), walls in whole end-wall panels (3 m); or so that the moved end or wall
// meets a guide. Grid off: half metres. Alt: free.
function terraceSnap(b, raw) {
  draft.guides = [];
  if (mouse.alt) return Math.round(raw * 10) / 10;
  if (!grid.on) return Math.round(raw * 2) / 2;
  const mode = draft.mode, L = pathLen(b.pts, b.closed), m = b.closed ? W : L / Math.max(1, Math.round(L / W));
  let v = mode === "side" ? Math.round(raw / kit.E4) * kit.E4 : Math.round(raw / m) * m;
  if (b.closed) return v;
  const tol = tolAt(draft.grab, draft.y), lay = cache.get(b.id).lay; let best = null;
  const consider = (t, g) => { if (mode !== "side" && Math.abs(t / m - Math.round(t / m)) > 0.02) return;   // an end only stops on a panel joint below
    if (Math.abs(t) > 0.05 && Math.abs(t - raw) < tol && Math.abs(t - raw) < Math.abs(v - raw) && (!best || Math.abs(t - raw) < Math.abs(best.t - raw))) best = { t, g }; };
  if (mode === "side") {                          // the wall moving in meets a parallel guide line
    const F = draft.k > 0 ? lay.Lp : lay.Rp, w0 = F[0], wu = V.norm(V.sub(F[F.length - 1], F[0]));
    for (const l of features().lines) { if (Math.abs(l.u[0] * wu[1] - l.u[1] * wu[0]) > 0.03) continue; const t = V.dot(V.sub(l.a, w0), draft.n); consider(t, line(l, along(l, draft.grab))); }
  } else if (b.pts.length === 2) {                // a straight block: the moving end (or either end, for a corner) meets a guide
    const ends = [[b.pts[0], V.norm(V.sub(b.pts[1], b.pts[0]))], [b.pts[1], V.norm(V.sub(b.pts[0], b.pts[1]))]];
    for (const l of features().lines) for (const [ei, [e, u]] of ends.entries()) {
      if (mode === "end" && ei !== draft.k) continue;
      const q = meet({ a: e, u }, l); if (q) consider(V.dot(V.sub(q, e), u), line(l, q));
    }
  }
  if (best) { v = best.t; draft.guides = [best.g]; }
  return v;
}
function edgeAt(b, p) {                           // is p near the roof edge of b? -> { n: direction into the block, mode, k }
  const c = cache.get(b.id); if (!c) return null; const { Lp, Rp } = c.lay;
  const dL = nearestOnPath(Lp, b.closed, p).d, dR = nearestOnPath(Rp, b.closed, p).d;
  let d = Math.min(dL, dR);
  if (!b.closed) { const n = Lp.length; d = Math.min(d, nearestOnPath([Lp[0], Rp[0]], false, p).d, nearestOnPath([Lp[n - 1], Rp[n - 1]], false, p).d); }
  if (d > EDGE()) return null;
  const nc = nearestOnPath(b.pts, b.closed, p);
  if (b.closed) { const n = b.pts.length, seg = V.norm(V.sub(b.pts[(nc.i + 1) % n], b.pts[nc.i])); return { n: V.mul(V.left(seg), inSign(b)), mode: "ring" }; }
  const n = b.pts.length, u0 = V.norm(V.sub(b.pts[1], b.pts[0])), u1 = V.norm(V.sub(b.pts[n - 2], b.pts[n - 1]));
  const e0 = V.dot(V.sub(p, b.pts[0]), u0), e1 = V.dot(V.sub(p, b.pts[n - 1]), u1), side = nc.d > (b.D || 12) / 2 - 2.4 && nc.d > 0.01, us = side ? V.norm(V.sub(nc.q, p)) : null;
  if (e0 < EDGE() || e1 < EDGE()) { const k = e0 < EDGE() ? 0 : 1, ue = k ? u1 : u0; return side ? { n: V.mul(V.add(ue, us), 0.5), mode: "corner" } : { n: ue, mode: "end", k }; }
  return us ? { n: us, mode: "side", k: dL < dR ? 1 : -1 } : null;
}
const randFin = () => { const r = Math.random(); return r < 0.4 ? "concrete" : kit.FIN[1 + Math.floor(Math.random() * (kit.FIN.length - 1))]; };

const ui = { roadW: 7, line: false, carve: "out", width: 12, tool: "line", fin: "random", trees: "birches", treeR: 9, groundKind: "asphalt", groundR: 3 };
let draft = null;                                  // the block being laid: { stage, kind, a, y, parent, pts, closed, fl, fin, seed, ... }
let action = null;                                 // a press-and-drag in another tool: floors, paint, trees, ground
let hover = null;

const isBuild = (t) => t === "line" || t === "curve" || t === "ring";
function newDraft(kind, at) { return { kind, stage: "base", a: at.p, y: at.y, parent: at.block ? at.block.id : null, pts: null, closed: kind === "ring", D: ui.width, fl: 1, fin: ui.fin === "random" ? randFin() : ui.fin, seed: (Math.random() * 2 ** 31) | 0 }; }
function draftBlock() { return draft && draft.pts && draft.pts.length >= 2 ? { id: -1, pts: draft.pts, closed: draft.closed, D: draft.D, fl: draft.fl, fin: draft.fin, seed: draft.seed, parent: draft.parent, ...(draft.at ? { at: draft.at } : {}) } : null; }
let previewMesh = null;
function showPreview() {
  if (previewMesh) { previewRoot.remove(previewMesh); kit.disposeGroup(previewMesh); previewMesh = null; }
  const b = draftBlock(); if (!b) return;
  const lay = kit.layout(b, draft.y); previewMesh = new THREE.Group();
  previewMesh.add(kit.buildMeshes([lay]), kit.roofMesh(lay), kit.overlay(lay, draft.stage === "height" ? OV.floors : OV.build, 0.7));
  previewRoot.add(previewMesh);
}
function startHeight() {                           // floors follow the mouse: one floor per this many pixels up
  const p = draft.stage === "base" && draft.kind === "ring" ? draft.pts[0] : draft.pts[draft.pts.length - 1];
  const s0 = screenOf(p[0], draft.y, p[1]), s1 = screenOf(p[0], draft.y + H, p[1]);
  draft.stage = "height"; draft.my0 = mouse.y; draft.ppf = Math.min(40, Math.max(12, Math.abs(s0[1] - s1[1]))); draft.fl0 = draft.fl;
}
function commitDraft() {
  const b = draftBlock(); if (!b) { draft = null; showPreview(); return; }
  const before = snapshot(); b.id = S.nextId++; S.blocks.push(b); draft = null; showPreview(); rebuild(); pushUndo(before); lastFloors = b.fl;
}
let lastFloors = 5;
function cancel() { if (action && action.kind === "pull") applyState(action.before); draft = null; action = null; sel = null; showPreview(); }

function updateDraft() {
  if (!draft) return;
  const cur = onPlane(draft.y); if (!cur && draft.stage !== "height") return;
  if (draft.stage === "base") {
    if (draft.kind === "ring") { let r = V.dist(cur, draft.a); r = mouse.alt ? r : Math.round(r / GRID) * GRID; draft.guides = draft.g0 || []; draft.r = Math.max(10, draft.D / 2 + 4, r); draft.pts = ring(draft.a, draft.r); draft.moved = V.dist(cur, draft.a) > 2; }
    else if (draft.kind === "terrace") { const pb = byId.get(draft.parent), t = terracePts(pb, terraceSnap(pb, V.dot(V.sub(cur, draft.grab), draft.n)), draft.mode, draft.k); draft.pts = t.pts; draft.inset = t.inset; draft.D = t.D; draft.moved = true; }
    else if (draft.kind === "line") { rectUpdate(cur); draft.moved = !!draft.pts; }
    else { const r = straight(draft.a, cur); draft.pts = r && r.pts; draft.guides = r ? r.guides : []; draft.moved = V.dist(cur, draft.a) > 1.5; }
  } else if (draft.stage === "place") {
    if (draft.drag) { if (Math.hypot(mouse.x - draft.drag.mx, mouse.y - draft.drag.my) > 4) draft.drag.moved = true; if (draft.drag.moved) placeDrag(); }
    else { const p = onPlane(draft.y); draft.hov = p ? placeHandle(p) : null; }
  } else if (draft.stage === "bend") {
    draft.pts = arc(draft.ends[0], draft.ends[1], mouse.alt ? cur : snap(cur));
  } else if (draft.stage === "height") {
    draft.fl = Math.max(1, Math.min(200, draft.fl0 + Math.round((draft.my0 - mouse.y) / draft.ppf)));
  }
  showPreview();
}

// ---- a step back, before its floors: still editable. Its footprint is kept in the frame of the block below:
// s along it (0 .. L from its first point), w across it (+ toward its left wall). Drag a wall to move just that wall,
// drag the middle to slide the whole tier; both snap to centred, flush with the roof's edges, or whole panels (3 m
// steps across). A click without dragging goes on to the floors. Only for a straight block below.
function placeFrame(pb) { const c0 = pb.pts[0], u = V.norm(V.sub(pb.pts[1], pb.pts[0])); return { c0, u, lf: V.left(u), L: pathLen(pb.pts, false), D: pb.D || 12 }; }
// A tier in a hole: it starts as the hole's whole floor and the edge grabbed is already being dragged; it snaps flush
// with the hole's edges and centred in it.
function startHoleTier(at, r, h) {
  const b = at.block; draft = newDraft("terrace", at); draft.parent = null; draft.at = { id: b.id, f: at.floor }; draft.frame = b.id;
  draft.fin = ui.fin === "random" ? b.fin : ui.fin; draft.closed = false;
  const F = placeFrame(b); draft.F = F; draft.box = { s0: r.s0, s1: r.s1, w0: r.w0, w1: r.w1 }; draft.bounds = { ...draft.box };
  draft.stage = "place"; draft.why = ""; placeApply();
  const [s, w] = placeLocal(at.p); draft.drag = { h, s, w, box0: { ...draft.box }, mx: mouse.x, my: mouse.y, moved: false };
  showPreview();
}
function startPlace() {
  const pb = byId.get(draft.parent), F = placeFrame(pb), d = draft.pts, mid = V.dot(V.sub(d[0], F.c0), F.lf);
  draft.F = F; draft.box = { s0: V.dot(V.sub(d[0], F.c0), F.u), s1: V.dot(V.sub(d[d.length - 1], F.c0), F.u), w0: mid - draft.D / 2, w1: mid + draft.D / 2 };
  draft.stage = "place"; draft.fl = Math.max(1, draft.fl); draft.why = ""; placeApply();
}
function placeApply() { const { F, box } = draft, m = (box.w0 + box.w1) / 2, o = V.add(F.c0, V.mul(F.lf, m)); draft.pts = [V.add(o, V.mul(F.u, box.s0)), V.add(o, V.mul(F.u, box.s1))]; draft.D = box.w1 - box.w0; }
function placeLocal(p) { const F = draft.F, d = V.sub(p, F.c0); return [V.dot(d, F.u), V.dot(d, F.lf)]; }
function placeHandle(p) {                          // which part of the tier is under p: "s0" "s1" "w0" "w1" (walls), "move", or null
  const [s, w] = placeLocal(p), b = draft.box, t = Math.min(prof.handle, tolAt(p, draft.y));
  const inS = s > b.s0 - t && s < b.s1 + t, inW = w > b.w0 - t && w < b.w1 + t; if (!inS || !inW) return null;
  const c = [["s0", Math.abs(s - b.s0)], ["s1", Math.abs(s - b.s1)], ["w0", Math.abs(w - b.w0)], ["w1", Math.abs(w - b.w1)]].filter((x) => x[1] < t).sort((a, b2) => a[1] - b2[1]);
  return c.length ? c[0][0] : "move";
}
function snapCoord(v, cands, step, tol) {          // v snapped to the nearest named candidate within tol, else to whole steps
  if (mouse.alt) return { v, why: "" };
  let best = null; for (const [c, why] of cands) if (Math.abs(c - v) < tol && (!best || Math.abs(c - v) < Math.abs(best[0] - v))) best = [c, why];
  return best ? { v: best[0], why: best[1] } : { v: Math.round(v / step) * step, why: "" };
}
function placeDrag() {
  const p = onPlane(draft.y); if (!p) return; const g = draft.drag, [s, w] = placeLocal(p), ds = s - g.s, dw = w - g.w, b0 = g.box0, F = draft.F, tol = tolAt(p, draft.y);
  const m = F.L / Math.max(1, Math.round(F.L / W)), b = { ...b0 }, whys = [], B = draft.bounds || { s0: 0, s1: F.L, w0: -F.D / 2, w1: F.D / 2 };
  const S = (v, c, st) => { const r = snapCoord(v, c, st, tol); if (r.why) whys.push(r.why); return r.v; };
  const J = (cs) => cs.filter(([c]) => Math.abs(c / m - Math.round(c / m)) < 0.02);   // along: only spots on a panel joint below (else the panels would not line up)
  // across, wall positions go in whole end-wall panels counted from the right wall below (so widths stay whole panels)
  const wq = (v) => -F.D / 2 + Math.round((v + F.D / 2) / (kit.E4 / 2)) * (kit.E4 / 2);
  if (g.h === "s0") b.s0 = Math.min(S(b0.s0 + ds, J([[B.s0, "flush"], [B.s0 + B.s1 - b0.s1, "centred"]]), m), b0.s1 - W);
  else if (g.h === "s1") b.s1 = Math.max(S(b0.s1 + ds, J([[B.s1, "flush"], [B.s0 + B.s1 - b0.s0, "centred"]]), m), b0.s0 + W);
  else if (g.h === "w0") b.w0 = Math.min(S(b0.w0 + dw, [[B.w0, "flush"], [B.w0 + B.w1 - b0.w1, "centred"]], kit.E4 / 2), b0.w1 - kit.E4);
  else if (g.h === "w1") b.w1 = Math.max(S(b0.w1 + dw, [[B.w1, "flush"], [B.w0 + B.w1 - b0.w0, "centred"]], kit.E4 / 2), b0.w0 + kit.E4);
  else {                                           // slide
    const len = b0.s1 - b0.s0, wid = b0.w1 - b0.w0;
    const ns = S(b0.s0 + ds, J([[B.s0, "flush"], [B.s1 - len, "flush"], [(B.s0 + B.s1 - len) / 2, "centred"]]), m), nw = S(b0.w0 + dw, [[B.w0, "flush"], [B.w1 - wid, "flush"], [(B.w0 + B.w1 - wid) / 2, "centred"]], kit.E4 / 2);
    b.s0 = ns; b.s1 = ns + len; b.w0 = nw; b.w1 = nw + wid;
  }
  if (!mouse.alt && (g.h === "w0" || g.h === "w1") && !whys.length) { b.w0 = g.h === "w0" ? wq(b.w0) : b.w0; b.w1 = g.h === "w1" ? wq(b.w1) : b.w1; }
  draft.box = b; draft.why = [...new Set(whys)].join(" · "); placeApply();
}
function placeOverlay(h) {                         // a blue face on the wall about to move (or on the whole top, for a slide)
  const { F, box } = draft, y0 = draft.y, y1 = draft.y + draft.fl * H, P = (s, w) => V.add(V.add(F.c0, V.mul(F.u, s)), V.mul(F.lf, w));
  const q = { s0: [P(box.s0, box.w0), P(box.s0, box.w1)], s1: [P(box.s1, box.w0), P(box.s1, box.w1)], w0: [P(box.s0, box.w0), P(box.s1, box.w0)], w1: [P(box.s0, box.w1), P(box.s1, box.w1)] }[h];
  const pos = q ? [q[0][0], y0, q[0][1], q[1][0], y0, q[1][1], q[1][0], y1 + 0.05, q[1][1], q[0][0], y1 + 0.05, q[0][1]]
    : [P(box.s0, box.w0), P(box.s1, box.w0), P(box.s1, box.w1), P(box.s0, box.w1)].flatMap((r) => [r[0], y1 + 0.3, r[1]]);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return new THREE.Mesh(g, OV.edge);
}

const onPath = (q) => detailPaths.some((pt) => { const d = V.sub(pt.b, pt.a), L2 = V.dot(d, d) || 1, t = Math.max(0, Math.min(1, V.dot(V.sub(q, pt.a), d) / L2)); return V.dist(q, V.add(pt.a, V.mul(d, t))) < PATH_W / 2 + 1; });
// tree brush: scatter trees in the circle, keeping them apart and off the buildings' footprints
const insideBlock = (b, p, margin) => nearestOnPath(b.pts, b.closed, p).d <= (b.D || 12) / 2 + margin;   // (open ends count as rounded: close enough)
function plantAt(at) {
  const r = ui.treeR, set = TREE_SETS[ui.trees], gap = ui.trees === "bushes" ? 2.2 : 3.6;
  if (mouse.shift) { const n0 = S.trees.length; S.trees = S.trees.filter((t) => (t.x - at.p[0]) ** 2 + (t.z - at.p[1]) ** 2 > r * r); return S.trees.length !== n0; }
  const onRoof = at.block && at.roof ? at.block : null; if (at.block && !at.roof) return false;
  const near = S.trees.filter((t) => Math.abs(t.x - at.p[0]) < r + gap && Math.abs(t.z - at.p[1]) < r + gap && (t.b || null) === (onRoof ? onRoof.id : null) && (t.f ?? null) === (at.floor ?? null));
  const hole = onRoof && at.floor != null ? holeAt(onRoof, at.p, at.floor) : null; if (onRoof && at.floor != null && !hole) return false;
  const inHole = (q) => { const u = V.norm(V.sub(onRoof.pts[1], onRoof.pts[0])), d = V.sub(q, onRoof.pts[0]), s = V.dot(d, u), w = V.dot(d, V.left(u)); return s > hole.s0 + 1.2 && s < hole.s1 - 1.2 && w > hole.w0 + 1.2 && w < hole.w1 - 1.2; };
  const grounded = S.blocks.filter(isGround); let added = false;
  for (let k = 0, tries = Math.ceil((r * r) / 25); k < tries; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r, q = [at.p[0] + Math.cos(a) * d, at.p[1] + Math.sin(a) * d];
    if (near.some((t) => (t.x - q[0]) ** 2 + (t.z - q[1]) ** 2 < gap * gap * (0.6 + 0.8 * Math.random()))) continue;
    if (hole) { if (!inHole(q)) continue; }
    else if (onRoof) { if (!insideBlock(onRoof, q, -1.2)) continue; }
    else if (grounded.some((b) => insideBlock(b, q, 2)) || roadAt(q, allRoads, 1) >= 0 || onPath(q)) continue;
    const name = set[Math.floor(Math.random() * set.length)], t = { x: q[0], z: q[1], n: TREE_NAMES.indexOf(name), v: Math.floor(Math.random() * 6), rot: Math.random() * 6.283, sc: 0.75 + Math.random() * 0.45, b: onRoof ? onRoof.id : null, ...(hole ? { f: at.floor } : {}) };
    S.trees.push(t); near.push(t); added = true;
  }
  return added;
}
let paintBox = null, splatBefore = null;
function groundDab(p) { const b = ground.dab(p[0], p[1], ui.groundR, ui.groundKind); paintBox = paintBox ? [Math.min(paintBox[0], b[0]), Math.min(paintBox[1], b[1]), Math.max(paintBox[2], b[2]), Math.max(paintBox[3], b[3])] : b; }


// a second finger came after the tool had started: undo what the first one began
function abortPress() { abortInner(); if (streetsHeld) holdStreets(false); }
function abortInner() {
  if (draft && draft.stage === "base") { draft = null; showPreview(); }
  else if (draft && draft.stage === "place" && draft.drag) { draft.box = draft.drag.box0; draft.drag = null; placeApply(); showPreview(); }
  else if (action) {
    const a = action; action = null;
    if (a.kind === "ground" && splatBefore) { const pt = ground.patch(splatBefore, [0, 0, ground.RES, ground.RES]); if (pt) ground.put(pt, "before"); splatBefore = null; }
    else if (a.kind === "select") sel = null;
    else if (a.before) applyState(a.before);
  }
  showGuides([]); showHover();
}

function press() {
  const t = ui.tool;
  if (isBuild(t)) {
    if (draft && draft.stage === "bend") { startHeight(); updateDraft(); return; }
    if (draft && draft.stage === "place") { const p = onPlane(draft.y), h = p && placeHandle(p);
      if (!h) { startHeight(); updateDraft(); return; }
      const [s, w] = placeLocal(p); draft.drag = { h, s, w, box0: { ...draft.box }, mx: mouse.x, my: mouse.y, moved: false }; return; }
    if (draft && draft.stage === "height") { commitDraft(); return; }
    const at = pick(); if (!at) return;
    if (at.block && !at.roof) { const w = wallAt(at); if (w) startPush(at, w); return; }
    const edge = at.block && at.roof && at.floor == null ? edgeAt(at.block, at.p) : null;
    if (edge) { draft = newDraft("terrace", at); draft.grab = at.p; draft.n = edge.n; draft.mode = edge.mode; draft.k = edge.k; draft.D = at.block.D || 12; draft.closed = at.block.closed; draft.fin = ui.fin === "random" ? at.block.fin : ui.fin; updateDraft(); return; }
    if (at.floor != null) { const r = holeAt(at.block, at.p, at.floor), h = r && holeEdgeAt(at.block, at.p, r); if (h) { startHoleTier(at, r, h); return; } }
    const sp = snapPoint(at.p, at.y); draft = newDraft(t === "curve" ? "curve" : t === "ring" ? "ring" : "line", { ...at, p: sp.p }); draft.g0 = sp.guides; draft.a0 = at.p;
    if (at.floor != null) { draft.at = { id: at.block.id, f: at.floor }; draft.parent = null; }
    return;
  }
  if (t === "carve") {
    const at = pick(), c = cellAt(at);
    if (inSel(c)) beginPull(sel);
    else if (c) { sel = { b: c.b, wall: c.wall, k0: c.k, k1: c.k, f0: c.f, f1: c.f }; action = { kind: "select" }; }
    else sel = null;
    showHover(); return;
  }
  if (t === "road") { roadPress(); return; }
  if (t === "yard") { yardPress(); return; }
  if ((t === "ground" || t === "trees") && ui.line && !mouse.shift) { const g = onPlane(0); if (g) action = { kind: t === "ground" ? "groundLine" : "treeLine", a: g, b: g }; return; }
  if (t === "ground") { const g = onPlane(0); if (g) { splatBefore = ground.grabAll(); paintBox = null; action = { kind: "ground", last: g }; groundDab(g); } return; }   // paths go under buildings too
  const at = pick(); if (!at) return;
  if (t === "floors" && at.block && wallAt(at)) startPush(at, wallAt(at));
  else if (t === "floors" && at.block) { action = { kind: "floors", b: at.block, before: snapshot(), fl0: at.block.fl, my0: mouse.y, ppf: Math.min(40, Math.max(12, Math.abs(screenOf(at.p[0], at.y, at.p[1])[1] - screenOf(at.p[0], at.y + H, at.p[1])[1]))) }; }
  else if (t === "paint") { action = { kind: "paint", before: snapshot(), changed: false }; paintHover(at); }
  else if (t === "erase" && !at.block) {
    const i = roadAt(at.p, S.roads), yd = yardRegions.find((r) => r.Y.at(at.p)), before = snapshot();
    if (i >= 0) { S.roads.splice(i, 1); rebuild(); pushUndo(before); showHover(); }
    else if (yd) { S.yards = S.yards.filter((y) => y !== yd.y); rebuild(); pushUndo(before); showHover(); }
  }
  else if (t === "erase" && at.block) {
    const before = snapshot(), gone = subtree(at.block.id);
    S.blocks = S.blocks.filter((b) => !gone.has(b.id)); S.trees = S.trees.filter((tr) => !tr.b || !gone.has(tr.b)); hover = null; rebuild(); pushUndo(before); showHover();
  }
  else if (t === "trees") { action = { kind: "trees", before: snapshot(), changed: false, last: 0 }; if (plantAt(at)) { action.changed = true; trees.rebuild(S.trees, treeY); } }
}
function release() { releaseInner(); if (streetsHeld) holdStreets(false); }      // (the street layer, held during the drag, is made now)
function releaseInner() {
  if (draft && draft.stage === "place" && draft.drag) {          // a click on the tier without dragging also goes on to floors
    const g = draft.drag; draft.drag = null; if (!g.moved) { startHeight(); updateDraft(); } showHover(); return;
  }
  if (draft && draft.stage === "base") {
    if (!draft.moved || !draft.pts) { draft = null; showPreview(); return; }
    if (draft.kind === "terrace") { const pb = byId.get(draft.parent); if (pb && !pb.closed && pb.pts.length === 2) { startPlace(); showPreview(); showHover(); return; } }
    if (draft.kind === "curve") { draft.stage = "bend"; draft.ends = [draft.pts[0], draft.pts[draft.pts.length - 1]]; updateDraft(); return; }
    startHeight(); updateDraft(); return;
  }
  if (!action) return;
  const a = action; action = null;
  if (a.kind === "floors") { if (a.b.fl !== a.fl0) pushUndo(a.before); }
  else if (a.kind === "pull") { if (a.d) { if (a.tmpBlock) S.nextId++; pushUndo(a.before); sel = null; } }
  else if (a.kind === "width" || a.kind === "length") { if (snapshot() !== a.before) pushUndo(a.before); showGuides([]); }
  else if (a.kind === "paint" || a.kind === "trees") { if (a.changed) pushUndo(a.before); }
  else if (a.kind === "road") { showRoadGhost(null); showGuides([]); if (a.b) addRoad(a.a, a.b); }
  else if (a.kind === "roadEnd") { showGuides([]); if (snapshot() !== a.before) pushUndo(a.before); }
  else if (a.kind === "groundLine") {                // paint along the line, as one stroke
    if (V.dist(a.a, a.b) < 0.5) return; splatBefore = ground.grabAll(); paintBox = null; const d = V.dist(a.a, a.b), step = Math.max(0.3, ui.groundR / 3);
    for (let s = 0; s <= d + 1e-6; s += step) groundDab(V.lerp(a.a, a.b, s / d));
    const pt = ground.patch(splatBefore, paintBox); if (pt) { const sn = snapshot(); undoStack.push({ before: sn, after: sn, splat: pt }); redoStack.length = 0; scheduleSave(); }
    splatBefore = null; ground.sync(); trees.rebuild(S.trees, treeY); rebuildStreets(true);
  }
  else if (a.kind === "treeLine") { const before = snapshot(); if (plantLine(a.a, a.b)) { trees.rebuild(S.trees, treeY); pushUndo(before); updateStats(); } }
  else if (a.kind === "ground" && paintBox) {
    const pt = ground.patch(splatBefore, paintBox);
    if (pt) { const s = snapshot(); undoStack.push({ before: s, after: s, splat: pt }); redoStack.length = 0; scheduleSave(); }
    splatBefore = null; ground.sync(); trees.rebuild(S.trees, treeY); rebuildStreets(true);      // (water may have come or gone under the props)
  }
}
function paintHover(at) {
  if (!at || !at.block) return; const fin = ui.fin === "random" ? randFin() : ui.fin;
  if (at.block.fin === fin || (ui.fin === "random" && action.done && action.done.has(at.block.id))) return;
  (action.done ||= new Set()).add(at.block.id); at.block.fin = fin; action.changed = true; rebuild();
}
function move() {
  if (draft) { updateDraft(); showHover(); return; }
  if (action) {
    if (action.kind === "width" || action.kind === "length") resizeMove(action);
    else if (action.kind === "select" && sel) { const cw = cellOnWall(sel.b, sel.wall); if (cw) { sel.k1 = cw.k; sel.f1 = cw.f; } }
    else if (action.kind === "pull") pullMove(action);
    else if (action.kind === "floors") { const fl = Math.max(1, Math.min(200, action.fl0 + Math.round((action.my0 - mouse.y) / action.ppf))); if (fl !== action.b.fl) { action.b.fl = fl; rebuild(); } }
    else if (action.kind === "paint") paintHover(pick());
    else if (action.kind === "road") { const cur = onPlane(0); if (cur && V.dist(cur, action.a0) > 1.5) { const e = roadEnd(action.a, cur); action.b = e.p; action.why = e.why; showRoadGhost({ id: -1, pts: [action.a, e.p], w: ui.roadW }); action.guides = e.guides; } }
    else if (action.kind === "roadEnd") {
      const cur = onPlane(0), r = action.r, moving = action.ends.map((e) => e[0]);
      if (cur) { const e = roadEnd(r.pts[1 - action.k], cur, moving); if (action.ends.every(([o, j]) => V.dist(e.p, o.pts[1 - j]) > 2)) { for (const [o, j] of action.ends) o.pts[j] = e.p; action.why = e.why; action.guides = e.guides; rebuildStreets(); } }
    }
    else if (action.kind === "groundLine" || action.kind === "treeLine") { const cur = onPlane(0); if (cur) { const L = V.dist(cur, action.a); if (L > 0.5) { const ds = dirSnap(action.a, cur); action.b = V.add(action.a, V.mul([Math.cos(ds.ang), Math.sin(ds.ang)], mouse.alt ? L : Math.round(L))); } } }
    else if (action.kind === "ground") { const p = onPlane(0); if (p) { const d = V.dist(p, action.last), step = Math.max(0.3, ui.groundR / 3); for (let s = step; s <= d; s += step) groundDab(V.lerp(action.last, p, s / d)); if (d >= step) action.last = p; } }
  }
  showHover();
}

// ---------------------------------------------------------------- extrude and dig
// The Extrude tool works on the long walls of straight blocks, in whole panels and floors. Drag across a wall to choose
// cells; then drag from inside the choice: outward builds a box onto the wall (a bay, a wing, a bridge: a block of its
// own, attached to that wall at that floor), inward digs the cells out (a loggia; right through: a hole, or at the
// bottom an arch). The depth goes in half panels (1.6 m); dug as deep as the block it goes right through.
let sel = null;                                    // { b, wall, k0, k1 (panels), f0, f1 (floors) }
// (the walls as panel grids, and the boxes extruding and digging make: sandbox_town.js)
function cellAt(at) {                              // the wall panel under the cursor -> { b, wall, k, f }
  return at && at.block && !at.roof ? town.cellAt(at.block, at.p, at.y) : null;
}
const clampi = (v, a, b) => Math.max(a, Math.min(b, v));
function cellOnWall(b, wall) {                     // the cursor on that wall's plane (so a choice can run past the wall's edges)
  const F = wallFrame(b, wall); setRay();
  const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(F.N[0], 0, F.N[1]), new THREE.Vector3(F.o[0], 0, F.o[1]));
  const hit = ray.ray.intersectPlane(pl, new THREE.Vector3()); if (!hit) return null;
  return { k: clampi(Math.floor(V.dot(V.sub([hit.x, hit.z], F.o), F.ax) / F.m), 0, F.n - 1), f: clampi(Math.floor((hit.y - F.y0) / H), 0, F.fl - 1) };
}
const inSel = (c) => !!(sel && c && c.b === sel.b && sameWall(c.wall, sel.wall) && c.k >= Math.min(sel.k0, sel.k1) && c.k <= Math.max(sel.k0, sel.k1) && c.f >= Math.min(sel.f0, sel.f1) && c.f <= Math.max(sel.f0, sel.f1));
function alongRay(P, N) {                          // where the cursor's ray passes closest to the line P + t N -> t
  setRay(); const O = ray.ray.origin, Dd = ray.ray.direction, w0 = P.clone().sub(O), b = N.dot(Dd), d = N.dot(w0), e = Dd.dot(w0), den = 1 - b * b;
  return den < 1e-4 ? null : (b * e - d) / den;
}
function pullMove(a) {
  const t = alongRay(a.P, a.N); if (t == null) return; const F = wallFrame(a.b, a.sel.wall), d = town.pullDepth(t - a.t0, ui.carve, F.deep, mouse.alt);
  if (d === a.d) return; a.d = d;
  if (a.tmpBlock) { S.blocks = S.blocks.filter((x) => x !== a.tmpBlock); a.tmpBlock = null; }
  if (a.tmpCut) { a.b.cuts = a.b.cuts.filter((x) => x !== a.tmpCut); if (!a.b.cuts.length) delete a.b.cuts; a.tmpCut = null; }
  if (d > 0) { a.tmpBlock = town.extrudeBlock(a.sel, d, (Math.random() * 2 ** 31) | 0); S.blocks.push(a.tmpBlock); }
  else if (d < 0) { a.tmpCut = digCut(a.sel, -d); (a.b.cuts ||= []).push(a.tmpCut); }
  rebuild();
}
function beginPull(sl) {                           // start pulling the chosen panels out (or in): the depth follows the pointer
  sel = sl; const { F, t0, t1, f0, f1 } = selBox(sl), p = V.add(F.o, V.mul(F.ax, (t0 + t1) / 2));
  const P = new THREE.Vector3(p[0], F.y0 + ((f0 + f1) / 2) * H, p[1]), N = new THREE.Vector3(F.N[0], 0, F.N[1]);
  action = { kind: "pull", b: sl.b, sel: { ...sl }, before: snapshot(), P, N, t0: alongRay(P, N) ?? 0, d: 0 };
}
function selOverlay(sl, mat) {                     // a coloured patch over the chosen cells, just off the wall
  const { F, t0, t1, f0, f1 } = selBox(sl), P = (t) => V.add(V.add(F.o, V.mul(F.ax, t)), V.mul(F.N, 0.12));
  const a = P(t0), b = P(t1), y0 = F.y0 + f0 * H, y1 = F.y0 + f1 * H, g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
  return new THREE.Mesh(g, mat);
}

// what the cursor would act on: highlight it, place the brush ring, say what a click does
let hoverMesh = [];
function showHover() {
  for (const m of hoverMesh) { overlayRoot.remove(m); m.geometry.dispose(); } hoverMesh = [];
  brushRing.visible = false; tip(""); showGuides([]); gridMesh.visible = false;
  if (!mouse.in || document.body.classList.contains("clean")) return;      // a clean view (H) shows no helpers
  const t = ui.tool;
  const whyOf = (gs) => [...new Set(gs.map((g) => g.why).filter(Boolean))].join(" · ");
  if (grid.on && isBuild(t) && !(draft && draft.stage !== "base")) {     // the grid around the cursor, at the height being built on
    const y = draft ? draft.y : 0, c = onPlane(y); if (c) { gridMesh.visible = true; gridMesh.position.y = y + 0.06; gridMat.uniforms.ctr.value.set(c[0], c[1]); gridMat.uniforms.rad.value = Math.max(60, tolAt(c, y) * 18); gridMat.uniforms.o.value.set(...grid.o); gridMat.uniforms.ang.value = grid.ang; }
  }
  if (draft) {
    if (draft.stage === "base" && draft.kind === "terrace") { showGuides(draft.guides || [], draft.y); draft.why = whyOf(draft.guides || []); }
    if (draft.stage === "base" && draft.kind !== "terrace") { const gs = [...(draft.g0 || []), ...(draft.kind === "ring" ? [] : draft.guides || [])]; showGuides(gs, draft.y, draft.a); draft.why = whyOf(gs); }
    if (draft.stage === "place") {
      const h = draft.drag ? draft.drag.h : draft.hov; if (h) { const m = placeOverlay(h); overlayRoot.add(m); hoverMesh.push(m); }
      const L = draft.box.s1 - draft.box.s0, k = L / W, size = `${Math.abs(k - Math.round(k)) < 0.02 ? Math.round(k) + " sections" : L.toFixed(1) + " m"} × ${+draft.D.toFixed(1)} m`;
      tip(`${size}${draft.why ? " · " + draft.why : ""}<small>${h === "move" ? "drag to slide it" : h ? "drag to move this wall" : prof.place}</small>`);
    }
    else if (draft.stage === "height") tip(`${draft.fl} floor${draft.fl > 1 ? "s" : ""}<small>${prof.height}</small>`);
    else if (draft.stage === "bend") tip(`bend<small>${prof.bend}</small>`);
    else if (draft.kind === "terrace") { const pb = byId.get(draft.parent), L = pb ? pathLen(pb.pts, pb.closed) : 0, m = L / Math.max(1, Math.round(L / W)), k = Math.abs(draft.inset) / m;
      const panels = pb && !pb.closed && draft.mode !== "side" && grid.on && Math.abs(k - Math.round(k)) < 0.01 && Math.round(k) ? ` · ${Math.round(k)} panel${Math.round(k) > 1 ? "s" : ""}${draft.mode === "corner" ? " each end" : ""}` : "";
      const wid = draft.mode === "side" || draft.mode === "corner" ? ` · ${+draft.D.toFixed(1)} m wide` : "";
      tip(`step ${draft.inset >= 0 ? "in" : "out"} ${Math.abs(draft.inset).toFixed(1)} m${panels}${wid}<small>${draft.why ? draft.why + " · " : ""}${pb && !pb.closed && pb.pts.length === 2 ? "release, then adjust it" : "release, then pull up floors"}</small>`); }
    else if (!draft.pts && draft.kind === "line") tip("drag along the first wall<small>then swing out sideways to make it wider</small>");
    else if (draft.pts) { const L = pathLen(draft.pts, false), n = L / W; tip((draft.kind === "ring" ? `ring ⌀ ${(draft.r * 2).toFixed(0)} m` : `${Math.abs(n - Math.round(n)) < 0.02 ? Math.round(n) + " sections" : L.toFixed(1) + " m"}${draft.kind === "line" ? ` × ${+draft.D.toFixed(1)} m` : ""}`) + `<small>${[draft.why, draft.parent ? "on the roof" : ""].filter(Boolean).join(" · ")}</small>`); }
    return;
  }
  if (t === "road") {
    if (action && action.kind === "road") { showGuides(action.guides || [], 0, action.a); tip(action.b ? `${Math.round(V.dist(action.a, action.b))} m road · ${ui.roadW} m wide<small>${action.why || "release to lay it"}</small>` : "drag to lay a road"); }
    else if (action && action.kind === "roadEnd") { showGuides(action.guides || [], 0); tip(`${Math.round(V.dist(action.r.pts[0], action.r.pts[1]))} m road<small>${action.why || "release to leave the end here"}</small>`); }
    else { const p = onPlane(0); if (p) { const tol = tolAt(p, 0); if (S.roads.some((r) => r.pts.some((e) => V.dist(e, p) < tol))) tip("drag to carry on from this end<small>Shift + drag moves the end</small>"); else { showGuides([], 0, roadStart(p)); tip(`<small>drag to lay a ${ui.roadW} m road</small>`); } } }
    return;
  }
  if (t === "yard") {
    const p = onPlane(0); if (!p) return; const hit = yardRegions.find((r) => r.Y.at(p)), add = (m) => { overlayRoot.add(m); hoverMesh.push(m); };
    for (const r of yardRegions) if (r !== hit) add(cellsMesh(r.Y, OV.paint));
    if (hit) { add(cellsMesh(hit.Y, OV.edge)); tip("rearrange this yard<small>click to shuffle what is in it · Demolish removes it</small>"); }
    else { const Y = yardAtCursor(p); if (Y && Y.count >= 25) { add(cellsMesh(Y, OV.build)); tip(`${Math.round(Y.area / 100) * 100} m² yard<small>click to lay it out: a driveway, parking, a playground, a kiosk</small>`); } else tip("<small>no yard here</small>"); }
    return;
  }
  if (action && (action.kind === "groundLine" || action.kind === "treeLine")) {
    const m = quadMesh(lineQuad(action.a, action.b, action.kind === "groundLine" ? ui.groundR : 1.5), 0.3, OV.paint); overlayRoot.add(m); hoverMesh.push(m);
    tip(`${Math.round(V.dist(action.a, action.b))} m<small>release to ${action.kind === "groundLine" ? "paint" : "plant"} along the line</small>`); return;
  }
  const at = action && action.kind === "ground" ? null : pick();
  const hl = (b, mat) => { const c = cache.get(b.id); if (!c) return; const m = kit.overlay(c.lay, mat, 0.65); overlayRoot.add(m); hoverMesh.push(m); };
  if (isBuild(t) && !action && at && at.block && at.roof && at.floor != null) {
    const r = holeAt(at.block, at.p, at.floor), h = r && holeEdgeAt(at.block, at.p, r);
    if (h) tip("step back from this edge<small>drag inward: a block on this floor of the hole, then adjust it</small>");
    else { const sp = snapPoint(at.p, at.y); showGuides(sp.guides, at.y, sp.p); tip(`build in this hole<small>${whyOf(sp.guides)}</small>`); }
  } else if (isBuild(t) && !action && at && at.block && at.roof) {
    const e = edgeAt(at.block, at.p); hl(at.block, e ? OV.edge : OV.build);
    if (e) tip({ corner: "step back all round<small>drag inward: shorter and narrower on top, like a pyramid</small>", side: "step back this wall<small>drag inward: the top is narrower on this side</small>",
      end: "step back this end<small>drag inward: the top is shorter at this end</small>", ring: "step back<small>drag inward to stack a smaller ring on top</small>" }[e.mode]);
    else { const sp = snapPoint(at.p, at.y); showGuides(sp.guides, at.y, sp.p); tip(`build on this roof<small>${whyOf(sp.guides)}</small>`); }
  } else if ((isBuild(t) || t === "floors") && (action && (action.kind === "width" || action.kind === "length") || at && at.block && !at.roof && wallAt(at))) {
    const b = action ? action.b : at.block, w = action ? { mode: action.kind, n: action.n, s: action.s, end: action.end } : wallAt(at), m = wallHL(b, w); if (m) { overlayRoot.add(m); hoverMesh.push(m); }
    if (w.mode === "width") tip(`${action && action.val ? action.val : `${+(b.D || 12).toFixed(1)} m wide`}<small>${action && action.why ? action.why + " · " : ""}drag to push or pull this wall</small>`);
    else { const L = pathLen(b.pts, false), k = L / W; tip(`${action && action.val ? action.val : Math.abs(k - Math.round(k)) < 0.02 ? Math.round(k) + " sections" : L.toFixed(1) + " m"}<small>${action && action.why ? action.why + " · " : ""}drag to push or pull this end</small>`); }
  } else if (isBuild(t) && at && !at.block) { const sp = snapPoint(at.p, 0); showGuides(sp.guides, 0, sp.p); const w = whyOf(sp.guides); if (w) tip(`<small>${w}</small>`); }
  else if (t === "floors" && (action ? action.b : at && at.block)) { const b = action ? action.b : at.block; hl(b, OV.floors); tip(`${b.fl} floors<small>drag up or down</small>`); }
  else if (t === "carve") {
    if (action && action.kind === "pull") { const F = wallFrame(action.b, action.sel.wall), d = action.d;
      tip(d > 0 ? `out ${+d.toFixed(1)} m<small>release to build it</small>` : d < 0 ? (-d >= F.deep - 0.01 ? "right through<small>release to dig it out</small>" : `in ${+(-d).toFixed(1)} m<small>release to dig it out</small>`) : (ui.carve === "out" ? "drag out to build" : "drag in to dig")); }
    else {
      const c = cellAt(at), add = (m) => { overlayRoot.add(m); hoverMesh.push(m); };
      if (sel) add(selOverlay(sel, OV.edge));
      if (c && !inSel(c) && !action) add(selOverlay({ b: c.b, wall: c.wall, k0: c.k, k1: c.k, f0: c.f, f1: c.f }, OV.build));
      if (sel) { const { t0, t1, f0, f1, F } = selBox(sel); tip(`${Math.round((t1 - t0) / F.m)} × ${f1 - f0} panels<small>${action ? "drag across the wall" : ui.carve === "out" ? "drag them out to build" : "drag them in to dig"}</small>`); }
      else if (c) tip("drag across the wall to choose panels");
      else if (at && at.block && !at.roof && (at.block.closed || at.block.pts.length !== 2)) tip("<small>only straight blocks for now</small>");
    }
  }
  else if (t === "erase" && at && !at.block && roadAt(at.p, S.roads) < 0 && yardRegions.some((r) => r.Y.at(at.p))) { const m = cellsMesh(yardRegions.find((r) => r.Y.at(at.p)).Y, OV.erase); overlayRoot.add(m); hoverMesh.push(m); tip("remove this yard"); }
  else if (t === "erase" && at && !at.block && roadAt(at.p, S.roads) >= 0) { const m = roadMesh([S.roads[roadAt(at.p, S.roads)]], S.roads, OV.erase, 0.3).children[0]; overlayRoot.add(m); hoverMesh.push(m); tip("remove this road"); }
  else if (t === "erase" && at && at.block) { for (const id of subtree(at.block.id)) hl(byId.get(id), OV.erase); }
  else if (t === "paint" && at && at.block) hl(at.block, OV.paint);
  else if (t === "trees" && at && (!at.block || at.roof)) { brushRing.visible = true; brushRing.scale.setScalar(ui.treeR); brushRing.position.set(at.p[0], at.y + 0.3, at.p[1]); brushRing.material.color.set(mouse.shift ? 0xff6a5a : 0xffffff); }
  if (t === "ground") { const p = onPlane(0); if (p) { brushRing.visible = true; brushRing.scale.setScalar(ui.groundR); brushRing.position.set(p[0], 0.3, p[1]); brushRing.material.color.set(0xffffff); } }
}

function alignGrid(at) {                           // turn the grid to the block under the cursor (or back square to the world)
  if (at && at.block) {
    const b = at.block, nc = nearestOnPath(b.pts, b.closed, at.p), n = b.pts.length, i = Math.min(nc.i, n - 2 + (b.closed ? 1 : 0));
    const u = V.norm(V.sub(b.pts[(i + 1) % n], b.pts[i])); grid.ang = Math.atan2(u[1], u[0]); grid.o = b.closed ? nc.q : b.pts[0];
    flash("Grid turned to this block");
  } else { grid.ang = 0; grid.o = [0, 0]; flash("Grid square to the world"); }
  grid.on = true; emit("options"); showHover(); scheduleSave();
}
// Push / pull: which wall of the block is under the cursor -> { mode: "width" | "length", n: outward, s: which long wall, end }
function wallAt(at) {
  const b = at.block; if (!b || at.roof) return null; const c = cache.get(b.id); if (!c) return null;
  const nc = nearestOnPath(b.pts, b.closed, at.p), out = nc.d > 0.01 ? V.norm(V.sub(at.p, nc.q)) : null;
  if (!b.closed) {
    const n = b.pts.length, u0 = V.norm(V.sub(b.pts[1], b.pts[0])), u1 = V.norm(V.sub(b.pts[n - 2], b.pts[n - 1]));
    if (V.dot(V.sub(at.p, b.pts[0]), u0) < 0.4) return { mode: "length", n: V.mul(u0, -1), end: 0 };
    if (V.dot(V.sub(at.p, b.pts[n - 1]), u1) < 0.4) return { mode: "length", n: V.mul(u1, -1), end: 1 };
  }
  const s = nearestOnPath(c.lay.Lp, b.closed, at.p).d < nearestOnPath(c.lay.Rp, b.closed, at.p).d ? 1 : -1;
  return out && nc.d > (b.D || 12) / 2 - 0.5 ? { mode: "width", n: out, s } : null;
}
function startPush(at, w) { streetsHeld = true; action = { kind: w.mode, b: at.block, before: snapshot(), grab: at.p, y: at.y, n: w.n, s: w.s, end: w.end, D0: at.block.D || 12, pts0: at.block.pts.map((q) => [...q]), val: null }; }
function resizeMove(a) {
  const cur = onPlane(a.y); if (!cur) return; const b = a.b, raw = V.dot(V.sub(cur, a.grab), a.n);
  let g = [];
  if (a.kind === "width") {                       // only this wall moves; the one opposite stays put
    let D = a.D0 + raw;
    if (!mouse.alt) {
      D = grid.on ? Math.round(D / kit.E4) * kit.E4 : Math.round(D * 2) / 2;
      const wu = V.left(a.n), tol = tolAt(cur, a.y); let best = null;
      for (const l of features().lines) { if (Math.abs(l.u[0] * wu[1] - l.u[1] * wu[0]) > 0.03) continue; const t = V.dot(V.sub(l.a, a.grab), a.n);
        if (Math.abs(t - raw) < tol && Math.abs(t - raw) < Math.abs(D - a.D0 - raw) && (!best || Math.abs(t - raw) < Math.abs(best.t - raw))) best = { t, g: line(l, along(l, a.grab)) }; }
      if (best) { D = a.D0 + best.t; g = [best.g]; }
    }
    D = Math.max(MIN_D, Math.min(90, D));
    const pts = offsetPoly(a.pts0, b.closed, (a.s * (D - a.D0)) / 2);
    if (D !== b.D) { b.D = D; b.pts = pts; rebuild(); }
    showGuides(g, a.y); a.why = g.map((x) => x.why).join(" · "); a.val = `${+D.toFixed(1)} m wide`; return;
  }
  const P = a.pts0, n = P.length, i = a.end ? n - 1 : 0, j = a.end ? n - 2 : 1, seg = V.dist(P[i], P[j]);
  const L0 = pathLen(P, false), m = n === 2 ? L0 / Math.max(1, Math.round(L0 / W)) : W;
  let d = mouse.alt ? raw : Math.round(raw / m) * m;
  if (!mouse.alt) {                               // or so that this end meets a guide (ends flush, end to end, ...)
    const tol = tolAt(cur, a.y); let best = null;
    for (const l of features().lines) { const q = meet({ a: P[i], u: a.n }, l); if (!q) continue; const t = V.dot(V.sub(q, P[i]), a.n); if (Math.abs(t) > 0.05 && Math.abs(t - raw) < Math.min(tol, Math.abs(d - raw) + 1e-6) && (!best || Math.abs(t - raw) < Math.abs(best.t - raw))) best = { t, g: line(l, q) }; }
    if (best) { d = best.t; g = [best.g]; }
  }
  d = Math.max(d, -(seg - (n === 2 ? 2 * W : 1)));
  const pts = P.map((q) => [...q]); pts[i] = V.add(P[i], V.mul(a.n, d));
  showGuides(g, a.y); a.why = g.map((x) => x.why).join(" · ");
  if (JSON.stringify(pts) !== JSON.stringify(b.pts)) { b.pts = pts; rebuild(); }
  const L = pathLen(pts, false), k = L / W; a.val = Math.abs(k - Math.round(k)) < 0.02 ? `${Math.round(k)} sections` : `${L.toFixed(1)} m`;
}
// a highlight on just one wall (the one a push or pull would move)
function wallHL(b, w) {
  const c = cache.get(b.id); if (!c) return null; const { Lp, Rp, base, top, closed } = c.lay, n = Lp.length;
  const poly = w.mode === "length" ? (w.end ? [Rp[n - 1], Lp[n - 1]] : [Lp[0], Rp[0]]) : w.s > 0 ? Lp : Rp;
  const p = [], ix = [], o = w.mode === "length" ? V.mul(w.n, 0.25) : null;
  poly.forEach((q, i) => { let r = q; if (!o) { const nc = nearestOnPath(b.pts, closed, q); r = V.add(q, V.mul(V.norm(V.sub(q, nc.q)), 0.25)); } else r = V.add(q, o); p.push(r[0], base, r[1], r[0], top, r[1]); });
  const m = poly.length; for (let i = 0; i < (closed && w.mode !== "length" ? m : m - 1); i++) { const a2 = 2 * i, c2 = 2 * ((i + 1) % m); ix.push(a2, c2, c2 + 1, a2, c2 + 1, a2 + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix);
  return new THREE.Mesh(g, OV.edge);
}
function photo() {                                // no grid, guides or highlights in the picture
  const vis = [gridMesh, guideRoot, overlayRoot, brushRing].map((o) => [o, o.visible]); vis.forEach(([o]) => (o.visible = false));
  renderer.render(scene, camera); vis.forEach(([o, v]) => (o.visible = v));
  renderer.domElement.toBlob(async (b) => {
    const name = `panelki_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`, file = new File([b], name, { type: "image/png" });
    if (prof.share && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; } }   // a phone: save or send it from the share sheet
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click();
  });
}

function tip(html) {
  const el = $("#tip"); el.innerHTML = html; el.style.display = html ? "" : "none"; emit("tip"); if (!html) return;
  if (!prof.tipAbove) { el.style.left = mouse.x + 18 + "px"; el.style.top = mouse.y + 14 + "px"; return; }
  const w = el.offsetWidth, h = el.offsetHeight;                       // above the finger, so it can be read
  el.style.left = Math.max(8, Math.min(innerWidth - w - 8, mouse.x - w / 2)) + "px"; el.style.top = Math.max(8, mouse.y - h - 70) + "px";
}
let flashT = 0; function flash(s) { const el = $("#flash"); el.textContent = s; el.classList.add("show"); clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove("show"), 2200); }
function updateStats() { const fl = S.blocks.reduce((s, b) => s + b.fl * Math.max(1, Math.round(pathLen(b.pts, b.closed) / W)) * 2, 0); $("#stats").textContent = S.blocks.length ? `${S.blocks.length} block${S.blocks.length > 1 ? "s" : ""} · ~${(fl * 1.5).toLocaleString("en")} flats · ${S.trees.length} trees` : ""; }

// ---------------------------------------------------------------- haze
// How far one sees: 0 clear (things fade from 380 m and are gone at 2.6 km) to 1 thick (gone at about 320 m, so the
// top of a tall tower fades out above you). The haze turns paler and greyer as it thickens, and the sky goes with it
// (distant blocks dissolve into it rather than into a wall). Every material keeps its own fade distances, so all of
// them are brought up to date (and again now and then, for materials made since).
const atmos = { haze: 0.3 };
const FOG_CLEAR = new THREE.Color(0xbcc9d3), FOG_THICK = new THREE.Color(0xc9ced1), SKY_CLEAR = new THREE.Color(0xc3d0da);
function hazeParams(h) { const far = 2600 * Math.pow(320 / 2600, h); return { near: far * (0.146 - 0.12 * h), far }; }
function applyHaze() {
  scene.fog.near = FOG.near; scene.fog.far = FOG.far;
  scene.traverse((o) => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { const u = m.uniforms; if (!u) continue;
    if (u.fogR) u.fogR.value.set(FOG.near, FOG.far); if (u.fogC && u.fogC.value !== FOG.color) u.fogC.value.copy(FOG.color); if (u.skyH) u.skyH.value.copy(SKY); } });
}
function setHaze(h) {
  atmos.haze = Math.max(0, Math.min(1, h)); const { near, far } = hazeParams(atmos.haze);
  FOG.near = near; FOG.far = far; FOG.color.copy(FOG_CLEAR).lerp(FOG_THICK, atmos.haze); SKY.copy(SKY_CLEAR).lerp(FOG.color, Math.min(1, atmos.haze * 1.4));
  applyHaze(); emit("atmos"); scheduleSave();
}

// ---------------------------------------------------------------- for the input modules and the interface
const $ = (s) => document.querySelector(s);
const listeners = { tip: [], options: [], frame: [], atmos: [] };
export const on = (ev, fn) => listeners[ev].push(fn);           // "tip": a tip was shown; "options": redraw the options row; "frame": each frame (dt)
function emit(ev, ...a) { for (const fn of listeners[ev]) fn(...a); }
// Free (no snapping) and Remove (trees) can be held on the keyboard or switched on in the options row
function setMods(shift, alt) { mouse.shift = shift || (ui.tool === "trees" && ui.treeErase); mouse.alt = alt || ui.free; }
function demolish(b) {                             // knock down b and everything standing on it or built out of it
  const before = snapshot(); town.demolish(b.id); rebuild(); pushUndo(before);
}
function clearTown() {                             // start over (undoable, the ground too)
  const before = snapshot(), R = ground.RES, img = ground.grabAll(); ground.clear();
  S = { blocks: [], trees: [], roads: [], yards: [], nextId: S.nextId }; rebuild();
  undoStack.push({ before, after: snapshot(), splat: ground.patch(img, [0, 0, R, R]) }); redoStack.length = 0; scheduleSave();
}
// ---- for an input that edits by handles (touch): the same operations, started directly
const setSel = (sl) => { sel = sl; };
const beginPush = (b, wall, p, y) => startPush({ block: b, p, y }, wall);      // wall: { mode: "width", n, s } or { mode: "length", n, end }
const layOf = (id) => { const c = cache.get(id); return c ? c.lay : null; };
function edit(fn) { const before = snapshot(), r = fn(S); rebuild(); pushUndo(before); return r; }   // one undoable change to the town
let ghostMesh = null;                              // a block shown as it would be built (not part of the town)
function ghost(b) {
  if (ghostMesh) { previewRoot.remove(ghostMesh); kit.disposeGroup(ghostMesh); ghostMesh = null; }
  if (!b) return; const lay = kit.layout(b, baseOf(b)); ghostMesh = new THREE.Group();
  ghostMesh.add(kit.buildMeshes([lay]), kit.roofMesh(lay), kit.overlay(lay, OV.build, 0.7)); previewRoot.add(ghostMesh);
}
// what is going on now; read through this object, since the values are replaced as you build
export const now = {
  get S() { return S; }, get draft() { return draft; }, get action() { return action; }, get sel() { return sel; },
  get busy() { return !!(draft || action); }, get input() { return prof.name; }, get lastFloors() { return lastFloors; },
};
async function start() {
  if (!(await load())) { ground.sync(); flash("Drag on the grass to lay your first block"); }
  rebuild(); setHaze(atmos.haze);
  addEventListener("beforeunload", save);
  let last = performance.now(), hazeTick = 0;
  window.__sandbox = { S: () => S, D: () => draft, A: () => action && action.kind, pickAt: (x, y) => { mouse.x = x; mouse.y = y; const a = pick(); return a && { p: a.p, y: a.y, block: a.block && a.block.id, roof: a.roof }; }, rebuild, kit, camera, controls, topOf, scene, streetRoot, ground, allRoads: () => allRoads, yardRegions: () => yardRegions.map((r) => ({ id: r.y.id, area: r.Y.area })), entrances: () => cityLays.flatMap(({ lay }) => lay.out.filter((p) => p.pc === "entrance").map((p) => ({ q: p.q, n: p.n }))) };
  renderer.setAnimationLoop((t) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    emit("frame", dt); if (!freeCam) controls.update();
    if (action && action.kind === "trees" && mouse.in && t - action.last > 70) { action.last = t; const at = pick(); if (at && plantAt(at)) { action.changed = true; trees.rebuild(S.trees, treeY); updateStats(); } showHover(); }
    if (++hazeTick % 60 === 0) applyHaze();       // (materials made since the haze was set)
    ground.update(t / 1000); renderer.render(scene, camera);
  });
}
export {
  THREE, renderer, camera, controls, grid, ui, LAND, kit, mouse as cursor,
  start, save, scheduleSave, undo, redo, cancel, abortPress, press, move, release, showHover, updateDraft, commitDraft, startHeight,
  pick, alignGrid, demolish, clearTown, photo, flash, setMods,
  scene, overlayRoot, town, rebuild, snapshot, pushUndo, applyState, tip, snapPoint, gridSnap, tolAt, screenOf, onPlane, randFin, selOverlay, OV, cellAt,
  addRoad, roadStart, roadEnd, showRoadGhost,
  holdStreets, freeCamera, setHaze, atmos, hazeParams, guideRoot, gridMesh, brushRing, blockField, setSel, beginPush, beginPull, layOf, edit, ghost, undoMark, squashUndo, dropUndo, cellOnWall, showGuides,
};
