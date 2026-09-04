---
name: restyle-from-prototype
description: >
  Restyles the live app's real templates/components and stylesheet to match the visual
  design of one of the standalone mockups the ui-prototyper agent generated (in the
  prototypes directory, e.g. design-prototypes/ui-concepts/). Use whenever the user asks
  to restyle, reskin, re-theme, "make it look like X", "apply this design/prototype/
  mockup", names a prototype file, or says the current UI looks plain and should match
  one of the prototyped concepts.
disable-model-invocation: true
---

# Restyle from a UI prototype

The prototypes are static, self-contained mockups with fake data — they exist
to let the user pick a visual direction quickly without wiring up real data or
touching the real app. This skill is the second half: carry the chosen
mockup's design language into the real app, without breaking anything that
reads or writes real data through it.

## 1. Confirm the target prototype

List what's available and confirm which one to use if the user hasn't already
named it unambiguously:

<!-- TEMPLATE: fill in the actual prototypes directory, e.g.
`ls design-prototypes/ui-concepts/*.html` -->

If the user names a style loosely ("the dark one", "the ledger one"), match it
against filenames rather than guessing — prototypes often share a mood, and
picking the wrong one wastes the whole conversion.

## 2. Read before writing

Read fully, in this order, before editing anything:

1. **The target prototype** — its styling is the design system: color palette
   (group into background/surface/text/accent/semantic-status roles, not just
   raw hex codes), font stack, spacing scale, border-radius/shadow language,
   and structural patterns (sidebar? card grid? table? single column?).
2. **Every real template/component the restyle touches.** Note every data
   binding — template loops/conditionals, framework props/state, whatever this
   stack's equivalent is — the prototype invented data where these have real
   data, and the restyled version must keep every one of those bindings, just
   inside new markup.
3. **The current stylesheet** — especially any semantic/status classes already
   in use (success/warning/error, active/selected states) so their *meaning*
   survives the restyle even if their exact colors change.
4. **Any script or backend response shape the markup depends on** — inline
   `<script>` blocks, event handlers, or API routes that select elements by
   class/id or expect specific JSON fields. This is what a purely visual skim
   misses, and it's usually where a restyle silently breaks something.

## 3. Rewrite markup + styles together, not styles alone

Full markup restructuring is in scope, not just a color swap — it's fine to
reshape a component's structure to match the prototype's layout. But every
markup change has to carry its data and behavior with it in the same edit:

- **Every data binding moves with its element** — it doesn't get pruned for
  looking inconvenient in the new layout. If the prototype's card only shows a
  title and a status pill but the real item carries more fields, those fields
  still need a home in the new structure.
- **If you rename or restructure a class/id that a script or the backend's
  response shape depends on, update that selector in the same edit.** A page
  that looks right on first load but silently stops wiring up interactivity
  because a selector went stale is worse than an unstyled page — it fails
  invisibly.
- **Keep the semantic meaning of status colors, not their exact hex values.**
  Map an existing tier/status system onto the prototype's own palette rather
  than leaving old hex codes untouched or picking colors that invert the
  meaning (e.g. don't let "success" become red because that's the prototype's
  accent color).
- **Leave vendored/third-party widget styling alone** unless the user
  explicitly asks for a theme change on it — a prototype rarely models a
  complex embedded widget, so restyle the chrome around it, not the widget
  itself.
- **Don't touch backend/route logic.** Response shapes and endpoint contracts
  are out of scope for a visual restyle. If a rename seems to require a
  backend change, that's a sign the plan has drifted past "restyle" — stop and
  check with the user.

## 4. Verify it still works

A restyle that looks right in the diff but breaks at runtime is a regression,
not a style choice. After editing:

1. Get the dev server/app running (use this project's `run-server`-equivalent
   skill if one exists, or ask how to start it).
2. Restart it if templates aren't hot-reloaded by this stack.
3. Exercise the real routes/pages that changed — via `curl`, or a browser MCP
   if one's configured (see the `ui-prototyper` agent for the same check).
   Confirm no errors, and that data bindings rendered real content, not empty
   gaps from a lost loop variable.

## 5. Report back

Say which prototype was applied, which files changed, and flag anything you
deliberately left unstyled (a vendored widget) or anywhere the prototype's
pattern didn't have an equivalent in the real page and you had to improvise.
