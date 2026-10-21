#!/usr/bin/env python3
"""Static self-check for the data files and the PWA shell. Stdlib only; `python3 data_check.py` (`--selftest` also asserts the checker's own logic first).

Fails on: a JSON file that does not parse; a meal with a missing/duplicate id or no ingredients; a page that loads a
local script/stylesheet that is missing or absent from sw.js's SHELL (offline shell); a SHELL entry that does not exist;
a worker import that does not resolve; shell/data files changed since HEAD without bumping sw.js's CACHE.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NOT_SHELL = {"test.html"}  # dev-only page, never cached


def shell_list(sw):
    body = re.search(r"const SHELL = \[(.*?)\];", sw, re.S).group(1)
    return re.findall(r'"([^"]+)"', body)


def page_refs(html):
    return [m for m in re.findall(r'<script[^>]+src="([^"]+)"|<link[^>]+href="([^"]+)"', html) for m in m if m
            and not m.startswith(("http", "//", "data:", "#"))]


def bad_meals(meals):
    errs, seen = [], set()
    for i, m in enumerate(meals):
        mid = m.get("id")
        if not mid or not m.get("name"):
            errs.append(f"meals.json[{i}]: id and name are required")
        elif mid in seen:
            errs.append(f"meals.json: duplicate id {mid}")
        seen.add(mid)
        if not m.get("ingredients") or not all(x.get("key") for x in m["ingredients"]):
            errs.append(f"meals.json {mid}: ingredients need a key each")
        r = m.get("routine")
        if r is not None and (r.get("when") not in ("daily", "gymDays") or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(r.get("time")))):
            errs.append(f"meals.json {mid}: bad routine {r}")
        steps = m.get("method")
        if not steps or m.get("methodStatus") not in ("drafted", "accepted"):
            errs.append(f"meals.json {mid}: seeded meals need a method and a methodStatus")
        for st in steps or []:
            mins = st.get("minutes", 1)
            if not str(st.get("text", "")).strip() or len(st["text"]) > 300 or not isinstance(mins, int) or not 1 <= mins <= 600:
                errs.append(f"meals.json {mid}: bad method step {st}")
            if re.search(r"mushroom", st.get("text", ""), re.I):
                errs.append(f"meals.json {mid}: method mentions an excluded ingredient")
    return errs


def needs_bump(changed, sw_now, sw_head):
    """changed: paths differing from HEAD. True if a cached file changed but the CACHE name did not."""
    shell = {s for s in shell_list(sw_now) if s != "./"}
    cache = lambda s: re.search(r'const CACHE = "([^"]+)"', s).group(1)
    return bool(shell & set(changed)) and cache(sw_now) == cache(sw_head)


def check():
    errs = []
    for p in sorted(ROOT.glob("*.json")):
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except ValueError as e:
            errs.append(f"{p.name}: {e}")
    if errs:
        return errs
    errs += bad_meals(json.loads((ROOT / "meals.json").read_text(encoding="utf-8")))
    c = json.loads((ROOT / "counters.json").read_text(encoding="utf-8"))
    mg = c.get("caffeine", {}).get("cupMg", {})
    if not mg or not all(isinstance(v, int) and v > 0 for v in mg.values()) or not isinstance(c.get("waterGoal"), int) or c["waterGoal"] < 0:
        errs.append("counters.json: need caffeine.cupMg (positive ints) and waterGoal (int >= 0)")
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    shell = shell_list(sw)
    errs += [f"sw.js SHELL lists missing file {s}" for s in shell if s != "./" and not (ROOT / s).exists()]
    for page in sorted(ROOT.glob("*.html")):
        for ref in page_refs(page.read_text(encoding="utf-8")):
            ref = ref.split("?")[0]
            if not (ROOT / ref).exists():
                errs.append(f"{page.name} loads missing {ref}")
            elif page.name not in NOT_SHELL and ref not in shell:
                errs.append(f"{page.name} loads {ref}, which sw.js SHELL does not cache")
        if page.name not in NOT_SHELL and page.name not in shell:
            errs.append(f"sw.js SHELL does not cache {page.name}")
    for ref in re.findall(r'^import (?:\w+ from )?"(\.\./[^"]+)"', (ROOT / "worker/worker.js").read_text(encoding="utf-8"), re.M):
        if not (ROOT / "worker" / ref).resolve().exists():
            errs.append(f"worker/worker.js imports missing {ref}")
    git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True)
    head = git("show", "HEAD:sw.js")
    if head.returncode == 0:
        changed = git("diff", "HEAD", "--name-only").stdout.split()
        if needs_bump(changed, sw, head.stdout):
            errs.append("shell/data files changed but sw.js CACHE name did not: bump meal-planner-vN")
    return errs


def _selftest():
    sw = 'const CACHE = "c-v1";\nconst SHELL = [\n "./",\n "a.js",\n "b.json",\n];'
    assert shell_list(sw) == ["./", "a.js", "b.json"]
    assert page_refs('<script src="a.js"></script><link rel="x" href="https://e/x.css"><link href="s.css">') == ["a.js", "s.css"]
    ok = {"method": [{"text": "t", "minutes": 5}], "methodStatus": "drafted"}
    assert bad_meals([{"id": "x", "name": "X", "ingredients": [{"key": "k"}], **ok}] * 2) == ["meals.json: duplicate id x"]
    assert bad_meals([{"id": "y", "name": "Y", "ingredients": [], **ok}]) == ["meals.json y: ingredients need a key each"]
    assert len(bad_meals([{"id": "z", "name": "Z", "ingredients": [{"key": "k"}]}])) == 1  # no method
    assert len(bad_meals([{"id": "z", "name": "Z", "ingredients": [{"key": "k"}], "method": [{"text": "t", "minutes": 0}], "methodStatus": "drafted"}])) == 1
    assert needs_bump(["a.js"], sw, sw) and not needs_bump(["README.md"], sw, sw)
    assert not needs_bump(["a.js"], sw.replace("v1", "v2"), sw)
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:  # check.py's convention: the logic asserts, then the real data
        _selftest()
    out = check()
    print("\n".join(out))
    sys.exit(1 if out else 0)
