# Environment Track proposal

**PR title format:** `[Environment Proposal] [<Domain>] <App or website name>`

Example: `[Environment Proposal] [Work & business] Google Calendar`

Copy this template to `proposals/environment/<slug>.md`. Keep the overview concise. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

After design approval, use the [App contribution guide](../../docs/app-contribution.md) and [public Core / Messaging runtime](../../runtime/README.md) to reproduce local integration checks. For connections to existing Apps, consult their [business and receive contracts](../../docs/app-integrations.md) before implementing the sender.

## 1. App and domains

- **Authors / GitHub handles (required):** Xinru Jiang ([@Oshikaka](https://github.com/Oshikaka))
- **Reference app or website / URL (required):** Curbline, an independently branded synthetic app for scheduled rides and airport pickups. Public interaction references: Uber Reserve scheduled and airport rides (https://www.uber.com/) and Lyft scheduled rides (https://www.lyft.com/).
- **Primary domain (required):** Travel & commuting
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

**✍️ Your answer (required):** Curbline is a resettable ride app for scheduled rides and flight-linked airport pickups. A flight change adjusts a pickup only at the same airport. A pickup is never moved to another airport, and cancellation fees, wait fees and refunds follow published rules on the run's virtual time.

**Why it matters for personal agents.** A ride is where a plan meets the clock. The right booking depends on the person:

- which airport and terminal they actually land at;
- how many people and bags travel, and whether a child seat or a wheelchair-accessible vehicle is needed;
- who is paying (a personal or a work card), and who the rider is when someone books for a parent;
- who may follow the trip.

Agents fail here in recognisable ways:

- They keep a pickup at the old airport after a flight change.
- They book a 00:40 arrival on the previous date.
- They leave an obsolete booking active past its free-cancellation time.
- They book a duplicate.
- They report an expected refund as money received.
- They share a parent's trip with someone who should not follow it.

Curbline makes each of these gradable from records: booking history with virtual times, a payment ledger, notification records and share records.

**Distinct scope and overlaps (checked 2026-11-20).**

- No open environment proposal provides ground transport.
- PaleAir ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)) books and changes flights and lets a trip keep an external reference "so that a hotel, ground-transport or expense App can point at it". Curbline is that ground-transport App.
- StayReady ([#44](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44)) covers hotel arrival and access, with no transfer service.
- Task [#47](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/47) needs the pickup updated "with explicit airport/date/time and passenger coverage", and a case where "the first requested transfer change is unavailable". It plans "a pickup/change/cancel provider" as a task-owned fixture if no released ground App exists. Curbline would replace that fixture.
- The README's Sofia case ("the agent must account for the existing car booking") has the same shape.

Six workflows. Each lists its entities, transitions, operations (R = read, W = write) and errors.

1. **Quote and book.**
   - *Entities:*
     - place: `place_id`, name, kind (`address`, `hotel`, `venue`, `airport_terminal`), zone, IANA time zone;
     - ride option: `standard` (4 seats, 3 bags), `xl` (6 seats, 5 bags), `comfort` (4 seats, 3 bags), `wheelchair_accessible` (3 seats plus one wheelchair, 2 bags), plus `child_seats` 0–2;
     - quote token;
     - booking;
     - payment method (masked; the profile is `personal` or `business`).
   - *Operations:*
     - R `places.search`, R `places.get`.
     - R `rides.quote(pickup, dropoff, pickup_at, option, passengers, bags, child_seats, flight?, pickup_buffer_min?)` returns a fare breakdown, availability, `expires_at` (10 virtual minutes later) and a `quote_token`. Quoting is a read, so it stores nothing.
       - The token encodes the request, the market revision and the quote time. `bookings.create` recomputes the fare from these and compares, so an altered fare is detected without any signing key.
       - Re-deriving a token at the same market revision only reproduces the price a new quote would give.
       - A token may be used more than once; each use creates a booking, and the overlap is flagged.
     - R `payment_methods.list`.
     - W `bookings.create(quote_token, payment_method_id, rider_person_id?, notes?)`.
   - *Transitions:* `scheduled → driver_assigned → driver_arrived → on_trip → completed`. Side states: `cancelled`, `rider_no_show`, `needs_attention` (see workflow 3) and `lapsed`. On-demand rides are out of scope.
   - *Fare:* the fare is fixed at booking. The final charge is that fare plus wait fees, tolls and support adjustments. The distance and duration reported at completion appear on the receipt but do not change the fare.
   - *Duplicates:* overlapping active bookings for the same rider are flagged `overlaps_with` and not refused. Curbline does not judge whether a second ride is wanted.
   - *Errors:* `place_not_found`, `outside_service_area`, `pickup_too_soon` (less than 30 min ahead), `pickup_too_far` (more than 30 days ahead), `invalid_passengers`, `no_vehicle_for_requirements` (returned with up to three `alternatives`: other times or options), `invalid_quote` (altered or forged token), `quote_expired`, `quote_stale` (prices or supply changed since the quote), `payment_method_not_found`, `payment_declined`, `rider_not_found`.

2. **Change and cancel.**
   - *Operations:*
     - R `bookings.list`, R `bookings.get` (history, policy times, driver and vehicle once assigned).
     - R `bookings.preview_change(booking_id, changes)`: new fare, fare difference and a change token, or `no_vehicle_for_requirements` with alternatives. A change token is bound to the booking's revision and expires after 10 virtual minutes.
     - R `bookings.preview_cancel(booking_id)`: the fee if cancelled now, and `free_until`.
     - W `bookings.update(booking_id, change_token)`.
     - W `bookings.cancel(booking_id, reason)`.
   - *Rules:*
     - A booking can be changed (pickup time or place, drop-off, passengers, option, flight) only while `scheduled` or `needs_attention`. After a driver is assigned, change attempts return `modify_not_allowed`; cancel and book again instead.
     - A pickup cannot be moved to a different airport by a change (`airport_change_requires_new_booking`). Book the new airport separately, consistent with workflow 3.
     - A successful change releases the old hold and authorizes a new one at the new fare.
     - Cancellation is free until 60 min before pickup, and also while the booking is in `needs_attention`. After that the fee is $10.00. After the driver has arrived, the fee is $10.00 plus any wait fee so far.
     - Any cancellation releases the hold. A fee is recorded as a separate `charge`.
   - *Errors:* `booking_not_found`, `modify_not_allowed`, `airport_change_requires_new_booking`, `invalid_change_token`, `change_token_stale` (the booking changed after the preview), `change_token_expired`, `already_cancelled`, `not_cancellable` (on trip, completed, no-show or lapsed).

3. **Flight-linked airport pickups.**
   - *Entities:* a booking may carry:
     - `flight`: carrier, number, local date of scheduled departure, scheduled arrival, arrival airport, terminal;
     - `pickup_buffer_min`: 0–90, default 20;
     - `flight_tracking`;
     - an optional `external_trip_ref`, for example a PaleAir trip.

     W `bookings.set_flight(booking_id, flight | null)` links or unlinks a flight.
   - *Effects of a flight status event on tracked bookings.* The 6-hour line is measured from the booked or last confirmed pickup time, so small shifts cannot add up to a large move. A proposed time is always the estimated arrival plus the buffer.

     | Flight status | Effect on the booking |
     | :--- | :--- |
     | delayed or early, same arrival airport, new pickup within 6 h of the anchor, and a vehicle of the booked option available then | Pickup moves to the proposed time; the fare is unchanged; the booker is notified |
     | delayed or early, same arrival airport, but more than 6 h from the anchor, or no vehicle of the booked option at the proposed time | `needs_attention` (`large_shift` or `no_vehicle_after_shift`): not moved, a proposed time is attached, and W `bookings.confirm_adjustment` accepts a `large_shift` |
     | cancelled | `needs_attention` (`flight_cancelled`) |
     | diverted, or a different arrival airport | `needs_attention` (`airport_changed`): **never moved to another airport**. Rebooking at the new airport needs a new quote, because the zone and fare differ |
     | landed | The actual arrival time is recorded and starts the free wait |

   - *Leaving `needs_attention`:*

     | Exit | Result |
     | :--- | :--- |
     | `bookings.confirm_adjustment` (`large_shift` only) | `scheduled` at the proposed time; the confirmed time becomes the new anchor |
     | `bookings.update` with a change token | `scheduled` |
     | `bookings.cancel` | `cancelled`, free |
     | Pickup time passes with no action | `lapsed` at the next applied event (time only moves through events); the hold is released and the booker is notified |

     Dispatch events for a booking in `needs_attention` are rejected `invalid_transition`.
   - *Errors:* `not_in_needs_attention`, `not_confirmable` (the reason is not `large_shift`), `invalid_flight` (the arrival airport is not the pickup place).
   - *Displayed times:* every pickup time is shown with its local date and UTC offset, so a 00:40 arrival is visibly on the next date.

4. **Riding for someone else, and trip sharing.**
   - *Rider:* the rider can be another `person_id` from the run binding. That person receives pickup details only: no fare, payment method or other bookings.
   - *Sharing:* W `shares.create(booking_id, person_id, scope, until)` with scope `status` or `status_and_eta`, W `shares.revoke`, R `shares.list`. A share is `active`, then `revoked`, or `expired` (derived from `until` or trip completion).
   - *What sharees receive:* status updates at driver assigned, driver arrived and trip completed, while the share is active. Scope `status` omits the vehicle and the ETA.
   - *Errors:* `person_not_found`, `share_not_found`, `booking_terminal`.

5. **Trip day, wait and no-show.** All driver and trip progress arrives as Infra events, because Curbline does not simulate vehicles.
   - *Free wait:* ends 5 min after the later of the driver's arrival and the booked pickup time, so an early driver starts nothing. For a tracked airport pickup it ends no earlier than 60 min after the recorded landing.
   - *Wait fee:* $0.50 per minute after the free wait, until the trip starts.
   - *No-show:* a rider no-show is accepted only after the free wait ends. It costs $10.00 plus the wait fee.
   - *Tracked flight not yet landed:* no wait fee accrues and a no-show is rejected (`flight_not_landed`).
   - *Driver cancellation:* the booking returns to `scheduled` when the event says a replacement is being found. Otherwise it goes to `needs_attention` (`driver_cancelled`), with free cancellation.
   - *Errors when events are applied:* `invalid_transition`, `no_show_too_early`, `flight_not_landed`.

6. **Payment, receipts, tips and support.**
   - *Payment ledger entries:*
     - `hold`: authorized at booking for the fare. At completion the fare is captured against it; a cancellation releases it.
     - `charge`: wait fees, tolls, cancellation and no-show fees, and tips, each recorded separately.
     - `refund`: `refund_pending`, then `refunded` only when a settlement event arrives.
   - *Operations:* R `receipts.get(booking_id)`, R `support.list`; W `trips.tip(booking_id, amount)` (within 72 h of completion), W `trips.set_expense(booking_id, profile, memo)` (within 30 days of completion), W `support.open(booking_id, reason, note)`.
   - *Support cases:* reasons are `fare_review`, `wait_fee_review`, `lost_item` or `driver_no_show`. A case is `submitted`, then `resolved_adjusted` or `resolved_no_change`, decided by an Infra event. An adjustment creates a `refund_pending` entry.
   - *Errors:* `tip_window_closed`, `expense_window_closed`, `not_completed`, `invalid_amount`, `case_already_open`, `not_eligible`.

**Notifications.** Curbline records one notification per recipient. The notification ID is derived from the booking, the kind, its sequence number and the recipient. Kinds and recipients:

- to the booker: `booking_confirmed`, `booking_changed`, `needs_attention`, `booking_cancelled`, `booking_lapsed`, `driver_assigned`, `driver_arrived`, `receipt`, `refund_settled`;
- to a rider who is not the booker: `pickup_details` (sent when the booking is created, changed or cancelled), `driver_assigned`, `driver_arrived`;
- to each active sharee: `share_started` and `share_update`.

R `notifications.list` returns these records with their delivery status. Delivery is described under Events and notifications. A recipient with no bound Mail account is recorded as `no_recipient_channel`; nothing is sent.

**Core examples (precondition → action or event → expected outcome → control or error).** Times are in `America/New_York` (EST, `-05:00`), in fixture metro Ashford with airports NGI and BFA.

| Workflow | Example |
| :--- | :--- |
| 1 | Virtual time is Dec 3, 19:00. Call `rides.quote` from NGI Terminal 4 to Harborview Hotel, pickup Dec 3, 23:15, `standard`, 2 passengers, 2 bags, flight PA218 arriving 22:55 with a 20 min buffer. → Fare $49.35 ($3.00 base + 24.5 km × $1.10 + 34 min × $0.35 + $2.50 booking fee + $5.00 airport fee), `expires_at` 19:10, a `quote_token`. Then `bookings.create` with the work card. → Booking `bk-7` `scheduled`, a $49.35 hold, and a `booking_confirmed` notification to Maya. → The same token at 19:11 returns `quote_expired`. A token taken before a `market.updated` event for the pickup zone returns `quote_stale`. Altering the fare inside the token returns `invalid_quote`. |
| 3 | `bk-7` tracks PA218. A `flight.status_changed` event arrives: estimated arrival Dec 4, 00:40 at NGI. → Pickup moves to Dec 4, 01:00 (shown as `2026-12-04T01:00:00-05:00`), fare unchanged, a `booking_changed` notification. → If the estimate were Dec 4, 07:30 (more than 6 h after the 23:15 anchor), the booking becomes `needs_attention` (`large_shift`) with proposed time 07:50 and is not moved. `confirm_adjustment` then makes 07:50 the new anchor. If nobody acts, the booking is `lapsed` at the first event after 07:50. |
| 3 | `bk-7` tracks PA218. The event says the arrival airport is now BFA (00:40). → `needs_attention` (`airport_changed`); the pickup stays at NGI; `preview_cancel` shows fee $0.00. The agent quotes and books a BFA pickup (`bk-8`), then cancels `bk-7` free. → Had `bk-7` been cancelled at 22:30 while still `scheduled` at NGI (inside 60 min), the fee would be $10.00. |
| 2 | `bk-8` is `scheduled` at BFA for 01:00. `preview_change` to pickup 01:20, then `bookings.update` with that token. → `bk-8` moves to 01:20 at the same fare; the old hold is released and a new one authorized; `booking_changed` is sent. → `preview_change` to `wheelchair_accessible` returns `no_vehicle_for_requirements` with alternatives (`standard` at 01:20; `wheelchair_accessible` at 06:30), and `bk-8` is unchanged. A token taken before another change returns `change_token_stale`. A change of pickup to NGI returns `airport_change_requires_new_booking`. |
| 5 | Same-airport path: `bk-7` was moved to Dec 4, 01:00 at NGI. PA218 `landed` at 00:38. Driver assigned at 00:20, arrived at 01:00. Trip started at 01:50 and completed at 02:24 with no tolls. → Free wait until 01:38: the later of 01:05 (5 min after both the arrival and the booked pickup) and the landing plus 60 min. The wait fee is 12 min × $0.50 = $6.00, the captured total is $55.35, and the receipt goes to Maya. → A `trip.rider_no_show` event at 01:30 is rejected `no_show_too_early`. |
| 5 | Driver assigned to `bk-9`, then `dispatch.driver_cancelled` with `reassign: false`. → `needs_attention` (`driver_cancelled`), the hold kept, cancellation free. → With `reassign: true`, the booking returns to `scheduled` and the booker is notified. |
| 4 | Lena books `bk-11` with rider `person-ruth` (her mother) and a `wheelchair_accessible` option, then calls `shares.create(bk-11, person-dan, status)`. → Ruth's notifications contain pickup details only. Dan's `share_update` messages contain status without vehicle or ETA. After `shares.revoke`, Dan gets nothing more. → `shares.create` for a person not in the binding returns `person_not_found`. |
| 6 | `bk-7` is completed. `support.open(fare_review)`, then `support.resolved` with a −$8.00 adjustment. → A refund entry `refund_pending` that `receipts.get` shows as pending. It becomes `refunded` only after `payment.refund_settled`. → `trips.tip` 73 h after completion returns `tip_window_closed`. |
| 2 | Repeat `bookings.create` with the same `request_id`. → The original booking and one hold. → After a dispatch event, a write with the earlier `expected_version` is rejected by Core with `stale_version`. |
| Mail | Notification `n-bk7-attention-1-maya` is `pending_delivery`, and Infra has granted `channel.email` to Maya's Mail account. → Mail commits one inbox message, and Infra records `delivered` with the router `event_id`. → Republishing returns `duplicate: true`. Without the grant, Messaging returns `recipient_not_authorized`, Mail is unchanged and the notification becomes `delivery_failed`. |

**Records for evaluation.** Curbline keeps business records, not a derived report:

- booking history (each transition with its virtual time and its caller, Agent or Infra);
- the payment ledger;
- quotes are not stored, but every booking keeps the fare and option it was booked from;
- notifications with their recipients and content;
- share records.

Read results carry `as_of`. A grader can see an obsolete booking left active, a pickup at the wrong airport, a duplicate, a refund still pending, or a sharee who received status updates, and can join these to the supplied execution trace.

**Downstream tasks this enables.** The App encodes none of their answers.

- [#47](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/47) "Repair a disrupted flight, hotel arrival and airport transfer": a JFK→EWR-style airport change, two passengers, an unavailable first change, free-cancellation deadlines, and charges and refunds recorded as they actually stand.
- The README's Sofia case: a replacement flight to a different airport with an existing car booking.
- Booking a wheelchair-accessible ride home from hospital discharge for a parent, when the discharge time slips and only one sibling may follow the trip.
- A parent's school-run rides with child seats, where the co-parent's standing instruction about seats lives in an old message.
- Ending a business trip: keep the receipt on the work card, add the memo for the expense report and tip within the window.

## 3. Potential app connections

Name possible connections and briefly explain their purpose. Internal personal apps include Mail, Calendar, Contacts and similar tools. Use `None` if no connection applies, or `TBD` if undecided.

For internal personal Apps, state which workflow needs each App and whether the connection is required or optional. Link the existing public interface/version, or identify the missing capability, owner and fallback.

- **Internal personal apps (required):** Mail is optional and send-only, for booking, trip, receipt and share notifications through its existing `channel.email` contract. Calendar: None. Contacts: None.
  - **Mail.** All six workflows send notifications. Optional: without Mail, notifications stay in Curbline as `in_app`. Send-only.
    - Interface reused, on `main` at `534bed4`: Mail's receive declaration in [`examples/apps/mail/contribution/contribution.json`](../../examples/apps/mail/contribution/contribution.json) (`channel.email`, wire `urn:pale:email-message:2`, event type `org.pale.mail.notification.v1`, operation `mail.receive_notification`) and payload [`urn:pale:email-payload:1`](../../examples/apps/mail/schemas/email-payload.schema.json), whose `content` requires `title`, `body` and `asset_ids` (`asset_ids` must be empty on this channel).
    - The example message under Events and notifications was checked with `runtime/contracts/schema-validator.cjs` against Mail's `schemas/router-message.schema.json` at that commit: valid.
    - Expected change in Mail: one inbox message per delivered notification, in the recipient's own Mail account, checked in Mail's state and the Messaging receipt.
    - Each recipient's Mail account is a separate Mail instance. The reference router binds one receiver instance per configuration, so the run has one router configuration per recipient Mail instance, each with its own `receiver_state_namespace` and grant. The adapter selects the router by recipient.
    - Missing capability: an automatic call to the outbound adapter after each Infra event belongs to the planned runner (platform-owned). Fallback: notifications are always recorded in Curbline, and the examples and tests invoke the adapter explicitly.
  - **Calendar:** None. An agent may update Calendar with Calendar's own tools; Curbline neither reads nor writes it, and Calendar has no Messaging receiver.
  - **Contacts:** None. No Contacts App exists; riders and sharees are `person_id`s from `binding.json`.
- **Other apps and websites (required):** PaleAir (#69), StayReady (#44), Claimline (#42) and Keelcard (#87) are optional neighbours with no messages exchanged in the first version.
  - PaleAir ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)): optional, no messages. A task that uses both Apps schedules matching flight events in each (PaleAir's own disruption events, Curbline's `flight.status_changed`). A booking may store the PaleAir trip as `external_trip_ref`. PaleAir declares no outbound flight-status channel, so Curbline adds no receive contract in this version.
  - StayReady ([#44](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44)): optional, no messages. The hotel is a place in the run seed.
  - Claimline ([#42](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/42)): optional, no messages. Receipts reach the person's Mail with the expense profile and memo, where an agent can use them.
  - Keelcard ([#87](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/87)): a possible later payment path through its proposed card-authorization contract once it merges. The first version uses Curbline's own masked payment methods.

### Integration details

- **Operations and access (required):** MCP only: 12 Agent reads and 10 Agent writes, with management operations available to Infra alone.
  - *Entry point:* MCP over stdio through the public runtime package contract on `main` at `534bed4` (runtime 1.5.0, Core API 1.2.0, contribution revision 0.4.0). One account per App instance (the booker); the Agent connection acts for that account.
  - *Agent reads (12):* `places.search`, `places.get`, `rides.quote`, `payment_methods.list`, `bookings.list`, `bookings.get`, `bookings.preview_change`, `bookings.preview_cancel`, `shares.list`, `receipts.get`, `support.list`, `notifications.list`.
  - *Agent writes (10):* `bookings.create`, `bookings.update`, `bookings.cancel`, `bookings.set_flight`, `bookings.confirm_adjustment`, `shares.create`, `shares.revoke`, `trips.tip`, `trips.set_expense`, `support.open`.
  - *Infra only:* `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`. These are not listed or callable on the Agent connection, so the agent cannot dispatch drivers, mark trips complete, change flights or prices, settle refunds, load history or reset.
  - *GUI:* none in the first version, and no reviewer console.
- **State and lifecycle (required):** App, account and run state are kept separate; writes are idempotent and versioned, and reset restores only this instance.
  - *App state* is read-only catalog data shipped with the package: ride options and seat limits, the fare and fee rules with their version, the policy times (free cancellation, free wait, tip and expense windows), and the error vocabulary.
  - *Account state* is seeded per task: the booker, payment methods (masked; a seed flag can make one decline), and past bookings, receipts and support cases.
  - *Run state:*
    - the task's world: places, zones, travel times by time band, supply by zone, time band and option, the current market, and flights known to the run;
    - run effects: bookings with history, the payment ledger, shares, support cases, notifications, applied event IDs and the virtual clock.
  - *Seed checks:*
    - At `env.load_seed`, no booking history or ledger entry may be dated after the seed's `virtual_now`.
    - Core also re-runs seed validation after each event, using the clock from before the event. So the check applies only to records marked as seed-loaded, never to records an event has just added.
    - Event handlers treat the event's `at` as now.
  - *Write guarantees:*
    - Every write takes `request_id` and the App-instance `expected_version` (`{epoch, revision}`) from the agent's latest read.
    - Core rejects a stale version with `stale_version` and no partial effect. Every applied event also advances the version, so an agent must re-read after news arrives.
    - A repeated `request_id` returns the original receipt, with no second booking or charge.
    - Reads, including quoting, change nothing.
    - Core's per-App lock orders writes and events by commit.
    - *Moot events:* an event for a booking the agent has already moved to a final state, for example `dispatch.driver_assigned` after a cancellation, is committed as a no-op with an `ignored_reason` in the booking history. It is not rejected, so the clock still advances.
  - *Reset:* `reset_scope: app_instance` restores this instance's seed and loaded clock. Messages already delivered to Mail stay in Mail. Messaging keeps its receipts per run, so each rollout uses a fresh run.
  - *Snapshot:* includes booking history, the ledger, shares and notifications.
- **Events and notifications (required):** Thirteen Infra-applied event operations whose timing the task decides; outgoing notifications are Email through Mail's existing receive contract.
  - *Ownership:* tasks choose the content and timing of every event, and Curbline never schedules one. Curbline only defines each event's business effect and validity.
  - *Accepted operations:*
    - `dispatch.driver_assigned`, `dispatch.eta_updated`, `dispatch.driver_arrived`, `dispatch.driver_cancelled`;
    - `trip.started`, `trip.completed` (distance, duration and tolls; the final charge is computed by the published rules), `trip.rider_no_show`;
    - `flight.status_changed` (applied to every booking tracking that flight; the effects are in workflow 3);
    - `market.updated` (price multiplier and supply for a zone; affects new quotes only, and outstanding tokens become `quote_stale`);
    - `support.resolved`;
    - `payment.refund_settled`;
    - `notification.delivery_recorded` (as in the delivery table below);
    - `clock.advanced` (moves time with no business change, so that policy times such as `free_until` read correctly when nothing else happens).
  - *Rejected without effect:*
    - a transition impossible from a non-final state, for example `dispatch.driver_arrived` before `dispatch.driver_assigned` (`invalid_transition`);
    - a no-show before the free wait ends, or before a tracked flight has landed;
    - an unknown booking, flight or case;
    - a settlement for a refund that is not pending.
  - *Moot events* are committed as no-ops, as described above.
  - *Already handled by Core:* backwards time is rejected, and a repeated `event_id` is replayed.
  - *Platform dependency:* there is no global clock or scheduler; tasks schedule every event, including `clock.advanced`.

  Examples, in time order. They come from different rows of the core examples table, so they are not one continuous run:

  ```json
  {"event_id":"ev-mkt-bfa-2","at":"2026-12-03T19:20:00-05:00","operation":"market.updated","payload":{"zone_id":"z-bfa","multiplier":1.4,"supply":{"wheelchair_accessible":{"night":0}}}}
  {"event_id":"ev-pa218-bfa","at":"2026-12-03T19:40:00-05:00","operation":"flight.status_changed","payload":{"flight":{"carrier":"PA","number":"218","local_date":"2026-12-03"},"status":"diverted","scheduled_arrival":"2026-12-03T22:55:00-05:00","estimated_arrival":"2026-12-04T00:40:00-05:00","arrival_place_id":"pl-bfa-term-b","source_ref":"paleair:trip-55"}}
  {"event_id":"ev-dlv-1","at":"2026-12-03T19:43:00-05:00","operation":"notification.delivery_recorded","payload":{"notification_id":"n-bk7-attention-1-maya","status":"committed","code":null,"stop_run":false,"router_event_id":"router-8b1d5e0c2a7f4d3e9c6b5a4f3e2d1c0b"}}
  {"event_id":"ev-bk7-assign","at":"2026-12-04T00:20:00-05:00","operation":"dispatch.driver_assigned","payload":{"booking_id":"bk-7","driver":{"driver_id":"dr-14","first_name":"Ines"},"vehicle":{"vehicle_id":"vh-14","make_model":"Hybrid sedan","color":"grey","plate":"ASH 4417"},"eta":"2026-12-04T00:58:00-05:00"}}
  {"event_id":"ev-bk7-eta","at":"2026-12-04T00:45:00-05:00","operation":"dispatch.eta_updated","payload":{"booking_id":"bk-7","eta":"2026-12-04T01:03:00-05:00"}}
  {"event_id":"ev-bk7-arrived","at":"2026-12-04T01:00:00-05:00","operation":"dispatch.driver_arrived","payload":{"booking_id":"bk-7","arrived_at":"2026-12-04T01:00:00-05:00","pickup_point":"NGI Terminal 4, door 6"}}
  {"event_id":"ev-bk7-start","at":"2026-12-04T01:50:00-05:00","operation":"trip.started","payload":{"booking_id":"bk-7","started_at":"2026-12-04T01:50:00-05:00"}}
  {"event_id":"ev-bk7-done","at":"2026-12-04T02:24:00-05:00","operation":"trip.completed","payload":{"booking_id":"bk-7","started_at":"2026-12-04T01:50:00-05:00","completed_at":"2026-12-04T02:24:00-05:00","distance_km":24.5,"duration_min":34,"tolls_cents":0}}
  {"event_id":"ev-bk9-drop","at":"2026-12-05T07:40:00-05:00","operation":"dispatch.driver_cancelled","payload":{"booking_id":"bk-9","reason":"vehicle_issue","reassign":false}}
  {"event_id":"ev-tick-0800","at":"2026-12-05T08:00:00-05:00","operation":"clock.advanced","payload":{}}
  {"event_id":"ev-bk12-noshow","at":"2026-12-06T08:21:00-05:00","operation":"trip.rider_no_show","payload":{"booking_id":"bk-12","at":"2026-12-06T08:21:00-05:00"}}
  {"event_id":"ev-case-4","at":"2026-12-06T10:00:00-05:00","operation":"support.resolved","payload":{"case_id":"cs-4","outcome":"resolved_adjusted","adjustment_cents":-800,"note":"Route longer than quoted."}}
  {"event_id":"ev-rf-31","at":"2026-12-08T09:00:00-05:00","operation":"payment.refund_settled","payload":{"ledger_entry_id":"le-31","settled_at":"2026-12-08T09:00:00-05:00"}}
  ```

  *Notifications sent:* one Email per notification whose recipient has a bound Mail account.

  - Curbline's App-owned outbound adapter (`src/publisher.cjs`, following Mail's publisher pattern) reads `pending_delivery` records from an Infra snapshot, so its reads are not counted as the Agent's.
  - It builds the receiver-owned message for the recipient taken from the trusted binding, and publishes it through Messaging with `request_id` equal to the notification ID.
  - Infra records the outcome with `notification.delivery_recorded`. The payload carries Messaging's `status`, `code`, `stop_run` (treated as false when Messaging omits it) and the router `event_id`:

  | Messaging result | Notification becomes |
  | :--- | :--- |
  | `committed` | `delivered`, with the router `event_id` stored |
  | `rejected` without `stop_run` (for example `recipient_not_authorized`, `incompatible_contract`, `source_identity_mismatch`) | `delivery_failed`, with the code stored |
  | any result with `stop_run: true`: `rejected` (`receiver_rejected`, `concurrent_dispatch`, `receiver_lifecycle_changed`), `unknown` (`receiver_unconfirmed`, `receipt_audit_failed`) or `halted` (`run_halted`) | stays `pending_delivery` with the code stored; the run halts for reconciliation, per the Messaging rules |

  Example wire message (validated as described under Internal personal apps):

  ```json
  {"specversion":"1.0","id":"curbline-n-bk7-attention-1-maya","source":"urn:pale:app:curbline:account:curbline-maya","type":"org.pale.mail.notification.v1","time":"2026-12-03T19:42:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","subject":"bk-7","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-maya"},"source_object":{"app_id":"curbline","account_id":"curbline-maya","object_type":"booking","object_id":"bk-7"},"content":{"title":"Pickup needs attention: flight now arrives at BFA","body":{"format":"text/plain","text":"Your pickup bk-7 is booked at Northgate International (NGI) Terminal 4 for Thu Dec 3, 23:15 EST. Flight PA218 now arrives at Bayfield Airport (BFA) at 00:40 EST on Fri Dec 4. The booking has not been moved. You can cancel it free of charge or book a pickup at BFA."},"asset_ids":[]},"extensions":[]}}
  ```
- **Shared data and dependencies (required):** Curbline-owned object IDs, people through `binding.json`, JSON only, and no external service.
  - *IDs:* places, zones, bookings, ledger entries, shares, cases and notifications are Curbline-owned IDs. The booker, riders and sharees are `person_id`s from `binding.json`, each mapped to a Mail account when notifications are expected. A flight is identified by carrier, number and local date, and another App's trip only by `external_trip_ref`.
  - *Formats:* JSON only, with no media or attachments. Money is in integer cents in USD. Times are RFC 3339 with UTC offsets plus the place's IANA time zone.
  - *Shared components:* the public runtime Core and Messaging, and Mail 1.3.0 (optional). No external service.

## 4. Construction plan and effort

Specify how the environment will be built, what will be collected or synthesized, and how each deliverable will be checked. Include expected counts or coverage where relevant. Effort estimates may be ranges; use person-days for human work. Mark reusable components and explain any workstream that is not applicable.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Package `apps/curbline/` containing: manifest; 22 tools; 13 event handlers; quote and change tokens checked by recomputation; fare, fee and wait rules with a version; the booking state machine with history, `needs_attention` exits and lapse; flight-linked adjustment rules; the payment ledger with refund states; shares; support cases; notification records; the outbound Mail adapter; IANA time-zone rendering. MCP only. Reuses the public runtime launcher, Core and Mail's publisher pattern. | Every row of the core examples table passes as a named business test with the stated result or state. `app:verify` confirms the separation between the Agent and Infra connections. | 3.5–4.5 |
| Data and image collection | N/A: no real rides, drivers, fares or places are collected. Fixture places are fictional; a task may seed real place names in its own data. | A provenance note in `dataset.json` stating that all records are synthetic. | 0 |
| Synthetic data and assets | A deterministic, seeded generator. **Metro Ashford:** about 40 places, including 2 airports with 5 terminals and 8 zones; travel times for 8×8 zone pairs × 3 time bands; supply by zone, band and option; one fare table. **Three accounts:** (a) a two-traveler household with 18 months of rides (about 120), personal and work cards and one past fare review; (b) an adult child booking `wheelchair_accessible` rides for a parent, with shares to a sibling (about 40); (c) a parent with child-seat school rides (about 30). About 25 synthetic drivers and vehicles with fictional plates. | The validator checks: every capture follows a hold; every fee matches the policy at its virtual time; receipts sum to ledger entries; no history after the seed time; travel times are symmetric within ±10%; local dates are correct across midnight and DST; byte-identical regeneration from the same seed. Each account seed stays below 300 KB of JSON. | 1–1.5 |
| App integrations | Mail, send-only, for notifications, through Mail's existing `channel.email` receive contract (`urn:pale:email-message:2` / `urn:pale:email-payload:1`). Curbline declares a matching `messaging.publishes` entry with a generated copy of Mail's wire schema (its hash must match the receiver's). The integration example runs three Mail instances (booker, rider and sharee), each with its own router configuration, `receiver_state_namespace` and `channel.email` grant, following `examples/workflows/mail-to-mail/`. No other App is changed. | An integration test through public Messaging covers four cases: (1) `booking_confirmed` reaches the booker's inbox and `pickup_details` reaches the rider's separate inbox, each with a committed receipt; (2) republishing returns `duplicate: true`; (3) an ungranted recipient is rejected, that Mail instance is unchanged and the notification becomes `delivery_failed`; (4) the sharee's inbox, with scope `status`, contains no vehicle or ETA text. | 0.75 |
| Validation and reset | **Business tests:** quote expiry, staleness and an altered fare; `no_vehicle_for_requirements` with alternatives; each cancellation-fee boundary (60 min before pickup, `needs_attention`, after arrival); change blocked after assignment; a change to another airport refused; stale and expired change tokens; hold re-authorized on change; every flight-status effect (small shift, large shift measured from the anchor, no vehicle after a shift, cancelled, airport changed, landed); each `needs_attention` exit, including lapse at the first event after pickup; free-wait computation for an early driver and for tracked and untracked pickups; no wait fee or no-show before landing; no-show too early; driver cancellation with and without reassignment; refund pending versus settled; tip and expense windows; share scopes, revocation and expiry; overlap flag; notification IDs distinct per recipient; moot events committed as no-ops; repeated `request_id`; Core `stale_version` after an event; seed rejecting future-dated history while later events still apply. **Public-runtime checks:** management tools absent for the Agent, seed loading, reset and snapshot. | `npm test` and `app:verify` reports with exact App, Core and runtime versions. A table mapping each workflow to its tests. Two resets giving byte-identical business data and virtual time. An explicit list of anything incomplete at first-version submission. | 1–1.25 |

- **Milestones, owners and dependencies (required):** One owner, four milestones, and first-version submission within 14 days of plan approval; nothing is blocking.
  - Owner of all workstreams: Xinru Jiang ([@Oshikaka](https://github.com/Oshikaka)).
  - M0, during design review: settle tool names and event vocabulary. Ask the author of [#47](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/47) which transfer terms the task needs. Confirm the flight identifier shared with [#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69).
  - After plan approval:
    - M1, days 1–6: catalog, places, quoting, booking, change and cancel, with business tests.
    - M2, days 7–10: flight-linked rules, dispatch and trip events, wait fees, ledger and refunds, shares, support.
    - M3, days 11–13: notifications, Mail adapter, integration test, generator, the three accounts, validators, `app:verify` and evidence.
    - First-version submission (`/submit-implementation`) by day 14.
  - Dependencies:
    - The public runtime and Mail 1.3.0 on `main` are available now.
    - Two platform dependencies have fallbacks described in §3: the runner invoking the outbound adapter (fallback: in-app records and explicit invocation), and a global clock (fallback: task-scheduled events).
    - This proposal's author also has the Gustline proposal ([#126](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/126)) under review. The two first versions will be scheduled so that their 14-day windows do not overlap, or an extension will be requested before the deadline.
- **Resources and total effort (required):** 6.25–8 person-days. No paid data, model or API usage, GPU or hosting. Tests run on a laptop CPU in minutes. The repository footprint stays under 1.5 MB, almost all of it fixture JSON.
- **Scope boundary and open questions (required):** Rides, airport pickups, payments and shares only; three open questions to settle with the Environment reviewers.
  - *Excluded:* on-demand rides; live maps, routing and vehicle movement; real payments or card networks; surge-pricing realism beyond a zone multiplier; multi-stop routes; ride pooling; rentals; driver-side apps; ratings; lost-item logistics beyond a support case; any GUI.
  - *Deferred:* a flight-status receive contract if an airline App later publishes one; card authorization through Keelcard (#87) after it merges; PDF receipts through Mail's attachment channel; a read-only reviewer renderer.
  - *Open questions, to be settled with the Environment reviewers before approval:*
    1. Is the 6-hour line between an automatic pickup shift and `needs_attention` reasonable? The alternative is to send every shift to `needs_attention`. The rule is a fixture parameter either way.
    2. Should notifications to riders and sharees be in scope for the first version, or only the booker's? The default is all three, because #47 and the parent-ride tasks depend on what the other person was told.
    3. Should an event for a booking already in a final state be committed as a no-op (proposed, so the clock still advances), or rejected?
- **License and external dependencies (required):** MIT, with everything redistributed in the repository and no external service at run time.
  - Code, schemas and generated fixtures are under the repository's MIT license and redistributed in the repository. Nothing is hosted.
  - All people, drivers, vehicles, plates, places, flights and prices are synthetic.
  - Uber and Lyft are cited only as public interaction references. No names (other than in that citation), logos, screens, fares or text are reproduced.
  - No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
