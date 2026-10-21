---
name: live
description: Work through the open human-only checks in tasks.md with the user, in one sitting - launch the app, present each check as exact steps plus the expected result, record pass/fail/skip, tick tasks.md, mark phases done whose last check passed. Use when the user says "/live", "live checks", "live test", "let's do the checks", "go through what needs me", or asks to clear the "built, live checks pending" phases.
---

# Live checks with the user

The user is here and ready to try things; make every minute count. Runs in the main session (a subagent
can't ask questions). Never re-test what the tester already verified; these are the checks only the user can do.

## 1. Collect

`python3 tools/workflow_audit.py --checks` lists every unticked box as `Phase N: item`. Keep the human-only ones
(`Live`, `Manual`, `Review`, `User`, `Still needs you`, decisions). Drop `Blocked` lines and `Commit ...` lines
(step 4 handles those). Group by what each needs set up, cheapest first:
by eye in the browser → typed input → phone → real accounts/hardware.

Show one short numbered list with the groups and ask which groups to do now (AskUserQuestion, multiSelect,
recommended: everything without new hardware or accounts).

**Scoped to one phase** (invoked with a phase/spec name, e.g. right after `/build` passes): keep only that
phase's checks and skip the group question. If it has none, say so in one line and stop. The build's tester
already launched the latest code, so skip step 2 unless the user says the app isn't running.

## 2. Launch

Start the app once the way CLAUDE.md "Commands" says (or the project's launch skill, if it has one); skip if the
user says it's already running. Open nothing else; the user drives.

## 3. Check, four at a time

One AskUserQuestion call per batch of up to 4 checks, one question each:
- question: the steps in imperative form (where to click/say, with the exact URL
  or phrase) and **what they should see**. Read the phase's spec (`.claude/specs/phaseN.md`) only when the
  task line is too vague to say what "right" looks like.
- options: `Pass`, `Fail` (they describe it in Other/notes), `Skip for now`. Decision items get the real choices
  instead, recommended first.

Record answers straight away in `tasks.md` (Edit by exact line text):
- Pass → `- [x]`, append ` (live <YYYY-MM-DD>)`.
- Fail → stays `- [ ]`, append ` — FAILED <date>: <what happened>`. If it's a small code defect, offer to fix it
  after the batch (normal build rules: the checks, launch again, the user re-checks). Otherwise leave it.
- Decision → `- [x]`, append the choice; if it changes behaviour, it's a fix like any other.
- Skip → leave untouched.

A failure that blocks the rest of its group (app down, a device not working): stop that group, note why, move on.

## 4. Close out

- Every phase whose tasks.md section now has no unticked boxes: follow the `roadmap-gating` skill to mark its
  roadmap heading `— done` with "live checks passed <date>".
- Report in a few lines: passed, failed (with the line), skipped, phases now done.
- Ask once whether to commit (`chore: live checks <date>`, plus `fix:` commits for any fixes made).
