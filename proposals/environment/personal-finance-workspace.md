# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Money & insurance] Personal Finance Workspace (Bank + Brokerage)`

## 1. App and domains

- **Authors / GitHub handles (required):** Genglin Liu ([@genglinliu](https://github.com/genglinliu)).
- **Reference app or website / URL (required):** A custom simulated Bank + Brokerage workspace. [Chase](https://www.chase.com/digital/online-banking) and [Robinhood](https://robinhood.com/us/en/) provide workflow references; the UI and default data are original.
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** A personal-finance app for inspecting accounts, moving cash between owned accounts, and buying or selling whole shares. Exact action previews, trusted user decisions and durable receipts connect each decision to its financial effect. Scheduled income, recurring debits and public account rules let Tasks introduce changing cash needs across sessions.

Initial workflows:

1. **Inspect finances.** Read balances, holdings, transactions, account terms, and currently available prices and announcements. Show posted cash, expected income and failed payments separately.
2. **Transfer cash.** Preview exact accounts and amount, obtain a trusted decision, then execute or cancel the pending proposal.
3. **Buy/sell whole shares.** Preview the instrument, quantity, reference quote and cash/position effects. Execute with a current approval. Changes to the instruction, relevant account state or quote require a fresh preview and decision.
4. **Handle account events.** Apply income and recurring debit occurrences. Insufficient cash produces a failed debit record with unchanged cash. Apply published minimum-balance rules and expose fee assessments.
5. **Follow changing obligations.** Read dated notices and Calendar context, revise the plan, and create/update an authorized reminder. The Agent chooses the plan and verifies its results.

A downstream Task can move a cash need from six months to two months and increase its amount. The Agent must reconcile the new instruction with current finances and authority.

**Reuse:** The research prototype has a Python USD ledger, market replay, UI, previews, confirmations, audit and snapshots. Nine offline finance checks passed on 2026-11-15. PALE packaging, revision enforcement, new account workflows and independent validation are planned deliverables.

## 3. Potential app connections

- **Internal personal apps (required):** Mail 1.3.0 and Calendar 1.3.0 are required for the connected example. The finance package also runs independently. Use the published [Mail tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/examples/apps/mail/tools.json) and [Calendar tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/examples/apps/calendar/tools.json).
- **Other apps and websites (required):** A bundled synthetic market feed supplies prices and announcements. Own-account transfers and brokerage share one ledger. Task-specific credit-card statements and pending charges can be supplied as Task records or through a separate fixture adapter.

| Workflow | Caller and interface | References and readback |
| :--- | :--- | :--- |
| Read an obligation or changed due date | Agent: `mail.search/get` | Mail account, message ID and observation time; read the actual message. |
| Inspect dates and reminders | Agent: `calendar.list/get` | Calendar account, event ID/sequence and returned version. |
| Create/update an authorized reminder | Agent: `calendar.create/update` | Retain the returned ID/version and read back with `calendar.get`. |
| Deliver scenario records | Infra: `mail.deliver` and `calendar.upsert` through their declared event interfaces | Synchronize clocks and verify actual records. |

Finance's initial Messaging publish/receive directions are empty. Calendar reminders are stored events; the runner schedules sessions.

### Integration details

- **Operations and access (required):** Agent tools and the business GUI use the same handlers. The proposed directory below will become versioned input/output schemas in `tools.json` at M1. Infra alone loads history, injects events, records trusted decisions, advances time and resets state.

| Proposed Agent tool | Effect | Input/result |
| :--- | :--- | :--- |
| `finance.accounts.list` | Read | Owned accounts, posted cash, terms and account revisions |
| `finance.transactions.list` | Read | Account ID; postings, debit attempts and fees |
| `finance.holdings.list` | Read | Account ID; whole-share positions |
| `finance.obligations.list` | Read | Public recurring terms, due dates, known amounts and source references |
| `finance.market.get` | Read | Instrument ID; available price history, quotes and announcements |
| `finance.actions.preview` | Write | Exact transfer/buy/sell parameters; stored proposal, effects, source revisions and validity |
| `finance.actions.get` | Read | Proposal ID; parameters, decision, current instruction reference and status |
| `finance.actions.cancel` | Write | Proposal ID; cancel a pending proposal |
| `finance.actions.execute` | Write | Proposal ID; commit one approved effect and receipt |
| `finance.receipts.get` | Read | Receipt ID; original operation and committed effects |

**Approval.** Finance owns decision records. The runner passes a trusted user response and source reference to Infra, which applies `finance.decision_recorded`. Each decision binds an immutable proposal revision containing exact parameters, instruction revision, relevant account revisions and quote ID. It carries an expiry and approve/reject outcome. Execution checks these bindings and current access, then commits the ledger effect and consumed approval together. Only Infra can record decisions, revise instructions or revoke authority. First-release trades/transfers use action-specific approvals.

**Package and GUI.** A Node Core plugin passes state and operations to the bundled Python ledger. Python returns the next state and result; Core validates and persists state, version and receipt. Python performs business calculations without separate state-file writes. The package includes its ledger, fixtures, schemas, six business views and controller. The [business Web Host](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/runtime/web/README.md) serves the Agent-facing GUI over MCP. Trusted inputs use the separate Infra connection.

- **State and lifecycle (required):** Each App instance isolates run identity, binding, clock and Core version. The finance workspace holds owned bank/brokerage accounts, holdings, terms, public obligations, instructions, proposals, decisions and history. Linked accounts have business revisions. Seedable history includes postings, trades, debit attempts, fees, quotes and decisions; opening balances already include historical effects.

Writes carry `request_id` and Core `expected_version` (`epoch`, `revision`). An unchanged retry returns the original receipt; changed-content reuse returns `idempotency_conflict`. A new request with an old version returns `stale_version`. Reads preserve business state. Fresh reads show current state; a receipt describes its original commit.

`reset_scope: app_instance`: `env.reset` restores Finance's loaded baseline and clock, clears Core receipts/audit and starts a new epoch. Infra exports evidence before reset and resets Mail/Calendar separately; their delivered records remain until their own reset. Persisted state supports restarting the same run. Importing historical state with `env.load_seed` creates a new baseline with fresh Core receipts/audit. Cross-App rollback is deferred.

- **Events and notifications (required):** Target public runtime 1.6.0, Core API 1.2.0 and the [virtual-time contract](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/docs/runtime-time.md). Task/Infra owns timing and simultaneous-event order. Finance uses `ctx.virtual_now`. Infra processes due events, synchronizes participating clocks, verifies the barrier, then resumes actors. Accepted events use `{event_id, at, operation, payload}`; identical retries return the original result.

Each row below is an independent event example.

| `event_id` | `at` | `operation` | `payload` and effect |
| :--- | :--- | :--- | :--- |
| `payroll-dec` | `2026-12-01T09:00:00-08:00` | `finance.credit_posted` | `{"account_id":"checking","amount_cents":200000,"source_ref":"payroll-dec"}` — credit once. |
| `rent-dec-1` | `2026-12-01T09:00:00-08:00` | `finance.debit_due` | `{"account_id":"checking","obligation_id":"rent","occurrence_id":"rent-dec","amount_cents":150000}` — record paid/failed; successful occurrences stay paid. |
| `floor-dec01` | `2026-12-01T23:59:00-08:00` | `finance.balance_check` | `{"account_id":"checking","rule_id":"daily-floor","business_date":"2026-12-01"}` — assess the published rule once per account/date. |
| `quote-1` | `2026-12-01T10:00:00-08:00` | `finance.quote_published` | `{"quote_id":"q1","instrument_id":"FUND1","price_cents":5000,"valid_until":"2026-12-01T10:10:00-08:00"}` — expose a versioned quote. |
| `announcement-1` | `2026-12-01T10:00:00-08:00` | `finance.announcement_published` | `{"announcement_id":"a1","instrument_id":"FUND1","text":"A revised distribution date is available."}` — expose the announcement. |
| `instruction-2` | `2026-12-01T10:00:00-08:00` | `finance.instruction_updated` | `{"instruction_revision":2,"source_ref":"user-turn-3","text":"Keep the revised amount available in two months."}` — invalidate earlier-instruction proposals. |
| `decision-1` | `2026-12-01T10:01:00-08:00` | `finance.decision_recorded` | `{"approval_id":"ap1","proposal_id":"p1","proposal_revision":1,"decision":"approve","expires_at":"2026-12-01T10:05:00-08:00","source_ref":"user-turn-4"}` — record a trusted decision against the current proposal. |
| `revoke-1` | `2026-12-01T10:02:00-08:00` | `finance.authority_revoked` | `{"approval_id":"ap1","source_ref":"user-turn-5"}` — revoke unused authority. |

Handlers validate object references, versions and source roles. Malformed/stale events preserve state; changed-content event-ID reuse fails. A valid insufficient-cash debit commits a visible failure record. A retry uses a new attempt event for the same occurrence and succeeds once funds are available.

**Time and account rules.** Quotes and approvals publish their own expiry; execution requires current authority and `now < expires_at`/`valid_until`. Clock advancement triggers no postings or reminders. Public obligations describe recurring terms; the runner supplies occurrences. A minimum-balance rule publishes its threshold, timezone, assessment time and fee: for example, a $10 assessment below $1,500 at daily close. Fee records separate assessed, paid and outstanding amounts. Personal savings targets remain user instructions for the Agent to reason about.

- **Shared data and dependencies (required):** Use the run binding's `person_id` and App account IDs. A Finance account identifies the workspace; linked bank/brokerage IDs identify owned objects. Cross-App observations retain App, account, object and version references. The package runs from its own directory with pinned runtime/dependencies, Node.js 18+ and Python 3.11+. Default data is synthetic and CPU-only. The connected fixture explicitly enables Mail/Calendar. Future schedules and evaluator labels stay in the runner; Agent tools expose obtained, available observations. Development fixtures are developer-visible.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Reuse the ledger; build accounts, transactions, holdings, market history, proposals and receipts views. Add revision-bound approvals, cancellation, debit attempts and account terms. | MCP and browser flows share state; errors show actual outcomes. | 4–6 |
| Data and image collection | Inventory reused sources/dependencies and licenses. Use original text, CSS and local charts. | Version/hash and license manifest; bundled synthetic assets. | 1 |
| Synthetic data and assets | Script three reset fixtures, each with three accounts, 1–3 holdings, 12 historical transactions, six Mail records and three Calendar entries. Share six instruments, 360 daily bars and 12 announcements. Add debit success/failure, delayed income and a balance-rule fee. | Fixed seeds, exact cents, valid prices, coherent identities/times and history loaded once. | 3–4 |
| App integrations | Build the Node/Python bridge, trusted events, Core operations and Mail/Calendar example. | Public MCP calls, actual receiver readback, version/permission checks and standalone package execution. | 5–7 |
| Validation and reset | Run workflow, real-browser, restart/history/reset and clean-checkout checks. | Commands, versions/hashes, traces, receipts and reports mapped to deliverables. | 5–7 |

### Workflow validation

| Workflow | Success evidence | Error and retry checks |
| :--- | :--- | :--- |
| Inspect finances | Balances/holdings agree with postings; expected income is separate; observations are time-filtered. | Missing observations return unavailable; future data and unauthorized accounts stay inaccessible. |
| Transfer | Exact approval, debit/credit entries and one receipt agree. | Insufficient cash, rejection, cancellation, stale instruction/account, expiry, revocation and lost-response retry. |
| Buy/sell | Quote, decision, cash and position changes agree. | Insufficient cash/shares, stale quote, invalid quantity and repeated execution. |
| Account events/rules | One credit/debit per occurrence, failed attempts and one fee per rule/date. | Failure then retry, duplicate/late events and timezone/assessment boundaries. |
| Mail/Calendar | Read a dated notice, revise the action, read back the transfer and created/updated event. | Reminder rejection preserves the financial commit; unchanged Calendar retry creates one event; Finance reset preserves Mail/Calendar. |

Finance history records proposals, decisions, effects and virtual times. Join it with Core commit/denial audit and supplied Agent calls/results by run, account, request, proposal and version. Count committed effects by receipt, so retries count once. Export evidence before reset.

Delivery includes App-only business tests, public-runtime MCP/required CI checks, real-browser operation of all declared GUI flows with MCP readback/reload, and reproduction by a maintainer or contributor who did not build the flows. Record passed, failed and unrun checks with artifacts.

- **Milestones, owners and dependencies (required):** Genglin Liu (@genglinliu) owns M0–M3. M0 settles scope, schemas and the reuse/license inventory. Within 14 calendar days of first plan approval, M1 submits a runnable package: linked accounts and one instrument, transfer/buy/sell, trusted approvals, representative debit/rule events, Core seed/reset, a browser path and a Mail/Calendar example with reproducible checks. M2 completes six views, three fixtures, event/error coverage and integration evidence. M3 completes independent reproduction and acceptance review. Full delivery is estimated at 4–5 working weeks; M1 lists remaining M2/M3 work.

  Related work: [PalePay #68](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/68) handles person-to-person payments; [Keelcard #87](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/87) handles virtual-card funding. This package owns linked-account transfers and brokerage. Shared funding interfaces are future joint work.

  [Task #100](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/100) can reuse recurring debits and minimum-balance rules. Its business-hour queues, business-day calendar and standing investment grant need Task-owned adapters or later extensions. Credit-card records remain Task data. [Task #36](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/36) can use scheduled checking payments; account closure remains in its fallback. Proposed tool names are published above; versioned schemas follow at M1.

- **Resources and total effort (required):** 18–25 person-days: 4–6 + 1 + 3–4 + 5–7 + 5–7. Local CPU runtime/browser; fixture package below 10 MB; deterministic generation and original assets. Model-trial requirements/budget remain a maintainer decision at M0. Agreed trials will retain model versions, configuration, traces and cost.
- **Scope boundary and open questions (required):** One combined Bank + Brokerage environment: USD, owned linked accounts, whole shares, immediate simulated transfers/fills, action-specific approvals, scheduled credits/debits and published account-rule fees. Deferred: transfer queues/business calendars, account closure, standing investment grants, live accounts/payments, margin/options, settlement/partial fills, trading fees/slippage and completed-trade reversal. The Agent chooses the plan.
- **License and external dependencies (required):** New code and synthetic fixtures will use MIT. M0 records prototype versions, ownership and compatible reuse licenses; redistributed files include notices. Bundle the Python ledger/UI with pinned public runtime dependencies. Default execution uses local synthetic data and original assets. Live market demonstrations are deferred.

Implementation and validation evidence will be added in this PR against the approved deliverables.
