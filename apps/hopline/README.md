# Hopline

Hopline is a resettable, synthetic transit App for Personal Agents' Last Exam. It covers:
- trip planning on a timetable at the run's virtual time;
- service alerts, trip delays and elevator outages;
- step-free routing;
- a fare card with passes, a weekly cap and reduced fares.

Every plan names the alert versions, facility states and trip updates it used, and the card ledger and tap history show what was actually paid. Graders can therefore check what the agent saw and did.

Approved proposal: [`proposals/environment/hopline-transit-trips.md`](../../proposals/environment/hopline-transit-trips.md) (PR #171, approved at `a98971a`).

## Run it

Node.js 18 or newer; no packages to install.

```sh
# App-only business tests and the walkthrough (no runtime needed)
cd apps/hopline
npm test
npm run example

# Regenerate, or check for drift in, the generated contracts and fixtures
npm run build
npm run check

# From the repository root: real MCP verification with the public runtime
npm run app:verify -- --app apps/hopline --output .artifacts/hopline.json

# Runtime and Mail integration through real MCP processes (needs the full checkout)
cd apps/hopline && npm run integration
```

`npm run integration` runs `tests/runtime.integration.cjs` and then `examples/mail-integration/run.cjs`.

The first checks four things:
- a repeated `request_id` creates one load;
- a plan changes nothing;
- `env.advance_time` releases a quiet-hour hold with no data change;
- `stale_version` after an event and two byte-identical resets.

The second covers four delivery cases:
- delivery to Mail;
- a duplicate republish;
- an ungranted recipient;
- a quiet-hour release (a declined-tap card notice at 00:20).

## Web page

Hopline has a business web page served by the shared Web Host (`runtime/web/server.cjs`), following the `apps/notes` convention: `contribution/gui.json` declares the `pale.web` extension, `gui/index.html` is the page and `gui/src/app.js` the controller. From the repository root:

```sh
node runtime/web/server.cjs --app hopline --registry <registry listing apps/hopline> --run web-demo --profile sandbox
```

The page has seven sections:
- **saved trips:** places and commutes, each with a plan action;
- **stations and elevators:** each facility's status, estimate and whether the estimate has passed;
- **alerts:** with their version chains;
- **routes:** patterns, frequencies and the trip-ID rule;
- **cards:** balance, pending loads, passes, weekly cap, reduced fare and autoreload;
- **subscriptions:** with their revisions;
- **notices.**

Record actions open forms built from the live tool schemas with the record's IDs filled in. They plan a trip, show departures, subscribe, add value, buy or cancel a pass, set autoreload, apply for a reduced fare, report a card lost and show history. Pause, resume, delete and mark-as-read run in one click. Global actions plan a trip, list departures, save a place or commute, and create a subscription. Read results, such as a plan or departures, show in the detail pane.

All data comes from the Agent MCP tools through the Host, and times are shown in the network's time zone. `npm run gui` (`tests/gui.browser.cjs`, which needs Playwright at the repository root) drives the page in Chromium. It checks every effect in MCP state, including an outage applied through Infra and then seen after Refresh, and writes screenshots to `.artifacts/web/`.

## Package boundary

Business tests and the example run from this folder with only the package. MCP verification needs the pinned public runtime (runtime 1.6.0, Core API 1.2.0). The package carries a byte-identical copy of Mail's wire schema (`schemas/mail-router-message.schema.json`) for its `messaging.publishes` declaration. Mail 1.3.0 and Messaging are needed only for the integration example, where Mail is a scenario recipient in the run assembly. Mail is not listed in `app.json` dependencies. No external service is used.

## Network

The fixture metro Ashford is in `America/New_York`. It has:
- 2 rail lines: Blue and Red;
- 2 bus routes: 12 and 40;
- 25 stops, 6 of them stations with entrances, platforms and pathways;
- 17 elevators, escalators and ramps;
- weekday, Saturday and Sunday frequency schedules.

`scripts/ashford.cjs` defines it.

**Trip IDs.** A trip instance is computed from its pattern's frequencies (as in GTFS `frequencies.txt`, exact times). Its ID is fixed, so task authors can write `service.trip_updated` events before the run:

```
trip:<route short name>:<direction nb|sb>:<service date YYYY-MM-DD>:<HHMM leaving the pattern's first stop>
```

For example, `trip:blue:nb:2026-12-07:0752` leaves Central at 07:52, and `trip:40:nb:2026-12-07:0741` leaves Elm & 3rd at 07:41. Bus 40 also runs a weekday-peak short turn from Market & 5th (`:26` and `:56`), so `trip:40:nb:2026-12-07:0756` starts at Market & 5th. `hopline.routes.get` returns the rule and every pattern's offsets and frequencies.

## Workflows

| Workflow | Agent tools | What it covers |
| :--- | :--- | :--- |
| 1. Network and departures | `places.search`, `stops.get`, `routes.get`, `departures.list` | Stops with entrances, platforms, pathways and facility status at `as_of`; departures with live estimates, cancellations, skipped and moved stops |
| 2. Trip planning | `trips.plan` | Earliest-arrival search with step-free filtering, `uses_estimates`, blockers, the card's fare, and the service state used |
| 3. Alerts, trip updates, facilities | `alerts.list`, `alerts.get` | Alert version chains with `upcoming`, `active`, `ended` and `cancelled` derived at the virtual time; facility status history |
| 4. Saved commutes and subscriptions | `saved.list/add/remove`, `subscriptions.list/create/update/delete`, `notifications.list/acknowledge` | Saved places and commutes, subscriptions with windows, quiet hours and `urgent_override`, trigger keys, held release and withdrawal |
| 5. Fare card | `cards.get`, `cards.history`, `fares.products`, `cards.add_value`, `cards.set_autoreload`, `passes.purchase`, `passes.cancel`, `cards.report_lost`, `reduced_fare.apply` | Transfers, the weekly cap, monthly passes, reduced fares, the negative-balance allowance, pending loads, autoreload and lost-card replacement |

All tool names carry the `hopline.` prefix: 13 reads and 12 writes. Every read returns `as_of`. Infra-only operations (`env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, `env.advance_time`) are not available to the Agent.

### Planning

- **Search:** a deterministic time-dependent earliest-arrival search in rounds, as in RAPTOR, over the computed trips. Walking follows station pathways and place access links. Each pathway is checked against facility status at the time it is reached.
- **Itineraries:** up to three:
  1. the earliest arrival;
  2. the earliest with fewer transfers;
  3. the earliest whose first route differs.

  Duplicates are dropped, and so is an alternative that is no better than an earlier one in arrival, transfers or walking.
- **Departure window:** with `depart_at`, the first ride leaves within 30 minutes. With `arrive_by`, Hopline finds the latest departure that still arrives in time.
- **Endpoints:** a place, or a stop ID. A station is entered and left through its street entrances and bus bays, so its elevators count for step-free plans. The same origin and destination returns `no_route`.
- **Fares in plans:** the fare is quoted for `card_id` (pass, cap, reduced fare and transfers from its history). Without a card, full fares with the transfer rule are quoted.
- **Step-free:** stairs and escalators are excluded, and so is any elevator or ramp that is out of service at the leg's time. An outage whose estimated return is still in the future at `as_of`, but before the leg, is allowed and listed in `uses_estimates`. Once the estimate has passed with no `restored` event, the facility is excluded again and reported as a blocker with `estimate_passed`.
- **Blockers:** the disruptions that the itineraries of a search ignoring disruptions would hit. These are out-of-service facilities, cancelled trips, skipped stops and closed stops. Such an itinerary is skipped only if a returned itinerary has the same edges. A plan returns blockers, and `no_step_free_route` and `no_route` name them in their message.
- **Edges:** each itinerary also lists `edges`: every access link, pathway and ride it traverses, in order. The first edge starts at the plan's `from`, each edge starts at the node where the previous one ends, and the last ends at `to`. Every edge has `enter_at` and `exit_at`.
  - `access`: `link_id`, which is `acc:<place_id>:<node_id>` (a stop's own nodes join it at zero length, as `acc:<stop_id>:<node_id>`), `length_m` and `step_free`. A place links to each node at most once.
  - `pathway`: `pathway_id`, the direction walked (`from`, `to`), `mode`, `length_m` and `step_free`. On a facility's pathway it also has `facility_id`, the `facility_status` and `facility_status_seq` it was checked against at `enter_at`, as known at `as_of` (`0` means no status record), and `uses_estimate`.
  - `ride`: `trip_id`, `route_id`, `mode`, the node and stop IDs at each end, departure and arrival.

  `legs` remain the readable view. A walk leg that only uses an access link has an empty `pathways` list; the link is in `edges`.
- **Alerts in planning:**
  - `stop_moved` (with `replacement_stop_id`) moves the boarding stop for the informed routes;
  - `stop_closed` closes stops;
  - `no_service` removes trips;
  - `detour`, `reduced_service` and `significant_delays` are listed in `service_state`.

### Fares

- **Base fares:** rail $2.40, bus $1.70.
- **Transfers:** within 120 minutes of a paid boarding that started a fare, one transfer costs only the difference: bus to rail $0.70, rail to bus free. A $0.00 boarding (under a pass or a reached cap) starts no transfer.
- **Weekly cap:** $22.50 over Monday 00:00 to the next Monday 00:00, local time. The tap that reaches the cap pays only the remainder.
- **Reduced fare:** halves fares and the cap.
- **Monthly pass:** $90.00; every tap in its month is $0.00.
- **Negative balance:** a charged tap may take the balance down to minus the card's current rail fare; $0.00 taps are always accepted.
- **Autoreload:** checked only inside `fare.tap_recorded`, and it creates at most one pending load.
- **Lost cards:** `report_lost` issues `<card>~r<n>`, carrying over:
  - the settled balance;
  - pending loads, with the same ledger IDs;
  - passes;
  - the reduced fare and any pending application;
  - weekly cap progress (through the card lineage);
  - the autoreload rule;
  - card subscriptions.

  A $5.00 fee is debited, or owed and taken from the next settled load.

## Events

The task chooses the content and timing of every event; Hopline only defines its effect.

| Operation | Effect |
| :--- | :--- |
| `service.alert_published` | `alert`, `update` or `cancel` added to a version chain. Updates and cancels may omit fields that carry over, and must reference the latest version if they give references |
| `service.trip_updated` | Delay, cancellation or skipped stops for one computed trip; each update gets the next sequence number |
| `facility.status_changed` | `out_of_service` with an estimate (a later one replaces the estimate), or `restored` |
| `fare.tap_recorded` | Applies the fare rules, or records a declined tap (`card_blocked`, `insufficient_balance`) |
| `fare.eligibility_decided` | Decides the pending reduced-fare application |
| `payment.settled` | A pending load becomes `load_settled` or `load_failed` (a payment method seeded with `fails: true` always fails) |
| `notification.delivery_recorded` | Optional back-fill of a Messaging outcome (see Mail delivery) |

**No-op or rejection.** A moot event commits with no business change, and its reason is kept in `ignored_events`. A rejected event changes nothing, and Core returns its error.

| Case | Outcome |
| :--- | :--- |
| `payment.settled` with `card_id` and `settle: oldest_pending` when nothing is pending | no-op, recorded |
| `facility.status_changed` `restored` for a facility already in service | no-op, recorded |
| `payment.settled` or `fare.eligibility_decided` naming a replaced card | redirected to the active replacement, recorded in `redirects` |
| `fare.tap_recorded` with a blocked card | committed as a declined tap (`card_blocked`), never redirected |
| unknown alert in an update or cancel | rejected `alert_reference_unknown` |
| an alert ID that exists, a version not above the latest, or an update after a cancel | rejected `stale_alert_version` |
| a trip ID with no computed instance | rejected `unknown_trip` |
| an unknown facility | rejected `unknown_facility` |
| an unknown card, route or stop | rejected `card_not_found`, `route_not_found`, `stop_not_found` |
| a tap whose mode does not match its route | rejected `mode_mismatch` |
| `payment.settled` naming an unknown ledger entry | rejected `invalid_event` |
| `payment.settled` naming a load that is not pending | rejected `load_not_pending` |
| a second decision on an application | rejected `application_not_pending` |
| an impossible date (such as `2026-02-30`) | rejected `invalid_event` |

## Subscriptions and notifications

Subscriptions are evaluated only when a business event is applied, in subscription-ID order. They are never evaluated on reads or on clock movement.

- **Route, stop and facility subscriptions** fire when an event informs their target inside their window.
- **Card subscriptions** fire when a charged tap takes the balance below the alert level (from at or above it), on a declined tap, on a settled or failed load, and on an eligibility decision.
- **Saved-commute subscriptions** evaluate every occurrence of the commute window within the 7-day planning horizon. For each occurrence, Hopline compares the usual itinerary (planned ignoring disruptions) with the best one available now. The commute is affected on that date if:
  - no itinerary is left; or
  - the usual itinerary uses something disrupted; or
  - the best available one relies on an estimated return; or
  - it rides a trip delayed by at least the threshold; or
  - a stop it uses has moved.

  One event produces at most one notification per subscription, however many dates it affects. When a cancelled alert or a restored facility resolves a cause the person was already told about, a "back to normal" notice follows.
- **Trigger key** `(subscription_id, source_id, source_version, recipient)`. The notification ID derives from it, for example `n-sub3-fac-el12-1-dana`, and is the Messaging `request_id`. Replays create nothing. Messaging IDs do not allow `~`, so a replacement card's `~` is written as `.` in notification IDs and in the message's `subject` and `source_object.object_id`.
- **Quiet hours** hold a notification once until `release_at`. From `release_at` on it reads as `pending_delivery`, wherever it is read or written.
  - A newer version of the same source withdraws the held notice, even when the newer version creates no notice itself. An event that resolves its cause before release does too.
  - `urgent_override` releases `no_service` and `stop_closed` alerts at once.

## Mail delivery

`src/publisher.cjs` is a standalone entry point, `deliver({infra, router})`. Its inputs are fixed: an Infra connection to this instance and a Messaging client bound to this publisher, while the recipient comes from the notification record of the trusted binding.
1. It reads notifications that are `pending_delivery` at the current virtual time from an Infra snapshot.
2. It builds Mail's `channel.email` message (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`). Title, body and `time` are frozen on the notification, so a retry sends identical bytes.
3. It publishes with `request_id` equal to the notification ID.

The example and the integration test call it explicitly; no platform step calls it after events or clock advances yet. **When nobody calls it, a mail notification stays `pending_delivery`. That is a normal outcome, not an error.** Mail's state and the Messaging receipt decide whether a notification was delivered. `notification.delivery_recorded` is only an optional back-fill of that outcome into Hopline:

| Messaging result | Notification becomes |
| :--- | :--- |
| `committed` | `delivered`, with the router `event_id` |
| `rejected` without `stop_run` | `delivery_failed`, with the code |
| `rejected` with `idempotency_conflict` | stays `pending_delivery` |
| any result with `stop_run: true` | stays `pending_delivery`, with the code; the run halts for reconciliation |

## Using Hopline in a task

A task supplies its own network and history as a seed through `env.load_seed`. The contract is `schemas/seed.schema.json`, and Hopline rejects an inconsistent seed with `invalid_seed`. The packs below are worked examples.

- **Named endpoints** are `places` (`address` or `landmark`), each with up to 10 access links to network nodes. A plan starts and ends at a place or a stop.
- **Walking-only networks:** a seed with no routes plans walks over access links and pathways alone. Every node and every facility belongs to a stop, so a building or passage with a lift is a `station` whose entrances are its nodes. The walking-network test in `tests/business.test.cjs` has a lift, a stair passage and a longer ramp.
- **Outages** are `facility.status_changed` events that the task scripts in advance. `since` may be earlier than the event, but a plan sees the new status only from the event time (`recorded_at`) on.
- **Grading a committed itinerary:** take `env.snapshot` and replay the itinerary's `edges` against it:
  - the edges are joined from `from` to `to`;
  - each access link and pathway exists, in an allowed direction, with that length and duration;
  - each ride's trip serves both nodes at those times and is not cancelled;
  - each facility's history gives the status the edge reports at `enter_at`.

  To judge passability with what became known later, read the snapshot's full facility history instead of the entry the plan saw. `replayEdges` in `tests/business.test.cjs` does these checks.

## Scenario packs

Each pack in `examples/packs/<name>/` has a `seed.json`, `binding.json` and `clock.json` that a task can load, and an `events.json` with events in time order. The tests load every pack and replay all its events.

| Pack | Contents |
| :--- | :--- |
| `wheelchair-commute` | A wheelchair user with a reduced-fare card and autoreload, commuting from Elm & 3rd to Mill Street through Central. About 380 taps since January 2025 (one commuting day a week in 2025, then up to four). Events: EL-12 fails before dawn (held by quiet hours), a Bus 12 delay, a later estimate, then the restoration. There is no step-free alternative to Mill Street |
| `stroller-weekend` | A parent with a stroller who rides on Saturdays from January 2025 and 3–5 days a week from June 2026, with a saved Saturday outing to the aquarium. Events: a weekend `stop_moved` detour that is updated and then cancelled, an escalator outage, and a tap at the moved stop |
| `airport-lost-card` | An airport visitor whose stored-value card was reported lost with a load pending. Events: a settlement written against the old card (redirected), a tap with the old card (declined), and taps with the replacement |

## Data

`scripts/generate-fixtures.cjs` writes every fixture and pack deterministically from a fixed seed; `npm run check` fails if a regenerated file differs. Rider history (taps, loads, settlements, saved items and subscriptions) is produced by running Hopline's own handlers in time order. Every seeded charge and balance is therefore one the App computes, and balances reconcile with the ledger. History starts in January 2025, about two years before the core examples, and the task timeline starts in 2026. Each seed stays under 400 KB. Dana's card has full fares until her reduced fare is approved in March 2026, and Lee's card joins the account in June 2026. The network, schedules, fares, riders and cards are synthetic. GTFS and GTFS Realtime are format references only (`contribution/dataset.json`).

## Implementation notes

The three items from the plan review:
1. **Mail sender and grading source:** see Mail delivery above. The adapter is an explicit entry point, `pending_delivery` without a caller is normal, and delivery is judged from Mail's state and the receipt.
2. **Estimated returns in subscriptions:** a commute that works only through an estimated return counts as affected, and the notice says the time is an estimate. All commute occurrences within 7 days are evaluated, and one event produces one notice.
3. **Events naming a replaced card:** `payment.settled` and `fare.eligibility_decided` are redirected to the replacement and recorded; see the no-op and rejection table above.

Other details the approved plan left open:
- **Short-turn trips:** Bus 40 runs a weekday-peak short turn from Market & 5th, so the 07:56 trip in the core examples does not serve Elm & 3rd.
- **Departure window:** the first ride must leave within 30 minutes of `depart_at`. Without a window, a later direct bus would always exist, and `no_step_free_route` could never occur.
- **Dominated alternatives:** an alternative no better than an earlier itinerary in arrival, transfers or walking is dropped, so a step-free request at 07:35 returns Bus 40 alone.
- **Nested inputs are optional in tool schemas:** a subscription's `window` and `quiet_hours`, a commute's `window`, and `set_autoreload`'s `rule` have no required inner fields, so a form can leave them empty. The handlers check that a given one is complete (`invalid_window`, `invalid_amount`). `set_autoreload` without a `rule` turns autoreload off.
- **`reduced_fare.apply`** returns `application_status`, because Core reserves `status` in every result.
- **`not_eligible_program`** is returned when the card already has an approved, unexpired reduced fare.
- **Error codes beyond the proposal's lists:** `alert_not_found` (`alerts.get`), `pass_not_found` (`passes.cancel`), `load_not_pending` and `application_not_pending` (events). An unknown facility is `unknown_facility` everywhere.
- **Deleted subscriptions** are kept as tombstones with their revisions.
- **Saved places in use:** a saved place is in use while a subscription targets a commute that starts or ends at it. After the subscription is deleted, the place can be removed, and the commute keeps its own copy of the place reference.
- **Not done in v1:**
  - preview-and-confirm steps for loads, passes and lost cards (a non-blocking review suggestion);
  - shared places with Curbline (#169), which is not yet implemented.
- **TransitWallet (#149):** Hopline handles timetable planning, elevator status and the fare card. TransitWallet handles assistance bookings and equipment verification. The two share no money and exchange no messages.

## Limitations

- Frequency-based schedules, not per-trip timetables. No vehicle positions, crowding, maps, paratransit, bike share or multi-agency fares.
- One account per App instance; one business web page (see Web page), no reviewer console.
- Automatic invocation of the outbound adapter belongs to the planned runner; the example and tests invoke it explicitly.
