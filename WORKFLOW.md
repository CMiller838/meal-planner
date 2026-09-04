# Workflow

The full idea → v1 → retro → v2 pipeline this template is built around. `CLAUDE.md`
and `README.md` both summarize this; this file is the one place with the full detail,
so update it, not scattered copies, when the workflow itself changes.

```
idea-interview                    (MVP outline + docs/FUTURE.md)
      ↓
@architect                        (stack choice → docs/ARCHITECTURE.md)
      ↓
@planner  (roadmap mode)          (must-haves → docs/roadmap.md phases)
      ↓
┌──> @planner  (phase mode)       (spec + tasks.md for one phase)
│         ↓
│    build: TDD (logic) + ponytail (lazy diffs)
│    UI: ui-prototyper (generate mockups) → you pick one → restyle-from-prototype
│         ↓
│    /code-review or /simplify on the diff, then commit
│         ↓
└──  repeat until docs/roadmap.md is fully done
      ↓
project-retro                     (review shipped vs. outline → docs/FUTURE.md)
      ↓
v2: idea-interview (seeded from retro) → @architect (only if flagged) → repeat
```

## 1. `idea-interview` — before any feature list exists

Skip this step if you already walk in with a clear, already-scoped feature
list — it exists specifically to force scoping when you don't.

- Checks for existing notes/docs first; reads whatever you point it at before
  asking anything those already answer.
- Runs a multi-round interview in small batches: problem, users, must-haves vs.
  nice-to-haves, constraints, non-goals. Keeps going across rounds until the
  picture is actually clear.
- **Actively resists scope creep** — its whole point, not a side effect. For
  every proposed must-have it asks "does this block a usable v1, or could
  someone use it without this?" There's no fixed cap on must-have count; it
  judges per-project whether the list still looks bigger than a real MVP needs,
  and keeps pushing until you'd genuinely call the trimmed list done-when-built.
- Writes the outcome as a project outline — into README.md if none exists yet,
  or as a `## Project Outline` section / separate linked doc if a real README
  is already there.
- Anything raised but not adopted goes into `docs/FUTURE.md`: what it is, why
  it was parked, and a concrete revisit trigger (never "someday").
- Re-invokable later for one new idea without repeating the full interview —
  it reads the existing outline + FUTURE.md first and only interviews about
  the new item.

## 2. `@architect` — pick the stack

Runs once there's an outline to design against (greenfield), or any time
later for a genuine architectural decision.

- Reads the outline (primary — a stack that can't cleanly support a must-have
  is disqualified) and `docs/FUTURE.md` (secondary — don't architect for
  parked ideas, but don't pick something that makes a likely-to-be-revisited
  item painful either; a must-have always wins over a parked idea).
- Writes `docs/ARCHITECTURE.md`: chosen stack and why, data flow, storage, and
  any non-obvious invariant a future refactor could accidentally break.
- States the standing rule that a new dependency/service/framework beyond this
  stack needs the user's confirmation first — other agents (and future
  sessions) are expected to respect that rule from `docs/ARCHITECTURE.md` on.
- Scoped to what the must-have list actually needs — architecting for scale or
  integrations nothing in the outline asked for is premature optimization and
  undoes the MVP discipline `idea-interview` just enforced.

## 3. `@planner` roadmap mode — sequence phases

- For the very first roadmap, reads the outline's must-have list directly (no
  `docs/roadmap.md` exists yet). On later runs, also reads the existing
  roadmap and `docs/FUTURE.md`.
- Groups must-haves into as few phases as the real dependency ordering allows
  — one phase per feature is the wrong default; the goal is the fewest phases
  that still separate genuinely sequential work.
- Surfaces at most one Decision Gate per phase, only if that phase's scope is
  genuinely ambiguous.
- Writes phase headings + one-sentence goals to `docs/roadmap.md` and bare
  phase-title placeholders to `tasks.md`. Does **not** write specs or detailed
  task breakdowns here — that's Stage 3, deliberately deferred to phase mode,
  done just before each phase is actually built so specs don't go stale.

## 4. Per-phase loop — repeat until the roadmap is done

### 4a. `@planner Phase N` (phase mode)

Full 3-stage lifecycle:

1. **Silent discovery** — Glob/Grep the codebase; delegates bulk file-reading
   (>2-3 files, or a broad pattern scan) to the `scanner` subagent to save
   opus tokens. Also does the "does an existing dependency/stdlib/library
   already solve this" check here, once, at plan time — the build step
   shouldn't need to re-research it. A new dependency gets flagged as a
   decision for the user, never spec'd in silently.
2. **Options-first interview** — up to 3 Decision Gates (Path A vs. B,
   pros/cons, a recommendation) when there's a real architectural fork. This
   **HALTs** until you answer — non-negotiable, even if told to skip it.
3. **Synthesis** — once gates are answered, writes `.claude/specs/phaseN_spec.md`
   (signatures/schemas/edge cases, no full implementation) and the phase's
   step-by-step checklist into `tasks.md`, split into TDD-required logic tasks
   vs. UI tasks.

### 4b. Build

- **Logic**: TDD — failing test first — for anything matching this project's
  "core logic" file list (name it in `CLAUDE.md`'s Architecture invariants
  section). Keep it ponytail-lazy: smallest working diff, no speculative
  abstraction, no unrequested refactor riding along.
- **UI**: `ui-prototyper` generates standalone mockup variants (fake data,
  every button/state represented) in the prototypes directory — it never
  touches the real app. Ask for more variations to get genuinely different
  concepts, or ask it to iterate a named one in place. Once you've picked a
  direction, run `restyle-from-prototype` to carry that design into the real
  templates/components and stylesheet, preserving every real data binding and
  any script/backend selector dependency along the way.
- **During manual testing**: `ui-prototyper` can view the actually-running app
  via a browser MCP (optional — see README's Browser MCP setup) and turn what
  it sees into a new prototype variant. It still never edits the file you're
  currently testing against, live-mid-session.

### 4c. Review and commit

- Run `/code-review` or `/simplify` on the phase's diff before committing —
  TDD proves the tests you wrote pass, not that you didn't over-build around
  them; this is what catches both correctness bugs and creep.
- Mark completed `tasks.md` items `- [x]` once their tests pass.
- Commit. `.claude/rules/roadmap-gating.md` requires the same commit to mark
  the roadmap phase `— done` (with what was verified) once its exit condition
  is actually met — never a separate follow-up commit.

Repeat 4a-4c for the next phase until every phase in `docs/roadmap.md` is done.

## 5. `project-retro` — once the roadmap is fully done

- Confirms every phase is actually marked done before proceeding.
- Compares shipped state against the original outline: what shipped as
  planned, what changed shape while building, what was silently dropped.
- Interviews you (same batched, multi-round discipline as `idea-interview`):
  what's working, what to change, what to add — pushing back on new-idea scope
  creep the same way `idea-interview` does, since a retro isn't an exemption
  from MVP discipline — and a direct stack-health question.
- Splits results the same way `idea-interview` does: adopted-now ideas go into
  the outline's feature list (v2 will still re-scope them against MVP
  discipline), parked ideas go into `docs/FUTURE.md` tagged by retro date so
  the next `idea-interview` pass has a ready-made seed instead of starting cold.
- Updates the outline/README if shipped reality has drifted from the original
  plan.
- If real stack friction came up, tells you to run `@architect` yourself as a
  deliberate follow-up — never triggers it automatically; a stack revisit is
  too disruptive to be a retro side effect.

**Two more checkpoints at this same point, both explicit/manual — neither
auto-triggers, so invoke them by name:**

- **`security-review`** (built-in) — reviews pending/recent changes for
  security issues before calling a version actually shipped. Run it if the
  project handles real user data or is going anywhere other than your own
  machine; skip it for a purely local/personal tool.
- **`task-observer`** — a retrospective pass over the whole version's session
  history (not per-task; it deliberately does not auto-trigger mid-session,
  since that was tried and found noisy relative to its value) looking for
  patterns, repeated corrections, or workflow friction worth turning into a
  new skill or a fix to an existing one. Run it once per version, here, after
  `project-retro` — feeds skill improvements back into this same template
  (`CLAUDE.md`, `.claude/skills/`, `.claude/agents/`) the same way
  `project-retro` feeds feature ideas into the outline.

## 6. v2 — repeat with more features

Deliberately manual, not a single chained skill — each step stays a checkpoint
you can look at before the next one runs:

1. `idea-interview`, seeded from the retro's `docs/FUTURE.md` entries (still
   with full MVP-discipline pushback on anything new).
2. `@architect`, only if the retro flagged a real stack concern.
3. `@planner` roadmap mode for the v2 roadmap.
4. The per-phase loop (step 4 above), same as v1.
