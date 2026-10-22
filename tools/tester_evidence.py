#!/usr/bin/env python3
"""Did the tester agent of a headless build session actually run anything?  `tools/tester_evidence.py <session-id>`
Exit 0 if some subagent of that session had type "tester" and a Bash call that ran a check (check.py, node, playwright,
pytest, a worker test...); exit 1 otherwise. A verifier can report PASS without executing a test; the pipeline treats
that as INCOMPLETE. `--selftest` checks the matching. Stdlib only.
"""
import glob
import json
import os
import re
import sys

RAN = re.compile(r"check\.py|\bnode\b|playwright|pytest|npm (run )?test|worker_test|\bpython3? [\w./-]+\.py")


def ran_checks(jsonl_lines):
    """True if any assistant Bash tool_use in the transcript lines ran something matching RAN."""
    for line in jsonl_lines:
        try:
            content = json.loads(line).get("message", {}).get("content")
        except ValueError:
            continue
        for b in content if isinstance(content, list) else []:
            if b.get("type") == "tool_use" and b.get("name") == "Bash" and RAN.search(str(b.get("input", {}).get("command", ""))):
                return True
    return False


def evidence(sid):
    """(tester agents found, any of the session's subagents ran checks)"""
    d = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{sid}/subagents"))
    metas = [m for x in d for m in glob.glob(f"{x}/*.meta.json")]
    testers = [m for m in metas if json.load(open(m)).get("agentType") == "tester"]
    return len(testers), any(ran_checks(open(m[:-10] + ".jsonl")) for m in metas)


def _selftest():
    ok = json.dumps({"message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "timeout 9 python3 check.py"}}]}})
    no = json.dumps({"message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "cat spec.md"}}]}})
    assert ran_checks(["junk", no, ok]) and not ran_checks([no, "junk"]) and not ran_checks([])
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        _selftest()
    else:
        n, ran = evidence(sys.argv[1])
        sys.exit(0 if n and ran else 1)
