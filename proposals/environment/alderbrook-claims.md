# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Money & insurance] Alderbrook Mutual claims portal for auto and renters claims`

I checked this proposal against the public runtime on `main` (release 1.6.0, Core API 1.2.0, commit `61b6371`). The insurer, people, shops, lenders and policies are synthetic, and no affiliation is claimed.

## 1. App and domains

- **Authors / GitHub handles (required):** Shubhashis Roy Dipta (@dipta007)
- **Reference app or website / URL (required):** Alderbrook Mutual claims, an independently branded synthetic insurer's claims portal for auto and renters claims. Workflow references: Progressive's auto claims process (https://www.progressive.com/claims/auto-process/) and California's Fair Claims Settlement Practices Regulations for response time limits (https://www.insurance.ca.gov/01-consumers/130-laws-regs-hearings/05-CCR/fair-claims-regs.cfm). No data, text, branding or icons are reused.
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** Alderbrook Mutual claims is a resettable insurer's claims portal, seen from one policyholder's account. The insurer decides each repair line in writing. One deductible applies to the whole claim. Every answer has a deadline. So the portal can accept a step that is a mistake for this person, given their loan, their repair shop or their household. A task can check whether the agent noticed.

Scope of one App instance:

- It holds one policyholder account at one fictional insurer.
- The adjuster, the repair shop and the lender are not accounts. What they do arrives as task-supplied events.
- A policy is an auto policy or a renters policy, with a term. Each coverage has a deductible (the part the policyholder pays) and an optional limit. A vehicle can have a lienholder (the lender).
- Claims are first-party property claims only: collision and comprehensive on an auto policy, and personal property on a renters policy.
- An evidence item is a record of a photo, receipt, report or statement, with its kind, date and description. It has no file bytes.
- Money does not move: a payment is a record.
- A day is a calendar day in the insurer's time zone. The loss day of a claim is the calendar day of its loss time.
- The insurer has five rule values: `notice_days`, `request_response_days`, `dispute_window_days`, `offer_response_days` and `rental_grace_days`.

Four workflows are complete in the first version.

1. **W1 Policies, claims and money (read only).**
   - The agent reads policies, with their coverages, named insured and listed people, vehicles or insured address, rental benefit and lienholder.
   - `coverage.check` says in advance whether a loss can be claimed, and it writes nothing. For a policy, a coverage, a vehicle or address and a loss time, it returns `covered`, the coverage that applies and its deductible, every rule that a filing would break, and the last day to file.
   - With an estimated amount, it also returns the payment to expect, which is `insurer_owes` for that amount.
   - The agent lists claims by state, policy or coverage, in a window of filing time. The window and the sort order use the filing time, not the loss time.
   - The agent reads one claim with its history, evidence, requests, estimates, the standing decision for each line, disputes, offers, rental periods, payee direction, money summary and flags.
   - The agent reads one estimate with its lines, lists payments in a window of issue time, and reads notifications and preferences.
2. **W2 Filing a claim and answering the insurer.**
   - The agent files a claim on a policy for one coverage, with the loss time, a description, and the vehicle or the insured address. Where known, the claim also has a police report number and the driver: a listed person, a named person who is not on the policy, or nobody yet.
   - While the claim is open, the agent can correct the description, the police report number or the driver, and add evidence items. The policy, the coverage, the vehicle or address and the loss time cannot change: the agent withdraws the claim and files again.
   - An information request has a due time and one or more asks, each with a key. The agent answers asks by key, with text and evidence items. An answer is given once and is not edited.
   - The agent can withdraw an open claim that has no payment and no accepted offer. The state table shows what a withdrawal ends.
   - The agent can set the preferences: the time zone used in notification text, and `email_notices`.
3. **W3 Repairs: estimates, written decisions, supplements and the payee.**
   - An estimate is initial or a supplement, and it has lines with amounts. Estimates from the shop and the adjuster arrive as events. The agent can also submit one that a shop gave the policyholder.
   - The insurer's determination decides lines in writing. A line with no decision is `pending`.
   - The agent can dispute one line that was denied, or approved for less than its estimate, with a reason and evidence items.
   - `payee.set` says who is paid for repairs: the policyholder or a named shop. It can be called again, and it applies to later payments only.
   - An estimate and a dispute are not edited or cancelled. A correction is a supplement, or a new dispute after a new decision.
4. **W4 Total-loss offers and the rental benefit.**
   - For a vehicle that the insurer will not repair, a settlement offer arrives as an event. It has a valuation, a time to answer by and, where the vehicle has a lienholder, the lender's payoff (what is still owed on the loan).
   - The agent accepts the offer, or rejects it with a reason and evidence items. An offer is not edited: the insurer answers a rejection with a new offer. An acceptance is final for the amount of the claim and cannot be cancelled.
   - The agent starts a rental period under the policy's rental benefit, with its start time and its daily rate, and ends it with its end time. A rental period is corrected by ending it and starting another.

The table lists the 11 App errors, in the order of the checks. When more than one error fits a call, it returns the first one in this table.

| Error | Returned when |
| :--- | :--- |
| `not_found` | The ID of an object, or the key of an ask, is unknown. |
| `invalid_state` | A write is made on a claim that is not `open`. `claims.withdraw` is called on a claim that has a payment or an accepted offer. `estimates.submit` or `determinations.dispute` is called on a claim on the `total_loss` path. `requests.respond` is called on a request that is not `open`, or for an ask that already has an answer. `offers.accept` or `offers.reject` is called on an offer that is `accepted`, `rejected` or `superseded`. `rental.end` is called on a rental period that is not `active`. |
| `invalid_timezone` | The time zone in `preferences.update` is unknown. |
| `invalid_window` | A window ends before it starts, or a loss time is in the future. A rental starts before the loss, before the end of an earlier rental period of the claim or after the current time, or it ends before its start or after the current time. |
| `not_in_force` | The policy was not in force at the loss time. |
| `not_covered` | The policy does not have the coverage. For `rental.start`, the policy has no rental benefit. |
| `nothing_to_dispute` | The line is approved in full or still `pending`. |
| `already_disputed` | The standing decision of the line already has a dispute, open or decided, or a dispute produced that decision. |
| `too_late` | A claim is filed later than `notice_days` after the loss. A line is disputed later than `dispute_window_days` after its decision. `offers.accept` or `offers.reject` is called on an `expired` offer. |
| `duplicate_claim` | An open claim on the same policy has the same coverage, the same vehicle or address and the same loss day. |
| `already_active` | The claim already has an active rental period. |

The next table lists the states of each object.

| Object | States | What moves it |
| :--- | :--- | :--- |
| Claim | `open` (on the `repair` or the `total_loss` path), `withdrawn`, `closed` | `claims.file` makes it `open` on the `repair` path. The first `offer.issued` moves it to the `total_loss` path. `claims.withdraw` makes it `withdrawn`. `claim.closed` makes it `closed`, with the outcome `paid`, `denied` or `no_response`. |
| Information request | `open`, `answered`, `void` | `request.issued` makes it `open`. It is `answered` when `requests.respond` answers its last open ask. An open request is `void` when the claim is withdrawn or closed. |
| Estimate line | `pending`, `approved`, `denied` | `estimate.submitted` or `estimates.submit` makes it `pending`. A `determination.issued` that names it makes it `approved` with an amount, or `denied` with a reason. |
| Dispute | `open`, `upheld`, `changed`, `void` | `determinations.dispute` makes it `open`. `dispute.decided` makes it `upheld` (the line is unchanged) or `changed`. An open dispute is `void` when a newer determination names its line, when the claim is withdrawn or closed, or when the claim moves to the `total_loss` path. |
| Offer | `open`, `accepted`, `rejected`, `expired`, `superseded` | `offer.issued` makes it `open`. `offers.accept` makes it `accepted`, and `offers.reject` makes it `rejected`. An open offer is `expired` when the clock reaches its `respond_by`. An open offer is `superseded` when a new offer arrives, or when the claim is withdrawn or closed. An offer that is not open keeps its state. |
| Rental period | `active`, `ended` | `rental.start` makes it `active`. It is `ended` by `rental.end`, or when the claim is withdrawn or closed. |
| Payment | `issued` | `payment.issued` writes it as `issued`. |

Rules:

- **Time.**
  - Alderbrook has no timers, no scheduler and no clock event. Infra moves `virtual_now` with an event or with Core's `env.advance_time`, which runs no App code.
  - So every time-based state is stored as a due time, and Alderbrook computes it from `ctx.virtual_now` each time it is read or checked. This holds for the last day to file, the `request_overdue` flag, `expired`, the end of a dispute window and the covered days of a rental.
  - Writes, events and the validation of the seed use the same computation, and nothing is rewritten when a due time passes.
  - Every read returns the current virtual time as `now`, with the insurer's UTC offset. So the agent can compare it with any deadline before it writes.
- **Day limits.** A limit of N days after a moment ends at the end of the calendar day that is N days after the day of that moment. This is the rule for `notice_days` and `dispute_window_days`, and for a request or an offer whose event names no time.
- **The coverage check.** `coverage.check` and `claims.file` use one check. It tests for `not_found`, `invalid_window`, `not_in_force`, `not_covered`, `too_late` and `duplicate_claim`, in that order. `claims.file` returns the first error, and `coverage.check` lists every rule that fails.
- **Lines and decisions.** A claim has one deductible, whatever the number of estimates and supplements. A supplement adds lines to the same claim, and no line is ever deleted. The standing decision of a line is the latest one, from a determination or from a `changed` dispute. A decision from a newer determination can be disputed in its turn. On the `total_loss` path, the lines stay as history.
- **Money summary on the `repair` path.**
  - `approved_total` is the sum of the approved amounts. It is zero while no line is approved.
  - `insurer_owes` is `approved_total` minus the deductible. It is never below zero and, where the coverage has a limit, never above the limit. `over_limit` is the part that the limit cuts off.
  - `paid` is the sum of the repair payments. `still_due` is `insurer_owes` minus `paid`, never below zero. Anything paid beyond `insurer_owes` is `overpaid`.
  - `my_share` is the deductible, or `approved_total` if that is lower.
  - `not_approved_total` is what the estimates ask for and no decision has approved: pending lines, denied lines, and the part of a line above its approved amount.
- **Money summary on the `total_loss` path.** It comes from the standing offer: the accepted offer or, while none is accepted, the latest offer in whatever state, shown with that state.
  - `net` is the valuation minus the deductible, never below zero.
  - `to_lienholder` is `net`, or the payoff if that is lower, and zero when the vehicle has no lienholder. `to_me` is the rest of `net`.
  - `shortfall` is the part of the payoff that `net` does not cover.
  - `paid_to_lienholder` and `paid_to_me` are the sums of the settlement payments to each.
  - Only an accepted offer is owed. `still_due_to_lienholder` and `still_due_to_me` are its two amounts minus what is paid, never below zero, and zero while no offer is accepted.
  - `overpaid` is the amount by which the settlement payments exceed the accepted `net`. While no offer is accepted, it is the sum of all settlement payments.
  - `approved_total`, `insurer_owes`, `over_limit`, `still_due`, `my_share` and `not_approved_total` are `null` on this path. `paid` keeps the repair payments made before the claim moved to it.
- **The payee.**
  - A repair payment that names no payee goes to the direction on file at that moment. A claim with no direction on file pays the policyholder.
  - A settlement payment always names its payee, the lienholder or the policyholder. `payee.set` has no effect on it.
  - A rental payment that names no payee goes to the policyholder.
- **The rental benefit.**
  - The benefit pays a day's rate, up to the policy's daily cap, for each covered day.
  - A rental period uses one rental day for each calendar day from its start day up to, and not including, its end day. For an active period, the count stops before the current day.
  - The benefit stops at the start of the earliest of these days: the day that is `rental_grace_days` after the day of the first offer on the claim, the day the repair is reported complete, and the day the claim is withdrawn or closed.
  - It also stops once the claim's rental periods, taken together in order of start, have used the policy's longest number of days.
  - Rental days before the stop are covered, and later ones are uncovered. `my_cost` is the full rate for each uncovered day plus, for each covered day, the part of the rate above the cap.
- **Other people's acts.** The insurer, the shop and the lender are not held to the coverage check or to any amount. Their events are applied as given, and only the structure of the data is validated (section 3).
- **Flags.** The flags of a claim show where those acts leave a problem. Like the money summary, they are computed when read and never stored:
  - `request_overdue`: the clock has reached the due time of an open request. It can still be answered while the claim is open;
  - `lines_pending`: a line has no decision;
  - `lines_denied`: a line is denied;
  - `under_deductible`: lines are approved and `insurer_owes` is zero. `coverage.check` also returns it when the payment to expect is zero;
  - `overpaid`: the summary has an `overpaid` amount;
  - `payee_mismatch`: a repair payment went to another party than the direction on file at that moment;
  - `offer_expired`: the latest offer expired with no answer;
  - `below_payoff`: the standing offer has a `shortfall`;
  - `rental_uncovered`: a rental period has uncovered days.
- **Notifications.** Each event on a claim of the account writes one notification, named after the event and listed from the moment it is written. The policyholder's own writes write no notification. A change that time alone causes writes none either.

Illustrative uses, not Task Track submissions:

- A shop sends a supplement and asks to start the work. The agent must hold or release it by the written decision on those exact lines and by the person's own limit on personal cost. Task #128 meets this problem and plans a task-owned insurer portal, shop inbox and payment allocation for it.
- A total-loss offer is lower than the loan payoff. The offer expires in seven days, and the rental benefit ends five days after the offer arrives. The person's notes say what she will not accept.
- The insurer asks who was driving and for a statement. The driver was the person's son, and the agent must not state what it does not know.

No Task proposal depends on Alderbrook, and Task #128 can keep its own fixtures. Each task loads its own history as plain seed data.

**Boundaries and overlap.** I checked the proposal list on 2026-11-22. No Environment proposal covers a property claim with an insurer after a loss.

- #46 (Coverline) compares auto quotes before a policy exists and has no claims.
- #64 (Larkfield Health) is a health plan portal with medical claims that providers send, explanations of benefits and appeals. It has no estimates, payee direction or offers.
- #6 (Personal Finance Workspace) is a bank and brokerage, #87 (Keelcard) has card disputes with merchants, and #68 (PalePay) moves money between people.
- #143 (RecallWatch) files remedy claims for recalled products with a manufacturer. #150 (WarrantyDesk) handles an advance replacement under a warranty. #27 (Crossway) disputes toll violations. None of them involves a policy, a deductible or an adjuster.
- Alderbrook holds no documents and sends no message to the shop: what the agent tells a shop goes through the person's own Apps. A bank account that receives a payment is outside the App.

## 3. Potential app connections

- **Internal personal apps (required):** Alderbrook uses Mail only, and Mail is optional and send-only. All four workflows complete with Alderbrook alone.
  - When `email_notices` is on, each notification also carries a plain-text message for the existing receive declaration of Mail 1.3.0 in `examples/apps/mail`: channel `channel.email`, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, receiver operation `mail.receive_notification`. I reviewed it at `main` commit `61b6371` ([wire schema](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b6371/examples/apps/mail/schemas/router-message.schema.json)).
  - Alderbrook declares the matching `messaging.publishes` entry and builds no inbox.
  - Alderbrook does not use Calendar 1.3.0, which has no messaging receiver, or the `channel.chat` receiver of Messages 1.0.0.
  - Alderbrook does not use Contacts, Files, Notes or Tasks 1.0.0. An evidence item may carry an opaque reference that a task sets to a Files object ID, and Alderbrook never opens it.
- **Other apps and websites (required):** None: no external website, insurer, repair shop, lender or payment service is called at run time.
  - A task that also uses Mail, Messages or Files seeds consistent data in each. There is no App-to-App channel.

### Integration details

- **Operations and access (required):** Alderbrook has 22 Agent-facing MCP operations over stdio, on the Agent connection of the public host (`node runtime/cli.cjs serve --app apps/alderbrook --role agent`). They are registered in `tools.json` as `alderbrook.<name>`.
  - Read (9): `policies.list`, `policies.get`, `coverage.check`, `claims.list`, `claims.get`, `estimates.get`, `payments.list`, `notifications.list`, `preferences.get`.
  - Write (13): `claims.file`, `claims.update`, `claims.add_evidence`, `claims.withdraw`, `requests.respond`, `estimates.submit`, `determinations.dispute`, `payee.set`, `offers.accept`, `offers.reject`, `rental.start`, `rental.end`, `preferences.update`.
  - Every write takes Core's `request_id` and `expected_version`. It returns the `id` of the object it wrote, with the committed version.
  - Every read returns `now`, the current virtual time.
  - The target object is always the argument `id`, and a time window is always `start` and `end`. The reference host's audit projection at `61b6371` keeps these three inputs, so its rows show the object and the window of every call, reads included.
  - For these calls, the argument `id` is the object that the call is about: the policy for `coverage.check` and `claims.file`, the claim for `claims.add_evidence`, `estimates.submit`, `payee.set` and `rental.start`, and the estimate line for `determinations.dispute`. `claims.file` returns the `id` of the new claim.
  - In events, an information request is `info_request_id`, because `request_id` is Core's name for a write.
  - The Agent acts as the bound account holder set by Infra, never through an argument. A task can restrict the allowed tools with `policies.json`.
  - The 11 App errors are listed in section 2. Core adds `invalid_arguments`, `permission_denied`, `stale_version` and `idempotency_conflict`. The input schemas reject an estimate with no lines, a line amount or a daily rate of zero or less, a shop payee with no name, and an answer that names no ask. So Core returns `invalid_arguments` for these cases before any App error.
  - Infra-only operations: `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and the host's clock operation `env.advance_time`. They are not listed on the Agent connection. Core returns `permission_denied` if the Agent calls them.
  - The first version has no GUI, no reviewer console, and no console for the adjuster or the shop.
- **State and lifecycle (required):** State is separate per run and App instance, and one instance holds one account (`isolation_keys: run_id, app_id`).
  - A task loads its own seed and starting time with `env.load_seed`. The seed has the insurer's time zone and claim rules, and the account's policies, claims with all their parts, preferences, notifications and activity rows.
  - So a task can start from any history, such as an expired offer. The seed is history, and new facts arrive only through events.
  - `validateSeed` rejects a seed with `invalid_seed` for any of these:
    - duplicate IDs, a reference to an object that does not exist, a timestamp without a UTC offset, or an account that the binding does not declare;
    - a claim whose loss time is outside its policy's term, or whose coverage its policy does not have;
    - two open claims on one policy for the same coverage, vehicle or address and loss day;
    - a determination that names a line of another claim, two open disputes on one line, or a request with no asks;
    - two open offers on one claim, an open offer beside an accepted one, or an offer on a claim that is not an auto claim;
    - two active rental periods on one claim, or two rental periods of one claim that overlap;
    - a payment with an amount of zero or less, a settlement payment whose payee is not the lienholder or the policyholder, or a settlement payment on a claim that is on the `repair` path.
  - Writes follow Core: an exact repeat of a committed `request_id` or `event_id` returns the stored receipt marked `duplicate`, so a repeated request files no second claim. The same ID with different input returns `idempotency_conflict`. A stale `expected_version` returns `stale_version`. A failed call leaves data, version and notifications unchanged, and a read never changes business data.
  - Reset is Core's: it restores the loaded seed and the time loaded with it, for this App instance only (`reset_scope: app_instance`). Messages already delivered to Mail stay there.
  - Evaluator records come from three places. They join on `request_id`, `event_id` and version.
    - App state in `env.snapshot` has activity rows with sequence, virtual time, actor `agent` or `event`, action, object ID and the `request_id` or `event_id` behind them. There is one row for every committed Agent write, one for every applied event and one for each effect of a write or an event. The snapshot also has the history of each claim, every decision that each line received, and the answer to each offer, each with its time.
    - Core audit rows carry the projected `id`, `start` and `end`. There is one row for every allowed business call that is not a replay, one for every denied call and one for every `env.advance_time` that is not a replay.
    - The supplied Agent execution trace has the full arguments and results.
  - Counting rules:
    - A replay returns the stored receipt before an audit row is written. So it appears only in the trace, and it counts as a retry of the original.
    - A rejected attempt writes no activity row. Count it from the denial rows and the trace.
    - A time-driven change runs no App code and writes no row. Read it from the stored due times and the clock.
    - Take the snapshot before a reset, because reset clears the audit.
- **Events and notifications (required):** Alderbrook has eight events. They arrive through `env.apply_event`, in Core's envelope. An event is handled at its own time T, which is `ctx.virtual_now` inside the handler.
  - Core rejects an event dated before the App's current time (`invalid_event`). Core also validates the data after every event with the same rules as the seed.
  - Alderbrook also rejects the events below, with `invalid_event` and state unchanged:
    - an event that would break one of the seed rules above;
    - a duplicate ID;
    - an unknown claim, estimate, line, dispute or offer;
    - any event on a claim that is withdrawn or closed, so a task's events after `claims.withdraw` are rejected;
    - an estimate with no lines;
    - a decision on a dispute that is not open;
    - an offer on a claim that already has an accepted offer;
    - an estimate, a determination or a completed repair on a claim that is on the `total_loss` path;
    - a payment with a payee that is not the policyholder, a shop or the lienholder;
    - a settlement payment that names no payee;
    - a repair payment on a claim that is on the `total_loss` path.
  - The state table in section 2 gives each event's state changes, and the table below adds the other effects.

  | Event | Example (`at` carries the UTC offset) | Effect |
  | :--- | :--- | :--- |
  | `alderbrook.request.issued` | `{"event_id":"ev-ab-101","at":"2026-12-02T14:00:00-05:00","operation":"alderbrook.request.issued","payload":{"info_request_id":"req-0012","claim_id":"clm-0007","asks":[{"key":"photos","text":"Photos of the damage from four sides."},{"key":"driver","text":"Who was driving, and is that person listed on the policy?"}],"due_at":"2026-12-12T17:00:00-05:00","issued_by":"Adjuster R. Imani"}}` | An information request is added. Its due time is the event's or, if the event names none, `request_response_days` after T. |
  | `alderbrook.estimate.submitted` | `{"event_id":"ev-ab-110","at":"2026-12-04T10:00:00-05:00","operation":"alderbrook.estimate.submitted","payload":{"estimate_id":"est-0031","claim_id":"clm-0007","kind":"initial","source":"shop","shop_name":"Corner Auto Body","lines":[{"line_id":"ln-01","text":"Rear bumper cover, replace","amount":900.00},{"line_id":"ln-02","text":"Tail lamp, left","amount":350.00},{"line_id":"ln-03","text":"Paint and labor","amount":750.00}]}}` | The estimate or supplement is added to the claim. No decision and no payment changes. |
  | `alderbrook.determination.issued` | `{"event_id":"ev-ab-111","at":"2026-12-04T15:30:00-05:00","operation":"alderbrook.determination.issued","payload":{"determination_id":"det-0044","claim_id":"clm-0007","lines":[{"line_id":"ln-01","status":"approved","amount":900.00},{"line_id":"ln-02","status":"approved","amount":350.00},{"line_id":"ln-03","status":"approved","amount":750.00}],"issued_by":"Adjuster R. Imani","note":"Approved as estimated."}}` | Each named line takes the decision, with a history row and the decision time. Lines that it does not name are unchanged. |
  | `alderbrook.dispute.decided` | `{"event_id":"ev-ab-120","at":"2026-12-20T11:00:00-05:00","operation":"alderbrook.dispute.decided","payload":{"dispute_id":"dsp-0003","decision":"changed","line":{"status":"approved","amount":420.00},"decided_by":"Claims supervisor","note":"Receipt accepted."}}` | The open dispute is decided. With `changed`, the line takes the new decision and its time. |
  | `alderbrook.offer.issued` | `{"event_id":"ev-ab-130","at":"2026-12-10T09:00:00-05:00","operation":"alderbrook.offer.issued","payload":{"offer_id":"off-0005","claim_id":"clm-0009","valuation":14200.00,"lienholder_payoff":15100.00,"respond_by":"2026-12-17T17:00:00-05:00","issued_by":"Adjuster R. Imani","basis":"Three comparable vehicles within 100 miles."}}` | A settlement offer is added. Its `respond_by` is the event's or, if the event names none, `offer_response_days` after T. It supersedes an earlier offer only if that one is still open at T. |
  | `alderbrook.payment.issued` | `{"event_id":"ev-ab-140","at":"2026-12-07T12:00:00-05:00","operation":"alderbrook.payment.issued","payload":{"payment_id":"pay-0021","claim_id":"clm-0007","kind":"repair","amount":1500.00,"reference":"EFT 88213"}}` | A payment record is added with its kind (`repair`, `settlement` or `rental`), its amount and its payee. For a repair payment, the direction on file at T is stored with it. |
  | `alderbrook.repair.completed` | `{"event_id":"ev-ab-150","at":"2026-12-13T15:00:00-05:00","operation":"alderbrook.repair.completed","payload":{"claim_id":"clm-0007","reported_by":"Corner Auto Body","final_invoice_total":3500.00}}` | The claim records that the repair is complete, when, and the invoice total that the shop reported, which the App only shows. |
  | `alderbrook.claim.closed` | `{"event_id":"ev-ab-160","at":"2026-12-15T10:00:00-05:00","operation":"alderbrook.claim.closed","payload":{"claim_id":"clm-0007","outcome":"paid","note":"All approved amounts are paid."}}` | The claim is closed with its outcome. An active rental period ends at T. |

  - Alderbrook publishes `channel.email` only, and it receives no messages.
  - The App writes the notification. When `email_notices` is on at that moment, it stores the full wire message with it.
  - An Infra-run sender in the package sends the messages. It is an outbound adapter that Infra runs with its own Infra and publisher connections. It reads notifications through `env.snapshot` and calls `router.publish`, the call that Mail's `src/publisher.cjs` uses. A delivery needs a Mail account bound in the run and an Infra grant for `channel.email`. Without them, the router rejects it before dispatch.
  - Infra runs one sender for the whole run. It chooses when the sender publishes, and it waits for each result before it moves the clock. Mail records the message at Mail's own virtual time.
  - The sender publishes each notification that has a stored wire message, once. It never sends a notification that was in the loaded seed: it notes the seed's notification IDs when it starts.
  - The message `id` and the `request_id` are the notification ID. So publishing the same notification again is an identical retry: the router returns the first receipt, marked `duplicate`, and Mail keeps one inbox record.
  - The sender does not write back into Alderbrook, so no cross-App transaction is assumed. A delivery rejected before dispatch creates no Mail record. If the receiver rejects the message, or its answer is unknown, the router halts the run for inspection. None of these rolls back Alderbrook.
  - The message below is an example notification as a full wire message. I validated it against Mail's `urn:pale:email-message:2` schema at `61b6371` with `runtime/contracts/schema-validator.cjs`: it passes, and two broken variants fail. This is a schema check, not a completed integration test. `{"specversion":"1.0","id":"ntf-0031","source":"urn:pale:app:alderbrook:account:alderbrook-jordan","type":"org.pale.mail.notification.v1","time":"2026-12-09T11:20:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-jordan"},"source_object":{"app_id":"alderbrook","account_id":"alderbrook-jordan","object_type":"claim","object_id":"clm-0007"},"content":{"title":"A supplement of 2 repair lines was added to claim clm-0007","body":{"format":"text/plain","text":"Corner Auto Body sent a supplement for claim clm-0007: 2 new repair lines, 1,500.00 in total. Alderbrook Mutual has received it and has not decided on these lines yet. Open your claim to see each line and its written decision."},"asset_ids":[]},"subscription_ref":"alderbrook-jordan:claim-updates","extensions":[]}}`
- **Shared data and dependencies (required):** Every object has a stable ID. Alderbrook is the source of truth for its policies, claims, decisions, offers and payment records. It keeps no copy of another App's records.
  - The account's `account_id` and `owner_person_id` are the shared values of the run's `binding.json`. So the person has one ID in Alderbrook and Mail, and notifications address the recipient by `person_ref`.
  - The people listed on a policy are named by `person_id`. A task that has the same people in Contacts or Messages gives them the same IDs in its seeds. Alderbrook stores only a display name and their role on the policy.
  - Missing data is explicit. A line with no decision is `pending` with `approved_amount: null`. A coverage with no limit has `limit: null`. A claim with no known driver has `driver: null`. A repair that is not reported complete has `repair_completed_at: null`.
  - A vehicle with no lienholder has `lienholder: null`, and an offer on it has no payoff and no `shortfall`.
  - All records are JSON. There are no images, audio, video or attachments (`capabilities.resources: false`, 0 of the profile's 64 assets).
  - Alderbrook needs the public Core/Messaging runtime 1.6.0 (Core API 1.2.0) at `main` commit `61b6371`. Mail is optional, and `dependencies.required_apps` is empty.
  - The package runs on its own: a copy that holds only `apps/alderbrook/` and the pinned runtime starts the App, and it imports nothing outside its own folder.
  - Days and deadlines use IANA time zones through Node's built-in `Intl`. Amounts are numbers with two decimals in one currency, kept as integer cents inside the App.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `apps/alderbrook/` per the App contribution guide: 22 operations, the states and rules of section 2, and the activity log. It reuses the reference package layout, the generated shared schemas, the launcher and the reference test-harness pattern. | Every transition and rule in section 2 works. | 3.5 to 4.5 |
| Data and image collection | Not applicable: nothing is crawled or copied, and the public workflow references are recorded. | Provenance is recorded in `contribution/dataset.json`. | 0.25 |
| Synthetic data and assets | The fixtures are authored JSON, with no generator at run time: 1 fictional insurer with its five claim rules; 2 policies (an auto policy with 2 vehicles, a rental benefit and a lienholder on one vehicle, and a renters policy) and 4 listed people; 9 claims that cover every state, every closing outcome, both paths and all three coverages; 14 information requests; 12 estimates with 46 lines; 15 determinations; 5 disputes; 4 offers; 11 payments of all three kinds; 3 rental periods; 60 evidence items; 22 notifications. | The seed passes validation. A consistency script checks four things: every claim's loss time is inside its policy's term, every line's standing decision is its latest one, each money summary matches its lines, offers and payments, and every offer's state fits its times. | 1 to 1.5 |
| App integrations | The optional Mail notifications need the wire-message builder, the `messaging.publishes` declaration and the Infra-run sender script. | Example messages pass Mail's wire schema. A notification appears as a received message in the bound Mail account with a committed receipt. An identical retry leaves one inbox record. Without a grant the delivery is rejected and Mail has no record. | 0.5 to 0.75 |
| Validation and reset | The validation has five parts: the local business tests T01 to T19; the public verifier (`npm run app:verify -- --app apps/alderbrook`); a package real-MCP script for what the verifier does not exercise (a task seed with `virtual_now`, time moved with `env.advance_time` and no App event, a failed call that changes nothing, replays, and reset to the loaded time); one Alderbrook to Mail flow; and the repository `npm test`, which must stay green. | After implementation, the PR gives the exact App, runtime and Mail versions, the commands, reproducible reports and a workflow-to-test mapping. It also lists the remaining manual review: the realism of the claim rules, the amounts, the adjuster's wording and the notification wording. | 2 to 2.5 |

**Acceptance plan.** Each row gives a main path (initial state → action or event → expected result) and controls. A control that returns an error must leave state unchanged. These are planned tests, not implementation results.

| Workflow | Main path | Control | Tests |
| :--- | :--- | :--- | :--- |
| W1 Policies, claims and money | On 2 December, `coverage.check` on the auto policy for `collision`, its first vehicle and a loss on 1 December returns `covered: true`, a deductible of 500 and 31 December as the last day to file (`notice_days` is 30).<br>With an estimated amount of 420 it returns an expected payment of 0 and the flag `under_deductible`.<br>`claims.get` on a claim with three lines approved for 2,000 in total reads `approved_total` 2,000, `insurer_owes` 1,500, `my_share` 500 and `still_due` 1,500. | A loss on 15 June, before the term began on 1 July → `covered: false`, listing `not_in_force` and `too_late`.<br>A loss on 20 October, checked 43 days later → `too_late` alone.<br>The business data in `env.snapshot` is byte-identical after every read, `coverage.check` included. | T01 to T04: policies, `coverage.check`, claim reads, the `repair` summary |
| W2 Filing a claim and answering the insurer | `claims.file` on 2 December for that loss, with no driver named → `open` on the `repair` path, with a deductible of 500 and `driver: null`.<br>`request.issued` asks for photos and for the driver, due on 12 December → `open`.<br>`claims.add_evidence` twice, then `requests.respond` for the ask `photos` → still `open`.<br>`claims.update` sets the driver, and `requests.respond` for the ask `driver` → `answered`. | A second claim for the same policy, coverage, vehicle and loss day → `duplicate_claim`. The same loss day on the policy's other vehicle is accepted.<br>An unanswered request reads `request_overdue` once `env.advance_time` reaches its due time, with no App event, and it can still be answered.<br>`claims.withdraw` after a payment → `invalid_state`. | T05 to T08: filing, updates, requests, withdrawal, preferences |
| W3 Repairs | `estimate.submitted` with three lines of 2,000 in total, then `determination.issued` approving all → `insurer_owes` 1,500, with a deductible of 500.<br>`payee.set` to the shop, then `payment.issued` for 1,500 with no payee named → paid to the shop, `still_due` 0.<br>A supplement of two lines and 1,500 arrives → both `pending`, flag `lines_pending`, `not_approved_total` 1,500 and `insurer_owes` still 1,500.<br>A second determination approves both → `approved_total` 3,500, `insurer_owes` 3,000 and `still_due` 1,500.<br>A second payment of 1,500 → `still_due` 0 and `my_share` 500. | `determinations.dispute` on a line approved in full → `nothing_to_dispute`.<br>`determinations.dispute` on a denied line 31 days after its decision, with `dispute_window_days` of 30 → `too_late`.<br>`determinations.dispute` on a line with an open dispute → `already_disputed`.<br>A third payment of 200 that names the policyholder while the direction is the shop is applied and reads `payee_mismatch` and `overpaid` 200. | T09 to T13: estimates, determinations, disputes, the payee, payments |
| W4 Total-loss offers and the rental benefit | With a deductible of 500, `offer.issued` on 10 December with a valuation of 14,200 and a payoff of 15,100 → `open`, the claim on the `total_loss` path, `net` 13,700, `to_lienholder` 13,700, `to_me` 0, `shortfall` 1,400 and the flag `below_payoff`.<br>`offers.reject` with a reason and two evidence items → `rejected`.<br>A new offer with a valuation of 15,900 → `net` 15,400, `to_lienholder` 15,100 and `to_me` 300.<br>`offers.accept` → `accepted`.<br>A rental started on 3 December at 45 a day, under a cap of 40, a limit of 30 rental days and 5 grace days: on 18 December it reads 12 covered days, 3 uncovered days, `my_cost` 195 and the flag `rental_uncovered`. | An offer with no answer reads `expired` once `env.advance_time` reaches its `respond_by`, with no App event, and `offers.accept` on it → `too_late`.<br>`offers.accept` on the rejected offer → `invalid_state`.<br>`estimates.submit` after the first offer → `invalid_state`.<br>A second rental while one is active → `already_active`. | T14 to T17: offers, the rental benefit, the platform clock |
| All: events, notifications and Core contracts | Reset restores the loaded seed and time.<br>There is one activity row for each committed write, each applied event and each effect of a write or an event.<br>There is one notification for each event on a claim of the account. | Each invalid event listed in section 3 → `invalid_event`, state unchanged.<br>A repeated `request_id` returns the stored receipt and files no second claim.<br>The same `request_id` with changed input → `idempotency_conflict`.<br>A write with a stale `expected_version` → `stale_version`.<br>The Agent calling `env.apply_event`, `env.reset` or `env.advance_time` → `permission_denied`. | T18 to T19: invalid events, notifications, Core contracts |

Every App error of section 2 has at least one test in T01 to T19.

- **Milestones, owners and dependencies (required):** The author owns every milestone. Nothing blocks the first version: the runtime and the Mail version that it needs exist at `61b6371`.
  - M0: design review in this PR.
  - M1 (days 1 to 4 after plan approval): package skeleton, schemas, seed validation, W1 with the coverage check and the money summary, T01 to T04.
  - M2 (days 5 to 9): W2, W3 and W4, the eight events, time-based states, notifications and the activity log, T05 to T19.
  - M3 (days 10 to 12): fixtures, the consistency script, the Mail flow, the public verifier and the real-MCP script.
  - M4 (days 13 to 14): README, workflow-to-test mapping and evidence. Then `/submit-implementation` inside the 14-day first-version deadline.
  - Related: [#128](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/128), [#46](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/46), [#64](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/64), [#87](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/87), [#143](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/143), [#150](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/150), [#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6), [#68](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/68), [#27](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/27).
- **Resources and total effort (required):** The total is 7.25 to 9.5 person-days. The work needs Node.js 18+ and nothing else: no GPU, no paid data and no model or API cost. Fixtures stay under 1 MB.
- **Scope boundary and open questions (required):** The first version is MCP-only and follows the platform clock. Amounts are task data, and Alderbrook computes only the sums of section 2.
  - Not in the first version: injury, liability, fault and the other party's insurer; premiums, bills, quotes, renewals and surcharges; homeowners policies and claims on a building; photo checks and document reading; the computation of a vehicle's value or of depreciation; the repair shop's work orders, invoices and ledger; an appeal to a regulator; several policyholder accounts or several insurers in one instance; the law of any real place; push, SMS and chat channels; a GUI or CUA interface.
  - Open question 1: should an insurer's payment be refused when it is more than the claim is owed? The plan: no, it is applied as given and the claim reads `overpaid`.
  - Open question 2: should a late answer to an information request be refused? The plan: no, it is accepted while the claim is open.
  - Open question 3: should evidence carry file bytes? The plan: no, it is a record with an optional reference.
  - Open question 4: do tasks need a closed claim to be reopened? The plan: not in the first version.
- **License and external dependencies (required):** The code is under the repository's MIT License, and the synthetic fixtures are offered under the same terms. Nothing is hosted: everything is redistributed in the package, and there is no external service at run time. The references are public pages, used only for the shape of the workflows. No policy text, forms, logos, icons or brand names are copied.
