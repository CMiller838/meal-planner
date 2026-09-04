---
name: roadmap-gating 
description: Instructions for dynamically discovering and updating any active roadmap (roadmap.md) and checklist (tasks.md, todo.md) files in the repository during commits.
---

##  DYNAMIC ROADMAP & TASK GATING PROTOCOL

You are bound by a strict project rule to synchronize your implementation progress with our repository documentation. Before staging files, creating a commit, or ending a milestone, you must run this automatic alignment loop:
 STEP 1: Dynamic Discovery (Zero Hardcoding)

Before asking the user or assuming filenames, use your search tools (Glob, Grep) to look for the active tracking files in the workspace:

    The Checklist File: Look for files matching tasks.md, *tasks*.md, todo.md, todo*.md, or checklist.md at the repository root.
    The Roadmap File: `docs/roadmap.md` is the one active roadmap file — do not glob for other `*roadmap*.md` files at root or in `docs/`. Superseded versions live in `.claude/archive/` and are history, not active tracking; never edit them and never create a new versioned roadmap file (`roadmap-v5.md`, `docs/V5_ROADMAP.md`, etc.) — always update `docs/roadmap.md` in place.
    CLAUDE.md Inspection: Read the root CLAUDE.md to see if a specific roadmap or task file has been explicitly named or pinned under a "Key Files" or "Conventions" header.

If no matching files are found, skip this protocol.
 STEP 2: Audit Active Files vs. Checklist

Once the files are discovered:

    Match the codebase files you have edited or created against the outstanding checkboxes in the active Checklist File.
    Update the checklist by marking successfully completed tasks as checked (- [x]).
    Maintain the file's original style, formatting, and history.

 STEP 3: Evaluate Roadmap Phases

    Read the active Roadmap File to determine which development phase or high-level milestone your active task belongs to.
    Evaluate whether your completed work satisfies the criteria for that phase.
    If a phase or milestone is complete, mark it as done (- [x]) and update any progress metrics (e.g. (Status: Complete) or (100%)).

STEP 4: Atomic Progress Commits

    Ensure that the updated Checklist and Roadmap files are staged and committed in the exact same Git commit as the code changes that completed them.
    Write a highly professional, human-sounding commit message using conventional commit prefixes (e.g., feat:, fix:, refactor:) that explicitly reflects the checklist progress.


