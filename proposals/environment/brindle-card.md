# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Money & insurance] Brindle Card credit card account: bill, payments, refunds and disputes, offers and points`

I checked this proposal against the public runtime on `main` (release 1.6.0, Core API 1.2.0, commit `61b6371`). The issuer, merchants, people and loyalty programs are synthetic, and no affiliation is claimed.

## 1. App and domains

- **Authors / GitHub handles (required):** Shubhashis Roy Dipta (@dipta007)
- **Reference app or website / URL (required):** Brindle Card, an independently branded synthetic credit card account at a fictional issuer. Workflow references: the Consumer Financial Protection Bureau's credit card pages (https://www.consumerfinance.gov/consumer-tools/credit-cards/) and Regulation Z, section 1026.13, on billing error resolution (https://www.consumerfinance.gov/rules-policy/regulations/1026/13/). No data, text, branding or icons are reused.
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** Brindle Card is a resettable credit card account, seen from one cardholder's account. Money that appears on the card is not always money the person keeps. A refund can be partial. The issuer's credit during a dispute is temporary. An offer has conditions. Closing the account loses the points. So the account can accept a step that is wrong for this person, and a balance that looks settled may not be settled. A task can check whether the agent saw the difference.

Scope of one App instance:

- It holds one cardholder account with one card at one fictional issuer.
- Merchants and the issuer's staff are not accounts. What they do arrives as task-supplied events.
- A purchase arrives already approved. Brindle does not approve or decline purchases, and it has no spend controls.
- Brindle has no card number, interest formula or credit score. Interest and fees are amounts that the issuer posts.
- Money does not move. A payment is a record, and the bank account that pays it is a label.
- The issuer's service desk and the partner programs for points are outside the App.
- A day is a calendar day in the issuer's time zone.
- A transaction has a kind: `purchase`, `refund`, `fee`, `interest`, `credit`, `provisional_credit` or `reversal`. A `provisional_credit` is the issuer's temporary credit during a dispute, and a `reversal` takes it back.
- The issuer has four rule values: `dispute_window_days`, `fee_refund_days`, `redeem_cents_per_point` and `min_redeem_points`.

Four workflows are complete in the first version.

1. **W1 The account, the bill and activity (read only).**
   - `account.get` returns the product, the credit limit, the state, the balances, the latest statement with what has been paid toward it, the autopay setting, the points balance and the flags. It also returns the issuer's four rule values, so the agent knows each limit before it writes.
   - The agent lists transactions in a window of transaction time, by kind, state or merchant. The list filters and sorts by transaction time only.
   - `transactions.get` returns one transaction with everything that relates to it and its recovery summary.
   - `rewards.get` returns the points balance, the points entries and the transfer partners, each with its ratio, smallest amount and step.
   - `account.close_preview` writes nothing and returns what a closing would do now: the points lost, whether an annual fee would be refunded and until when, the offers that would end, the accepted offers whose bonus points have not arrived, and what stays open.
2. **W2 Payments, autopay and preferences.**
   - The agent schedules a payment for today or a later day, from a named source. The amount is a fixed amount, the minimum due, the statement balance or the current balance. `account.get` shows the bill and what each choice would pay.
   - A payment is not edited: the agent cancels it while it is `scheduled` and schedules another. An autopay payment can be cancelled in the same way. This stops that one payment only: the autopay setting stays, and no new payment is scheduled for that statement.
   - The agent sets autopay to off, the minimum due or the statement balance. A new setting does not touch a payment that is already scheduled.
   - The agent sets the preferences: the time zone used in notification text, and `email_notices`.
3. **W3 Refunds, disputes and temporary credits.**
   - A merchant's refund posts as a transaction that relates to the purchase.
   - The agent disputes a posted purchase for an amount, with a reason and a note.
   - A dispute is not edited: the agent withdraws it while it is `open` and opens another.
4. **W4 The annual fee, offers, points and closing.**
   - An offer from the issuer arrives as an event: a statement credit, a credit after a spending target, bonus points, or a change to another product. The agent accepts or declines it.
   - The agent redeems points as a statement credit, transfers points to a partner program, or closes the account.
   - None of these writes can be changed or undone.

The table lists the 14 App errors. A call that returns an error changes nothing. Where two errors fit one call, Brindle returns the one that comes first in the table.

| Error | Returned when |
| :--- | :--- |
| `not_found` | The ID of an object or of a transfer partner is unknown. |
| `invalid_state` | The agent calls `payments.cancel` on a `cancelled` or `returned` payment, `disputes.withdraw` on a dispute that is not `open`, or `offers.accept` or `offers.decline` on an `enrolled`, `declined` or `unavailable` offer. A closed account also returns it for `autopay.set` and for every write of W4. |
| `invalid_timezone` | The time zone in `preferences.update` is unknown. |
| `invalid_window` | A window ends before it starts, or the day of a payment is before today. |
| `no_statement` | The minimum due or the statement balance is asked for, and the account has no statement. |
| `nothing_due` | The minimum due or the statement balance is asked for and is already paid, or the current balance is asked for and is zero or below. |
| `over_balance` | The new payment would take the total of the `scheduled` manual payments above the current balance. Autopay payments are not in that total. |
| `not_disputable` | The transaction is not a posted purchase, or it is already refunded in full (its `net_charge` is not above zero). |
| `over_net` | The amount of a dispute is above the `net_charge` of the purchase. |
| `already_disputed` | The purchase has an open dispute, or a dispute that the issuer has ended. |
| `too_late` | The agent calls `payments.cancel` on a `posted` or `skipped` payment, `disputes.open` later than `dispute_window_days` after the purchase posted, or `offers.accept` or `offers.decline` on an `expired` offer. |
| `insufficient_points` | A redemption or a transfer asks for more points than the balance. |
| `below_minimum` | A redemption is below `min_redeem_points`, or a transfer is below the partner's smallest amount. |
| `invalid_increment` | A transfer is not a whole number of the partner's steps. |

The table lists the states of each object and what moves them.

| Object | States | What moves it |
| :--- | :--- | :--- |
| Transaction | `pending`, `posted`, `dropped` | `transaction.posted` adds it as `pending` or `posted`, or makes a pending one `posted` with its final amount. `transaction.dropped` makes a pending one `dropped`. |
| Payment | `scheduled`, `posted`, `skipped`, `cancelled`, `returned` | `payments.schedule` makes it `scheduled`, and so does `statement.issued` while autopay is on. `payments.cancel` makes it `cancelled`. The clock makes it `posted` at the start of its day, or `skipped` by the Autopay rule. `payment.returned` makes a posted payment `returned`. |
| Dispute | `open`, `withdrawn`, `resolved_for_me`, `resolved_for_merchant`, `closed_matched` | `disputes.open` makes it `open`. `disputes.withdraw` makes it `withdrawn`. `dispute.updated` with a final status makes it `resolved_for_me`, `resolved_for_merchant` or `closed_matched`. |
| Offer | `available`, `enrolled`, `declined`, `expired`, `unavailable` | `offer.issued` makes it `available`. `offers.accept` makes it `enrolled` and makes the other available offers of its group `unavailable`. `offers.decline` makes it `declined` and changes no other offer. Only an `available` offer reads `expired` when the clock reaches its `accept_by`. `account.close` makes an available offer `unavailable`. |
| Account | `open`, `closed` | `offers.accept` on a product-change offer moves the open account to the new product at once. `account.close` makes it `closed`. |

Rules:

- **Time.**
  - Brindle has no timers, no scheduler and no clock event. Infra moves `virtual_now` with an event or with Core's `env.advance_time`, which runs no App code.
  - So every time-based state is stored as a due time, and Brindle computes it from `ctx.virtual_now` each time it is read or checked. This holds for `posted`, `skipped` and `expired`, for the windows and deadlines in these rules, and for a statement's due time.
  - Writes, events and the validation of the seed use the same computation, so an offer counts as `available` only before its `accept_by`. Nothing is rewritten when a due time passes.
  - Every read returns the current virtual time as `now`, with the issuer's UTC offset. So the agent can compare it with any due time before it writes.
- **Day limits.**
  - A limit of N days starts at a moment. It ends at the end of the calendar day that is N days after the day of that moment. This is the rule for `dispute_window_days`, `fee_refund_days` and the spending window of an offer.
  - A payment scheduled for today posts at once.
  - A transaction has two times. Lists use its transaction time, and the dispute window and the fee refund window count from its posting time.
- **The balance.** Brindle computes it when it is read.
  - The balance is the posted purchases, fees, interest and reversals, minus the posted refunds, credits and temporary credits, minus the payments that posted and were not returned.
  - `pending_total` is the sum of the pending purchases. `available_credit` is the credit limit minus the balance and `pending_total`.
- **The bill.**
  - `paid_toward` a statement is the sum of the payments that posted after its closing time and were not returned.
  - When the due time has passed and the balance is above zero, the account reads `past_due` if `paid_toward` is below the minimum due. It reads `statement_unpaid` if `paid_toward` reaches the minimum due and is below the statement balance.
- **Payments.** The scheduled amount of a payment is set when it is scheduled. A minimum-due or statement-balance payment takes only the part of the latest statement's amount that `paid_toward` has not covered at that moment. A manual payment keeps its scheduled amount. An autopay payment also has a posted amount, and the balance and `paid_toward` use the posted amount.
- **Autopay.**
  - When a statement is issued while autopay is on, the handler schedules one autopay payment for the day of the statement's due time. Its scheduled amount is the minimum due or the statement balance of that statement, and the `over_balance` limit does not apply to it. If that amount is zero or less, the handler schedules no payment.
  - Turning autopay on later schedules nothing for a statement that is already issued.
  - The posted amount of an autopay payment is its scheduled amount minus what other payments paid toward that statement before the start of its day. The payment reads `skipped` if that leaves nothing. A payment on the same day, or a return after that day, does not change the posted amount.
- **The recovery summary.** Brindle computes it when a purchase is read, from the transactions that relate to the purchase.
  - The outstanding credit of a dispute is its temporary credits minus its reversals, and never below zero.
  - `refunded_final` is the merchant's posted refunds, plus the outstanding credit of a dispute that ended `resolved_for_me`.
  - `temporary_credit` is the outstanding credit of all other disputes. So the credit of a withdrawn dispute stays temporary until the issuer reverses it.
  - `net_charge` is the purchase amount minus `refunded_final`. It does not count `temporary_credit`.
- **Disputes.**
  - A dispute ends in one of four ways: a withdrawal, a decision for the account holder (the temporary credit stays), a decision for the merchant (the issuer reverses the credit), or a merchant refund that the issuer closes as matched (the issuer reverses the credit).
  - A temporary credit arrives only with `dispute.updated`. A reversal arrives with `dispute.updated` while the dispute is open, and with `transaction.posted` after it has ended. Section 3 rejects any other path.
  - A purchase can be disputed again after a withdrawal.
- **Offers.**
  - The issuer pays an accepted statement credit or bonus as a later transaction or points entry that names the offer.
  - An accepted spending offer shows its progress against the target, computed when read. The progress is the purchases posted from the acceptance to the deadline, minus the refunds of those purchases that posted by the deadline.
  - Before the deadline its condition is `met` while the target is reached, and `open` while it is not. After the deadline it stays `met` or `missed` by the progress at the deadline, and a later refund changes nothing.
- **Points.**
  - `rewards.redeem` takes the points off the balance and at once posts a credit of that many points times `redeem_cents_per_point`.
  - `rewards.transfer` takes the points off the balance. It records the partner, the member name given and the points the partner will receive by its ratio.
- **Closing.** `account.close` cannot be undone.
  - It forfeits the whole points balance with one points entry, turns autopay off and leaves scheduled payments in place. On a closed account, a spending condition that would read `open` reads `missed`.
  - It records whether an annual fee is to be refunded. That fee is the latest fee of the type `annual`, and it is refunded if the closing is within `fee_refund_days` of its posting time. An accepted change to a product with no annual fee follows the same rule.
  - The refund of a fee is recorded as due once, so a closing after such a product change records nothing more. The issuer posts the refund itself, as a `credit` transaction that relates to the fee.
  - A closed account takes no points, so the bonus points of an accepted offer that the issuer has not yet added are lost. A credit that the issuer still owes can post after the closing.
  - After the closing, payments and disputes go on as before.
- **Other people's acts.** The issuer and the merchants are not checked against these rules. Brindle rejects only the events listed in section 3 and applies every other event as given. So a purchase can be credited twice for a time, and a flag says so.
- **Flags.** They are computed when read and never stored.
  - On the account: `past_due`, `statement_unpaid`, `payment_returned` (a payment toward the latest statement was returned), `credit_balance` (the balance is below zero) and `fee_refund_open` (closing today would refund an annual fee).
  - On a purchase: `disputed` (it has an open dispute), `temporary_credit` (its `temporary_credit` is above zero) and `double_credited` (`refunded_final` plus `temporary_credit` is more than the purchase amount).
  - On an accepted spending offer: `condition_met` and `condition_missed`.
- **Notifications.** Brindle writes one notification for each event, named after the event. `notifications.list` shows it as soon as it is written. Two events write none: `transaction.dropped`, and a `transaction.posted` for a purchase. Brindle writes none for the account holder's own writes or for a change that time alone causes.

Illustrative uses, not Task Track submissions:

- A merchant refunds part of a charge and promises the rest. The agent must dispute only the unpaid part, and must tell the issuer's temporary credit from a final refund. Task #107 meets this problem and plans task-owned merchant and issuer fixtures for it.
- The annual fee has posted, and the issuer makes three offers. The person's earlier words allow one, forbid a spending target and reserve any closing or change of product. Task #133 meets this problem and plans a task-owned service desk and issuer ledger.
- The bill is due tomorrow, autopay pays only the minimum, and last month's payment was returned.

No Task proposal depends on Brindle, and both tasks can keep their own fixtures.

**Boundaries and overlap.** I checked the proposal list on 2026-11-22.

- The nearest is #87 (Keelcard), and the two share a part. Both have card transactions with pending and settled amounts, refunds tied to a transaction, disputes and a monthly statement. Brindle uses the same error names where the case is the same (`not_disputable`, `already_disputed`). Keelcard is a funded virtual card that a person shares with an assistant. It decides each authorization from the owner's spend controls, and its scope leaves out "credit lines and interest, rewards". Brindle is a revolving credit account: a bill with a minimum and a due time, payments and autopay, the issuer's temporary credit during a dispute and its reversal, the annual fee, the issuer's offers, points and closing. A task can use both: Keelcard for the card an agent pays with, and Brindle for the account the person is billed on.
- #6 (Personal Finance Workspace) is a bank and brokerage. In Brindle the bank account that pays the card is only a label.
- #68 (PalePay) moves money between people. #20 (Subscription Exit) cancels one subscription at the merchant. #64 (Larkfield Health) and #46 (Coverline) are insurance.

## 3. Potential app connections

- **Internal personal apps (required):** Brindle uses Mail only, and Mail is optional and send-only. All four workflows complete with Brindle alone.
  - When `email_notices` is on, each notification also carries a plain-text message for the existing receive declaration of Mail 1.3.0 in `examples/apps/mail`: channel `channel.email`, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, receiver operation `mail.receive_notification`. I reviewed it at `main` commit `61b6371` ([wire schema](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b6371/examples/apps/mail/schemas/router-message.schema.json)).
  - Brindle declares the matching `messaging.publishes` entry and builds no inbox.
  - Calendar 1.3.0 has no messaging receiver, and Brindle never reads or writes it.
  - Messages 1.0.0 has a `channel.chat` receiver, which Brindle does not use, because it sends no chat messages.
  - Brindle does not use Contacts, Files, Notes or Tasks 1.0.0.
- **Other apps and websites (required):** None: no external website, issuer, card network, bank, merchant or loyalty program is called at run time.

### Integration details

- **Operations and access (required):** Brindle has 25 Agent-facing MCP operations over stdio, on the Agent connection of the public host (`node runtime/cli.cjs serve --app apps/brindle --role agent`). They are registered in `tools.json` as `brindle.<name>`.
  - Read (14): `account.get`, `account.close_preview`, `transactions.list`, `transactions.get`, `statements.list`, `statements.get`, `payments.list`, `disputes.list`, `disputes.get`, `offers.list`, `offers.get`, `rewards.get`, `notifications.list`, `preferences.get`.
  - Write (11): `payments.schedule`, `payments.cancel`, `autopay.set`, `disputes.open`, `disputes.withdraw`, `offers.accept`, `offers.decline`, `rewards.redeem`, `rewards.transfer`, `account.close`, `preferences.update`.
  - Every write takes Core's `request_id` and `expected_version` and returns the object's `id` with the committed version.
  - Every read returns `now`, the current virtual time.
  - The target object is always the argument `id`, and a time window is always `start` and `end`. The reference host's audit projection at `61b6371` keeps these three inputs, so its rows show the object and the window of every call, reads included.
  - Where an operation creates an object or acts on the account, `id` is the account for `payments.schedule`, `autopay.set`, `rewards.redeem`, `rewards.transfer` and `account.close`, and the purchase for `disputes.open`.
  - The Agent acts as the bound account holder set by Infra, never through an argument. A task can restrict the allowed tools with `policies.json`.
  - The 14 App errors are listed in section 2. Core adds `invalid_arguments`, `permission_denied`, `stale_version` and `idempotency_conflict`. The input schemas reject an amount or a number of points of zero or less, a fixed payment with no amount, and a transfer with no member name. So Core returns `invalid_arguments` for these before any App error.
  - Infra-only operations: `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and the host's clock operation `env.advance_time`. They are not listed on the Agent connection. Core returns `permission_denied` if the Agent calls them.
  - The first version has no GUI, no reviewer console, and no console for the issuer or a merchant.
- **State and lifecycle (required):** State is separate per run and App instance, and one instance holds one account (`isolation_keys: run_id, app_id`).
  - A task loads its own seed and starting time with `env.load_seed`. The seed has issuer records (time zone, rules, products with their transfer partners) and account records (the account, statements, transactions, payments, disputes, offers, points entries, preferences, notifications and activity rows).
  - So a task can start from any history, such as a dispute in any state, a past-due account or a closed account. The seed is history, and new facts arrive only through events.
  - `validateSeed` rejects a seed with `invalid_seed` for any of these:
    - duplicate IDs, a reference to an object that does not exist, a timestamp without a UTC offset, or an account that the binding does not declare;
    - a refund, temporary credit or reversal that relates to no purchase, or a temporary credit or reversal that names no dispute;
    - two open disputes on one purchase, a dispute opened on a purchase after the issuer ended an earlier one, or a dispute on a transaction that is not a posted purchase;
    - two enrolled offers in one group, or a points balance below zero;
    - a payment with an amount of zero or less, or a statement whose due time is before its closing time.
  - Writes follow Core: an exact repeat of a committed `request_id` or `event_id` returns the stored receipt marked `duplicate` and makes no second change. The same ID with different input returns `idempotency_conflict`. A stale `expected_version` returns `stale_version`. A failed call leaves data, version and notifications unchanged, and a read never changes business data.
  - Reset is Core's: it restores the loaded seed and the time loaded with it, for this App instance only (`reset_scope: app_instance`). Messages already delivered to Mail stay there.
  - Evaluator records come from three places. They join on `request_id`, `event_id` and version.
    - App state in `env.snapshot` has activity rows with sequence, virtual time, actor `agent` or `event`, action, object ID and the `request_id` or `event_id` behind them. There is one row for every committed Agent write, one for every applied event and one for each effect of an event. The effects of a write are in the records it changes: the snapshot also has the history of each transaction, payment, dispute, offer and points entry.
    - Core audit rows carry the projected `id`, `start` and `end`. There is one row for every allowed business call and every `env.advance_time` that is not a replay, and one for every denied call.
    - The supplied Agent execution trace has the full arguments and results.
  - Counting rules:
    - A replay returns the stored receipt before an audit row is written, so it appears only in the trace and counts as a retry of the original.
    - A rejected attempt writes no activity row, so it is counted from the denial rows and the trace.
    - A time-driven change runs no App code and writes no row, so it is read from the stored due times and the clock.
    - The snapshot is taken before a reset, because reset clears the audit.
- **Events and notifications (required):** Brindle has seven events. They arrive through `env.apply_event`, in Core's envelope. An event is handled at its own time, which is `ctx.virtual_now` inside the handler.
  - Core rejects an event dated before the App's current time (`invalid_event`). Core also validates the data after every event with the same rules as the seed.
  - Brindle also rejects the events below, with `invalid_event` and state unchanged:
    - a duplicate ID, with one exception: a `posted` event for a transaction that is `pending` reuses its ID;
    - an unknown reference;
    - a posted transaction with an amount of zero or less;
    - a temporary credit sent with `transaction.posted`, or a reversal sent with `transaction.posted` for a dispute that is still open;
    - a drop of a transaction that is not pending;
    - a return of a payment that is not `posted`;
    - an update to a dispute that is not `open`;
    - an offer issued to a closed account, or into a group that already has an enrolled offer;
    - a points change that adds points to a closed account.

  | Event | Example (`at` carries the UTC offset) | Effect |
  | :--- | :--- | :--- |
  | `brindle.transaction.posted` | `{"event_id":"ev-br-301","at":"2026-11-09T06:10:00-05:00","operation":"brindle.transaction.posted","payload":{"transaction_id":"txn-0431","kind":"refund","state":"posted","amount":20.00,"merchant":"Ironworks Gym","relates_to":"txn-0412","note":"Partial refund"}}` | A transaction is added or posted, as the states table says. Its transaction time is the one the event names, or the event's time. Its posting time is the event's time when it posts. A fee carries its type, `annual` or `other`. |
  | `brindle.transaction.dropped` | `{"event_id":"ev-br-302","at":"2026-11-12T03:00:00-05:00","operation":"brindle.transaction.dropped","payload":{"transaction_id":"txn-0440","reason":"The hold was released by the merchant."}}` | The pending transaction becomes `dropped` and leaves `pending_total`. |
  | `brindle.statement.issued` | `{"event_id":"ev-br-310","at":"2026-12-01T02:00:00-05:00","operation":"brindle.statement.issued","payload":{"statement_id":"stm-2026-11","closing_at":"2026-11-30T23:59:59-05:00","statement_balance":1240.00,"minimum_due":35.00,"due_at":"2026-12-26T17:00:00-05:00"}}` | A statement is added. If autopay is on, the Autopay rule schedules one payment for the day of `due_at`. |
  | `brindle.payment.returned` | `{"event_id":"ev-br-320","at":"2026-12-22T09:30:00-05:00","operation":"brindle.payment.returned","payload":{"payment_id":"pay-0061","reason":"The bank account did not have enough money."}}` | The posted payment becomes `returned` and leaves the balance and `paid_toward`. |
  | `brindle.dispute.updated` | `{"event_id":"ev-br-330","at":"2026-11-16T08:05:00-05:00","operation":"brindle.dispute.updated","payload":{"dispute_id":"dsp-0009","status":"open","provisional_credit":{"transaction_id":"txn-0450","amount":40.00},"note":"Temporary credit while we review."}}` | The open dispute takes the status (`open`, `resolved_for_me`, `resolved_for_merchant` or `closed_matched`), with a history row. A temporary credit or a reversal in the event is posted as a transaction that relates to the purchase and names the dispute. |
  | `brindle.offer.issued` | `{"event_id":"ev-br-340","at":"2026-12-03T15:20:00-05:00","operation":"brindle.offer.issued","payload":{"offer_id":"off-0021","kind":"spend_credit","group":"retention-2026-12","credit_amount":300.00,"spend_target":3000.00,"spend_days":90,"accept_by":"2026-12-10T23:59:59-05:00","terms":"A statement credit of 300.00 after 3,000.00 in purchases within 90 days of accepting."}}` | An offer is added as `available`, with its kind (`statement_credit`, `spend_credit`, `bonus_points` or `product_change`), its terms, its group and its `accept_by`. |
  | `brindle.points.adjusted` | `{"event_id":"ev-br-350","at":"2026-12-02T04:00:00-05:00","operation":"brindle.points.adjusted","payload":{"entry_id":"pts-0207","points":1240,"reason":"earned","note":"Points for the November statement."}}` | A points entry is added, and the balance changes by that many points, up or down. An entry may name the offer it pays. |

  - Brindle publishes `channel.email` only, and it receives no messages.
  - When `email_notices` is on at the moment a notification is written, the App stores the full wire message with it.
  - An Infra-run sender in the package sends the messages. It is an outbound adapter that Infra runs with its own Infra and publisher connections. Infra runs one sender for the whole run. It reads notifications through `env.snapshot` and calls `router.publish`, the call that Mail's `src/publisher.cjs` uses. A delivery needs a Mail account bound in the run and an Infra grant for `channel.email`. Without them, the router rejects it before dispatch.
  - Infra chooses when to run the sender, and it waits for each result before it moves the clock. Mail records the message at Mail's own virtual time.
  - The sender publishes each notification that has a stored wire message, once. It never sends a notification that was in the loaded seed: it notes the seed's notification IDs when it starts.
  - The message `id` and the `request_id` are the notification ID. So publishing the same notification again is an identical retry: the router returns the first receipt, marked `duplicate`, and Mail keeps one inbox record.
  - The sender does not write back into Brindle, so no cross-App transaction is assumed. A delivery rejected before dispatch creates no Mail record. If the receiver rejects the message, or its answer is unknown, the router halts the run for inspection. None of these rolls back Brindle.
  - The message below is an example notification as a full wire message. I validated it against Mail's `urn:pale:email-message:2` schema at `61b6371` with `runtime/contracts/schema-validator.cjs`: it passes, and two broken variants fail. This is a schema check, not a completed integration test. `{"specversion":"1.0","id":"ntf-0058","source":"urn:pale:app:brindle:account:brindle-riley","type":"org.pale.mail.notification.v1","time":"2026-11-16T08:05:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-riley"},"source_object":{"app_id":"brindle","account_id":"brindle-riley","object_type":"dispute","object_id":"dsp-0009"},"content":{"title":"We added a temporary credit of 40.00 while we review your dispute","body":{"format":"text/plain","text":"Brindle Card added a temporary credit of 40.00 for your dispute dsp-0009 about the charge of 60.00 from Ironworks Gym on 2 November. The credit is not final. If the merchant refunds you, or the review ends in the merchant's favor, we will take the temporary credit back. Your dispute is still open."},"asset_ids":[]},"subscription_ref":"brindle-riley:dispute-updates","extensions":[]}}`
- **Shared data and dependencies (required):** Every object has a stable ID. Brindle is the source of truth for its bill, transactions, payments, disputes, offers and points. It keeps no copy of another App's records.
  - The account's `account_id` and `owner_person_id` are the shared values of the run's `binding.json`. So the person has one ID in Brindle and Mail, and notifications address the recipient by `person_ref`.
  - Missing data is explicit. An unknown ID returns `not_found`. An account with no statement has `latest_statement: null` and reads no `past_due`. A purchase with nothing related to it has a `refunded_final` and a `temporary_credit` of zero. A product with no annual fee has `annual_fee: null` and no fee refund. A product with no transfer partners has an empty list. Accepting an offer with no group changes no other offer.
  - All records are JSON. There are no images, audio, video or attachments (`capabilities.resources: false`, 0 of the profile's 64 assets).
  - Brindle needs only the public Core/Messaging runtime 1.6.0 (Core API 1.2.0) at `main` commit `61b6371`: `dependencies.required_apps` is empty, and there is no external service.
  - The package runs on its own: a copy that holds only `apps/brindle/` and the pinned runtime starts the App, and it imports nothing outside its own folder.
  - Days use IANA time zones through Node's built-in `Intl`.
  - Amounts are numbers with two decimals in one currency, kept as integer cents inside the App. Points are whole numbers.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `apps/brindle/` per the App contribution guide: 25 operations, the states and rules of section 2, time-based states computed from the environment clock, and the activity log. It reuses the reference package layout, the generated shared schemas, the launcher and the reference test-harness pattern. | Every transition and rule in section 2 works. A read leaves the business data in `env.snapshot` byte-identical. A failed call or event leaves state unchanged. | 4 to 5 |
| Data and image collection | Not applicable: nothing is crawled or copied, and the public workflow references are recorded. | Provenance is recorded in `contribution/dataset.json`. | 0.25 |
| Synthetic data and assets | The fixtures are authored JSON, with no generator at run time: 1 fictional issuer with its four rules; 2 products (one with an annual fee and 3 transfer partners, one with no fee); 1 account with 13 statements; 180 transactions (12 pending, 9 refunds, 2 annual fees, 6 credits, 3 temporary credits and 2 reversals among them); 16 payments (3 autopay, 2 returned, 1 cancelled and 1 skipped among them); 5 disputes that cover every state; 7 offers that cover every kind and state; 30 points entries; 24 notifications. These stay as smoke and task fixtures.<br>**Delivery dataset, 2025-01-01 to 2026-12-31, fully synthetic.** Brindle models no real issuer or website, so there is no real source data to anchor (open question 5). A seeded script (`apps/brindle/dev/generate-dataset.cjs`) writes two years of one cardholder's account history from authored merchant and spending templates with varied amounts and timing: 24 statements, about 1,400 transactions (groceries, fuel, dining, travel, subscriptions and a few refunds, fees and credits), about 30 payments with autopay, a returned payment and a skipped autopay, about 8 disputes in every state, about 15 offers, two annual fees, the points entries with transfers, and the notifications. Each record kind has one date for the coverage count, and the report names its schema field: the transaction date, the statement closing date, the payment date, the date a dispute was opened, the date an offer was presented, the date of a points entry, and the release time of a notification. A selection script writes a seed as of a given time, with only the records before that time and each record in its state at that time. So a task never receives later records as history. | The seed passes validation. A consistency script checks that every statement balance, recovery summary, points balance, payment state and flag follows from the records. The fixtures contain no real people, issuers, merchants, card numbers or loyalty programs.<br>For the delivery dataset: seeds selected at the start of each month of the window pass validation and the consistency script. A reproducible coverage report gives records and distinct dates by month and record kind, in the issuer's time zone (`America/New_York`), with gaps listed and the global count of distinct dates. Every record is labelled synthetic in `contribution/dataset.json`, with the generator version and file hashes. One selected seed is loaded through `env.load_seed` and read through MCP. | 2 to 2.5 |
| App integrations | The optional Mail notifications need the wire-message builder, the `messaging.publishes` declaration and the Infra-run sender script. | Example messages pass Mail's wire schema. A notification appears as a received message in the bound Mail account with a committed receipt. An identical retry returns the first receipt and leaves one inbox record. Without a grant the delivery is rejected and Mail has no record. | 0.5 to 0.75 |
| Validation and reset | The validation has five parts: the local business tests T01 to T20 (table below); the public verifier (`npm run app:verify -- --app apps/brindle`); a package real-MCP script for what the verifier does not exercise (a task seed with `virtual_now`, time moved with `env.advance_time` and no App event, a failed call that changes nothing, replays, and reset to the loaded time), and for loading and querying a seed from the delivery dataset; one Brindle to Mail flow; and the repository `npm test`, which must stay green. | After implementation, the PR gives the exact App, runtime and Mail versions, the commands, reproducible reports, the dataset coverage report and a workflow-to-test mapping. It also lists the remaining manual review: the realism of the issuer rules, the amounts, the offer terms and the notification wording. | 2 to 2.5 |

**Acceptance plan.** Each row gives a main path (initial state → action or event → expected result) and controls. A control that returns an error must leave state unchanged. These are planned tests, not implementation results.

| Workflow | Main path | Control | Tests |
| :--- | :--- | :--- | :--- |
| W1 The account, the bill and activity | With a credit limit of 8,000, a statement of 1,240.00 (minimum 35.00, due on 26 December), a purchase of 210.00 posted since and a hotel hold of 300.00 pending, `account.get` reads a balance of 1,450.00, a `pending_total` of 300.00, an `available_credit` of 6,250.00 and 0 paid toward the statement.<br>In a second fixture, on 5 December, with `fee_refund_days` of 30, an annual fee of 550.00 posted on 1 December and 12,000 points, `account.close_preview` reads a fee refund of 550.00 until 31 December and 12,000 points lost. | An unknown transaction → `not_found`.<br>A window that ends before it starts → `invalid_window`.<br>The business data in `env.snapshot` is byte-identical after every read, `account.close_preview` included. | T01 to T04: the account, transactions and the recovery summary, the other reads, `account.close_preview` |
| W2 Payments, autopay and preferences | On 10 December, `payments.schedule` for the statement balance on 20 December → `scheduled` for 1,240.00.<br>After `env.advance_time` to 20 December, with no App event, it reads `posted`, the balance is 210.00 and the statement is paid in full.<br>With autopay set to the minimum due, the next `statement.issued` (balance 210.00, minimum 35.00, due on 26 January) schedules an autopay payment of 35.00 for 26 January.<br>A manual payment of 100.00 posts on 10 January, and on 26 January the autopay payment reads `skipped`. | A payment for yesterday → `invalid_window`.<br>A payment of 2,000.00 against a balance of 1,450.00 → `over_balance`.<br>The minimum due asked for on an account with no statement → `no_statement`.<br>The statement balance asked for after the statement is paid in full → `nothing_due`.<br>`payments.cancel` on 19 December, before the payment's day → `cancelled`.<br>A cancellation on the payment's day → `too_late`.<br>`preferences.update` with an unknown time zone → `invalid_timezone`.<br>`payment.returned` on the posted payment → `returned`, the balance is 1,450.00 again and the account reads `payment_returned`.<br>With nothing paid when the due time passes, the account reads `past_due` after `env.advance_time`. | T05 to T09: `payments.schedule`, `payments.cancel`, autopay, the bill, `preferences.update` |
| W3 Refunds, disputes and temporary credits | A gym purchase of 60.00 posts on 2 November, and a refund of 20.00 posts on 9 November → `refunded_final` 20.00 and `net_charge` 40.00.<br>`disputes.open` for 40.00 on 13 November → `open`.<br>`dispute.updated` with a temporary credit of 40.00 → `temporary_credit` 40.00 and `net_charge` still 40.00.<br>The merchant's refund of 40.00 posts → `refunded_final` 60.00, `net_charge` 0 and the flag `double_credited`.<br>`dispute.updated` with `closed_matched` and a reversal of 40.00 → `temporary_credit` 0 and no flag. | A dispute for 50.00 when `net_charge` is 40.00 → `over_net`.<br>A dispute on the pending hotel hold → `not_disputable`.<br>A second dispute on the gym purchase while the first is open → `already_disputed`.<br>A dispute 61 days after a purchase posted, with a window of 60 → `too_late`.<br>On another run, `disputes.withdraw` after the temporary credit → `withdrawn`, and `temporary_credit` stays 40.00 until a reversal posts. | T10 to T13: refunds, `disputes.open` and `disputes.withdraw`, temporary credits and reversals |
| W4 The annual fee, offers, points and closing | The account has 12,000 points. `offer.issued` adds three offers in one group: a credit of 150.00, a credit of 300.00 after 3,000.00 of purchases in 90 days, and a change to a product with no fee.<br>`offers.accept` on the first → `enrolled`, and the other two read `unavailable`. The credit of 150.00 then posts as a transaction that names the offer.<br>`rewards.redeem` for 10,000 points at 1 cent each → a credit of 100.00 and 2,000 points left.<br>`rewards.transfer` of 2,000 points to a partner with a step of 1,000 → 0 points left.<br>On another run, from the second fixture of W1, `account.close` on 5 December → `closed`, one points entry forfeits 12,000 points, and the fee refund of 550.00 is recorded as due. | `offers.accept` after `accept_by` → `too_late`.<br>`offers.accept` on the second offer after the first is enrolled → `invalid_state`.<br>A redemption of 500 points under a minimum of 1,000 → `below_minimum`.<br>A transfer of 1,500 of the 12,000 points, above the partner's smallest amount, with a step of 1,000 → `invalid_increment`.<br>A redemption of 13,000 points with 12,000 → `insufficient_points`.<br>`rewards.redeem` after the closing → `invalid_state`.<br>A closing on 2 January, 32 days after the fee posted, with `fee_refund_days` of 30, records no fee refund.<br>On another run, `offers.decline` on the third offer → `declined`, and the other two stay `available`. | T14 to T18: `offers.accept` and `offers.decline`, a spending offer, a product change, points, closing |
| All: events, the clock and Core contracts | After `env.advance_time` and no App event, a payment reads `posted`, an offer reads `expired` and a window has closed. Business data is unchanged.<br>Reset restores the loaded seed and time.<br>Activity rows match the rules of section 3. | Each invalid event listed in section 3 → `invalid_event`, state unchanged.<br>A repeated `request_id` returns the stored receipt and schedules no second payment.<br>Changed input → `idempotency_conflict`.<br>A stale version → `stale_version`.<br>The Agent calling `env.apply_event`, `env.reset` or `env.advance_time` → `permission_denied`. | T19 to T20: events, notifications, the clock, Core contracts |

Every App error of section 2 has at least one test in T01 to T20. T21 checks the delivery dataset: the selected seeds load, the consistency script passes, and the coverage report reproduces.

- **Milestones, owners and dependencies (required):** The author owns every milestone. Nothing blocks the first version: the public runtime 1.6.0, with its clock operation, and Mail 1.3.0 exist at `61b6371`.
  - M0: design review in this PR.
  - M1 (days 1 to 4 after plan approval): package skeleton, schemas, seed validation, W1 with the balance, the bill and the recovery summary, T01 to T04.
  - M2 (days 5 to 9): W2, W3 and W4, the seven events, time-based states, notifications and the activity log, T05 to T20.
  - M3 (days 10 to 12): fixtures, the delivery dataset with its selection script and coverage report (T21), the consistency script, the Mail flow, the public verifier and the real-MCP script.
  - M4 (days 13 to 14): README, workflow-to-test mapping and evidence. Then `/submit-implementation` inside the 14-day first-version deadline.
  - Related: [#87](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/87), [#107](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/107), [#133](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/133), [#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6), [#68](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/68), [#20](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/20).
- **Resources and total effort (required):** The total is 8.75 to 11 person-days. The work needs Node.js 18+ and nothing else: no GPU, no paid data, no model or API cost and no external service. Fixtures stay under 1 MB, and the delivery dataset is kept in its own folder.
- **Scope boundary and open questions (required):** The first version is MCP-only and follows the platform clock.
  - Not in the first version, besides the limits in section 2: declines, virtual cards and delegates (see #87); a late-fee rule; several cards, authorized users or several accounts in one instance; a request for information inside a dispute; a household that pools points, award search and booking; reopening a closed account; the law of any real place; push, SMS and chat channels; a GUI or CUA interface.
  - Open question 1: should Brindle post the credit of an offer at acceptance? The plan: no, because real credits post later and tasks need that gap.
  - Open question 2: should an autopay payment be reduced by payments already made? The plan: yes, as real issuers do.
  - Open question 3: should a closed account refuse payments? The plan: no, because a balance stays payable and disputes go on.
  - Open question 4: do tasks need a request for information inside a dispute? The plan: not in the first version.
  - Open question 5: should the delivery dataset include any real data? The plan: no. Brindle models no real issuer or website, so every record is synthetic and labelled so.
  - Each answer changes only the named part of the plan.
- **License and external dependencies (required):** The code is under the repository's MIT License. The fixtures are synthetic and offered under the same terms. Nothing is hosted, and everything is redistributed in the package. There is no external service at run time. The references are public pages, used only for the shape of the workflows. No agreement text, forms, logos, icons or brand names are copied, and no real issuer, card network, merchant or loyalty program is used.
