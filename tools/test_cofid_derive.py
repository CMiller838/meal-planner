#!/usr/bin/env python3
"""Self-check for cofid_derive.py. Uses a temp copy of the data files under $TMPDIR."""
import json, os, shutil, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import cofid_derive as cd

R = Path(__file__).parent.parent
TH = {"high": 20, "med": 10, "low": 5}
T = {"protein_g": 100, "saturates_g_cap": 30, "sodium_mg_cap": 2000}

# boundaries: 4.99 none, 5 low, 10 med, 20 high
assert cd.derive({"protein_g": 4.99}, T, TH) == {}
assert cd.derive({"protein_g": 5}, T, TH) == {"protein": "low"}
assert cd.derive({"protein_g": 10}, T, TH) == {"protein": "med"}
assert cd.derive({"protein_g": 20}, T, TH) == {"protein": "high"}
# absent = unknown, a real 0 is below low: neither is tagged
assert cd.derive({}, T, TH) == {} and cd.derive({"protein_g": 0}, T, TH) == {}
# cap denominators
assert cd.derive({"saturates_g": 6}, T, TH) == {"saturates": "high"}
assert cd.derive({"sodium_mg": 200}, T, TH) == {"sodium": "med"}

tmp = Path(tempfile.mkdtemp(dir=os.environ.get("TMPDIR")))
try:
    (tmp / "tools").mkdir()
    for f in ("cofid.json", "ingredient-nutrient-tags.json", "nutrition-targets.json", "meals.json", "tools/cofid-map.json"):
        shutil.copy(R / f, tmp / f)
    tags = lambda: json.loads((tmp / "ingredient-nutrient-tags.json").read_text())
    cof = json.loads((tmp / "cofid.json").read_text())
    before = tags()
    # mapped + built: apply adds it, keeps existing, idempotent
    cof["map"]["newthing"] = {"default": "X-1"}
    cof["foods"]["X-1"] = {"name": "x", "nutrients": {"protein_g": 40, "fibre_g": 2}}
    (tmp / "cofid.json").write_text(json.dumps(cof))
    cmap = json.loads((tmp / "tools/cofid-map.json").read_text()); cmap["newthing"] = {"default": "X-1"}
    (tmp / "tools/cofid-map.json").write_text(json.dumps(cmap))
    assert cd.apply(tmp) == 0
    after = tags()
    assert after["newthing"] == {"protein": "high", "fibre": "low"} and after["_note"] == before["_note"]
    assert all(after[k] == v for k, v in before.items())
    snap = (tmp / "ingredient-nutrient-tags.json").read_text()
    assert cd.apply(tmp) == 0 and (tmp / "ingredient-nutrient-tags.json").read_text() == snap
    # mapped but not built: fails, writes nothing
    cmap["ghost"] = {"default": "Z-9"}
    (tmp / "tools/cofid-map.json").write_text(json.dumps(cmap))
    assert cd.apply(tmp) == 1 and (tmp / "ingredient-nutrient-tags.json").read_text() == snap
finally:
    shutil.rmtree(tmp)
print("ok")
