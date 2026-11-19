"""Desktop regression test: builds a sample town with the mouse and keyboard and records what happened.

    python3 tests/desktop.py record      # write tests/desktop_baseline.json (+ screenshots in tests/out/)
    python3 tests/desktop.py check       # run again and compare with the baseline

Math.random is seeded, so the same gestures give the same town. Trees are planted on a timer, so they are planted last
and compared loosely (how many, and on what). Needs playwright (pip install playwright; playwright install chromium).
"""
import sys, os, json, time, glob, math, hashlib, threading, functools, http.server
from playwright.sync_api import sync_playwright

ROOT = os.environ.get("PANELKI_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the game to test
HERE = os.path.dirname(os.path.abspath(__file__))
MODE = sys.argv[1] if len(sys.argv) > 1 else "check"
SEED = """(() => { let a = 1234567; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();"""


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def chromium(p):
    exes = glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/*.app/Contents/MacOS/*"))
    # hidden runs draw with SwiftShader (the same everywhere, for the comparisons); HEADED=1 runs use the real GPU
    headed = os.environ.get("HEADED") is not None
    soft = [] if headed else ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    return p.chromium.launch(executable_path=exes[0] if exes else None, headless=not headed, args=["--window-size=1460,900", *soft])


def run():
    port = serve(); trace = []; errs = []
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    with sync_playwright() as p:
        b = chromium(p); ctx = b.new_context(viewport={"width": 1440, "height": 860}); ctx.add_init_script(SEED); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(f"http://127.0.0.1:{port}/index.html?fresh"); pg.wait_for_function("window.__ready", timeout=60000); time.sleep(1.5)

        def cam(pos, tgt): pg.evaluate("([p,t]) => { const s = window.__sandbox, c = s.controls; c.enableDamping = false; c.update(); s.camera.position.set(...p); c.target.set(...t); c.update(); c.enableDamping = true; }", [pos, tgt])   # no leftover orbit momentum; time.sleep(0.3)
        scr = lambda x, y, z: pg.evaluate("([x,y,z]) => { const c = window.__sandbox.camera; c.updateMatrixWorld(); const v = c.position.clone().set(x,y,z).project(c); return [(v.x+1)/2*innerWidth, (1-v.y)/2*innerHeight]; }", [x, y, z])
        tip = lambda: pg.inner_text("#tip").replace("\n", " | ") if pg.is_visible("#tip") else ""
        r2 = lambda v: round(v, 2) + 0.0

        def state():
            s = pg.evaluate("JSON.stringify(window.__sandbox.S())"); o = json.loads(s)
            def rnd(x):
                if isinstance(x, float): return round(x, 2) + 0.0
                if isinstance(x, list): return [rnd(y) for y in x]
                if isinstance(x, dict): return {k: rnd(v) for k, v in x.items() if k != "seed"}      # seeds are random
                return x
            return rnd(o["blocks"])

        def log(label, extra=None):
            e = {"step": label, "blocks": state(), "draft": pg.evaluate("(() => { const d = window.__sandbox.D(); return d ? d.stage : null; })()")}
            if extra is not None: e["seen"] = extra
            trace.append(e); print(label, "|", extra if extra is not None else "")

        def geom(i):                                  # handy points on block i (straight): wall middles, ends, roof
            return pg.evaluate("""(i) => { const s = window.__sandbox, b = s.S().blocks.find(x => x.id === i), [a, c] = [b.pts[0], b.pts[b.pts.length - 1]];
              const L = Math.hypot(c[0]-a[0], c[1]-a[1]), u = [(c[0]-a[0])/L, (c[1]-a[1])/L], lf = [-u[1], u[0]], D = b.D || 12, m = [(a[0]+c[0])/2, (a[1]+c[1])/2];
              const P = (s_, w) => [a[0] + u[0]*s_ + lf[0]*w, a[1] + u[1]*s_ + lf[1]*w];
              return { L, D, u, lf, top: s.topOf(b), a, c, m, P: null }; }""", i)

        def P(g, s_, w): return [g["a"][0] + g["u"][0] * s_ + g["lf"][0] * w, g["a"][1] + g["u"][1] * s_ + g["lf"][1] * w]

        def path(points, hold=0.15, steps=12, mods=None):
            """press at the first point, move through the rest, release; returns the tips seen at each corner"""
            seen = []; S0 = scr(*points[0]); pg.mouse.move(*S0); time.sleep(hold)
            if mods: pg.keyboard.down(mods)
            pg.mouse.down(); a = S0
            for q in points[1:]:
                c = scr(*q)
                for i in range(1, steps + 1): pg.mouse.move(a[0] + (c[0] - a[0]) * i / steps, a[1] + (c[1] - a[1]) * i / steps); time.sleep(0.008)
                seen.append(tip()); a = c
            pg.mouse.up()
            if mods: pg.keyboard.up(mods)
            time.sleep(0.15); return seen

        def up_to(fl, x, y, click=True):
            """in the floors stage: move up from (x, y) until the tip says fl floors, then click"""
            got = None
            for k in range(0, 600, 2):
                pg.mouse.move(x, y - k); time.sleep(0.004)
                t = tip()
                if t.startswith(f"{fl} floor"): got = t; break
            if click: pg.mouse.click(x, y - k); time.sleep(0.25)
            return got

        def hover(q):
            pg.mouse.move(*scr(*q)); time.sleep(0.12); return tip()

        cam([60, 130, 190], [0, 0, 0])
        trace.append({"step": "hint", "seen": pg.inner_text("#hint")})

        # ---- blocks
        pg.keyboard.press("1"); pg.click("[data-g=fin][data-v=tiles_beige]")
        seen = [hover((-60, 0, -40))]
        seen += path([(-60, 0, -40), (60, 0, -40)]); x, y = scr(60, 0, -40); seen.append(up_to(9, x, y)); log("block 1: line, 9 floors", seen)
        seen = path([(-60, 0, 10), (20, 0, 10), (20, 0, 30)]); x, y = scr(20, 0, 20); seen.append(up_to(5, x, y)); log("block 2: swung wide, 5 floors", seen)
        seen = path([(-90, 0, -30), (-90, 0, 40)]); x, y = scr(-90, 0, 40); seen.append(up_to(4, x, y)); log("block 3: square to grid", seen)
        seen = path([(30, 0, 40), (71, 0, 57)], mods="Alt"); x, y = scr(71, 0, 57); seen.append(up_to(3, x, y)); log("block 4: free (Alt)", seen)
        pg.keyboard.press("2")
        seen = path([(-60, 0, 90), (20, 0, 90)]); pg.mouse.move(*scr(-20, 0, 70)); time.sleep(0.1); seen.append(tip()); pg.mouse.click(*scr(-20, 0, 70)); time.sleep(0.15)
        x, y = scr(-20, 0, 70); seen.append(up_to(6, x, y)); log("block 5: curve", seen)
        pg.keyboard.press("3")
        seen = path([(110, 0, 10), (130, 0, 10)]); x, y = scr(130, 0, 10); seen.append(up_to(12, x, y)); log("block 6: ring", seen)
        pg.keyboard.press("Escape")

        # ---- push and pull
        pg.keyboard.press("1"); g = geom(1)
        far = P(g, g["L"] / 2, g["D"] / 2 if g["lf"][1] < 0 else -g["D"] / 2)          # the long wall facing the camera (+z)
        near = P(g, g["L"] / 2, -g["D"] / 2 if g["lf"][1] < 0 else g["D"] / 2)
        wall = near if near[1] > far[1] else far; out = [0, 1]
        seen = [hover((wall[0], 8, wall[1] + 0.01))]
        seen += path([(wall[0], 8, wall[1] + 0.01), (wall[0], 8, wall[1] + 7)]); log("push: widen block 1 toward the camera", seen)
        e1 = P(g, g["L"] + 0.02, 0); e2 = P(g, g["L"] + 13, 0)
        seen = [hover((e1[0], 8, e1[1]))] + path([(e1[0], 8, e1[1]), (e2[0], 8, e2[1])]); log("pull: lengthen block 1", seen)
        pg.keyboard.press("4"); g3 = geom(3)
        seen = [hover((g3["m"][0], g3["top"], g3["m"][1]))]
        x, y = scr(g3["m"][0], g3["top"], g3["m"][1]); pg.mouse.move(x, y); time.sleep(0.1); pg.mouse.down()
        for k in range(1, 30): pg.mouse.move(x, y - k * 4); time.sleep(0.01)
        seen.append(tip()); pg.mouse.up(); time.sleep(0.2); log("floors: block 3 roof dragged up", seen)

        # ---- step back: an end, then adjust (wall, slide), floors; a corner (pyramid); a side
        pg.keyboard.press("1"); g = geom(1); T = g["top"]
        e = P(g, g["L"] - 1.2, 0); i_ = P(g, g["L"] - 1.2 - 40, 0)
        seen = [hover((e[0], T, e[1]))] + path([(e[0], T, e[1]), (i_[0], T, i_[1])])
        mid = P(g, (g["L"] - 40) / 2, 0); seen += path([(mid[0], T, mid[1]), (mid[0] + 25, T, mid[1] + 0.3)])
        bx = P(g, g["L"] / 2, 0); x, y = scr(bx[0], T, bx[1] + g["D"] / 2 + 3); pg.mouse.click(x, y); time.sleep(0.2); seen.append(up_to(4, x, y)); log("step back: end, slid, 4 floors", seen)
        g2 = geom(2); T2 = g2["top"]; c0 = P(g2, 0.4, g2["D"] / 2 - 0.4); c1 = P(g2, 6.4, g2["D"] / 2 - 6.4)
        seen = [hover((c0[0], T2, c0[1]))] + path([(c0[0], T2, c0[1]), (c1[0], T2, c1[1])])
        if pg.evaluate("window.__sandbox.D() && window.__sandbox.D().stage") == "place":
            x, y = scr(*[P(g2, g2["L"] / 2, g2["D"] / 2 + 4)[0], T2, P(g2, g2["L"] / 2, g2["D"] / 2 + 4)[1]]); pg.mouse.click(x, y); time.sleep(0.2)
        else: x, y = scr(c1[0], T2, c1[1])
        seen.append(up_to(2, x, y)); log("step back: corner", seen)
        g1 = geom(1); s0 = P(g1, 20, -g1["D"] / 2 + 0.5); s1 = P(g1, 20, -g1["D"] / 2 + 6.5); T = g1["top"]
        seen = [hover((s0[0], T, s0[1]))] + path([(s0[0], T, s0[1]), (s1[0], T, s1[1])]); pg.keyboard.press("Escape"); log("step back: side, cancelled", seen)

        # ---- extrude and dig on block 3 (long wall facing +x) and an end wall
        pg.keyboard.press("9"); g3 = geom(3); cam([-40, 25, 5], [-90, 8, 5])
        wl = 1 if g3["lf"][0] > 0 else -1; Y = lambda f: 0.8 + f * 2.8 + 1.4
        Q = lambda s_, f, out=0.01: [P(g3, s_, wl * (g3["D"] / 2 + out))[0], Y(f), P(g3, s_, wl * (g3["D"] / 2 + out))[1]]
        seen = [hover(Q(30 * 0 + 17.6, 1))] + path([Q(17.6, 1), Q(24.0, 2)]) + path([Q(20.8, 1.5), Q(20.8, 1.5, 9)]); log("extrude out", seen)
        pg.click("[data-g=carve][data-v=dig]"); seen = path([Q(40, 0), Q(46.4, 0)]) + path([Q(43, 0.3), Q(43, 0.3, -30)]); log("dig through: arch", seen)
        seen = path([Q(55, 2), Q(58, 3)]) + path([Q(56.5, 2.5), Q(56.5, 2.5, -3)]); log("dig in: loggia", seen)
        pg.click("[data-g=carve][data-v=out]")
        e0 = P(g3, -0.01, 0); seen = path([[e0[0], Y(1), e0[1] - 3], [e0[0], Y(2), e0[1] + 3]]) + path([[e0[0], Y(1.5), e0[1]], [e0[0], Y(1.5), e0[1] - 12]]); log("extrude end wall", seen)

        # ---- paint, ground, grid, delete, undo / redo
        cam([60, 130, 190], [0, 0, 0])
        pg.keyboard.press("5"); pg.click("[data-v=brick_red]"); g2 = geom(2); pg.mouse.click(*scr(g2["m"][0], g2["top"], g2["m"][1])); time.sleep(0.2); log("paint block 2 red")
        pg.keyboard.press("7"); pg.click("[data-v=asphalt]"); path([(-100, 0, 55), (100, 0, 55)], steps=30)
        pg.click("[data-v=water]"); path([(60, 0, -90), (120, 0, -70), (140, 0, -110)], steps=20)
        trace.append({"step": "ground hint", "seen": pg.inner_text("#hint")})
        pg.keyboard.press("1"); pg.keyboard.press("g"); trace.append({"step": "grid off", "seen": pg.inner_text("#flash")}); pg.keyboard.press("g")
        pg.mouse.move(*scr(g2["m"][0], g2["top"], g2["m"][1])); pg.keyboard.press("Shift+G"); time.sleep(0.1); trace.append({"step": "grid turned", "seen": pg.inner_text("#flash")})
        g6 = pg.evaluate("window.__sandbox.S().blocks.find(b => b.id === 6).pts[0]")
        pg.mouse.move(*scr(g6[0], 30, g6[1])); time.sleep(0.1); pg.keyboard.press("Delete"); time.sleep(0.2); log("delete the ring")
        pg.keyboard.press("Control+z"); time.sleep(0.3); log("undo")
        pg.keyboard.press("Control+Shift+z"); time.sleep(0.3); log("redo")
        pg.keyboard.press("Control+z"); time.sleep(0.3)
        pg.keyboard.press("8"); g4 = pg.evaluate("window.__sandbox.S().blocks.find(b => b.id === 4).pts[0]")
        seen = [hover((g4[0] + 0.5, 4, g4[1] + 2))]; pg.mouse.click(*scr(g4[0] + 0.5, 4, g4[1] + 2)); time.sleep(0.2); log("demolish block 4?", seen)

        # ---- camera keys
        c0_ = pg.evaluate("window.__sandbox.camera.position.toArray()")
        pg.keyboard.down("w"); time.sleep(0.3); pg.keyboard.up("w"); pg.keyboard.down("q"); time.sleep(0.3); pg.keyboard.up("q"); time.sleep(0.4)
        c1_ = pg.evaluate("window.__sandbox.camera.position.toArray()"); trace.append({"step": "WASD/QE moved", "seen": math.dist(c0_, c1_) > 5})
        x, y = 700, 400; pg.mouse.move(x, y); pg.mouse.down(button="right")
        for k in range(10): pg.mouse.move(x + k * 8, y); time.sleep(0.01)
        pg.mouse.up(button="right"); time.sleep(0.4); c2_ = pg.evaluate("window.__sandbox.camera.position.toArray()"); trace.append({"step": "right drag orbits", "seen": math.dist(c1_, c2_) > 5})
        pg.mouse.wheel(0, -400); time.sleep(0.5); c3_ = pg.evaluate("window.__sandbox.camera.position.toArray()"); trace.append({"step": "wheel zooms", "seen": math.dist(c2_, c3_) > 5})

        # ---- trees last (planted on a timer: compared loosely)
        cam([60, 130, 190], [0, 0, 0]); pg.keyboard.press("6")
        free = lambda x, y: (lambda a: a is not None and a["block"] is None)(pg.evaluate("(xy) => window.__sandbox.pickAt(xy[0], xy[1])", [x, y]))
        gy = next(y for y in range(820, 300, -10) if all(free(x, y) for x in range(200, 520, 40)))     # a strip of open grass on screen
        pg.mouse.move(200, gy); time.sleep(0.15); seen = [tip()]; pg.mouse.down(); time.sleep(1.0)
        for i in range(1, 61): pg.mouse.move(200 + i * 5, gy); time.sleep(0.01)
        pg.mouse.up(); time.sleep(0.2)
        g1 = geom(1); path([(g1["m"][0], g1["top"], g1["m"][1]), (g1["m"][0] + 1, g1["top"], g1["m"][1])], hold=1.0, steps=40)
        tr = pg.evaluate("window.__sandbox.S().trees"); print("trees planted:", len(tr), sorted(set(t.get("b") or 0 for t in tr)))
        trace.append({"step": "trees", "seen": seen, "trees": {"some": len(tr) > 0, "on a roof": any(t.get("b") for t in tr), "on the ground": any(not t.get("b") for t in tr)}})

        # ---- save, reload
        pg.evaluate("() => dispatchEvent(new Event('beforeunload'))"); time.sleep(0.3)
        land = pg.evaluate("JSON.parse(localStorage.getItem('panelki_sandbox_v1')).land")
        trace.append({"step": "land", "hash": hashlib.sha1(json.dumps(land).encode()).hexdigest()})
        blocks_before = state()
        pg.keyboard.press("h"); pg.mouse.move(3, 3); time.sleep(0.8); pg.screenshot(path=os.path.join(HERE, "out", f"desktop_{MODE}_town.png")); pg.keyboard.press("h")
        pg.goto(f"http://127.0.0.1:{port}/index.html"); pg.wait_for_function("window.__ready", timeout=60000); time.sleep(1)
        trace.append({"step": "reload keeps the town", "seen": state() == blocks_before})
        trace.append({"step": "errors", "seen": errs})
        b.close()
    return trace


def diff(a, b, path=""):
    if type(a) != type(b): return [f"{path}: {a!r} != {b!r}"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)): out += diff(a.get(k), b.get(k), f"{path}.{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b): return [f"{path}: length {len(a)} != {len(b)}"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)): out += diff(x, y, f"{path}[{i}]")
        return out
    if isinstance(a, float): return [] if abs(a - b) < 0.02 else [f"{path}: {a} != {b}"]
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


if __name__ == "__main__":
    t = run(); base = os.path.join(HERE, "desktop_baseline.json")
    if MODE == "record":
        json.dump(t, open(base, "w"), indent=1); print(f"recorded {len(t)} steps")
    else:
        d = diff(json.load(open(base)), t)
        print("\n".join(d[:60]) if d else "SAME as the baseline"); sys.exit(1 if d else 0)
