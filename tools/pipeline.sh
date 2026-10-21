#!/usr/bin/env bash
# Unattended build of agreed specs, in order: build -> tester (one fix round) -> roadmap-gating -> commit.
# A big spec is built in stages, each in its own fresh `claude -p` session (small context, cheap calls):
#   - 2+ numbered task sections (`### 1. ...`): one session per section, each tested and committed
#   - an [L] spec with `### Logic` and `### UI` tasks: Logic session (left uncommitted), then UI + tester + commit
#   - anything else: one session
# A spec whose stage is not PASS is parked (its work saved to logs/blocked-<spec>.*, tree reset), its roadmap heading marked
# "— blocked <date>: <reason>", and the queue goes on, skipping only the specs that "Requires Phase <it>". Exit 1 if any blocked. Reports each result to Telegram via tools/notify.py (NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID) when set, and to .claude/build-status.json for the /next pane. Never pushes.
#   tools/pipeline.sh phase37 phase38        (spec names in .claude/specs, .md optional)
#   tools/pipeline.sh                        (the queue: not-started phases with a spec; the /overnight skill)
#   tools/pipeline.sh --plan [specs...]      (print the stages it would run, change nothing)
# Run it in tmux/a spare terminal and walk away. The post-commit hook runs tools/deploy.sh after each commit when it exists.
set -uo pipefail
# claude -p stops background subagents 10 min after the last turn; 0 = wait for them (the tester can run long)
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
# compact early: every call re-reads the whole context, so a smaller window is cheaper (min 100000, plain integer)
export CLAUDE_CODE_AUTO_COMPACT_WINDOW="${PIPELINE_COMPACT_WINDOW:-150000}"
# security-guidance Stop hook: one review per turn instead of up to 3
export MAX_STOP_HOOK_FIRINGS=1
cd "$(dirname "$0")/.."
mkdir -p logs
PLAN=0
[ "${1:-}" = --plan ] && { PLAN=1; shift; }
# no args: every not-started roadmap phase that already has a spec, in roadmap order
[ $# -gt 0 ] || set -- $(python3 tools/workflow_audit.py --queue)
[ $# -gt 0 ] || { echo "nothing queued: no not-started phase has a spec yet (plan-phase first)" >&2; exit 2; }
# a dirty tree would be swept into the first phase's commit
[ "$PLAN" = 1 ] || [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "uncommitted changes: commit or stash first" >&2; exit 2; }

notify() {
    echo "$1"
    python3 tools/notify.py "$1" >/dev/null 2>&1 || true
}
# PIPELINE_SLEEP=1 (set by `overnight.sh sleep`): suspend Windows 60 s after the queue ends, whatever the outcome
pc_sleep() {
    notify "pipeline: finished, putting the PC to sleep in 60 s"
    sleep 60
    powershell.exe -NoProfile -Command 'Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)'
}
[ "$PLAN" = 0 ] && [ "${PIPELINE_SLEEP:-0}" = 1 ] && trap pc_sleep EXIT
status() { printf '{"spec":"%s","stage":"%s","at":%s000,"verdict":"%s"}\n' "$1" "$2" "$(date +%s)" "$3" > .claude/build-status.json; }

# stages_for <spec.md>: one "kind|label" line per build stage
stages_for() {
    local f=".claude/specs/$1" heads nums
    heads=$(awk '/^## Tasks/{t=1;next} /^## /{t=0} t&&/^### /{print}' "$f")
    nums=$(grep -E '^### [0-9]+\.' <<<"$heads")
    if [ "$(grep -c . <<<"$nums")" -ge 2 ]; then
        while IFS= read -r l; do echo "section|${l#\#\#\# }"; done <<<"$nums"
    elif head -1 "$f" | grep -q '\[L\]' && grep -qE '^### Logic' <<<"$heads" && grep -qE '^### UI' <<<"$heads"; then
        echo "part|Logic"; echo "part|UI"
    else
        echo "whole|"
    fi
}

TAIL_LINE='End your reply with exactly one line, the last line:'
VERDICTS='PIPELINE: PASS <commit sha>   or   PIPELINE: FAIL <one-line reason>   or   PIPELINE: BLOCKED <what you need>'

# stage_prompt <spec.md> <kind> <label> <final 0|1> <attempt>
stage_prompt() {
    local spec=$1 kind=$2 label=$3 final=$4 attempt=$5
    if [ "$attempt" -gt 1 ]; then
        cat <<EOF
A previous unattended run of this stage was cut off (usage limit or no final verdict). Its partial work is in the
tree: read the spec, \`git status\` and \`git diff --stat\` first, and do not redo finished work. Only do what is left.

EOF
    fi
    echo "Build .claude/specs/$spec unattended. Nobody is watching, so never ask a question."
    case $kind in
        section) echo "SCOPE: build ONLY section \"$label\" of the spec's ## Tasks. Earlier sections are already committed; do not start later ones. Read the spec's Decisions and this section's signatures, skip the others." ;;
        part)    echo "SCOPE: build ONLY the tasks under the \"### $label\" heading of the spec's ## Tasks."
                 [ "$label" = UI ] && echo "The Logic part is already in the working tree, uncommitted: build on it, do not redo it." ;;
    esac
    cat <<EOF
1. Follow CLAUDE.md "Working style" and the spec's tasks in scope (TDD where it says so). Read CLAUDE.md, the spec and
   the docs it points to first. Grep before Read; never Read big files whole. Any change under ui/ follows the ui-build
   skill. Tick the tasks you finish in tasks.md.
EOF
    if [ "$kind" = part ] && [ "$final" = 0 ]; then
        cat <<EOF
2. Run the self-checks once through the runner agent. Do NOT spawn the tester and do NOT commit: the next stage builds
   on this working tree and the tester runs after it.
3. Stop on a real blocker: real data, a credential, a live step only the user can do, or a decision the spec leaves open.
$TAIL_LINE
PIPELINE: STAGE $label done   or   PIPELINE: FAIL <one-line reason>   or   PIPELINE: BLOCKED <what you need>
EOF
        return
    fi
    local scope="the spec" gating
    [ "$kind" = section ] && scope="this section"
    if [ "$final" = 1 ]; then
        gating='follow the roadmap-gating skill (if only user-only live checks are left, change "not started" in the phase heading to "built <date>, live checks pending" and list those checks in tasks.md as "- [ ] Live: ..."), then make one git commit for the phase'
    else
        gating="tick this section's roadmap bullet (do NOT change the phase heading: later sections are still to build), then make one git commit for this section"
    fi
    cat <<EOF
2. Spawn the tester agent on $scope, in the FOREGROUND (never run_in_background) so you wait for its verdict. Give it
   the spec name${label:+, the scope "$label"} and the changed-file list only. If its verdict is FAIL, fix only the
   defects it lists, once, then spawn the tester again.
3. Only if the final verdict is PASS: $gating
   (the pre-commit hook runs check.py; never use --no-verify, never push).
4. Stop without committing on a FAIL/INCOMPLETE verdict, or on a real blocker: real data, a credential, a live
   step only the user can do, or a decision the spec leaves open.
$TAIL_LINE
$VERDICTS
EOF
}

# run_stage <spec.md> <idx> <kind> <label> <final>: sets $line (the PIPELINE: ... line), $log, $sid
run_stage() {
    local spec=$1 idx=$2 kind=$3 label=$4 final=$5 attempt=0 prompt result reset target wait_s
    line=""
    while :; do
        attempt=$((attempt + 1))
        log=logs/pipeline-${spec%.md}-s$idx-$(date +%Y%m%d-%H%M)-a$attempt.json
        prompt=$(stage_prompt "$spec" "$kind" "$label" "$final" "$attempt")
        # hard cap per attempt: the tester may run as long as it needs, but a hung one must not block the queue forever
        timeout --kill-after=60 "${PIPELINE_ATTEMPT_TIMEOUT:-10800}" claude -p --model sonnet --output-format json > "$log" 2>&1 <<<"$prompt"
        result=$(jq -r '.result // empty' "$log" 2>/dev/null)
        jq -r --arg s "$spec" --arg g "s$idx" --arg a "$attempt" \
            '[(now|todate), $s, $g, "sonnet", $a, (.duration_ms/60000|floor), .num_turns, .total_cost_usd, .usage.output_tokens, .usage.cache_read_input_tokens, (.terminal_reason // "")] | @tsv' \
            "$log" >> logs/usage.tsv 2>/dev/null || true
        sid=$(jq -r '.session_id // empty' "$log" 2>/dev/null)
        line=$(grep -o 'PIPELINE: .*' <<<"$result" | tail -1)
        [ -n "$line" ] && return 0
        # no verdict: a usage limit or a cut-off run. Wait out the limit, then continue in a FRESH session
        # (a resumed session re-sends its whole history and the cache has expired).
        [ $attempt -ge 3 ] && return 1
        reset=$(grep -o -i -E 'resets [0-9]{1,2}(:[0-9]{2})? ?[ap]m' <<<"$result $(cat "$log")" | head -1 | sed 's/^resets //I')
        if [ -n "$reset" ]; then
            target=$(date -d "$reset" +%s 2>/dev/null) || target=0
            [ "$target" -le "$(date +%s)" ] && target=$((target + 86400))
            wait_s=$((target - $(date +%s) + 120))
            { [ "$target" -gt 0 ] && [ "$wait_s" -le 21600 ]; } || return 1
            notify "pipeline: $spec hit the usage limit, waiting until $reset (+2 min) to continue"
            status "$spec" waiting ""
            sleep "$wait_s"
        else
            notify "pipeline: $spec ended without a verdict, continuing once in a fresh session"
        fi
        status "$spec" building ""
    done
}

# park <spec> <reason>: save the unfinished work, reset the tree, mark the phase blocked in the roadmap, commit only that
park() {
    local spec=$1 reason=$2 base=logs/blocked-${1%.md}-$(date +%Y%m%d-%H%M) f
    git diff HEAD --binary > "$base.patch"
    git ls-files --others --exclude-standard | grep -vxFf "$UNTRACKED0" > "$base.untracked" || true
    [ -s "$base.untracked" ] && tar -cf "$base.tar" -T "$base.untracked"
    git checkout HEAD -- . && while IFS= read -r f; do rm -rf -- "$f"; done < "$base.untracked"
    python3 tools/workflow_audit.py --block "$spec" "$reason"
    git add docs/roadmap.md && git commit -q -m "docs: ${spec%.md} blocked, work saved in $base.patch" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" \
        || notify "pipeline: could not commit the blocked mark for $spec (roadmap.md left edited)"
}
UNTRACKED0=$(mktemp); git ls-files --others --exclude-standard > "$UNTRACKED0"
SKIP=" "; BLOCKED=0
mapfile -t ALL < <(printf '%s\n' "$@" | sed 's/\.md$//')

for arg in "$@"; do
    spec=${arg%.md}.md
    case "$SKIP" in *" ${spec%.md} "*) notify "pipeline: skipping $spec (requires a blocked phase)"; continue;; esac
    [ -f ".claude/specs/$spec" ] || { notify "pipeline: no spec .claude/specs/$spec"; exit 2; }
    mapfile -t stages < <(stages_for "$spec")
    if [ "$PLAN" = 1 ]; then echo "$spec: ${stages[*]}"; continue; fi
    n=${#stages[@]}
    notify "pipeline: building $spec on sonnet ($n stage$([ "$n" -gt 1 ] && echo s))"
    for i in "${!stages[@]}"; do
        kind=${stages[$i]%%|*}; label=${stages[$i]#*|}
        final=0; [ $((i + 1)) -eq "$n" ] && final=1
        status "$spec" building ""
        [ "$n" -gt 1 ] && notify "pipeline: $spec stage $((i + 1))/$n ${label:-whole}"
        run_stage "$spec" "$((i + 1))" "$kind" "$label" "$final"
        verdict=$(awk '{print $2}' <<<"$line")
        if [ "$verdict" = PASS ] || { [ "$final" = 0 ] && [ "$verdict" = STAGE ]; }; then
            [ "$final" = 0 ] && notify "pipeline: $spec stage $((i + 1))/$n ${label:-whole}: $line"
            continue
        fi
        status "$spec" "${verdict:-stopped}" "${verdict:-UNKNOWN}"
        notify "pipeline: $spec stage $((i + 1))/$n ${line:-ended without a verdict (see $log)}. Resume: claude -r $sid"
        park "$spec" "${line:-ended without a verdict}"
        BLOCKED=1
        SKIP="$SKIP$(python3 tools/workflow_audit.py --dependents "${spec%.md}" "${ALL[@]}") "
        continue 2
    done
    status "$spec" PASS PASS
    notify "pipeline: $spec $line"
done
[ "$PLAN" = 1 ] || notify "pipeline: queue finished ($*)$([ "$BLOCKED" = 1 ] && echo ', some blocked: see the roadmap')"
exit "$BLOCKED"
