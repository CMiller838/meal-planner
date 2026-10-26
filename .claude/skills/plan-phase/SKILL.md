---
name: plan-phase
description: Plan one roadmap phase (or the roadmap itself) in the main session — targeted reads, at most 3 batched decision gates via AskUserQuestion, one spec file with tasks. Use whenever the user says "plan Phase N", "spec Phase N", "plan the roadmap", or before building an M/L-tier phase. Replaces the old planner subagent.
---

# plan-phase

Runs in the main session. No subagent: a subagent can't ask the user, so gating there
cost a transcript replay per round and garbled answers. Budget: ~100k tokens total.

## No phase number given

`/plan-phase` with nothing after it plans the **lowest unplanned phase**: the first `## Phase N: ... — not started`
heading in `docs/roadmap.md` (in file order) with no `.claude/specs/phaseN.md` and no `## Phase N` section in
`tasks.md` (an [S] phase counts as planned once that section exists). Say which phase you picked in one line, then
continue. None found: say so and stop.

## Free-form request (no roadmap phase yet)

Before asking the user any scoping questions, grep the code once for the request's headline nouns (e.g. "skip", "eating
out", "start date"). Ask only about what is genuinely missing, and open with what already exists so the questions are not
about built features.

## Tier first — read it from the heading, never ask the user

Each heading in `docs/roadmap.md` ends `[S]`, `[M]` or `[L]`. "Plan Phase N" is enough.

- **[S]** — no spec. Write ≤10 checkbox lines straight under the phase in `tasks.md`. Stop.
- **[M]** — this skill, steps below. Sonnet is fine.
- **[L]** — same steps in plan mode (EnterPlanMode), and record any real architectural
  fork as an ADR in `docs/ARCHITECTURE.md`. Sonnet is fine; use Opus only when the phase has a real
  architectural fork to decide (planning re-reads the repo, so Opus costs much more here).

**Model check.** Do not stop to ask. If you are on Opus for an [S] or [M] phase, or on Sonnet for an [L] phase
with no architectural fork, say so in one line and continue. Only an [L] phase with a real fork on Sonnet or Haiku
warrants a one-line suggestion to switch with `/model opus`; still continue.

If a heading has no tag (old roadmap), pick M, or S if it touches ≤3 files with no
user-facing fork, then write the tag into the heading. If discovery shows the tag is
wrong, say so in one line and update the heading.

## Phase mode (M/L)

1. **Read narrowly.** First, grep the code for the roadmap line's headline feature itself (its nouns, e.g. "swipe deck",
   "swap"): it may already be built, which makes the contradiction a gate before any other reading.
   Then, right after the roadmap section, grep the code for every named UI surface
   (a "Today view", strip, sheet) so a missing one is found before any other reading (step 2's check, run early).
   Also, for any phase that writes state (a route, a KV key), grep where that state lives: the app's `localStorage` is
   the authority and the Worker's KV copy is a derived mirror (e.g. `plan`), so a "write the plan" roadmap line may need
   a pending-queue + app-apply path, which is a gate.
   Likewise, when the roadmap has the app read data "over" a Worker route, grep the app for a local copy first
   (e.g. `MP.methodOf`): the app should read its own library, so say so in the spec's Decisions.
   For a phase that adds a field to a stored object (a slot, a record), grep for the mirror/serialiser that copies that object
   to KV or another store (e.g. `planMirror` in `hermes-sync.js`): one that whitelists fields silently strips the new one, so
   list it under Files touched.
   If that field lives in a stored object `CLAUDE.md` pins by shape (e.g. `mp_planPrefs`), list the invariant line under
   Files touched so the builder updates it.
   For every existing function/module the spec names, grep its defining file and write that path in the spec; if the
   Worker imports or will import that file, say whether it needs the `window` → `root` shim.
   For a phase that adds a Worker route, also grep `worker/worker.js` for that route name: an existing route with the
   same path is a naming gate (new path vs replace), found before any spec text.
   If the phase touches nutrition, nutrient tags or targets, read `SPEC.md`'s "Nutrition targets" section (Grep
   `^## Nutrition targets`, read to the next `^## `) before any gate: it fixes the accuracy model (a low/med/high
   coverage checklist, not gram-precise), and the user wants accurate health tracking, so frame gates against both.
   Roadmap section for this phase only (Grep `^## Phase N`), the
   `CLAUDE.md` invariants, `docs/PROJECT_OUTLINE.md` bullets cited in brackets. For
   ARCHITECTURE.md, Grep for the relevant headings (or read `docs/ADR_INDEX.md` if the
   project keeps one, then Grep `^### ADR-0NN`) and Read only those spans — never the whole file. Code: Grep/Glob, then Read exact spans. For a broad sweep
   use the `Explore` agent once, with a ≤1000-word report cap. Never read `tasks.md` whole.
2. **Reuse check once**: existing helper/stdlib/installed dep before speccing custom code.
   A new dependency is always a gate (project rule).
   **Preflight before naming anything:** `ls`/Glob every new file or module name the spec
   will create (a clash means pick another name), and check every "Requires Phase N" is
   marked `— done` in the roadmap (or listed under "Done phases" there: those sections moved to `.claude/archive/roadmap-done.md`). An unbuilt dependency goes in the spec as a stated
   fallback, never as an assumed existing function. If a required phase has no heading (merged or renumbered),
   grep for the symbols the spec depends on: found means met, not found means a stated fallback.
   For a dependency on a sibling repo's phase (e.g. "<other app> Phase N"; CLAUDE.md names the repo path), grep
   `^## Phase N ` in that repo's `docs/roadmap.md`; a heading not marked done is unbuilt. No heading found: it may be
   renumbered, so grep that roadmap for `was .*\bN\b` and its code for the route/key this phase adds before calling it unbuilt.
   Also check every UI surface the roadmap names (a page, tab, strip, sheet): grep the code, then `.claude/specs/`.
   Found only in an unbuilt spec means the phase depends on that spec's phase: state "Requires Phase Na" in the spec.
   When a phase exposes existing logic (reasons, scores, fields), grep that each item the roadmap lists is a real input
   in the code; drop the ones that are not and say so in the spec.
   When the roadmap names a data attribute a feature learns from or filters on (a cuisine, a category, a tag), grep that the
   meal shape (`meals.json`) and the importer (`mealdb.js` `toMeal`) actually carry it; absent means a gate (capture it or drop it).
   Check whether the roadmap's "no UI to do X" assumption holds (e.g. the app may have no editor for the field).
   If most of a phase's dependencies are unbuilt, that is the first gate (split, fallbacks or wait), asked before any code reading.
3. **Gates.** Gate only a fork that changes user-facing behaviour or is expensive to undo
   AND is a genuine toss-up. Confident recommendation → decide it, note it in the spec.
   Data shape, reuse-vs-build, naming, file placement → never gate. Max 3, asked in ONE
   `AskUserQuestion` call, recommended option first. A finding that contradicts the roadmap's
   assumption is always a gate. Unanswered gate → stop and ask again; never write a guess
   as if the user chose it.
   **Explain every gate in chat before the `AskUserQuestion` call**, in this order, per gate:
   (a) *Plain*: 1–2 sentences, no jargon, what the decision is and why it came up;
   (b) *In depth*: how each option actually works and what it touches in this project;
   (c) *Difference*: one sentence on what really separates the options;
   (d) *Pros and cons*: a short list per option. Option descriptions in the tool stay brief
   and may point back to the explanation. If the user answers a gate with "explain", re-explain
   in this format and ask again; that is not an answer.
4. **Split only when strongly recommended.** Default is one spec, with sections built in order if it is big. Split
   into `phaseNa.md`, `phaseNb.md`, … (dependency order) only when one spec clearly can't work: the phase spans more
   than one repo, or its sections differ in tier so one builder model would be badly wrong for most of it, or a single
   spec would overflow one builder's context. Say in one line why the split was needed. Each sub-spec must build and test alone (one `/build` each, a
   small fresh builder context). Put the shared Decisions in the first one only and point to it from the
   others. The tier tag goes on each sub-spec's first line (`# Phase Na: … [M]`). `/build` reads that tag
   to pick the tier (the builder is always Sonnet). Tag a sub-spec `[L]` only if it carries the hard part.
   One pointer line per sub-spec under `## Phase N` in `tasks.md`.
   **Write one file** `.claude/specs/phaseN.md` (or the sub-specs above) (legacy `phaseN_spec.md` names stay valid):
   Decisions (user-chosen vs own call, labelled) · Files touched · Signatures/schemas (no
   bodies) · Edge cases · Verification · Tasks as `- [ ]` split Logic (TDD) / UI.
   For every helper in Signatures, name who consumes its return value (e.g. who logs `backfilled`) and give that
   caller its own task; a return value nobody consumes is a gap the tester will flag.
   Before moving on run `python3 tools/spec_lint.py phaseN`: it fails a spec with no tier tag, no `## Files touched`,
   or a `## Verification` without a runnable command in backticks (`/overnight` refuses to start on the same check).
   Under the first line add `Plain: <one everyday sentence on what this gives the user>`: the building-now pane shows it.
   **Devil's advocate before you finish:** ask "what would stop this running unattended?" (a human step, a credential, a
   path outside the repo, a dependency on a phase not yet built) and fix the spec or add a
   `Requires Phase N` line / `- [ ] Live:` task. `spec_lint.py` prints `SPEC RISK` for the common ones (if the only tokens are test fakes, say "No real credential
   needed" in Verification and the credential warning clears).
   Anything only the user can verify goes in `tasks.md` as a `- [ ] Live: ...` line, not in Verification.
   Then under `## Phase N` in `tasks.md` (Edit that heading only) put one pointer line to the
   spec. Do not duplicate the task list there. If `tasks.md` has no `## Phase N` heading yet (later phases often
   don't), append `## Phase N: Title` plus the pointer line at the end of the file instead.
5. Finish with a 3-line summary and the spec path, then build or `/clear`. Add one
   **Self-improvement** line: one concrete change to this skill (or the builder/tester)
   that would have made this plan cheaper (efficiency) or caught a miss (effectiveness),
   or "none". Then **evaluate it in one or two lines and give a verdict: Recommend or Don't recommend**, with the reason
   (how often the miss would recur, token cost of the added step, whether an existing step already covers it). On
   **Recommend**, ask one `AskUserQuestion` (Apply / Skip); on Apply, make the smallest `Edit` yourself in the same
   turn (no agent: a fresh one re-derives context). Auto-apply only under `.claude/skills|agents|rules`, `CLAUDE.md`,
   `WORKFLOW.md`; anything under `tools/` or touching hooks, permissions or checks stays a proposal for the user. On
   **Don't recommend** or "none", ask nothing and edit nothing.

## Roadmap mode

Name and order phases only: fewest phases the dependency order allows, one-sentence goal,
tier in the heading as `## Phase N: Title [S|M|L]` (L where a new data flow, storage shift or security design), at most
one gate per phase and only if its existence is ambiguous. Archive the old roadmap to
`.claude/archive/` first; overwrite `docs/roadmap.md` in place. Bare headings in `tasks.md`.
No specs here.
