#!/bin/bash
# PreToolUse(Bash): refuse force-pushes to main/master. Exit 2 blocks; stderr is the reason Claude sees.
# Fails closed: quotes and backslashes are stripped first, then any short-flag group holding an f (-f, -uf, -4f),
# any --fo... (git takes abbreviations), --mirror or a +refspec counts as a force. The flag must start a word, so
# "search-first" in a commit message doesn't trip it; a false positive costs a retry, a miss costs history.
# Anything the shell expands ({a,b}, $..., backticks) can build a flag the regex never sees, so it counts too.
# A force push blocks when it names main/master, or when the working directory is on main/master (a bare
# `git push -f` pushes the current branch).
# ponytail: a regex, not a shell parser (a `cd elsewhere &&` or a git alias can still hide it); GitHub branch
# protection (no force-push on main) is the real backstop.
INPUT=$(cat)
COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" | tr -d "\\\\'\"")
FORCE="(^|[[:space:];&|(=,{}<>])(-[^-[:space:]]*f|--fo|--mirror)|[[:space:]:]\\+[^[:space:]]|[{\`\$]"
[[ "$COMMAND" =~ git[[:space:]].*push ]] && [[ "$COMMAND" =~ $FORCE ]] || exit 0
CWD=$(jq -r '.cwd // empty' <<<"$INPUT")
BRANCH=$(git -C "${CWD:-${CLAUDE_PROJECT_DIR:-.}}" symbolic-ref --short HEAD 2>/dev/null)
# --mirror force-updates every branch, main included, wherever you stand
if [[ "$COMMAND" =~ (main|master|--mirror) ]] || [[ "$BRANCH" =~ ^(main|master)$ ]]; then
    echo "Force-pushing to main/master is banned." >&2
    exit 2
fi
exit 0
