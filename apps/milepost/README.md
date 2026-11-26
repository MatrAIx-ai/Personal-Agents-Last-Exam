# Milepost practice platform

Self-contained PALE App package, version 1.0.0, Core API 1.2.0, for the approved proposal [`proposals/environment/practice-platform.md`](../../proposals/environment/practice-platform.md) (PR #70, plan approved at `066d9ba`). Milepost tracks one student's mastery skill by skill, so tasks can test whether an agent plans practice that fits this student and replans when results or dates change. All people, courses and results are synthetic. Khan Academy is a workflow reference only; no affiliation is claimed.

## Run locally

Node.js 18 or newer. No package install, account, model API or remote service is needed. From the repository root:

```sh
node --test apps/milepost/tests/business.test.cjs     # App-only business tests, including expected states E1-E6
node apps/milepost/examples/run.cjs                    # walkthrough: plan, project, apply examples/scenario.json
node --test apps/milepost/tests/runtime.test.cjs       # real public runtime: MCP, versions, receipts, clock, reset
npm run app:verify -- --app apps/milepost --output .artifacts/milepost.json
node apps/milepost/scripts/build-contracts.cjs --check # tools.json and the seed/event schemas match their definitions
node apps/milepost/scripts/build-fixtures.cjs --check  # the full fixtures match their catalog and profiles
node apps/milepost/scripts/build-scenarios.cjs --check # the scenario bundles match their scenario.json
```

Inside this folder alone, `npm test` and `npm run example` work without the runtime.

## Workflows, tools and events

| Workflow | Agent tools (prefix `milepost.`) | Infra events (`env.apply_event`) |
| --- | --- | --- |
| 1. Where the student stands | `courses.list`, `skills.list`, `mastery.get`, `assessments.list`, `practice.list`, `preferences.get` | — |
| 2. Plan practice | `plan.list`, `plan.add_block`, `plan.update_block`, `plan.remove_block`, `plan.project` | — |
| 3. Record practice | `practice.record`, `practice.remove` | `practice.completed` |
| 4. Replan after a change | the workflow 2 tools | `assessment.result_posted`, `assessment.added`, `assessment.moved`, `preferences.changed` |

Eight tools read and five write. Every read returns `as_of`, the current virtual time. Writes need `request_id` and `expected_version`; Core returns the first result for a repeated request, `idempotency_conflict` for a reused ID with a different request and `stale_version` for an old version. Business refusals: `not_found`, `past_block`, `overlap`, `invalid_time`, `invalid_state`, `not_removable`; refused events return `unknown_reference`, `duplicate_id` or `invalid_value` and change neither data nor the clock. `tools.json` and `schemas/events.schema.json` give the exact inputs, outputs and payloads; `examples/events/` holds one valid event of each type.

Milepost enforces only its own limits (no overlapping blocks or sessions, no blocks in the past, no future reports). It does not stop a plan that breaks the student's study rules or a report of practice that did not happen; graders decide.

## Learner rule v1

`src/learner.cjs` implements `milepost-learner/1` exactly as pinned in the proposal: level `L(t) = m · ρ^((t − t₀)/S)`; a session of `d` minutes ending at `t` sets `a = m·R`, `m ← min(1, a + λ·(d/60)·(1 − a)·(φ + (1 − φ)·P))`, `S ← S·(1 + γ + β·(1 − R))`, `t₀ ← t`, with `P` the lowest prerequisite level at the session's start; a posted result sets `m` and `t₀` and keeps `S`. A skill's state is replayed from its seeded record in time order (a result after a session at the same instant), so removing reported practice recomputes the skill and later results stay. It is adapted from the transparent learner model of [LearnerAgentBench at `ff3807a`](https://github.com/LixinTu/LearnerAgentBench/blob/ff3807ae6bd531f41a34528443658987dca13b55/src/learneragentbench/learner/model.py): one skill per session; results, removal and the replay order are new. `tests/expected-states.cjs` checks the proposal's worked examples E1–E6. The rule is a declared synthetic model, not a model of real learning.

## Data and the evaluator-only boundary

`schemas/seed.schema.json` describes one student account: the course catalog (`courses`, `units`, `skills` with prerequisites), the student's record (`mastery` baseline, `assessments`, `results`, `practice`, `plan`, `preferences`) and `evaluator` data: the student's `learner_params` and the `activity_log` of committed Agent writes. Evaluator data and stability values never appear in a tool result, error or rendered page (`tests/integrity.cjs` and `tests/runtime.test.cjs` plant markers to check this); only Infra's `env.snapshot` returns them. `validateSeed` checks unique IDs, references, prerequisite cycles, one mastery record per skill, result and session timing, block/session consistency and that no history lies after the run's virtual time.

`fixtures/minimal.json` is the small example student of E1–E6 (two skills, two assessments); `fixtures/clock.json` starts the clock at Mon 2027-03-01 09:00 (−05:00).

## Full fixtures

[`fixtures/students/`](fixtures/students/README.md) holds two invented students, Maya Ortiz and Daniel Kim, who share three courses (algebra, statistics, biology: 16 units, 60 skills with prerequisites) and six assessments, and differ in mastery, practice history and study rules. Each folder is one load bundle: `seed.json`, `binding.json`, `dataset.json` (sources and expected counts) and an empty asset `catalog.json`. `scripts/build-fixtures.cjs` builds them from the hand-written catalog `fixtures/catalog/courses.json` and the profiles in `fixtures/profiles/`: a seeded starting level per skill, four weeks of practice following the student's habits, a planned week with done and missed blocks, and results of the three past assessments at the learner rule's level plus at most 0.05 of seeded noise. Load a bundle with `env.load_seed` at the profile's `now` (`2027-03-01T09:00:00-05:00`), passing `bundle: {dataset, catalog, blobs: {}}`; Core then checks its provenance and counts strictly, as `tests/runtime.test.cjs` does.

The catalog's names, prerequisites, assessments and targets are Milepost's own. Topic choice and order follow the tables of contents of three OpenStax textbooks, cited per unit and skill (`see`): *Elementary Algebra 2e*, *Introductory Statistics 2e* and *Biology 2e* (Rice University). These books are licensed CC BY-NC-SA 4.0 (checked on openstax.org on 2026-11-21; the proposal's "CC BY 4.0" is out of date), so no text, figures or exercises from them are included. Tasks load their own seed, history and starting time with `env.load_seed` (`virtual_now`), move the clock between sessions with `env.advance_time` (no handler runs: mastery and missed blocks are computed when read) and restore that seed and time with `env.reset`. The `scenario` policy profile allows reads and plan writes; `sandbox` adds the practice tools.

## Reference scenarios

[`examples/scenarios/`](examples/scenarios/README.md) holds four scenarios on the full fixtures that cover the four workflows and all five event types, each with a twin that changes only the student's practice history (sessions and the blocks they complete): planning for an exam (s1), checking reported practice against the record (s2), replanning after an exam moves and two evenings are lost (s3) and after a check-in result (s4). Each has a reference run, valid alternatives, controls that must fail, a stated reason why no run passes both members, and a state-only grader. A scripted planner that uses only Agent tools passes 7 of the 8 members.

## Building Tasks

[`docs/task-authoring.md`](docs/task-authoring.md) explains how to write a student's data, set the time, apply events, grade from state and build twins. [`examples/task-data/`](examples/task-data/README.md) is a worked example ("Get me ready for Friday's quiz") with its twin and an example grader.

## Plan checker for Task graders

`src/checker.cjs` exports `checkPlan(snapshot, {assessment_id})`, a pure function over `env.snapshot`'s `snapshot` (or any `{data, virtual_now}`). It returns the projected level of each target skill with `reaches_target`, and `broken_rules`: planned blocks on rest days, outside available hours, outside the block length, or on days over the daily cap (the cap also counts done blocks). It is not an Agent tool; give its output to graders only. Tasks define success.

## Activity log and grading evidence

Each committed Agent write appends one `evaluator.activity_log` entry with the virtual time, operation, `request_id`, the observed `expected_version`, the object ID and minimal details. A repeated request adds no entry. Graders can join it with Core's audit (`snapshot.audit`) and the supplied Agent execution trace by `request_id`, and must read `env.snapshot` before any reset, which clears the run's log and audit.

## Reviewer renderer

`gui/src/view.js` renders four read-only views (overview, skills and mastery, plan, practice log) from the read tools' results only, escaping all text. `contribution/gui.json` declares it for reviewers; there is no interactive business Web App.

## Package map

```text
app.json, package.json, LICENSE    identity, entry points, scripts, MIT license
tools.json                         13 Agent tools (generated)
service.cjs, plugin.cjs            provided launcher and the standard hooks
src/learner.cjs                    learner rule v1
src/model.cjs, src/views.cjs       record consistency, derived state and Agent-visible read results
src/operations.cjs, src/events.cjs tool and event handlers
src/checker.cjs                    plan checker for graders
src/time.cjs                       time-zone-aware dates and offsets
schemas/                           seed and event schemas (generated), state envelope and shared contracts
scripts/build-contracts.cjs        generates tools.json and the seed/event schemas
contribution/                      capability, GUI, asset-catalog and dataset declarations
fixtures/                          example student, binding, policies and clock
fixtures/catalog, fixtures/profiles hand-written course catalog and student profiles
fixtures/students/<id>/            full fixtures, one load bundle per student (generated)
scripts/build-fixtures.cjs         builds the full fixtures with a fixed seed
scripts/build-scenarios.cjs        builds the reference scenario bundles
examples/scenarios/                four reference scenarios with twins, grader, scripted baseline, bound and player
trials/                            agent-trial harness for an OpenAI-compatible model endpoint, and its results
docs/reproduce.md                  reproduction guide for an independent reviewer
examples/                          walkthrough, scenario event, one example per event type, worked task example
docs/task-authoring.md             guide for Task authors and graders
gui/                               reviewer renderer
tests/                             business tests, harness, schema validator and runtime tests
```

## Status and remaining work

Implemented: all 13 tools, 5 event handlers, learner rule v1, the plan checker, the reviewer renderer, the E1–E6 example student and its tests, a guide for Task authors, a worked task example with its twin and controls, the two full fixtures with their generator and provenance, and the four reference scenarios with their twins, controls, proofs, grader and scripted baseline. Agent trials ([`trials/`](trials/README.md)): a local 7B model in two rounds of 12 (round 1 led to clearer refusals and weekday fields; round 2 failed only on planning), then Claude Code with Opus 5.5 (12 of 12) and Codex with gpt-6.2-astra (11 of 12; its one failure exposed a rounding gap in `plan.project`, now fixed), and on the twins 12 of 12 each, every run changing the decision its twin targets. Still to come: an independent reproduction ([`docs/reproduce.md`](docs/reproduce.md)) and human review of every fixture record.
