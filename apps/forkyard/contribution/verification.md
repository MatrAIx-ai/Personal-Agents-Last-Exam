# Forkyard v1 checks

Commands were run from the repository checkout on Node v22.23.4. Outputs below are the results of those runs.

## Package business tests

```sh
cd apps/forkyard
node --test tests/business.test.cjs
```

8 tests, 8 passed, 0 failed. The file covers every tool, committed and thrown outcomes, the 15 event fixtures, the rejected-pull-request seed, the release seed, and the evidence export.

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
node tests/mail-integration.cjs
```

```json
{
  "passed": true,
  "committed_event_id": "router-fc62170063bb2033ca0fab9ff448ad0b",
  "duplicate": true,
  "denied": "recipient_not_authorized",
  "unknown_event_id": "router-8be2839a66b7d25d33946d2b8eb978c3",
  "halted": "run_halted",
  "mail_messages_added": 1
}
```

A committed publish stored one Mail message. The same request returned `duplicate: true` and did not add a second message. A missing grant returned `recipient_not_authorized`, left pull request 2318 closed, and added no Mail message. A lost acknowledgement returned `unknown`, Mail `env.event_status` showed a committed receipt, and a later publish returned `run_halted`.

## Package verifier

```sh
npm run app:verify -- --app apps/forkyard
```

`passed: true` at `2026-11-22T05:54:12.915Z`. Package sha256 `8356424b11ff0b243df9a5f5c50b1e59c950e7226545e6a1a7674ba7916dce14`. Business tests and `examples/run.cjs` passed inside the verifier copy. Reset restored the loaded business data and advanced the epoch.

## Repository suite

```sh
npm test
```

22/22 stages passed, including contracts, the shared-registry clock check, personal Apps, Mail, Calendar and Messaging.
