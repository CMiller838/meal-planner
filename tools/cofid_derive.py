#!/usr/bin/env python3
"""Derive low/med/high nutrient tags for new ingredients from measured CoFID values (cofid.json).
Usage: cofid_derive.py untracked | levels <key> | apply | diff | find <xlsx> <text>   [--root DIR]. Stdlib only.
Level = share of the daily target (nutrition-targets.json) per 100 g, thresholds in tools/cofid-levels.json."""
import json, sys
from pathlib import Path

TAGS = {"protein": "protein_g", "carbohydrate": "carbohydrate_g", "fat": "fat_g", "saturates": "saturates_g",
        "fibre": "fibre_g", "vitA": "vitA_mcg", "vitC": "vitC_mg", "vitD": "vitD_mcg", "vitB12": "vitB12_mcg",
        "folate": "folate_mcg", "calcium": "calcium_mg", "iron": "iron_mg", "zinc": "zinc_mg",
        "magnesium": "magnesium_mg", "potassium": "potassium_mg", "sodium": "sodium_mg"}


def derive(nutrients, targets, thresholds):
    """{tag nutrient: low|med|high} for nutrients at or above `low`; absent nutrient = unknown, never tagged."""
    out = {}
    for tag, ck in TAGS.items():
        base, unit = ck.rsplit("_", 1)
        t = targets.get(ck) or targets.get(f"{base}_{unit}_cap")
        if ck not in nutrients or not t:
            continue
        pct = nutrients[ck] / t * 100
        for lvl in ("high", "med", "low"):
            if pct >= thresholds[lvl]:
                out[tag] = lvl
                break
    return out


def load(root):
    j = lambda p: json.loads((root / p).read_text())
    return (j("cofid.json"), j("ingredient-nutrient-tags.json"), j("nutrition-targets.json"),
            json.loads((Path(__file__).parent / "cofid-levels.json").read_text()), j("tools/cofid-map.json"))


def derived_for(key, cofid, targets, th):
    code = cofid["map"].get(key, {}).get("default")
    food = cofid["foods"].get(code)
    return None if food is None else derive(food["nutrients"], targets, th)


def write_tags(root, tags):
    note = tags.pop("_note", None)
    lines = ([f'  "_note": {json.dumps(note)}'] if note else []) + [f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in tags.items()]
    (root / "ingredient-nutrient-tags.json").write_text("{\n" + ",\n".join(lines) + "\n}\n")


def apply(root):
    cofid, tags, targets, th, cmap = load(root)
    new = sorted(k for k in cmap if k not in tags)
    new_d = {k: derived_for(k, cofid, targets, th) for k in new}
    missing = [k for k, v in new_d.items() if v is None]
    if missing:
        print("no cofid.json food for: " + ", ".join(missing) + " (run cofid_build.py first)", file=sys.stderr)
        return 1
    for k in new:
        tags[k] = new_d[k]
    if new:
        write_tags(root, tags)
    print(f"added {len(new)}: {', '.join(new) or '-'}")
    return 0


def diff(root):
    cofid, tags, targets, th, cmap = load(root)
    for k in sorted(set(cmap) & set(tags)):
        d = derived_for(k, cofid, targets, th)
        if d is None:
            print(f"{k}: no cofid.json food")
            continue
        for n in sorted(set(d) | set(tags[k])):
            if d.get(n) != tags[k].get(n):
                print(f"{k} {n}: tags={tags[k].get(n)} derived={d.get(n)}")
    return 0


def untracked(root):
    cofid, tags, targets, th, cmap = load(root)
    used = sorted({i["key"] for m in json.loads((root / "meals.json").read_text()) for i in m.get("ingredients", [])} - set(tags))
    for k in used:
        print(f"{k}  {'mapped' if k in cmap else 'needs a code'}")
    return 0


def find(xlsx, text):
    import zipfile
    import xml.etree.ElementTree as ET
    from cofid_build import N, read
    z = zipfile.ZipFile(xlsx)
    ss = ["".join(t.text or "" for t in si.iter(N + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(N + "si")]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    rid = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    s = next(s for s in wb.iter(N + "sheet") if s.get("name") == "1.3 Proximates")
    for r in read(z, ss, "xl/" + rels[s.get(rid)].lstrip("/").removeprefix("xl/")):
        if r.get("A") and r.get("B") and text.lower() in r["B"].lower():
            print(f"{r['A']}  {r['B']}")
    return 0


def main(argv):
    root = Path(argv[argv.index("--root") + 1]) if "--root" in argv else Path(__file__).parent.parent
    a = [x for i, x in enumerate(argv) if x != "--root" and (i == 0 or argv[i - 1] != "--root")]
    cmd = a[0] if a else ""
    if cmd == "apply": return apply(root)
    if cmd == "diff": return diff(root)
    if cmd == "untracked": return untracked(root)
    if cmd == "find" and len(a) == 3: return find(a[1], a[2])
    if cmd == "levels" and len(a) == 2:
        cofid, _, targets, th, _ = load(root)
        d = derived_for(a[1], cofid, targets, th)
        print(json.dumps(d) if d is not None else "no cofid.json food", file=sys.stdout if d is not None else sys.stderr)
        return 0 if d is not None else 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
