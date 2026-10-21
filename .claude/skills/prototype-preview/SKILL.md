---
name: prototype-preview
description: Look at a Meal Planner page or prototype in a real browser instead of asserting from source. Use whenever asked to check, test, verify, look at or screenshot a page, before claiming a UI change works, and after ui-prototyper or restyle-from-prototype touches pages. This project's wrapper: the real work is done by the browser-check skill.
---

# Prototype preview (Meal Planner)

The template version drives Playwright from `tools/browser-check/`. This project has no npm tooling and must not gain
any, so the same job is done by the **`browser-check` skill** (cached headless Chrome over a throwaway
`python3 -m http.server`, no sandbox override). Read that skill and use it.

- Pages and prototypes: see **Preview** in `docs/UI_STYLE.md`. Prototypes are static files in `design-prototypes/ui-concepts/`.
- Themes: `dark` (default) and `light`. Check both, by setting `localStorage.mp_theme`/the `data-theme` attribute the page
  uses (see `getTheme`/`applyTheme` in `data.js`), at desktop width and 390 px.
- TheMealDB and Hermes calls are blocked in the sandbox, so Discover renders empty. That is expected, not a defect.
- Always Read the screenshot before saying something renders correctly.
