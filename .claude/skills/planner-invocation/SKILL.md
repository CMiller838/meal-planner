---
name: planner-invocation
description: Efficiency protocol for invoking the planner agent in phase mode (spec + tasks breakdown) — name exact files, reference one prior phase as the format model, gate genuinely important decisions (architecture, reuse-vs-build, anything contradicting the dispatch prompt's assumptions) while auto-proceeding on trivial forks, and leave discovery/scanning to planner itself rather than pre-scanning in the coordinator session. Use whenever about to invoke @planner for a phase spec.
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
4. **Gate important decisions, auto-proceed on trivial ones.** See the note on
   decision gates below — ask `planner` to always state its own recommendation,
   but to actually pause and wait for the user's pick on anything important
   (not just note it and move on), while still deciding trivial forks itself.
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
back, or where the resolution changes the shape of the phase: schema/data
changes, a new endpoint/dependency, which existing function or surface gets
reused vs. a new one being built, anything later phases build on, or anything
where planner's own finding contradicts what the roadmap/dispatch prompt
assumed going in. Most pure UI/behavior choices in a phase aren't that —
they're one CSS rule or one function away from being changed later.

- Tell `planner` up front: *always state your recommendation. For a trivial
  fork (one that's cheap to change later and doesn't affect other files),
  decide it yourself and note the call in the spec. For anything important —
  see the criteria above — actually raise a Decision Gate and HALT for the
  user's explicit pick; do not just record your own call and proceed.* The
  distinction that matters here is between deciding-and-noting vs.
  deciding-and-halting — recommending is not a substitute for gating when the
  fork is important enough to warrant one.
- A finding that contradicts the dispatch prompt's or roadmap's stated
  approach (e.g. "the spec assumed X could be reused, but it can't") is
  exactly the kind of thing to gate, not silently route around — the user
  chose that approach for a reason that may not be visible in the code.
- If `planner` does surface gates, prefer resolving them in the **same
  message** that spawned it isn't possible after the fact — so front-load
  context (constraints, prior settled scope, what's out of bounds) into the
  first prompt so `planner` has enough to default-decide the *trivial* forks
  without needing a round trip for those.
- A pause-and-resume round costs roughly 2x the pre-pause transcript in
  tokens — this is the real price of gating more: expect phases with genuine
  architectural forks to cost more than a fully zero-pause run, in exchange
  for the user actually choosing those forks instead of inheriting planner's
  pick after the fact. If a phase is likely to have 2-3 genuine forks, it's
  still cheaper to ask `planner` to list all of them at once with its
  recommendations, get one batch answer from the user, and resume once — not
  one resume per gate.
- **Never tell `planner` it may proceed past a gate without the user's
  answer**, e.g. "don't block awaiting go-ahead," "proceed after presenting,"
  or similar. `planner.md`'s Stage 2 HALT is explicitly non-negotiable and
  says a dispatch prompt can never satisfy it on the user's behalf — but
  wording like that still gets treated by planner as license to self-resolve
  every gate, defeating the whole point of gating. If minimizing round trips
  is the goal, say so via batching (list all gates in one message, one
  resume) — never via a proceed-without-me instruction.
