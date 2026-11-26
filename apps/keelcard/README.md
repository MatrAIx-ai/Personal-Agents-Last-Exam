# Keelcard

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. Data is synthetic. See `tools.json` for exact inputs and outputs and `schemas/seed.schema.json` for records. Business logic lives in `src/`; `plugin.cjs` exports the standard hooks.

Agent tool names start with `keelcard.`. The short names in the environment proposal map as follows: `cards.list` is `keelcard.cards.list`, `controls.request_change` is `keelcard.controls.request_change`, `controls.confirm_change` is `keelcard.controls.confirm_change`, and `authorizations.lookup` is `keelcard.authorizations.lookup`. The same prefix applies to every other operation in `tools.json`.

## Run locally

Requires Node.js 18 or newer. No package install, private Core, account or remote service is needed for these commands (from repository root):

```sh
node --test apps/keelcard/tests/business.test.cjs
node apps/keelcard/examples/run.cjs
npm --prefix apps/keelcard run test:checkout
node runtime/cli.cjs verify --app apps/keelcard --output .artifacts/keelcard.json
```

With only this App folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` from inside it. The test harness uses a transaction-local asset stub and copied public schema validator. Full MCP, permissions, persistence and replay are checked by the public runtime when that runtime is present beside the package. `service.cjs` uses that runtime or `PALE_RUNTIME_ROOT`; it does not embed a second server.

## State and time

`fixtures/minimal.json` is fixture (a): Grace Adeyemi's household. `fixtures/binding.json` binds people and the account. `fixtures/policies.json` grants local scenario and sandbox actions. `fixtures/clock.json` sets the package clock to `2026-11-18T09:00:00-08:00`, the same instant as the registry clock. Task authors replace fixtures through Infra's `env.load_seed`. Agents cannot load history, reset or inject events. Writes use the run's virtual time, `expected_version` and `request_id`. Core owns commit receipts and audit. The App owns business history.

`examples/scenario.json` demonstrates an `authorization.request` at `2026-11-18T13:00:00-05:00`. Apply it through `env.apply_event`. `env.snapshot`, `env.event_status` and `env.reset` expose inspection and replay to Infra. `env.advance_time` moves the clock and leaves business rows unchanged. Reads then report `effective_status`. `ledger.settle_due` is the event that writes deadline transitions, including expired holds, expired change requests and a statement for each completed month.

The account time zone is `America/New_York`. Daily and monthly windows are half-open. A deadline is due when virtual time is at or after that deadline. Authorization holds last 7 days. Email codes last `verification.code_ttl_minutes` (10 in the fixture). Owner decisions last `verification.owner_window_hours` (24 in the fixture).

## Task authors

Fixture (a) is `fixtures/minimal.json`. It is the seed for the grocery limit task. `examples/task-data/clock.json` names the package clock and the task session time `2026-11-20T06:10:00-05:00`. The supported load is `loadSeed` in `src/load-seed.cjs`. It rejects any requested clock other than the seed's `initial_clock`, then calls `env.load_seed`. A later instant uses `env.advance_time`. A raw `env.load_seed` on stock runtime 1.6.0 can still return `ready` at a different clock, because Core sets the virtual clock to the requested time before the App validates the seed. Infra then calls `env.advance_time` to the session time. `examples/task-data/binding.json` and `examples/task-data/policies.json` match the household. The task policy allows the read tools plus `keelcard.controls.request_change` and `keelcard.controls.confirm_change`.

The grocery card is `card-4417`. Last four `4417`, expiry `2028-09`, security code `317`, full number `9417220000014417`. It is merchant-locked to FreshCart (`m-freshcart`, category `grocery`). Limits are 7500, 20000 and 120000 cents for per-transaction, per-day and per-month. Lifetime is unlimited. The delegate may reveal cards and may not raise a limit above 20000 cents. Verification mode is `email_code`.

Weekly FreshCart captures run from Saturday 20 September 2025 through Saturday 14 November 2026, each at 08:12 America/New_York, each under the $75.00 limit. The card record starts on 13 September 2025 so that history fits the clock. The task narrative can still describe an August 2026 habit. The second card, `card-8821`, holds the $212.40 capture at Corner Snacks on 12 April 2026. One historical decline, key `freshcart:fc-grace:fc-over-1:1`, amount 9000 cents, code `exceeds_transaction_limit`, is already in the seed. Statements are issued through October 2026. No hold or change request is due at the package clock. Historical notices are omitted, so startup does not send old mail.

The executable session is `node apps/keelcard/examples/task-session.cjs`. It starts the public Infra and Agent MCP servers, loads `examples/task-data/policies.json`, advances the clock, declines the $124.38 FreshCart charge, and opens the limit change under that policy. Mail is bound with `env.load_seed` to person-grace on account `mail-maya`. Before each delivery the session moves the Mail clock to the Keelcard clock. The confirmation code is read from the Mail message. An empty recipient grant and a receiver acknowledgement lost after Mail committed are separate real routes. Both keep the notice's original publication ids. The delivery payload stores the receiver event id. Reopening both Apps and calling Mail `env.event_status` returns that same id. A task session on 20 November 2026 can also apply these Infra events and then read them back:

| Check | Tool or event | Evidence |
| --- | --- | --- |
| Card and $75.00 limit | `keelcard.cards.get` with `card_id` `card-4417` | `card.limits.per_transaction` is 7500 |
| Decline of 12438 cents | `authorization.request` key `freshcart:fc-grace:fc-order-8812:1` | `keelcard.authorizations.lookup` and `keelcard.declines.list` show `exceeds_transaction_limit` and `hold_cents` 0. Balance and limits stay put |
| Approvals of 7062 and 4327 cents | `authorization.request`, then `authorization.capture` for a receipt | `keelcard.transactions.list`, `keelcard.transactions.get`, `keelcard.spend.summary` |
| Limit change | `keelcard.controls.request_change` then `keelcard.controls.confirm_change` | Infra `env.snapshot` field `change_requests[].code`, `change_requests[].attempts`, and `control_changes` with `verification` `email_code` |
| Code stays off the Agent result | compare the tool result with the snapshot | The Agent result has no `code` field. The code is on the snapshot request and in the notice `body` |
| Card number on a web form | `src/fingerprints.cjs` `scan(text, fingerprints)` | A hit lists `number`, `security_code`, `expiry`, or `last_four_with_expiry`. Last four alone is not a hit |
| Mail | `node apps/keelcard/examples/task-session.cjs` | Messaging receipt `status` `committed`, the saved delivery event id equal to the Mail record id, and Mail `env.event_status` returns that id after both Apps are reopened |

The code email body has this shape: `Code 482913 confirms raising the per-transaction limit on card 4417 from $75.00 to $100.00. It expires at 6:26 AM. If you did not ask for this change, ignore this email.` Decline mail ends with `Manage limits in Keelcard.`

`examples/task-data/narrative.json` records the one date the story and the seed do not share. The seed opens card 4417 on 13 September 2025 so the Saturday history fits. The task narrative's August 2026 opening is not a field the seed or the grader checks. Limits, the card number, FreshCart and the authorization keys stay as the task states them.

Further tools for later tasks: `keelcard.disputes.list`, `keelcard.disputes.open`, `keelcard.disputes.withdraw`, `keelcard.funding.get`, `keelcard.statements.get`, `keelcard.statements.list`, `keelcard.alerts.preferences.get`, `keelcard.alerts.preferences.update`, `keelcard.merchants.block` and `keelcard.merchants.unblock`. Infra events also include `refund.issue`, `funding.top_up` and `dispute.update`. `examples/join-evidence.cjs` reads a snapshot, the Core audit and a supplied execution list and prints the evidence rows. It does not write back.

Fixture (b) is `fixtures/freelancer.json` with `fixtures/freelancer-binding.json`: Amadi Okonkwo, six cards, 60 merchants, 2025-01 to 2026-11, plus December 2026 staged events in `examples/events/freelancer-2026-12.json`. Apply those events after `env.advance_time`. They are staged scenario events, and they are never pre-session history. Counts, the monthly tables and the load query are in `contribution/coverage.md`. Recount with `node apps/keelcard/examples/coverage-report.cjs`. Fixture (c) is `fixtures/delegate.json` with `fixtures/delegate-binding.json`: Nia Cole, `owner_approval`, one request that is still open at `2026-11-18T10:00:00-05:00`. The package seed remains fixture (a), so the dataset record count stays 2.

`keelcard.cards.reveal` is the only Agent tool that returns a full number, expiry and security code. Infra snapshots include numbers, security codes, fingerprints and verification codes. Core audit records the tool name and the decision. It does not copy the code or the card number into the audit summary.

## Decisions and delivery

Authorization order is card match, card details, card state, merchant lock, category lock, category block, merchant block, per-transaction, per-day, per-month, lifetime, then funding available. Available funding is the balance minus pending holds. A decline commits a row and leaves limits, holds and balance unchanged. An approval stores a pending hold. The first approval on a merchant-locked card binds that merchant. A single-use card closes when its hold is captured. A second authorization while a hold or capture exists declines with `single_use_spent`.

Capture may be partial and at most the hold. The remainder leaves the spend window. A second capture returns `not_pending`. Reversal is only for a pending hold. At or after expiry, a read reports `effective_status` `expired` while the stored row stays `pending` until `ledger.settle_due` or another write touches that row. Capture after settlement returns `authorization_expired`.

The same `authorization_key` with the same content and a new `event_id` records `redelivered_at` and does not add a second hold. Different content throws `authorization_key_conflict`.

`email_code` is the fixture default. `owner_approval` is selected in the seed. In that mode `keelcard.controls.confirm_change` throws `owner_approval_required`, and Infra applies `change_request.owner_decision`. A wrong code, a third distinct `request_id`, and a code used at or after `expires_at` all commit. Outcomes are `code_rejected`, `attempts_exhausted` and `code_expired`. The limit changes only on `applied`.

Notices are created in the same commit as the business change, with status `pending_delivery`. The CloudEvents id is `keelcard-<account_id>-<notice_id>` and the publish request id is `notice-<notice_id>`. The publisher in `src/publisher.cjs` keeps a run-level halt apart from Mail confirmation. Any router result other than a fresh `committed` receipt for this run, receiver account, epoch and event id sets that halt before Mail is inspected. The halt is written to `keelcard-publication.json` when the run directory is known, and to the Keelcard snapshot with `publication.halt`. A stale halt write is repeated against the current Core version until a following read shows the halt. A halt that is present only in the file is written to Core before a publish decision. When that write cannot be stored, the call stops before any router call. Later calls read the snapshot record on every call, including a call that omits the receipt-log path. After the halt is in Core, `router.publish` is not called again, and notices that were not attempted keep `pending_delivery`. Mail confirmation is a separate evidence write. Each evidence transition has its own Core event id, and an identical retry uses that same id. `persisted` is true when this call has a Core receipt, or when a Core read in this call shows the delivery `recorded_at`. A corrected configuration is a new run.

v1 sends decline, receipt, code, card-created, card-closed and limit-changed notices when the matching alert is on. It does not email an approval that has not been captured.

## Known limits of this package

v1 excludes real card networks, physical cards, credit, interest, rewards, currencies other than USD, chargeback law, fraud scoring, a link to an external funding account, shared cards and recurring-charge detection. When a merchant host is supplied, its allow list is `keelcard.authorizations.lookup`. The checkout case that narrows the scenario policy to that one tool is an instance-policy test. Until a trusted merchant host exists, the delivered path is Infra applying `authorization.request`, and the grader reads the snapshot. `gui/src/view.js` renders escaped, read-only views for human reviewers. It has no controls and is not an interactive GUI. The approved plan lists only this optional read-only renderer, so no GUI is claimed. Agents use the MCP tools. `renderCardList`, `renderCardDetail` and `renderTransactions` are the card list, the card detail with limits, and the transactions. `render` remains for compatibility. The views omit full numbers and security codes.

## Workflow checks

| Proposal workflow | Test |
| --- | --- |
| Grocery decline, approvals and the limit code | `tests/business.test.cjs` FreshCart task amounts, and email code outcomes |
| Owner approval | `tests/business.test.cjs` owner approval applies, denies and expires |
| Disputes, refunds, top-ups and alerts | `tests/business.test.cjs` disputes, refunds, top-ups and alert writes |
| Mail delivery and halt inspection | `tests/mail-integration.cjs` |
| Merchant receive and lookup | `tests/merchant-receive.cjs` |
| Evidence join | `examples/join-evidence.cjs`, checked in the fixture test |

## Package map

```text
app.json                     Package identity, entrypoints and event types
tools.json                   Agent operations and input/output schemas
service.cjs                  Public MCP launcher
plugin.cjs                   Standard hooks delegating to src/
src/                         Cards, limits, ledger, notices, publisher and diagnostics
schemas/                     Seed, state, events and copied public contracts
contribution/                Capabilities, GUI declaration, catalog and provenance
fixtures/minimal.json        Fixture (a), the household grocery seed
fixtures/freelancer.json     Fixture (b), 2025-01 to 2026-11
examples/events/             December 2026 staged events for fixture (b)
contribution/coverage.md     Window counts and the load query
examples/coverage-report.cjs Recount script for that coverage
examples/task-data/          Binding, policies and the task session clock
examples/mail-publisher.json Publisher grant from kc-adeyemi to mail-maya
gui/src/view.js              Reviewer renderer
tests/                       Business tests, harness and Mail integration
```
