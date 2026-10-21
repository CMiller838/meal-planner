#!/usr/bin/env python3
"""Run every self-check, the secret scan, the UI selftest and the UI build; one line each, non-zero exit on failure.

`python3 check.py` runs everything. `python3 check.py core api` runs only those (ui = UI selftest + build).
`--changed` runs only what the uncommitted changes need (the Stop hook). Stdlib only.
Top-level modules with a `--selftest` flag get it (their bare run may do real work); modules defining `_selftest()`
without the flag self-check when run bare. Failures print the tail of their output.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LEGACY = {"check"}  # top-level modules to skip
CORE = {"check"}  # modules everything imports; a change to one re-runs every check
UI = ROOT / "ui"  # no UI package here (static site); skipped if absent
BROWSER = ROOT / "tools" / "browser-check"  # Playwright test tooling (ui-check.mjs, walk.mjs)
THEME_KEY = "mp_theme"  # localStorage key the app reads its theme from
TAIL = 30
SECRET_RE = re.compile(r"AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\b\d{8,10}:[A-Za-z0-9_-]{35}"
                       r"|sk-[A-Za-z0-9_-]{20,}|xox[abp]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----")


def python_checks():
    for path in sorted(ROOT.glob("*.py")):
        name = path.stem
        if name in LEGACY:
            continue
        src = path.read_text(encoding="utf-8")
        if '"--selftest"' in src:
            yield name, [sys.executable, path.name, "--selftest"]
        elif "_selftest()" in src:
            yield name, [sys.executable, path.name]


def scan_secrets(files, allow=()):
    """files: {path: text}. Returns ["path:line", ...] for secret-shaped strings not in `allow` (path:line entries)."""
    return [f"{p}:{n}" for p, text in files.items() for n, line in enumerate(text.splitlines(), 1)
            if SECRET_RE.search(line) and f"{p}:{n}" not in allow]


def secrets_check():
    """Scan every git-tracked text file. Allowlist: .claude/secret_ignore.txt, one path:line per row (# comments)."""
    names = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    files = {}
    for n in filter(None, names):
        try:
            files[n] = (ROOT / n).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            pass  # deleted-but-tracked, or binary
    ig = ROOT / ".claude" / "secret_ignore.txt"
    allow = {l.strip() for l in ig.read_text().splitlines() if l.strip() and not l.startswith("#")} if ig.exists() else set()
    hits = scan_secrets(files, allow)
    print("\n".join(f"secret-shaped string at {h} (rotate it, or allowlist in .claude/secret_ignore.txt)" for h in hits))
    return 1 if hits else 0


def all_checks():
    yield from python_checks()
    yield "secrets", [sys.executable, "check.py", "--secrets"]
    if (BROWSER / "ui-check.mjs").exists():
        # real-browser checks: test.html + every page at PC and phone width in both themes; then the click-through
        rel = BROWSER.relative_to(ROOT)
        pre = f'cd {rel} && {{ test -d node_modules || {{ echo "run: cd {rel} && npm ci"; exit 1; }}; }} && '
        yield "ui pages", ["bash", "-c", pre + f"node ui-check.mjs --theme-key {THEME_KEY}"]
        yield "ui walk", ["bash", "-c", pre + "node walk.mjs"]
    if (UI / "package.json").exists():
        yield "ui selftest", ["npm", "run", "--silent", "selftest"]
        yield "ui build", ["npm", "run", "--silent", "build"]


def run(name, cmd):
    cwd = UI if name.startswith("ui ") and UI.exists() else ROOT
    env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(BROWSER / ".browsers")} if (BROWSER / ".browsers").exists() else None
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=300, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, repr(e)
    return p.returncode == 0, (p.stdout + p.stderr)


def pick(files, names):
    """files: changed paths; names: every check name. Returns the checks those changes need: all of them when a
    CORE module changed, else each changed module's own plus ui on UI changes. Docs-only changes need none."""
    py = {f[:-3] for f in files if f.endswith(".py") and "/" not in f}
    if py & CORE:
        return list(names)
    ui = any(f.startswith(f"{UI.name}/") and not f.endswith(".md") for f in files)
    web = any(f.endswith((".js", ".html", ".json", ".css")) and "/" not in f or f.startswith("worker/") for f in files)
    return [n for n in names if n in py or (ui and n.startswith("ui ")) or (web and n.startswith("ui ") and not UI.exists())]


def changed_files():
    git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.split()
    return git("diff", "HEAD", "--name-only") + git("ls-files", "-o", "--exclude-standard")


def main(argv):
    if argv == ["--changed"]:
        # quick check for the Stop hook; the pre-commit hook still runs everything
        argv = pick(changed_files(), [n for n, _ in all_checks() if n != "secrets"])
        if not argv:
            print("nothing to check")
            return 0
    want = set(argv)
    checks = [(n, c) for n, c in all_checks() if not want or n in want or (n.startswith("ui ") and "ui" in want)]
    if not checks:
        sys.exit(f"no checks match {' '.join(argv)}")
    failed = []
    for name, cmd in checks:
        ok, out = run(name, cmd)
        print(f"{'ok  ' if ok else 'FAIL'} {name}", flush=True)
        if not ok:
            failed.append(name)
            lines = [l for l in out.splitlines() if l.strip() and not re.match(r"^\s*(vite|transforming|rendering)", l)]
            print("\n".join("     " + l for l in lines[-TAIL:]))
    print(f"\n{len(checks) - len(failed)}/{len(checks)} passed" + (f"; failed: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


def _selftest():
    found = dict(python_checks())
    assert "check" not in found  # never runs itself
    fake = "AIza" + "a" * 35
    assert scan_secrets({"a.py": f"x\nk = '{fake}'\n", "b.txt": "AIza-short", "c.md": "ok"}) == ["a.py:2"]
    assert scan_secrets({"a.py": f"k = '{fake}'"}, {"a.py:1"}) == []
    assert scan_secrets({"t": "-----BEGIN RSA PRIV" "ATE KEY-----\n123456789:" + "A" * 35}) == ["t:1", "t:2"]
    names = ["check", "server", "ui selftest", "ui build"]
    assert pick(["CLAUDE.md", "ui/CLAUDE.md", "docs/x.md"], names) == []
    assert pick(["server.py", "tools/x.py"], names) == ["server"]
    assert pick(["ui/src/a.svelte"], names) == ["ui selftest", "ui build"]
    assert pick(["check.py"], names) == names
    assert pick(["plan.js", "style.css"], ["data_check", "ui pages", "ui walk"]) == ["ui pages", "ui walk"]
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        _selftest()
    elif sys.argv[1:] == ["--secrets"]:
        sys.exit(secrets_check())
    else:
        sys.exit(main(sys.argv[1:]))
