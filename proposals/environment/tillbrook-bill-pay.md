# Environment Track proposal

**PR title format:** `[Environment Proposal] [<Domain>] <App or website name>`

**PR title for this proposal:** `[Environment Proposal] [Money & insurance] Tillbrook Bill Pay`

After design approval, use the [App contribution guide](../../docs/app-contribution.md) and [public Core / Messaging runtime](../../runtime/README.md) to reproduce local integration checks. For connections to existing Apps, consult their [business and receive contracts](../../docs/app-integrations.md) before implementing the sender.

## 1. App and domains

- **Authors / GitHub handles (required):** Skylar (Haotian) Zhai ([@zhaihaotian](https://github.com/zhaihaotian)), implementation and maintenance owner.
- **Reference app or website / URL (required):** Tillbrook, an independently branded synthetic checking account, seen from one customer who pays people and bills from it. Workflow references: [Chase Online Bill Pay](https://www.chase.com/digital/online-bill-pay) for payees, e-bills, recurring payments and deliver-by dates; the [Zelle FAQ](https://www.zelle.com/faq) for bank-to-bank sends that are final once sent; [Pay.UK Confirmation of Payee](https://www.wearepay.uk/what-we-do/overlay-services/confirmation-of-payee/) for checking the account name before paying. No third-party code, brand assets, screenshots or real data are used.
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

### Domain names

Use the exact names from the [homepage](../../README.md#environment-domains). Choose one primary domain and optional secondary domains; list the primary first in the PR title and join others with ` + `.

<table>
<tr><td>💳 <strong>Money &amp; insurance</strong></td><td>🛍️ <strong>Shopping &amp; groceries</strong></td><td>✈️ <strong>Travel &amp; commuting</strong></td></tr>
<tr><td>🩺 <strong>Health &amp; care</strong></td><td>🍽️ <strong>Food &amp; dining</strong></td><td>💬 <strong>Social &amp; communities</strong></td></tr>
<tr><td>🏠 <strong>Home &amp; utilities</strong></td><td>🏛️ <strong>Public service &amp; law</strong></td><td>🎬 <strong>Media &amp; entertainment</strong></td></tr>
<tr><td>📚 <strong>Learning &amp; research</strong></td><td>💼 <strong>Work &amp; business</strong></td><td>📰 <strong>News &amp; information</strong></td></tr>
<tr><td>🌤️ <strong>Weather &amp; outdoors</strong></td><td>🎮 <strong>Games &amp; play</strong></td><td>🏃 <strong>Fitness &amp; wellbeing</strong></td></tr>
</table>

## 2. What you plan to build

Briefly describe the main workflows and why this environment would be useful for personal-agent tasks.

**✍️ Your answer (required):** Tillbrook is a resettable checking account where the agent, acting for the account holder, adds payees, pays bills and sends money to other banks.

Paying bills is one of the first jobs people would give a personal assistant: rent, the power bill, the contractor, a friend who covered dinner. Most months it is routine. A bill arrives by email, and the agent checks the amount and schedules the payment to arrive before the due date. The agent should also catch problems on its own, such as an electricity bill twice the usual amount or a balance too low for next week's rent.

It matters because mistakes cost real money and are hard to undo. A transfer to the wrong account usually cannot be pulled back, a missed due date brings a late fee, and one of the most common payment scams is an email saying a known payee has new bank details. For example, the owner asks the agent to pay a contractor's final invoice, and two days later an email in the same thread asks for payment to a new account. Deciding whether to pay needs facts only the bank holds: when the payee was added or changed, whether the account name matches, and where earlier payments went. Tillbrook records those facts and never blocks a payment on suspicion; the decision stays with the agent.

Billers, employers, the receiving bank and bank staff act only through events. The cutoff, hold length, daily limit and recall window are seed settings.

Five workflows in v1:

1. **Account and activity (read-only).** Posted and available balance, pending debits and holds, today's transfers against the limit, and transactions by window, kind and state.
2. **Payees** (`active -> removed`, with a history row for every change). Search billers, preview the name check without saving, add a person or business by routing and account number or a biller by the customer's account number there, edit, remove. A change of name or bank details records a new name-check result and starts a new cooling-off period; a nickname change does neither.
3. **Bill pay and e-bills** (payment `scheduled -> held -> processing -> sent -> settled`, or `failed`, `cancelled`, `returned`; e-bill `unpaid -> scheduled -> paid | past_due | replaced`). Pay once, today before the cutoff or on a later business day, optionally against an e-bill, or set up a weekly, two-weekly or monthly series. The create result confirms the deliver-by day and any hold end. A scheduled payment, one occurrence or a whole series can be changed or cancelled before it moves.
4. **External transfers and recalls** (transfer `held -> sent | failed | cancelled`, or `sent` at once, then `recalled` or `returned`; recall `requested -> recovered | not_recovered`). Send now to a bank-account payee. A held transfer can be cancelled. A sent one is final and can be recalled once within the recall window; the receiving bank decides by event. A transfer is a payment record of kind `transfer`, so `payments.get`, `payments.cancel` and `tillbrook.payment.return` also apply to it.
5. **Alerts.** List alerts and set email on or off, optional kinds and a low-balance threshold. Kinds: `payee_added`, `payee_changed` (both always on), `payment_sent`, `payment_failed`, `payment_returned`, `low_balance`. Turning off an always-on kind fails with `invalid_arguments`.

An unknown ID returns `not_found`, and a failed write changes nothing. Other rejections include `over_daily_limit`, `insufficient_funds`, `not_transferable` and `ebill_mismatch`.

The name check is deterministic and shaped like Confirmation of Payee: it compares the typed name with a seeded registry and returns `match`, `close_match` (with the registered name), `no_match` or `unavailable`. It is stored and never blocks, since a fraudster's own account can match too. A payment to a payee added or changed within `new_payee_hold_hours` stays `held` until that period ends or bank staff release it. Each payment records its destination when created and again when the money moves.

Illustrative uses, not Task Track submissions: the contractor's changed bank details above, and a utility e-bill at twice the usual amount, checked against earlier e-bills before paying.

Overlap, checked against the proposal list on 2026-11-22: no Environment proposal lets an agent pay a party of its choosing from a bank account. #6 moves money between the user's own accounts and a brokerage; #68 pays people by handle inside its own network; #27, #170 and #182 take payments in their own portals. I propose that Tillbrook pays third parties and #6 keeps own-account transfers; a task that needs both seeds them consistently.

## 3. Potential app connections

Name possible connections and briefly explain their purpose. Internal personal apps include Mail, Calendar, Contacts and similar tools. Use `None` if no connection applies, or `TBD` if undecided.

For internal personal Apps, state which workflow needs each App and whether the connection is required or optional. Link the existing public interface/version, or identify the missing capability, owner and fallback.

- **Internal personal apps (required):**
  - Mail 1.3.0 (`examples/apps/mail/`), optional; the alert connection is used only in workflow 5. Tillbrook sends alerts as plain-text emails to the owner through Mail's existing receiver in [`contribution.json`](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/contribution/contribution.json): `channel.email`, `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, `mail.receive_notification` via `env.apply_event`. It reads nothing from Mail. Without Mail, alerts stay in `alerts.list`.
  - Mail 1.3.0, Messages 1.0.0 and Notes 1.0.0, optional, read by the agent in workflows 2–4. Invoices and "new bank details" messages are seeded into Mail (`mail.deliver`) or Messages (`messages.upsert`), and payment notes into Notes (`notes.upsert`). The agent reads them with those Apps' own [Mail](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/tools.json), [Messages](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/apps/messages/tools.json) and [Notes](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/apps/notes/tools.json) tools. Tillbrook does not connect to them; no capability is missing.
- **Other apps and websites (required):** None at run time; no live bank, biller or payment network is called. Tasks can later pair it with #6 or #183 through consistent seeds, where a #6 transfer or #183 payroll is a Tillbrook deposit event.

### Integration details

- **Operations and access (required):** MCP over stdio on the public runtime 1.6.0 (Core API 1.2.0) at `main` commit `a4bce02`. Tillbrook has 20 Agent tools prefixed `tillbrook.`, 10 reads and 10 writes; the names are proposals.

  | Workflow | Reads | Writes |
  | :--- | :--- | :--- |
  | 1 Account and activity | `account.get`, `transactions.list` | None |
  | 2 Payees | `billers.search`, `payees.verify`, `payees.list`, `payees.get` | `payees.add`, `payees.update`, `payees.remove` |
  | 3 Bill pay and e-bills | `payments.list`, `payments.get`, `ebills.list` | `payments.create`, `recurring.create`, `payments.update`, `payments.cancel` |
  | 4 Transfers and recalls | `payees.get`, `payments.get` (above) | `transfers.send`, `transfers.recall`; `payments.cancel` (above) cancels a held transfer |
  | 5 Alerts | `alerts.list` | `alerts.update` |

  Agent results show account numbers by their last four digits. `payees.get`, `payees.update`, `payees.remove`, `payments.create`, `recurring.create` and `transfers.send` take the payee as `id`, so Core's existing `constraints` can limit them to listed payees. Setup, reset and event injection use `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle` and the host's `env.advance_time`, all kept off the Agent connection. No GUI in v1.
- **State and lifecycle (required):** State is kept per run and App instance, one customer each. Data has three parts: bank data (settings, directories, name-check registry), the customer's account (payees with history, payments, series, e-bills, transactions, alerts) and Core's run record (clock, receipts, audit). `env.load_seed` loads past history and `virtual_now`; a seed with dangling references, a bad routing checksum or a record after `virtual_now` fails with `invalid_seed`. Every write takes `request_id` and `expected_version` and returns the committed ID, state and version. A repeated identical request returns the first receipt with `duplicate: true`, so a retried transfer moves money once. A reused ID with a different request fails with `idempotency_conflict`, a stale version with `stale_version`; nothing partial is written. Core commits one write at a time, so two transfers sent together are checked against the daily limit in commit order. Reads change nothing. `env.reset` restores this App's seed and clock only (`reset_scope: app_instance`); emails already in Mail stay there. `env.snapshot` includes each payee's history and each payment's two destinations; it is evidence, not a restore.
- **Events and notifications (required):** Seven events through `env.apply_event`, timed by the task: `tillbrook.deposit.post` (a credit, optionally held until `available_at`), `tillbrook.debit.post` (an outside debit, which may overdraw), `tillbrook.ebill.issue` (an e-bill, optionally replacing one), `tillbrook.payment.return` (a payment comes back and a credit posts), `tillbrook.recall.resolve` (`recovered` with an amount, or `not_recovered`), `tillbrook.biller.update` (a biller added, renamed or retired) and `tillbrook.hold.release` (bank staff release one hold). Example input:

  ```json
  {"event_id":"ev-tb-110","at":"2026-12-08T07:30:00-06:00","operation":"tillbrook.ebill.issue","payload":{"ebill_id":"eb-0031","payee_id":"pe-0004","amount_cents":31288,"due_on":"2026-12-22","replaces":null}}
  ```

  Handlers see the event time as `ctx.virtual_now`. Cutoffs, holds and recall windows are computed from the clock, and `env.advance_time` fires no timers. A replayed `event_id` has no second effect; an event that does not fit the state fails with `invalid_event` and changes neither data nor clock.

  Tillbrook publishes `channel.email` and receives none. An Infra-run sender, set up like `examples/workflows/delivery-to-mail/`, publishes each new alert with email on, using the alert ID as `request_id`. Example output:

  ```json
  {"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-imani"},"source_object":{"app_id":"tillbrook","account_id":"tillbrook-imani","object_type":"payee","object_id":"pe-0002"},"content":{"title":"Payee details changed: Alder Court Rentals","body":{"format":"text/plain","text":"Account now ends in 7712 (was 4471). Payments to this payee are held until Dec 10 10:02 CT."},"asset_ids":[]},"extensions":[]}
  ```

  The Tillbrook commit and the Mail commit are separate. A repeat publish returns `duplicate: true`; a rejected delivery such as `recipient_not_authorized` leaves Mail unchanged and does not roll back the Tillbrook write.
- **Shared data and dependencies (required):** Every record has a stable ID such as `pe-0007`. `binding.json` maps the `account_id` and the owner's `person_id`, the same person Mail uses. Records are JSON text only, with amounts in integer cents (USD) and an empty asset catalog. The package runs on its own with only its files and the pinned shared runtime 1.6.0. Mail is supplied with `--with examples/apps/mail` only for the alert check.

## 4. Construction plan and effort

Specify how the environment will be built, what will be collected or synthesized, and how each deliverable will be checked. Include expected counts or coverage where relevant. Effort estimates may be ranges; use person-days for human work. Mark reusable components and explain any workstream that is not applicable.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `apps/tillbrook/`: 20 tools, 7 event handlers, the name check, payee history and cooling-off, and one function that derives payment states, balances and alerts from the clock. Reuses Mail's package layout, launcher and test harness. | Each workflow runs end to end through the tools, with its error cases; failed calls and events change nothing. | 4–5 |
| Data and image collection | No crawling or copying; I record the three workflow references. | Provenance in `contribution/dataset.json`. | 0.25 |
| Synthetic data and assets | Hand-written JSON: 5 routing numbers that pass the checksum in a range real banks do not use, 14 billers, 11 payees, 6 name-check registry entries, three months of history with 60 transactions, 30 payments covering every state, 2 series and 8 e-bills. Amounts and dates follow a typical household month (rent, utilities, phone, card), with one late payment, one return and one e-bill spike. | `validateSeed` checks unique IDs, references and chronology; a script checks each payment's expected state. I read every record for plausible amounts and due dates and check that no name is real. | 1–1.25 |
| App integrations | Alert emails to Mail 1.3.0 over `channel.email`: the `messaging.publishes` declaration, a wire builder following Mail's own, and the Infra-run sender. It reuses Mail's receiver and formats listed in Section 3. Agent reads of Mail, Messages and Notes need no Tillbrook code. | One alert lands once in Mail's state; a repeat publish returns `duplicate: true`; an ungranted recipient gives `recipient_not_authorized` with both Apps unchanged. | 0.75–1 |
| Validation and reset | Business tests per workflow; `npm run app:verify -- --app apps/tillbrook`, also `--with examples/apps/mail`; a real-MCP script for seeded history, `env.advance_time`, replayed, stale and denied writes, and reset. | Reports with exact versions and commands; reset equals the state after load. No manual or deployment checks remain: there is no GUI and nothing is hosted. | 2–2.5 |

Acceptance on one fixture (`America/Chicago`, cutoff 14:00, 2 delivery days, 24-hour hold, 48-hour recall window, $5,000 daily transfer limit):

| Workflow | Success and expected evidence | Failure, cancel or unchanged state |
| :--- | :--- | :--- |
| 1 Account | Posted $6,012.40, an $86.15 debit pending and a $1,200.00 deposit held: available $4,726.25; after `env.advance_time` past both, $5,926.25. | Another account's ID: `not_found`; every read leaves state byte-identical. |
| 2 Payees | "Hollis & Pike Renovations" typed for the new account from the "new bank details" email: `close_match` with the registered name "Hollis Pike Renovation LLC". `payees.add` Dec 9 09:40: `pe-0012`, cooling off until Dec 10 09:40, `payee_added` alert. | The Dec 4 Hollis & Pike account again: `duplicate_payee`; removing a payee with an active series: `payee_in_use`. |
| 3 Bill pay | $312.88 e-bill due Dec 22; payment for Tue Dec 15: deliver-by Dec 17, then `settled` and the e-bill `paid` on time. | Saturday: `not_business_day`; after 14:00 for today: `too_late`; too little money at the cutoff: `failed`, no debit. |
| 4 Transfers | After the row 1 advance, $4,800.00 to Hollis & Pike (added Dec 4): `sent`; recall next day, then a `recovered` event: `recalled` with a credit. | $150.00 to `pe-0012`: `held`, then cancelled; a second recall: `already_requested`; after 48 hours: `too_late`. |
| 5 Alerts | Landlord's bank details changed: `payee_changed`, delivered once to Mail. | Turning `payee_changed` off: `invalid_arguments`; email off: listed, not sent. |

- **Milestones, owners and dependencies (required):** I own every milestone. M0: design review in this PR. After plan approval: M1 (days 1–4) skeleton, seed validation, balances, workflows 1 and 2; M2 (days 5–9) workflows 3 and 4 and all 7 events; M3 (days 10–13) workflow 5 with the Mail sender, fixtures, `app:verify` and README. I submit a first runnable version with `/submit-implementation` within 14 calendar days of plan approval. Runtime 1.6.0 and Mail 1.3.0 are on `main`, so nothing blocks v1. I will ask for plan approval on my four Environment proposals one at a time. [#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6), [#27](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/27), [#68](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/68), [#170](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/170), [#182](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/182) and [#183](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/183) are scope comparisons, not dependencies.
- **Resources and total effort (required):** 8–10 person-days. Node.js 18+ on a laptop; no GPU, model API, paid data or external service. Seeds stay under 100 KB.
- **Scope boundary and open questions (required):** Not in scope: a GUI, checks, wires, international payments, cards, overdraft protection, fees, statements, own-account transfers (#6), e-bill autopay, joint owners, any fraud score and real banking rules. Open question, mainly for the author of #6: #6 already moves money between the user's own bank and brokerage accounts, so I left own-account transfers out and Tillbrook only pays other people and businesses. If #6's author would rather draw the line elsewhere, I will change Tillbrook's payee types to match. Fixed in this plan: when a payee's bank details change, scheduled payments follow the new details, and each payment records both destinations.
- **License and external dependencies (required):** Code, schemas and fixtures under the repository's MIT license, redistributed in the repository; nothing is hosted. Chase, Zelle and Pay.UK are cited only for workflow shape; their names, logos and screens are not reproduced. Every bank, biller and person is made up. No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
