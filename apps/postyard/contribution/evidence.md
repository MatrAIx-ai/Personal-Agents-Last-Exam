# Postyard delivery evidence

This delivery is MCP-only. `contribution/gui.json` declares a reviewer placeholder. No business page is shipped, so there are no GUI screenshots. The commands below run from a checkout that contains `runtime/`.

```sh
BASE=$(git rev-parse origin/main)
npm test --prefix apps/postyard
node apps/postyard/examples/run.cjs
node apps/postyard/scripts/coverage.cjs
npm run app:verify -- --app apps/postyard --output .artifacts/postyard-verify.json
node --test runtime/tests/clock.test.cjs
```

The isolated verifier runs `tests/business.test.cjs` and `examples/run.cjs` with a stripped environment. `tests/runtime.test.cjs` runs from the repository checkout, because it loads `runtime/prepare.cjs`. The copied package used by `app:verify` contains the App only.

Observed on Node v18.20.8, v22.23.4 and v24.22.3: `tests/business.test.cjs` 16 passed, `tests/runtime.test.cjs` 1 passed, `examples/run.cjs` printed `{"app":"postyard","notes":1,"id":"ac-0007:n1"}`. On Node v22.23.4, `app:verify` passed (runtime 1.6.0, Core API 1.2.0) and `runtime/tests/clock.test.cjs` passed 7 tests, including the eight-app clock check. The live `package_sha256` is recorded in the PR description.

`node apps/postyard/scripts/coverage.cjs` writes `contribution/coverage.json`. The run used for this note counted 118 dated post, note and follow rows, with every month from 2025-01 through 2026-12 represented and `empty_months` empty. Time zone `America/Los_Angeles`. Every row is synthetic. Postyard has no external archive, so November 2026 is synthetic in the same way as the other months. Fixture (a) stops at `2026-02-09T20:40:00-08:00`. `examples/dataset/later-2026/` holds March through December 2026 and is loaded only at `2026-12-31T18:00:00-08:00`.

The Forkyard join check is outside the package tests:

```sh
node apps/postyard/scripts/check-forkyard-join.cjs /path/to/forkyard-checkout
```

Against Forkyard commit `e9fe739b0b6af11d3805756a4916c028cf41bb4e`, a document that keeps `actor_account_id` `ac-0001` produced no `linked_post` subject. The same document with `actor_account_id` rewritten to `fy-tomasreyes` produced `linked_post` for `person-ingrid`. See the README for the mapping.

This dataset work follows the 2026-11-25 evidence policy in `docs/submission-evidence.md`, which is newer than the plan approval. The added pieces are the monthly coverage report, the later-2026 partition, and the date-rule test in `tests/business.test.cjs`.

## Delivery evidence index

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blog publish, schedule, release, unpublish, receipts, reach | Required. MCP-only. Public runtime 1.6.0, Core API 1.2.0. No other App at run time. | N/A. MCP-only scope. | `postyard.blog.drafts.*`, `postyard.blog.publish`, `postyard.blog.schedule`, `postyard.blog.unschedule`, `postyard.blog.edit_published`, `postyard.blog.unpublish`, then `publication.release_due`. Reads report `due: true` after `publish_at` and before the release. | `tests/business.test.cjs` core examples for mention/unpublish reach 2300, scheduled release, `schedule_in_past`, revision history, and `tests/runtime.test.cjs` for one receipt on replay. | N/A. No runtime dependency. Receipts are `pr-NNNN` inside the Postyard snapshot. | `contribution/coverage.json`. Synthetic. | Passed for the first package. Cover images remain outstanding. |
| Notes post, reply, delete, get, feed | Required for the first package. | N/A. MCP-only scope. | `postyard.notes.post`, `postyard.notes.reply`, `postyard.notes.delete`, `postyard.notes.get`, `postyard.notes.feed`. `notes.post_by_other` adds another account's note. | Core examples for the 512-character reject, the Ingrid name variant, the bystander thread, and the declined reply `ac-0001:n41`. | N/A. | Same coverage report. Notes in fixture (a) run from 2025-01 through 2026-02. | Passed for the first package. `postyard.notes.schedule`, `postyard.notes.repost` and `postyard.notes.search` remain outstanding. |
| People reads | Required: `postyard.people.get`, `postyard.people.posts`. | N/A. MCP-only scope. | `postyard.people.posts` with `handle` `ihalvorsen` lists two public posts and changes no data. | `people.posts reads the maintainer and the helper records attention`. | N/A. | People ids match the Forkyard rejected-pr fixture: `person-tomas`, `person-ingrid`, `person-ship`. | Passed for the two reads. Search, follows, blocks and profile updates remain outstanding. |
| Owner confirmation and predictable ids | Required. | N/A. MCP-only scope. | Confirmation on: publish and schedule wait. `only_pending` confirms `ac-0001:p13`. Decline moves `ac-0001:n41` to `declined`. `not_pending`, `ambiguous_target` and an unknown id leave state unchanged. | Named tests `events that point at records the agent creates`, `owner confirmation coverage for the implemented writes`, and the runtime deny-audit assertions. | N/A. Core audit deny rows carry `trace.event_id` and `reason`. | N/A. | Passed for the implemented writes. Confirmation for schedule-a-note, repost and profile remains outstanding because those tools are outstanding. |
| Evidence helper | Required. Schema `urn:pale:public-speech-evidence:1`. | N/A. | `evaluator/export.cjs` reads a snapshot and execution records. Package tests validate it against `schemas/public-speech-evidence.schema.json` and join pull 2290 in `examples/recorded/forkyard-evidence.json`. | `package-local evidence schema and the recorded Forkyard join`. | The recorded sample's provenance is `examples/recorded/PROVENANCE.md`. The live Forkyard exporter check is `scripts/check-forkyard-join.cjs`. | N/A. | Passed inside the package. The author-id mismatch with Forkyard's join is documented in the README. The repository-level schema diff waits for Forkyard to merge. |
| Reset, replay, clock | Required. | N/A. | `env.reset` restores business data and the baseline clock and advances the epoch. `env.advance_time` changes no Postyard records. A repeated `publication.release_due` with the same event id returns `duplicate: true`. | `tests/runtime.test.cjs`. Verifier checks for Agent tool hiding, history load, reset, snapshot and a read that changes no data. | N/A. | N/A. | Passed. |
| Dataset window | Added under the 2026-11-25 evidence policy. | N/A. | `scripts/build-fixtures.cjs` writes fixture (a) and the later partition. `scripts/coverage.cjs` reports months. | `fixture history dates, ids, and the materialized audience`. | N/A. | `contribution/coverage.json`. 118 rows. No empty month. All synthetic. | Passed. `follower_count` 2100 counts the audience. 40 follow edges are materialized account records. |
