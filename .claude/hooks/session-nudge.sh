#!/bin/bash
# Stop: tell the user (not the model) when the session has grown big enough that /clear pays off,
# or when uncommitted work is piling up across phases. Warns once per 100k tokens of growth.
INPUT=$(cat)
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
TRANSCRIPT=$(jq -r '.transcript_path // empty' <<<"$INPUT")
SID=$(jq -r '.session_id // "x"' <<<"$INPUT")
# ponytail: fixed 100k threshold; make it an env var if it nags on real work
LIMIT=100000
msgs=()

# context = what the last main-session turn sent: fresh + cache-written + cache-read input
CTX=$(tail -n 200 "$TRANSCRIPT" 2>/dev/null | jq -s '[.[] | select(.type=="assistant" and (.isSidechain|not)) | .message.usage
  | select(.) | .input_tokens + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)] | last // 0' 2>/dev/null)
STEP=/tmp/claude-ctx-$SID
if (( ${CTX:-0} > LIMIT )); then
    level=$(( CTX / 100000 ))
    if [[ $(cat "$STEP" 2>/dev/null) != "$level" ]]; then
        echo "$level" > "$STEP"
        msgs+=("Context is ~$(( CTX / 1000 ))k tokens and every turn re-reads all of it. Finish or commit this phase, then /clear (specs, memory and CLAUDE.md carry over).")
    fi
fi

# Markdown is not counted: planning several phases leaves a pile of specs by design (they go to /overnight)
DIRTY=$(git status --porcelain -- . ':!*.md' 2>/dev/null | wc -l)
if (( DIRTY > 15 )) && [[ ! -f $STEP.dirty ]]; then
    touch "$STEP.dirty"
    msgs+=("$DIRTY uncommitted files. One phase, one commit: commit the finished phase before starting the next.")
fi

(( ${#msgs[@]} )) && jq -n --arg m "${msgs[*]}" '{systemMessage: $m}'
exit 0
