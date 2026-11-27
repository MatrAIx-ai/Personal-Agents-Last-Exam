# Keelcard v1 evidence

Commands were run from the repository root on Node v22.23.4. Public runtime 1.6.0, Core API 1.2.0. Mail used by the integration tests is the packaged Mail 1.3.0. The package hash is omitted here because this file is inside the package, so `app:verify` prints the hash of the tree that includes this report.

## Business tests and example

```sh
node --test apps/keelcard/tests/business.test.cjs
node apps/keelcard/examples/run.cjs
```

`node --test apps/keelcard/tests/business.test.cjs` passed 30 tests, 0 failed. That run includes the runtime case: replay output validates with `duplicate: true`, an empty card at a legal timestamp is denied for missing card details with the clock and business data unchanged, one of two competing authorizations is `stale_version` and the retry declines `exceeds_daily_limit`, a wrong code different from the stored code does not add a second attempt, and two resets return the same business data. A single-use capture closes the card and writes a `card_closed` notice when card-event alerts are on. A one-cent daily decline that claims 20000 cents of earlier spend, and a one-cent per-transaction decline that claims 7500 cents, both return `invalid_seed`. The publication fault harness publishes at most once for a lost router reply, a lost receiver acknowledgement, a rejection, a thrown lookup, a missing receipt log, a foreign-run receipt, a stale evidence write, and a receiver outage before an event id is assigned. The second notice stays `pending_delivery`. An inspection failure remains in the per-notice report, and a later call confirms it from the saved receiver id. A stale halt write is repeated until the following read shows the halt, a file-only halt is stored before a publish decision, and a reused snapshot reports `persisted` from the Core receipt.

The copied package used by `app:verify` skips that runtime case because the runtime directory is outside the copy. In that copy the file passed 29 tests and skipped 1. The two added cases check the coverage counts for the 2025-26 window and the three reviewer views.

`node apps/keelcard/examples/run.cjs` printed:

```json
{"app":"keelcard","authorizations":63,"added":"auth-0001","hold_cents":2500,"balance_cents":441170}
```

## Integration tests

`app:verify` does not run the Mail, merchant, MCP or December files. They need the public runtime beside the package. The package script runs them together:

```sh
npm --prefix apps/keelcard run test:checkout
```

That command is `node --test tests/mail-integration.cjs tests/merchant-receive.cjs tests/mcp-regression.cjs tests/december-window.cjs` from `apps/keelcard`. It passed 37 tests, 0 failed: 4 Mail, 7 merchant contract, 21 MCP, and 5 December window. One December test loads fixture (b), applies `examples/events/freelancer-2026-12.json` with `env.advance_time` and `env.apply_event`, and checks that the statements end at `stmt-2026-12`. The others check that a one-cent over-capture fails and keeps the denial in the audit, that dropping only the settle fails, that a duplicate receipt and a reused authorization payload fail, and that a denied list read fails. The loaded snapshot keeps the partition source from `contribution/dataset.json`.

The task session is also started on its own:

```sh
node apps/keelcard/examples/task-session.cjs
```

This run printed:

```json
{"card_limit":7500,"reveal_status":"permission_denied","decline_code":"exceeds_transaction_limit","hold_cents":0,"opened":"committed","mail_ids_match":true,"mail_clock":"2026-11-20T06:14:00-05:00","keelcard_clock":"2026-11-20T06:14:00-05:00","notices_committed":true,"confirmed":"applied","second_opened":"committed","rejection":"rejected","rejection_code":"recipient_not_authorized","rejection_cloud_id":"keelcard-kc-adeyemi-notice-cr-0001-code-c769095b","rejection_publish_id":"notice-notice-cr-0001-code-c769095b","rejection_ids_unchanged":true,"lost_ack":"confirmed","lost_status":"committed","second_send":0}
```

The token inside `notice_id` is chosen when the notice is created, so a later run prints a different token. The CloudEvents id is `keelcard-<account_id>-<notice_id>` and the publish request id is `notice-<notice_id>`. The session loads `examples/task-data/policies.json` through Infra `env.load_seed`, reads the grocery card and the $124.38 decline through the Agent, and binds Mail to person-grace on `mail-maya`. Both App clocks are `2026-11-20T06:14:00-05:00` at delivery. The confirmation code is the code in the Mail message. The delivery payload stores the Mail event id, and reopening both Apps confirms it with Mail `env.event_status`. The empty-grant route uses a real router whose recipient list is empty. It returns `recipient_not_authorized`, keeps the original publication ids, and stores no new Mail message. The acknowledgement-loss route uses a real router. After Mail commits the message, the receiver process exits before the router reads the reply. The notice is then confirmed from Mail, the saved event id matches `env.event_status`, and the next publish sends nothing.

The MCP file also covers these cases:

- Clock advance to 1 December 2026: `env.snapshot`, `keelcard.cards.list`, `ledger.settle_due` and `env.reset` all succeed. Settlement writes `stmt-2026-11`.
- Fixture (c) loaded at its own clock stays readable at the owner deadline. `loadSeed` in `src/load-seed.cjs` rejects the owner deadline and 1 December before it calls `env.load_seed`. A raw `env.load_seed` of the household at 1 December still returns `ready` on stock runtime 1.6.0, because Core sets the virtual clock before the App validates the seed. A load through `loadSeed` at the seed's `initial_clock`, followed by `env.advance_time`, still serves `keelcard.cards.list`. Stock runtime 1.6.0 is unchanged.
- A `cr-0001` request that is already due at load returns `invalid_seed`. A capture dated before its authorization returns `invalid_seed`. A 1-cent daily decline with no supporting spend returns `invalid_seed`.
- Two calls that share one request id are two logical rejections because the targets differ: `first-card` is `not_found` and `second-card` is `stale_version`. Two `keelcard.controls.confirm_change` denials that share one request id and name `cr-201` and `cr-202` are also two logical rejections. A trace that contains only the second of those executions stays ambiguous and is not paired with the first audit row. Two calls that cannot be ordered are reported as ambiguous, and each call keeps its own arguments. The replayed success is not paired with a denial. `missing-one` keeps both denials. `missing-two` keeps its own denial. Two stale `keelcard.controls.request_change` calls, one supplying revision 0 and one supplying an older epoch, each pair with the audit row whose `input.expected_version` is the version that call supplied. An execution from another run does not consume those rows.
- An owner decision of `approve` at the email-code deadline returns `invalid_event` and leaves the request `pending_verification`. A rejected delivery without a publish request id does the same and leaves the business data unchanged.
- The decline-alert email body says `turning off declines alerts`. Turning off code alerts in `email_code` mode returns `invalid_arguments` and does not open a request.
- An inspection that throws returns `unresolved`, with Mail unconfirmed and the Keelcard write persisted. Infra records `unknown`. A later confirmation of that same receiver id uses a different Core event id, the notice becomes `committed`, and an identical retry of the first event id is `duplicate`. The other pending notice is not sent.
- A reversal at the same instant as a daily decline commits, and the decline still records 6000 cents in force. A following $1 authorization at that same instant commits. A partial capture of 1000 cents at that same instant also commits, the decline row remains, and its following $1 authorization commits. The stored decision-time spend is the value the historical check uses.
- Closing the delegate card at the owner deadline records the open request as `expired`.
- Resetting Keelcard and leaving Mail in place gives the next notice a new publication id. Both Mail messages are present.
- After Mail has committed and the evidence write returns `stale_version`, the run is halted. A later call writes the evidence and does not call `router.publish`. A response dropped after the router wrote its receipt log is recovered with the receiver event id, and the run stays halted. A thrown publish with no receipt log stores `unknown` and a null receiver id, and the next call does not publish. The halt is stored with `publication.halt` on the Keelcard snapshot before inspection. A fresh snapshot keeps it when the caller omits the receipt-log path. On that path a lost reply leaves one Mail message, and a later call sends nothing. A receiver halt leaves the other notice `pending_delivery` when the later call also omits the path. Supplying the log afterward confirms the first notice from Mail. A committed receipt whose Mail evidence names a different event id stays unresolved. A receipt log row whose publish request id and CloudEvents id name different notices matches neither notice. A `publication.halt` write that meets a concurrent `env.advance_time` returns `stale_version` once, then the publisher repeats it against the current version and reads the halt back from Core. The fresh snapshot sends nothing. Mail stays at one message on the lost-reply route, and the other notice stays `pending_delivery` on the receiver-halted route. A halt that exists only in `keelcard-publication.json` is written to Core before a publish decision. When that write stays `stale_version`, the call returns stopped and the router is not called. `persisted` is reported after a Core receipt in this call, or after a Core read in this call shows `recorded_at`. Reusing the in-memory snapshot with a writer stores both notices, and a saved confirmation one virtual minute later adds no further Core write.
- On unmodified fixture (a), a $70 authorization, a $65 capture, another $70 authorization, and a $70 request at the same instant commit `exceeds_daily_limit` with 13500 cents in force. The opposite order, decline then partial capture, keeps the original decision-time spend, and the following $1 authorization commits. The same two orders commit for the monthly and lifetime windows.

### Mail (real package)

Mail 1.3.0 through the real Messaging router. 4 passed. The shipped grant delivers a decline and a code. Each Mail message id equals the Messaging `event_id`. After `receiver_rejected`, a later `publishPending` sends nothing. An empty grant returns `recipient_not_authorized` and leaves the request in place.

### Merchant contract test (stub sender)

`examples/test-merchant/` is a stub publisher registered as `app_id: freshcart`. It sends through the real Messaging router into Keelcard's receive contract. FreshCart (#37) itself is not used, and this is not a live merchant integration. 7 passed. The publisher and receiver schema bytes match. A granted publish commits one authorization, and lookup omits the card number and security code. A key containing a space is rejected before dispatch and does not halt the run. An empty card object is rejected before dispatch, the router stays usable, and a following complete card commits. The case that leaves only `keelcard.authorizations.lookup` on the scenario policy is an instance-policy test.

### Infra merchant-event simulation

`env.apply_event` with `authorization.request` is used by `examples/task-session.cjs` and by `examples/scenario.json`. This simulates a merchant event from Infra. It is not counted as a merchant integration. The December window test above is the same kind of Infra event, applied to fixture (b) after `env.advance_time`.

## Dataset coverage

The counts, monthly tables, statement windows, exclusions and the load query are in `contribution/coverage.md`. Recount with:

```sh
node apps/keelcard/examples/coverage-report.cjs
node apps/keelcard/examples/coverage-report.cjs --load
```

Seeds alone have 424 distinct dates from 2025-01-01 to 2026-11-18. Seeds plus the December staged events have 442 distinct dates and cover 24 of 24 months. After those events, `keelcard.transactions.list` returns 531, `keelcard.declines.list` returns 38, and the last statements are `stmt-2026-10`, `stmt-2026-11` and `stmt-2026-12`.

## Reviewer renderer

`gui/src/view.js` renders escaped, read-only views for human reviewers. It has no controls and is not an interactive GUI. The approved plan lists only this optional read-only renderer, so no GUI is claimed. Agents use the MCP tools. The views are `renderCardList`, `renderCardDetail` and `renderTransactions`. `render` remains for compatibility. A business test checks escaping and checks that a full card number and a security code stay out of every view. The transaction status cell uses `effective_status` when the list provides it. The same business test advances an authorization past its seven-day expiry and, before settlement, checks that the view shows expired.

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
