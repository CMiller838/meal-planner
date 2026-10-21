# Workflow

The full idea → v1 → retro → v2 pipeline this project follows. `CLAUDE.md`
and `README.md` both summarize this; this file is the one place with the full detail,
so update it, not scattered copies, when the workflow itself changes.

```
idea-interview                    (MVP outline + docs/FUTURE.md)
      ↓
@architect                        (stack choice → docs/ARCHITECTURE.md)
      ↓
plan-phase  (roadmap mode)        (must-haves → docs/roadmap.md phases, tier-tagged)
      ↓
┌──> plan-phase  (phase mode)     (one spec per phase; plan a few ahead in one sitting)
│         ↓
│    /overnight (unattended)  or  /build / build in session
│      build: TDD (logic) + ponytail (lazy diffs); UI via the ui-build skill
│         ↓
│    tester PASS → roadmap-gating → one commit per phase
│    human-only checks → tasks.md "- [ ] Live:", cleared with /live
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

## 3. `plan-phase` roadmap mode — sequence phases

Runs in the main session via the `plan-phase` skill (the old `planner` subagent is
retired: a subagent can't ask you anything, so every gate cost a full transcript replay —
measured ~164k fresh + ~1M cached tokens per run, plus a similar scanner run).

- First roadmap: reads the outline's must-have list directly. Later runs also read the
  existing roadmap and `docs/FUTURE.md`. Archives the old roadmap to `.claude/archive/`,
  then overwrites `docs/roadmap.md` in place.
- Groups must-haves into as few phases as the dependency ordering allows — never one
  phase per feature.
- At most one gate per phase, only if the phase's existence or scope is ambiguous; asked
  via `AskUserQuestion`.
- Tags every phase heading with its **tier** (`## Phase N: Title [S|M|L]`) so ceremony
  matches risk and you never have to name it when you say "plan Phase N":
  - **S** — small, ≤3 files, no user-facing fork. No spec; ≤10 inline tasks.
  - **M** — the `plan-phase` skill writes one spec.
  - **L** — new data flow, storage/backend shift or security-sensitive design.
    Planned in plan mode on Opus; any real fork is recorded as an ADR.
  The tag is a skim-level guess; phase planning can move it up or down.
- Writes phase headings, one-sentence goals and tiers to `docs/roadmap.md`, and bare
  headings to `tasks.md`. No specs or task breakdowns — those are written per phase, just
  before it is built, so they don't go stale.

## 4. Per-phase loop — repeat until the roadmap is done

### 4a. `plan-phase` Phase N (phase mode, main session)

Budget ~100k tokens. Skip entirely for S-tier phases.

1. **Read narrowly** — this phase's roadmap section, the `CLAUDE.md` invariants, the
   outline bullets it cites, `docs/ADR_INDEX.md` then only the ADRs needed (never all of
   `ARCHITECTURE.md`). Code via Grep/Glob and exact-span Reads; one `Explore` call with a
   ≤1000-word cap for a broad sweep. Check once whether stdlib or an installed dependency
   already solves it; a new dependency is always a gate.
2. **Gates** — only genuine toss-ups that change user-facing behaviour or are costly to
   undo; a confident recommendation is decided and noted in the spec instead. Max 3, one
   `AskUserQuestion` call, recommended option first. Never gate data shape, reuse-vs-build
   or naming.
3. **Write one file**, `.claude/specs/phaseN.md`: decisions (labelled user-chosen vs own
   call), files touched, signatures/schemas, edge cases, verification, and the task
   checklist split into TDD-required logic vs UI. `tasks.md` gets a single pointer line
   under the phase heading — the checklist lives in the spec.
4. Finish with a short summary, then build, or `/clear` first.

**Plan ahead, build later.** Planning is the part that needs you; building and testing don't. Plan two or three
phases in one sitting (one spec each), then hand the whole queue to `/overnight` (see Unattended builds). Never let
an agent plan a phase on its own: the gates are where your decisions go.

### 4b. Build

Unattended: `/overnight` runs 4b and 4c for every queued spec. `/build` (the `build-handoff` mod) does one spec in
the background of your session. By hand:

- **Work from the phase spec's checklist** (`.claude/specs/phaseN.md`), or the inline
  tasks under the phase heading for S-tier. `tasks.md` accumulates every phase, so Grep
  its `^## Phase N` heading and read only that slice — never the whole file.
- **Logic**: TDD — failing test first — for anything matching this project's
  "core logic" file list (name it in `CLAUDE.md`'s Architecture invariants
  section). Keep it ponytail-lazy: smallest working diff, no speculative
  abstraction, no unrequested refactor riding along.
- **UI**: every UI change follows the `ui-build` skill: built straight into the app in the house style,
  always animated, checked by eye in both themes and at phone width. `ui-prototyper` is only for when you want new
  visual ideas: it generates standalone mockup variants (fake data, every state) and never touches the real app;
  once you pick one, `restyle-from-prototype` carries it into the real components, preserving every data binding, and records the style in `docs/UI_STYLE.md`.
- **During manual testing**: `ui-prototyper` can view the actually-running app
  via a browser MCP (optional — see README's Browser MCP setup) and turn what
  it sees into a new prototype variant. It still never edits the file you're
  currently testing against, live-mid-session.

### 4c. Review and commit

- The `tester` agent verifies the spec with fresh evidence: the checks, a real app run, bad input. A check that
  seems to need you (a tap, a confirm click) is simulated by feeding that code path a fake input on a temp copy of
  the data; only checks that truly need your eyes, ears, hardware or accounts become `- [ ] Live: ...` lines in
  `tasks.md` (steps plus what you should see), and they don't block the commit. The phase heading then reads
  "built <date>, live checks pending". Clear them in one sitting with `/live`: it starts the app, asks you four
  checks at a time, ticks `tasks.md` and marks phases `— done` when their last check passes. After an in-session
  `/build` passes, `/live` starts on its own for that phase only; `/overnight` builds leave theirs for your next `/live`.
- For a large M/L phase built in session, `/code-review` the diff before committing (`/simplify` for S-tier).
- Tick completed `- [x]` items (in the spec, or `tasks.md` for S-tier) once their tests pass.
- Commit. The `roadmap-gating` skill requires the same commit to mark
  the roadmap phase `— done` (with what was verified) once its exit condition
  is actually met, or "built, live checks pending" when only `Live:` lines are left; ticking those later is a
  small follow-up commit.

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
- Runs `python3 tools/token_audit.py` and reports real per-agent token spend against
  the ~100k per-phase `plan-phase` budget, so cost drift gets caught once per version.
- If real stack friction came up, tells you to run `@architect` yourself as a
  deliberate follow-up — never triggers it automatically; a stack revisit is
  too disruptive to be a retro side effect.

**One more checkpoint here, invoked by name:** `security-review` (built-in) reviews
pending/recent changes for security issues before calling a version shipped. Run it if the project handles real
user data or goes anywhere other than your own machine.

## Automatic checks (no step to remember)

One-time setup per clone: `git config core.hooksPath tools/githooks`.

- **Per edit:** the `project-guards` mod refuses `.env` edits, new dependencies and raw hex in UI files, and runs an
  edited `.py` file's self-check, feeding failures back.
- **Before a commit:** `tools/githooks/pre-commit` runs `python3 check.py` (`--no-verify` skips it).
- **On push:** `.github/workflows/check.yml` runs `check.py` in CI.
- **On Stop:** `.claude/hooks/check-on-stop.sh` runs `check.py --changed` (only the checks the changed files need;
  docs-only changes need none) when the tree changed since the last green run, and blocks the stop once on failure.
  `.claude/hooks/session-nudge.sh` tells you to `/clear` past 100k context and warns when more than 15 files are
  uncommitted.
- **After a commit touching code:** `tools/githooks/post-commit` closes the `/build` status, and runs
  `tools/deploy.sh` in the background if the project has one (`AUTO_LAUNCH=0` skips it).
- **Every session start:** `tools/workflow_audit.py` prints one line: the next phase, the `/overnight` queue and the
  number of open checks in `tasks.md`.
- **Weekly, at session start:** the same script writes `.claude/audits/workflow-<date>.md` (big sessions, denials,
  repeated prompts, agent spawns) with no model call, and sends the open `tasks.md` checks to Telegram.
- **Weekly, user level:** `~/.claude/hooks/stale_check.py` flags broken path references, retired-stack words
  (`.claude/stale_terms.txt`) and long-untouched Claude files; judged-fine findings go in `.claude/stale_ignore.txt`.

Telegram is optional everywhere: set `NOTIFY_BOT_TOKEN` and `NOTIFY_CHAT_ID` (env or `.env`) for `tools/notify.py`.

## Unattended builds

Type `/overnight` and walk away. It builds every roadmap phase marked "not started" that has a spec (or sub-specs
`phaseNa.md`, `phaseNb.md`) in `.claude/specs`, in roadmap order (`/overnight phase8 phase9` for a chosen set), and
refuses to start with uncommitted changes. Under it is `tools/pipeline.sh`: headless `claude -p` per spec, build →
tester (one fix round) → roadmap-gating → commit, stopping at the first non-PASS. Each result goes to Telegram and
`.claude/build-status.json` (shown in the `/next` pane), and a blocked run includes a `claude -r <id>` resume line.
Mention `@claude` in a GitHub issue to have the `claude` workflow work on it (needs `/install-github-app` once).

## 6. v2 — repeat with more features

Deliberately manual, not a single chained skill — each step stays a checkpoint
you can look at before the next one runs:

1. `idea-interview`, seeded from the retro's `docs/FUTURE.md` entries (still
   with full MVP-discipline pushback on anything new).
2. `@architect`, only if the retro flagged a real stack concern.
3. `plan-phase` roadmap mode for the v2 roadmap.
4. The per-phase loop (step 4 above), same as v1.
