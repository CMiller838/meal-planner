---
name: roadmap-gating
description: Instructions for dynamically discovering and updating any active roadmap (roadmap.md) and checklist (tasks.md, todo.md) files in the repository during commits. Use before staging files, creating a commit, or ending a milestone/phase.
---

##  DYNAMIC ROADMAP & TASK GATING PROTOCOL

You are bound by a strict project rule to synchronize your implementation progress with our repository documentation. Before staging files, creating a commit, or ending a milestone, you must run this automatic alignment loop:
 STEP 1: Dynamic Discovery (Zero Hardcoding)

Before asking the user or assuming filenames, use your search tools (Glob, Grep) to look for the active tracking files in the workspace — skip this step entirely if you already resolved these paths earlier in the same session, they don't move mid-session:

    The Checklist File: Look for files matching tasks.md, *tasks*.md, todo.md, todo*.md, or checklist.md at the repository root.
    The Roadmap File: `docs/roadmap.md` is the one active roadmap file — do not glob for other `*roadmap*.md` files at root or in `docs/`. Superseded versions live in `.claude/archive/` and are history, not active tracking; never edit them and never create a new versioned roadmap file (`roadmap-v5.md`, `docs/V5_ROADMAP.md`, etc.) — always update `docs/roadmap.md` in place.
    CLAUDE.md Inspection: Read the root CLAUDE.md to see if a specific roadmap or task file has been explicitly named or pinned under a "Key Files" or "Conventions" header.

If no matching files are found, skip this protocol.

Token-cost discipline: both tracking files only grow over a project's life — never `Read`
either one in full for this audit. Grep for the checkbox lines and phase heading that are
actually relevant to what you just changed (by filename, feature name, or current phase
number) and read only that matched region plus a few lines of surrounding context.

 STEP 2: Audit Active Files vs. Checklist

Once the files are discovered:

    Grep the Checklist File for unchecked (`- [ ]`) items whose wording matches the codebase files/features you edited or created this commit.
    Update the checklist by marking successfully completed tasks as checked (- [x]).
    Maintain the file's original style, formatting, and history.

 STEP 3: Evaluate Roadmap Phases

    Grep the active Roadmap File for the current phase heading (the one your task belongs to) and read only that section to check its exit criteria — not the whole file.
    Evaluate whether your completed work satisfies the criteria for that phase.
    If a phase or milestone is complete, mark it as done (- [x]) and update any progress metrics (e.g. (Status: Complete) or (100%)).

STEP 4: Atomic Progress Commits

    Ensure that the updated Checklist and Roadmap files are staged and committed in the exact same Git commit as the code changes that completed them.
    Write a highly professional, human-sounding commit message using conventional commit prefixes (e.g., feat:, fix:, refactor:) that explicitly reflects the checklist progress.
