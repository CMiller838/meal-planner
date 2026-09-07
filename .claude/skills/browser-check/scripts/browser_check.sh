#!/usr/bin/env bash
# Drives a real headless Chrome against this project's static pages, over a
# throwaway python3 http.server. No npm, no Playwright driver code — just the
# Chrome-for-Testing binary Playwright already cached on this machine.
#
# Usage:
#   browser_check.sh test [page]                 -> pass/fail summary + any FAIL lines
#   browser_check.sh dom <page> [out_file]        -> rendered DOM (after JS runs) to stdout or out_file
#   browser_check.sh console <page>               -> console.* and network/CORS errors seen while loading
#   browser_check.sh screenshot <page> <out.png> [WxH]  -> PNG, default 430x900 (phone-ish, matches the PWA)
#
# `page` is a path relative to the repo root, e.g. discover.html or test.html.
set -euo pipefail

MODE="${1:?usage: browser_check.sh <test|dom|console|screenshot> <page> [out] [WxH]}"
PAGE="${2:-test.html}"
OUT="${3:-}"
GEOM="${4:-430x900}"
GEOM="${GEOM/x/,}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || { cd "$(dirname "$0")/../../.." && pwd; })"
WORKDIR="${TMPDIR:-/tmp}/browser-check-$$"
mkdir -p "$WORKDIR"
trap 'kill "${SERVER_PID:-0}" 2>/dev/null; rm -rf "$WORKDIR"' EXIT

SHELL_BIN="$(find "$HOME/.cache/ms-playwright" -type f -iname 'chrome-headless-shell' 2>/dev/null | head -1)"
if [ -z "$SHELL_BIN" ]; then
  echo "No cached Chrome-for-Testing binary found under ~/.cache/ms-playwright." >&2
  echo "Run 'npx playwright install chromium' once with network access to fetch it." >&2
  exit 1
fi

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')"
(cd "$REPO_ROOT" && python3 -m http.server "$PORT" >"$WORKDIR/http.log" 2>&1) &
SERVER_PID=$!
for _ in $(seq 1 20); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 0.2
done

URL="http://localhost:$PORT/$PAGE"

case "$MODE" in
  test)
    timeout 15 "$SHELL_BIN" --no-sandbox --disable-gpu --virtual-time-budget=6000 --dump-dom "$URL" \
      >"$WORKDIR/dom.html" 2>"$WORKDIR/err.log"
    grep -oE '[0-9]+ passed, [0-9]+ failed' "$WORKDIR/dom.html" || echo "no pass/fail summary found — inspect $WORKDIR/dom.html"
    grep '^FAIL ' "$WORKDIR/dom.html" || true
    ;;
  dom)
    timeout 15 "$SHELL_BIN" --no-sandbox --disable-gpu --virtual-time-budget=4000 --dump-dom "$URL" 2>"$WORKDIR/err.log" \
      > "${OUT:-/dev/stdout}"
    ;;
  console)
    timeout 15 "$SHELL_BIN" --no-sandbox --disable-gpu --virtual-time-budget=4000 --dump-dom "$URL" \
      >/dev/null 2>"$WORKDIR/err.log"
    grep -iE 'INFO:CONSOLE|blocked by CORS|Failed to load resource|net::ERR' "$WORKDIR/err.log" \
      || echo "no page console/network errors seen (Chrome's own dbus/GPU noise is filtered out)"
    ;;
  screenshot)
    : "${OUT:?screenshot mode needs an output path: browser_check.sh screenshot <page> <out.png> [WxH]}"
    timeout 15 "$SHELL_BIN" --no-sandbox --disable-gpu --window-size="$GEOM" --virtual-time-budget=4000 \
      --screenshot="$OUT" "$URL" 2>"$WORKDIR/err.log"
    echo "Saved $OUT"
    ;;
  *)
    echo "unknown mode: $MODE (want test|dom|console|screenshot)" >&2
    exit 1
    ;;
esac
