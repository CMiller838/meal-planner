#!/bin/bash
# Read the JSON payload from stdin
PAYLOAD=$(cat)

# Extract the command being executed using jq
COMMAND=$(echo "$PAYLOAD" | jq -r '.tool_input.command // empty')

# 1. Block direct force-pushing to main
if [[ "$COMMAND" =~ "git push" ]] && [[ "$COMMAND" =~ "-f" || "$COMMAND" =~ "--force" ]] && [[ "$COMMAND" =~ "main" || "$COMMAND" =~ "master" ]]; then
    echo '{"permissionDecision": "deny", "reason": "Deterministic Block: Force-pushing to main is strictly banned!"}'
    exit 2
fi

# 2. Allow all other commands to proceed
echo '{"permissionDecision": "allow"}'
exit 0
