# Brightpath Student Loans

Brightpath is an independently branded, resettable synthetic student-loan dashboard and fictional servicer. It is designed for personal-agent evaluation, not financial, tax, or legal advice. It never contacts a government agency, loan servicer, bank, IRS service, or production network.

## Delivered workflows

1. **Portfolio:** list eight fixture loans and read authorized detail with masked identifiers, principal, accrued interest, rate, plan, payment, next due date, repayment status, qualifying counter, current servicer, and preserved history.
2. **Compare and choose:** `repayment.plan.compare` is a pure read. It evaluates six visibly fictional policies from explicit loans, income, family size, filing profile, loan type, and disbursement date. `repayment.estimate.save` is the separate explicit write that persists one immutable eligible calculation record.
3. **Apply and recertify:** create/edit a draft, add metadata-only income evidence, explicitly confirm the selected plan, submit with a receipt and immutable snapshot, inspect lifecycle state, and withdraw a nonterminal request. Missing attestations/evidence, late documents, stale versions, terminal withdrawal, and duplicate/conflicting host requests fail without partial business changes.
4. **Status changes:** four Infra/task events handle application decisions, payment failures/schedules, repayment status, and completed servicer transfers. They preserve history, create actionable in-App notices, use the event-supplied virtual time, and never invent a completed payment or silently select a plan.
5. **Optional Mail 1.3.0:** application receipts, decisions, document requests, and status notices can be prepared as the receiver-owned `channel.email` wire contract. Brightpath records delivered/rejected/unknown acknowledgement separately. Unknown acknowledgement halts blind retry until explicit reconciliation; none of these outcomes rolls back the originating loan/application event.

The browser product has five real business views backed by the same Agent MCP state: Dashboard, Loan detail, Compare plans, Applications, and Status & notices. No management operation is present in the page or Agent tool discovery.

## Run locally

Node.js 18+ and the repository public runtime are sufficient. There are no runtime npm dependencies or credentials.

```sh
cd apps/brightpath-student-loans
npm test
npm run example
npm run generate:check
```

From the repository root:

```sh
npm run app:verify -- --app apps/brightpath-student-loans --output .artifacts/brightpath-student-loans.json
node runtime/web/server.cjs --app brightpath-student-loans --run brightpath-web --profile sandbox
```

Open the access URL printed by the Web Host. A fresh `sandbox` run enables business writes. A `scenario` run exposes only the fixture policy's read tools. History/reset/event injection remain on a separate Infra MCP connection.

Additional checks:

```sh
cd apps/brightpath-student-loans
npm run test:web
npm run test:web:browser
npm run example:mail
```

`test:web:browser` requires the repository's pinned Playwright/Chromium install. It clicks Brightpath's own controls, inspects the same state through Infra, tests reload/event refresh/stale conflict/text escaping/management denial, takes a screenshot, and explicitly guards against accidental Notes `.note-paper` spacing.

## Agent business operations

Every write requires Core `expected_version` and a retry-stable `request_id`. Application and notice edits also require the observed record version.

| Operation suffix | Effect |
| --- | --- |
| `loan.portfolio.list` / `loan.get` | Read portfolio or one loan/history; no read flags change |
| `repayment.plan.compare` | Pure calculation; never persists an estimate or changes a loan |
| `repayment.estimate.save` | Save an immutable eligible estimate/input snapshot |
| `repayment.application.list` / `.get` | Read lifecycle, documents, receipt, snapshot, and history |
| `repayment.application.create` / `.update` | Create or edit borrower-controlled draft/needs-information fields |
| `repayment.application.submit` / `.withdraw` | Explicitly confirm and submit, or withdraw a nonterminal record |
| `repayment.document.add` | Add filename/type/period/checksum only; no bytes or OCR |
| `loan.notices.list` / `loan.notice.get` / `.acknowledge` | Read and acknowledge the in-App notice center |
| `loan.history.list` | Read preserved application/loan/payment/servicer history |
| `notice.email.prepare` / `.record` | Commit separate optional Mail preparation/acknowledgement state |

Full schemas are generated in `tools.json`. Administrative `env.load_seed`, `env.apply_event`, `env.advance_time`, `env.snapshot`, `env.reset`, `env.event_status`, and `env.validate_bundle` are supplied only by the trusted Infra connection; they are absent from Agent discovery and the browser API.

## Deterministic calculations

- All amounts are integer cents; rates are integer basis points.
- Fixed monthly estimates sum each loan's standard amortization and round each positive result to the nearest whole cent with JavaScript `Math.round`.
- Income-driven estimates compute protected income as `base + increment × (family_size - 1)`, multiply remaining annual income by the plan basis-point percentage, divide by 12, round to cents, and cap at the seeded standard-10 estimate.
- Projected total is `monthly cents × term months`. Projected interest and fictional forgiveness are bounded at zero. Calendar-month term addition determines the displayed end date.
- The exact input facts, calculation time, and rounding statement are returned by compare and frozen only by `estimate.save`.

These are small fictional policies for deterministic evaluation. They do not represent current federal law or a promise of eligibility, cost, or forgiveness.

## Event envelopes and controls

All events require a stable `event_id`, an offset-aware `at`, one declared operation, and the exact payload in `schemas/events.schema.json`. Core rejects backwards time, deduplicates identical event IDs, rejects changed-content reuse, and commits the handler atomically.

| Event | Allowed effects | Rejected controls |
| --- | --- | --- |
| `loan.application_status_changed` | `submitted → processing/approved/denied/needs_information`; `processing → approved/denied/needs_information`; `needs_information → processing/approved/denied`. Approval may apply the plan the borrower already submitted and its deterministic payment. | Draft/terminal source, unsupported target, missing application. |
| `loan.payment_status_changed` | `scheduled`, `failed`, or `past_due`; update amount/due date; failure/past due marks delinquent; create notice/history. | `completed` or any invented payment completion, paid/missing loan, malformed date. |
| `loan.repayment_status_changed` | Set `current`, `delinquent`, `deferment`, or `forbearance`, payment and due date; retain plan. | Paid/missing loan, malformed date. |
| `loan.servicer_transfer_completed` | Atomically move all listed loans from the stated source to existing destination; create per-loan history plus notice. | Same source/destination, mixed or stale source assignment, missing loan/servicer. Preflight prevents partial transfer. |

A needs-information event sets its document deadline to exactly 14 × 24 hours after supplied event time. Document metadata submitted at the exact deadline is accepted; one millisecond later is rejected. Annual recertification uses the fixture's end-of-day UTC boundary. `env.advance_time` does not invoke an App handler or manufacture a deadline outcome.

Runnable examples are in `examples/events/`; `examples/scenario.json` is the public verifier event.

## Optional Mail integration

Brightpath declares send-only compatibility with Mail 1.3.0's implemented `channel.email`, `org.pale.mail.notification.v1`, `urn:pale:email-message:2`, and `urn:pale:email-payload:1` contracts. Messages contain a trusted configured Mail account reference, masked Brightpath source object, plain-text title/body, empty `asset_ids`, and an optional extension. They contain no SSN, bank credentials, addresses, document bytes, or hidden state.

`npm run example:mail` uses real MCP and Messaging with the actual Mail receiver. It synchronizes producer/receiver virtual clocks and verifies sender state, committed router receipt, destination Inbox records, transport/event deduplication, grant denial, simulated lost acknowledgement, halted local state, and reconciliation through the original event/request. Mail is optional and is not listed as a hard package dependency; Brightpath-only verification passes without it.

## Fixtures, generation, and reset

`scripts/generate-fixtures.cjs` deterministically creates eight loans, three fictional servicers, six fictional plans, four borrower profiles represented by the main borrower plus three income snapshots, five applications, eight notices, document metadata, estimates, and histories. `scripts/generate-tools.cjs` owns the tool catalog. `scripts/generate-mail-contract.cjs` generates the package copy from Mail's receiver-owned payload and the shared CloudEvents envelope. Run `npm run generate:check` to detect drift.

The fixture includes current, delinquent, deferment, forbearance, paid, transferred, approved, denied, processing, draft, and needs-information cases. Data is original and synthetic under MIT; no third-party media is packaged. Core isolates each `run_id`/`app_id`. `env.load_seed` establishes the latest task baseline and virtual clock; `env.reset` restores that baseline (including receipts/audit clearing) without resetting Mail or a runner cursor. Export evidence before reset.

## Workflow-to-test map

| Requirement | App evidence | Public/integration evidence |
| --- | --- | --- |
| Portfolio/read-only/missing object/masking | `tests/business.test.cjs` portfolio and missing-loan cases | `app:verify` real MCP read and unchanged state |
| Compare/save/application lifecycle | deterministic/read-only and create-update-document-submit tests | GUI browser compare/save/create/submit/reload |
| Stale record/confirmation/deadline/withdrawal/failure atomicity | explicit failure cases with unchanged snapshots | GUI stale Core version and `app:verify` stale lifecycle control |
| Four events/time/duplicate/invalid transition | all event handlers, supplied times, direct duplicate and rollback tests | `app:verify` receipt/retry/reset; browser independent event refresh |
| Permissions/reset/separate runs/persistence | policy fixtures and invalid binding test | `app:verify` Agent admin denial, load/reset, separate run, restart |
| Diagnostics | absent/failing logger equivalence and non-sensitive steps | Core outcome/debug separation in repository runtime tests |
| Optional Mail | wire/unknown/reconciliation business tests | `example:mail` real receiver/receipt/denial/duplicate/lost acknowledgement |
| GUI/API boundary/text/card spacing | static Host smoke | App-specific Playwright clicks, direct admin denial, literal text, screenshot |

App `npm test` is App-only business evidence. Root `npm test` is public runtime/reference regression. `app:verify` is real MCP/lifecycle/event/reset/persistence evidence. `test:web` is Host/API smoke, while `test:web:browser` is real Chromium acceptance. None of these substitutes for Node 18/22 CI, base-runtime compatibility, production authentication, human policy/UX review, or maintainer acceptance.

## v1 exclusions

No real federal submission, FAFSA/aid eligibility, origination, consolidation, refinancing, forgiveness/discharge adjudication, PSLF certification, tax/legal advice, live IRS consent/data, live payment or servicer network, bank changes, autopay, document contents/OCR, appeals, collections actions, bankruptcy, or identity verification. Collections-like status may be visible only when supplied by a synthetic task; it is not actionable. No Files, Calendar, payroll, budgeting, or tax App is a v1 dependency.
