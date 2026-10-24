#!/usr/bin/env bash
# One command to start the unattended build and walk away: pre-flight, then tools/pipeline.sh detached.
#   tools/overnight.sh [specs...]      (no args: the queue)
# Prints a few lines and returns at once. Results arrive on Telegram and in .claude/build-status.json;
# logs/pipeline.out is the run log. Nothing needs to watch or poll it.
set -uo pipefail
cd "$(dirname "$0")/.."

# `sleep` / `--sleep` anywhere in the args: put the PC to sleep once the queue has finished or stopped
args=(); export PIPELINE_SLEEP=0
for a in "$@"; do if [ "$a" = sleep ] || [ "$a" = --sleep ]; then PIPELINE_SLEEP=1; else args+=("$a"); fi; done
set -- ${args[@]+"${args[@]}"}

# only a pipeline running in THIS repo counts; other projects' pipelines are independent and may run in parallel
running=$(for p in $(pgrep -f 'tools/pipeline.sh'); do [ "$(readlink "/proc/$p/cwd")" = "$PWD" ] && ps -o pid=,args= -p "$p"; done | head -1)
if [ -n "$running" ]; then
    echo "ALREADY RUNNING: $running. Not starting a second one."; exit 3
fi

# workflow/tooling files are safe to commit before the run; app code is not (it is someone's half-built phase)
dirty=$(git status --porcelain --untracked-files=no | sed 's/^...//')
if [ -n "$dirty" ]; then
    other=$(grep -v -E '^(CLAUDE\.md|WORKFLOW\.md|tasks\.md|docs/roadmap\.md|\.claude/(agents|skills|archive)/|tools/)' <<<"$dirty")
    if [ -n "$other" ]; then
        echo "DIRTY TREE, not starting. App/doc changes that are not workflow files:"; echo "$other"
        echo "Finish and commit them, or stash them, then run again."; exit 2
    fi
    git add -- $dirty && git commit -q -m "chore: workflow and tooling changes before overnight run" \
        || { echo "chore commit failed (pre-commit check?), not starting"; exit 2; }
    echo "committed workflow files as a chore: $(git log --oneline -1)"
fi

python3 tools/spec_lint.py "$@" || { echo "Fix the specs above (or run plan-phase again), not starting."; exit 2; }
plan=$(tools/pipeline.sh --plan "$@" 2>&1) || { echo "$plan"; exit 2; }
setsid nohup tools/pipeline.sh "$@" > logs/pipeline.out 2>&1 < /dev/null &
sleep 3
pgrep -f 'tools/pipeline.sh' >/dev/null || { echo "pipeline exited at once:"; cat logs/pipeline.out; exit 1; }
echo "STARTED. Stages:"; echo "$plan"
[ "$PIPELINE_SLEEP" = 1 ] && echo "SLEEP MODE: the PC suspends 60 s after the queue finishes or stops."
echo "Results go to Telegram and .claude/build-status.json; log: logs/pipeline.out"
