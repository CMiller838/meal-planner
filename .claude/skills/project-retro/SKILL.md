---
name: project-retro
description: Whole-project retrospective run once every phase in docs/roadmap.md is marked done. Walks the shipped project against the original outline, interviews the user for what to change/add/remove, files findings into docs/FUTURE.md, and flags whether the tech stack itself needs revisiting. Use when the user says things like "the roadmap's done, let's review", "what should we change before v2", "I want to go through the project and list things for later", or "let's do a retro" — not for reviewing a single phase or a single PR, and not for planning what's next (that's idea-interview seeded from this retro's output, then planner).
---

# Project Retro

Run this once, at the end of a completed roadmap — not per-phase. It produces
the raw material the next `idea-interview` pass will use to scope v2; it does
not itself scope v2.

## Step 1: Confirm the roadmap is actually done

Read `docs/roadmap.md`. If any phase isn't marked done, tell the user and ask
whether they want a retro anyway (e.g. cutting the rest for now) or to finish
the roadmap first. Don't assume — proceed only once they confirm.

## Step 2: Compare shipped state to the original outline

Read the project outline (README's outline section, or standalone outline
doc) and `docs/FUTURE.md`. Read `docs/roadmap.md` phase-by-phase to see what
actually got built, including any deviation noted in a phase's exit condition.
Before asking the user anything, build a short internal list of:

- Must-haves from the outline that shipped as originally scoped.
- Must-haves that shipped but changed shape during building (worth asking about).
- Anything in the outline that was never built (dropped silently, or should it
  be re-raised?).

Do not present this as a wall of text — use it to make your interview
questions specific and skip questions the roadmap already answers.

## Step 3: Interview the user

Ask in small batches, multiple rounds as needed — same discipline as
`idea-interview`. Cover:

1. **What's working** — briefly, so it's not lost; doesn't need action.
2. **What to change** — anything shipped that should be reworked, not just
   added to. Get specific: what's wrong with it, not just "improve X".
3. **What to add** — new ideas that came up while using the real thing (these
   almost always surface once something is actually usable, not while it was
   still hypothetical). For each: push on whether it's a real need or scope
   creep, the same way `idea-interview` does — a retro is not an excuse to
   relitigate MVP discipline.
4. **Stack health** — ask directly: "has anything about the current stack
   caused friction, or made a feature harder than it should've been?" Most
   retros should get "no" here; take a "yes" seriously; a vague "it'd be nice
   if it were faster/cleaner" without a concrete friction point is not one.

## Step 4: File the results

A retro item is either **adopted now** or **parked** — same either/or as
`idea-interview`'s nice-to-have-vs-parked rule, and it decides which file it
goes in:

- **Adopted now** (the user wants it built, soon, as part of v2's own
  scoping): add it to the outline's feature list, not `docs/FUTURE.md` —
  `docs/FUTURE.md` is only for things *not* currently planned. It's fine for
  it to land as a new must-have or nice-to-have candidate; `idea-interview`
  will still re-scope the whole must-have list against MVP discipline when v2
  starts, this isn't the final word on it.
- **Parked** (deferred, out of scope for now): append to `docs/FUTURE.md`,
  following the same format as `idea-interview` (what it is, why it wasn't
  done now, a concrete revisit trigger — not "someday"). Group this retro's
  parked entries under a `## From v1 retro (<date>)` heading, so a later
  `idea-interview` pass can find them as a ready-made starting point instead
  of re-deriving them from scratch.
- **Outline drift**: if Step 2 found must-haves that shipped differently than
  planned, or were dropped, update the outline/README to reflect what's
  actually true now — the outline should describe the real shipped product,
  not the original plan, once they've diverged.
- **Stack concern**: if Step 3 surfaced a real one, don't invoke the architect
  agent yourself — tell the user plainly what the concern is and recommend
  they run `@architect` to reconsider it as a deliberate, separate step. A
  stack revisit is disruptive enough that it should never happen as a side
  effect of a retro. If Step 3 surfaced no real friction (the common case),
  there's nothing to file for this — don't manufacture a concern to have
  something to say.

## Step 5: Hand off

End by stating plainly: the retro is filed, and the next step (whenever the
user is ready) is a seeded `idea-interview` pass reading this retro's
`docs/FUTURE.md` entries, followed by `planner` in roadmap mode for v2. Don't
start that yourself — this skill's job ends at filing the retro.
