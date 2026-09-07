---
name: browser-check
description: >
  Verify a Meal Planner change actually works by running it in a real headless
  Chrome — check test.html's pass/fail count, screenshot any page (index,
  discover, plan, shopping) as rendered after JS runs, or read console/CORS/
  network errors a page threw while loading. Use this whenever a UI or logic
  change needs checking beyond reading the diff: after editing any .js/.html
  file, before saying a feature "works" or a bug is "fixed", when the user
  asks to test, verify, check, screenshot, or "see if it works" in the
  browser, or when test.html has grown a new group and needs running. This
  project has no build step and no browser MCP configured — this skill is the
  only way to actually execute the page's JS and see the result rather than
  just reading source.
---

# Browser check

CLAUDE.md's Commands section says to serve the static files and open them in a
browser — that's for a human. This skill is the equivalent for Claude: a
cached Chrome-for-Testing binary (from a prior Playwright install, at
`~/.cache/ms-playwright/`) driven headless over a throwaway
`python3 -m http.server`, no npm/build step, no new dependency. It requires no
sandbox override — the binary and a `$TMPDIR` scratch profile are enough.

Everything goes through one script:

```
.claude/skills/browser-check/scripts/browser_check.sh <mode> <page> [out] [WxH]
```

## Modes

- **`test [page]`** — the one to run after touching any JS. Loads `test.html`
  (or another test page if this project ever splits them), greps the
  `N passed, N failed` summary line `test.html` prints, and lists any `FAIL `
  lines. This is `test.html`'s own assertions running for real, not a guess
  from reading the code.

  ```
  ./.claude/skills/browser-check/scripts/browser_check.sh test test.html
  ```

- **`screenshot <page> <out.png> [WxH]`** — renders the page after its JS has
  run and saves a PNG. Defaults to `430x900`, a phone-sized viewport, since
  this is a PWA meant for a phone. Use this for anything checklist items call
  "UI & Layout" — a new sheet, a moved button, a CSS change — read the PNG
  back with the Read tool afterwards.

  ```
  ./.claude/skills/browser-check/scripts/browser_check.sh screenshot discover.html /tmp/discover.png
  ```

- **`console <page>`** — surfaces `console.*` output and blocked-request
  errors (CORS, 404s) the page produced while loading. Useful after touching
  fetch calls (TheMealDB, the Hermes worker) or anything wrapped in try/catch
  that might be silently swallowing a failure. Chrome's own dbus/GPU
  sandboxing noise is filtered out — what's left is the page's own errors, or
  the reassuring "no page console/network errors seen" line.

- **`dom <page> [out_file]`** — the fully rendered DOM after JS runs, for
  cases the other three modes don't cover (e.g. confirming an element's exact
  text or that a `hidden` class got removed). Defaults to stdout; grep it or
  pass an out_file and Read it.

## What this can't do

TheMealDB and Hermes calls are blocked by the sandbox's network policy (same
as any other Bash network access) — `discover.html`'s deck will render empty
and `console` mode will show the CORS errors as proof of that, not a bug in
the page. That's expected: this validates the page's own logic and rendering,
not live third-party data. Judge functionality from `test.html` (which stubs
what it needs) and from a page's DOM/console once its non-network logic runs.

There's also no click/drag simulation here — `--dump-dom`/`--screenshot` are a
single page load, not a session. For interaction sequences (tap-to-open-sheet,
swipe-to-decide), trust `test.html`'s assertions on the extracted pure
functions (e.g. `isTap`) plus a screenshot of the resulting state, rather than
trying to script the gesture itself.

## If the binary is missing

The script looks for `chrome-headless-shell` under `~/.cache/ms-playwright/`.
If a fresh machine doesn't have it, it prints the fix: run
`npx playwright install chromium` once with network access (this needs the
same kind of sandbox network allowlisting as any first-time package fetch —
see the user's machine notes on `uv`'s sandbox bypass for the pattern).
