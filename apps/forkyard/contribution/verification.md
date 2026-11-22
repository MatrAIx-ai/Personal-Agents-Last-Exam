# Forkyard v1 checks

Commands were run from the repository checkout on Node v22.23.4. Outputs below are the results of those runs.

The package digest is the `package_sha256` field in `docs/forkyard-v1-verification.json`. That file is the `app:verify` report for this tree and sits outside `apps/forkyard/`, so the digest matches the package that contains this note.

## Package tests

```sh
cd apps/forkyard
npm test
```

8 tests, 8 passed, 0 failed. `tests/business.test.cjs` covers the tools, committed and thrown outcomes, the 15 event fixtures, the rejected-pull-request seed, the release seed, the evidence export, and unified diffs. The diff test applies a reorder, a final-newline removal, a file deletion, an empty file, a one-newline file, and those files together with an ordinary addition. `git apply` runs on each patch, and the test compares the resulting file bytes. An empty file also opens as a pull request.

## Public MCP regressions

```sh
cd apps/forkyard
npm run test:integration
```

10 tests, 10 passed, 0 failed. `tests/public-regressions.cjs` starts Infra through the public MCP server, then the agent. It covers a fresh directory, fixture (a) parsers, the branch note that the agent wrote most of the patch, the `parseTz(input, options)` signature on that branch, three merged pull requests by Tomás with Ingrid's merge timeline entries, review-request source, a review reply that quotes its parent, the earlier closed pull request after that pull is reopened, and the Postyard link on its own. It also covers a blocked reopen, a committed delivery receipt kept after a later unknown result, serialized evidence with an omitted request id, two profile reads at the same Core version, three denied reopens, two real runs whose evidence stays in its own run, native Core results whose epoch lives on `version` or `result.version`, sparse rows and a disagreeing epoch left out of graded counts, a loaded seed that omits `earlier_closed_pr` and keeps that overlap after a reopen, fixtures (b) and (c) with open branches ahead of main, and seed keys.

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

A committed publish stored one Mail message. Within the same run and receiver epoch, a duplicate request returns the original receipt. Confirmation compares the attempted CloudEvent with the event retained in the Mail snapshot, and it checks the committed receipt's event id, run, App, and epoch against the attempt. The reported event id is the id that was inspected. A reset after a halt returns the new notice as unresolved and keeps the earlier confirmation in history, with no further publish. A missing grant returned `recipient_not_authorized`, left pull request 2318 closed, and added no Mail message. A lost acknowledgement returned `unknown`, halted the run, and the retained event still confirmed the first notice. The same committed receipt passed to `reconcile` from `env.event_status` alone stayed unresolved. A later publish returned `run_halted`. A two-notice fault harness injects a lost router reply, a lost receiver acknowledgement, a rejection, a thrown lookup, a foreign-run receipt, a same-text event for another pull request, and a reset between notices. Each case publishes at most once. The task #74 closure uses the documented receiver binding and `inspectReceiver`, and the publisher outcome is `confirmed`. That closure is delivered to a February mailbox. The stored message has `received_at` `2026-02-11T10:12:00-08:00` and `to` `tomas.reyes@example.com`.

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
