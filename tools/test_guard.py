#!/usr/bin/env python3
"""Pre-commit guard: fail when a commit removes more test assertions than it adds in the protected test files.

An unattended builder can "pass" by loosening a test instead of fixing the code. This reads the staged diff only,
so it is deterministic and the builder cannot argue with it. A real rewrite: `ALLOW_TEST_EDIT=1 git commit ...`.
`--selftest` checks the counting. Stdlib only.
"""
import os
import re
import subprocess
import sys

PROTECTED = re.compile(r"^(test\.html|data_check\.py|tools/browser-check/[^/]+\.mjs)$")
ASSERT = re.compile(r"\bassert\b|\bcheck\(|\bexpect\(")


def net_removed(diff):
    """diff: `git diff --cached -U0` text. Returns {protected path: removed - added assertion lines} where > 0."""
    path, net = None, {}
    for line in diff.splitlines():
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else None
        elif line.startswith("--- "):
            continue
        elif path and PROTECTED.match(path) and line[:1] in "+-" and ASSERT.search(line):
            net[path] = net.get(path, 0) + (1 if line[0] == "-" else -1)
    return {p: n for p, n in net.items() if n > 0}


def _selftest():
    d = "--- a/test.html\n+++ b/test.html\n@@\n-  check('a', x)\n-  check('b', y)\n+  check('a', true)\n"
    assert net_removed(d) == {"test.html": 1}
    assert net_removed(d.replace("test.html", "other.js")) == {}
    assert net_removed("--- a/data_check.py\n+++ b/data_check.py\n@@\n+    assert x\n") == {}


def main():
    _selftest()
    if os.environ.get("ALLOW_TEST_EDIT") == "1":
        return 0
    diff = subprocess.run(["git", "diff", "--cached", "-U0"], capture_output=True, text=True).stdout
    bad = net_removed(diff)
    for p, n in bad.items():
        print(f"{p}: {n} more assertion line(s) removed than added. Fix the code, not the test (ALLOW_TEST_EDIT=1 for a real rewrite)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
