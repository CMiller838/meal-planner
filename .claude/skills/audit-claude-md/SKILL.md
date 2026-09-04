---
name: audit-claude-md
description: Audit and rewrite the project's CLAUDE.md into terse imperative rules, moving anything hook/rule-shaped out to .claude/rules/ or .claude/hooks/. Use when asked to audit, tighten, or rewrite CLAUDE.md, or to cut it down in size.
---

# audit-claude-md

Rewrites `CLAUDE.md` from narrative prose into single-line imperative rules, under 200 lines
total. Do not start until this whole skill has run — no partial edits.

## Steps

1. Read the current `CLAUDE.md` in full, plus `.claude/rules/*.md` and `.claude/hooks/*`
   (already-existing rules/hooks it might duplicate).
2. Classify every section:
   - **History/narrative** (v1/v2/v2.1 change-log prose, per-file "what was built and why")
     → drop entirely. `git log` and the docs in `docs/` (`PLAN.md`, `ARCHITECTURE.md`,
     `ROADMAP.md`, `FUTURE.md`) are the source of truth for that; CLAUDE.md should not
     duplicate it.
   - **Standing rule that should always apply** (e.g. "confirm before adding a dependency",
     docstring style, agent guardrails) → rewrite as one imperative line: positive
     ("Always X") or negative ("Never X"). If it's Python-specific or path-scoped, move it
     into a `.claude/rules/*.md` file with YAML `paths:` frontmatter instead of leaving it
     in CLAUDE.md.
   - **Automated/enforceable behavior** (lint-on-save, blocking a dangerous command,
     pre-commit graph regen) → check whether `.claude/hooks/` already covers it. If it
     doesn't and it's mechanically checkable, note it as a candidate hook rather than
     inventing one unasked — flag it in the final report, don't build it.
   - **Known config mismatch / stale note** (e.g. "auto-lint.sh doesn't fire on Python") →
     verify it's still true (check the referenced file). If stale, delete. If still true,
     compress to one line.
   - **Commands, stack/dependency facts, architecture orientation** → keep, but compress:
     one line per fact, no rationale prose unless the rationale changes future behavior
     (e.g. "don't add a dependency without confirming" needs its one-line reason; "here's
     what category 6 built" doesn't).
3. Rewrite `CLAUDE.md`:
   - Group into short sections (Project state, Commands, Stack, Architecture invariants,
     Agent rules, Known mismatches — merge/rename as the actual content dictates).
   - Every line is imperative and single-purpose. No "this is because..." unless the reason
     changes what the agent should do differently in an edge case.
   - Drop anything a competent agent would infer from reading the code (obvious defaults,
     restated file purposes already discoverable via `ls`/imports).
   - Target: under 200 lines total.
4. For anything moved out of CLAUDE.md into `.claude/rules/` or flagged as a hook candidate,
   make that edit too (new/updated rule file) — don't just leave a dangling mention.
5. Report a short diff summary: lines before → after, what was cut, what was moved and to
   where. Do not silently drop content the user might expect to still find somewhere —
   name where it went (deleted vs. moved to `docs/` vs. moved to `.claude/rules/`).
