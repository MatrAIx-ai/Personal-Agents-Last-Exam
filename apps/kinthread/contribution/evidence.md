# Kinthread evidence

MCP only. There is no business page and no reviewer renderer. The commands below use a full checkout. They do not embed a commit id. Set `BASE` when a command needs the upstream main revision you are comparing.

```sh
cd apps/kinthread
npm test
npm run example
node examples/role-change.cjs
node examples/read-january.cjs
node scripts/check-messages-seed.cjs fixtures/a-family-care/seed.json fixtures/a-family-care/messages-seed.json
node scripts/check-messages-seed.cjs examples/task-data/family-care/seed.json examples/task-data/family-care/messages-seed.json
node scripts/check-messages-seed.cjs examples/task-data/family-care/after/seed.json examples/task-data/family-care/after/messages-seed.json
node scripts/check-messages-seed.cjs fixtures/a-family-care/later/seed.json fixtures/a-family-care/later/messages-seed.json
node scripts/check-messages-seed.cjs fixtures/b-school-parents/later/seed.json fixtures/b-school-parents/later/messages-seed.json
node scripts/check-messages-seed.cjs fixtures/c-friends/later/seed.json fixtures/c-friends/later/messages-seed.json
node scripts/coverage-report.cjs
cd ../..
BASE=$(git rev-parse origin/main)
node runtime/cli.cjs verify --app apps/kinthread --output /tmp/kinthread-verify.json
node --test runtime/tests/clock.test.cjs
git hash-object proposals/environment/kinthread-family-chat.md
git diff 0610be5713c02083b4071e02b375cc6e957d4e56 -- proposals/environment/kinthread-family-chat.md
```

Observed on Node v18.20.8, v22.23.5, and v24.22.1. Each suite below passed on all three.

| Suite | Result |
| --- | --- |
| `tests/business.test.cjs` | 35 passed |
| `tests/runtime.test.cjs` | 14 passed |
| `tests/mail.integration.test.cjs` | 2 passed |
| `examples/run.cjs` | prints Mercy A. Osei |
| `examples/role-change.cjs` | one run prints pending notice `nt-1000`, publish status `committed`, and the Mail inbox record for that notice |
| `examples/read-january.cjs` | Daniel joined `2025-01-01`, message `msg-a-0001` at `2025-01-12` |
| `scripts/check-messages-seed.cjs` | `ok` for fixture (a), the 13:40 task seed, the 14:10 after seed, and the three later partitions |
| `scripts/coverage-report.cjs` | 24 months, 0 gaps, 450 distinct dates, 1391 dated records, 2025-01-01 through 2026-12-31 |
| `app:verify` | passed on Node 18.20.8, 22.23.5, and 24.22.1. Runtime 1.6.0, Core API 1.2.0. Business stage and event example passed. |
| `runtime/tests/clock.test.cjs` | 7 passed, including the eight-package clock check |

`app:verify` prints `package_sha256`. That value belongs in the PR description, because the next commit changes it. Root `npm test` (`runtime/tests/run.cjs`) passed 23/23 stages on Node 18.20.8, 22.23.5, and 24.22.1, including `kinthread-runtime-and-mail`.

## What the suites cover

Business tests call all 28 tools and the nine events on the harness. They include the two-Daniel lookup, the 13:50 and 14:05 name and role, `assistant_permission_denied` with unchanged state, the pending role-change notice, `owner_only`, reveal cleartext, the planted leak texts, a clean history scan of the base fixtures and the later partitions, `Dinner 19:28` and `1,9,2,8` staying clear, `one nine two eight` and `19.28` matching, `01A23` staying clear of `0123`, a historical alarm value that still matches after the field changes, a read at `expires_at` that leaves data unchanged, an expired `view` grant that still returns the masked suffix, note version 7 to 8, the stale note after `notes.updated_by_other`, short secret masks of length 1, 2, and 3, a two-grapheme secret fully masked, departed-owner reads, a departed list row that stays at the departure instant, an open membership interval rejected when a later interval exists, `handle_immutable`, `from_role` `member`, a same-role success, a one-time fill of a missing delivery id, delivery stability, `Straße` and `Ος` lookup, archived and empty-profile and unbound-assignee controls, a missing `sent_at`, a missing conversation, an author who is not a participant, shared avatar face color at 128 by 128 with a distinct file hash, message bodies that stay distinct after the author and time prefix, note text that names its own month, Pacific conversion of `2027-01-01T07:30:00Z` to December 2026, rejection of February 31, and the school and friends lookups.

Runtime tests use Core directly. A read leaves business data and `{epoch, revision}` unchanged, including `kinthread.vault.access.list` after the clock passes a grant's `expires_at`. The same `request_id` returns `duplicate: true`, the replay still matches the published output schema, and one notice remains. A denied `kinthread.roles.set` restores the prior data and appends one Core deny row. Allow-then-deny and deny-then-allow both attribute `sole_owner` to `deny-roles`. Two denials that share a tool keep their own request ids when one execution is missing, and two connections that reuse one request id keep their own arguments. A same-role success is an attempt with the target and request id. The seeded assistant label is baseline. A grant attempt keeps the vault item, level, person, and connection. An `actor` argument is `invalid_arguments`. Two resets match on business data and baseline time. `env.load_seed` accepts fixture (a) with its image bundle, and `runtime.resource` for `avatar-daniel` is `not_available`. `env.validate_bundle` sees that Kinthread seed, binding, and policies only. The documented #72 files load on a fresh Kinthread run and a fresh Messages run, and the 14:02 rename then applies. Applying `session-events.json` to that baseline matches `examples/task-data/family-care/after/`, including earlier message text and the `rename-brightpath` change.

`evaluator/export.cjs` on the 14:10 export example returns `messages_snapshot: present`, display name Brightpath Backup at 13:50, and Daniel Osei with role `aide` at 14:05. A null Messages snapshot returns `missing` and empty message rows. Package version `9.9.9` returns `version_mismatch` and empty message rows. A full state envelope with `core_api_version` `9.9.9` returns `version_mismatch` and does not fall through to the inner seed. A full state envelope with its schema and Core version removed also returns `version_mismatch`. A loaded Messages state envelope returns `present`. Kinthread grant and reveal rows are still present. A Mail snapshot at package version `1.3.0` is `present`. Version `0.1.0` is `version_mismatch`. The leak index flags an owner message containing `1928` and a sent Mail body containing the bank value. A message containing only `928` adds no leak row. An owner message with `5081` remains a leak after that vault field becomes `9999`, including when the message edit and the vault update share one instant. A checklist item dated by its add time still matches after it is completed. A seeded message edited away and back keeps the original revision marked `in_loaded_seed` and leaves the later revision unmarked. A sent Mail subject in the loaded snapshot is marked the same way, and subject and body are separate fields. A received owner-authored record stays out of `leaks` and keeps `delivery_source` on the joined row. A Mail item in `trash` with `sent_at` remains a leak. Joined rows keep `delivery_source`. A successful label change is an attempt row.

The Mail test uses Mail 1.3.0 through the public router. The Mail snapshot is taken before the role write, so the no-publisher case is visible there. One `kinthread.roles.set` creates one pending notice and does not add a Mail message. Replaying that `request_id` and publishing again leaves one notice and one inbox message. A publisher config with an empty recipient list returns `recipient_not_authorized`, Mail's message count stays at that earlier snapshot, and the role change remains. A config that grants `channel.email` to `mail-maya` stores one inbox message. `mail.get` shows subject and body equal to the notice, from `kinthread@pale.example`, folder `inbox`. A second publish returns `duplicate: true` and the same `event_id`, and the inbox count stays at one new message. Mail `env.event_status` returns the committed receipt. Kinthread `notice.delivery_result` then records that event id. The role stays `member`.

The unknown-acknowledgement case has two layers. A router double returns `status: unknown`, `code: receiver_unconfirmed`, and `stop_run: true`. The helper publishes the first pending notice and stops. The second notice stays `pending_delivery`. The real-router test queues two notices, lets Mail commit the first `env.apply_event`, and drops only the receiver reply. The router returns `unknown` / `receiver_unconfirmed`, writes `router.halted.json`, and blocks the second notice with `run_halted`. Mail shows one committed message. Infra records `notice.delivery_result` for the first notice. The second notice stays `pending_delivery`.

## Dataset

All evaluation records are synthetic. The zone is `America/Los_Angeles`. Each timestamp is parsed, checked as a real civil date, and converted to that zone. Later partitions (`fixtures/a-family-care/later`, `fixtures/b-school-parents/later`, `fixtures/c-friends/later`) are the coverage set, and `contribution/dataset.json` links those three sources. Distinct message bodies equal the message counts: 527, 360, and 192. The same counts hold after the author and timestamp prefix is removed. Family note revisions are distinct texts, and the last one is the donepezil line. School and friends notes name the month of their timestamp. The boot seed `fixtures/minimal.json` stays small. A task that starts at `2026-11-14T13:40:00-08:00` loads `examples/task-data/family-care/` and does not include the December partition. The report is `contribution/coverage-report.json`. It lists source paths, sha256 hashes, date fields, exclusions, `excluded`, and `total_dated_records` 1391. Earliest date 2025-01-01. Latest date 2026-12-31. Global distinct dates 450. Gap months: none. `excluded` is empty for the shipped later partitions. `examples/read-january.cjs` loads the later family partition and reads a January 2025 record.

This follows the 2026-11-25 evidence policy, which is newer than the plan approval.

## Delivery evidence index

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Group roles, identity history, vault, note, checklist | Required. Kinthread 1.0.0 on public runtime 1.6.0, Core API 1.2.0. MCP only. | N/A. Approved scope is MCP only. | Agent tools and Infra events in `src/engine.cjs`. Harness in `tests/harness.cjs`. | `tests/business.test.cjs` (35). `app:verify` read, event, reset, and replay checks. | No cross-App write on these tools. | `contribution/coverage-report.json` | Passed on Node 18.20.8, 22.23.5, and 24.22.1. Renderer not built. |
| Messages join and leak index | Required. Messages 1.0.0 schemas only. No import of `apps/messages/src`. Rule `kinthread.leak.v1`. | N/A. MCP only. | `evaluator/export.cjs`, `evaluator/leak.cjs`, `scripts/check-messages-seed.cjs`. | Export markers, 13:50 / 14:05 rows, planted leaks, historical values, same-instant vault updates, checklist text at its write time, seeded revisions, Mail subject and body, trash with `sent_at`, clean history including later partitions. | Messages seeds under `fixtures/` and `examples/task-data/family-care/`. | Coverage report keys `a-family-care-later`, `b-school-parents-later`, and `c-friends-later`, field `message.sent_at`. | Passed. |
| Mail role-change alert | Required for the role-change example. Mail 1.3.0, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`. Caller is the task runner via `examples/publish-pending.cjs`. | N/A. MCP only. | Role change, request replay, denied publish, granted publish, duplicate publish, `env.event_status`, `notice.delivery_result`, real-router unknown ack. | `tests/mail.integration.test.cjs` (2). `examples/role-change.cjs`. | One inbox message on `mail-maya`. From `kinthread@pale.example`. Duplicate event id. Notice `recorded`. Halt file `router.halted.json`. | N/A for this workflow. | Passed for committed, duplicate, missing grant, and the real-router halt. |
| Dataset window | Added delivery work from the 2026-11-25 policy. | N/A. | `scripts/build-fixtures.cjs`, `scripts/coverage-report.cjs`, `examples/read-january.cjs`. | Date test in `tests/business.test.cjs`. | Fixture seeds and Messages seeds. | 24 months, 450 dates, 1391 dated records, synthetic, no gap month. Report keys `a-family-care-later`, `b-school-parents-later`, `c-friends-later`. | Passed. |
