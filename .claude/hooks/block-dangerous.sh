#!/usr/bin/env bash
# PreToolUse(Bash): refuse force-pushes to main/master. The logic (a shlex parser with a selftest) is in block_force_push.py.
exec python3 "$(dirname "$0")/block_force_push.py"
