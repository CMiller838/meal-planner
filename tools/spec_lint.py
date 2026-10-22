#!/usr/bin/env python3
"""Pre-flight for unattended builds: fail a spec the pipeline could not verify, warn about specs it would skip.

`tools/spec_lint.py [specs...]` (no args: the queue). Exit 1 if a queued spec has no tier tag, no `## Files touched`,
or no `## Verification` with a runnable command in backticks. `SPEC RISK` lines (Windows/Edge, credentials, real device) are advisory. Specs on disk that the queue skips are printed as
warnings only. `--selftest` checks the parsing. Stdlib only.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workflow_audit  # noqa: E402  (queue parsing stays in one place)

ROOT = Path(__file__).resolve().parent.parent
SPECS = ROOT / ".claude" / "specs"


def section(text, name):
    m = re.search(rf"^## {name}\b.*?\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1) if m else None


def lint(text):
    """Returns the list of problems with one spec's text."""
    out = []
    if not re.search(r"\[[SML]\]", text.splitlines()[0] if text else ""):
        out.append("first line has no [S|M|L] tier tag")
    files = section(text, "Files touched")
    if not files or not files.strip():
        out.append("no `## Files touched` section")
    ver = section(text, "Verification")
    if not ver or not re.search(r"`[^`\n]+`", ver):
        out.append("no `## Verification` section with a runnable command in backticks")
    return out


RISKS = [(r"/mnt/[a-z]/|\b[A-Z]:\\|\bEdge\b|powershell", "touches Windows paths or Edge: needs the path allowed in .claude/settings.local.json"),
         (r"\b(API key|token|credential|secret)\b(?! scan)", "mentions a credential: an unattended builder cannot supply one"),
         (r"\b(real|actual) (phone|device|pack|barcode)\b|\bPixel\b", "needs a real device: must be a `- [ ] Live:` line, not a Verification step")]


def risks(text):
    """Warnings for what could stop an unattended run (a human step, a credential, a path outside the repo). Advisory only."""
    ver = (section(text, "Verification") or "") + (section(text, "Tasks") or "")
    if re.search(r"no real credential", ver, re.I):  # spec states its tokens are test fakes (e.g. worker_test.mjs's)
        ver = re.sub(RISKS[1][0], "", ver, flags=re.I)
    return [why for pat, why in RISKS if re.search(pat, ver, re.I)]


def main(args):
    roadmap = (ROOT / "docs" / "roadmap.md").read_text(encoding="utf-8")
    on_disk = sorted(p.name for p in SPECS.glob("phase*.md"))
    tasks = (ROOT / "tasks.md").read_text(encoding="utf-8")
    queued = workflow_audit.queue(roadmap, set(on_disk), tasks)
    bad = 0
    for name in [a.removesuffix(".md") for a in args] or queued:
        if not (SPECS / f"{name}.md").exists():  # [S] phase: its plan is the tasks.md section, nothing to lint
            continue
        for p in lint((SPECS / f"{name}.md").read_text(encoding="utf-8")):
            print(f"SPEC LINT {name}: {p}")
            bad = 1
        for w in risks((SPECS / f"{name}.md").read_text(encoding="utf-8")):
            print(f"SPEC RISK {name}: {w}")
    for s in on_disk:
        n = re.match(r"phase(\w+?)[a-z]?\.md", s).group(1)
        head = re.search(rf"^## Phase {n}: .*$", roadmap, re.M)
        if not head and int(n) < min(int(x) for x in re.findall(r"^## Phase (\d+):", roadmap, re.M)):
            continue  # older than the active roadmap (archived)
        if s.removesuffix(".md") not in queued and not (head and re.search(r"— (done|built)", head.group())):
            print(f"warning: {s} will NOT be built: " + (f"heading is `{head.group()}`" if head else f"no `## Phase {n}:` heading in the roadmap"))
    return bad


def _selftest():
    good = "# Phase 1: X [M]\n\n## Files touched\n- a.js\n\n## Verification\nRun `python3 check.py`.\n\n## Tasks\n"
    assert lint(good) == []
    assert len(lint("# Phase 1: X\n\n## Tasks\n")) == 3
    assert lint(good.replace("`python3 check.py`", "it works")) == ["no `## Verification` section with a runnable command in backticks"]
    assert risks("## Verification\nrun the Edge walk in `x`\n") and not risks("## Verification\n`python3 check.py`\n")
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        _selftest()
    else:
        sys.exit(main(sys.argv[1:]))
