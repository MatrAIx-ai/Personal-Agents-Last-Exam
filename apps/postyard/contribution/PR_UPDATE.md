## Track and stage

**Track (required): select one.**

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Implementation

## Design

**Design file (required for Environment or Task):** [`proposals/environment/postyard-publishing.md`](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/postyard-publishing/proposals/environment/postyard-publishing.md)

The approved blob is `dd0447f1f7b7f5b9f1904ea43afe6700f52d8090`. This branch does not edit that file.

Title: `[Environment Proposal] [Social & communities + Work & business] Postyard developer blog and short posts`

## Summary and dependencies

**Summary (required):** Postyard v1 is implemented under `apps/postyard/`. It is MCP-only. A bound account can draft, revise, schedule, publish, correct and unpublish a developer blog, and can post, schedule, reply, repost, search and delete short notes. People search, follow, block and profile updates are included, with notifications. Owner confirmation holds the public writes, including scheduled notes, reposts and profile updates, until `owner.confirm_publication` or `owner.decline_publication`. `publication.release_due` has an empty payload and is the only release path. Reach is computed at read time. The evidence helper writes `urn:pale:public-speech-evidence:1`. Fixture (a) at `apps/postyard/examples/task-data/rejected-pr/` is the seed for task #74. Fixture (b) is `apps/postyard/examples/task-data/embargo/`.

Head `4bfdb3a9620b0e2993761683f2b0981183a33733`. Package sha256 `5bd91b61190b3bbca6370bc73e01d53a56ca5897e7e649db27f6370838f8ddfd`.

**Dependencies / questions (optional):** No runtime connection to another App. Forkyard (#88) is an evidence-join partner through `apps/postyard/examples/recorded/forkyard-evidence.json`. The recorded sample is Forkyard `e9fe739b0b6af11d3805756a4916c028cf41bb4e`. The native join pin is `80417c59460dff88d383f9e2cc5da14186ef6ef5`. The schema copy matches blob `0a8eb61ab15c3d3aaec1f687c1cc2bb93ac82053`. At the recorded sample, a native `ac-0001` document produces no `linked_post` subject, and rewriting the actor to `fy-tomasreyes` produces `person-ingrid`. At the native join pin, both documents join. `linked_post` names the person in the post. The companion revision keeps `person_id` `person-tomas`. Task #74 needs no actor rewrite. Postyard keeps `ac-0001`, the stable post id, the slug, the canonical URL and `person_id` `person-tomas`. The byte-for-byte schema comparison waits until Forkyard merges. First consumer: task #74. Task #119 can grade the single receipt `pr-0007` from the release-note example.

## Progress and evidence

- [x] Proposal ready for design review
- [x] Plan approved by maintainer
- [x] Implementation complete
- [x] Validation evidence attached

The optional read-only reviewer renderer stays a declared placeholder. Evidence is `apps/postyard/contribution/evidence.md`.

### Implementation progress

Built under `apps/postyard/`:

- `app.json`, `package.json`, `service.cjs`, `plugin.cjs`, `tools.json` (28 `postyard.*` tools)
- `src/common.cjs`, `src/store.cjs`, `src/subjects.cjs`, `src/operations.cjs`, `src/events.cjs`, `src/model.cjs`, `src/images.cjs`
- `schemas/` including the public-speech evidence schema
- `evaluator/export.cjs`
- `fixtures/` smoke seed, `examples/task-data/rejected-pr/` fixture (a), `examples/task-data/embargo/` fixture (b), `examples/dataset/later-2026/`
- `examples/recorded/forkyard-evidence.json` and `PROVENANCE.md`
- `tests/business.test.cjs`, `tests/scope.test.cjs`, `tests/runtime.test.cjs` (host suite), `tests/harness.cjs`
- `scripts/build-fixtures.cjs`, `scripts/coverage.cjs`, `scripts/check-forkyard-join.cjs`
- `contribution/evidence.md`, `contribution/coverage.json`, `contribution/REMAINING.md`
- `README.md` for task authors

### How to run and verify

```sh
npm test --prefix apps/postyard
node --test apps/postyard/tests/runtime.test.cjs
node apps/postyard/examples/run.cjs
node apps/postyard/scripts/coverage.cjs --output /tmp/postyard-coverage.json
npm run app:verify -- --app apps/postyard --output .artifacts/postyard-verify.json
node --test runtime/tests/clock.test.cjs
npm test
```

Observed: Node v18.20.8, v22.23.5, v22.23.4, and v24.22.3 each passed the 47-test package suite. `tests/business.test.cjs` is 16 of those tests. The host suite passed 2 tests on each version. An earlier checkout of the previous head reported a 46-test package suite and the 2-test host suite on v24.22.1. `examples/run.cjs` printed `{"app":"postyard","notes":1,"id":"ac-0007:n1"}`. `app:verify` passed 43 checks on each version (runtime 1.6.0, Core API 1.2.0), `package_sha256` `5bd91b61190b3bbca6370bc73e01d53a56ca5897e7e649db27f6370838f8ddfd`. The clock test passed 7 tests, including the eight-app check. The repository suite passed 22 stages. Coverage counted 121 included rows, 95 Los Angeles dates, `excluded_count` 2, and no empty month from 2025-01 through 2026-12.

### Reviewer items

- Predicted ids and `only_pending` are in the README Identifiers section, with the `ac-0001:p12` to `ac-0001:p13` example. Confirmation accepts `only_pending` or `object_id` plus `revision`, and rejects a mix.
- A non-owner read returns published revisions and public fields. A declined correction does not become the source of the next edit.
- Events that point at records the Agent creates: ids are `<account_id>:p<n>` and `<account_id>:n<n>`, serials are canonical decimals, and only committed creations take a number. Core audit deny rows are asserted in `tests/runtime.test.cjs`.
- Owner confirmation follows the workflow 4 table, including `postyard.notes.schedule`, `postyard.notes.repost` and `postyard.profile.update_self`.
- Package tests read files under `apps/postyard/` only. The host suite is `tests/runtime.test.cjs`.
- Replaying a `request_id`, or repeating `publication.release_due` with the same event id, does not add a second receipt. A confirmation replay returns the original receipt with `duplicate: true`.
- Reach stays at 2300 after unpublish in the 11:00 to 11:40 example (2,100 followers, rate 300). A repost removed after unpublish does not change that frozen figure.
- The subject index matches a complete handle and a URL by handle and object together. A public correction note and a reply target are present on the exported rows. `https://postyard.example/@tomasreyes/ingrid` exports no subject.
- A same-request retry of one publication target exports `committed` and keeps the earlier `deny_count`. A retry that names a different target keeps a separate row.
- The smoke fixture, fixture (a), fixture (b), and the later-2026 seed share the 32 by 24 cover `cover-checksum`. They contain no avatar and no note image. A task adds those bytes to its own seed.
- `publication.release_due` keeps an empty payload. `env.advance_time` calls no App handler. Between `publish_at` and the release, reads show `due: true`.
- `urn:pale:public-speech-evidence:1` stays inside the package. The repository-level schema comparison waits for Forkyard.

### Dataset coverage

This follows the evidence policy adopted on 2026-11-25. Evaluation records cover 2025-01-01 through 2026-12-31 in `America/Los_Angeles`, all synthetic, reported by `scripts/coverage.cjs`. Fixture (a) is the pre-session history for a February 2026 clock. Fixture (b) is the embargo sample. The later partition is a separate seed and loads at its own December clock. The smoke fixture stays small. `follower_count` 2100 is the audience used for reach. 40 of those followers are materialized accounts. Ship's goads are read with `postyard.people.posts` and handle `shipfast99`.

### Files changed outside the App

- `apps.registry.json`: register `postyard` 1.0.0 so the shared runtime can launch it.
- `runtime/tests/clock.test.cjs`: the registry clock test counts packages. It expects eight apps.
- `runtime/registrations/postyard.json`: parent reads for posts and notes, so a ready cover can be listed and read. No `runtime/core`, `runtime/web`, docs, or other App was edited for this delivery.

### Downstream tasks

Task #74 loads `apps/postyard/examples/task-data/rejected-pr/` with `virtual_now` `2026-02-09T20:40:00-08:00`. Start Infra with `--initial-profile sandbox` when the task writes. Account `ac-0001` (`tomasreyes`, `person-tomas`) has posts `p1` through `p12`, notes through `n40`, and 2,100 followers. Ingrid is `ac-0002` / `person-ingrid`. Ship is `ac-0007` / `person-ship`. The next ids are `ac-0001:p13` and `ac-0001:n41`. F1, F2 and F4 read `revisions` and `subjects`. D1 reads `attention` from `postyard.people.get`, `postyard.people.search` and `postyard.people.posts`. Ship's three goads are on `postyard.people.posts` with handle `shipfast99`.

### Known limits

The optional renderer remains a declared placeholder. No business GUI. No Mail delivery. The Forkyard reverse join stays pinned, as described above. Forkyard is not modified.
