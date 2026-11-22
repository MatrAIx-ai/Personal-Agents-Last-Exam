# Forkyard v1 checks

Commands were run from the repository checkout on Node v22.23.4. Outputs below are the results of those runs.

The package digest is the `package_sha256` field in `docs/forkyard-v1-verification.json`. That file is the `app:verify` report for this tree and sits outside `apps/forkyard/`, so the digest matches the package that contains this note.

## Package tests

```sh
cd apps/forkyard
npm test
```

17 tests, 17 passed, 0 failed. `tests/business.test.cjs` covers the tools, committed and thrown outcomes, the 15 event fixtures, the rejected-pull-request seed, the release seed, and the evidence export. `tests/review-regressions.cjs` loads real Core snapshots for the review findings: delivery correlation, per-person pressure, search attention, receipt versions, the task #74 policy and reviewers, fixture (a) and a future-dated seed, release and block and profile checks, a divergent merge, the Postyard join, tool output fields, and parent ids on load.

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

A committed publish stored one Mail message. A duplicate request returns the stored receipt. A missing grant returned `recipient_not_authorized`, left pull request 2318 closed, and added no Mail message. A lost acknowledgement returned `unknown`. `publishPending` read Mail `env.event_status` for that event id and reported the delivery confirmed. A later publish returned `run_halted`. The same file also covers `receiver_rejected`, a missing receipt, a committed receipt for a different event, a transport error that keeps the first attempt, and the task #74 seed opened through MCP with reviewers `acc-ihalvorsen`, `acc-praman` and `acc-msolis` and one Mail message.

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
