"""Stamp the game's own scripts with a fingerprint of their contents, so a browser always loads the current version.

    python3 tools/stamp.py        (run before pushing: npm run stamp)

It rewrites, in index.html, the import map (each local .js -> .js?v=<hash>) and the entry script's src. A file whose
contents are unchanged keeps its address, so it stays cached; a changed one gets a new address, so it is loaded anew.
"""
import hashlib, json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html_path = os.path.join(ROOT, "index.html"); html = open(html_path, encoding="utf-8").read()
mods = sorted(f for f in os.listdir(ROOT) if f.endswith(".js"))
h = lambda f: hashlib.sha1(open(os.path.join(ROOT, f), "rb").read()).hexdigest()[:8]
m = re.search(r'<script type="importmap">(.*?)</script>', html, re.S); imap = json.loads(m.group(1))
imap["imports"] = {k: v for k, v in imap["imports"].items() if not k.startswith("./")}        # (three and its addons stay)
for f in mods: imap["imports"][f"./{f}"] = f"./{f}?v={h(f)}"
html = html[:m.start(1)] + json.dumps(imap, indent=1) + html[m.end(1):]
html = re.sub(r'<script type="module" src="\./sandbox\.js(\?v=[0-9a-f]+)?"></script>', f'<script type="module" src="./sandbox.js?v={h("sandbox.js")}"></script>', html)
open(html_path, "w", encoding="utf-8").write(html)
print("stamped:", ", ".join(f"{f}={h(f)}" for f in mods))
