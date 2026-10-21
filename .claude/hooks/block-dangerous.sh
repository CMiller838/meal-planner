#!/usr/bin/env bash
# PreToolUse(Bash): refuse force-pushes to main/master. The logic (a shlex parser with a selftest) is in block_force_push.py.
# Fails closed: a missing python3 or any crash in the guard blocks the command instead of letting it through.
python3 "$(dirname "$0")/block_force_push.py"
rc=$?
[ "$rc" -eq 0 ] && exit 0
[ "$rc" -eq 2 ] || echo "Blocked: the force-push guard failed to run (exit $rc)." >&2
exit 2
