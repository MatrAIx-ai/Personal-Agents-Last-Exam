# Environment Track proposal

**PR title:** `[Environment Proposal] [Travel & commuting] PaleAir airline booking and trip changes (United Airlines-inspired)`

## 1. App and domains

- **Authors / GitHub handles (required):** Huawei Lin ([@huawei-lin](https://github.com/huawei-lin))
- **Reference app or website / URL (required):** PaleAir, an independently branded synthetic airline website for searching, booking and changing flights. United Airlines (https://www.united.com) is a public interaction reference only; the airline, airports, schedules, fares and rules are invented, and no real branding or data is used.
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** PaleAir is a resettable single-airline booking site in which what a traveler may do, and what it costs, depends on the fare they bought and on the clock. A ticket can be cancelled free within 24 hours of purchase, changed for a fee and a fare difference, or refunded only as travel credit; the airline can move a departure, cancel a flight or offer a rebooking that expires. The App states every rule on the fare and on each preview and then executes what it is told; it never chooses a flight, judges whether a trip still works or recommends an option.

Flights anchor most travel tasks: a pickup, a hotel night, a meeting and a connection all hang on one arrival time. Tasks [#47](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/47), [#49](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/49) and [#55](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/55) each state a need for flight booking that no listed environment provides.

Six workflows, each complete end to end:

1. **Search and fare detail.** Search one-way or round-trip itineraries, nonstop or one connection, across a small invented network. Each result shows times, connection length, price, seats left and three fare brands with their stated rules for changes, refunds, bags and seat selection. Prices and availability move with the simulated clock.
2. **Book.** Preview an itinerary for one or more saved travelers with fare, taxes, total and payment method, then confirm. Confirmation issues a record locator and a receipt. Payment uses a stored payment label; no card number is entered.
3. **Manage a trip.** Choose or change seats, add bags, request or cancel a special service such as wheelchair assistance, and correct a traveler's details within stated limits.
4. **Change and cancel.** Preview a change or cancellation to see the fee, fare difference and whether money returns to the original payment or as travel credit with an expiry; confirm or discard. Split one traveler off a shared booking so that only their ticket changes. Apply a travel credit to a new booking.
5. **Disruptions.** When the airline changes a schedule, delays or cancels a flight, read the rebooking offer and its deadline, accept it, pick another eligible flight at no charge, or take the refund the rules allow.
6. **Check-in and travel day.** Check in when the window opens, retrieve the boarding pass, and read flight status and gate.

Core examples (precondition → action or event → outcome → control case):

| Workflow | Example |
| --- | --- |
| 1 | A fare shows 2 seats left → `seats.sold` event → the same search shows it unavailable and the next fare brand at a higher price → a search for an unknown airport is rejected. |
| 2 | A preview totals $412.60 for two travelers → `bookings.confirm` with that preview ID → one record locator and receipt → a stale preview after a price change is rejected and nothing is charged. |
| 3 | A basic fare excludes seat selection → `seats.select` → rejected with the fare rule → the same call on a standard fare succeeds. |
| 4 | A booking is 20 hours old → `cancel.preview` → full refund to the original payment → at 25 hours the same preview shows travel credit minus the stated fee. |
| 5 | `schedule.changed` moves a departure by 3 hours → an offer lists two alternatives and a deadline → `offers.accept` reissues the ticket at no charge → accepting after `offer.expired` is rejected. |
| 6 | Check-in opens 24 hours before departure → `checkin.complete` → a boarding pass file is available → checking in before the window opens is rejected. |

Illustrative downstream task: a traveler's return flight is moved so that it lands after the last shuttle. The offered alternative fits the airline's rules but breaks a commitment recorded elsewhere, a companion on the same booking wants to keep the original time, and the free-change deadline falls while the user is unreachable. The person, the commitments, the rubric and model trials belong to a separate Task proposal; this App encodes no task's answer.

**Distinct scope:** hotel guest services [#44](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44) and toll accounts [#27](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/27) are the only Travel & commuting environments open on 2026-11-18, and neither sells transport. Task #49 plans a companion environment covering flights, rail and hotels together, and task #55 needs award travel with points. PaleAir is one airline with cash fares only; we would gladly align its contracts with those authors or narrow it to complement their environments.

## 3. Potential app connections

- **Internal personal apps (required):** Mail, optional: confirmation, schedule-change and cancellation notices with the receipt PDF and an ICS itinerary, through Mail's declared attachment receive contract in [PR #12](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/12). Calendar: none directly; as in the reference package, a delivered ICS file creates no event until the agent calls Calendar's import tool. Everything in a notice is also readable in the App.
- **Other apps and websites (required):** None at run time. A trip stores an optional external reference so that a hotel, ground-transport or expense App can point at it.

### Integration details

- **Operations and access (required):** Agent-facing MCP tools under the package contract proposed in PR #12. Reads: `airports.list`, `flights.search`, `fares.get`, `policies.get`, `travelers.list`, `trips.list`, `trips.get`, `seats.map`, `offers.list`, `credits.list`, `status.get`, `boardingpass.get`. Writes: `travelers.save`, `travelers.remove`, `bookings.preview`, `bookings.confirm`, `seats.select`, `bags.set`, `services.request`, `services.cancel`, `travelers.correct`, `changes.preview`, `changes.confirm`, `cancel.preview`, `cancel.confirm`, `trips.split`, `offers.accept`, `offers.decline`, `checkin.complete`, `alerts.set`. Confirming a booking, change or cancellation needs a single-use preview ID plus `request_id`. Whether a user approval is required is a policy applied by Core and the task, not decided by the App. No sign-in or card entry exists. Seed loading, reset, snapshot and events are Infra-only. Names are provisional until M0.
- **State and lifecycle (required):** One customer account per instance with saved travelers and payment labels. Reusable definitions: airports, routes, schedule, fare brands and rules. Per-run state: inventory and prices, bookings, tickets, seats, services, offers, credits, check-ins, applied-event IDs. Ticket states: `booked`, `changed`, `cancelled`, `flown`, `no_show`. Amounts are integer cents in one currency. Every rule outcome is computed from the fare rules and the simulated clock, never from stored flags. A preview becomes stale when price, inventory or schedule changes. Reset restores the seed.
- **Events and notifications (required):** Task-scheduled, Infra-applied: `seats.sold`, `fare.changed`, `schedule.changed`, `flight.delayed`, `flight.cancelled`, `gate.changed`, `offer.issued`, `offer.expired`, `refund.processed`, `credit.expiring`. Example: `{"type":"schedule.changed","event_id":"ev-009","flight_id":"PA218-2027-02-22","new_departure":"2027-02-22T19:40:00-07:00","offer":{"id":"of-31","alternatives":["PA214-2027-02-22","PA220-2027-02-23"],"expires_at":"2027-02-20T18:00:00-07:00"}}` updates affected trips and opens the offer. Replayed event IDs have no effect. Outbound: the optional Mail notices.
- **Shared data and dependencies (required):** Stable airport, flight, fare, trip, ticket, traveler, offer and credit IDs; local times with UTC offsets on the simulated clock; receipts and boarding passes as small PDF assets and itineraries as ICS, within the reference bundle limit. Required: public Core runtime. Optional: Mail with attachments.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Package under `apps/paleair/`: manifest, 30 tools, schemas, search over a generated schedule, fare-rule engine, booking, change, cancellation, split, offer and check-in state machines. Optional read-only renderer with four views. | All six workflows run end to end with discard, decline and error paths; the six core examples pass as business tests. | 6–7 |
| Data and image collection | N/A. No real schedules, fares or airline policies are collected; rules are written for this App. | Provenance record stating all content is synthetic. | 0 |
| Synthetic data and assets | One reusable fixture: 12 invented airports, about 40 routes, a 14-day schedule of about 600 flights generated from a seeded rule, 3 fare brands, 4 saved travelers, 3 existing trips, 2 travel credits, receipt and boarding-pass PDFs. Tasks may replace it. | Connections respect a minimum connection time; no flight departs before it arrives; fares and taxes sum to totals; assets fit the bundle limit; the same seed regenerates the same schedule. | 3–4 |
| App integrations | Optional Mail notices with PDF and ICS attachments; external references on trips. | A `schedule.changed` event produces one message with a readable ICS in the receiving Mail, verified from Mail's state; no Calendar event appears until imported. | 2–3 |
| Validation and reset | Business tests for search, sell-out, stale previews, each fare rule at its time boundary, changes, credits, split bookings, offers and expiry, check-in window, stale versions and event replay. Public-runtime checks over separate Agent and Infra connections. | `npm test` and `app:verify` reports with exact versions; repeated reset gives identical state; management calls are rejected for the Agent; workflow-to-test mapping. | 3–4 |

- **Milestones, owners and dependencies (required):** Huawei Lin ([@huawei-lin](https://github.com/huawei-lin)) owns all workstreams. **M0:** design review, fare rules, tool names, alignment with #49 and #55. **M1:** schedule, search, booking, fixture. **M2:** manage, change, cancel, split, credits. **M3:** disruptions, check-in, Mail notices, runtime verification. About 5 weeks part-time once the runtime contract is available. Blocking dependency: the runtime in PR #12. Related: tasks #47, #49, #55; companion Task proposal (TBD).
- **Resources and total effort (required):** 14–18 person-days; under $20 in model usage; no GPU, paid data or hosting.
- **Scope boundary and open questions (required):** Excluded: other airlines and codeshares; multi-city trips and more than one connection; award travel, miles and elite status; upgrades and standby; baggage tracking and claims; travel insurance; visas and entry rules; sign-in and card entry; any ranking or recommendation of flights. Open questions for design review: (1) should PaleAir stay a single airline, or share a contract with the environment planned by #49; (2) which layer enforces user approval before a purchase or change; (3) should charges be reported to a shared payments App if one is accepted; (4) is one currency and one connection enough for the first version?
- **License and external dependencies (required):** Code under MIT. The airline, airports, schedules, fares, people and documents are original synthetic content; no real carrier's branding, schedules or policy text is reproduced. United Airlines is cited only as a public interaction reference. No external service at run time.
