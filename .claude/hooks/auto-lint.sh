#!/bin/bash
# TEMPLATE: syntax-check/lint a file right after Claude edits it, and run its
# paired test file if one exists. Fill in the case statement below with your
# project's actual file->test mapping, and swap the py_compile line for
# whatever your language's fast syntax check is (tsc --noEmit, go vet, etc).
PAYLOAD=$(cat)

TOOL=$(echo "$PAYLOAD" | jq -r '.tool')
FILE_PATH=$(echo "$PAYLOAD" | jq -r '.tool_input.file_path // empty')

if [[ "$TOOL" == "Edit" || "$TOOL" == "Write" ]] && [[ "$FILE_PATH" =~ \.py$ ]]; then
    cd "$(dirname "$FILE_PATH")" || exit 0
    BASENAME=$(basename "$FILE_PATH")

    python -m py_compile "$BASENAME" 2>&1 | head -20

    case "$BASENAME" in
        # example.py) TEST="test_example.py" ;;
        *) TEST="" ;;
    esac
    if [[ -n "$TEST" && -f "$TEST" ]]; then
        python "$TEST" 2>&1 | tail -20
    fi
fi
