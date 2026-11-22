# Forkyard v1 checks

Commands were run from the repository checkout on Node v22.23.4. Outputs below are the results of those runs.

The package digest is the `package_sha256` field in `docs/forkyard-v1-verification.json`. That file is the `app:verify` report for this tree and sits outside `apps/forkyard/`, so the digest matches the package that contains this note.

## Package tests

```sh
cd apps/forkyard
npm test
```

8 tests, 8 passed, 0 failed. `tests/business.test.cjs` covers the tools, committed and thrown outcomes, the 15 event fixtures, the rejected-pull-request seed, the release seed, the evidence export, and unified diffs. The diff test applies a reorder, a final-newline removal, and a file deletion with `git apply`, then compares the resulting file bytes.

## Public MCP regressions

```sh
cd apps/forkyard
npm run test:integration
```

8 tests, 8 passed, 0 failed. `tests/public-regressions.cjs` starts Infra through the public MCP server, then the agent. It covers a fresh directory, fixture (a) parsers, the branch note that the agent wrote most of the patch, the `parseTz(input, options)` signature on that branch, three merged pull requests by Tomás, review-request source, a review reply that quotes its parent, the earlier closed pull request after that pull is reopened, and the Postyard link on its own. It also covers a blocked reopen, a committed delivery receipt kept after a later unknown result, serialized evidence with an omitted request id, two profile reads at the same Core version, three denied reopens, fixtures (b) and (c) with open branches ahead of main, and seed keys.

## Core version, replay and reset

```sh
cd apps/forkyard
node tests/runtime.cjs
```

```json
{
  "passed": true,
  "app": "forkyard",
  "stale": "stale_version",
  "denied_rows": 3,
  "replay": true,
  "reset_epochs": [2, 3],
  "virtual_now": "2026-11-18T09:00:00-08:00"
}
```

Two resets restored the same business data and the same virtual time. The epochs were 2 and 3.

## Mail delivery

```sh
cd apps/forkyard
npm run test:mail
```

```json
{
  "passed": true,
  "committed_event_id": "router-c70963d93522c44f640f39dad689eb1f",
  "duplicate": true,
  "denied": "recipient_not_authorized",
  "unknown_event_id": "router-55f73dffd0a080b9beb5d228bd943d3b",
  "halted": "run_halted",
  "mail_messages_added": 1
}
```

A committed publish stored one Mail message. A duplicate request returns the stored receipt. A missing grant returned `recipient_not_authorized`, left pull request 2318 closed, and added no Mail message. A lost acknowledgement returned `unknown`. `publishPending` called `inspectReceiver`, which read the Mail receipt and the stored message, matched them to the outgoing CloudEvent, and reported the delivery confirmed. The same committed receipt passed to `reconcile` from `env.event_status` alone stayed unresolved. A later publish returned `run_halted`. An occupied Mail record whose id equals the router event id returned `receiver_rejected` and stayed unresolved, because the stored thread and sender disagree with the CloudEvent. A Messaging result from a different run and account stayed unresolved. A lookup that is still open is visible to a second `publishPending` for that run. The same file also covers a lookup that throws, a receipt missing run and epoch evidence, a receipt for a different account, a missing receipt, a committed receipt for a different event, a transport error that keeps the first attempt, and the task #74 closure. That closure is delivered to a February mailbox. The stored message has `received_at` `2026-02-11T10:12:00-08:00` and `to` `tomas.reyes@example.com`.

## Package verifier

```sh
npm run app:verify -- --app apps/forkyard --output docs/forkyard-v1-verification.json
```

The report is `docs/forkyard-v1-verification.json`. Business tests and `examples/run.cjs` run inside the verifier copy. Reset restores the loaded business data and advances the epoch.

## Repository suite

```sh
npm test
```

22/22 stages passed, including contracts, the shared-registry clock check, personal Apps, Mail, Calendar and Messaging.
