---
name: planner-invocation
description: Efficiency protocol for invoking the planner agent in phase mode (spec + tasks breakdown) — name exact files, reference one prior phase as the format model, bias toward zero-pause decision gates, and leave discovery/scanning to planner itself rather than pre-scanning in the coordinator session. Use whenever about to invoke @planner for a phase spec.
---

## PLANNER INVOCATION EFFICIENCY PROTOCOL

`@planner` (phase mode) calls burn tokens fast because a resumed agent replays
its whole prior transcript. Follow these rules whenever invoking `planner`
for a phase spec + tasks breakdown:

1. **Do not pre-scan the codebase yourself.** `planner.md`'s own Stage 1
   already spawns a `scanner` subagent (Haiku, read-only) whenever a phase
   needs bulk file reading, and reports back only function signatures/
   existing helpers/behavior — not raw dumps. Spawning a scanner in the
   *coordinator* session first duplicates that cost: the digest lands in the
   coordinator's context via the tool result, then gets pasted again into the
   planner prompt, and planner may still re-verify parts of it anyway. Let
   planner decide for itself whether the phase warrants a scan and do that
   research on its own turn, where the digest never has to cross back through
   the coordinator's context at all.
2. **Name exact files and locations, never "read the relevant code."** Point
   at specific files, and where possible specific functions/line
   ranges/CSS selectors, directly in the `planner` prompt — this is what lets
   planner's own Stage 1 skip straight to targeted Glob/Grep or a scanner
   call instead of an open-ended sweep.
3. **Reference exactly one prior phase as the format model.** Tell `planner`
   which single phase's `.claude/specs/phaseN_spec.md` + its `tasks.md`
   section to match for depth/structure — never "look at prior phases" or
   "other phase specs."
4. **Bias toward zero-pause decision gates.** See the note on decision gates
   below — ask `planner` to state its own recommendation and default to
   proceeding on it (not pausing) for any fork that isn't genuinely high-stakes
   or irreversible for the project.
5. **Tell `planner` to touch only its own phase's slice of `tasks.md`.**
   `tasks.md` accumulates every prior phase's full checklist — instruct
   `planner` explicitly to `Grep` for `^## Phase <N>` (its own heading) and
   the next `^## Phase` heading to get its exact line range, read only that
   slice, and never read or reason about any other phase's tasks (the one
   phase named as the format model in rule 3 is the sole exception). This is
   already in `planner.md`'s own instructions, but restate it in the prompt —
   a resumed `planner` call replays its whole prior transcript, so a blind
   full-file read early on is expensive to have happened at all.

### Decision gates

A fork worth pausing for is one where getting it wrong is expensive to walk
back (schema shape, a new endpoint/dependency, something later phases build
on). Most UI/behavior choices in a phase aren't that — they're one CSS rule or
one function away from being changed later.

- Tell `planner` up front: *state your recommendation and proceed with it by
  default; only pause and ask if the choice is high-stakes or hard to
  reverse.* Don't leave "ask the user" as the implicit default for every fork
  it notices.
- If `planner` does surface gates, prefer resolving them in the **same
  message** that spawned it isn't possible after the fact — so front-load
  context (constraints, prior settled scope, what's out of bounds) into the
  first prompt so `planner` has enough to default-decide instead of pausing.
- A pause-and-resume round costs roughly 2x the pre-pause transcript in
  tokens. If a phase is likely to have 2-3 genuine forks, it's cheaper to ask
  `planner` to list all of them at once with its recommendations, get one
  batch answer from the user, and resume once — not one resume per gate.
