#!/bin/bash
# Stop: run check.py if the working tree changed since the last green run. A failure blocks the stop once,
# with the failing output as the reason, so Claude fixes it instead of finishing on red.
INPUT=$(cat)
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[[ -f check.py ]] || exit 0
STAMP=.claude/.last-green
# hash of every uncommitted change, tracked and untracked (gitignore respected)
# Markdown (specs, docs, tasks.md) is left out: planning sessions only edit those, and check.py has nothing to say about them
HASH=$( { git diff HEAD -- . ':!*.md' 2>/dev/null; git ls-files -o --exclude-standard -z -- . ':!*.md' | xargs -0 -r cat 2>/dev/null; } | md5sum | cut -d' ' -f1)
[[ -f $STAMP && $(cat "$STAMP") == "$HASH" ]] && exit 0
# only the checks the changed files need (docs-only = none); pre-commit still runs the full check.py
if OUT=$(python3 check.py --changed 2>&1); then
    echo "$HASH" > "$STAMP"
    exit 0
fi
# already blocked once this turn: let it stop, but say so
if [[ $(jq -r '.stop_hook_active' <<<"$INPUT") == true ]]; then
    echo "check.py still failing:" >&2; tail -40 <<<"$OUT" >&2
    exit 0
fi
jq -n --arg r "check.py failed; fix before finishing:
$(tail -40 <<<"$OUT")" '{decision: "block", reason: $r}'
