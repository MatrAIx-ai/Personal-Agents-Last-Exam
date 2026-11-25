# Ledgerleaf Shared Expenses

Ledgerleaf is a deterministic synthetic group-accounting App for households, trips, couples and general groups. It records who paid and who owes, derives zero-sum balances, simplifies obligations, records external settlement evidence, and preserves every expense revision or tombstone. It never moves money.

## Workflows

- Create, rename and archive single-currency groups; add members and remove only zero-balance members.
- Preview and record multi-payer expenses split equally, by exact minor-unit amounts, percentage basis points or integer shares. Largest-remainder rounding is deterministic, with ties ordered by member ID.
- Read balances and pairwise obligations, persist simplified-plan previews, and record or explicitly reverse cash/bank/payment-app settlement evidence.
- Preview a full replacement or deletion, enforce creator/admin authority and object versions, and retain before/after revisions and balance deltas.
- Apply six trusted other-member event types with supplied virtual time and Core-owned deduplication.
- Optionally publish prepared activity notices through Mail 1.3.0's `channel.email` contract. Mail is not a required package dependency and delivery never rolls back a committed ledger action.

All amounts are safe integer minor units. A group fixes one of USD, CAD, EUR or GBP. Unsupported currencies, invalid totals, nonmembers, expired previews, stale Core/group/expense/settlement versions, overpayments, self-payments, duplicate IDs and unauthorized changes fail without a partial business commit.

## Commands

```sh
cd apps/ledgerleaf-shared-expenses
npm test
npm run example
npm run test:web
npm run test:web:browser       # requires the repository Playwright install
npm run example:mail           # real Messaging Router + Mail receiver
```

From the repository root:

```sh
npm run app:verify -- --app apps/ledgerleaf-shared-expenses --output .artifacts/ledgerleaf-shared-expenses.json
node runtime/web/server.cjs --app ledgerleaf-shared-expenses --run ledgerleaf-web --profile sandbox
```

The Web App exposes five business views and the same Agent MCP state. Setup, seed replacement, event injection, time advancement, snapshot and reset remain Infra-only and have no browser route.

## Fixtures and events

`npm run generate` deterministically rebuilds 16 fictional people, five groups, 60 expenses covering all split rules and multiple payers, 12 post-create revisions including tombstones, ten settlements including reversals, notifications and activity. `fixtures/minimal.json` is a reusable baseline, not a benchmark task. `examples/event-examples.json` contains all six event envelopes with explicit UTC offsets and stable person/account/member/object IDs; `examples/scenario.json` is the verifier's single event.

Reset is owned by Core and restores only this App instance's most recently loaded baseline, clock, resources, audit and receipts. Evidence must be snapshotted before reset. Mail owns already delivered inbox records and is not reset by Ledgerleaf.

## Optional Mail integration

Ledgerleaf consumes the receiver-owned Mail 1.3.0 wire contract copied from `examples/apps/mail/schemas/router-message.schema.json` and declares only send capability. `examples/mail-integration.cjs` commits a real other-member ledger event, synchronizes both App clocks, publishes the resulting notice through the public Router, verifies its committed receipt and the actual Mail inbox record, replays the message, checks grant denial, and demonstrates that a local ledger commit exists independently of delivery. The public runtime's lost-acknowledgement behavior halts a run with `receiver_unconfirmed`; operators inspect the known event ID/receiver state and do not blindly resend.

## Scope and provenance

v1 excludes real accounts/invitations, payments or payment requests, bank/card connections, FX conversion, recurring bills, receipt scanning/itemization, comments, budgets, tax/accounting advice, reimbursements, disputes/voting and automatic PalePay integration. Product categories were informed only by public Splitwise help/overview pages cited in the approved proposal. No Splitwise API schemas, code, branding, screenshots, user data or policy text are packaged. All implementation, UI and synthetic fixtures are original MIT-licensed work.
