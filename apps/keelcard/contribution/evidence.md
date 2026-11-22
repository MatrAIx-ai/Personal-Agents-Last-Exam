# Keelcard v1 evidence

Commands were run from the repository root on Node v22.23.4. Public runtime 1.6.0, Core API 1.2.0. Mail used by the integration tests is the packaged Mail 1.3.0. The package hash is omitted here because this file is inside the package, so `app:verify` prints the hash of the tree that includes this report.

## Business tests and example

```sh
node --test apps/keelcard/tests/business.test.cjs
node apps/keelcard/examples/run.cjs
```

`node --test apps/keelcard/tests/business.test.cjs` passed 23 tests, 0 failed. That run includes the runtime case: replay output validates with `duplicate: true`, an empty card at a legal timestamp is denied for missing card details with the clock and business data unchanged, one of two competing authorizations is `stale_version` and the retry declines `exceeds_daily_limit`, a wrong code different from the stored code does not add a second attempt, and two resets return the same business data.

The copied package used by `app:verify` skips that runtime case because the runtime directory is outside the copy. In that copy the file passed 22 tests and skipped 1.

`node apps/keelcard/examples/run.cjs` printed:

```json
{"app":"keelcard","authorizations":63,"added":"auth-0001","hold_cents":2500,"balance_cents":441170}
```

## Public MCP path

`app:verify` does not run these files. They use `runtime/client.cjs` against the public MCP server, the same server `runtime/cli.cjs serve` starts.

```sh
node apps/keelcard/examples/task-session.cjs
node --test apps/keelcard/tests/mcp-regression.cjs apps/keelcard/tests/mail-integration.cjs apps/keelcard/tests/merchant-receive.cjs
```

`node apps/keelcard/examples/task-session.cjs` printed:

```json
{"card_limit":7500,"reveal_status":"permission_denied","decline_code":"exceeds_transaction_limit","hold_cents":0,"opened":"committed","mail_ids_match":true,"notices_committed":true,"confirmed":"applied","second_opened":"committed","lost_ack":"unresolved","lost_status":"unknown","second_send":0}
```

That session loads `examples/task-data/policies.json` through Infra `env.load_seed`, reads the grocery card and the $124.38 decline through the Agent, binds Mail to person-grace on `mail-maya`, and records a halted notice with `notice.delivery_result`. A fresh snapshot shows that notice as `unknown`, and the next publish sends nothing.

The combined file passed 16 tests, 0 failed.

- Clock advance to 1 December 2026: `env.snapshot`, `keelcard.cards.list`, `ledger.settle_due` and `env.reset` all succeed. Settlement writes `stmt-2026-11`.
- Fixture (c) at the owner deadline: the stored request stays `pending_owner`, `keelcard.controls.requests.list` reports `effective_status` `expired`, and settlement then expires it. A `cr-0001` request that is already due at load returns `invalid_seed`. A capture dated before its authorization returns `invalid_seed`. A 1-cent daily decline with no supporting spend returns `invalid_seed`.
- The evidence join uses MCP audit `input.request_id`. The replayed success is not paired with a denial. `missing-one` keeps both denials. `missing-two` keeps its own denial. Open requests with zero attempts, `limits_in_force`, and the confirmation request id are in the export.
- An owner decision of `approve` at the email-code deadline returns `invalid_event`, leaves the request `pending_verification`, and adds a Core deny row. A rejected delivery without a publish request id does the same and leaves the business data unchanged.
- The decline-alert email body says `turning off declines alerts`. Turning off code alerts in `email_code` mode returns `invalid_arguments` and does not open a request.
- An inspection that throws returns `unresolved`. Infra records `unknown` for that notice. The other pending notice is not sent.
- A 101-character authorization key is `invalid_arguments` and does not halt. A 100-character key commits. A host limited to `keelcard.authorizations.lookup` is denied `keelcard.cards.list`. Infra `authorization.request` still commits.

Mail: 4 passed. The shipped grant delivers a decline and a code. Each Mail message id equals the Messaging `event_id`. After `receiver_rejected`, a later `publishPending` sends nothing.

Merchant receive: 5 passed. The publisher and receiver schema bytes match. A granted publish commits one authorization, and lookup omits the card number and security code. An empty grant returns `recipient_not_authorized` and leaves the revision unchanged.

## App verification

```sh
node runtime/cli.cjs verify --app apps/keelcard
```

Exit 0. Report `passed: true` for app `keelcard` version `1.0.0`, runtime `1.6.0`, Core API `1.2.0`. Business and event-example stages passed. The scenario read, seed load, event commit, duplicate event, reset and a restarted MCP process all passed.

## Repository suite

```sh
node --test runtime/tests/clock.test.cjs
npm test
```

Clock tests: 7 passed, 0 failed. `npm test` (`node runtime/tests/run.cjs`): 22/22 stages passed, including contracts, clock, Mail, Calendar, personal Apps and the business web host.
