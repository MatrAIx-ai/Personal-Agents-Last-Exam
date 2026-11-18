# Environment Track proposal

**PR title:** `[Environment Proposal] [Money & insurance + Social & communities] PalePay person-to-person payments (Venmo-inspired)`

## 1. App and domains

- **Authors / GitHub handles (required):** Huawei Lin ([@huawei-lin](https://github.com/huawei-lin))
- **Reference app or website / URL (required):** PalePay, an independently branded synthetic app for paying, requesting and splitting money between people. Venmo (https://venmo.com) is the public interaction reference; the transfer and bill-splitting features of Alipay are comparable. No third-party branding, data or assets are used.
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** Social & communities

## 2. What you plan to build

**✍️ Your answer (required):** PalePay is a resettable app for money between people: pay a friend, ask to be paid back, split a shared cost and see who still owes what. Every payment carries a note and an audience (public, friends or private), a completed payment cannot be recalled, and two accounts can have nearly the same name. The App records and executes what it is told; it never decides who should pay, how a cost should be divided or whether a request is legitimate.

Shared life produces shared costs: a cabin, a dinner, a gift, rent, a ride. Tasks that involve other people usually end with someone owed money, and the right amount depends on what the group agreed and what changed. No proposed environment covers payments between people, so each task would have to invent its own ledger.

Six workflows, each complete end to end:

1. **Find people.** Search by name or handle; a profile shows handle, display name, join date and number of mutual friends. Add or remove a friend; block or unblock an account.
2. **Pay.** Preview a payment with recipient, amount, note, audience and funding source, then send it. Sending completes at once and cannot be undone; the only remedy is a request to the recipient.
3. **Request.** Ask a person for money, remind them, or cancel the request. Accept or decline a request received from someone else; accepting pays it.
4. **Split.** Divide one expense among several people by equal shares or stated amounts, which creates one request per person. See who has paid, change or cancel unpaid shares; paid shares are fixed.
5. **Activity and privacy.** List past payments and requests, change the audience of a past payment, and set the default audience. The state records which accounts can see each note.
6. **Balance.** View the PalePay balance and the linked bank account, move balance to the bank by standard transfer (free, arrives later) or instant transfer (fee), and cancel a standard transfer before it completes.

Core examples (precondition → action or event → outcome → control case):

| Workflow | Example |
| --- | --- |
| 1 | Two accounts are both displayed as "Owen Park" → `people.get` on each → different handle, join date and mutual-friend count → an unknown handle returns `not_found`. |
| 2 | A preview shows recipient, $390.00, note and audience → `payments.send` with that preview ID → payment completed and balance reduced → a reused or stale preview ID is rejected and nothing moves. |
| 3 | An outgoing request is unpaid → `requests.cancel` → the request is closed and can no longer be paid → cancelling a request that was already paid is rejected. |
| 4 | A $1,950.00 expense is split five ways → five requests of $390.00 → one is paid, then `splits.update` changes the total → only the four unpaid shares change. |
| 5 | A payment was sent with a public note → `activity.visibility.set` to private → accounts other than the two parties no longer see it → changing a payment the user is not party to is rejected. |
| 6 | A standard transfer is pending → `transfers.cancel` → funds return to the balance → cancelling after `transfer.completed` is rejected. |

Illustrative downstream task: six friends paid for a ski cabin, one drops out, and the group is rebooked into a smaller place. The agent must work out each person's share under the rule the group agreed in chat, refund the right person the right amount, and keep the reason for dropping out off every note that others can see. A companion Task proposal will define the people, the agreement, the rubric and model trials; this App encodes no task's answer.

**Distinct scope:** Finance [#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) covers transfers between the user's own accounts and brokerage orders; it has no other people, requests, splits or audience settings. By our reading of the open proposals on 2026-11-18, none provides payments between people or expense splitting. Provider Apps that charge for group activities, such as group dining [#40](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/40), could be followed by a PalePay split without either App knowing about the other.

## 3. Potential app connections

- **Internal personal apps (required):** Mail, optional: a text notification when a payment or request is received, a request is paid or declined, or a transfer fails, through Mail's declared receive contract in [PR #12](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/12). The same facts are readable in the App. A Contacts connection is TBD and depends on whether a shared Contacts App is provided; PalePay keeps its own people list meanwhile.
- **Other apps and websites (required):** None at run time. The linked bank account is a balance held inside PalePay, not a connection to another App. A payment may carry an optional external reference to an order in another App as a stored ID.

### Integration details

- **Operations and access (required):** Agent-facing MCP tools under the package contract proposed in PR #12. Reads: `people.search`, `people.get`, `friends.list`, `activity.list`, `activity.get`, `requests.list`, `splits.list`, `splits.get`, `balance.get`, `transfers.list`, `settings.get`. Writes: `friends.add`, `friends.remove`, `people.block`, `people.unblock`, `payments.preview`, `payments.send`, `requests.create`, `requests.remind`, `requests.cancel`, `requests.respond`, `splits.create`, `splits.update`, `splits.cancel`, `activity.visibility.set`, `settings.privacy.set`, `transfers.preview`, `transfers.create`, `transfers.cancel`. `payments.send`, accepting a request and `transfers.create` need a single-use preview ID plus `request_id`. Whether a user approval is required is a policy applied by Core and the task, not decided by the App. No sign-in, card number or bank credential flow exists. Seed loading, reset, snapshot and events are Infra-only. Names are provisional until M0.
- **State and lifecycle (required):** One user account per instance; other people exist as profiles with scripted behavior. Seed: profiles, friendships, past payments and requests, open splits, balance, linked bank balance, privacy settings. Per-run state: new payments, requests, splits, transfers, friendship and block changes, audience changes, applied-event IDs. Balances are derived from the ledger, never stored. Amounts are integer cents in one currency. Each payment stores its audience and the resulting set of viewers, so what any other account can see is readable from state. Stale versions and reused preview IDs fail without partial effects. Reset restores the seed.
- **Events and notifications (required):** Task-scheduled, Infra-applied: `payment.received`, `request.received`, `request.paid`, `request.declined`, `request.cancelled_by_sender`, `transfer.completed`, `transfer.failed`, `friend.added`, `profile.updated`. Example: `{"type":"request.paid","event_id":"ev-022","request_id":"rq-107","payer":"@theo-lund","amount_cents":39000,"paid_at":"2027-02-11T17:40:00Z"}` marks that share paid and raises the balance. Replayed event IDs have no effect. Outbound: the optional Mail notification only.
- **Shared data and dependencies (required):** Stable profile, payment, request, split and transfer IDs; handles as display identifiers; UTC timestamps on the simulated clock; UTF-8 notes including emoji. No images are required in the first version. Required: public Core runtime. Optional: Mail.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Package under `apps/palepay/`: manifest, 29 tools, schemas, ledger, request and split state machines, audience rules, transfer timing and fee. Optional read-only renderer with three views (activity, person, split). | All six workflows run end to end with cancel, decline and error paths; the six core examples pass as business tests. | 4–5 |
| Data and image collection | N/A. No real users, payments or notes are collected. | Provenance record stating all content is synthetic. | 0 |
| Synthetic data and assets | One reusable fixture: 14 profiles including two near-identical names, a friendship graph, about 80 past payments and requests with notes and mixed audiences, 2 open splits, a balance and a linked bank balance. Tasks may replace it. | Balances reconcile to the ledger; every split's shares sum to its total; dates are ordered; no real names or handles. | 1.5–2 |
| App integrations | Optional Mail notification for four events; external references as stored IDs. | A `request.paid` event produces one message in the receiving Mail, verified from Mail's state and receipt; behavior is otherwise identical without Mail. | 1–2 |
| Validation and reset | Business tests for search, previews, sends, insufficient funds, requests, reminders, splits with partial payment, audience changes, blocks, transfers and fees, stale versions and event replay. Public-runtime checks over separate Agent and Infra connections. | `npm test` and `app:verify` reports with exact versions; repeated reset gives identical state; management calls are rejected for the Agent; workflow-to-test mapping. | 2–3 |

- **Milestones, owners and dependencies (required):** Huawei Lin ([@huawei-lin](https://github.com/huawei-lin)) owns all workstreams. **M0:** design review and tool names. **M1:** ledger, workflows 1–3, fixture. **M2:** workflows 4–6 and events. **M3:** Mail notification, runtime verification, evidence. About 3 weeks part-time once the runtime contract is available. Blocking dependency: the runtime in PR #12. Related: Finance #6; companion ski-trip Task proposal (TBD).
- **Resources and total effort (required):** 8.5–12 person-days; under $10 in model usage for fixture notes; no GPU, paid data or hosting.
- **Scope boundary and open questions (required):** Excluded: sign-in; card numbers and bank credentials; payments to businesses and purchase protection; a physical or virtual card; credit, crypto and investing; currency conversion; fraud scoring; any suggestion of who owes what. Open questions for design review: (1) should other people's replies be task-scheduled events only, or may a task attach a scripted responder that reacts to what the agent sent; (2) which layer enforces user approval before money moves; (3) will a shared Contacts App exist, and should PalePay profiles reference it; (4) is one currency acceptable for the first version?
- **License and external dependencies (required):** Code under MIT. All people, handles, notes and amounts are original synthetic content; no real person or account is reproduced. Venmo and Alipay are cited only as public interaction references. No external service at run time.
