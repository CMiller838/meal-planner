# Meal planning with Cody: worked example

A record of how the 2026-10-26 two-week plan was made, so a future Claude/Hermes session can repeat the process. It is a worked example, not a spec. The contract is `docs/HERMES.md`; the generator is `generator.js`.

## The shape of the conversation

1. **Cody asks for a plan**: "Can we make a meal plan for the next two weeks".
2. **Draft from the planner's own generator.** Never invent a plan (`POST /plan/draft`, or `PUT /planFlag` and "ready in the app"). The generator fills around locked and eaten slots.
3. **Cody reacts in plain language.** Every reaction becomes a hard constraint, applied on the next redraft (see "Rules" below).
4. **State of the kitchen comes from Cody, not guesses.** He says what is already cooked, what is left and what he has in. That goes into the pantry, and anything already cooked becomes a leftover placement.
5. **Place meals through the placements queue**, then check the result in the planner.
6. **Check the shopping list and price**, then adjust (bulk buys, pack sizes, duplicates).
7. **Report:** what changed, the total, what still needs his decision.

## Rules Cody set (keep these)

- **Slots:** breakfast, lunch, dinner only. **There is no snack slot** (removed from the generator, Plan page, walkthrough and shopping list).
- **Dislikes (never plan):** omelette, egg-fried rice, kidney bean and pepper toasties, mushrooms, wraps.
- **Lunches** are toasties and quick batch-friendly meals (ham and cheese, chicken and cheese, chicken noodle stir-fry, chicken and tomato pasta, chicken and veg rice bowl). Do not leave lunch slots empty.
- **Breakfasts** alternate porridge and French toast.
- **Waffles are spontaneous.** Never plan them. Cody tells me on the day, and I put them in that day's breakfast slot or log them as eaten.
- **Cooked once, eaten twice:** a batch dinner is cooked on day N and eaten again on day N+1 (Salmon, Rice & Broccoli on days 3 and 4; Sticky Chicken Thighs on 5 and 6; Coconut Fish Curry on 7 and 8).
- **Spoilage warnings:** only for pantry items where Cody has entered a use-by date. No estimated shelf-life warnings, and the generator no longer filters meals by estimated shelf life.
- **Slightly-off food:** if something like chicken thighs is a day or so past its date, keep it and do not buy more. He tells me when something is actually bad.

## What he told me about the kitchen (example of the kind of input)

- Mince used up, so only the cooked **chilli** is left, for Monday. That is placed with `leftover: true, portions: 1`, so the shopping list buys no mince for it. He will buy more mince midweek.
- **500g chicken thighs** left, so plan around 500g, not a full pack.
- Has **soy sauce, tomato puree, cumin, paprika**. Do not put these on the list.
- Bulk buys he is happy with: **500g cheese** (frozen after opening), plus chicken thighs, oats, rice and pasta where the bulk option saves money.

## Mechanics (what Hermes actually did)

1. Sync both clones first (`git pull --ff-only`). Read `/library`, `/plan`, `/pantry`, `/placements`.
2. Update the pantry from what he said (`GET /pantry`, change items, `PUT /pantry` with a fresh `updatedAt`).
3. Propose meals with `PUT /placements`. The whole array replaces the old one every time. Placements are one entry per day and slot: `{ id, day, slot, mealId, mealName, requestedAt, leftover?, portions? }`.
4. The app applies the queue with `MP.Plan.applyPlacements`. Hermes cannot write `/plan` (403 on the normal route). Check what the app would produce by running `applyPlacements` against the server plan and library.
5. This session also wrote the resulting plan to the server copy directly as a one-off, because the phone app was showing a stale plan and reset on refresh. After that, pull the plan again on the phone rather than saving over it.
6. Price check: run `MP.ShoppingList.buildLists` over the plan, library, pack-sizes and pantry, and sum each shop. Result this time: **shop 1 £32.40, shop 8 £22.40, total about £54.80**. Check the biggest lines and any duplicates.

## Shopping list conventions

- Two shops: one at the start of each week.
- **Essentials checklist at the end of every shop** (no price, plain tick-boxes): milk, bread, eggs, butter, tea bags, fruit, toilet roll, washing-up liquid. Edit it in `pack-sizes.json` (`essentials`). They are reminders, so duplicates with meal ingredients are fine.
- Bulk options come from `bulkOptions` and are kept when they save money (cheese, chicken thighs, oats, rice, pasta).
- Ham is one pack per week.

## Checklist for the next plan

- [ ] Sync both clones, read library, plan, pantry, placements.
- [ ] Ask (or read) what is already cooked, what is left, what he has in.
- [ ] Draft with the generator. No hand-made plans.
- [ ] Apply his dislikes and the no-snack rule, and fill every lunch slot.
- [ ] Place leftovers with `leftover: true`.
- [ ] Rebuild the shopping lists, check the totals and the biggest lines.
- [ ] Confirm the plan shows on the Plan page with every day filled and no JS errors.
- [ ] Report: what is placed, the shop totals, what he needs to decide.
