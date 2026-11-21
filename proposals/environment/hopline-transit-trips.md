# Environment Track proposal

**PR title format:** `[Environment Proposal] [<Domain>] <App or website name>`

Example: `[Environment Proposal] [Work & business] Google Calendar`

Copy this template to `proposals/environment/<slug>.md`. Keep the overview concise. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

After design approval, use the [App contribution guide](../../docs/app-contribution.md) and [public Core / Messaging runtime](../../runtime/README.md) to reproduce local integration checks. For connections to existing Apps, consult their [business and receive contracts](../../docs/app-integrations.md) before implementing the sender.

## 1. App and domains

- **Authors / GitHub handles (required):** Xinru Jiang ([@Oshikaka](https://github.com/Oshikaka))
- **Reference app or website / URL (required):** Hopline, an independently branded synthetic transit app for trip planning, service disruptions, step-free routes and a fare card. Public interaction references: MBTA trip planner, alerts and elevator status (https://www.mbta.com/) and the GTFS / GTFS Realtime specifications (https://gtfs.org/).
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

**✍️ Your answer (required):** Hopline is a resettable transit app: plan trips on a timetable at the run's virtual time, see service alerts, trip delays and elevator outages, find step-free routes, and manage a fare card with passes, a weekly fare cap and reduced-fare eligibility.

**Why it matters for personal agents.** A transit network is the same for everyone. The right trip is not. It depends on the person:

- whether they use a wheelchair or a stroller;
- whether they need step-free access;
- how far they can walk;
- which commute they make on which days;
- whether a monthly pass or the weekly cap is cheaper for how they actually travel;
- whether they qualify for a reduced fare.

Agents fail here in recognisable ways:

- They recommend a route through a station whose elevator is out.
- They treat an elevator's estimated return time as certain.
- They miss a detour that moved a bus stop.
- They read a timetable without the live delay.
- They buy a monthly pass the person will not use enough.
- They load value the person believes is already available.
- They let a lost card keep its balance exposed.

Hopline makes each of these gradable from records. Every plan names the alerts, facility states and trip updates it used (`service_state`, `as_of`). The tap and charge history shows what was actually paid.

**Distinct scope and overlaps (checked 2026-11-21).**

- TransitWallet ([#149](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/149)) is a reservation and assistance module: equipment verification, held and paid assistance bookings, provider replies, actual physical travel outcomes and a wallet ledger. It does not plan trips over a timetable, publish service alerts, track elevators per station or run a fare card with passes and caps.
  - Hopline does not book assistance or verify equipment.
  - The two can coexist: a task can use Hopline to find that the step-free path is broken, and TransitWallet to arrange assistance. No messages are exchanged.
- Curbline (the ride App proposed by this author; not yet opened as a PR) covers rides. A task may use it when Hopline has no step-free route. No messages are exchanged.
- No other open environment proposal provides transit planning or fare cards.
- Task [#110](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/110) "Keep a step-free volunteer delivery promise after an access-route closure" plans "synthetic route and facilities event fixtures" with "route-edge validation". Hopline would replace them with a reusable network.

Five workflows. Each lists its entities, transitions, operations (R = read, W = write) and errors.

1. **Network, stops and departures** (reads evaluated at the run's virtual time).
   - *Entities:*
     - stop or station, with entrances, platforms and pathways (GTFS-style edges: `walkway`, `stairs`, `escalator`, `elevator`, `ramp`, each with step-free flag and traversal time);
     - facility: an elevator, escalator or ramp, with a status that has a window;
     - route (`rail` or `bus`) with its stop pattern and service periods (weekday, Saturday, Sunday);
     - schedule: frequency-based, as in GTFS `frequencies.txt`. Trip instances are computed deterministically with stable IDs such as `trip:blue:nb:2026-12-07:0732`; there is no stored timetable dump.
   - *Operations:*
     - R `hopline.places.search`, R `hopline.stops.get` (entrances, pathways and each facility's status at `as_of`), R `hopline.routes.get`;
     - R `hopline.departures.list(stop_id, from, to)`: scheduled time, live estimate, `cancelled` or `skipped`, and the trip update that changed it.
   - *Errors:* `place_not_found`, `stop_not_found`, `route_not_found`, `invalid_window`, `outside_planning_horizon` (more than 7 days ahead).

2. **Trip planning with step-free routing.**
   - *Operation:* R `hopline.trips.plan(from, to, depart_at | arrive_by, step_free, max_walk_m, max_transfers, avoid_modes, card_id?)` returns up to three itineraries. Each has:
     - legs (walk, ride, transfer pathway) with times in local time and UTC offsets;
     - a `step_free` flag;
     - the fare for the given card, with any pass or cap applied;
     - `uses_estimates`: facilities whose outage is due to end, by its estimate, before the leg reaches them, but whose restoration has not been recorded.
   - *Search:* a deterministic time-dependent earliest-arrival search over the computed trips. Ties are broken by fewer transfers, then shorter walking.
   - *What it considers:* active alerts (detours, closed stops, no service), trip updates and facility outages, all derived at `as_of` and at each leg's own time.
   - *Step-free filtering:* with `step_free: true`, any pathway with stairs or escalators is excluded, as is any elevator that is out of service at the leg's time. An elevator whose estimated return falls before the leg is allowed but listed in `uses_estimates`, so the uncertainty is visible.
   - *Errors:* `no_route`, `no_step_free_route` (with the blocking facilities or closed stops), `outside_service_hours`, `outside_planning_horizon`.

3. **Service alerts, trip updates and facility outages** (all arrive as Infra events).
   - *Entities:*
     - alert: `alert_id`, `version`, `msg_type` (`alert | update | cancel`), cause, effect (`detour`, `stop_closed`, `no_service`, `reduced_service`, `significant_delays`, `stop_moved`), informed entities (routes, stops, facilities), active periods, header and description;
     - trip update: a trip instance with a delay in minutes, `cancelled`, or skipped stops;
     - facility status: `in_service` or `out_of_service` from a start time, with `expected_return` as an estimate.
   - *Transitions:* an alert is `issued`, then `updated` (new version), then `cancelled`. `upcoming`, `active` and `ended` are derived from its active periods and `ctx.virtual_now`. A facility is `out_of_service` until a `restored` status event arrives; passing `expected_return` alone does not restore it.
   - *Operations:* R `hopline.alerts.list(scope)`, R `hopline.alerts.get(alert_id, version?)` (the version chain).
   - *Errors when events are applied:* `alert_reference_unknown`, `stale_alert_version`, `unknown_trip` (no computed trip instance with that ID), `unknown_facility`.

4. **Saved commutes, subscriptions and notifications.**
   - *Entities:*
     - saved place, such as "Home" or "Clinic";
     - saved commute: from, to, days of week, departure window, `step_free` and other preferences;
     - subscription: a route, stop, facility or saved commute, a window, quiet hours with `urgent_override`, delivery `mail | in_app`, and status `active | paused`;
     - notification: `notification_id`, subscription, trigger key, trigger source, virtual `created_at`, `release_at`, `delivery_status` (`in_app | held_quiet_hours | pending_delivery | delivered | delivery_failed | withdrawn`), Messaging outcome, `acknowledged_at`.
   - *Operations:* R `hopline.saved.list`, R `hopline.subscriptions.list`, R `hopline.notifications.list`; W `hopline.saved.add`, W `hopline.saved.remove`, W `hopline.subscriptions.create`, W `hopline.subscriptions.update`, W `hopline.subscriptions.delete`, W `hopline.notifications.acknowledge`.
   - *Evaluation:*
     - Subscriptions are evaluated only when a business event is applied (alert, trip update, facility status, tap, eligibility or payment), in a fixed order. They are never evaluated on reads or on clock movement.
     - A saved-commute subscription fires when the event breaks or delays that commute inside its window. Examples: its step-free itinerary no longer exists, a trip it uses is cancelled, or the delay exceeds the subscription's threshold.
     - The trigger key is `(subscription_id, source_id, source_version, recipient)`. Replays and repeated evaluations create nothing.
     - The notification ID is derived from the trigger key and is the Messaging `request_id`.
     - Quiet hours (account time zone) hold a notification once as `held_quiet_hours`, with `release_at` at the end of the quiet period. Its effective status is derived from `ctx.virtual_now` wherever it is read or written, including the outbound adapter: from `release_at` on, it reads as `pending_delivery`. A later event that resolves the cause before `release_at` (a restored elevator, a cancelled alert) marks it `withdrawn`.
     - `urgent_override` releases `no_service` and `stop_closed` alerts at once.
   - *Errors:* `saved_not_found`, `saved_in_use` (any subscription refers to it), `saved_limit` (20), `subscription_not_found`, `subscription_limit` (25), `invalid_window`, `notification_not_found`.

5. **Fare card, passes, cap and reduced fare.**
   - *Entities:*
     - card: `active | blocked`, stored-value balance in integer cents, `pending` loads, an autoreload rule, attached passes and the weekly cap progress;
     - pass: a monthly pass valid for one calendar month; `scheduled → active → expired`, with status derived from its dates;
     - tap: an actual boarding, recorded by an Infra event;
     - ledger entries: `load_pending`, `load_settled`, `load_failed`, `fare`, `pass_purchase`, `pass_refund`, `replacement_fee`;
     - reduced-fare application: `submitted → approved (with expiry) | denied`, with `expired` derived from the expiry.
   - *Fare rules (fixture catalog, versioned):*
     - Rail costs $2.40 and bus $1.70. Within 120 min of a paid boarding, a transfer costs only the difference (bus to rail $0.70; rail to bus free).
     - The weekly cap is $22.50 from Monday 00:00 to Sunday 23:59, local time. Once fares in that week reach the cap, further taps cost $0.00.
     - A reduced fare halves every fare and the cap.
     - A monthly pass costs $90.00 and makes every tap in its month $0.00.
     - If the balance is too low, one tap may take the balance down to the price of a rail fare below zero. After that, taps are declined (`insufficient_balance`) until a load settles.
   - *Operations:*
     - R `hopline.cards.get`, R `hopline.cards.history(card_id, from, to)`, R `hopline.fares.products`;
     - W `hopline.cards.add_value(card_id, amount, payment_method_id)`: creates a `load_pending` entry; the money becomes spendable only when `payment.settled` arrives;
     - W `hopline.cards.set_autoreload`;
     - W `hopline.passes.purchase(card_id, product, start_month)`: from the current month on;
     - W `hopline.passes.cancel`: a full refund before the pass starts, otherwise `pass_started`;
     - W `hopline.cards.report_lost(card_id)`: blocks the card at once and issues a virtual replacement that carries over the settled balance, any pending loads and passes, minus a $5.00 replacement fee. A later tap with the blocked card is declined `card_blocked`;
     - W `hopline.reduced_fare.apply(card_id, program)`, with `program` one of `senior`, `disability` or `low_income`. The decision arrives as an Infra event.
   - *Errors:* `card_not_found`, `card_blocked`, `invalid_amount`, `payment_method_not_found`, `pass_started`, `pass_overlaps`, `application_pending`, `not_eligible_program`.

**Core examples (precondition → action or event → expected outcome → control or error).** Times are in `America/New_York` (EST, `-05:00`), in fixture metro Ashford.

| Workflow | Example |
| :--- | :--- |
| 2 | Virtual time is Mon Dec 7, 07:30. Elevator EL-12 at Central (street to Blue Line platform) has been `out_of_service` since 06:40, with `expected_return` Tue Dec 8, 18:00. Dana calls `hopline.trips.plan(Elm & 3rd → Harbor Square, depart_at 07:35, step_free: true)`. → One itinerary: Bus 40 direct, arriving 08:21, `step_free: true`, fare $0.85 on Dana's reduced-fare card. → Without `step_free`, the fastest itinerary goes Bus 12 → Central → Blue Line, arriving 08:03. The same step-free request for Tue 19:00 returns the Central route with `uses_estimates: ["EL-12"]`. |
| 3 | EL-12 is out of service. Virtual time reaches Tue Dec 8, 18:30 with no `restored` event. → `hopline.stops.get(central)` still shows EL-12 `out_of_service`, `expected_return` passed. → A `facility.status_changed` event marking it `restored` at 19:05 makes the step-free Central route plain again, with no `uses_estimates`. |
| 1 | Trip `trip:blue:nb:2026-12-07:0752` gets a `service.trip_updated` event: 9 min late. Then `hopline.departures.list(central, 07:45–08:15)`. → The 07:52 departure shows a live estimate of 08:01 and the trip update it came from. → A trip update naming an unknown trip ID is rejected `unknown_trip` and changes nothing. |
| 3 | Alert `al-40-detour` v1 (`detour`, route 40, `stop_moved` for Elm & 3rd to Elm & 4th, Dec 7 09:00–17:00), then an `update` v2 extending to Dec 8 17:00. → `hopline.alerts.get(al-40-detour)` returns v2 `upcoming` at 08:00 and `active` at 09:00, with v1 in its chain. A plan from Elm & 3rd at 10:00 boards at Elm & 4th. → A `cancel` naming an unknown alert is rejected `alert_reference_unknown`. After Dec 8 17:00 the alert reads `ended` without any write. |
| 4 | Dana has a saved commute (weekdays 07:20–08:00, step-free) with a subscription, delivery `mail`, quiet hours 22:00–06:30. The EL-12 outage event arrives at 06:40. → One notification `pending_delivery`, key `(sub-3, fac-el12, 1, person-dana)`. → If the outage event had arrived at 05:50, the notification would be `held_quiet_hours` with `release_at` 06:30, and `pending_delivery` once Infra advances the clock past 06:30 with `env.advance_time`. Had EL-12 been restored before 06:30, it would be `withdrawn` and never sent. |
| 5 | Dana's reduced-fare card has made 9 rail taps this week, all paid ($1.20 each, $10.80). A 10th rail tap arrives Fri 17:40. → It is charged $0.45 and the weekly cap of $11.25 is reached; an 11th tap is $0.00. → Next Monday, the cap progress starts again from $0.00. |
| 5 | Lee's balance is $1.00. `hopline.cards.add_value(card, 2000, pm-visa)`. → A `load_pending` entry of $20.00; `hopline.cards.get` shows a spendable balance of $1.00. A rail tap goes to −$1.40. → A second tap before `payment.settled` is declined `insufficient_balance`. After `payment.settled` the balance is $18.60. |
| 5 | Lee's card holds $18.60 and a December monthly pass. `hopline.cards.report_lost`. → The card is `blocked`, and a virtual replacement carries $13.60 and the pass. → A tap with the old card is declined `card_blocked`. `hopline.passes.cancel` on the started December pass returns `pass_started`. |
| 5 | `hopline.reduced_fare.apply(card, senior)`, then `fare.eligibility_decided` approved with expiry 2027-12-31. → New fares are halved from that event on; earlier taps are unchanged. → A second application while one is pending returns `application_pending`. After the expiry, the eligibility reads `expired` and fares are full again, with no write. |
| 4 + Mail | Notification `n-sub3-fac-el12-1-dana` is `pending_delivery`, and Infra has granted `channel.email` to Dana's Mail account. → Mail commits one inbox message, and Infra records `delivered` with the router `event_id`. → Republishing returns `duplicate: true`. Without the grant, Messaging returns `recipient_not_authorized`, Mail is unchanged and the notification becomes `delivery_failed`. |

**Records for evaluation.** Hopline keeps business records, not a derived report:

- alerts with version chains;
- facility status history;
- trip updates;
- saved commutes and subscriptions with revisions;
- notifications with trigger sources and delivery outcomes;
- the card ledger and tap history.

Plans are reads and are not stored. Each plan names the alert versions, facility states and trip updates it used, plus `as_of`, so a grader can join the supplied execution trace to the network state the agent actually saw. Reset clears Core's audit and receipts, so graders take `env.snapshot` before any `env.reset`.

**Downstream tasks this enables.** The App encodes none of their answers.

- [#110](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/110): a step-free delivery promise after an access-route closure, with route-edge validation coming from Hopline's pathways and facility events.
- A wheelchair user's commute when the usual station's elevator fails overnight: decide whether to wait for the estimated return, take the step-free bus, or book a ride, and tell the person's employer only what is needed.
- A parent with a stroller planning a Saturday outing during a detour that moves the usual stop.
- Choosing between a monthly pass and the weekly cap from three months of the person's actual taps, after a schedule change to four office days.
- Reporting a lost card for an older relative so that the balance and pass move to the replacement, without loading money twice while a load is still pending.

## 3. Potential app connections

Name possible connections and briefly explain their purpose. Internal personal apps include Mail, Calendar, Contacts and similar tools. Use `None` if no connection applies, or `TBD` if undecided.

For internal personal Apps, state which workflow needs each App and whether the connection is required or optional. Link the existing public interface/version, or identify the missing capability, owner and fallback.

- **Internal personal apps (required):** Mail is optional and send-only, for subscription notifications through its existing `channel.email` contract. Calendar: None. Contacts: None.
  - **Mail.** Workflow 4 only. Optional: required only for subscriptions whose delivery is `mail`. Send-only.
    - Interface reused, on `main` at `61b6371`: Mail's receive declaration in [`examples/apps/mail/contribution/contribution.json`](../../examples/apps/mail/contribution/contribution.json) (`channel.email`, wire `urn:pale:email-message:2`, event type `org.pale.mail.notification.v1`, operation `mail.receive_notification`) and payload [`urn:pale:email-payload:1`](../../examples/apps/mail/schemas/email-payload.schema.json), whose `content` requires `title`, `body` and `asset_ids` (empty on this channel).
    - The example message under Events and notifications was checked with `runtime/contracts/schema-validator.cjs` against Mail's `schemas/router-message.schema.json` at that commit: valid.
    - Expected change in Mail: one inbox message per delivered notification, checked in Mail's state and the Messaging receipt.
    - Missing capability: the runner calling the outbound adapter after events and clock advances (platform-owned). Fallback: notifications are always recorded in Hopline, and the examples and tests invoke the adapter explicitly.
  - **Calendar:** None. An agent may read Calendar with Calendar's own tools to find appointment times; Hopline neither reads nor writes it.
  - **Contacts:** None. No Hopline workflow needs it; people come from `binding.json`.
- **Other apps and websites (required):** TransitWallet (#149) and Curbline as optional neighbours with no messages exchanged; nothing else in the first version.
  - TransitWallet ([#149](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/149)): optional, no messages. Hopline exposes station facilities and step-free routing; assistance bookings stay with TransitWallet. A task that uses both seeds consistent station data in each.
  - Curbline (this author's ride App, not yet opened as a PR): optional, no messages.
  - Chat delivery through the Messages App's `channel.chat` receiver (`apps/messages` 1.0.0, `urn:pale:messages:chat-payload:1`) is a possible later channel, not in the first version.

### Integration details

- **Operations and access (required):** MCP only: 13 Agent reads and 12 Agent writes, with management operations available to Infra alone.
  - *Entry point:* MCP over stdio through the public runtime package contract on `main` at `61b6371` (runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0). One account per App instance; the Agent connection acts for that account. Every tool name carries the `hopline.` prefix required by the registry loader.
  - *Agent reads (13):* `hopline.places.search`, `hopline.stops.get`, `hopline.routes.get`, `hopline.departures.list`, `hopline.trips.plan`, `hopline.alerts.list`, `hopline.alerts.get`, `hopline.saved.list`, `hopline.subscriptions.list`, `hopline.notifications.list`, `hopline.cards.get`, `hopline.cards.history`, `hopline.fares.products`.
  - *Agent writes (12):* `hopline.saved.add`, `hopline.saved.remove`, `hopline.subscriptions.create`, `hopline.subscriptions.update`, `hopline.subscriptions.delete`, `hopline.notifications.acknowledge`, `hopline.cards.add_value`, `hopline.cards.set_autoreload`, `hopline.passes.purchase`, `hopline.passes.cancel`, `hopline.cards.report_lost`, `hopline.reduced_fare.apply`.
  - *Infra only:* `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and the host clock operation `env.advance_time`. None is listed or callable on the Agent connection, so the agent cannot publish alerts, change facility status, record taps, decide eligibility, settle loads or move time.
  - *GUI:* none in the first version, and no reviewer console.
- **State and lifecycle (required):** App, account and run state are kept separate; writes are idempotent and versioned, and reset restores only this instance.
  - *App state* is read-only catalog data shipped with the package: fare rules and products with a version, pathway and facility types, the alert cause and effect vocabularies, and limits.
  - *Account state* is seeded per task: the rider, payment methods (masked; a seed flag can make one fail), cards with balances, passes and tap history, reduced-fare status, saved places and commutes, subscriptions and past notifications.
  - *Run state:*
    - the task's network: stops, stations, pathways, facilities, routes, frequency schedules and service periods;
    - run effects: alerts, trip updates, facility status history, ledger entries, applications, notifications, applied event IDs and the virtual clock.
  - *Seed checks:* at `env.load_seed`, no alert version, trip update, facility status, tap or ledger entry may be dated after the seed's `virtual_now`. During event processing, runtime 1.6.0 exposes the event's `at` as `ctx.virtual_now` to the handler and the validation that follows, so data an event adds always passes this check.
  - *Write guarantees:*
    - Every write takes `request_id` and the App-instance `expected_version` (`{epoch, revision}`) from the agent's latest read.
    - Core rejects a stale version with `stale_version` and no partial effect. Every event and clock advance moves the version, so an agent must re-read.
    - A repeated `request_id` returns the original receipt, with no second load, purchase or replacement.
    - Reads, including planning, change nothing.
    - Core's per-App lock orders writes and events by commit.
  - *Reset:* `reset_scope: app_instance` restores this instance's seed and loaded clock. Messages already delivered to Mail stay in Mail. Messaging keeps receipts per run, so each rollout uses a fresh run.
  - *Snapshot:* includes alert chains, facility history, the ledger, taps and notifications.
- **Events and notifications (required):** Seven Infra-applied event operations whose timing the task decides, and no clock event; outgoing notifications are Email through Mail's existing receive contract.
  - *Ownership:* tasks choose the content and timing of every event, and Hopline never schedules one. Hopline only defines each event's business effect and validity.
  - *Accepted operations:*
    - `service.alert_published` (`alert`, `update` or `cancel`);
    - `service.trip_updated` (delay, cancellation or skipped stops for one trip instance);
    - `facility.status_changed` (`out_of_service` with an `expected_return` estimate, or `restored`);
    - `fare.tap_recorded` (applies the transfer, cap, pass and reduced-fare rules, or records a declined tap with its reason);
    - `fare.eligibility_decided`;
    - `payment.settled` (a pending load becomes `load_settled` or `load_failed`);
    - `notification.delivery_recorded` (as in the delivery table below).
  - *Rejected without effect:* unknown alert, trip, facility, card or load references; a stale alert version; a second decision on an application; a settlement for a load that is not pending.
  - *Time:* Hopline follows the environment clock and has no timers or scheduler. Infra moves the clock with an event's `at` or with Core's Infra-only `env.advance_time` (runtime 1.6.0, `docs/runtime-time.md`), which runs no App code. Every time-based status is therefore derived from `ctx.virtual_now` wherever it is read or written, including the outbound adapter:
    - an alert's `upcoming`, `active` or `ended`;
    - a pass's `scheduled`, `active` or `expired`;
    - an eligibility's `expired`;
    - a held notification's release;
    - the weekly cap window.
  - *Already handled by Core:* backwards time is rejected, and a repeated `event_id` is replayed.

  Examples, in time order. They come from different rows of the core examples table, so they are not one continuous run:

  ```json
  {"event_id":"ev-el12-out","at":"2026-12-07T06:40:00-05:00","operation":"facility.status_changed","payload":{"facility_id":"fac-el12","stop_id":"st-central","status":"out_of_service","since":"2026-12-07T06:40:00-05:00","expected_return":"2026-12-08T18:00:00-05:00","note":"Door fault"}}
  {"event_id":"ev-dlv-sub3","at":"2026-12-07T06:43:00-05:00","operation":"notification.delivery_recorded","payload":{"notification_id":"n-sub3-fac-el12-1-dana","status":"committed","code":null,"stop_run":false,"router_event_id":"router-4c2e9a1b7d6f5e3c8a0b1d2e3f4a5b6c"}}
  {"event_id":"ev-40-detour-1","at":"2026-12-07T07:00:00-05:00","operation":"service.alert_published","payload":{"alert_id":"al-40-detour","version":1,"msg_type":"alert","cause":"construction","effect":"stop_moved","informed":{"route_ids":["rt-40"],"stop_ids":["st-elm-3rd"]},"replacement_stop_id":"st-elm-4th","active_periods":[{"start":"2026-12-07T09:00:00-05:00","end":"2026-12-07T17:00:00-05:00"}],"header":"Route 40: Elm & 3rd stop moved to Elm & 4th"}}
  {"event_id":"ev-blue-0752","at":"2026-12-07T07:46:00-05:00","operation":"service.trip_updated","payload":{"trip_id":"trip:blue:nb:2026-12-07:0752","delay_min":9,"cancelled":false,"skipped_stop_ids":[]}}
  {"event_id":"ev-load-lee","at":"2026-12-07T12:10:00-05:00","operation":"payment.settled","payload":{"ledger_entry_id":"le-lee-41","outcome":"settled"}}
  {"event_id":"ev-tap-dana-10","at":"2026-12-11T17:40:00-05:00","operation":"fare.tap_recorded","payload":{"tap_id":"tp-dana-10","card_id":"cd-dana","stop_id":"st-harbor-sq","route_id":"rt-blue","mode":"rail"}}
  {"event_id":"ev-elig-lee","at":"2026-12-14T10:00:00-05:00","operation":"fare.eligibility_decided","payload":{"application_id":"ap-lee-1","decision":"approved","program":"senior","expires_at":"2027-12-31T23:59:00-05:00"}}
  ```

  *Notifications sent:* one Email per notification with delivery `mail`.

  - Hopline's App-owned outbound adapter (`src/publisher.cjs`, following Mail's publisher pattern) reads `pending_delivery` records, as derived at `ctx.virtual_now`, from an Infra snapshot.
  - It builds the receiver-owned message for the recipient taken from the trusted binding, and publishes it through Messaging with `request_id` equal to the notification ID.
  - Infra records the outcome with `notification.delivery_recorded`. The payload carries Messaging's `status`, `code`, `stop_run` (treated as false when Messaging omits it) and the router `event_id`:

  | Messaging result | Notification becomes |
  | :--- | :--- |
  | `committed` | `delivered`, with the router `event_id` stored |
  | `rejected` without `stop_run` (for example `recipient_not_authorized`, `incompatible_contract`, `source_identity_mismatch`) | `delivery_failed`, with the code stored |
  | any result with `stop_run: true`: `rejected` (`receiver_rejected`, `concurrent_dispatch`, `receiver_lifecycle_changed`), `unknown` (`receiver_unconfirmed`, `receipt_audit_failed`) or `halted` (`run_halted`) | stays `pending_delivery` with the code stored; the run halts for reconciliation, per the Messaging rules |

  Example wire message (validated as described under Internal personal apps):

  ```json
  {"specversion":"1.0","id":"hopline-n-sub3-fac-el12-1-dana","source":"urn:pale:app:hopline:account:hopline-dana","type":"org.pale.mail.notification.v1","time":"2026-12-07T06:42:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","subject":"fac-el12","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-dana"},"source_object":{"app_id":"hopline","account_id":"hopline-dana","object_type":"facility","object_id":"fac-el12"},"content":{"title":"Elevator out at Central: your step-free commute is affected","body":{"format":"text/plain","text":"The street-to-platform elevator at Central (EL-12) is out of service from Mon Dec 7, 06:40 EST; expected back Tue Dec 8, 18:00 EST (estimate). Your saved commute Home to Harbor Square via Central has no step-free path while it is out. Step-free alternatives: Bus 40 to Harbor Square (about 18 min longer)."},"asset_ids":[]},"extensions":[]}}
  ```
- **Shared data and dependencies (required):** Hopline-owned object IDs, people through `binding.json`, JSON only, and a package that runs on its own with the shared runtime.
  - *IDs:* stops, pathways, facilities, routes, trip instances, alerts, cards, ledger entries, subscriptions and notifications are Hopline-owned IDs. The rider is a `person_id` from `binding.json`, mapped to a Mail account when notifications are expected.
  - *Formats:* JSON only, with no media or attachments. Money is in integer cents in USD. Times are RFC 3339 with UTC offsets plus the network's IANA time zone.
  - *Standalone package boundary:*
    - Business tests and the example run from `apps/hopline/` with only the package and the pinned public runtime (runtime 1.6.0, Core API 1.2.0).
    - The package contains the generated copy of Mail's wire schema for its `messaging.publishes` declaration.
    - Mail 1.3.0 and Messaging are needed only for the integration test and example. There Mail is a scenario recipient in the run assembly (`app:verify --with examples/apps/mail` and the example's router configuration), not a package dependency in `app.json` or `required_apps`.
    - No external service.

## 4. Construction plan and effort

Specify how the environment will be built, what will be collected or synthesized, and how each deliverable will be checked. Include expected counts or coverage where relevant. Effort estimates may be ranges; use person-days for human work. Mark reusable components and explain any workstream that is not applicable.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Package `apps/hopline/` containing: manifest; 25 tools with the `hopline.` prefix; 7 event handlers; frequency-based trip computation with stable IDs; the deterministic earliest-arrival planner with step-free pathway filtering and `uses_estimates`; alert version chains with derived status; facility status history; trip updates; the fare engine (transfers, weekly cap, monthly pass, reduced fare, negative-balance allowance); the card ledger with pending loads and lost-card replacement; subscriptions with trigger keys and quiet-hour release derived from `ctx.virtual_now`; the outbound Mail adapter. MCP only. Reuses the public runtime launcher, Core and Mail's publisher pattern. | Every row of the core examples table passes as a named business test with the stated result or state. `app:verify` confirms the separation between the Agent and Infra connections. | 3.5–4.5 |
| Data and image collection | N/A: no real network, timetable, fare or rider data is collected. GTFS and GTFS Realtime are used only as format references. | A provenance note in `dataset.json` stating that all records are synthetic, and citing the GTFS specifications as format references. | 0 |
| Synthetic data and assets | A deterministic, seeded generator. **Network (fixture metro Ashford):** 2 rail lines and 2 bus routes, about 45 stops, 6 stations with entrances, platforms and pathways, about 20 elevators and escalators, and weekday, Saturday and Sunday frequency schedules. **Three riders:** (a) a wheelchair user with a reduced-fare card, a saved commute through Central and 6 months of taps (about 250); (b) a parent with a stroller who travels 3–5 days a week (about 180 taps); (c) an airport visitor with a stored-value card and a lost-card history. | The validator checks: every pathway connects declared nodes; every station marked step-free has a step-free path from an entrance to each platform; trip instances are reproducible from schedules; every tap's charge matches the fare rules at its time; balances reconcile with the ledger; no record is dated after the seed time; local times are correct across DST; byte-identical regeneration from the same seed. Each seed stays below 400 KB of JSON. | 1–1.5 |
| App integrations | Mail, send-only, for notifications, through Mail's existing `channel.email` receive contract (`urn:pale:email-message:2` / `urn:pale:email-payload:1`). Hopline declares a matching `messaging.publishes` entry with a generated copy of Mail's wire schema (its hash must match the receiver's). The example's Messaging configuration grants `channel.email` to the bound Mail account, as in `examples/workflows/delivery-to-mail/`. No other App is changed. | An integration test through public Messaging covers four cases: (1) one triggered subscription produces exactly one inbox message in Mail's state, with a committed receipt; (2) republishing returns `duplicate: true` with Mail unchanged; (3) an ungranted recipient is rejected, Mail is unchanged and the notification becomes `delivery_failed`; (4) a `held_quiet_hours` notification is not published before `release_at`, and is published once with its original ID after `env.advance_time`. | 0.5 |
| Validation and reset | **Business tests:** trip instances and departures with live delays; the planner on the core examples, including step-free exclusion, `uses_estimates`, `no_step_free_route` with blockers, detours with moved stops and cancelled trips; alert chains and derived status; a facility not restored by its estimate alone; subscription trigger keys, held release after `env.advance_time` and withdrawal; every fare rule boundary (transfer window, the cap reached mid-fare, Monday reset, pass month, reduced fare from its decision, the negative-balance allowance); pending versus settled loads; lost-card transfer and declined taps; repeated `request_id`; Core `stale_version` after an event; seed rejecting future-dated records while events still apply; tool names accepted by the registry loader. **Public-runtime checks:** management tools (including `env.advance_time`) absent for the Agent, seed loading, clock advance, reset and snapshot. **Human review points:** realism of the network, schedules and fares, and the wording of alerts and notifications. | `npm test` and `app:verify` reports with exact App, Core and runtime versions. A table mapping each workflow to its tests. Two resets giving byte-identical business data and virtual time. An explicit list of anything incomplete at first-version submission. | 1–1.25 |

- **Milestones, owners and dependencies (required):** One owner, four milestones, and first-version submission within 14 days of plan approval; nothing is blocking.
  - Owner of all workstreams: Xinru Jiang ([@Oshikaka](https://github.com/Oshikaka)).
  - M0, during design review: settle tool names, the event vocabulary and the fare catalog. Ask the author of [#110](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/110) which route edges and facility events the task needs. Confirm the scope boundary with [#149](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/149).
  - After plan approval:
    - M1, days 1–6: network model, trip computation, departures, the planner and alerts, with business tests.
    - M2, days 7–10: facilities, trip updates, fare engine, card ledger, passes and reduced fare.
    - M3, days 11–13: subscriptions, notifications, Mail adapter, integration test, generator, the three riders, validators, `app:verify` and evidence.
    - First-version submission (`/submit-implementation`) by day 14.
  - Dependencies:
    - The public runtime 1.6.0 and Mail 1.3.0 on `main` are available now.
    - One platform dependency has a fallback described in §3: the runner calling the outbound adapter (fallback: in-app records and explicit invocation).
    - This author also has Gustline ([#126](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/126)) under review and Curbline in preparation. First-version windows will be scheduled not to overlap, or an extension will be requested before a deadline.
- **Resources and total effort (required):** 6–7.75 person-days. No paid data, model or API usage, GPU or hosting. Tests run on a laptop CPU in minutes. The repository footprint stays under 1.5 MB, almost all of it fixture JSON.
- **Scope boundary and open questions (required):** Planning, disruptions, facilities, subscriptions and the fare card only; three open questions to settle with the Environment reviewers.
  - *Excluded:* maps and imagery; live feeds; vehicle positions; crowding; assistance bookings (TransitWallet); paratransit; bike and scooter share; multi-agency fare integration; refunds for delayed trips; physical card shipping; any GUI.
  - *Deferred:* chat delivery through the Messages App; a read-only reviewer renderer; GTFS import of a task-supplied feed.
  - *Open questions, to be settled with the Environment reviewers before approval:*
    1. Should step-free plans include an elevator whose estimated return precedes the leg, as proposed with `uses_estimates`, or exclude it until a restoration event?
    2. Is the frequency-based schedule enough for the first version, or are exact per-trip timetables needed for the linked tasks?
    3. Should `notification.delivery_recorded` be kept, or should graders read Mail only?
- **License and external dependencies (required):** MIT, with everything redistributed in the repository and no external service at run time.
  - Code, schemas and generated fixtures are under the repository's MIT license and redistributed in the repository. Nothing is hosted.
  - The network, stops, schedules, fares, riders and cards are synthetic.
  - The MBTA is cited only as a public interaction reference, and GTFS and GTFS Realtime only as format references. No names (other than in that citation), logos, maps, schedules or text are reproduced.
  - No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
