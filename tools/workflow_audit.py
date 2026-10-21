#!/usr/bin/env python3
"""Weekly workflow audit over this project's Claude Code transcripts: no model, no tokens.

Reports oversized sessions, real auto-mode denials, prompts the user keeps typing (automation candidates) and agent
spawns, into .claude/audits/workflow-<date>.md. Run by the SessionStart hook; it does nothing if the last report is
under 7 days old. `--force` always runs, `--selftest` checks the parsing.
"""
import collections
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRANSCRIPTS = Path.home() / ".claude/projects" / re.sub(r"[^A-Za-z0-9]", "-", str(ROOT))
AUDITS = ROOT / ".claude/audits"
BIG = 150_000
WEEK = 7 * 86400
# user-role messages that tools inject, not the user typing
INJECTED = re.compile(r"(<|\[image|another claude session|review this change for security|you previously flagged)", re.I)


def scan(lines):
    """lines: one transcript's JSONL lines. Returns {peak, denials: [reason], prompts: [text], agents: [type]}."""
    out = {"peak": 0, "denials": [], "prompts": [], "agents": []}
    for line in lines:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        m = d.get("message") or {}
        content = m.get("content")
        if d.get("type") == "assistant" and not d.get("isSidechain"):
            u = m.get("usage") or {}
            out["peak"] = max(out["peak"], u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0)
                              + u.get("cache_creation_input_tokens", 0))
        if d.get("type") == "user" and isinstance(content, str) and not INJECTED.match(content):
            out["prompts"].append(content.strip()[:60])
        for c in content if isinstance(content, list) else []:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_use" and c.get("name") in ("Agent", "Task"):
                out["agents"].append((c.get("input") or {}).get("subagent_type") or "general-purpose")
            if c.get("type") == "tool_result" and c.get("is_error"):
                r = re.search(r"denied by the Claude Code auto mode classifier\. Reason: \[?([^\].]+)", json.dumps(c.get("content")))
                if r:
                    out["denials"].append(r.group(1))
    return out


def report(scans):
    """scans: {session_id: scan()}. Returns the Markdown report."""
    big = sorted(((s["peak"], sid) for sid, s in scans.items() if s["peak"] > BIG), reverse=True)
    denials = collections.Counter(r for s in scans.values() for r in s["denials"])
    norm = collections.Counter(re.sub(r"\d+", "N", p.lower()) for s in scans.values() for p in s["prompts"])
    agents = collections.Counter(a for s in scans.values() for a in s["agents"])
    rows = [f"# Workflow audit {time.strftime('%Y-%m-%d')}", "", f"{len(scans)} sessions in the last 7 days.", "",
            f"## Sessions over {BIG // 1000}k context ({len(big)}): /clear earlier"]
    rows += [f"- {sid[:8]}: {peak // 1000}k" for peak, sid in big[:10]] or ["- none"]
    rows += ["", "## Auto-mode denials"] + ([f"- {r}: {n}" for r, n in denials.most_common()] or ["- none"])
    rows += ["", "## Prompts typed 3+ times (script or skill candidates)"]
    rows += [f"- {n}x `{p}`" for p, n in norm.most_common() if n >= 3] or ["- none"]
    rows += ["", "## Agent spawns"] + ([f"- {a}: {n}" for a, n in agents.most_common()] or ["- none"])
    return "\n".join(rows) + "\n", len(big), sum(denials.values())


def phases(roadmap):
    """roadmap: docs/roadmap.md text. Returns [(number, heading)] of open phases with 'not started' in the heading."""
    return re.findall(r"^## Phase (\w+): (.*not started.*)$", roadmap, re.M)


def queue(roadmap, specs):
    """Spec names the pipeline should build, in roadmap order: not-started phases whose spec (or sub-specs
    phaseNa.md, phaseNb.md, ...) exists in `specs`."""
    return [s[:-3] for n, _ in phases(roadmap) for s in sorted(specs) if re.fullmatch(rf"phase{n.lower()}[a-z]?\.md", s)]


def order(names, texts):
    """names: queue in roadmap order; texts: {name: spec text}. A failed stage stops the queue, so specs with a
    `Risk: high` line go last, together with every spec that `Requires Phase <theirs>` (transitively)."""
    moved = {n for n in names if re.search(r"^Risk: high", texts.get(n, ""), re.M)}
    grew = True
    while grew:
        grew = False
        for n in names:
            if n not in moved and any(re.search(rf"Requires Phase {re.match(r'phase(\w+)', m).group(1)}\b", texts.get(n, "")) for m in moved):
                moved.add(n)
                grew = True
    return [n for n in names if n not in moved] + [n for n in names if n in moved]


def block(roadmap, spec, reason, date):
    """Mark the phase of `spec` (phase33a -> Phase 33a, else Phase 33) blocked in its heading: any trailing
    '— status' is replaced by '— blocked <date>: <reason>'. The queue parser needs 'not started', so it is not requeued."""
    n = spec.removesuffix(".md").removeprefix("phase")
    for cand in (n, n.rstrip("abcdefghijklmnopqrstuvwxyz")):
        pat = re.compile(rf"^(## Phase {re.escape(cand)}: .*?)(?: — [^\n]*)?$", re.M)
        if pat.search(roadmap):
            reason = " ".join(reason.split())[:160]
            return pat.sub(lambda m: f"{m.group(1)} — blocked {date}: {reason}", roadmap, count=1)
    return roadmap


def dependents(blocked, names, texts):
    """Specs in `names` that (transitively) say `Requires Phase <id>` of a blocked spec: they cannot be built either."""
    out, grew = set(blocked), True
    while grew:
        grew = False
        for n in names:
            if n not in out and any(re.search(rf"Requires Phase {b.removeprefix('phase')}\b", texts.get(n, "")) for b in out):
                out.add(n)
                grew = True
    return [n for n in names if n in out and n not in blocked]


def open_checks(tasks):
    """tasks: tasks.md text. Returns ['Phase N: item', ...] for every unticked box, under its ## heading."""
    out, head = [], ""
    for line in tasks.splitlines():
        if line.startswith("## "):
            head = line[3:].split(" [")[0].split(" — ")[0]
        elif line.lstrip().startswith("- [ ] "):
            out.append(f"{head}: {line.lstrip()[6:]}")
    return out


def _read(name):
    p = ROOT / name
    return p.read_text(encoding="utf-8") if p.exists() else ""


def next_line():
    """One line for SessionStart: the next phase, what /overnight would build, and open human checks."""
    open_ = phases(_read("docs/roadmap.md"))
    q = queue(_read("docs/roadmap.md"), {p.name for p in (ROOT / ".claude/specs").glob("*.md")})
    nxt = f"Phase {open_[0][0]}: {open_[0][1].split(' [')[0]}" if open_ else "none"
    return (f"Next: {nxt}. /overnight queue: {', '.join(q) or 'empty (plan-phase first)'}. "
            f"Open checks in tasks.md: {len(open_checks(_read('tasks.md')))}.")


def send_checks():
    """Weekly: send the open tasks.md checks to Telegram (tools/notify.py), so they get done in one batch."""
    checks = open_checks(_read("tasks.md"))
    if not checks:
        return
    sys.path.insert(0, str(ROOT / "tools"))
    import notify
    notify.send(f"Open checks this week ({len(checks)}):\n" + "\n".join(f"- {x[:150]}" for x in checks))


def main(force):
    print(next_line())
    AUDITS.mkdir(parents=True, exist_ok=True)
    last = max((p.stat().st_mtime for p in AUDITS.glob("workflow-*.md")), default=0)
    if not force and time.time() - last < WEEK:
        return
    cutoff = time.time() - WEEK
    scans = {p.stem: scan(p.open(errors="ignore")) for p in TRANSCRIPTS.glob("*.jsonl") if p.stat().st_mtime > cutoff}
    text, big, denials = report(scans)
    path = AUDITS / f"workflow-{time.strftime('%Y-%m-%d')}.md"
    path.write_text(text, encoding="utf-8")
    try:
        send_checks()
    except Exception as e:  # offline or no bot: the report still stands
        print(f"open-checks message not sent: {e!r}")
    print(f"Weekly workflow audit: {len(scans)} sessions, {big} over {BIG // 1000}k context, {denials} denials. "
          f"Tell the user and propose fixes from {path.relative_to(ROOT)}.")


def _selftest():
    lines = [
        json.dumps({"type": "assistant", "message": {"usage": {"input_tokens": 5, "cache_read_input_tokens": 200_000},
                                                      "content": [{"type": "tool_use", "name": "Agent", "input": {"subagent_type": "tester"}}]}}),
        json.dumps({"type": "assistant", "isSidechain": True, "message": {"usage": {"input_tokens": 9_999_999}}}),
        json.dumps({"type": "user", "message": {"content": "commit phase 3"}}),
        json.dumps({"type": "user", "message": {"content": "<command-name>/clear</command-name>"}}),
        json.dumps({"type": "user", "message": {"content": "Another Claude session sent a message: hi"}}),
        json.dumps({"type": "user", "message": {"content": [{"type": "tool_result", "is_error": True, "content":
                    "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Self-Modification]. x"}]}}),
        json.dumps({"type": "user", "message": {"content": [{"type": "tool_result", "content": "text mentioning denied and classifier"}]}}),
        "not json",
    ]
    s = scan(lines)
    assert s == {"peak": 200_005, "denials": ["Self-Modification"], "prompts": ["commit phase 3"], "agents": ["tester"]}, s
    text, big, denials = report({"a": s, "b": dict(s, peak=0), "c": scan(lines[2:3])})
    assert big == 1 and denials == 2 and "3x `commit phase N`" in text and "- tester: 2" in text, text
    rm = ("## Phase 9: Cards [M] — built, live test pending\n## Phase 38: Undo [M] — added 2026-10-17, not started\n"
          "## Phase 39: Exams [L] — not started\n## Phase 40b: Marks [M] — not started\n")
    assert [n for n, _ in phases(rm)] == ["38", "39", "40b"]
    assert queue(rm, {"phase40b.md", "phase38.md", "phase9.md"}) == ["phase38", "phase40b"]
    assert queue("## Phase 4: X — not started\n## Phase 43: Y — not started\n",
                 {"phase43b.md", "phase43a.md", "phase40.md", "phase4.md"}) == ["phase4", "phase43a", "phase43b"]
    t = {"phase33a": "Risk: high\n", "phase33b": "Requires Phase 33a (x)", "phase34": "**Requires Phase 33a**", "phase35": "", "phase41": "Requires Phase 35"}
    assert order(["phase33a", "phase33b", "phase34", "phase35", "phase41"], t) == ["phase35", "phase41", "phase33a", "phase33b", "phase34"]
    assert order(["phase1", "phase2"], {}) == ["phase1", "phase2"]
    assert open_checks("## Phase 10\n- x\n  - [ ] sub\n") == ["Phase 10: sub"]
    assert open_checks("## Phase 36 — done\n- [x] a\n- [ ] tap Snooze\n## Phase 37 [M]\n- [ ] live\n") == [
        "Phase 36: tap Snooze", "Phase 37: live"]
    rb = "## Phase 33: A [L] — not started\n## Phase 40b: B [M] — added 2026-10-17, not started\n"
    assert block(rb, "phase33a.md", "needs\nsandbox", "D") == "## Phase 33: A [L] — blocked D: needs sandbox\n## Phase 40b: B [M] — added 2026-10-17, not started\n"
    assert "## Phase 40b: B [M] — blocked D: x\n" in block(rb, "phase40b", "x", "D")
    assert dependents(["phase33a"], ["phase33a", "phase33b", "phase34", "phase35"],
                      {"phase33b": "Requires Phase 33a", "phase34": "Requires Phase 33b"}) == ["phase33b", "phase34"]
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        _selftest()
    elif sys.argv[1:] == ["--checks"]:
        print("\n".join(open_checks(_read("tasks.md"))))
    elif sys.argv[1:2] == ["--block"]:  # --block <spec> <reason>: mark its roadmap heading blocked
        rm = ROOT / "docs/roadmap.md"
        rm.write_text(block(rm.read_text(), sys.argv[2], sys.argv[3], time.strftime("%Y-%m-%d")))
    elif sys.argv[1:2] == ["--dependents"]:  # --dependents <blocked> <spec...>: those that require it
        print(" ".join(dependents([sys.argv[2]], sys.argv[3:], {n: _read(f".claude/specs/{n}.md") for n in sys.argv[3:]})))
    elif sys.argv[1:] == ["--queue"]:
        q = queue(_read("docs/roadmap.md"), {p.name for p in (ROOT / ".claude/specs").glob("*.md")})
        print(" ".join(order(q, {n: _read(f".claude/specs/{n}.md") for n in q})))
    else:
        main("--force" in sys.argv)
