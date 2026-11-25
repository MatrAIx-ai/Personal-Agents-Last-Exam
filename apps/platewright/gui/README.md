# Platewright web interface

`index.html` and `src/app.js` are Platewright's business interface: the week's meal plan, the recipe box, the shopping list, the pantry, the household's dietary needs and other members' activity. The repository's shared Web Host (`runtime/web/server.cjs`) serves these two files with the shared `client.js` and `style.css`, and forwards only the Agent tools that the run's policy lists. `src/view.js` is the compatible reviewer renderer named by `contribution/gui.json`.

## Start

From the repository root, with Node 18 or later and no install:

```sh
node runtime/web/server.cjs --app platewright --registry apps/platewright/web.registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. `web.registry.json` lists only this package (path `.`, loaded time 2026-11-08 08:00 New York, as in `fixtures/clock.json`), so the Host starts Platewright without any change to the repository's `apps.registry.json` or to `runtime/`. A new run starts from `fixtures/reference.json`; starting the Host against an existing run never resets it. `--profile scenario` on a fresh run gives the read-only Task profile. Seeds, events, the clock and reset stay on the separate Infra MCP connection; the page has no route to them.

## Views

| View | What it shows (reads) | What a person can do there (writes) |
| --- | --- | --- |
| Meal plan | One week (`plan.get`), day by day: each meal's dishes, who is at the table, guests, state, and what the check found (unsafe, may contain, over limit, leftovers short, …); previous/next week. Selecting a meal shows the findings line by line, servings, leftovers, cooking record and history. | Plan a meal on a day or change it (`plan.slot.set`: recipes with servings or leftovers from an earlier meal of the week, attendees, guests with their needs, a note); clear it (`plan.slot.set` with no dishes); mark it cooked, with portions and taking from the pantry, or skipped (`plan.slot.mark`). |
| Recipes, Archived recipes | The recipe box (`recipes.search`, searchable); a recipe (`recipes.get`) with ingredients scaled to any servings in recipe, metric or US units, method, nutrition per serving, allergens and flags, variant base, revisions; a check for chosen members on a chosen day (`recipes.check`). | New recipe (`recipes.create`); edit (`recipes.update`, only changed fields, a new revision); archive and restore (`recipes.update` with `archived`); swap ingredients from the applicable rules (`substitutions.list`), preview the variant and how each person checks before and after (`recipes.variant.preview`), save it (`recipes.variant.create`); plan this recipe. |
| Shopping list | The current list (`shopping.get`): still to buy, in the basket, not buying, the meals each line is for, optional lines, stock expiring before use, and a notice when the list is stale. | Make a list for a window and update a stale list (`shopping.generate`); tick and untick with the checkbox, add, edit and remove own items, leave a derived line off with a reason or put it back (`shopping.item.set`, `shopping.item.remove`). |
| Pantry | Stock by freshness (past use-by, use soon, fresh, no date, used up) with each item's history (`pantry.list`). | Add an item, update stock and use-by date, mark used up (`pantry.set`). Units offered are the ones the ingredient can be measured in. |
| Household | Each member's portion factor and current needs; a member's needs with their state, dates, notes and history (`household.get`). | Add a need, change a current one, end one (`members.constraint.set`, `members.constraint.remove`). |
| Activity | What other members changed in the last 45 days, by day, with "Show older" (`notifications.list`). | — |

Ingredient pickers and ingredient names come from the ingredient table (`ingredients.search`), which no tool or event can change, so the page reads it once per page load (its pages requested together) and only when something shown or a form needs it. All 22 Agent tools are used; no Agent write is left out of the interface.

## How it behaves

- Every value comes from the Agent connection of this run. Refresh, and moving to another view, read the App again. Each view reads only what it shows: its list plus at most one more read, sent together when a view needs several. What cannot change while the page is open is not read again: the tool schemas, the ingredient table and members' names. A Core call takes about 0.2 s on the reference household and the Host makes two per read (it lists the tools first), so a view opens in about 0.5 to 1.2 s; see [Speed](../README.md#speed).
- A write is sent through the shared client's `perform()`: it carries the version the page last read (forms are modal, so that is the version seen when the form opened) and reuses its request ID when an unchanged form is sent again after a lost response, so Core returns the stored receipt instead of writing twice. A stale form says the record changed and writes nothing; close it, Refresh and try again.
- A refusal shows the App's message in the form (for example "The end date (Tue 10 Nov 2026) is before the start date (Fri 20 Nov 2026)."); the error code is kept on the element as `data-code`. A dish that is wrong for someone is planned and flagged, as in MCP.
- Controls for tools that the run's policy does not list are not shown; the Host refuses such calls anyway.
- App text is inserted only as text nodes (the shared `el()`); the controller has no HTML parsing, no `eval`, no remote fetch. Option lists and limits come from the live tool schemas (`/api/tools`) where the schema enumerates them (units, method tags, constraint kinds, unit systems); the allergen, diet and nutrient names are the plan's fixed vocabularies, and the App validates every value.
- Records are shown by name: ingredients, recipes, people and meals ("Sat 14 Nov dinner"), never by their IDs. Dates read "20 Nov 2026" throughout. Times are shown as the household recorded them (wall clock and offset of the timestamp), not converted to the browser's zone.
- Layout rules specific to Platewright are applied by the controller as a constructed stylesheet built from constant text (the Host serves one shared stylesheet and its content security policy allows no inline style element); no App data goes into CSS. The layout works from 390 px (single column, horizontally scrolling navigation) to desktop widths.

## Not in the interface

- Leftovers can be taken from earlier meals of the week shown in the editor; to plan leftovers from a meal in the previous week, use the MCP tool directly.
- `recipes.update` can change a line's `note`; the editor keeps existing notes but does not edit them.
- A guest's need is one of allergy, diet, tag dislike or limit; `medical` needs and ingredient dislikes for guests are available through MCP only.
- Nutrition per 100 g and the ingredient table itself are read-only reference data in both MCP and the GUI.

## Tests

- `npm run test:web` (in `apps/platewright`): `tests/web-smoke.cjs`, no npm dependency. Starts the shared Host on a fresh run and checks the served files, refused paths and Infra routes, session and CSRF, discovery (exactly the 22 Agent tools), reads for five views, six writes (W1–W5) confirmed by an independent Agent MCP connection, a refusal, a stale version, a retried request ID that commits once, and the scenario profile (reads only, writes refused).
- `npm run test:web:browser` (needs `npm ci && npx playwright install chromium` at the repository root): `tests/web-browser.cjs` clicks through the same workflows in Chromium, checks escaping of a hostile guest name, a dropped response followed by a retry, a stale form, a refusal, an Infra event seen after Refresh, reload persistence, that every view with a record selected shows no record ID, slot ID, ISO date, vocabulary key or missing value, no horizontal overflow at 390 px and 1280 px, no JavaScript errors and the restricted profile; it writes screenshots and `report.json` to `.artifacts/web/platewright/` (or `--output DIR`).
