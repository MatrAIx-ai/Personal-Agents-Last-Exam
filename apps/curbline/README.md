# Curbline

Curbline is a resettable, synthetic ride App for scheduled rides and flight-linked airport pickups in Personal Agents' Last Exam. A flight change moves a pickup only at the same airport; a pickup is never moved to another airport, it goes to `needs_attention` instead. Cancellation, wait and no-show fees follow published rules on the run's virtual time, and the payment ledger keeps refunds pending until they settle. Bookers, riders and sharees each get their own notification records, which can be delivered to their own Mail.

Approved proposal: [`proposals/environment/curbline-rides-airport-transfers.md`](../../proposals/environment/curbline-rides-airport-transfers.md) (PR #169, approved at `af9866f`).

## Run it

Node.js 18 or newer; no packages to install.

```sh
# App-only business tests and the walkthrough (no runtime needed)
cd apps/curbline
npm test
npm run example

# Regenerate, or check for drift in, the generated contracts and fixtures
npm run build
npm run check

# From the repository root: real MCP verification with the public runtime
npm run app:verify -- --app apps/curbline --output .artifacts/curbline.json

# Runtime and Mail integration through real MCP processes (needs the full checkout)
cd apps/curbline && npm run integration
```

`npm run integration` runs `tests/runtime.integration.cjs` and then `examples/mail-integration/run.cjs`. The first checks a repeated `request_id`, `stale_version` after an event, `env.advance_time` (a lapse is derived without any App code running), and two byte-identical resets. The second runs three Mail instances (booker, rider and sharee) and checks the four delivery cases listed under [Mail delivery](#mail-delivery).

## Package boundary

Business tests and the example run from this folder with only the package. MCP verification needs the pinned public runtime (runtime 1.6.0, Core API 1.2.0). The package carries a byte-identical copy of Mail's wire schema (`schemas/mail-router-message.schema.json`, copied from `examples/apps/mail/schemas/router-message.schema.json`; a test compares the bytes) for its `messaging.publishes` declaration. Mail 1.3.0 and Messaging are needed only for the integration example, where each person's Mail is a scenario recipient in the run assembly. Mail is not listed in `app.json` dependencies. No external service is used.

## Workflows

All tool names carry the `curbline.` prefix: 12 Agent reads and 10 Agent writes. Infra-only operations (`env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, `env.advance_time`) are not available to the Agent.

| Workflow | Agent tools | What it covers |
| :--- | :--- | :--- |
| 1. Quote and book | `places.search`, `places.get`, `rides.quote`, `payment_methods.list`, `bookings.create` | Fare breakdown, availability, quote tokens checked by recomputation (`quote_expired`, `quote_stale`, `invalid_quote`), alternatives when no vehicle fits, overlap flags, riders from the binding |
| 2. Change and cancel | `bookings.list`, `bookings.get`, `bookings.preview_change`, `bookings.preview_cancel`, `bookings.update`, `bookings.cancel` | Change tokens bound to the booking revision, hold re-authorized on change, no airport change by update, cancellation fees by the 60-minute line, `needs_attention` and driver arrival |
| 3. Flight-linked pickups | `bookings.set_flight`, `bookings.confirm_adjustment` | Small shifts move the pickup; shifts beyond the line (measured from the anchor), no vehicle, cancelled flights and airport changes go to `needs_attention`; lapse |
| 4. Riders and sharing | `shares.create`, `shares.revoke`, `shares.list` | Rider notifications with pickup details only; sharee updates with or without vehicle and ETA; revocation and expiry |
| 5. Trip day | (Infra events only) | Free wait, wait fee, no-show, tracked flights not yet landed, driver cancellation with and without reassignment |
| 6. Payment, receipts, tips and support | `receipts.get`, `support.list`, `trips.tip`, `trips.set_expense`, `support.open` | Holds, captures, charges, refunds pending versus refunded, tip and expense windows, support cases |

`curbline.notifications.list` returns every notification record with its recipient, role and delivery status.

## Events

The task chooses the content and timing of every event; Curbline only defines its effect and validity.

| Operation | Effect |
| :--- | :--- |
| `dispatch.driver_assigned` | `scheduled → driver_assigned`; driver, vehicle and ETA stored; booker, rider and active sharees notified |
| `dispatch.eta_updated` | New ETA on an assigned booking |
| `dispatch.driver_arrived` | `driver_assigned → driver_arrived`; the free wait starts |
| `dispatch.driver_cancelled` | `reassign: true` returns to `scheduled`; otherwise `needs_attention` (`driver_cancelled`), hold kept, cancellation free |
| `trip.started` | `driver_arrived → on_trip`; the wait fee is fixed |
| `trip.completed` | Fare captured against the hold; wait fee and tolls charged separately; receipt to the booker; shares end |
| `trip.rider_no_show` | Accepted only after the free wait and after a tracked flight has landed; $10.00 plus wait fee; hold released |
| `flight.status_changed` | Updates the flight and every active booking that tracks it (workflow 3 rules) |
| `market.updated` | Zone multiplier and supply overrides; new quotes only, outstanding tokens become `quote_stale` |
| `support.resolved` | Case resolved; an adjustment creates a `refund_pending` ledger entry |
| `payment.refund_settled` | `refund_pending → refunded`; `refund_settled` notification |
| `notification.delivery_recorded` | Messaging outcome for one notification, generated by Infra |

### Targeting rules

Dispatch and trip events name a `booking_id` or a `selector` (`{flight}` or `{rider_person_id, pickup_from, pickup_to}`).

- **`booking_id`:** an unknown booking, or one already final, commits as a no-op with a reason. A non-final booking in the wrong state is rejected `invalid_transition`.
- **`selector`:** it matches only bookings for which the event is a valid next step. For example, `dispatch.driver_assigned` matches `scheduled` bookings, so a `needs_attention` booking never takes a driver.
  - No match commits as a no-op with a reason.
  - Several matches apply to the earliest-created booking, or are rejected `ambiguous_selector` when the payload says `on_multiple: "reject"`.
- **Support and refund events:** `support.resolved` for an unknown case, and `payment.refund_settled` for an unknown ledger entry, commit as no-ops too.

Every no-op is recorded in `ignored_events` with its `event_id` and reason. When the target booking exists, it is also recorded in that booking's history (`event_ignored` with `ignored_reason`). Because the event commits, Core still advances the clock and marks it processed.

## Time

Curbline has no timers and no clock event. Infra moves time with an event's `at` or with `env.advance_time`, which runs no App code.

- **Derived on reads:** time-based results come from `ctx.virtual_now` wherever they are read. This covers quote and change-token expiry, `free_until` and the current cancellation fee, the free wait, a `needs_attention` booking that becomes `lapsed`, a share's expiry, and the tip and expense windows.
- **Committed on the next write or event:** a lapse and an expired share are stored then, with history time equal to when they fell due. For a lapse that is the pickup time, or the proposed time when that is later; the hold release is dated the same. Until that commit, the read tools show the derived status while the raw snapshot still shows the stored one. Graders should use the read tools, or take the snapshot after a later commit.
- **Displayed times:** every time is rendered in the place's IANA zone with its UTC offset, so a 00:40 arrival reads `2026-12-04T00:40:00-05:00`, visibly on the next date.

## Mail delivery

`src/publisher.cjs` reads `pending_delivery` notifications from an Infra snapshot, so its reads are not counted as the Agent's. It builds Mail's `channel.email` message (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`) with title, body and `time` frozen on the notification, so a retry sends identical bytes. It publishes through the recipient's own router with `request_id` equal to the notification ID, then records the outcome with `notification.delivery_recorded`.

| Messaging result | Notification becomes |
| :--- | :--- |
| `committed` | `delivered`, with the router `event_id` |
| `rejected` without `stop_run` | `delivery_failed`, with the code |
| `rejected` with `idempotency_conflict` | stays `pending_delivery` |
| any result with `stop_run: true` | stays `pending_delivery`; the adapter stops |

A recipient with no Mail account in the run binding is recorded as `no_recipient_channel`, and nothing is sent.

The integration example covers four cases:

1. `booking_confirmed` reaches Maya's inbox and `pickup_details` reaches Jon's separate inbox, each with a committed receipt.
2. Republishing returns `duplicate: true` and leaves Mail unchanged.
3. Without Ava's grant, her messages are `recipient_not_authorized`, her inbox is unchanged and her notifications are `delivery_failed`, while the others are still delivered.
4. Ava's inbox, with share scope `status`, contains no vehicle, ETA or fare text.

**Who calls the adapter in a task run (first version).** The planned runner will call `deliver()` after writes, events and clock advances. Until it exists, a task's scenario script calls it at set points between agent turns, as the integration example does. Each recorded outcome is an applied event and moves the App version, so an agent whose next write carries an older `expected_version` gets Core's `stale_version` and must re-read. Calling the adapter between turns, not asynchronously during one, keeps that predictable. When nothing is sent, Curbline's own notification records (recipient, role, title and body) are the evidence of what each person was told.

## Scenario packs

Each pack in `examples/packs/<name>/` has a `seed.json` and `binding.json` that a task can load with `env.load_seed`. Its `events.json` holds the seed's `virtual_now`, the events in time order, and the expected final statuses. The tests load every pack, replay all its events and check those statuses.

| Pack | Account | Contents |
| :--- | :--- | :--- |
| `household` | Maya Chen, with Jon Okafor | 112 past rides over 18 months (June 2025 to November 2026) on personal and work cards, one settled fare review, and two upcoming rides: Jon to BFA (dispatched by a rider selector) and Maya's pickup from NB442 (delayed, then landed late, so a wait fee applies) |
| `care` | Lena Park, for her mother Ruth, sharing with Dan | 39 past rides in 2026 (36 `wheelchair_accessible` for Ruth, 3 standard for Lena), and an upcoming discharge ride with an active `status` share to Dan |
| `school` | Priya Nair, co-parent Omar | 29 past school and swim rides in 2026 with two child seats, and an upcoming school ride where the first driver cancels and a replacement is found |

`fixtures/minimal.json` is Maya's small account (six past bookings, so the next booking is `bk-7`, as in the proposal's examples), with flights PA218 and NB442.

## Data

`scripts/generate-fixtures.cjs` writes every fixture and pack deterministically from a fixed seed; `npm run check` fails if a regenerated file differs. Metro Ashford is fictional: 8 zones, 39 places including 2 airports with 5 terminals and one hotel outside the service area, travel times for 8×8 zone pairs × 3 bands, supply by zone, band and option, and 25 drivers and vehicles with fictional plates. All people, drivers, places, flights and prices are synthetic.

On every build the generator checks:

- each completed ride's captured hold and charges add up to its receipt;
- every fee matches the policy;
- travel times are symmetric within ±10%;
- every stored time carries the correct local date and offset, across midnight and both DST changes;
- the fare band matches the pickup time;
- no history is dated before 2025-01-01;
- each account seed is under 300 KB of JSON.

Pack seeds keep one record per line, close to compact JSON in size.

## Plan review decisions (2026-11-23)

The review of PR #169 approved the plan and listed four items to settle in the implementation. The proposal file is unchanged. Each item was resolved here:

1. **Notification sending and write-back:** see [Mail delivery](#mail-delivery). The scenario script calls the adapter at set points and the adapter records outcomes at the current clock. When nothing is sent, the notification records are the evidence. The version change from a write-back means a re-read.
2. **Event targeting:** see [Targeting rules](#targeting-rules). Selectors match only bookings for which the event is valid. Several matches apply to the earliest-created booking unless `on_multiple: "reject"`. `needs_attention` bookings never match dispatch events. Unknown IDs the agent was expected to create commit as no-ops with a reason. Only malformed or out-of-order events are rejected.
3. **Flights whose status has already changed:** `rides.quote`, `bookings.create` (through the quote) and `bookings.set_flight` check the flight's latest known status.
   - An arrival place other than the pickup returns `invalid_flight`, and the message names the current arrival place.
   - A requested pickup earlier than the latest estimated arrival is accepted with the warning `pickup_before_estimated_arrival`.
   - A cancelled flight is accepted with the warning `flight_cancelled`.
   - Warnings appear on the quote, the booking result and the booking's `created` history entry.
4. **Time-derived states:** see [Time](#time). They are committed at the next write or event, with history dated when they fell due.

Answers to the proposal's three questions:

- The 6-hour line stays and is the seed setting `settings.auto_shift_max_min`; 0 sends every shift to `needs_attention`.
- Booker, rider and sharee notifications are all in the first version.
- Moot events commit as no-ops with an `ignored_reason`.

## Implementation notes

These are choices the proposal left open, or wording it changed in small ways:

- **Unavailable quotes and changes:** `no_vehicle_for_requirements` is returned as a successful read with `available: false`, the code, no token and up to three `alternatives`. Core errors carry only a code and a message, so alternatives cannot ride on an error. Alternatives are up to two other fitting options at the requested time (cheapest first), then the requested option at the first later band start within 24 hours where it is available.
- **Parameter names:** tool parameters are `pickup_place_id` and `dropoff_place_id`, and tips take `amount_cents`, since money is integer cents throughout.
- **Additional error codes:**
  - `no_change`: a change identical to the booking.
  - `invalid_until`: a share ending in the past.
  - `invalid_trip_ref`: an `external_trip_ref` not in the run binding.
  - `refund_not_pending`: a settlement for a refund that is not pending.
  - `notification_not_found` and `notification_not_pending`: delivery records.
- **Flights:** a flight must be known to the run (seeded in `flights`); `flight.status_changed` for an unknown flight is rejected `invalid_event`. A diversion to another terminal of the same airport is treated as a same-airport change.
- **Overlaps:** an overlap is the same rider with two active bookings whose ride windows (pickup to pickup plus ride minutes plus 15 minutes) intersect. The flag is recomputed after every write and event, and each new flag is kept in the booking history.
- **Fares:** the market multiplier applies to base, distance and time; the booking fee and the airport fee are flat.
- **History size:** the household pack has 112 past rides plus 2 upcoming (114, against "about 120" in the plan) to keep the seed under the 300 KB limit.

## Not done in this version

- **M0 coordination:** the design-review step of asking the author of task #47 which transfer terms the task needs, and confirming the flight identifier shared with PaleAir #69, has not been done. The App uses carrier, number and local date of scheduled departure, as the proposal states.
- **Human review:** realism of fares, fees and travel times, and the wording of notifications, is still pending (`contribution/dataset.json` review status `pending`).

## Limitations

- No vehicle simulation: drivers, trips, flights and prices change only through Infra events.
- Excluded, as planned: on-demand rides, multi-stop routes, pooling, rentals, ratings, real payments or card networks, and surge realism beyond a zone multiplier.
- One account per App instance; MCP only, no GUI.
- Automatic invocation of the outbound adapter belongs to the planned runner; the example and tests invoke it explicitly.
