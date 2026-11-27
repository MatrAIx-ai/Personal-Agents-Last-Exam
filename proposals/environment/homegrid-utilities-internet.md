# Environment Track proposal

**PR title format:** `[Environment Proposal] [<Domain>] <App or website name>`

Example: `[Environment Proposal] [Work & business] Google Calendar`

Copy this template to `proposals/environment/<slug>.md`. Keep the overview concise. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

After design approval, use the [App contribution guide](../../docs/app-contribution.md) and [public Core / Messaging runtime](../../runtime/README.md) to reproduce local integration checks. For connections to existing Apps, consult their [business and receive contracts](../../docs/app-integrations.md) before implementing the sender.

## 1. App and domains

- **Authors / GitHub handles (required):** Xinru Jiang ([@Oshikaka](https://github.com/Oshikaka))
- **Reference app or website / URL (required):** Homegrid, an independently branded synthetic utility and home-internet account: start, stop and transfer service, installation appointments, outages, water advisories and billing. Public interaction references: PG&E account and move services (https://www.pge.com/) and Xfinity moving and installation (https://www.xfinity.com/).
- **Primary domain (required):** Home & utilities
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

**✍️ Your answer (required):** Homegrid is a resettable utility and home-internet account. It covers moving service between addresses with lead times, technician appointments and temporary service; equipment returns; outages and water advisories; and bills, payments and payment plans that follow published rules on the run's virtual time.

**Why it matters for personal agents.** Moving house, an outage or an overdue bill are routine, but the right action depends on the person:

- the move date and whether they work from home;
- which services they actually need at the new address, and when;
- who in the household is vulnerable to a water advisory;
- whether they can afford a bill now or need a payment plan;
- what they told the agent about fees they will not pay.

Agents fail here in recognisable ways:

- They schedule a start without the required lead time.
- They leave a gap in internet on the first workday.
- They reschedule a technician inside the fee window.
- They forget to return equipment before the deadline.
- They treat a pending payment as settled.
- They miss that an advisory was lifted, or that it was updated to cover more streets.
- They report an outage that is already known as if it were new.

Homegrid makes each of these gradable from records: order and appointment histories with virtual times, shipment and equipment records, advisory version chains, a billing ledger and notifications.

**Distinct scope and overlaps (checked 2026-11-21).**

- No open environment proposal provides a utility or internet provider account.
- Hearth ([#31](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/31)) simulates a household and lists utility services only as possible external connections. Brightwire Home ([#86](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/86)) simulates devices in the home. Lintel ([#39](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/39)) covers renting and tenancy.
- None of them models service orders, installation appointments, outages, advisories or utility billing. A task can combine Homegrid with any of them without shared state.

Two open Task proposals need what Homegrid provides:

- [#9](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/9) "Maintain work connectivity during a home move" asks for a provider that can "inspect/reschedule/cancel order, reserve/confirm temporary service, inspect activation/test status, return equipment and advance virtual time". It says that if a new App is needed, it should be "a separate environment dependency". Homegrid is that App.
- [#115](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/115) "Correct a forwarded boil-water notice for exactly the people it reached" plans "a small simulated local news feed". Homegrid's versioned boil-water advisories (issued, updated, lifted) can supply the utility's own notice, while the task keeps any news items it needs.

Six workflows. Each lists its entities, transitions, operations (R = read, W = write) and errors.

1. **Account, services and plans.**
   - *Entities:*
     - customer account (one per App instance);
     - premise: service address with `premise_id`, utility area, internet technology (`fiber | cable`), whether self-install is possible, and an optional `external_ref` to another App's object;
     - service: `electricity`, `water` or `internet` at a premise, with status `pending_start | active | pending_stop | stopped | install_failed`, its plan, activation state and last connection test;
     - plan: internet tiers by premise, tariffs for electricity and water.
   - *Operations:* R `homegrid.account.get`, R `homegrid.services.list`, R `homegrid.plans.list(premise_id, service_type)`.
   - *Errors:* `premise_not_found`, `not_serviceable` (no internet technology at that premise).

2. **Start, stop and transfer service.**
   - *Entities:* order (`start`, `stop`, `transfer` or `temporary_internet`) with effective dates and status `scheduled → effective | cancelled`.
     - For electricity, water and stops, `effective` is derived from the effective date and `ctx.virtual_now`.
     - An internet start that needs a technician or a self-install kit becomes `effective` only on `field.activation_result` `activated`.
     - After a missed visit or `install_failed`, the service returns to `pending_start`; the order stays open and can be rebooked or cancelled.
     - Date semantics: a stop date is the **last day** of service (until 23:59 local). A start date is the **first day** of service. A same-day stop and start therefore leaves no gap and bills one day at both addresses.
   - *Operations:*
     - R `homegrid.orders.list`.
     - R `homegrid.orders.preview(type, ...)` returns earliest dates, any deposit, whether a technician is needed, warnings and an `order_token`. Warnings are `service_gap_days` (stop before start) and `overlap_days` (paying for both addresses).
     - W `homegrid.orders.create(order_token)`.
     - W `homegrid.orders.reschedule(order_id, new_date)`.
     - W `homegrid.orders.cancel(order_id)`: allowed until the order is `effective`.
   - *Order tokens:* a token encodes the request and the preview time, and expires after 30 virtual minutes. `orders.create` recomputes the preview at the current state. If stock or appointment capacity changed it returns `order_token_stale`; editing a token yields nothing a new preview would not.
   - *Rules:*
     - Electricity and water start or stop at least 2 business days after the request, on Monday to Friday excluding fixture holidays.
     - An internet start at a technician premise needs an installation appointment (workflow 3), no earlier than 3 business days after the request. A self-install premise needs equipment shipped first: 2 business days, completed by a delivery event.
     - A `transfer` is one stop plus one start, each with its own date. Gaps and overlaps are flagged, not refused, because Homegrid does not decide what the household wants.
     - A $150.00 deposit applies once per new premise when the account has 2 or more late payments in the past 12 months, counting seeded and run-time payments.
     - `temporary_internet` is a hotspot loan for at most 30 days, from limited stock per area.
       - The hotspot is an `equipment` record (kind `hotspot`) that ships and returns through shipment events.
       - It costs $10.00 per started 7-day period; Jan 19–26 is one period.
       - It is free for any loan at a premise whose installation the provider missed, whether created before or after the miss, until that internet service activates.
       - If the main service activates during the loan, the loan continues to its end date.
       - It is due back 7 days after its end date, or a $150.00 unreturned fee applies.
   - *Errors:* `lead_time_not_met` (with the earliest valid date), `invalid_date`, `order_not_found`, `order_already_effective`, `invalid_order_token`, `order_token_expired`, `order_token_stale` (stock or capacity changed), `no_stock` (with the earliest date stock is free), `service_not_active`.

3. **Installation appointments, activation and equipment.**
   - *Entities:*
     - appointment window: weekdays 08–12, 12–16 or 16–20, and Saturday 08–12, never on fixture holidays; capacity per area and window from the fixture;
     - appointment: `booked → technician_en_route → arrived → completed`, plus `cancelled`, `missed_by_provider` and `no_access` (nobody home);
     - activation result;
     - connection test;
     - equipment: a gateway or a temporary hotspot, with status `shipped → delivered → in_use → return_due → returned`, plus a return deadline.
   - *Operations:*
     - R `homegrid.appointments.slots(premise_id, from, to)`, R `homegrid.equipment.list`.
     - W `homegrid.appointments.book(order_id, window)`, W `homegrid.appointments.reschedule`, W `homegrid.appointments.cancel`.
     - W `homegrid.connection.run_test(service_id)` records a test whose result is computed from state: `pass` at the plan speed when the service is active and no outage affects the premise; otherwise `fail` with `not_activated`, `outage` (with the outage ID) or `equipment_not_delivered`.
     - W `homegrid.equipment.schedule_return(equipment_id, method)` with `method` either `dropoff` or `prepaid_label`.
   - *Rules:*
     - Rescheduling or cancelling is free until 24 h before the window starts. After that, a $25.00 fee is added to the next bill for each late change, and the preview and the result say so.
     - If the provider misses the appointment, a $20.00 credit is added, and the agent can book a new window.
     - When a technician completes the job, an activation event sets the service `active`, or `install_failed` with a reason.
     - When internet service stops, its gateway must be returned within 30 days. The return counts at the `at` of the `returned_received` shipment event, if that is on or before the deadline. Otherwise a $120.00 unreturned fee is added to the first bill that closes after the deadline.
   - *Errors:* `window_full`, `appointment_not_found`, `appointment_closed`, `no_appointment_needed`, `equipment_not_found`, `already_returned`.

4. **Outages and water advisories.**
   - *Entities:*
     - outage: service, affected premises or area, `started → etr_updated (estimated restoration, versioned) → restored`;
     - customer outage report: `linked` to a known outage, or `investigating`;
     - advisory: `boil_water`, `do_not_drink` or `planned_shutoff`, with `advisory_id`, `version`, `msg_type` (`issue | update | lift`), affected premises or area, effective-from time, planned end (for shutoffs), instructions and references. `upcoming`, `in_effect`, `lifted` and `ended` are derived from its latest message and `ctx.virtual_now`.
   - *Operations:* R `homegrid.outages.list(premise_id)`, R `homegrid.advisories.list(premise_id)` (with version chains); W `homegrid.outages.report(premise_id, service, note)`.
   - *Outage credits:* an internet outage of 24 h or longer at a premise earns a credit on the next bill of round(started days × monthly plan price ÷ days in that month), in cents.
   - *Errors:* `premise_not_found`, `service_not_at_premise`, `report_already_open`. Errors when events are applied: `outage_reference_unknown`, `advisory_reference_unknown`, `stale_advisory_version`.

5. **Bills, payments and payment plans.**
   - *Entities:*
     - bill: one per premise per period, with usage keyed by `service_id`, line items (tariff charges, plan charges, deposit, fees, credits, prior balance), due date (21 days after the period closes), status `open | paid | past_due`. `past_due` is derived from the due date and settled payments.
     - payment: `scheduled → pending → settled | returned`;
     - autopay enrollment;
     - payment arrangement: installments, with status `active | completed | defaulted`. `defaulted` is derived when an installment's due date passes unpaid.
   - *Operations:* R `homegrid.bills.list`, R `homegrid.bills.get`, R `homegrid.payments.list` (payments, autopay schedule and arrangements with their installments); W `homegrid.payments.make(amount, payment_method_id)`, W `homegrid.autopay.set(payment_method_id | null)`, W `homegrid.arrangements.request(bill_id, installments)`.
   - *Rules:*
     - A bill is created only by a `billing.cycle_closed` event. Homegrid computes the charges from the fixture tariff:
       - electricity $0.18 per kWh plus a $12.00 customer charge;
       - water $0.009 per gallon plus $8.00;
       - the internet plan price.
     - Autopay creates a `scheduled` payment `py-auto-<bill_id>` for the due date when the bill is created.
       - From the due date it reads as `pending`, for the balance still unpaid at that moment. It reads as `skipped` if earlier settled or pending payments already cover the bill.
       - It settles only through `payment.settled`. A settlement before the payment's date is rejected `invalid_transition`.
       - `homegrid.autopay.set(null)` cancels every autopay payment not yet pending.
     - A balance still unpaid 5 days after the due date adds a late fee of 1.5% to the next bill, unless an active arrangement covers it. A payment counts at its creation time if it later settles; a returned payment never counts.
     - A returned payment adds a $15.00 fee.
     - An arrangement needs a past-due balance of at least $50.00, no arrangement in the past 12 months, and 2–6 installments. It is approved at once when eligible.
       - Installments are the balance divided evenly, rounded down to the cent, with the last one taking the remainder.
       - They fall due every 30 days, starting 7 days after approval. Payments apply to the earliest unpaid installment.
       - An installment unpaid 5 days after its due date makes the arrangement `defaulted`: the remaining balance is past due, and the late-fee rule applies at the next bill.
   - *Errors:* `bill_not_found`, `invalid_amount`, `payment_method_not_found`, `arrangement_not_eligible`, `invalid_installments`.

6. **Notifications and preferences.**
   - *Entities:*
     - preferences: per notification type (`order`, `appointment`, `outage`, `advisory`, `billing`) on or off, delivery `mail | in_app`, quiet hours (account time zone);
     - notification: `notification_id`, type, trigger key, trigger source, virtual `created_at`, `release_at`, `delivery_status` (`in_app | held_quiet_hours | pending_delivery | delivered | delivery_failed | withdrawn`), Messaging outcome, `acknowledged_at`.
   - *Operations:* R `homegrid.preferences.get`, R `homegrid.notifications.list`; W `homegrid.preferences.update`, W `homegrid.notifications.acknowledge`.
   - *Evaluation:*
     - Notifications are created only when an agent write or a business event commits. They are never created on reads or clock movement.
     - The trigger key is `(type, source_id, source_version, recipient)`. The notification ID is derived from it and is the Messaging `request_id`.
     - Inside quiet hours, a notification is held once as `held_quiet_hours`, with `release_at` fixed at the end of that quiet period. Later preference changes do not move it.
       - Its effective status is derived from `ctx.virtual_now` wherever it is read or written, including the outbound adapter.
       - A newer version of the same source arriving before release (for example an `etr_updated` outage) marks the held one `withdrawn`, so only the latest version is sent.
     - **Recipient:** notifications about a premise go to the account holder while the account has any service there that is `active`, `pending_start` or `pending_stop`. It is `withdrawn` if a later event resolves its cause before release.
     - `boil_water` and `do_not_drink` advisories default to bypassing quiet hours. The person can change that or the delivery channel through preferences, but an `in_app` record is always kept, because they concern health.
   - *Errors:* `invalid_preferences`, `notification_not_found`.

**Core examples (precondition → action or event → expected outcome → control or error).** Times are in `America/New_York` (EST, `-05:00`). Sam is moving from 22 Maple St to 14 Linden Ct (a technician premise) on Fri Jan 15, 2027.

| Workflow | Example |
| :--- | :--- |
| 2 | Virtual time is Tue Jan 12, 10:00. `homegrid.orders.preview(transfer)`: stop all three services at Maple on Fri Jan 15 (last day); start electricity and water at Linden on Jan 15; start internet at Linden as soon as possible. → Electricity and water can start from Thu Jan 14, so Jan 15 is valid, with one day billed at both addresses (`overlap_days: 1`). Internet needs a technician no earlier than Fri Jan 15. Fri and Sat windows are full and Mon Jan 18 is a fixture holiday, so the earliest window is Tue Jan 19, 08–12, with `service_gap_days: 3` (Jan 16–18). Deposit $0.00. Then `orders.create`. → The order is `scheduled`, with an `order` notification. → A preview for an electricity start on Wed Jan 13 returns `lead_time_not_met` with earliest Thu Jan 14. A token used 31 min later returns `order_token_expired`. |
| 3 | The appointment is booked for Tue Jan 19, 08–12. `appointments.reschedule` at Sun Jan 17, 07:00 (49 h before). → Free. → The same call at Mon Jan 18, 10:00 (22 h before) is allowed, and the result and next bill show one $25.00 fee. |
| 3 | A `field.technician_update` event at Tue Jan 19, 12:05 reports `missed_by_provider`. → The appointment is `missed_by_provider`, a $20.00 credit is pending, and the internet order stays open with the service `pending_start`. A `temporary_internet` order for Jan 19–26 costs $0.00. → A temporary order with stock 0 returns `no_stock` with the earliest free date. `orders.cancel` on the open internet order still succeeds, because it is not `effective`. |
| 3 | Technician `completed` at Wed Jan 20, 10:40, then `field.activation_result` `activated` at 10:55. `homegrid.connection.run_test`. → `pass` at the plan's 300 Mbps, and the internet order is `effective`. The hotspot loan continues to Jan 26. → Before activation the test is `fail` (`not_activated`). During an internet outage at the premise it is `fail` (`outage`, `out-77`). |
| 3 | The Maple internet service stopped on Jan 15, so its gateway return is due Feb 14. `equipment.schedule_return(prepaid_label)`, then a `returned_received` event on Jan 20. → The gateway is `returned`. → Without that event, the first bill closing after Feb 14 includes the $120.00 unreturned fee. `schedule_return` on a returned gateway returns `already_returned`. |
| 4 | Advisory `adv-bw7` v1 (`boil_water`, Linden area, from Wed Jan 13, 09:00) is issued at 09:00, during Sam's quiet hours that run until 09:30. → The `advisory` notification is `pending_delivery` immediately, because boil-water notices bypass quiet hours by default. → An `update` v2 adds Birch St; a `lift` v3 on Thu Jan 14, 16:00 makes `advisories.list` show `lifted`, with v1 and v2 in its chain. Sam is notified on Jan 13 although the move is on Jan 15, because the Linden services are `pending_start`. An `update` naming an unknown advisory is rejected `advisory_reference_unknown`. |
| 4 | Internet outage `out-77` at Linden: `started` Mon Jan 25, 13:00 (estimated restoration 18:00), `etr_updated` to 21:00, `restored` Tue 02:30. → 13.5 h, so no credit. `homegrid.outages.report` during the outage is `linked` to `out-77`. → An outage lasting 2 started days would credit round(2 × $60.00 ÷ 31) = $3.87 on the next bill. |
| 5 | Bill `bl-0131` for Linden, Jan 15–31: electricity 412 kWh = $86.16; water 2,950 gal = $34.55; internet from Jan 20, 12 days = round(12 × $60.00 ÷ 31) = $23.23; missed-appointment credit −$20.00; total $123.94, due Feb 21 and unpaid. `homegrid.arrangements.request(bl-0131, 3)` on Feb 24. → An `active` arrangement of $41.31, $41.31 and $41.32, due Mar 3, Apr 2 and May 2, with no late fee while it is current. → A second request within 12 months returns `arrangement_not_eligible`. Without an arrangement, the next bill would add $1.86 (1.5%). |
| 5 | `homegrid.payments.make(12394, pm-visa)` (amounts are integer cents). → The payment is `pending` and the bill stays `past_due` until `payment.settled` `settled`; the payment counts from its creation time. If autopay is on, `py-auto-bl-0131` reads `skipped`. → If the event says `returned`, the payment is `returned` and does not count, and the next bill adds $15.00. |
| 2 | Repeat `orders.create` with the same `request_id`. → The original order. → After any event or strictly later clock advance, a write with the earlier `expected_version` is rejected by Core with `stale_version`. |
| 1 | `homegrid.plans.list(pr-linden-14, internet)`. → The fiber tiers available at that premise, with prices. → For a premise with no internet technology, it returns `not_serviceable`. |
| 6 | Sam's quiet hours are 22:00–07:00, and a billing notification for `bl-0131` is created when the cycle closes at Sun Jan 31, 23:59. → `held_quiet_hours`, `release_at` Mon Feb 1, 07:00, and not published. → After Infra advances the clock to 07:00 with `env.advance_time`, reads and the outbound adapter see it as `pending_delivery`, and it is sent once with its original ID. |
| 6 + Mail | Notification `n-adv-bw7-1-sam` is `pending_delivery`, and Infra has granted `channel.email` to Sam's Mail account. → Mail commits one inbox message, and Infra records `delivered` with the router `event_id`. → Republishing returns `duplicate: true`. Without the grant, Messaging returns `recipient_not_authorized`, Mail is unchanged and the notification becomes `delivery_failed`. |

**Records for evaluation.** Homegrid keeps business records, not a derived report:

- orders and appointments with their histories;
- connection tests;
- equipment and shipment records;
- outage and advisory version chains;
- customer reports;
- bills with line items, payments and arrangements;
- notifications with trigger sources and delivery outcomes.

Each read carries `as_of`, so a grader can join the supplied execution trace to what the agent saw. For example: whether it checked the advisory version before forwarding it, or tested the connection before telling the person it works. Reset clears Core's audit and receipts, so graders take `env.snapshot` before any `env.reset`.

**Downstream tasks this enables.** The App encodes none of their answers.

- [#9](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/9): keep a remote worker connected across a move, using reschedule, temporary service, the activation test and the equipment return.
- [#115](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/115): a boil-water advisory that is updated and then lifted, as the utility's own record.
- A household with an infant during a boil-water advisory, where the person asked to be woken for health notices only, so the agent has to configure the advisory preferences to match.
- A tight month: choose between paying now and a payment plan, with a remembered rule never to pay a late-reschedule fee.
- A move where the person refuses to pay for both addresses on the same day, so the new service starts the day after the old one stops.

## 3. Potential app connections

Name possible connections and briefly explain their purpose. Internal personal apps include Mail, Calendar, Contacts and similar tools. Use `None` if no connection applies, or `TBD` if undecided.

For internal personal Apps, state which workflow needs each App and whether the connection is required or optional. Link the existing public interface/version, or identify the missing capability, owner and fallback.

- **Internal personal apps (required):** Mail is optional and send-only, for order, appointment, outage, advisory and billing notifications through its existing `channel.email` contract. Calendar: None. Contacts: None.
  - **Mail.** Workflow 6 sends notifications for all workflows. Optional: without Mail, notifications stay in Homegrid as `in_app`. Send-only.
    - Interface reused, on `main` at `61b6371`: Mail's receive declaration in [`examples/apps/mail/contribution/contribution.json`](../../examples/apps/mail/contribution/contribution.json) (`channel.email`, wire `urn:pale:email-message:2`, event type `org.pale.mail.notification.v1`, operation `mail.receive_notification`) and payload [`urn:pale:email-payload:1`](../../examples/apps/mail/schemas/email-payload.schema.json), whose `content` requires `title`, `body` and `asset_ids` (empty on this channel).
    - The example message under Events and notifications was checked with `runtime/contracts/schema-validator.cjs` against Mail's `schemas/router-message.schema.json` at that commit: valid.
    - Expected change in Mail: one inbox message per delivered notification, checked in Mail's state and the Messaging receipt.
    - Missing capability: the runner calling the outbound adapter after writes, events and clock advances (platform-owned). Fallback: notifications are always recorded in Homegrid, and the examples and tests invoke the adapter explicitly.
  - **Calendar:** None. An agent may put an installation window on Calendar with Calendar's own tools; Homegrid neither reads nor writes it.
  - **Contacts:** None. No Homegrid workflow needs it; people come from `binding.json`.
- **Other apps and websites (required):** None in the first version. Hearth (#31), Brightwire Home (#86) and Lintel (#39) can sit beside it with no shared state, and an optional premise reference can link to Lintel.
  - A task can use Lintel for the lease and Homegrid for the services at the same address. A premise may carry an optional `external_ref` (`app_id`, `account_id`, `object_id`) to the Lintel listing, checked like Mail's `event_ref`: in `validateSeed` against the binding, and passed to Core through the `references` hook. No messages are exchanged. Homegrid owns the service records; Lintel owns the lease.
  - Chat delivery through the Messages App's `channel.chat` receiver (`apps/messages` 1.0.0, `urn:pale:messages:chat-payload:1`) is a possible later channel, not in the first version.

### Integration details

- **Operations and access (required):** MCP only: 14 Agent reads and 14 Agent writes, with management operations available to Infra alone.
  - *Entry point:* MCP over stdio through the public runtime package contract on `main` at `61b6371` (runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0). One account per App instance; the Agent connection acts for that account. Every tool name carries the `homegrid.` prefix required by the registry loader.
  - *Agent reads (14):* `homegrid.account.get`, `homegrid.services.list`, `homegrid.plans.list`, `homegrid.orders.list`, `homegrid.orders.preview`, `homegrid.appointments.slots`, `homegrid.equipment.list`, `homegrid.outages.list`, `homegrid.advisories.list`, `homegrid.bills.list`, `homegrid.bills.get`, `homegrid.payments.list`, `homegrid.preferences.get`, `homegrid.notifications.list`.
  - *Agent writes (14):* `homegrid.orders.create`, `homegrid.orders.reschedule`, `homegrid.orders.cancel`, `homegrid.appointments.book`, `homegrid.appointments.reschedule`, `homegrid.appointments.cancel`, `homegrid.connection.run_test`, `homegrid.equipment.schedule_return`, `homegrid.outages.report`, `homegrid.payments.make`, `homegrid.autopay.set`, `homegrid.arrangements.request`, `homegrid.preferences.update`, `homegrid.notifications.acknowledge`.
  - *Infra only:* `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and the host clock operation `env.advance_time`. None is listed or callable on the Agent connection, so the agent cannot dispatch technicians, activate service, deliver equipment, start or end outages, issue advisories, close billing cycles, settle payments or move time.
  - *GUI:* none in the first version, and no reviewer console.
- **State and lifecycle (required):** App, account and run state are kept separate; writes are idempotent and versioned, and reset restores only this instance.
  - *App state* is read-only catalog data shipped with the package: tariffs, plans, fees, policy times (lead times, appointment and return windows, grace periods), the holiday calendar, and the advisory and outage vocabularies, all with a catalog version.
  - *Account state* is seeded per task: the customer, payment methods (masked; a seed flag can make one return), payment history, premises and services, open orders, appointments, equipment, bills, payments, arrangements, preferences and past notifications.
  - *Run state:*
    - the task's world: premises, areas, appointment capacity and temporary-service stock;
    - run effects: order and appointment histories, tests, shipments, outages, advisories, customer reports, bills, payments, notifications, applied event IDs and the virtual clock.
  - *Seed checks:* at `env.load_seed`, every created, transition and received time must be on or before the seed's `virtual_now`. Planned dates (effective dates, appointment windows, due dates, `release_at`, estimated restoration) may be later. During event processing, runtime 1.6.0 exposes the event's `at` as `ctx.virtual_now` to the handler and the validation that follows, so data an event adds always passes this check.
  - *Write guarantees:*
    - Every write takes `request_id` and the App-instance `expected_version` (`{epoch, revision}`) from the agent's latest read.
    - Core rejects a stale version with `stale_version` and no partial effect. Every applied event and every strictly later clock advance moves the version, so an agent must re-read.
    - A repeated `request_id` returns the original receipt, with no second order, payment or report.
    - Reads, including previews and slot searches, change nothing.
    - Core's per-App lock orders writes and events by commit.
    - *Moot events:* an event for an order or appointment already cancelled, or a selector that matches nothing, is committed as a no-op. The `ignored_reason` is recorded in Homegrid's own history, because Core's event result is fixed. The clock still advances.
    - *Predictable IDs for scripted events:* tasks write events before the agent acts, so objects the agent creates get deterministic IDs:
      - service `sv-<premise_id>-<type>`;
      - order `or-<premise_id>-<type>-<n>`;
      - appointment `ap-<order_id>-<n>`;
      - equipment for an order `eq-<order_id>`;
      - payment `py-<account>-<n>`;
      - autopay `py-auto-<bill_id>`.

      Here `n` counts per premise or account. Events may instead use a selector that must match at most one object: `{premise_id, service_type}` for the open order or its current appointment, `{premise_id, kind}` for equipment, and `{oldest_pending: true}` for payments. A scenario script may also read IDs from an Infra snapshot before applying an event.
  - *Reset:* `reset_scope: app_instance` restores this instance's seed and loaded clock. Messages already delivered to Mail stay in Mail. Messaging keeps receipts per run, so each rollout uses a fresh run.
  - *Snapshot:* includes all histories, version chains, the billing ledger and notifications.
- **Events and notifications (required):** Eight Infra-applied event operations whose timing the task decides, and no clock event; outgoing notifications are Email through Mail's existing receive contract.
  - *Ownership:* tasks choose the content and timing of every event, and Homegrid never schedules one. Homegrid only defines each event's business effect and validity.
  - *Accepted operations:*
    - `field.technician_update` (`en_route`, `arrived`, `completed`, `no_access`, `missed_by_provider`);
    - `field.activation_result` (`activated` or `failed` with a reason);
    - `logistics.shipment_update` (`shipped`, `delivered`, `returned_received`, for equipment and temporary hotspots);
    - `grid.outage_updated` (`started`, `etr_updated`, `restored`);
    - `water.advisory_published` (`issue`, `update`, `lift`);
    - `billing.cycle_closed` (usage per service for one period; Homegrid computes the bill);
    - `payment.settled` (`settled` or `returned`);
    - `notification.delivery_recorded`: generated by Infra from the Messaging result, not written by the task (see the delivery table below).
  - *Rejected without effect:*
    - a transition not allowed from a non-final state, for example `completed` before `arrived` (`invalid_transition`);
    - unknown order, appointment, equipment, outage, advisory, bill or payment references;
    - a stale advisory version;
    - a cycle that overlaps an existing bill.
  - *Moot events* are committed as no-ops, as described above.
  - *Time:* Homegrid follows the environment clock and has no timers or scheduler. Infra moves the clock with an event's `at` or with Core's Infra-only `env.advance_time` (runtime 1.6.0, `docs/runtime-time.md`), which runs no App code. Every time-based status is therefore derived from `ctx.virtual_now` wherever it is read or written, including the outbound adapter:
    - an order's `effective`;
    - an advisory's `upcoming`, `in_effect` or `ended`;
    - a bill's `past_due`;
    - an autopay payment's `pending`;
    - an arrangement's `defaulted`;
    - an equipment `return_due`;
    - a held notification's release.

    Fees that depend on a deadline are added when the next bill is computed, not when the deadline passes.
  - *Already handled by Core:* backwards time is rejected, and a repeated `event_id` is replayed.

  Examples, in time order. They come from different rows of the core examples table, so they are not one continuous run:

  ```json
  {"event_id":"ev-bw7-1","at":"2027-01-13T09:00:00-05:00","operation":"water.advisory_published","payload":{"advisory_id":"adv-bw7","version":1,"msg_type":"issue","kind":"boil_water","areas":["ar-linden"],"effective_from":"2027-01-13T09:00:00-05:00","instructions":"Boil tap water for 1 minute before drinking, cooking or brushing teeth."}}
  {"event_id":"ev-dlv-bw7","at":"2027-01-13T09:06:00-05:00","operation":"notification.delivery_recorded","payload":{"notification_id":"n-adv-bw7-1-sam","status":"committed","code":null,"stop_run":false,"router_event_id":"router-9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b"}}
  {"event_id":"ev-tech-miss","at":"2027-01-19T12:05:00-05:00","operation":"field.technician_update","payload":{"selector":{"premise_id":"pr-linden-14","service_type":"internet"},"status":"missed_by_provider"}}
  {"event_id":"ev-act-linden","at":"2027-01-20T10:55:00-05:00","operation":"field.activation_result","payload":{"service_id":"sv-pr-linden-14-internet","result":"activated","speed_mbps":300}}
  {"event_id":"ev-gw-return","at":"2027-01-20T15:00:00-05:00","operation":"logistics.shipment_update","payload":{"shipment_id":"sh-gw-maple","equipment_id":"eq-gw-maple","status":"returned_received"}}
  {"event_id":"ev-out77-start","at":"2027-01-25T13:00:00-05:00","operation":"grid.outage_updated","payload":{"outage_id":"out-77","service":"internet","status":"started","premise_ids":["pr-linden-14"],"etr":"2027-01-25T18:00:00-05:00","cause":"fiber cut"}}
  {"event_id":"ev-cycle-0131","at":"2027-01-31T23:59:00-05:00","operation":"billing.cycle_closed","payload":{"bill_id":"bl-0131","period":{"from":"2027-01-15","to":"2027-01-31"},"usage":{"sv-pr-linden-14-electricity":{"kwh":412},"sv-pr-linden-14-water":{"gal":2950}}}}
  {"event_id":"ev-pay-settle","at":"2027-02-25T09:00:00-05:00","operation":"payment.settled","payload":{"selector":{"oldest_pending":true},"outcome":"settled"}}
  ```

  *Notifications sent:* one Email per notification with delivery `mail`.

  - Homegrid's App-owned outbound adapter (`src/publisher.cjs`, following Mail's publisher pattern) reads `pending_delivery` records, as derived at `ctx.virtual_now`, from an Infra snapshot.
  - It builds the receiver-owned message for the recipient taken from the trusted binding, and publishes it through Messaging with `request_id` equal to the notification ID. Title, body and `time` are frozen on the notification record (`time` is `created_at`, or `release_at` when held), so a retry sends identical bytes; Messaging fingerprints the whole message.
  - Infra records the outcome with `notification.delivery_recorded`. The payload carries Messaging's `status`, `code`, `stop_run` (treated as false when Messaging omits it) and the router `event_id`:

  | Messaging result | Notification becomes |
  | :--- | :--- |
  | `committed` | `delivered`, with the router `event_id` stored |
  | `rejected` without `stop_run` (for example `recipient_not_authorized`, `incompatible_contract`, `source_identity_mismatch`) | `delivery_failed`, with the code stored |
  | `rejected` with `idempotency_conflict` | stays `pending_delivery` for reconciliation, since Mail may already hold the message |
  | any result with `stop_run: true`: `rejected` (`receiver_rejected`, `concurrent_dispatch`, `receiver_lifecycle_changed`), `unknown` (`receiver_unconfirmed`, `receipt_audit_failed`) or `halted` (`run_halted`) | stays `pending_delivery` with the code stored; the run halts for reconciliation, per the Messaging rules |

  Example wire message (validated as described under Internal personal apps):

  ```json
  {"specversion":"1.0","id":"homegrid-n-adv-bw7-1-sam","source":"urn:pale:app:homegrid:account:homegrid-sam","type":"org.pale.mail.notification.v1","time":"2027-01-13T09:00:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","subject":"adv-bw7","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-sam"},"source_object":{"app_id":"homegrid","account_id":"homegrid-sam","object_type":"advisory","object_id":"adv-bw7"},"content":{"title":"Boil-water advisory for 14 Linden Ct","body":{"format":"text/plain","text":"A boil-water advisory is in effect for your service address 14 Linden Ct from Wed Jan 13, 09:00 EST until further notice. Bring tap water to a rolling boil for 1 minute before drinking, cooking or brushing teeth. You will be notified when it is lifted."},"asset_ids":[]},"extensions":[]}}
  ```
- **Shared data and dependencies (required):** Homegrid-owned object IDs, people through `binding.json`, JSON only, and a package that runs on its own with the shared runtime.
  - *IDs:* premises, services, orders, appointments, equipment, shipments, outages, advisories, bills, payments, arrangements and notifications are Homegrid-owned IDs. The customer is a `person_id` from `binding.json`, mapped to a Mail account when notifications are expected.
  - *Formats:* JSON only, with no media or attachments. Money is in integer cents in USD. Times are RFC 3339 with UTC offsets plus the area's IANA time zone. Usage is in kWh and gallons.
  - *Standalone package boundary:*
    - Business tests and the example run from `apps/homegrid/` with only the package and the pinned public runtime (runtime 1.6.0, Core API 1.2.0).
    - The package contains the generated copy of Mail's wire schema for its `messaging.publishes` declaration.
    - Mail 1.3.0 and Messaging are needed only for the integration test and example. There Mail is a scenario recipient in the run assembly (`app:verify --with examples/apps/mail` and the example's router configuration), not a package dependency in `app.json` or `required_apps`.
    - No external service.

## 4. Construction plan and effort

Specify how the environment will be built, what will be collected or synthesized, and how each deliverable will be checked. Include expected counts or coverage where relevant. Effort estimates may be ranges; use person-days for human work. Mark reusable components and explain any workstream that is not applicable.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Package `apps/homegrid/` containing: manifest; 28 tools with the `homegrid.` prefix; 8 event handlers; order tokens checked by recomputation; business-day lead times with a holiday calendar; order, appointment, equipment and temporary-service state machines; the connection-test rule; outage and advisory version chains with derived status; the bill calculator (tariffs, deposit, fees, credits, late fee) and the payment and arrangement rules; notifications with trigger keys and quiet-hour release derived from `ctx.virtual_now`; the outbound Mail adapter. MCP only. Reuses the public runtime launcher, Core and Mail's publisher pattern. | Every row of the core examples table passes as a named business test with the stated result or state. `app:verify` confirms the separation between the Agent and Infra connections. | 4–5 |
| Data and image collection | N/A: no real customers, premises, tariffs, outages or bills are collected. Tariff values are fictional round numbers, not a real utility's rates. | A provenance note in `dataset.json` stating that all records are synthetic. | 0 |
| Synthetic data and assets | A deterministic, seeded generator. **World:** 2 fictional towns with 4 utility areas, about 60 premises (fiber, cable, self-install and technician), appointment capacity per area, temporary-hotspot stock and a holiday calendar. **Three households:** (a) a remote worker mid-move (two premises, open orders, a gateway to return; #9-shaped); (b) a family with an infant in an area that gets a boil-water advisory (#115-shaped); (c) a household behind on bills, with 14 months of bills and payments, two returned payments and one past arrangement. | The validator checks: every bill recomputes from its usage and the catalog; balances reconcile with payments; order and appointment histories follow the state machines; every advisory chain is valid; no record is dated after the seed time; business-day arithmetic is correct across holidays and DST; byte-identical regeneration from the same seed. Each seed stays below 400 KB of JSON. | 1–1.5 |
| App integrations | Mail, send-only, for notifications, through Mail's existing `channel.email` receive contract (`urn:pale:email-message:2` / `urn:pale:email-payload:1`). Homegrid declares a matching `messaging.publishes` entry with a generated copy of Mail's wire schema (its hash must match the receiver's). The example's Messaging configuration grants `channel.email` to the bound Mail account, as in `examples/workflows/delivery-to-mail/`. No other App is changed. | An integration test through public Messaging covers four cases: (1) a boil-water advisory produces exactly one inbox message in Mail's state, with a committed receipt, even during quiet hours; (2) republishing returns `duplicate: true` with Mail unchanged; (3) an ungranted recipient is rejected, Mail is unchanged and the notification becomes `delivery_failed`; (4) a held billing notification is published once after `env.advance_time` passes its `release_at`. | 0.5 |
| Validation and reset | **Business tests:** lead times across weekends and holidays; gap and overlap warnings; order tokens (expired, stale, altered); `no_stock`; appointment fee boundary at 24 h; missed and completed appointments with activation success and failure; every connection-test outcome; equipment return before and after the deadline; temporary-service pricing and the unreturned fee; outage credits at 24 h; advisory issue, update and lift with derived status; customer outage reports linked or investigating; bill recomputation; late fee with and without an arrangement; arrangement eligibility and default; pending, settled and returned payments; autopay scheduling; held notification release after `env.advance_time` and withdrawal; health advisories bypassing quiet hours by default and configurable; held notifications withdrawn by a newer version; deterministic IDs and selectors (one match, none, ambiguous); `idempotency_conflict` kept pending; moot events; repeated `request_id`; Core `stale_version` after an event; seed rejecting future-dated records while events still apply; tool names accepted by the registry loader. **Public-runtime checks:** management tools (including `env.advance_time`) absent for the Agent, seed loading, clock advance, reset and snapshot. **Human review points:** realism of the policies, fees and tariffs, and the wording of advisories and notifications. | `npm test` and `app:verify` reports with exact App, Core and runtime versions. A table mapping each workflow to its tests. Two resets giving byte-identical business data and virtual time. An explicit list of anything incomplete at first-version submission. | 1.25–1.5 |

- **Milestones, owners and dependencies (required):** One owner, four milestones, and first-version submission within 14 days of plan approval; nothing is blocking.
  - Owner of all workstreams: Xinru Jiang ([@Oshikaka](https://github.com/Oshikaka)).
  - M0, during design review: settle tool names, the event vocabulary and the catalog. Ask the authors of [#9](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/9) and [#115](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/115) which orders, tests and advisory fields they need.
  - After plan approval:
    - M1, days 1–6: premises, services, plans, orders with lead times, appointments, activation, tests and equipment, with business tests.
    - M2, days 7–10: temporary service, outages, advisories, bills, payments, autopay and arrangements.
    - M3, days 11–13: notifications, Mail adapter, integration test, generator, the three households, validators, `app:verify` and evidence.
    - First-version submission (`/submit-implementation`) by day 14.
  - Dependencies:
    - The public runtime 1.6.0 and Mail 1.3.0 on `main` are available now.
    - One platform dependency has a fallback described in §3: the runner calling the outbound adapter (fallback: in-app records and explicit invocation).
    - This author also has Gustline ([#126](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/126)), Curbline ([#169](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/169)) and Hopline ([#171](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/171)) under review. First-version windows will be scheduled not to overlap, or an extension will be requested before a deadline.
- **Resources and total effort (required):** 6.75–8.5 person-days. No paid data, model or API usage, GPU or hosting. Tests run on a laptop CPU in minutes. The repository footprint stays under 1.5 MB, almost all of it fixture JSON.
- **Scope boundary and open questions (required):** Service orders, appointments, equipment, outages, advisories, billing and notifications only; three open questions to settle with the Environment reviewers.
  - *Excluded:* gas and other utilities; meter reading and smart-meter data beyond billed usage; solar and net metering; rate-plan comparison; energy-assistance programs; credit checks beyond a seeded payment history; disconnection for non-payment; live outage maps; device control (Brightwire Home or Hearth); any GUI.
  - *Deferred:* chat delivery through the Messages App; PDF bills through Mail's attachment channel; a read-only reviewer renderer.
  - *Open questions, to be settled with the Environment reviewers before approval:*
    1. Should a reschedule inside 24 h be allowed with a fee, as proposed, or refused?
    2. Should boil-water and do-not-drink notices be impossible to turn off, as proposed, or should preferences cover them like other types?
    3. Should `notification.delivery_recorded` be kept, or should graders read Mail only?
- **License and external dependencies (required):** MIT, with everything redistributed in the repository and no external service at run time.
  - Code, schemas and generated fixtures are under the repository's MIT license and redistributed in the repository. Nothing is hosted.
  - The customers, premises, tariffs, outages, advisories and bills are synthetic.
  - PG&E and Xfinity are cited only as public interaction references. No names (other than in that citation), logos, rates, screens or text are reproduced.
  - No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
