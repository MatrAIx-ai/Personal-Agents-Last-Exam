# Platewright 1.0.0: validation

Approved scope: [`proposals/environment/platewright.md`](../../proposals/environment/platewright.md) (MCP-only; five workflows; six events; no messaging; no GUI). Runtime: public Core/Messaging runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0, at repository commit `a4bce02`. Node.js 22.23.1, 20.19.6 and 18.20.8. No dependency is installed; `dependencies.required_apps` is empty.

## Commands and results

| Command (repository root unless noted) | Node | Result |
| --- | --- | --- |
| `npm test` in `apps/platewright` | 22, 20, 18 | 25 of 25 tests pass |
| `npm run example` in `apps/platewright` | 22, 20, 18 | passes; prints the walkthrough state |
| `npm run contracts:check` in `apps/platewright` | 22, 20, 18 | generated contracts match |
| `npm run fixtures:check` in `apps/platewright` | 22, 20, 18 | both fixtures pass; reference: 492 records, 656 KB |
| `node apps/platewright/scripts/real-mcp.cjs` | 22, 20, 18 | 58 of 58 checks pass |
| `node apps/platewright/scripts/notes-calendar-walkthrough.cjs` | 22, 20, 18 | 16 of 16 checks pass (Notes 1.0.0, Calendar 1.3.0) |
| `npm run app:verify -- --app apps/platewright` | 22, 20, 18 | passed, 45 checks; stages `business` and `event-example` passed |
| `node runtime/ci/select-apps.cjs . a4bce02` | 22 | `{"full":false,"ids":["platewright"]}` |
| `node runtime/ci/verify-submissions.cjs . <out> a4bce02` | 22 | `platewright: PASS` |
| `npm run contracts:check` | 22 | shared schemas and derived contribution fields match |
| `npm test` | 22 | 22 of 22 stages pass |

The captured outputs (reports, logs and the package hash from the verifier) are attached to the submission as review evidence; generated state is not committed.

Not run: the verifier against a newer `main` than `a4bce02` (no network was used; maintainers should re-run `npm run app:verify` on the current base before merging); GUI checks (no GUI is in scope); messaging checks (no messaging is in scope).

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
| Fixture consistency | Lines convert to grams or are listed; diet tags follow from lines; distinct titles and ingredient lists; constraint and slot states agree with the loaded time; dates ≥ 2026-01-01; only intended flags; counts and size | `scripts/check-fixtures.cjs`, `fixtures.test.cjs` |

Failure atomicity on the real runtime (`real-mcp.cjs`): six refused Agent writes (`past_slot`, `leftover_unavailable`, `not_yet`, `invalid_constraint`, `conflict` in a two-swap variant, `no_list`) each leave data and version unchanged and add one denial audit row; four rejected events (dated before the clock, a cooked slot, a three-item pantry event with one unknown ingredient, a duplicate recipe ID) leave data, version and clock unchanged.

## Choices where the plan is silent

- **Dates.** "Today" is `virtual_now` in the household time zone. A constraint ended at time T stops applying from T's household date (meals earlier that day still count as before). A slot is `past` once the clock passes the end of its date. Meals on one day are ordered breakfast, lunch, snack, dinner.
- **Constraint writes** target the member as `id` and carry the constraint (with an optional `constraint.id` to replace one); the result's `id` is the constraint. `note` is required on `set`. Omitted dates default to today and no expiry for a new constraint and are kept on a replacement. A constraint ID that belongs to another member is `not_found`; replacing an ended constraint and removing an ended or expired one are `invalid_state`. A dislike `tag` must be a tag some ingredient carries.
- **The check.** Search filters (`allergen_free`, `diet`) look at every line, optional ones included; `strict: true` also leaves out may-contain. A guest has portion factor 1 for limits. A limit that cannot be evaluated because nutrition is `null` is listed in `unchecked` and does not change the verdict. A slot's person flag is the worst verdict over its dishes, with each dish's findings.
- **Flags by slot state.** Person flags on planned and cooked slots (a cooked slot is checked against the revision it was cooked from); `archived_recipe`, `stale_base`, `leftover_short` and `leftover_expired` on planned slots only; none on skipped or cleared slots.
- **Plan writes.** Attendees default to every member. `plan.slot.set` replaces the whole slot, guests included. Clearing needs a planned slot (`not_found` if there is no slot, `invalid_state` otherwise). Leftovers must come from an earlier slot that is planned or cooked and cooks that recipe (the recipe can be omitted when the source cooks one dish); a source later changed, skipped or cleared reads `leftover_short`, not an error. `skipped` can be marked for any date; `cooked` for today or earlier, including a past slot that was never marked. Portions eaten above portions made are `invalid_quantity`.
- **Units and rounding.** `unit_system` defaults to the household's (`recipe`, `metric` or `us`); `metric` shows g and ml, `us` shows oz (lb from one pound) and tsp, tbsp or cups by size; conversions stay within the line's dimension unless `units` asks for another. kg and l round to 0.01; oz, lb, fl oz and non-whole pieces to a quarter; a positive quantity never rounds to zero.
- **Variants.** The default title names the swaps. A variant of an archived recipe is refused (`invalid_state`); a swap target that cannot be measured in the line's unit is `invalid_quantity`; a rule that does not replace the named ingredient is `unknown_rule`. A rule applies only if it lists every method tag of the recipe.
- **Recipes.** IDs come from the title (`rec-chickpea-skillet`, then `-2`). A patch that changes nothing is `invalid_arguments`; archiving an archived recipe or restoring an active one is `invalid_state`; an archived recipe accepts only `archived: false`, even together with other fields.
- **Pantry.** One item per ingredient; `pantry.set` keeps the use-by date when it is omitted and clears it with `null`. Cooking with `deduct_pantry` skips optional lines and reports lines it cannot convert as `no_conversion` shortfalls.
- **Shopping list.** One list per household (`shopping-list`); windows up to 28 days (plan reads up to 42). A line that cannot be converted to the buy unit is merged in the base unit of its dimension; stock in a unit that cannot be converted is listed in `stock_not_counted`. Line IDs are never reused. Derived lines accept only `ticked` and `excluded` (other fields are `derived_line`); manual lines are removed, not excluded (`invalid_state`). A transition to the state a line is already in is `invalid_state`; excluding needs a reason. An unticked surplus line stays until the next generation drops it. The `stale` fingerprint covers every slot in the window (any state), the revision and archive state of the recipes they use, the whole pantry and the members' portion factors and constraints.
- **Events.** `by` is optional and, when given, must be a member. Events on past slots, guest changes on a slot that is not planned, a tick on a line that is not `needed`, and any line event before a list exists are refused. The `pantry.changed` notification uses `object_id: "pantry"`.

## Deviations from the plan, and why

- **Counts.** The ingredient table has 213 ingredients (plan: about 180) and the reference shopping list 36 lines (plan: about 25), because the five-week menu uses more of them; the other counts match (60 recipes of which two were added by members' events in the history, 6 variants, 48 rules, 4 members with 18 constraints, 71 slots, 40 pantry items, 14 notifications, 656 KB).
- **Policies fence other members** through `ids` on the member `id` of the constraint writes instead of an App seed setting suggested in review; it is shown on the real runtime (`real-mcp.cjs`).
- **Published tool output schemas** type the top-level results and the key fields of nested detail (findings, history rows); the full record shapes stay in `schemas/seed.schema.json`, so the tool list stays about 65 KB.
- **Reference history** was produced by replaying writes and events through the App at authoring time; the account's rows are marked `seed` and only the events' activity rows are kept, one per notification.

## Implementation checklist self-review

Verdicts: passed / failed / not run / not applicable.

| Item | Verdict | Evidence / note |
| --- | --- | --- |
| 1.1 Promised workflows and modes from the proposal and review | passed | W1–W5 MCP-only; no GUI or messaging promised (review answer 3: no Mail) |
| 1.2 Versions, paths, schemas, tools, hooks, events, dependencies match files | passed | registry load in the verifier; `contracts:check`; `package.test.cjs` checks tools against handlers |
| 1.3 Startup/tests from a clean checkout with public Host only | passed | verifier copies the package alone and runs its tests and example; `service.cjs` uses the public launcher |
| 1.4 Required receiving Apps at compatible versions | not applicable | none required; the walkthrough uses Notes 1.0.0 and Calendar 1.3.0 through their own tools only |
| 2.1 App-only tests with real functions, invalid transitions, missing objects, read-only behaviour | passed | 25 tests; refusals asserted decided-before-change |
| 2.2 Create/read/update/cancel produce state and history; invalid operations preserve data | passed | T04, T07, T11–T15; real MCP atomicity checks |
| 2.3 Data references and provenance valid | passed (automated) | `check-fixtures.cjs`; `dataset.json`; human review of realism still pending |
| 2.4 Optional diagnostics do not change results | passed | `package.test.cjs` diagnostics test |
| 3.1 Real MCP discovery and calls match contracts and committed state | passed | verifier; `real-mcp.cjs` |
| 3.2 Business callers cannot seed, reset, inject, snapshot | passed | verifier; `real-mcp.cjs` six `permission_denied` checks; policy fence |
| 3.3 Seed/reset, runs, versions, retries, events, supplied time | passed | `real-mcp.cjs` |
| 3.4 Declared messaging | not applicable | publishes and receives none |
| 3.5 Candidate and base validators | passed (candidate at `a4bce02`); base re-run on current `main` not run | `verify-submissions.cjs` at `a4bce02` |
| GUI items | not applicable | MCP-only approved scope |
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
