# Platewright GUI workflow sequences

Captured by `node scripts/capture-gui-evidence.cjs` (Chromium 141.0.7390.37, shared Web Host `runtime/web/server.cjs`, Platewright 1.0.0; viewports 1280x800 and 390x844; run: evidence (sandbox) and evidence-restricted (scenario), fresh state from fixtures/reference.json; account platewright-nora (person-nora, Nora Arden, synthetic)). Every frame is a viewport screenshot of the real page after the action, checked for record IDs, ISO dates, vocabulary keys and missing values before it was taken. “MCP” is an independent Agent connection to the same run. The index is [../README.md](../README.md).

## w4: Weekly meal plan: plan, change, invalid, stale, clear, cook

Workflow W4. Same steps asserted in tests/web-browser.cjs (W4 checks).

| # | Frame | Action | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1 | [w4-01-week.png](w4-01-week.png) (1280x800) | Open the App: Meal plan, the week of 2–8 Nov 2026 (loaded time Sun 8 Nov, 08:00). | Seven days with each meal, who eats it and its state; earlier days read-only, today marked. | 2 Nov – 8 Nov 2026 |
| 2 | [w4-02-flags.png](w4-02-flags.png) (1280x800) | Next week (›), select Saturday 14 Nov dinner. | The check names each guest the dish is wrong for and the ingredient lines behind it. | Maya: Unsafe; Ines: Unsuitable, with the lines named |
| 3 | [w4-03-plan-form.png](w4-03-plan-form.png) (1280x1304) | “+ Plan a meal” on Tuesday 10 Nov; Meal: breakfast; Recipe: Banana pancakes; “+ Add a guest” Priya with an egg allergy. | A modal form with the dish, the members at the table and the guest with her need; nothing is written yet. | Form filled, not sent |
| 4 | [w4-04-planned.png](w4-04-planned.png) (1280x800) | Submit “Save meal”. | The form closes; the meal is on Tuesday and selected, with its guest; a dish wrong for her is planned and flagged, not refused. | MCP plan.get: 2026-11-10:breakfast planned, guest Priya, flags Priya: unsafe; App version {"epoch":1,"revision":0} → {"epoch":1,"revision":1} |
| 5 | [w4-05-change-form.png](w4-05-change-form.png) (1280x1219) | After a reload, select Thursday 12 Nov dinner (Spaghetti bolognese), “Change meal”, “+ Add a dish”: Greek salad. | The form opens with the saved dish and people; a second dish is added. | Second dish added in the form |
| 6 | [w4-06-changed.png](w4-06-changed.png) (1280x800) | Submit “Save meal”. | Two dishes; the history shows the earlier plan and the change. | MCP: dishes rec-spaghetti-bolognese, rec-greek-salad; history set, replaced |
| 7 | [w4-07-invalid.png](w4-07-invalid.png) (1280x1439) | “Change meal”, “+ Add a guest” with a 121-character name, submit. | The form names the limit in words and sends nothing. | “Each guest name can be at most 120 characters.”; App version unchanged {"epoch":1,"revision":2} |
| 8 | [w4-08-stale.png](w4-08-stale.png) (1280x1237) | “Change meal”, type a note; meanwhile another connection commits a pantry write; submit. | The form says the record changed and writes nothing. | “This record changed. Close this form and refresh before trying again.” (data-code stale_version); MCP: the meal has no note |
| 9 | [w4-09-clear-confirm.png](w4-09-clear-confirm.png) (1280x800) | Refresh, select the breakfast, “Clear”. | A confirmation saying the meal stays in the history as cleared. | Confirmation shown |
| 10 | [w4-10-cleared.png](w4-10-cleared.png) (1280x800) | “Clear this meal”. | The meal reads Cleared; its history keeps what was planned. | MCP: cleared; history set, cleared |
| 11 | [w4-11-cook-form.png](w4-11-cook-form.png) (1280x800) | This week, today’s dinner (Chicken noodle soup), “Mark cooked”, tick “Take the ingredients from the pantry”. | Portions made and eaten, and the pantry option. | Form filled |
| 12 | [w4-12-cooked.png](w4-12-cooked.png) (1280x800) | Submit “Mark cooked”. | Cooked; what the pantry lacked is reported in the status line as a note, not as an error. | “Cooked. Short in the pantry: Chicken breast 300 g (not in the pantry), Chicken stock 1.5 l (not in the pantry), Celery stalk 2 (not in the pantry), Egg noodles, dry 120 g (not in the pantry), Thyme 2 g (not in the pantry)”; MCP: cooked, deducted true |

Persisted state and versions:

- Tuesday breakfast planned with the guest: `platewright.plan.get` `{"start":"2026-11-10","end":"2026-11-10"}` → `{"id":"2026-11-10:breakfast","state":"planned","dishes":["rec-banana-pancakes"],"guests":["Priya"],"flags":["Priya: unsafe"]}` at App version `{"epoch":1,"revision":1}`
- After a page reload: the planned Tuesday breakfast: `browser reload` → `true`
- Thursday dinner changed: `platewright.plan.get` `{"start":"2026-11-12","end":"2026-11-12"}` → `{"id":"2026-11-12:dinner","state":"planned","dishes":["rec-spaghetti-bolognese","rec-greek-salad"],"history":["set","replaced"]}` at App version `{"epoch":1,"revision":2}`
- Independent MCP write while the form is open (pantry: 7 limes): `platewright.pantry.set` → `{"id":"ing-lime","status":"committed"}` at App version `{"epoch":1,"revision":3}`
- Tuesday breakfast cleared: `platewright.plan.get` `{"start":"2026-11-10","end":"2026-11-10"}` → `{"id":"2026-11-10:breakfast","state":"cleared","history":["set","cleared"]}` at App version `{"epoch":1,"revision":4}`
- Today’s dinner cooked from the pantry: `platewright.plan.get` `{"start":"2026-11-08","end":"2026-11-08"}` → `{"id":"2026-11-08:dinner","state":"cooked","deducted":true,"short":["ing-chicken-breast","ing-chicken-stock","ing-celery","ing-egg-noodles","ing-thyme"]}` at App version `{"epoch":1,"revision":5}`

## w1: Recipe box: search, scale, create (invalid then valid), edit, archive and restore

Workflow W1. Same steps asserted in tests/web-browser.cjs (W1 checks).

| # | Frame | Action | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1 | [w1-01-search.png](w1-01-search.png) (1280x800) | Recipes, search “green curry”, select Sweet potato green curry. | The matching recipes; the recipe with its lines, method, nutrition, allergens and revisions. | Sweet potato green curry |
| 2 | [w1-02-scale.png](w1-02-scale.png) (1280x800) | Servings 6, “Scale”. | The lines for 6 servings with the conversions kept exact; coconut milk 1050 ml. | 1050 ml shown |
| 3 | [w1-03-check.png](w1-03-check.png) (1280x800) | “Check” for the four members on the default day (today). | A verdict per person naming the ingredient behind it (the W2 check). | Nora OK Evan OK Eli OK Ada Disliked disliked (spicy): Green curry paste |
| 4 | [w1-04-create-invalid.png](w1-04-create-invalid.png) (1280x1128) | “New recipe”: title, 3 eggs, two steps, no method ticked; submit. | The form names what is missing and sends nothing. | “Tick at least one method.”; App version unchanged |
| 5 | [w1-05-created.png](w1-05-created.png) (1280x800) | Tick a method, submit “Save recipe”. | The new recipe is saved at revision 1 and shown. | MCP recipes.search: Weeknight omelette, revision 1 |
| 6 | [w1-06-edit-form.png](w1-06-edit-form.png) (1280x1635) | Select the curry, “Edit recipe”, change the title. | The form holds the current recipe; only changed fields are sent. | Title changed in the form |
| 7 | [w1-07-edited.png](w1-07-edited.png) (1280x800) | Submit “Save changes”. | A new revision; the earlier ones stay readable. | MCP: “Sweet potato green curry for Saturdays”, revision 3 |
| 8 | [w1-08-archive-confirm.png](w1-08-archive-confirm.png) (1280x800) | Select the omelette, “Archive”. | A confirmation: it stays readable and in past plans. | Confirmation shown |
| 9 | [w1-09-archived.png](w1-09-archived.png) (1280x800) | “Archive recipe”. | The recipe moves to Archived recipes, with a Restore action; no new revision. | MCP: archived, revision 1 |
| 10 | [w1-10-restored.png](w1-10-restored.png) (1280x800) | “Restore”, then reload and search “saturdays”. | The omelette is active again; after a reload the edited curry title is still there. | MCP: omelette active; curry found after reload |

Persisted state and versions:

- New recipe saved: `platewright.recipes.search` `{"query":"omelette"}` → `[{"id":"rec-weeknight-omelette","title":"Weeknight omelette","revision":1}]` at App version `{"epoch":1,"revision":6}`
- Recipe edited: `platewright.recipes.get` `{"id":"rec-green-curry"}` → `{"id":"rec-green-curry","title":"Sweet potato green curry for Saturdays","revision":3,"revisions":3}` at App version `{"epoch":1,"revision":7}`
- Recipe archived: `platewright.recipes.get` `{"id":"rec-weeknight-omelette"}` → `{"id":"rec-weeknight-omelette","state":"archived","revision":1}` at App version `{"epoch":1,"revision":8}`
- Recipe restored: `platewright.recipes.get` `{"id":"rec-weeknight-omelette"}` → `{"id":"rec-weeknight-omelette","state":"active","revision":1}` at App version `{"epoch":1,"revision":9}`
- After a page reload: the restored recipe and the edited title: `browser reload` → `true`

## w3: Substitutions: preview a swap per person, save a variant

Workflow W3. Same steps asserted in tests/web-browser.cjs (W3 checks).

| # | Frame | Action | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1 | [w3-01-swap-form.png](w3-01-swap-form.png) (1280x1265) | On the curry, “Swap ingredients”. | One choice per line; rules that do not apply to this recipe are listed with their reason and cannot be chosen. | Form open |
| 2 | [w3-02-preview.png](w3-02-preview.png) (1280x1402) | Fish sauce → Tamari, “Preview”. | Each person before → after; the preview writes nothing. | Sweet potato green curry for Saturdays (Tamari for Fish sauce) Nora OK → OK Evan OK → OK Eli OK → Unsafe Ada Disliked → Disliked |
| 3 | [w3-03-saved.png](w3-03-saved.png) (1280x800) | Submit “Save as a variant”. | A new variant recording the base, its revision and the swap. | MCP: Green curry with tamari; Sweet potato green curry for Saturdays (Tamari for Fish sauce) |

Persisted state and versions:

- Variant saved: `platewright.recipes.search` `{"query":"tamari","limit":100}` → `[{"id":"rec-green-curry-with-tamari","title":"Green curry with tamari"},{"id":"rec-sweet-potato-green-curry-for-saturdays-tamari-for-fish-sauce","title":"Sweet potato green curry for Saturdays (Tamari for Fish sauce)"}]` at App version `{"epoch":1,"revision":10}`

## w2: Household needs: invalid window, add, end

Workflow W2. Same steps asserted in tests/web-browser.cjs (W2 checks).

| # | Frame | Action | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1 | [w2-01-member.png](w2-01-member.png) (1280x800) | Household, select Evan. | His portion factor and needs with state, dates, notes and history. | Evan |
| 2 | [w2-02-invalid.png](w2-02-invalid.png) (1280x803) | “Add a need”: dislike tag spicy, from 20 Nov until 10 Nov; submit. | The App refuses; its message is shown in words and nothing is written. | “The end date (Tue 10 Nov 2026) is before the start date (Fri 20 Nov 2026).” (data-code invalid_window); App version unchanged |
| 3 | [w2-03-saved.png](w2-03-saved.png) (1280x800) | Until 30 Nov, submit. | The need is saved as scheduled from 20 Nov. | MCP: scheduled, 2026-11-20 to 2026-11-30 |
| 4 | [w2-04-end-confirm.png](w2-04-end-confirm.png) (1280x800) | “End” on the new need. | A confirmation: it stops applying from today and keeps its history. | Confirmation shown |
| 5 | [w2-05-ended.png](w2-05-ended.png) (1280x800) | “End it now”. | The need reads Ended, with its history. | MCP: ended; history created, ended |

Persisted state and versions:

- Need saved: `platewright.household.get` `{"id":"person-evan"}` → `[{"id":"con-0001","state":"scheduled","effective_from":"2026-11-20","expires_on":"2026-11-30"}]` at App version `{"epoch":1,"revision":11}`
- Need ended: `platewright.household.get` `{"id":"person-evan"}` → `{"id":"con-0001","state":"ended","history":["created","ended"]}` at App version `{"epoch":1,"revision":12}`

## w5: Shopping list and pantry: stale list, tick, exclude, add, remove, regenerate; stock update with a stale form

Workflow W5. Same steps asserted in tests/web-browser.cjs (W5 checks).

| # | Frame | Action | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1 | [w5-01-stale-list.png](w5-01-stale-list.png) (1280x800) | Shopping list. | The list for 9–15 Nov with a notice that the plan or pantry changed since it was made. | The plan, pantry, recipes or profiles changed since this list was made. Update the list |
| 2 | [w5-02-ticked.png](w5-02-ticked.png) (1280x800) | Tick the first line’s checkbox and select it. | The line moves to “In the basket”. | MCP: ticked |
| 3 | [w5-03-exclude-form.png](w5-03-exclude-form.png) (1280x800) | Select a line still to buy, “Not buying”, give a reason. | A form asking why. | Reason entered |
| 4 | [w5-04-excluded.png](w5-04-excluded.png) (1280x800) | “Leave it off”. | The line reads Excluded with the reason; “Buy it after all” puts it back. | MCP: excluded (“Still have some at work”) |
| 5 | [w5-05-added.png](w5-05-added.png) (1280x800) | “Add item”: Paper napkins, 1 each, “Add”; select it. | An item added by hand, selected, with Edit and Remove. | MCP: manual line, needed |
| 6 | [w5-06-regenerate-confirm.png](w5-06-regenerate-confirm.png) (1280x800) | “Remove” the napkins (confirmed), then “Update the list” in the notice. | The napkins are gone; a confirmation to rebuild the list from the current plan and pantry. | MCP: no napkins line; confirmation shown |
| 7 | [w5-07-regenerated.png](w5-07-regenerated.png) (1280x800) | “Update the list”. | The notice is gone; ticks and the exclusion are kept on lines still needed. | MCP: stale false, 43 lines, exclusion kept |
| 8 | [w5-08-stock-form.png](w5-08-stock-form.png) (1280x800) | Pantry, Eggs, “Update stock”: 18. | The form with quantity, unit and use-by date. | Form filled |
| 9 | [w5-09-stock-stale.png](w5-09-stock-stale.png) (1280x800) | Meanwhile another connection sets 9 limes; submit “Save”. | The stale form says the record changed and writes nothing. | “This record changed. Close this form and refresh before trying again.”; MCP: eggs still 12 |
| 10 | [w5-10-refreshed.png](w5-10-refreshed.png) (1280x800) | Cancel, “Refresh”, select Lime. | The independent change is shown. | Lime Use by 9 Nov 2026 · 1 day left 9 Use soon |
| 11 | [w5-11-stock-saved.png](w5-11-stock-saved.png) (1280x800) | Eggs, “Update stock” again: 18, “Save”; reload. | 18 eggs, with a new history row; still there after a reload. | MCP: 18 each, 14 history rows |

Persisted state and versions:

- Line ticked: `platewright.shopping.get` `{}` → `{"id":"sl-0002","state":"ticked"}` at App version `{"epoch":1,"revision":13}`
- Line left off: `platewright.shopping.get` `{}` → `{"id":"sl-0003","state":"excluded","reason":"Still have some at work"}` at App version `{"epoch":1,"revision":14}`
- Item added by hand: `platewright.shopping.get` `{}` → `[{"id":"sl-0037","state":"needed","kind":"manual"}]` at App version `{"epoch":1,"revision":15}`
- Item removed: `platewright.shopping.get` `{}` → `0` at App version `{"epoch":1,"revision":16}`
- List regenerated: `platewright.shopping.get` `{}` → `{"stale":false,"lines":43,"ticked":3,"excluded":["sl-0001","sl-0003"]}` at App version `{"epoch":1,"revision":17}`
- Independent MCP write while the form is open (pantry: 9 limes): `platewright.pantry.set` → `{"id":"ing-lime","status":"committed"}` at App version `{"epoch":1,"revision":18}`
- Stock saved: `platewright.pantry.list` `{}` → `{"id":"pantry:ing-egg","quantity":18,"unit":"each","history_rows":14}` at App version `{"epoch":1,"revision":19}`
- After a page reload: the 18 eggs: `browser reload` → `true`

## events: Another member’s change (Infra event) seen after Refresh

Workflow Events. Same steps asserted in tests/web-browser.cjs (event check).

| # | Frame | Action | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1 | [events-01-activity.png](events-01-activity.png) (1280x800) | Infra applies a pantry.changed event by Eli; open Activity. | Eli’s change is listed, in words, at the top. | What others changed, last 45 days Show older SUNDAY 8 NOVEMBER 2026 Eli updated the pantry 2000 ml whole milk. Note: Mar |

Persisted state and versions:

- Infra applies pantry.changed by Eli (2 l milk): `env.apply_event` → `{"event_id":"ev-evidence-1","status":"committed"}` at App version `{"epoch":1,"revision":20}`

## phone: Phone width (390 px)

Workflow Layout. Same steps asserted in tests/web-browser.cjs (overflow checks).

| # | Frame | Action | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1 | [phone-01-week.png](phone-01-week.png) (390x844) | Meal plan at 390 x 844. | The week as a single column; navigation scrolls sideways. No horizontal page scroll. | horizontal overflow 0px |
| 2 | [phone-02-shopping.png](phone-02-shopping.png) (390x844) | Shopping list at 390 x 844. | The list as a single column. No horizontal page scroll. | horizontal overflow 0px |
| 3 | [phone-03-recipe.png](phone-03-recipe.png) (390x844) | Recipes, select the curry, at 390 px. | The recipe detail below the list, readable without sideways scroll. | horizontal overflow 0px |
| 4 | [phone-04-form.png](phone-04-form.png) (390x844) | Pantry, Eggs, “Update stock” at 390 px. | The form fits the screen. | Form open |

## restricted: Read-only Task profile (scenario): no write controls; a forged write is refused

Workflow Business-only access. Same steps asserted in tests/web-browser.cjs (restricted checks).

| # | Frame | Action | Expected | Observed |
| --- | --- | --- | --- | --- |
| 1 | [restricted-01-no-controls.png](restricted-01-no-controls.png) (1280x800) | Host started with --profile scenario; next week, Saturday dinner. | The same reads, no “Plan a meal”, “Change meal” or other write control; a forged write is refused by the Host. | 0 write controls; forged write HTTP 403 |

Persisted state and versions:

- A pantry.set request sent directly from the restricted page: `POST /api/call` → `{"http_status":403}`
