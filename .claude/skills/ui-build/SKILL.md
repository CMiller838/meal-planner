---
name: ui-build
description: How every UI change is built - in the app's existing style, animated and clean, checked by eye in both themes and at phone width. The builder (in session, /build or /overnight) uses this for ANY UI work - a new page, tile, widget, button, form or state - not just "UI tasks". Use whenever a change touches the UI source, a spec has UI tasks, or the user asks to add, change, polish or animate something in the app.
---

# Build UI in the house style

The style is settled; new UI joins it, it doesn't invent one. Everything project-specific (paths, tokens, themes,
motion, how to run the app) is in `docs/UI_STYLE.md`. The `ui-prototyper` agent is only for when the user asks for new
visual ideas; never prototype a normal feature.

## Before writing

1. Read `docs/UI_STYLE.md`. If **Status** is `unset`, there is no house style yet: do not invent one. Ask the user to
   pick a direction (`ui-prototyper`, then `restyle-from-prototype`), or if the app already has a stylesheet, run
   `restyle-from-prototype` step 6 in its "existing app" mode first. Then continue.
2. Invoke `emil-design-eng` (if the project has it). Where it conflicts with `docs/UI_STYLE.md`, UI_STYLE wins.
3. Find the closest existing piece (Paths in UI_STYLE) and copy its structure. Reuse, don't re-style: a new look for
   an existing pattern is a defect.

## While writing

- Tokens only (colour, radius, space, font); no raw hex outside the token file. Keep CSS where the project keeps it.
- Every page uses the shared page header. Empty/error/loading states use the shared components, never a blank box.
- **Always animate, quietly** (UI_STYLE Motion): new blocks enter, list reorders animate, presses/hovers 120-200 ms,
  changing numbers tween. `transform`/`opacity` only; no animation on data refresh. Honour `prefers-reduced-motion`.
- Clean: one accent use per block, hierarchy by type not boxes, status = colour + text. Keyboard reachable, visible
  focus, labels on inputs.
- No new dependency or CDN script without asking the user.

## Before calling it done

- The project's checks (CLAUDE.md "Commands").
- Look at it: spawn a sonnet general-purpose agent with the URL and a short checklist that uses `prototype-preview`
  in each theme at desktop width and at the phone width from UI_STYLE, reduced motion on once. Checklist always
  includes: no horizontal scroll on the phone, every theme legible, entrance plays once, empty/error state renders.
- If you introduced a new token, pattern or motion rule, add it to `docs/UI_STYLE.md`.
- Name the component source you adapted in the summary or commit.
