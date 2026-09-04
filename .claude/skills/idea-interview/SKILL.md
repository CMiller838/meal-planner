---
name: idea-interview
description: Runs a multi-round interview to turn a vague idea into a project outline, before any feature list or roadmap exists. Use this at the very start of a new project when the user doesn't yet know what they want to build, when they say things like "I have an idea but haven't fleshed it out", "help me figure out what to build", "I'm not sure what features I need yet", or "can you help me think through this project". Also use it later, on an already-outlined project, whenever the user wants to add a new idea to it ("I just thought of something", "add this feature idea", "here's another idea for the roadmap") — in that case it interviews about just the new idea and merges it in, rather than starting over. Do not use this for planning a phase that's already scoped (that's the planner agent's job) — this skill runs before a feature list exists at all.
---

# Idea Interview

You are helping someone turn a rough idea into a concrete project outline through
conversation, not by guessing on their behalf. Stay in the main conversation for
this — it only works as genuine back-and-forth, never as a one-shot report.

## Step 0: Detect mode

- **No project outline or README describing the product exists yet** → run Full
  Interview (Step 1).
- **An outline/README already describes the product, and the user is raising one
  new idea** → run Single-Idea Interview (Step 4) instead. Skip straight there;
  don't re-run the full interview.

## Step 1: Check for existing material first

Before asking a single question, ask the user: "Do you have any existing
notes, docs, or a brain-dump I should read first?" If they point you at a file
(or several), read all of them before continuing — extract anything that already
answers a question below so you don't re-ask it. If they say no, move on
immediately; don't stall waiting for material that doesn't exist.

## Step 2: Full interview

Ask in small batches — 2-4 focused questions per round, not one long form.
Read each answer before deciding the next batch; skip any question the existing
material already answered. Keep going across as many rounds as it takes for the
picture to actually be clear — do not stop after one round out of politeness.
Cover, in roughly this order:

1. **Problem** — what's broken or missing that this solves; who feels that pain.
2. **Users** — who actually uses it, solo tool vs. shared/multi-user.
3. **Must-haves vs nice-to-haves** — the smallest version that's actually useful,
   separated from things that would be nice eventually. See Step 2a — do not
   just record whatever list the user gives you here without pressure-testing it.
4. **Constraints** — stack preferences, deadline, solo build vs. team, budget for
   external services/APIs.
5. **Non-goals** — what this explicitly will not try to do, so scope doesn't
   creep silently later.

Push back gently on vague answers ("scalable" or "modern" isn't a constraint —
ask what problem that's actually standing in for). If two answers conflict
(e.g. "solo weekend project" plus a five-service architecture), surface the
conflict and ask which one gives.

Only stop the interview once you can write every section in Step 3 without
inventing an answer.

## Step 2a: Be the MVP guardrail, not a yes-man

Your most important job in this interview is resisting scope creep, not
recording everything the user is excited about. People planning a new project
almost always propose more must-haves than an actual MVP needs — treat a long
must-have list as a signal to push, not a spec to accept.

There is no fixed number of must-haves to enforce — judge it per project from
the problem statement in point 1. Ask yourself (and the user): if this shipped
with *only* the must-have list, would it actually solve the core problem for
the target user? If yes, anything beyond that is a candidate for nice-to-have
or parked, not a must-have.

For every feature the user proposes as a must-have, ask directly: "does this
block a usable first version, or could someone use v1 without it?" Don't just
ask once at the end — challenge items as they come up, in the moment, before
they harden into an assumed must-have. If the user pushes back and gives a
concrete reason it's load-bearing (not just "it'd be nice" or "users will
expect it"), accept it as a must-have. If they can't give you that reason,
or the honest answer is "well, it'd be better with it," it's a nice-to-have
or parked candidate — say so plainly and move it there.

When the must-have list still looks long after this pass, say so explicitly:
"this list looks bigger than a first version needs — which of these would you
cut if you had to ship in half the time?" Keep pushing until what's left is a
list you'd actually be comfortable calling done-when-built.

## Step 3: Write the outline

Decide the destination using judgement, and say which you picked and why in one
sentence:

- **No README exists, or the existing one is a stub** → create/replace it with
  the project outline.
- **A real README already exists** (install instructions, badges, existing
  structure worth keeping) → don't clobber it; add or update a `## Project
  Outline` section within it instead, or write a separate outline doc and link
  it from the README if the README is already long and this would bury it.

Whichever destination, the outline covers: one-paragraph problem statement,
target users, must-have feature list, nice-to-have feature list, key
constraints, explicit non-goals. Write it as a real document a collaborator
could read cold — not a transcript of the interview.

## Step 4: Park deferred ideas

Anything raised during the interview that was explicitly *not* adopted —
"maybe later", "not for v1", "nice idea but out of scope for now" — goes into
a parked-ideas doc, not silently dropped. Use `docs/FUTURE.md` if the project
already has one; otherwise create it. Each entry needs:

- What the idea is, in one or two sentences.
- Why it was parked (scope, cost, complexity, unclear demand — whichever the
  user actually said).
- A concrete trigger for revisiting it, not "someday" — e.g. "once there are
  paying users", "if the manual version becomes a bottleneck", "after v1 ships".

Append to the existing file if one exists — never overwrite prior parked ideas.

An idea is either a nice-to-have (in the outline, planned for later in this
project) or parked (in `docs/FUTURE.md`, not currently planned at all) — not
both. If it's genuinely a "yes, eventually, once X" item, put it in
`docs/FUTURE.md` only and leave it out of the outline's nice-to-have list, so
the outline reflects only what's actually in scope for this project's roadmap.

## Single-idea interview (adding to an existing project)

Used when a project outline already exists and the user has one new idea to
fold in, not a whole new interview.

1. Read the existing outline/README and `docs/FUTURE.md` (if present) first —
   don't ask about things they already answer.
2. Ask enough to place the idea: what problem it solves, whether it's a
   must-have now or a nice-to-have, and any constraint it introduces. Usually
   one round of questions is enough here — this is deliberately lighter than
   the full interview.
3. If adopted: add it to the outline's feature list (must-have or nice-to-have,
   per the user's answer).
4. If parked: append it to `docs/FUTURE.md` following the format in Step 4
   above, including why and the revisit trigger.

Never re-run the full Step 2 interview in this mode — that would re-litigate
decisions the user already made.
