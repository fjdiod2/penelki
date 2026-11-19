"""Touch regression test: a phone-sized page, fingers sent through CDP. Same use as desktop.py:

    python3 tests/touch.py record | check

Camera gestures (one-finger slide, pinch, twist, tilt), tap to place a block, its handles (floors, push a wall, step
back), Delete, building on a roof, Extrude by tapping panels, a tree brush stroke.
"""
import sys, os, json, time, math
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from desktop import serve, chromium, diff, SEED, HERE

MODE = sys.argv[1] if len(sys.argv) > 1 else "check"


def run():
    port = serve(); trace = []; errs = []
    with sync_playwright() as p:
        b = chromium(p); ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script(SEED); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "GL Driver" not in m.text else None)
        pg.goto(f"http://127.0.0.1:{port}/index.html?fresh"); pg.wait_for_function("window.__ready", timeout=60000); time.sleep(1)
        cdp = ctx.new_cdp_session(pg)
        def touch(kind, pts): cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
        def drag1(a, c, steps=12, hold=0.0):
            touch("touchStart", [a]); time.sleep(hold)
            for i in range(1, steps + 1): touch("touchMove", [(a[0] + (c[0] - a[0]) * i / steps, a[1] + (c[1] - a[1]) * i / steps)]); time.sleep(0.016)
            touch("touchEnd", []); time.sleep(0.25)
        def tap(x, y): touch("touchStart", [(x, y)]); time.sleep(0.05); touch("touchEnd", []); time.sleep(0.3)
        def two(f):
            touch("touchStart", f(0))
            for i in range(1, 13): touch("touchMove", f(i)); time.sleep(0.016)
            touch("touchEnd", []); time.sleep(0.2)
        def cam(pos, tgt): pg.evaluate("([p,t]) => { const s = window.__sandbox, c = s.controls; c.enableDamping = false; c.update(); s.camera.position.set(...p); c.target.set(...t); c.update(); c.enableDamping = true; }", [pos, tgt]); time.sleep(0.3)
        scr = lambda x, y, z: pg.evaluate("([x,y,z]) => { const c = window.__sandbox.camera; c.updateMatrixWorld(); const v = c.position.clone().set(x,y,z).project(c); return [(v.x+1)/2*innerWidth, (1-v.y)/2*innerHeight]; }", [x, y, z])
        camst = lambda: pg.evaluate("(() => { const s = window.__sandbox, o = s.camera.position.clone().sub(s.controls.target); return { dist: Math.round(o.length()), tilt: Math.round(Math.acos(o.y / o.length()) * 180 / Math.PI), turn: Math.round(Math.atan2(o.x, o.z) * 180 / Math.PI), tgt: s.controls.target.toArray().map(Math.round) }; })()")
        blocks = lambda: pg.evaluate("window.__sandbox.S().blocks.map(b => ({ id: b.id, fl: b.fl, D: +(b.D || 12).toFixed(1), L: +Math.hypot(b.pts[1][0]-b.pts[0][0], b.pts[1][1]-b.pts[0][1]).toFixed(1), parent: b.parent, at: b.at || null }))")
        handles = lambda: pg.evaluate("window.__touch.handles()")
        H = lambda kind, **kw: next(h for h in handles() if h["kind"] == kind and all(h.get(k) == v for k, v in kw.items()))
        tip = lambda: pg.inner_text("#tip").replace("\n", " | ") if pg.is_visible("#tip") else ""
        vis = lambda: {s: pg.is_visible("#" + s) for s in ("t-done", "t-del", "t-cancel")}
        def log(step, **kw): trace.append({"step": step, **kw}); print(step, kw)

        cam([0, 90, 90], [0, 0, 0]); pg.click("[data-g=fin][data-v=tiles_beige]")
        log("start", hint=pg.inner_text("#hint"), orbit_button=pg.is_visible("#t-orbit"))
        # ---- camera
        c0 = camst(); drag1((200, 500), (120, 420)); c1 = camst(); log("one finger slides the view", moved=c1["tgt"] != c0["tgt"], same_angle=c1["tilt"] == c0["tilt"] and c1["turn"] == c0["turn"], blocks=len(blocks()))
        two(lambda i: [(140 - 5 * i, 450), (250 + 5 * i, 450)]); c2 = camst(); log("pinch out zooms in", closer=c2["dist"] < c1["dist"])
        two(lambda i: [(195 - 60 * math.cos(math.radians(3 * i)), 450 - 60 * math.sin(math.radians(3 * i))), (195 + 60 * math.cos(math.radians(3 * i)), 450 + 60 * math.sin(math.radians(3 * i)))]); c3 = camst(); log("twist turns", turned=c3["turn"] != c2["turn"])
        two(lambda i: [(140, 500 - 8 * i), (250, 500 - 8 * i)]); c4 = camst(); log("two fingers up tilt toward the horizon", tilt=[c3["tilt"], c4["tilt"]], tilted=c4["tilt"] > c3["tilt"], dist_same=abs(c4["dist"] - c3["dist"]) <= 1)
        # ---- tap to place: the placing stage (move, walls, floors), Done, one undo step
        cam([0, 90, 90], [0, 0, 0])
        held = lambda: pg.evaluate("window.__touch.held()")
        kinds = lambda: sorted(h["kind"] + (("/" + str(h.get("mode"))) if h.get("mode") else "") for h in handles())
        tap(*scr(0, 0, 0)); log("tap places a block, being placed", blocks=blocks(), held=held(), buttons=vis(), handles=kinds(), tip=tip())
        pg.screenshot(path=os.path.join(HERE, "out", "touch_place.png"))
        m = H("move")["at"]; drag1(m, (m[0] + 60, m[1])); p0 = pg.evaluate("window.__sandbox.S().blocks[0].pts[0].map(Math.round)"); log("drag the middle: it moves", start=p0)
        f = H("floors")["at"]; drag1(f, (f[0], f[1] - 100)); log("floors arrow up", blocks=blocks())
        w = H("push", mode="width", s=1)["at"]; w2 = H("push", mode="width", s=-1)["at"]; d = [w[0] - w2[0], w[1] - w2[1]]; n = math.hypot(*d)
        drag1(w, (w[0] + d[0] / n * 40, w[1] + d[1] / n * 40)); log("push a wall out", blocks=blocks())
        pg.tap("#t-done"); time.sleep(0.3); log("Done: built, still selected", held=held(), buttons=vis(), handles=kinds())
        pg.click("#undo"); time.sleep(0.3); log("one Undo takes the whole placement back", blocks=blocks())
        pg.click("#redo"); time.sleep(0.3); log("Redo brings it back", blocks=blocks())
        # ---- selected: step back; the tier is placed (moved, centred), Cancel, again, Done
        tap(*scr(0, 0, 0)); tap(*scr(0, 0, 0)) if not held() else None; log("tap it: selected", held=held(), handles=kinds())
        e = H("step", mode="end", k=1)["at"]; e0 = H("step", mode="end", k=0)["at"]
        drag1(e, (e[0] + (e0[0] - e[0]) * 0.45, e[1] + (e0[1] - e[1]) * 0.45)); log("step back from an end: the tier is being placed", blocks=blocks(), held=held(), buttons=vis())
        pg.screenshot(path=os.path.join(HERE, "out", "touch_tier.png"))
        t0 = pg.evaluate("window.__sandbox.S().blocks[1].pts[0].map(v => +v.toFixed(1))"); m = H("move")["at"]; drag1(m, (m[0] - 45, m[1] + 4)); log("move the tier on the roof", moved=pg.evaluate("window.__sandbox.S().blocks[1].pts[0].map(v => +v.toFixed(1))") != t0)
        pg.tap("#t-cancel"); time.sleep(0.3); log("Cancel: no tier", blocks=blocks(), held=held())
        tap(*scr(0, 0, 0)); e = H("step", mode="end", k=1)["at"]; e0 = H("step", mode="end", k=0)["at"]
        drag1(e, (e[0] + (e0[0] - e[0]) * 0.45, e[1] + (e0[1] - e[1]) * 0.45)); pg.tap("#t-done"); time.sleep(0.2); pg.tap("#t-done"); time.sleep(0.3)
        log("step back again, Done, Done: built and let go", blocks=blocks(), held=held(), buttons=vis())
        top = pg.evaluate("window.__sandbox.topOf(window.__sandbox.S().blocks[0])")
        tap(*scr(0, 0, 0)); log("tap the block: selected", held=held())
        pg.tap("#t-del"); time.sleep(0.3); log("Delete", blocks=blocks(), held=held())
        tap(*scr(0, 0, 0)); log("tap the ground: a new block", blocks=blocks(), held=held())
        tap(*scr(-8, 0, 32)); log("tap away: built and let go", held=held(), buttons=vis())
        # ---- extrude: tap a panel, stretch the choice, Next, pull
        pg.tap("[data-tool=carve]"); time.sleep(0.2); cam([10, 20, 60], [0, 8, 0])
        front = pg.evaluate("(() => { const b = window.__sandbox.S().blocks[0], u = [b.pts[1][0]-b.pts[0][0], b.pts[1][1]-b.pts[0][1]], L = Math.hypot(...u); const lf = [u[1]/L, -u[0]/L], s = lf[1] > 0 ? 1 : -1; return { o: [b.pts[0][0] + lf[0]*s*b.D/2, b.pts[0][1] + lf[1]*s*b.D/2], u: [u[0]/L, u[1]/L], n: [lf[0]*s, lf[1]*s] }; })()")
        P = lambda t, y: scr(front["o"][0] + front["u"][0] * t + front["n"][0] * 0.02, y, front["o"][1] + front["u"][1] * t + front["n"][1] * 0.02)
        tap(*P(4.8, 0.8 + 2.8 * 1.5)); log("tap a panel: a choice", stage=pg.evaluate("window.__touch.stage()"), tip=tip(), buttons=vis(), handles=sorted(h.get("edge") or h["kind"] for h in handles()))
        sel = lambda: pg.evaluate("window.__touch.sel()"); log("handles at", hs=[[h.get("edge") or h["kind"], [round(v) for v in h["at"]]] for h in handles()], sel=sel())
        r = H("edge", edge="k1")["at"]; drag1(r, P(11.2, 0.8 + 2.8 * 1.5)); log("stretch it right", sel=sel())
        u_ = H("edge", edge="f1")["at"]; drag1(u_, P(8, 0.8 + 2.8 * 3.5)); log("stretch it up", sel=sel(), tip=tip())
        pg.screenshot(path=os.path.join(HERE, "out", "touch_carve.png"))
        pg.tap("#t-done"); time.sleep(0.2); log("Next: the arrow", stage=pg.evaluate("window.__touch.stage()"), handles=[h["kind"] for h in handles()], tip=tip())
        a = H("pull")["at"]; q = scr(front["o"][0] + front["u"][0] * 8 + front["n"][0] * 9, 0.8 + 2.8 * 2, front["o"][1] + front["u"][1] * 8 + front["n"][1] * 9)
        drag1(a, q); log("drag the arrow out", blocks=blocks(), stage=pg.evaluate("window.__touch.stage()"))
        # ---- a brush
        pg.tap("[data-tool=trees]"); time.sleep(0.2); cam([0, 90, 90], [0, 0, 0])
        drag1(scr(-12, 0, 36), scr(12, 0, 36), steps=20, hold=0.3); log("trees with one finger", some=pg.evaluate("window.__sandbox.S().trees.length > 0"))
        # ---- ring and curve: tap to place, drag their handles; a road: lay it, select it, move an end, delete it
        rings = lambda: pg.evaluate("window.__sandbox.S().blocks.filter(b => b.closed).map(b => Math.round(Math.hypot(b.pts[0][0] - b.pts.reduce((a, q) => a + q[0], 0) / b.pts.length, b.pts[0][1] - b.pts.reduce((a, q) => a + q[1], 0) / b.pts.length)))")
        pg.tap("[data-tool=ring]"); time.sleep(0.2); cam([-150, 140, 120], [-150, 0, 0]); tap(*scr(-150, 0, 0))
        log("ring: tap places one", radius=rings(), held=(held() or {}).get("phase"), handles=sorted(h["kind"] for h in handles()))
        r = H("radius")["at"]; drag1(r, (r[0] - 40, r[1])); log("ring: drag the radius arrow", radius=rings())
        pg.tap("#t-done"); time.sleep(0.2); pg.tap("#t-done"); time.sleep(0.2)
        curve = lambda: pg.evaluate("(() => { const b = window.__sandbox.S().blocks.find(b => !b.closed && b.pts.length > 2); return b && { n: b.pts.length, a: b.pts[0].map(Math.round), c: b.pts[b.pts.length - 1].map(Math.round) }; })()")
        pg.tap("[data-tool=curve]"); time.sleep(0.2); cam([-150, 140, 240], [-150, 0, 120]); tap(*scr(-150, 0, 120))
        c0 = curve(); log("curve: tap places one", curve=c0, handles=sorted(h["kind"] for h in handles()))
        bnd = H("bend")["at"]; drag1(bnd, (bnd[0], bnd[1] + 50)); c1 = curve(); log("curve: drag the bend", still_curved=bool(c1 and c1["n"] > 2), ends_same=bool(c1 and c1["a"] == c0["a"] and c1["c"] == c0["c"]))
        e1 = H("curveEnd", k=1)["at"]; drag1(e1, (e1[0] + 40, e1[1])); c2 = curve(); log("curve: drag an end", moved=bool(c2 and c2["c"] != c1["c"]), other_end_same=bool(c2 and c2["a"] == c1["a"]))
        pg.tap("#t-done"); time.sleep(0.2); pg.tap("#t-done"); time.sleep(0.2)
        roads = lambda: pg.evaluate("window.__sandbox.S().roads.map(r => r.pts.map(p => p.map(Math.round)))")
        pg.tap("[data-tool=road]"); time.sleep(0.2); cam([60, 140, 240], [60, 0, 120])
        tap(*scr(30, 0, 120)); tap(*scr(90, 0, 120)); pg.tap("#t-done"); time.sleep(0.2); log("road: tap, tap, Done", roads=roads())
        tap(*scr(60, 0, 120)); log("road: tap it: its ends", handles=sorted(h["kind"] for h in handles()), buttons=vis())
        en = H("roadEnd", k=1)["at"]; drag1(en, (en[0], en[1] + 40)); log("road: drag an end", roads=roads())
        pg.tap("#t-del"); time.sleep(0.3); log("road: Delete", roads=roads())
        # ---- a block in a hole: select a block with a hole dug through it, tap the hole's floor
        pg.tap("[data-tool=line]"); time.sleep(0.2)
        pg.evaluate("() => { const s = window.__sandbox, S = s.S(); S.blocks.push({ id: 900, pts: [[200, 0], [232, 0]], closed: false, D: 12, fl: 9, fin: 'concrete', seed: 4, parent: null, cuts: [{ side: 1, s0: 9.6, s1: 19.2, f0: 3, f1: 6, d: 12 }] }); s.rebuild(); }")
        cam([216, 25, -75], [216, 12, 0]); tap(*scr(220, 20, -6)); log("hole: tap the block", held=(held() or {}).get("id"))
        tap(*scr(214.4, 0.8 + 2.8 * 3 + 0.05, -3)); log("hole: tap its floor: a block in the hole", inhole=pg.evaluate("window.__sandbox.S().blocks.filter(b => b.at && b.at.id === 900).map(b => [b.at.f, b.fl, +b.D.toFixed(1)])"))
        pg.tap("#t-done"); time.sleep(0.2); pg.tap("#t-done"); time.sleep(0.2)
        # ---- walk mode: Walk, tap a spot, drag to look, pinch for the lens, Exit
        cam([0, 90, 90], [0, 0, 0]); c0 = camst(); pg.tap("#walk"); time.sleep(0.2); tap(*scr(-15, 0, 30))
        ws = lambda: pg.evaluate("(() => { const s = window.__photo.state(); return s && { y0: s.y0, pitch: +s.pitch.toFixed(2), mm: Math.round(s.mm) }; })()")
        log("walk: tap a spot to stand there", st=ws(), bar=pg.is_visible("#photobar"), tools_hidden=not pg.is_visible("#bar"))
        drag1((200, 300), (200, 500)); log("walk: drag down looks up", up=ws()["pitch"] > 0.3)
        two(lambda i: [(150 - 4 * i, 400), (240 + 4 * i, 400)]); log("walk: pinch out, a longer lens", mm=ws()["mm"] > 24)
        pg.tap("#ph-exit"); time.sleep(0.3); log("walk: Exit puts the camera back", same=camst() == c0, tools=pg.is_visible("#bar"))
        log("tool bar scrolls", fade=pg.evaluate("document.querySelector('#bar').className"))
        pg.screenshot(path=os.path.join(HERE, "out", "touch_end.png"))
        log("errors", errs=errs)
        b.close()
    return trace


if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    t = run(); base = os.path.join(HERE, "touch_baseline.json")
    if MODE == "record": json.dump(t, open(base, "w"), indent=1); print(f"recorded {len(t)} steps")
    else:
        d = diff(json.load(open(base)), t); print("\n".join(d[:60]) if d else "SAME as the baseline"); sys.exit(1 if d else 0)
