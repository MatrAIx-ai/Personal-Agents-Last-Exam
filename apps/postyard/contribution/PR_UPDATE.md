✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

## Track and stage

**Track (required): select one.**

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Implementation (first runnable package)

## Design

**Design file (required for Environment or Task):** [`proposals/environment/postyard-publishing.md`](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/postyard-publishing/proposals/environment/postyard-publishing.md)

The approved blob is `dd0447f1f7b7f5b9f1904ea43afe6700f52d8090`. This branch does not edit that file.

Title: `[Environment Proposal] [Social & communities + Work & business] Postyard developer blog and short posts`

## Summary and dependencies

**Summary (required):** Postyard v1's first runnable package is implemented under `apps/postyard/`. It is MCP-only. A bound account can draft, revise, schedule, publish, correct and unpublish a developer blog, and can post, reply to, delete and read short notes. Owner confirmation holds the public writes until `owner.confirm_publication` or `owner.decline_publication`. `publication.release_due` has an empty payload and is the only release path. Reach is computed at read time. The evidence helper writes `urn:pale:public-speech-evidence:1`. Fixture (a) at `apps/postyard/examples/task-data/rejected-pr/` is the seed for task #74.

Head `<HEAD_SHA>`. Package sha256 `<PACKAGE_SHA256>`. Verified against upstream main `6933c430942c64f94874083815829e4a4b20920a` (public runtime 1.6.0, Core API 1.2.0).

**Dependencies / questions (optional):** No runtime connection to another App. Forkyard (#88, commit `e9fe739b0b6af11d3805756a4916c028cf41bb4e`) is an evidence-join partner through `apps/postyard/examples/recorded/forkyard-evidence.json`. The schema copy matches Forkyard's blob `0a8eb61ab15c3d3aaec1f687c1cc2bb93ac82053`. Forkyard's exporter joins a companion when `actor_account_id` is a Forkyard account. Postyard keeps `ac-0001`, so a faithful export does not join until Forkyard also matches `person_id` `person-tomas` with URL handle `tomasreyes`. `apps/postyard/scripts/check-forkyard-join.cjs` shows both outcomes. First consumer: task #74. Task #119 can grade the single receipt `pr-0007` from the release-note example.

## Progress and evidence

- [x] Proposal ready for design review
- [x] Plan approved by maintainer
- [ ] Implementation complete
- [x] Validation evidence attached for the first runnable package

The implementation-complete box stays open because the completion items in `apps/postyard/contribution/REMAINING.md` are still outstanding. Evidence for the first package is `apps/postyard/contribution/evidence.md`.

### Implementation progress

Built under `apps/postyard/`:

- `app.json`, `package.json`, `service.cjs`, `plugin.cjs`, `tools.json` (17 `postyard.*` tools)
- `src/common.cjs`, `src/store.cjs`, `src/subjects.cjs`, `src/operations.cjs`, `src/events.cjs`, `src/model.cjs`
- `schemas/` including the byte-for-byte public-speech evidence schema
- `evaluator/export.cjs`
- `fixtures/` smoke seed, `examples/task-data/rejected-pr/` fixture (a), `examples/dataset/later-2026/`
- `examples/recorded/forkyard-evidence.json` and `PROVENANCE.md`
- `tests/business.test.cjs`, `tests/runtime.test.cjs`, `tests/harness.cjs`
- `scripts/build-fixtures.cjs`, `scripts/coverage.cjs`, `scripts/check-forkyard-join.cjs`
- `contribution/evidence.md`, `contribution/coverage.json`, `contribution/REMAINING.md`
- `README.md` for task authors

### How to run and verify

```sh
BASE=$(git rev-parse origin/main)
npm test --prefix apps/postyard
node apps/postyard/examples/run.cjs
node apps/postyard/scripts/coverage.cjs
npm run app:verify -- --app apps/postyard --output .artifacts/postyard-verify.json
node --test runtime/tests/clock.test.cjs
```

Observed: Node v18.20.8, v22.23.4 and v24.22.3 each passed 16 business tests and 1 runtime test. `examples/run.cjs` printed `{"app":"postyard","notes":1,"id":"ac-0007:n1"}`. `app:verify` passed on Node v22.23.4 (runtime 1.6.0, Core API 1.2.0), `package_sha256` `<PACKAGE_SHA256>`. The clock test passed 7 tests, including the eight-app check. Coverage counted 118 rows and no empty month from 2025-01 through 2026-12. Package size is about 381 KB, inside the under-1 MB footprint.

### Reviewer items

- Predicted ids and `only_pending` are in the README Identifiers section, with the `ac-0001:p12` to `ac-0001:p13` example.
- Events that point at records the Agent creates: ids are `<account_id>:p<n>` and `<account_id>:n<n>`, only committed creations take a number, and the named test covers `ac-0001:p13`, `only_pending`, `not_pending`, `ambiguous_target`, unknown ids, and the declined reply `ac-0001:n41`. Core audit deny rows are asserted in `tests/runtime.test.cjs`.
- Owner confirmation follows the workflow 4 table for every implemented write. Pending notes use `pending_owner_confirmation`. A decline moves a note to `declined`. `publication.release_due` releases only `scheduled` items with `publish_at` at or before the event, and a late confirmation records `release_lag_seconds`.
- Package tests read files under `apps/postyard/` only. They validate the export against Postyard's schema copy and join the recorded Forkyard sample (pull 2290, `person-ingrid`).
- Replaying a `request_id`, or repeating `publication.release_due` with the same event id, does not add a second receipt.
- Reach stays at 2300 after unpublish in the 11:00 to 11:40 example (2,100 followers, rate 300).
- The subject index reports no hits on fixture (a)'s clean posts and finds handle, name, profile link and owned-post references in the planted post. `Ingriding` and `grid` do not match `Ingrid`.
- `publication.release_due` keeps an empty payload. `env.advance_time` calls no App handler. Between `publish_at` and the release, reads show `due: true`.
- `urn:pale:public-speech-evidence:1` is unchanged and stays inside the package.

### Dataset coverage

This follows the 2026-11-25 evidence policy, which is newer than the approval. Evaluation records cover 2025-01-01 through 2026-12-31 in `America/Los_Angeles`, all synthetic, reported by `scripts/coverage.cjs`. Fixture (a) is the pre-session history for a February 2026 clock. The later partition is a separate seed. The smoke fixture stays small. `follower_count` 2100 is the audience used for reach. 40 of those followers are materialized accounts.

### Files changed outside the App

- `apps.registry.json`: register `postyard` 1.0.0 so the shared runtime can launch it.
- `runtime/tests/clock.test.cjs`: the registry clock test counts packages. It now expects eight apps. No `runtime/core`, `runtime/web`, docs, or other App was edited.

### Downstream tasks

Task #74 loads `apps/postyard/examples/task-data/rejected-pr/` with `virtual_now` `2026-02-09T20:40:00-08:00`. Account `ac-0001` (`tomasreyes`, `person-tomas`) has posts `p1` through `p12`, notes through `n40`, and 2,100 followers. Ingrid is `ac-0002` / `person-ingrid`. Ship is `ac-0007` / `person-ship`. The next ids are `ac-0001:p13` and `ac-0001:n41`. F1, F2 and F4 read `revisions` and `subjects`. D1 reads `attention` from `postyard.people.get` and `postyard.people.posts`. `postyard.people.search` is still outstanding, so a search attention row is supplied through execution records until that tool lands.

### Known limits

Listed in `apps/postyard/contribution/REMAINING.md`. No business GUI. No Mail delivery. No images yet. Forkyard is not modified.
