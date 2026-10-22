# Phase 52: Vault data layer and personal profile [M]
Plain: edit your targets, allergies, likes, dislikes and budget in Obsidian's `Meals/Profile.md`, and the planner uses them.

Requires Phase 48 (spec written, not built: `/overnight` builds 48 first). Fallback if `logWrite`/`ITEMS` are missing in
`worker/worker.js` when this is built: skip the logging call and say so in the commit. Phases 32 (done) and 34 (built) are
met. Assistant side: `notion_assistant` Phase 42 (built 2026-10-20), not needed to build or test this phase.

## Scope finding (retagged L -> M)

The vault half of the roadmap entry is already built in the assistant repo (`notion_assistant/meal_vault.py`, its
Phase 42): it writes the `Meals/` mirror and the daily snapshot under a "generated, edits overwritten" header, parses
`Meals/Profile.md`, previews the diff, and on Apply calls `PUT /settings` (falling back to "stored" on a 404). Folder
layout, the PC-off lag, mirror rebuild and the no-secret check are settled and verified there. **This phase is only the
planner side: a `settings` KV key, `GET/PUT /settings`, and the planner reading it.** Mirroring products, leftovers,
ratings, activity and drafts is assistant work over routes those phases already expose.

## Decisions

User-chosen (2026-10-22):
- **Dislikes are soft**: an avoid group in `rankSlot`'s existing chip layer (to the back, never filtered). Likes are the
  prefer group. Allergies and `never` terms are hard.
- **Profile.md owns the budget**: while `settings.budgetTarget > 0`, it overrides `mp_planPrefs.budgetTarget` at every
  read, and the Plan-with-me slider is disabled with "set in Profile.md". Remove the line and the slider is live again.

Own calls:
- **One writer**: `settings` is written only by `PUT /settings` (assistant token or `AUTH_TOKEN`); the app only reads.
  No in-app editor, so no two-writer conflict. Profile.md's conflicts are the assistant's preview-then-apply.
- **Accept the assistant's existing body** `{ targets: {k: number}, allergies, dislikes, likes, never }` unchanged.
  The Worker normalises it, stores the normalised form and answers `{ ok: true, settings, ignored: [keys] }`:
  - target key resolution: exact `nutrition-targets.json` top-level key (not `_note`/`gymDay`); else `calories`/`kcal`
    -> `energy_kcal`; else the one target key whose part before the first `_` equals it (`protein` -> `protein_g`,
    `sodium` -> `sodium_mg_cap`). `budget` (in `targets` or top level) -> `budgetTarget`.
  - unknown keys (goal lines like `weight: 80`) are **dropped and listed in `ignored`**, never a 400, so goals can live
    in Profile.md. A known key with a bad value (not finite, <= 0, or > 10x the file default) is a 400 naming it.
  - lists: strings trimmed and lowercased, empties dropped, de-duplicated, max 50 items x 40 chars (400 beyond).
- **Targets merge per key over `nutrition-targets.json`**; a key absent from settings uses the file value; `gymDay`
  uplift still applies on top. `targets: {}` = file defaults.
- **Term matching reuses `MP.Exclusions`' ingredient matcher** (substring of ingredient `key`/`label`, as mushrooms).
  Hard terms (allergies + never) filter the `rankSlot` pool before ranking (no too-small fallback, like Phase 51's
  `never`), drop TheMealDB results in `/discover` and `mealdb.js`, and show as a reason on the add-meal check. Meals already
  in a saved plan are left in place (no silent plan edit).
- **App cache `mp_settings`**, refreshed by `MP.Sync.fetchSettings()` on page load when sync is on; read through
  `MP.Sync.settings()` (null when absent/corrupt). Targets apply on the next page load after a fetch (one-load lag,
  fine for a file edited in Obsidian). Sync off = file defaults, no terms, today's behaviour.
- **Settings visible once**: one line in `index.html`'s "Hermes sync" section: "Profile: N targets, M food rules,
  updated <date>" or "Profile: not set". No other UI.
- Profile fields the planner has no use for (equipment, cooking time, spice, goals, gym days) stay in Profile.md only;
  the assistant already derives `today.gym`. Add when a planner feature needs one.

## Files touched

- `worker/worker.js`: `KEYS["/settings"] = "settings"`; `normalizeSettings`; `putSettings` route; `ASSISTANT_ALLOWED`
  gains `GET /settings`, `PUT /settings`; `ranking`/`nutrition` (and `/today` if it uses targets) merge settings targets
  and pass `profile` to `rankSlot`; `ranking` overlays `budgetTarget`; `/discover` drops hard-term hits; Phase 48
  `ITEMS.settings = [null]` and a `logWrite` call in `putSettings`.
- `exclusions.js`: `termHit(meal, terms)`; `check(meal, terms)` optional second arg.
- `nutrition.js`: `withProfile(targets, settings)`; `load()` applies `MP.Sync.settings()` when present.
- `generator.js`: `rankSlot` reads `opts.profile`.
- `hermes-sync.js`: `fetchSettings()`, `settings()`; called on load.
- `plan.js`: pass `profile` into generation, overlay `budgetTarget` on `basePrefs`.
- `plan-with-me.js`, `plan-with-me.html` (only if the label needs a slot): disabled slider + note.
- `mealdb.js`, `app.js`: hard terms in Discover results and the add-meal check.
- `index.html`, `app.js`: the Profile line.
- `sw.js`: bump `CACHE`. `tools/worker_test.mjs`, `test.html`: asserts.
- `docs/ARCHITECTURE.md`: ADR "v8 - profile settings", KV row `settings`, endpoint rows. `CLAUDE.md`: one invariant line.

## Signatures / schemas

```
KV settings = { updatedAt: ISO, targets: { [nutrition-targets key]: number }, budgetTarget: number (0 = none),
                allergies: string[], dislikes: string[], likes: string[], never: string[] }
GET /settings -> 200 settings | 200 {} when absent
PUT /settings body { targets?, budget?, allergies?, dislikes?, likes?, never? }
  -> 200 { ok: true, settings, ignored: string[] } · 400 "<key>: <why>"
function normalizeSettings(body, fileTargets) -> { settings, ignored } | { error }      // worker.js, pure
MP.Exclusions.termHit(meal, terms) -> string | null                                    // first matching term
MP.Exclusions.check(meal, terms = []) -> { ok, reasons }                               // + "contains <term>"
MP.Nutrition.withProfile(targets, settings) -> targets copy                            // pure, null settings = same
rankSlot opts.profile = { hard: string[], likes: string[], dislikes: string[] }        // absent = today's behaviour
MP.Sync.fetchSettings() -> Promise<settings|null>   // failure-silent, keeps last cache
MP.Sync.settings() -> settings | null
```

`profile.hard = allergies ∪ never`. Likes/dislikes join the chip groups as `{ kind, keywords }` entries; a meal hitting
both a like and a dislike goes to prefer (same precedence as chips).

## Edge cases

- Settings absent, `{}`, or sync off: every output identical to today (assert a plan generated with and without empty
  settings is byte-equal).
- Hard terms empty the pool for a slot: the slot is empty, same as Phase 51 `never`; no fallback to excluded meals.
- `budget: 0` in Profile.md = no override (slider live).
- Ambiguous prefix (two keys share it): ignored, listed in `ignored`.
- Corrupt `mp_settings`: `settings()` returns null, no throw.
- An allergy term that also substring-matches harmless words (`nut` in `nutmeg`) is filtered: term matching is
  deliberately blunt (ponytail: substring, same ceiling as the mushroom rule; upgrade is whole-word match if it bites).
- Assistant token PUT with a body over 16 KB: 400.

## Verification

- `python3 check.py` passes (data_check, secrets, ui pages, ui walk).
- `node tools/worker_test.mjs`: `PUT /settings` with `{ targets: { calories: 2400, protein: 170, weight: 80 },
  allergies: [" Peanut "], dislikes: ["olives"] }` stores `energy_kcal: 2400, protein_g: 170`, `allergies: ["peanut"]`,
  answers `ignored: ["weight"]`; `protein: -1` is 400; `GET /ranking` never returns a meal with a peanut ingredient and
  ranks an olive meal after an otherwise-equal one; `GET /nutrition` targets show 2400; assistant token can GET/PUT;
  no token is 401; the write appears in `GET /activity` (if Phase 48 built).
- `test.html` asserts: `withProfile` merge and null passthrough; `termHit`; `rankSlot` with `profile` filters hard,
  reorders likes/dislikes, and with no `profile` equals today's order.
- Browser (fresh profile, PC + 390 px, both themes): seed `mp_settings` with `budgetTarget: 35` and a hard term, open Plan with
  me (slider disabled, "£35/wk · set in Profile.md"), generate (no meal with the term), index sync section shows the
  Profile line. No real credential needed (Worker tests use the fake KV and test tokens).

## Tasks

Logic (TDD):
- [ ] `normalizeSettings` + `putSettings` + `GET /settings`, allowlist, worker_test asserts
- [ ] `Exclusions.termHit`/`check(meal, terms)`; `Nutrition.withProfile`; test.html asserts
- [ ] `rankSlot` `opts.profile` (hard filter, likes/dislikes groups); no-profile equality assert
- [ ] Worker `ranking`/`nutrition`/`discover` read settings; budget overlay; Phase 48 `ITEMS.settings` + `logWrite`
- [ ] `MP.Sync.fetchSettings`/`settings`; `Nutrition.load` applies them; `plan.js` passes profile + budget overlay

UI:
- [ ] Plan-with-me slider disabled with "set in Profile.md" while `budgetTarget > 0`
- [ ] Discover/add-meal honour hard terms ("contains <term>" reason)
- [ ] Profile line in the Hermes sync section
- [ ] `sw.js` CACHE bump; ARCHITECTURE ADR + KV/endpoint rows; CLAUDE.md invariant line
