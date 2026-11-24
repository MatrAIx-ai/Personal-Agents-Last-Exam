# Platewright

Platewright is a resettable recipe box and household meal planner, seen from one household member's account. It knows what each recipe contains, who in the household cannot or will not eat what and from which date to which date, what is planned for which meal and for whom, and what is already in the kitchen. It answers one question the same way everywhere (is this dish, as it would be cooked, right for each person who will eat it on that day?) and turns the week's plan into the quantities that still have to be bought. It sells nothing and places no order.

- App ID `platewright`, version 1.0.0, Core API 1.2.0, public runtime 1.6.0. Node.js 18+ built-ins only; nothing to install.
- Approved scope: [`proposals/environment/platewright.md`](../../proposals/environment/platewright.md). Validation, the workflow-to-test mapping and the acceptance self-review: [VALIDATION.md](VALIDATION.md).
- MCP-only first version: no GUI and no reviewer console. The other household members act only through events.
- Everything is fictional: the Arden-Okafor household (Nora, Evan, Eli and Ada), their guests, the 60 recipes, the substitution rules and the ingredient table were written for this package. Workflow shapes were informed by public help pages of Paprika, Plan to Eat and Mealime; the nine allergen names follow the FDA's list of major food allergens. No data, recipe text, photos, branding or icons were taken from them.
- **Not advice.** The nutrition values are rounded, illustrative figures and the suitability check is simplified. Nothing here is medical, allergy or dietary advice.

## Workflows

| Workflow | Agent operations | Events that change it |
| --- | --- | --- |
| W1 Recipe box | `recipes.search`, `recipes.get`, `ingredients.search`, `recipes.create`, `recipes.update` (also archives and restores) | `recipe.added` |
| W2 Profiles and the check | `household.get`, `recipes.check`, `members.constraint.set`, `members.constraint.remove` | `member.updated` |
| W3 Substitutions | `substitutions.list`, `recipes.variant.preview`, `recipes.variant.create` | — |
| W4 Weekly meal plan | `plan.get`, `plan.slot.set` (also clears), `plan.slot.mark` | `plan.changed`, `guest.changed` |
| W5 Pantry and shopping list | `pantry.list`, `pantry.set`, `shopping.generate`, `shopping.get`, `shopping.item.set`, `shopping.item.remove` | `pantry.changed`, `shopping.changed` |
| Notifications | `notifications.list` | all six |

All 22 tools are `platewright.<name>` (11 reads, 11 writes). Every write takes Core's `request_id` and `expected_version` (`{epoch, revision}`) and returns the object's `id` with the committed version; the object's own state is reported as `state` because Core sets `status` to `committed`. The target object is always the argument `id`: a recipe, a member (`person_id`, for constraint writes), a slot (`2026-11-14:dinner`), an ingredient (for `pantry.set`) or a shopping line. A window is always `start` / `end` as `YYYY-MM-DD` dates. The Agent always acts as the account holder bound by Infra.

App errors: `not_found`, `unknown_ingredient`, `unknown_member`, `unknown_rule`, `invalid_quantity`, `invalid_servings`, `invalid_constraint`, `invalid_window`, `invalid_state`, `no_conversion`, `not_in_recipe`, `rule_not_applicable`, `conflict`, `past_slot`, `not_yet`, `leftover_unavailable`, `derived_line`, `no_list`, and `invalid_arguments` for malformed dates and empty patches. Core adds `permission_denied`, `stale_version` and `idempotency_conflict`. A refused event is `invalid_event` with data and clock unchanged.

### Rules worth knowing

- **Time is the environment's.** There are no timers and no clock event. A constraint's `state` (`scheduled`, `active`, `expired`, `ended`), a slot's `phase` (`upcoming`, `past`) and a pantry item's `freshness` (`fresh`, `use_soon`, `expired`, `no_date`) are derived from stored dates and `ctx.virtual_now` in the household's time zone when they are read. A read writes nothing; no notification is written by a read or by the passing of time.
- **One check, on the date of the meal.** `recipes.check`, `recipes.variant.preview` and every slot's flags use the same function. A member's constraints apply as they stand on the meal's date; a constraint ended today stops applying from today's date. Verdicts in order of seriousness: `unsafe` (allergen contained, or a medical ingredient or flag; may-contain under a `strict` allergy), `may_contain`, `unsuitable` (a diet's flag), `over_limit` (nutrition per serving times the person's portion factor; a guest counts 1), `disliked` (an ingredient or an ingredient tag), else `ok`. Every finding names its lines. The verdict is the most serious finding; only when every finding is caused by optional lines alone is it `ok_if_omitted`. The lines of findings caused only by optional lines are always listed in `omit_lines` (so optional walnuts under a strict tree-nut allergy give `unsafe` with the walnuts named, even next to a firm dislike). A limit that cannot be checked because nutrition is unknown is listed in `unchecked`, never counted as zero, and shows on the slot as a `limit_unchecked` flag. `lactose` is a flag and `milk` an allergen, so lactose-free yogurt suits a lactose-free diet and is still unsafe for a milk allergy.
- **Guests exist only on their slot.** A guest's constraints are checked for that meal alone and never reach another slot or a member's profile.
- **A plan can be wrong and says so.** `plan.slot.set` never refuses a dish for whom it is wrong. Slots read with `flags`: one `person` flag per attendee or guest whose verdict is not `ok` (planned and cooked slots), plus `limit_unchecked` (a person's limit on a dish whose nutrition is unknown, with the lines that cannot be weighed), and `archived_recipe`, `stale_base`, `leftover_short` and `leftover_expired` (planned slots).
- **Servings and leftovers.** A dish's default servings are the attendees' portion factors plus one per guest, rounded up to a half. A planned source slot leaves its servings minus its default portions; a cooked one leaves `made - eaten`; a skipped or cleared one leaves nothing. Takes are counted in meal order (breakfast, lunch, snack, dinner). Leftovers older than `leftover_max_days` on the day they are planned for read `leftover_expired`.
- **Units.** Fixed kitchen values (1 tsp = 5 ml, 1 tbsp = 15 ml, 1 cup = 240 ml, 1 fl oz = 30 ml, 1 oz = 28.35 g, 1 lb = 453.6 g). Mass and volume convert only through the ingredient's density, pieces and mass only through its weight per piece; otherwise `no_conversion`. `unit_system` is `recipe` (as written), `metric` or `us`; `units` asks for one ingredient in a given unit. Shown quantities are rounded (g and ml to 1, or 0.5 below 10; spoons and cups to a quarter, an eighth below 1 tsp; whole-piece ingredients counted in `each` round up) and carry `exact`. As written, an amount below one tablespoon (or a quarter cup) is shown in a smaller spoon, so 0.1 tbsp shows as 0.25 tsp.
- **Nutrition** per serving sums grams times the per-100 g values over non-optional lines; a line that cannot be converted to grams makes it `null` with the line in `missing_for`.
- **Variants** record the base recipe, its revision and the swaps (`rule_id`, or `custom` and then the variant is `unverified`). They do not follow later edits of the base and read `stale_base` once the base moves on. A variant is not edited (save another one); a variant of a variant is refused.
- **Shopping list.** `shopping.generate` adds up the exact quantities of every planned recipe dish in the window per ingredient in the unit it is bought in (lines that cannot be converted to it are merged in the base unit of their own dimension), leaves out leftovers and optional lines (listed in `optional_lines`), takes pantry stock use by use in meal order, each lot only for meals on or before its use-by date and never once the clock has passed that date (what is left of a lot when it would expire first is listed in `expiring_before_use`; stock in a unit that cannot be converted in `stock_not_counted`), and rounds up once. 500 g of yogurt with a Thursday use-by covers Tuesday's 300 g; the other 200 g are not counted for Saturday. Each derived line lists its slots. Regenerating keeps manual lines, ticks and exclusions on lines still needed, drops unticked and excluded lines no longer needed and keeps ticked ones as `surplus`. A current list reads `stale` after any committed change to the plan slots in its window, the recipes they use, the pantry or the members' portion factors and constraints.
- **Pantry.** One item per ingredient. `pantry.set` with quantity 0 marks it `out`. Marking a slot cooked with `deduct_pantry: true` takes the exact non-optional quantities from the pantry, never below zero and never from stock past its use-by date on the slot's date, and returns what was short (`not_in_pantry`, `not_enough`, `expired`, `no_conversion`). Marking cooked with the default portions records the dish's servings as made and the attendees' portions as eaten, at most what was made.
- **Notifications and activity.** Each applied event writes one notification and one activity row. Each committed Agent write writes one activity row with its `request_id`. A replay, a refusal or a clock move writes none.

## Data

`fixtures/reference.json` is the package seed (656 KB, no media): 213 ingredients with allergens, may-contain, eight content flags, tags, units, density or weight per piece and nutrition; 48 substitution rules; 60 recipes (two of them added by members during the history) and 6 variants, one with a stale base and one unverified; four members with 18 constraints covering every kind and every state at the loaded time; 71 plan slots over five weeks (cooked, skipped, cleared and planned, with guests and leftovers); 40 pantry items; a stale shopping list of 36 lines with ticks, an exclusion and manual lines; and 14 notifications with their activity rows. The loaded time is Sunday 2026-11-08, 08:00 in America/New_York. The history was produced by replaying five weeks of plan writes and fourteen events through the App's own hooks (`scripts/build-fixtures.cjs`); rows the account wrote then are marked `seed`. `fixtures/minimal.json` is the smaller household the business tests start from.

`scripts/check-fixtures.cjs` checks both fixtures beyond `validateSeed`: every recipe line converts to grams or belongs to an ingredient that is not convertible on purpose, diet tags on recipes follow from their lines, titles and ingredient lists are distinct, constraint and slot states agree with the loaded time, every date is on or after 2026-01-01, the only flags present are the intended ones, and the counts match `contribution/dataset.json`.

`tools.json` (247 KB on disk, about 92 KB as compact JSON; every nested result shape is typed with `additionalProperties: false`), `schemas/seed.schema.json` and `schemas/events.schema.json` are generated by `scripts/build-contracts.cjs` (`npm run contracts:check` detects drift). `schemas/state.schema.json` is the provided Core envelope; the other schema files are copies of the public shared contracts kept in sync by the repository's `npm run contracts:check`.

### For evaluators and tasks

- Evaluator records: the snapshot's activity rows, recipe revisions, constraint and slot histories and the shopping list (each derived line names its slots); Core's audit rows (with the projected `id`, `start` and `end`); and the Agent trace for verdicts and flags shown, which are never stored. `plugin.cjs` exports the pure `check` and `flagsFromSnapshot(data)` so flags at the end of a run can be recomputed from a snapshot.
- A task can fence off other members' constraints with `policies.json`, because both constraint writes target the member as `id`; list both tools, as in `fixtures/policies-fence.json` (exercised by `scripts/real-mcp.cjs`). The write result's `id` and the activity row's `object_id` are the constraint; Core's audit row records the member as its `id`.
- Seeds are validated by `validateSeed` (duplicate IDs, dangling references, a variant whose base is missing, a unit an ingredient cannot be measured in, a cooked slot dated after the loaded time, malformed dates, timestamps without a UTC offset, an account the binding does not declare, revisions out of step).

## Commands

From this folder (the package alone, no runtime needed):

```sh
npm test                 # 31 business tests: T01–T16, T17 (App side), contracts, seed validation, fixtures, diagnostics
npm run example          # walkthrough: Evan's cilantro dislike from tomorrow flags tomorrow's tacos, not tonight's
npm run contracts:check  # generated tools/schemas match their source
npm run fixtures:check   # consistency of both fixtures
```

With the pinned public runtime (found automatically in a full checkout, or `--runtime DIR` / `PALE_RUNTIME_ROOT`):

```sh
node scripts/real-mcp.cjs [--runtime DIR] [--output FILE]                                       # 63 real MCP checks (Core side of T17)
node scripts/notes-calendar-walkthrough.cjs [--runtime DIR] [--notes DIR] [--calendar DIR]      # Notes 1.0.0 -> Platewright -> Calendar 1.3.0
```

From the repository root:

```sh
npm run app:verify -- --app apps/platewright --output .artifacts/platewright.json
npm run contracts:check
npm test
```

Run an MCP server pair by hand: `node apps/platewright/service.cjs --role infra --run demo --state-dir .state` and, in another process, the same with `--role agent`. The default `scenario` profile allows only reads; Infra selects `sandbox` with `env.reset` to allow writes.

## Limitations

Out of scope in this version, as approved: prices, budgets, stores, products, carts and orders; recipe import from a web page or a photo; photos and other media; ratings and comments; automatic menu or recipe suggestion; daily or weekly nutrition totals (a `limit` is per meal); micronutrients beyond sodium; cooking timers; locking a day of the plan; several households or accounts per instance; email, push and chat notices; any GUI. There is no messaging in either direction. Nutrition values, substitution rules and recipes are illustrative and await human review.
