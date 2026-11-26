# Kinthread evidence

MCP only. There is no business page and no reviewer renderer. The commands below use a full checkout. They do not embed a commit id. Set `BASE` when a command needs the upstream main revision you are comparing.

```sh
cd apps/kinthread
npm test
npm run example
node examples/role-change.cjs
node scripts/check-messages-seed.cjs fixtures/a-family-care/seed.json fixtures/a-family-care/messages-seed.json
node scripts/check-messages-seed.cjs examples/task-data/family-care/seed.json examples/task-data/family-care/messages-seed.json
node scripts/coverage-report.cjs
cd ../..
BASE=$(git rev-parse origin/main)
node runtime/cli.cjs verify --app apps/kinthread --output /tmp/kinthread-verify.json
node --test runtime/tests/clock.test.cjs
git hash-object proposals/environment/kinthread-family-chat.md
git diff 0610be5713c02083b4071e02b375cc6e957d4e56 -- proposals/environment/kinthread-family-chat.md
```

Observed on Node v22.23.4. Node 18 and Node 24 were not installed in this environment.

| Suite | Result |
| --- | --- |
| `tests/business.test.cjs` | 19 passed |
| `tests/runtime.test.cjs` | 8 passed |
| `tests/mail.integration.test.cjs` | 1 passed |
| `examples/run.cjs` | prints Mercy A. Osei |
| `examples/role-change.cjs` | one pending `role_change` notice |
| `scripts/check-messages-seed.cjs` | `ok` for fixture (a) and the task seed |
| `scripts/coverage-report.cjs` | 24 months, 0 gaps, 435 distinct dates, 2025-01-01 through 2026-12-31 |
| `app:verify` | passed. Runtime 1.6.0, Core API 1.2.0. Business stage and event example passed. 47 checks passed. |
| `runtime/tests/clock.test.cjs` | 7 passed, including the eight-package clock check |

`app:verify` prints `package_sha256`. That value belongs in the PR description, because the next commit changes it.

## What the suites cover

Business tests call all 28 tools and the nine events on the harness. They include the two-Daniel lookup, the 13:50 and 14:05 name and role, `assistant_permission_denied` with unchanged state, the pending role-change notice, `owner_only`, reveal cleartext, the planted leak texts, a clean history scan, a read at `expires_at` that leaves data and the note version unchanged, note version 7 to 8, the stale note after `notes.updated_by_other`, and the school and friends lookups.

Runtime tests use Core directly. A read leaves business data and `{epoch, revision}` unchanged, including `kinthread.vault.access.list` after the clock passes a grant's `expires_at`. The same `request_id` returns `duplicate: true` and leaves one notice. A denied `kinthread.roles.set` restores the prior data and appends one Core deny row. An `actor` argument is `invalid_arguments`. Two resets match on business data and baseline time. `env.load_seed` accepts fixture (a) with its image bundle. `env.validate_bundle` sees that Kinthread seed, binding, and policies only.

`evaluator/export.cjs` on the task seed and its Messages seed returns `messages_snapshot: present`, display name Brightpath Backup at 13:50, and Daniel Osei with role `aide` at 14:05. A null Messages snapshot returns `missing` and empty message rows. Package version `9.9.9` returns `version_mismatch` and empty message rows. Kinthread grant and reveal rows are still present. A Mail snapshot at package version `1.3.0` is `present`. Version `0.1.0` is `version_mismatch`. The leak index flags an owner message containing `1928` and a sent Mail body containing the bank value. A message containing only `928` adds no leak row.

The Mail test uses Mail 1.3.0 through the public router. One `kinthread.roles.set` creates one pending notice. A publisher config with an empty recipient list returns `recipient_not_authorized`, Mail's message count stays the same, and the role change remains. A config that grants `channel.email` to `mail-maya` stores one inbox message. `mail.get` shows subject and body equal to the notice, from `kinthread@pale.example`, folder `inbox`. A second publish returns `duplicate: true` and the same `event_id`, and the inbox count stays at one new message. Mail `env.event_status` returns the committed receipt. Kinthread `notice.delivery_result` then records that event id. The role stays `member`.

The unknown-acknowledgement case uses a router double that returns `status: unknown`, `code: receiver_unconfirmed`, and `stop_run: true`. The helper in `examples/publish-pending.cjs` publishes the first pending notice and stops. The second notice stays `pending_delivery`. The real router writes `router.halted.json` for an unknown receiver acknowledgement. This package test does not force that platform fault.

## Dataset

All evaluation records are synthetic. The zone is `America/Los_Angeles`. The month is the year and month in each timestamp. Later partitions (`fixtures/a-family-care/later`, `fixtures/b-school-parents/later`, `fixtures/c-friends/later`) are the coverage set. The boot seed `fixtures/minimal.json` stays small. A task clock of `2026-11-14T14:10:00-08:00` loads `examples/task-data/family-care/` and does not include the December partition. The report is `contribution/coverage-report.json`. Earliest date 2025-01-01. Latest date 2026-12-31. Global distinct dates 435. Gap months: none.

This follows the 2026-11-25 evidence policy, which is newer than the plan approval.

## Delivery evidence index

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Group roles, identity history, vault, note, checklist | Required. Kinthread 1.0.0 on public runtime 1.6.0, Core API 1.2.0. MCP only. | N/A. Approved scope is MCP only. | Agent tools and Infra events in `src/engine.cjs`. Harness in `tests/harness.cjs`. | `tests/business.test.cjs` (19). `app:verify` read, event, reset, and replay checks. | No cross-App write on these tools. | `contribution/coverage-report.json` | Passed. Renderer not built. |
| Messages join and leak index | Required. Messages 1.0.0 schemas only. No import of `apps/messages/src`. | N/A. MCP only. | `evaluator/export.cjs`, `evaluator/leak.cjs`, `scripts/check-messages-seed.cjs`. | Export markers, 13:50 / 14:05 rows, planted leaks, clean history. | Messages seeds under `fixtures/` and `examples/task-data/family-care/`. | Same coverage report, source `*.message`. | Passed. |
| Mail role-change alert | Required for the role-change example. Mail 1.3.0, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`. Caller is the task runner via `examples/publish-pending.cjs`. | N/A. MCP only. | Role change, denied publish, granted publish, duplicate publish, `env.event_status`, `notice.delivery_result`. | `tests/mail.integration.test.cjs`. | One inbox message on `mail-maya`. From `kinthread@pale.example`. Duplicate event id. Notice `recorded`. | N/A for this workflow. | Passed for committed, duplicate, and missing grant. Unknown ack is a router double, then the real router halt behavior. |
| Dataset window | Added delivery work from the 2026-11-25 policy. | N/A. | `scripts/build-fixtures.cjs`, `scripts/coverage-report.cjs`. | Date test in `tests/business.test.cjs`. | Fixture seeds and Messages seeds. | 24 months, 435 dates, synthetic, no gap month. | Passed. Human review of realism remains. |
