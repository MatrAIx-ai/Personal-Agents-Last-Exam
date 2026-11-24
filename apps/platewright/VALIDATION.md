# Platewright 1.0.0: validation

Approved scope: [`proposals/environment/platewright.md`](../../proposals/environment/platewright.md) (five workflows; six events; no messaging). The approved plan described an MCP-only first version; the web interface was added after plan approval at the maintainers' request ("Environments now need a GUI/Website"), following the `apps/notes` convention. Runtime: public Core/Messaging runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0, at repository commit `a4bce02`. Node.js 22.23.1 and 18.20.8 (20.19.6 in the earlier round). The package installs nothing; the optional browser test uses the repository's pinned Playwright; `dependencies.required_apps` is empty.

## Commands and results

Run for this version (seeded history and web interface) on Node.js 22.23.1 and 18.20.8; the earlier MCP-only round also ran on 20.19.6, which was not repeated for this version. Captured outputs are kept with the submission evidence, one folder per Node version.

| Command (repository root unless noted) | Node 22 | Node 18 |
| --- | --- | --- |
| `npm test` in `apps/platewright` | 32 of 32 tests pass | 32 of 32 |
| `npm run example` in `apps/platewright` | passes; prints the walkthrough state | passes |
| `npm run contracts:check` in `apps/platewright` | generated contracts match | match |
| `npm run fixtures:check` in `apps/platewright` | both fixtures pass; reference: 1361 records, 2.2 MB (1.2 MB compact), history from 2025-01-01 | both pass, 1361 records |
| `node apps/platewright/scripts/real-mcp.cjs` | 63 of 63 checks pass | 63 of 63 |
| `node apps/platewright/scripts/notes-calendar-walkthrough.cjs` | 16 of 16 checks pass (Notes 1.0.0, Calendar 1.3.0) | 16 of 16 |
| `npm run test:web` in `apps/platewright` (`tests/web-smoke.cjs`, shared Web Host) | passes | passes |
| `npm run test:web:browser` in `apps/platewright` (`tests/web-browser.cjs`, Chromium 141.0.7390.37 headless) | 33 of 33 checks pass | 33 of 33 |
| `npm run app:verify -- --app apps/platewright` | passed, 45 checks (declarations, including `contribution/gui.json`, load) | passed, 45 checks |
| `node runtime/ci/select-apps.cjs . a4bce02` | `{"full":false,"ids":["platewright"]}` | same |
| `node runtime/ci/verify-submissions.cjs . <out> a4bce02` | `platewright: PASS` | `platewright: PASS` |
| `npm run contracts:check` | shared schemas and derived contribution fields match | match |
| `npm test` | 22 of 22 stages pass | 22 of 22 |
| `npm run test:web` (repository Host tests) | 4 of 4 pass | 22 of 22W |

The browser run used the repository's pinned Playwright 1.56.1 (`npm ci`, `node_modules` not committed) with its cached Chromium build; on this machine Chromium needed `libasound.so.2`, supplied through `LD_LIBRARY_PATH` from a locally extracted package. Screenshots at 1280 px and 390 px were inspected by eye.

Not run: the verifier against a newer `main` than `a4bce02` (no network was used for the repository; maintainers should re-run `npm run app:verify` on the current base before merging); the Host's own browser suite `npm run test:web:browser` at the repository root (it covers the seven reference Apps, not this one); messaging checks (no messaging is in scope); a model-agent or user-simulator session against the web interface.

## Workflow-to-test mapping

Local business tests are in `tests/` (one module per workflow, `events.test.cjs`, `package.test.cjs`, `fixtures.test.cjs`); they call the real hooks through `tests/harness.cjs`, which also asserts that every refused Agent write and event was decided before the hook changed its working copy. The Core side runs on the real runtime in `scripts/real-mcp.cjs`.

| Plan item | Initial state → action → expected result | Evidence |
| --- | --- | --- |
| W1 main | Curry for 2 at 6 servings → 1050 ml coconut milk, 9 tbsp paste, 6 limes with `exact`; `recipes.update` adds revision 2, revision 1 readable; `allergen_free: ["tree_nut"]` leaves out every recipe with a tree-nut line | T02, T04, T01; reference read in `fixtures.test.cjs`; real MCP "Read returns ok … 1050" |
| W1 control | Flour in cups without density → `no_conversion`; negative quantity → `invalid_quantity`; edit of archived → `invalid_state`; version unchanged; reads byte-identical | T02, T04; `package.test.cjs` "every read leaves business data byte-identical" |
| W2 main | Evan's cilantro dislike from 9 Nov: tacos `ok` on 8 Nov, `disliked` on 9 Nov with the line; strict tree-nut guest `unsafe`, non-strict `may_contain`; 700 kcal at factor 1.5 → `over_limit` on 519 kcal | T06, T05, T08, `examples/run.cjs` |
| W2 control | Allergen outside the nine → `invalid_constraint`; `expires_on` before `effective_from` → `invalid_window`; after `env.advance_time` past `expires_on` (no App event) the constraint reads `expired` and the check no longer reports it | T07, T06, T17 (App side); real MCP "After: the limit is active …" |
| W3 main | Fish sauce → tamari 1:1 for `simmer`; preview: vegetarian guest `unsuitable` → `ok`, Eli (soy) `ok` → `unsafe`; create saves exactly the preview with its base revision | T09 |
| W3 control | `bake`-only rule on a `simmer` recipe → `rule_not_applicable`; ingredient not in recipe → `not_in_recipe`; base edited → variant `stale_base`, lines unchanged | T10 |
| W4 main | Saturday curry, two members and four guests → 6 servings; strict nut-allergic guest flagged `unsafe` with the line, still planned; nut-free variant clears it; cooked with portions; Sunday lunch takes 2 portions | T11, T12 |
| W4 control | Slot dated yesterday → `past_slot`; future slot cooked → `not_yet`; leftovers from a later slot → `leftover_unavailable`; clearing leaves `cleared` with history | T12, T11; real MCP refusals |
| W5 main | 800 ml in the pantry, 1050 ml needed → 250 ml naming the slot; yogurt expiring first not counted and in `expiring_before_use`; after `pantry.changed` adds 12 eggs the list is `stale`; regenerating drops the egg line and keeps "Birthday candles" and the tick | T14, T15 |
| W5 control | Removing a derived line → `derived_line`; line write before a list → `no_list`; 40-day window → `invalid_window`; version unchanged | T15; real MCP `no_list` refusal |
| T01–T15 | See the test names in `tests/w1-…`–`tests/w5-…`; each asserts values and states, including less common states (`ok_if_omitted`, `unchecked` limits, `surplus`, `stock_not_counted`, `leftover_expired`, recipes restored, constraints ended today) | `npm test` |
| T16 | Each of the six events with one notification and one activity row; 26 invalid events (unknown member, recipe, ingredient, slot or line; cooked or past slot; duplicate recipe ID; invalid constraint; all-or-nothing pantry items; ticking a ticked line) leave data, notifications, activity and clock unchanged; no notification for own writes or reads | `events.test.cjs`; real MCP rejected events |
| T17 | Repeated `request_id` → stored receipt, no second object; changed input → `idempotency_conflict`; stale version → `stale_version`; Agent calling `env.apply_event`, `env.reset`, `env.advance_time`, `env.load_seed`, `env.snapshot`, `env.event_status` → `permission_denied`; event before the current time → `invalid_event`; `env.advance_time` with no App event changes derived states and not the data; seed validation failures; reset restores the loaded seed and time | `scripts/real-mcp.cjs` (Core side), `events.test.cjs` T17 (App side), `package.test.cjs` seed validation |
| Integration walkthrough | `notes.get` → `platewright.recipes.create` (+ check and plan) → `calendar.create`, each with its version; Platewright state unchanged by the Notes and Calendar calls; Notes unchanged | `scripts/notes-calendar-walkthrough.cjs` |
| Fixture consistency | Lines convert to grams or are listed; diet tags follow from lines; distinct titles and ingredient lists; constraint and slot states agree with the loaded time; dates ≥ 2025-01-01; only intended flags; the generated history obeys the rules as of each date; counts and size | `scripts/check-fixtures.cjs`, `fixtures.test.cjs` |

Failure atomicity on the real runtime (`real-mcp.cjs`): six refused Agent writes (`past_slot`, `leftover_unavailable`, `not_yet`, `invalid_constraint`, `conflict` in a two-swap variant, `no_list`) each leave data and version unchanged and add one denial audit row; four rejected events (dated before the clock, a cooked slot, a three-item pantry event with one unknown ingredient, a duplicate recipe ID) leave data, version and clock unchanged.

## Choices where the plan is silent

- **Dates.** "Today" is `virtual_now` in the household time zone. A constraint ended at time T stops applying from T's household date (meals earlier that day still count as before). A slot is `past` once the clock passes the end of its date. Meals on one day are ordered breakfast, lunch, snack, dinner.
- **Constraint writes** target the member as `id` and carry the constraint (with an optional `constraint.id` to replace one); the result's `id` is the constraint. `note` is required on `set`. Omitted dates default to today and no expiry for a new constraint and are kept on a replacement. A constraint ID that belongs to another member is `not_found`; replacing an ended constraint and removing an ended or expired one are `invalid_state`. A dislike `tag` must be a tag some ingredient carries.
- **The check.** The verdict is the most serious finding over all lines; `ok_if_omitted` only when every finding is caused by optional lines alone; findings caused only by optional lines always name their lines in `omit_lines`. Search filters (`allergen_free`, `diet`) look at every line, optional ones included; `strict: true` also leaves out may-contain. A guest has portion factor 1 for limits. A limit that cannot be evaluated because nutrition is `null` is listed in `unchecked` (it does not change the verdict) and shows on every planned or cooked slot as a `limit_unchecked` flag for that person, with the lines that cannot be weighed. A slot's person flag is the worst verdict over its dishes, with each dish's findings.
- **Flags by slot state.** Person and `limit_unchecked` flags on planned and cooked slots (a cooked slot is checked against the revision it was cooked from); `archived_recipe`, `stale_base`, `leftover_short` and `leftover_expired` on planned slots only; none on skipped or cleared slots.
- **Plan writes.** Attendees default to every member. `plan.slot.set` replaces the whole slot, guests included. Clearing needs a planned slot (`not_found` if there is no slot, `invalid_state` otherwise). Leftovers must come from an earlier slot that is planned or cooked and cooks that recipe (the recipe can be omitted when the source cooks one dish); a source later changed, skipped or cleared reads `leftover_short`, not an error. `skipped` can be marked for any date; `cooked` for today or earlier, including a past slot that was never marked. Portions eaten above portions made are `invalid_quantity` when given; the default eaten (the attendees' portions) is capped at portions made, so marking a slot cooked with defaults always commits.
- **Units and rounding.** As written (`recipe`), an amount under 15 ml in tablespoons or cups is shown in teaspoons and an amount under 60 ml in cups in tablespoons. `unit_system` defaults to the household's (`recipe`, `metric` or `us`); `metric` shows g and ml, `us` shows oz (lb from one pound) and tsp, tbsp or cups by size; conversions stay within the line's dimension unless `units` asks for another. kg and l round to 0.01; oz, lb, fl oz and non-whole pieces to a quarter; a positive quantity never rounds to zero.
- **Variants.** The default title names the swaps. A variant of an archived recipe is refused (`invalid_state`); a swap target that cannot be measured in the line's unit is `invalid_quantity`; a rule that does not replace the named ingredient is `unknown_rule`. A rule applies only if it lists every method tag of the recipe.
- **Recipes.** IDs come from the title (`rec-chickpea-skillet`, then `-2`). A patch that changes nothing is `invalid_arguments`; archiving an archived recipe or restoring an active one is `invalid_state`; an archived recipe accepts only `archived: false`, even together with other fields.
- **Pantry.** One item per ingredient; `pantry.set` keeps the use-by date when it is omitted and clears it with `null`. Cooking with `deduct_pantry` skips optional lines, takes nothing from stock whose use-by date is before the slot's date (reported as `expired`) and reports lines it cannot convert as `no_conversion` shortfalls.
- **Shopping list.** One list per household (`shopping-list`); windows up to 28 days (plan reads up to 42). Pantry stock is taken use by use in meal order: a lot counts only for meals on or before its use-by date and never once the clock has passed that date (also for past slots that were never marked); what is left of a lot when it would expire first is listed once in `expiring_before_use` with the first meal it misses. A line that cannot be converted to the buy unit is merged in the base unit of its dimension; stock in a unit that cannot be converted is listed in `stock_not_counted`. Line IDs are never reused. Derived lines accept only `ticked` and `excluded` (other fields are `derived_line`); manual lines are removed, not excluded (`invalid_state`). A transition to the state a line is already in is `invalid_state`; excluding needs a reason. An unticked surplus line stays until the next generation drops it. The `stale` fingerprint covers every slot in the window (any state), the revision and archive state of the recipes they use, the whole pantry and the members' portion factors and constraints.
- **Constraint writes and the audit.** Both constraint tools target the member as `id`, so Core's audit row names the member, and a task fences other members by listing both tools with `ids` (see `fixtures/policies-fence.json`, exercised by `real-mcp.cjs`). The write result's `id`, the activity row's `object_id` and the constraint's history name the constraint.
- **Guests.** A guest name that is empty after trimming is `invalid_arguments`.
- **Events.** `by` is optional and, when given, must be a member. Events on past slots, guest changes on a slot that is not planned, a tick on a line that is not `needed`, and any line event before a list exists are refused. The `pantry.changed` notification uses `object_id: "pantry"`. A member acting on their own constraint reads "Evan added a constraint"; on someone else's, "Nora added a constraint for Evan".

## Deviations from the plan, and why

- **Counts.** The ingredient table has 213 ingredients (plan: about 180) and the reference shopping list 36 lines (plan: about 25), because the menus use more of them; 60 recipes of which two were added by members' events, 6 variants, 48 rules and 40 pantry items match the plan. The plan's 18 constraints, about 70 slots, 14 notifications and "under 1 MB" described five weeks of history; after the reviewer's request of 2026-11-23 (below) the reference holds 23 constraints, 880 slots, 74 notifications and is 2.2 MB on disk (1.2 MB compact).
- **Policies fence other members** through `ids` on the member `id` of the constraint writes instead of an App seed setting suggested in review; it is shown on the real runtime (`real-mcp.cjs`).
- **Reference history** was produced by replaying writes and events through the App at authoring time; the account's rows are marked `seed` and only the events' activity rows are kept, one per notification.

## Seeded history from 2025-01-01 (reviewer request of 2026-11-23)

The reviewer replaced the earlier note "date all seeded history from 2026-01-01 onward" with: historical data starts on 2025-01-01, the task timeline on 2026-01-01, and synthetic data may fill the historical side. The reference household now carries 22 months of generated history before the five hand-written weeks; `fixtures/minimal.json` is unchanged.

- **Generator.** `scripts/history.cjs`, a deterministic generator (mulberry32, seed 20250101, no clock) whose steps `scripts/build-fixtures.cjs` replays through `handleTool` and `applyEvent` together with the hand-written steps. `node scripts/build-fixtures.cjs --check` (also in `npm test`) rebuilds both files and finds them byte-identical.
- **What it generates.** 809 slots from 2025-01-01 to 2026-10-11 (weekly menus planned the Saturday before; 15 skipped, 19 cleared; packed lunches from batch dinners; weekend breakfasts, lunches and baking; 15 dinners with a guest), 60 events (22 `pantry.changed` shops by Evan or Eli, 26 `plan.changed` by members, 7 `guest.changed`, 5 `member.updated`), 5 earlier constraints, a first stocking and regular shops by the account, and cooking that occasionally takes from the pantry.
- **Rules it obeys, and how that is checked.** Each dish is chosen only if the App's own `check` returns `ok` with nothing unchecked for every diner on its date, with the household's final constraints; `check-fixtures.cjs` confirms that no generated slot carries a flag (the expected flag map is unchanged). Recipes are planned only between creation and archiving; a cooked dish records the recipe revision current on the day it was cooked; leftovers are eaten within `leftover_max_days` and never more than were left; pantry rows are in time order, never negative, and cooking only takes; every month since January 2025 has at least 25 slots; soups and stews are at least twice as frequent in winter as in summer (0.34 against 0.15). `fixtures.test.cjs` adds a test that February 2025 dinners Nora ate pass her meat-free constraint as of their dates.
- **Hand-written records unchanged.** The 71 hand-written slots, the base and hand-written constraints, every pantry item's final quantity, unit, use-by date and time, the shopping list's lines and the 14 hand-written notifications (`ntf-0001` to `ntf-0014`) are identical to the previous fixture. Pantry items that the hand-written weeks first stock are set to 0 at the end of the generated history (2026-10-10, 15:00), so those weeks start from the same pantry and the 4 November cooking reports the same shortfalls. Changed as a consequence: recipe creation dates (now 2025), activity `seq` numbers (rows are numbered in time order), the shopping list's opaque input fingerprint (it covers the members' constraints, which now include the earlier ones), and the action of hand-written pantry rows dated before 10 October 2026 (`set`, replayed, instead of `seed`).
- **Choices where the request was silent.** Generated notifications take a separate ID series (`ntf-h0001` …) so the hand-written ones keep their IDs; the App keeps only the current shopping list, so earlier shops are pantry rows and events rather than old lists; diners never get a dish with an allergen they are allergic to at any time (Ada's peanut allergy record starts on 2026-01-01, but the household would not have served her peanuts in 2025).
- **Count updates in existing checks.** `fixtures.test.cjs` expected 14 notifications from `notifications.list` with no window; it now expects 74 (60 generated, 14 hand-written with their IDs) and checks the 14 from 2026-10-12. `real-mcp.cjs` checked the separate run's 71 slots; it now checks 880. No other expectation changed.
- **Size and reads.** 2.2 MB on disk and 1.2 MB as compact JSON, within the new budget in `check-fixtures.cjs` (2.5 MiB on disk; 1.5 MiB compact, under Core's 2 MiB limit on one MCP request line, which `env.load_seed` must fit in). Window reads stay bounded: `plan.get` defaults to the current week and allows at most 42 days, `recipes.search` returns pages of 20, `shopping.get` covers one list. Two reads return everything by design of the approved plan: `notifications.list` without a window returns all 74 notifications (18 KB), and `pantry.list` includes each item's full history (256 rows, 54 KB). These sizes are recorded by `check-fixtures.cjs` (`default_read_bytes`).

## Web interface (added after plan approval)

The maintainers changed the scope for all Environments after this plan was approved ("Environments now need a GUI/Website. The App owns the pages and they are served through the shared Web Host"); the approved plan said MCP-only. The interface follows `apps/notes`: `contribution/gui.json` (reviewer-renderer profile with `gui/src/view.js`, plus `pale.web` version 1, `status: implemented`), `gui/index.html`, `gui/src/app.js`, `gui/README.md`; `contribution.json` sets `gui_ref` and `app.json` `capabilities.ui`. No business schema, tool, event or seed format changed, and nothing in `src/` changed for it.

| Workflow | Browser (`web-browser.cjs`, real clicks, result read back over MCP) | Smoke (`web-smoke.cjs`, Host API, read back over MCP) |
| --- | --- | --- |
| W1 Recipe box | search, select, scale to 6 servings (1050 ml coconut milk), edit title → revision 3 | `recipes.get` at 6 servings; `recipes.create` |
| W2 Profiles and the check | add a need with end before start → `invalid_window: …` shown; corrected → scheduled constraint | `members.constraint.set` → scheduled |
| W3 Substitutions | swap fish sauce for tamari, preview before/after per person, save variant | `recipes.variant.create` |
| W4 Weekly plan | next week, Saturday's flags (Maya unsafe, Ines unsuitable); plan Tuesday breakfast with a guest; mark Monday dinner skipped; reload keeps both | `plan.slot.set` with a guest; `past_slot` refusal leaves the slot unchanged |
| W5 Pantry and list | stale banner; tick with the checkbox; add an item through a dropped response and a retry (one line); stale pantry form → `stale_version`; Refresh shows an independent MCP write; update stock | `pantry.set`, `shopping.item.set` tick, stale version, retried request ID commits once |
| Events | an Infra `pantry.changed` event appears in Activity | — |
| Boundary | restricted (`scenario`) run shows no write controls and the Host refuses a forged write; no JavaScript errors; no horizontal overflow at 390 and 1280 px; hostile guest name shown as text | hidden paths, fixture/state/source downloads, Infra routes, `env.*` calls, foreign origin, missing CSRF and session refused; discovery lists exactly the 22 Agent tools; `scenario` lists the 11 reads and refuses writes |

Choices where the request was silent:

- **Starting the App on the shared Host without changing `runtime/`.** `apps/platewright/web.registry.json` is a one-App registry (path `.`) passed with the Host's existing `--registry` option; the repository's `apps.registry.json` is unchanged.
- **One controller, several product views.** The shared `mount()` handles one list and one detail read; the controller switches the list read per view (plan, recipes, household, pantry, notifications) and renders its own week, list and pantry layouts, so the session, discovery, versioned writes, retries and text rendering stay the shared client's.
- **Forms.** Writes whose inputs are lists of objects (dishes, guests, recipe lines, swaps) need product forms, so every write uses an App-owned modal form that submits through the shared `perform()`; option lists come from the live tool schemas where they are enumerated. A refusal shows `code: message`.
- **Reads per view.** A Core call takes about 0.9 s on the reference household with two years of history (about 0.3 s with the earlier five weeks; measured on this machine), so each view reads its list plus at most two more; the Recipes view opens in about 4.5 s and the others in about 2 s.
- **Styles.** The Host serves one shared stylesheet and its CSP has no inline styles, so App-specific layout is a constructed stylesheet built from constant text in the controller.
- **Times** are shown as recorded (the timestamp's own wall clock and offset), not in the browser's zone.
- **Left to MCP:** leftovers from a meal outside the week shown, editing a recipe line's note, `medical` needs and ingredient dislikes for guests (listed in `gui/README.md`).

## Tool schemas

`tools.json` is 247 KB on disk (about 92 KB as compact JSON, as sent by `tools/list`). Every result object, including nested ones (slot guests, leftovers, cooked details, history rows, flags, findings, shopping lines, pantry history), is typed with `additionalProperties: false`, as in the reference Apps; real results validate on Core in `real-mcp.cjs` and the walkthrough.

## Fix round after the independent audit of `ea2f198`

| Item | Change | Evidence |
| --- | --- | --- |
| S1 stock expiring between two meals | Stock is allocated use by use in meal order; a lot counts only for meals on or before its use-by date | T14 tests "stock is taken use by use …" and "stock already past its use-by …"; audit probe E1 now gives 300 g |
| S2 default cooked mark refused | Default eaten capped at portions made | T12 test "marking cooked with defaults …"; real MCP check; probes D4 and R3 now commit |
| S3 optional severe finding hidden | Verdict is the most serious finding; optional-only findings always in `omit_lines`; slot flags follow | T05 (banana bread, strict tree nut and banana dislike → `unsafe`, walnuts named); probe A1 |
| S4 unchecked limit invisible on the plan | `limit_unchecked` slot flag | T11 test "a limit that cannot be checked …"; fixture checks pin the flags; real MCP check; probe C1b |
| 5 untyped nested output schemas | All nested result shapes typed, `additionalProperties: false` | `tools.json`; verifier, real MCP and walkthrough pass |
| 6 expired stock | Never counted by `shopping.generate`; not deducted when cooking | T14 and T13 tests; probe E4 |
| 7 display of small spoon amounts | Downshift to a smaller spoon as written | T02 test "as written, a small amount …" |
| 8 blank guest name | `invalid_arguments` from the App | T08; real MCP check |
| 9 notification wording, stale test comment | "Evan added a constraint" / "Ada ended one of their constraints" | T16 |
| 10 constraint IDs and the fence | Documented above; `fixtures/policies-fence.json` used by `real-mcp.cjs`, which checks both tools are fenced and that the result and activity row name the constraint | `real-mcp.cjs` |

Audit probes re-run on the fixed package: every previously failing probe now gives the expected result (A1, C1b, D4, E1, R3), except B1, whose expectation of 16 oz for 15.873 oz of green beans is not the nearest quarter (15.75 is; the probe's hand computation rounded up), and R3b, which checked that the refused mark left data unchanged and no longer applies because the mark now commits.

## Implementation checklist self-review

Verdicts: passed / failed / not run / not applicable.

| Item | Verdict | Evidence / note |
| --- | --- | --- |
| 1.1 Promised workflows and modes from the proposal and review | passed | W1–W5 over MCP and in the web interface requested after approval; no messaging promised (review answer 3: no Mail) |
| 1.2 Versions, paths, schemas, tools, hooks, events, dependencies match files | passed | registry load in the verifier; `contracts:check`; `package.test.cjs` checks tools against handlers |
| 1.3 Startup/tests from a clean checkout with public Host only | passed | verifier copies the package alone and runs its tests and example; `service.cjs` uses the public launcher |
| 1.4 Required receiving Apps at compatible versions | not applicable | none required; the walkthrough uses Notes 1.0.0 and Calendar 1.3.0 through their own tools only |
| 2.1 App-only tests with real functions, invalid transitions, missing objects, read-only behaviour | passed | 32 tests; refusals asserted decided-before-change |
| 2.2 Create/read/update/cancel produce state and history; invalid operations preserve data | passed | T04, T07, T11–T15; real MCP atomicity checks |
| 2.3 Data references and provenance valid | passed (automated) | `check-fixtures.cjs`; `dataset.json`; human review of realism still pending |
| 2.4 Optional diagnostics do not change results | passed | `package.test.cjs` diagnostics test |
| 3.1 Real MCP discovery and calls match contracts and committed state | passed | verifier; `real-mcp.cjs` |
| 3.2 Business callers cannot seed, reset, inject, snapshot | passed | verifier; `real-mcp.cjs` six `permission_denied` checks; policy fence |
| 3.3 Seed/reset, runs, versions, retries, events, supplied time | passed | `real-mcp.cjs` |
| 3.4 Declared messaging | not applicable | publishes and receives none |
| 3.5 Candidate and base validators | passed (candidate at `a4bce02`); base re-run on current `main` not run | `verify-submissions.cjs` at `a4bce02` |
| GUI: runnable delivery | passed | `gui/index.html`, `gui/src/app.js`, `contribution/gui.json`; the shared Host starts it with `--registry apps/platewright/web.registry.json` (no `runtime/` change); `tests/web-smoke.cjs` |
| GUI: actual controls | passed | `tests/web-browser.cjs` in Chromium clicks navigation, search, selection, forms, create/edit/clear/mark/tick/exclude flows (see below) |
| GUI: shared state | passed | every browser and smoke write is read back through an independent Agent MCP connection to the same run; reload; an Infra event and an MCP write are seen after Refresh |
| GUI: failure behaviour | passed | refusal shown with the App code (`invalid_window`); stale form shows `stale_version` and writes nothing; a dropped response retried with the same request ID commits once |
| GUI: business-only access | passed | no management controls; direct `env.*` calls, hidden paths, fixture/state downloads, foreign origins and missing CSRF refused (smoke); restricted profile shows no write controls and the Host refuses a forged write (browser) |
| GUI: files and content | passed (text) / not applicable (files) | hostile guest name rendered as text, no element created; the App has no attachments (`capabilities.resources: false`) |
| GUI: evidence | passed | commands, versions, browser version and screenshots below; browser automation is not a model-agent evaluation |
| 4.1 Essential workflows have evidence; human review of realism | automated evidence passed; human review not run | remaining manual review below |
| 4.2 Modes reported separately | passed | this file |
| 4.3 Remaining gaps listed | passed | below |

## Review of the audit lessons from the sibling App

- Rules on every path: the guest rule (a guest counts only on her slot) is checked in that slot's flags, in another slot with the same recipe, in `household.get` and in default servings after a guest event (T08); the Agent acts only as the bound account holder (`by` is always the owner on writes); constraint writes for other members can be fenced by policy (real MCP).
- Refusals are decided before mutating: the harness asserts it for every refused write and event, and real Core shows atomicity for six refusals, four rejected events and a multi-item event.
- Reads leave business data byte-identical (package test, real MCP); Core's audit grows by one row per read.
- Write results report the object's state under `state`.
- No unused exports (checked by script before submission); error messages name the rule they report.

## Remaining manual review

Realism of recipes, steps, substitution rules, ingredient units, densities, piece weights and nutrition values; that the household, guests and recipes are fictional; the wording of notifications. The suitability check is a simplification and not medical, allergy or dietary advice.
