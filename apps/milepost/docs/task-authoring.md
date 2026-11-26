# Building Tasks on Milepost

For Task authors and graders. Milepost holds one student's courses, skill-by-skill mastery, assessments, practice and study plan. A good Milepost task is one where the right plan depends on this student: what they know, what they have forgotten, when they can study and what they asked for. Milepost reports levels under a declared rule; the Task decides what success means.

## 1. Write the student's data

A seed follows `schemas/seed.schema.json`; `fixtures/minimal.json` is a complete small example. To start from a realistic student, copy one of the full fixtures in `fixtures/students/` and load it with its `binding.json` and `bundle: {dataset, catalog, blobs: {}}`. Without a bundle, Core records the data as an unidentified import that needs review. If your Task changes a fixture, say how in the copy's `dataset.json` (`transformations`) and update `expected_counts.records`. The reference scenarios in `examples/scenarios/` show this end to end: `scripts/build-scenarios.cjs` adds a scenario's records to a fixture and writes the provenance.

- **Catalog:** `courses`, `units` (with `course_id`, `position`) and `skills` (with `unit_id` and `prerequisites`). Prerequisites must exist and form no cycle.
- **Mastery baseline:** exactly one `mastery` record per skill: `level`, `stability_days` (within the student's `learner_params` bounds), `as_of` (the time the level refers to; `null` means never practised or assessed, so it does not fade) and `last_practised_at` (not after `as_of`).
- **History:** `practice` sessions (`source` `platform` or `student_report`, `minutes`, `ended_at`, `recorded_at`), `results` (one per assessment, on or after its date, target skills only) and `plan` blocks (`done` exactly when a platform session names the block). History must start after the skill's `as_of`, must not overlap and must not lie after the run's `virtual_now`. Mastery at any time is replayed from the baseline through this history, so describe the past as sessions and results rather than by editing levels.
- **Study rules:** `preferences` (`available_hours` per weekday, `daily_cap_minutes`, `rest_days`, `block_minutes`) and the student's `time_zone`. Milepost does not enforce these; the grader does.
- **Evaluator data:** `evaluator.learner_params` (defaults: learning rate 0.5 per hour, prerequisite floor 0.3, retention base 0.9, stability growth 0.6, spacing bonus 0.5, stability 1–60 days) and an empty `activity_log`. The Agent never sees these.
- **Identity:** `account_id` and `owner_person_id` must match the binding you load with the seed.

Every object ID must be unique across the whole seed. `validateSeed` rejects the seed with `invalid_seed` and a reason if any of this fails; use `env.validate_bundle` to check before loading.

## 2. Time and events

- Load with `env.load_seed` and set the scene's start with `virtual_now`. `env.reset` restores that seed and time.
- Between sessions, move the clock with `env.advance_time`. No handler runs, but mastery and missed blocks are computed when read, so levels fade and passed blocks become `missed`.
- Apply scenario changes with `env.apply_event` at their own times (never before the App clock): `milepost.practice.completed` (a session, optionally completing a planned block), `milepost.assessment.result_posted`, `milepost.assessment.added` (new IDs only), `milepost.assessment.moved` (existing, not yet assessed) and `milepost.preferences.changed`. `examples/events/` has one valid example of each; a refused event changes neither data nor the clock.

## 3. What the Agent can do

The `scenario` profile allows the eight reads and the three plan writes; `sandbox` adds `practice.record` and `practice.remove`. Supply your own `policies` with `env.load_seed` to narrow either, for example to forbid recording practice in a planning-only task. `plan.project` gives the Agent the projected level of each target skill for the stored plan; it never says whether the plan breaks a study rule.

## 4. Grade from state, not from prose

Read `env.snapshot` before any reset; reset clears the run's activity log and Core audit.

- `src/checker.cjs` exports `checkPlan(snapshot, {assessment_id})`: projected levels with `reaches_target` (unrounded comparison) and `broken_rules` (rest days, available hours, block length, daily cap). It is pure and is for graders only.
- `snapshot.data.evaluator.activity_log` lists every committed Agent write with its `request_id`, observed version, object and details; repeated requests add no entry. Join it with `snapshot.audit` and the supplied Agent trace by `request_id` to see refused attempts and order.
- Typical checks: targets reached; no rule broken; no practice planned for a skill that already reaches its target (compare with the projection after removing planned blocks); a cap on planned minutes; a reported session recorded only after checking `practice.list`; a block removed or moved after an `assessment.moved` event.
- Report levels to three decimals if you show them; compare unrounded values.

`examples/task-data/grade.cjs` grades the worked example this way.

## 5. Twins

A twin is a copy of the task's seed with one decisive part of the student's record changed, either mastery together with the history that explains it, or one study rule. State which decision must change and why. Check both members with the same grader, and show that no single Agent outcome passes both (a short argument, or an exhaustive check over the plausible plans). If a reference run passes both members, the twin does not test what the task claims. The worked example's twin adds two weekend practice sessions, so the right answer becomes "plan nothing"; `tests/task-example.cjs` checks that the base reference plan fails the twin and the empty plan fails the base.

## 6. Pitfalls

- Levels depend on the replay: adding a session before an existing result does not change that result's level, only the stability afterwards.
- `plan.project` refuses an assessment whose date has passed (`invalid_state`). Its `reaches_target` is judged on the unrounded level, as the plan checker does; `projected_level` is rounded to three decimals, so 0.650 against a target of 0.65 can still be short.
- A block that ends without a completed session becomes `missed`; a late `practice.completed` naming it marks it `done`.
- Student-reported practice can be removed but not edited; platform sessions cannot be removed (`not_removable`).
- Assessment targets need levels of at least 0.01; result levels may be 0.
