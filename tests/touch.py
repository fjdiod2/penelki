"""Touch regression test (a phone-sized page, fingers sent through CDP). Same use as desktop.py:

    python3 tests/touch.py record | check
"""
import sys, os, json, time, math
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from desktop import serve, chromium, diff, SEED, HERE

MODE = sys.argv[1] if len(sys.argv) > 1 else "check"


def run():
    port = serve(); trace = []; errs = []
    with sync_playwright() as p:
        b = chromium(p); ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        ctx.add_init_script(SEED); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(f"http://127.0.0.1:{port}/index.html?fresh"); pg.wait_for_function("window.__ready", timeout=60000); time.sleep(1.5)
        cdp = ctx.new_cdp_session(pg)
        def touch(kind, pts): cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
        def drag1(path, steps=10, hold=0.0):
            touch("touchStart", [path[0]]); time.sleep(hold); a = path[0]
            for c in path[1:]:
                for i in range(1, steps + 1): touch("touchMove", [(a[0] + (c[0] - a[0]) * i / steps, a[1] + (c[1] - a[1]) * i / steps)]); time.sleep(0.016)
                a = c
            touch("touchEnd", []); time.sleep(0.2)
        def tap(x, y): touch("touchStart", [(x, y)]); time.sleep(0.05); touch("touchEnd", []); time.sleep(0.3)
        def two(f):                                   # two fingers, positions from f(i), i = 0..10
            touch("touchStart", f(0))
            for i in range(1, 11): touch("touchMove", f(i)); time.sleep(0.016)
            touch("touchEnd", []); time.sleep(0.2)
        def cam(pos, tgt): pg.evaluate("([p,t]) => { const s = window.__sandbox, c = s.controls; c.enableDamping = false; c.update(); s.camera.position.set(...p); c.target.set(...t); c.update(); c.enableDamping = true; }", [pos, tgt])   # no leftover orbit momentum; time.sleep(0.3)
        scr = lambda x, y, z: pg.evaluate("([x,y,z]) => { const c = window.__sandbox.camera; c.updateMatrixWorld(); const v = c.position.clone().set(x,y,z).project(c); return [(v.x+1)/2*innerWidth, (1-v.y)/2*innerHeight]; }", [x, y, z])
        st = lambda: pg.evaluate("(() => { const s = window.__sandbox, d = s.D(); return { blocks: s.S().blocks.map(b => [b.fl, +b.D.toFixed(1), b.pts.length]), draft: d && [d.stage, d.fl], cam: s.camera.position.toArray().map(v => Math.round(v)), tgt: s.controls.target.toArray().map(v => Math.round(v)) }; })()")
        tip = lambda: pg.inner_text("#tip").replace("\n", " | ") if pg.is_visible("#tip") else ""
        vis = lambda: [pg.is_visible(s) for s in ("#t-done", "#t-cancel", "#t-orbit")]
        def log(step, **kw): trace.append({"step": step, **kw}); print(step, kw)

        cam([30, 120, 110], [0, 0, 0]); pg.click("[data-g=fin][data-v=tiles_beige]")
        drag1([scr(-20, 0, 0), scr(20, 0, 0), scr(20, 0, -16)]); log("drawn", st=st(), tip=tip(), buttons=vis())
        drag1([(200, 600), (200, 450)]); log("dragged up", st=st(), tip=tip())
        tap(200, 450); log("tap builds", st=st())
        two(lambda i: [(150 - 6 * i, 400), (240 + 6 * i, 400)]); log("pinch", st=st())
        two(lambda i: [(195 - 45 * math.cos(math.radians(4 * i)), 400 - 45 * math.sin(math.radians(4 * i))), (195 + 45 * math.cos(math.radians(4 * i)), 400 + 45 * math.sin(math.radians(4 * i)))]); log("twist", st=st())
        two(lambda i: [(150 + 8 * i, 400), (240 + 8 * i, 400)]); log("slide", st=st())
        pg.tap("#t-orbit"); time.sleep(0.2); drag1([(200, 500), (260, 460)]); log("orbit", st=st(), buttons=vis()); pg.tap("#t-orbit"); time.sleep(0.2)
        cam([30, 120, 110], [0, 0, 0])
        g = pg.evaluate("(() => { const s = window.__sandbox, b = s.S().blocks[0]; return { top: s.topOf(b), a: b.pts[0], c: b.pts[1] }; })()")
        m = [(g["a"][0] + g["c"][0]) / 2, (g["a"][1] + g["c"][1]) / 2]
        drag1([scr(g["c"][0] - 1.5, g["top"], m[1]), scr(g["c"][0] - 20, g["top"], m[1])]); log("step back", st=st(), tip=tip(), buttons=vis())
        pg.tap("#t-done"); time.sleep(0.2); drag1([(200, 500), (200, 420)]); pg.tap("#t-done"); time.sleep(0.3); log("tier built with Done", st=st())
        pg.tap("[data-tool=carve]"); time.sleep(0.2); cam([0, 20, 60], [0, 12, 0])
        drag1([scr(-8, 6, -1.99), scr(-2, 9, -1.99)]); log("carve select", tip=tip(), buttons=vis())
        drag1([scr(-5, 7.5, -1.99), scr(-5, 7.5, 8)]); log("carve out", st=st())
        pg.tap("[data-tool=trees]"); time.sleep(0.2); cam([30, 120, 110], [0, 0, 0])
        drag1([(120, 650), (300, 650)], hold=0.3); log("trees", some=pg.evaluate("window.__sandbox.S().trees.length > 3"))
        pg.tap("[data-tool=line]"); time.sleep(0.2); drag1([scr(-20, 0, 40), scr(20, 0, 40)]); log("drawn 2", st=st(), buttons=vis())
        pg.tap("#t-cancel"); time.sleep(0.2); log("cancel", st=st(), buttons=vis())
        log("errors", errs=errs)
        b.close()
    return trace


if __name__ == "__main__":
    t = run(); base = os.path.join(HERE, "touch_baseline.json")
    if MODE == "record": json.dump(t, open(base, "w"), indent=1); print(f"recorded {len(t)} steps")
    else:
        d = diff(json.load(open(base)), t); print("\n".join(d[:60]) if d else "SAME as the baseline"); sys.exit(1 if d else 0)
