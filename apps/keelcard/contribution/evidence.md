# Keelcard v1 evidence

Commands were run from the repository root on Node v22.23.4. Public runtime 1.6.0, Core API 1.2.0. Mail used by the integration tests is the packaged Mail 1.3.0. The package hash is omitted here because this file is inside the package, so `app:verify` prints the hash of the tree that includes this report.

## Business tests and example

```sh
node --test apps/keelcard/tests/business.test.cjs
node apps/keelcard/examples/run.cjs
```

`node --test apps/keelcard/tests/business.test.cjs` passed 23 tests, 0 failed. That run includes the runtime case: replay output validates with `duplicate: true`, an empty card at a legal timestamp is denied for missing card details with the clock and business data unchanged, one of two competing authorizations is `stale_version` and the retry declines `exceeds_daily_limit`, a wrong code different from the stored code does not add a second attempt, and two resets return the same business data. A single-use capture closes the card and writes a `card_closed` notice when card-event alerts are on.

The copied package used by `app:verify` skips that runtime case because the runtime directory is outside the copy. In that copy the file passed 22 tests and skipped 1.

`node apps/keelcard/examples/run.cjs` printed:

```json
{"app":"keelcard","authorizations":63,"added":"auth-0001","hold_cents":2500,"balance_cents":441170}
```

## Checkout integration

`app:verify` does not run the Mail, merchant or MCP files. They need the public runtime beside the package. The package script runs them together:

```sh
npm --prefix apps/keelcard run test:checkout
```

That command is `node --test tests/mail-integration.cjs tests/merchant-receive.cjs tests/mcp-regression.cjs` from `apps/keelcard`. It passed 22 tests, 0 failed: 4 Mail, 6 merchant and 12 MCP.

The task session is also started on its own:

```sh
node apps/keelcard/examples/task-session.cjs
```

This run printed:

```json
{"card_limit":7500,"reveal_status":"permission_denied","decline_code":"exceeds_transaction_limit","hold_cents":0,"opened":"committed","mail_ids_match":true,"mail_clock":"2026-11-20T06:14:00-05:00","keelcard_clock":"2026-11-20T06:14:00-05:00","notices_committed":true,"confirmed":"applied","second_opened":"committed","rejection":"rejected","rejection_code":"recipient_not_authorized","rejection_cloud_id":"keelcard-kc-adeyemi-notice-0002-b1676099","rejection_publish_id":"pub-notice-0002-b1676099","rejection_ids_unchanged":true,"lost_ack":"confirmed","lost_status":"committed","second_send":0}
```

The publication suffix is chosen when the notice is created, so a later run prints a different suffix. The session loads `examples/task-data/policies.json` through Infra `env.load_seed`, reads the grocery card and the $124.38 decline through the Agent, and binds Mail to person-grace on `mail-maya`. Both App clocks are `2026-11-20T06:14:00-05:00` at delivery. The confirmation code is the code in the Mail message. The rejection keeps the original publication ids and returns `recipient_not_authorized`. The lost acknowledgement is confirmed from Mail, the notice is `committed`, and the next publish sends nothing.

The MCP file also covers these cases:

- Clock advance to 1 December 2026: `env.snapshot`, `keelcard.cards.list`, `ledger.settle_due` and `env.reset` all succeed. Settlement writes `stmt-2026-11`.
- Fixture (c) loaded at its own clock stays readable at the owner deadline. A load of that fixture at the deadline, and a load of the household seed on 1 December, both return `invalid_seed`. After a load at the declared clock, a later `env.advance_time` still serves `keelcard.cards.list`.
- A `cr-0001` request that is already due at load returns `invalid_seed`. A capture dated before its authorization returns `invalid_seed`. A 1-cent daily decline with no supporting spend returns `invalid_seed`.
- Two calls that share one request id keep their own targets and reasons: `first-card` is `not_found` and `second-card` is `stale_version`. Two calls that cannot be ordered are reported as ambiguous, and each call keeps its own arguments. The replayed success is not paired with a denial. `missing-one` keeps both denials. `missing-two` keeps its own denial.
- An owner decision of `approve` at the email-code deadline returns `invalid_event` and leaves the request `pending_verification`. A rejected delivery without a publish request id does the same and leaves the business data unchanged.
- The decline-alert email body says `turning off declines alerts`. Turning off code alerts in `email_code` mode returns `invalid_arguments` and does not open a request.
- An inspection that throws returns `unresolved`. Infra records `unknown` for that notice. The other pending notice is not sent.
- A reversal at the same instant as a daily decline commits, and the decline still records 6000 cents in force. A partial capture of 1000 cents at that same instant also commits, and the decline row remains.
- Closing the delegate card at the owner deadline records the open request as `expired`.
- Resetting Keelcard and leaving Mail in place gives the next notice a new publication id. Both Mail messages are present.
- After Mail has committed and the evidence write returns `stale_version`, a later call inspects Mail again, writes the same evidence, and does not publish the next notice. A response dropped after the router wrote its receipt log is recovered with the receiver event id, and the following publish sends nothing.

Mail: 4 passed. The shipped grant delivers a decline and a code. Each Mail message id equals the Messaging `event_id`. After `receiver_rejected`, a later `publishPending` sends nothing.

Merchant receive: 6 passed. The publisher and receiver schema bytes match. A granted publish commits one authorization, and lookup omits the card number and security code. A key containing a space is rejected before dispatch and does not halt the run. The case that leaves only `keelcard.authorizations.lookup` on the scenario policy is an instance-policy test. Infra `authorization.request` is the delivered path and still commits. An empty grant returns `recipient_not_authorized` and leaves the revision unchanged.

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
