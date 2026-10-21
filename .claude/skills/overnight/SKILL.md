---
name: overnight
description: Use when the user says "overnight", "build the queue", "run the pipeline" or "build phases N M". Runs ONE script (tools/overnight.sh) and ends the turn; never watches or polls.
---

# Overnight build

Run exactly one command, report its output, and stop. No extra pre-flight, no queue listing, no polling or waiting
for results afterwards: waiting in this session burns usage for nothing. The script does the pre-flight itself and
the pipeline reports to Telegram.

1. Run, with the Bash sandbox off (`dangerouslyDisableSandbox: true`: `claude -p` and the Telegram
   report need network): `tools/overnight.sh [specs...]` (specs only if the user named phases, e.g.
   `phase38 phase39`; otherwise no arguments = the queue).
2. Relay its output in two or three lines and end the turn:
   - `STARTED` + stages: say which specs and stages are queued. Results arrive on Telegram and in
     `.claude/build-status.json`. Say nothing else; do not check on it.
   - `DIRTY TREE` (app code uncommitted): show the file list and ask whether to commit or stash it. Never commit it
     to unblock the run.
   - `ALREADY RUNNING`: say so.
   - queue empty: specs come from `/plan-phase N`. Never plan phases here.
3. Never `git add -A`, never push, never start `tools/pipeline.sh` directly (it skips the pre-flight).

A pipeline stage that is not PASS stops the queue; the Telegram message carries a `claude -r <id>` resume line.
Big specs are split by the pipeline itself into one fresh session per numbered section (or Logic then UI), so
nothing here needs `/clear`.
