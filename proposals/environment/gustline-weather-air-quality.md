# Environment Track proposal

**PR title format:** `[Environment Proposal] [<Domain>] <App or website name>`

Example: `[Environment Proposal] [Work & business] Google Calendar`

Copy this template to `proposals/environment/<slug>.md`. Keep the overview concise. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

After design approval, use the [App contribution guide](../../docs/app-contribution.md) and [public Core / Messaging runtime](../../runtime/README.md) to reproduce local integration checks. For connections to existing Apps, consult their [business and receive contracts](../../docs/app-integrations.md) before implementing the sender.

## 1. App and domains

- **Authors / GitHub handles (required):** Xinru Jiang ([@Oshikaka](https://github.com/Oshikaka))
- **Reference app or website / URL (required):** Gustline, an independently branded synthetic weather and air-quality service. Public interaction references: U.S. National Weather Service forecasts and alerts (https://www.weather.gov/) and AirNow (https://www.airnow.gov/).
- **Primary domain (required):** Weather & outdoors
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

**✍️ Your answer (required):** Gustline is a resettable weather and air-quality service. Every answer comes from the forecast issued most recently before the run's virtual time. Superseded forecasts and alert revisions stay queryable, and the person's own alert rules fire on new data.

**Why it matters for personal agents.** The weather is the same for everyone. What differs is the person: the hours they will be outside, the places they care about, the conditions they set as their own limits, their time zone, and when they want to be told. Weather is rarely the task itself. It is the evidence that keeps changing while a plan is underway. Agents fail here in recognisable ways:

- They answer from an older forecast after a newer one has arrived.
- They read a day's headline as if it described the person's own hours.
- They mix up the place's time zone and the user's.
- They miss that an alert was extended or cancelled.
- They treat a forecast as an observation, raise an alarm without cause, or act without rechecking.

Gustline makes each of these gradable from records. Every read returns the `issuance_id`, `issued_at` and `as_of` it was answered from. Superseded issuances and earlier alert versions are retained.

**Distinct scope and overlaps (checked 2026-11-21).**

- Switchback ([#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25)) models campground reservations, with facility-scoped alerts (fire restriction, closures, smoke advisory) that affect bookings and a facility forecast panel. Gustline does not model reservations or their effects. It is a general source of meteorological and air-quality forecasts, observations and official advisories for any place a task defines. The two can coexist: Switchback keeps alerts that change a booking, and Gustline provides the weather evidence behind a go/no-go decision.
- Rainshadow ([#123](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/123), opened 2026-11-20) plans a general weather App with the same core: issuances with issue times and kept history, `alert` / `update` / `cancel` threads, a US AQI source, saved places with personal watches and quiet hours, and optional Mail notices. The two are alternatives for weather evidence; both may proceed, and a task builds on one of them.
  - *What Gustline adds:*
    - monitor-level air observations, from which the App computes AQI with a recorded EPA table version;
    - observation corrections with their revisions;
    - two fixed providers with different schedules and wording;
    - UV and the other hourly fields;
    - daylight times and text products;
    - **recurring** personal rules (for example every weekday 07:00–15:00), with one trigger key per window occurrence.
  - *What Rainshadow centres on:* a watch for one outing (a single window with several alternative conditions and an evaluation record), alert acknowledgement, and a daily AQI taken as issued.
  - *Division of scope:* routine, recurring conditions and observation-based air quality suit Gustline; one-off outing checks suit either.
  - *Seed alignment:* the #123 author has offered to align seed shapes for places, issuances and alert messages, so that a task can move between the two. Gustline will adopt the same field names where the meaning is the same (M0).

Two open Task proposals plan task-local fixtures that a reusable weather App would replace:

- [#95](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/95) needs a deterministic forecast, alert and park-status fixture with 2 providers and 3 issuances. It now names Gustline as its first choice and Rainshadow as the alternative.
- [#113](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/113) needs "a small simulated air-quality advisory feed".

Five workflows. Each lists its entities, transitions, operations (R = read, W = write) and errors.

1. **Places and settings.**
   - *Entities:*
     - place: `place_id`, name, kind (`city`, `park`, `campground`, `venue`, `airport`, `address`), latitude, longitude, elevation, IANA time zone, forecast zone, air area, and an optional `external_ref` (`app_id`, `account_id`, `object_id`) that links the place to an object in another App, such as a Switchback facility;
     - saved place: account-scoped label such as "Home" or "Kids' school";
     - account settings: units `metric | us`, the person's own time zone (used for quiet hours), default saved place.
   - *Operations:* R `gustline.places.search` (seeded gazetteer only, no geocoding service), R `gustline.places.get`, R `gustline.saved_places.list`, R `gustline.settings.get`; W `gustline.saved_places.add`, W `gustline.saved_places.rename`, W `gustline.saved_places.remove`, W `gustline.settings.update`.
   - *Errors:* `place_not_found`, `duplicate_saved_place`, `saved_place_limit` (20), `saved_place_in_use` (any rule, active or paused, refers to it; delete or retarget the rule first).

2. **Forecasts, observations and daylight** (reads evaluated at the run's virtual time).
   - *Entities:*
     - provider: two synthetic providers with different issuance schedules and wording, `gustline` and `regional_office`;
     - forecast issuance: `issuance_id`, provider, zone, `issued_at`, valid window, hourly periods up to 72 h, daily periods up to 7 days, optional text products (`outlook`, `discussion`);
       - hourly fields: temperature, feels-like, precipitation probability and amount, thunder probability, wind, gust, wind direction, cloud cover, visibility, UV index, humidity;
       - daily fields: high, low, precipitation probability, headline text;
     - observation: station, `observed_at`, measured values, optional `correction_of`.
   - *Transitions:* an issuance is `current` until a later issuance for the same provider and zone is applied, then `superseded`. An observation is `reported`, then `corrected` when a correction arrives; the earlier value stays in `revisions`.
   - *Operations:*
     - R `gustline.forecast.get(place_id, from, to, granularity, provider?)`: periods in the place's local time with UTC offsets, plus `issuance_id`, `issued_at`, `as_of` and `other_providers_available`;
     - R `gustline.forecast.history(place_id, kind, provider?)`: the issuances for that place, newest first, each with its supersession status;
     - R `gustline.observations.get(place_id, from, to)`;
     - R `gustline.astro.get(place_id, date)`: sunrise, sunset, civil dawn and dusk, computed with the public-domain NOAA solar algorithm.
   - *Errors:* `no_issuance`, `outside_horizon`, `invalid_window`, `not_yet_observed` (any part of the window is after `as_of`).
   - *Missing data:* a field a provider does not forecast is `null` and listed in `not_provided`. The App never fills a gap from another provider.

3. **Air quality.**
   - *Entities:*
     - air area;
     - monitor;
     - air observation: hourly PM2.5, PM10 and O3 concentrations;
     - air forecast issuance: area, `issued_at`, dates, AQI category per day, dominant pollutant, narrative.
   - *How AQI is computed:* the App computes AQI from the supplied concentrations with the U.S. EPA breakpoint tables. It records the table version used (`epa-2024`) so that every category can be recomputed. PM2.5 and PM10 use the hourly concentration, a documented simplification of NowCast (see open question 1). O3 uses the 8-hour rolling mean once 8 consecutive hourly values exist; before that, O3 AQI is `null` and listed in `not_provided`. Overall AQI is the maximum across pollutants.
   - *Operations:* R `gustline.air.current(place_id)` (per-pollutant AQI, overall AQI, category, dominant pollutant, monitor, `observed_at`, and `stale: true` when the latest observation is more than 3 h old); R `gustline.air.forecast(place_id, from_date, to_date)`. Air-forecast history uses `gustline.forecast.history` with `kind: air`.
   - *Errors:* `no_monitor_for_place`, `no_issuance`.

4. **Official alerts and advisories.** This is a subset of the OASIS Common Alerting Protocol 1.2 (a public standard).
   - *Entity:* alert: `alert_id`, `version`, `msg_type` (`alert | update | cancel`), issuer, `event`, severity, urgency, certainty, areas (forecast zones, air areas or places), onset, expires, headline, description, instruction, references to earlier versions.
     - Controlled `event` list: `flood_watch`, `flood_warning`, `severe_thunderstorm_watch`, `severe_thunderstorm_warning`, `heat_advisory`, `excessive_heat_warning`, `wind_advisory`, `winter_storm_warning`, `red_flag_warning`, `air_quality_alert`, `smoke_advisory`, `area_closure`.
   - *Transitions:* `issued → updated (new version) → cancelled`. `upcoming`, `active` and `expired` are derived at read time from the virtual time, so reads never write.
   - *Operations:* R `gustline.alerts.list(place_id, status?)`, R `gustline.alerts.get(alert_id, version?)`. `gustline.alerts.get` returns the full version chain.
   - *Errors when an alert event is applied:* `alert_reference_unknown` (update or cancel of an unknown alert), `stale_alert_version` (version not greater than the latest).

5. **Personal alert rules and notifications.**
   - *Rule entity:* `rule_id`, saved place, kind, metric, comparator (`gte | lte`), threshold, `look_ahead_hours` (forecast rules, 1–72), active window, `notify_on_clear`, delivery (`mail | in_app`), quiet hours with `severe_override`, status (`active | paused`).
     - Kinds: `forecast_threshold`, `observation_threshold`, `official_alert` (an event list plus minimum severity).
     - Metrics: temperature high or low, feels-like, precipitation probability or amount, thunder probability, gust, UV index, AQI, AQI forecast category.
     - Active window: either recurring (days of week plus local start and end) or absolute (from and to; for example a trip watch).
     - Thresholds and stored values are always metric (°C, mm, kph, km, µg/m³, ppb), whatever `units` is set to.
     - Each rule keeps an App-owned `revision` and its revision history.
   - *Notification entity:* `notification_id`, rule, trigger key, trigger source (issuance, observation, or alert and version), virtual `created_at`, title, body with values in local time, `release_at`, `delivery_status` (`in_app | held_quiet_hours | pending_delivery | delivered | delivery_failed | withdrawn`), Messaging outcome, `acknowledged_at`. `notification_id` is derived from the trigger key, so it is the same after a reset and a republish is deduplicated. A notification held by quiet hours keeps that one ID through its release, and the same ID is the Messaging `request_id`.
   - *Operations:* R `gustline.rules.list`, R `gustline.rules.get` (with revision history), R `gustline.notifications.list`; W `gustline.rules.create`, W `gustline.rules.update`, W `gustline.rules.pause`, W `gustline.rules.resume`, W `gustline.rules.delete`, W `gustline.notifications.acknowledge`.
   - *Errors:* `invalid_rule` (metric does not fit the kind; threshold out of range, such as AQI above 500), `saved_place_not_found`, `rule_limit` (25), `rule_not_found`, `already_paused`, `not_paused`, `notification_not_found`. Stale writes are rejected by Core with `stale_version` (see State and lifecycle).
   - *Evaluation:*
     - Rules are evaluated only when a business event is applied, in a fixed order (by rule creation, then `rule_id`). They are never evaluated on reads or on clock movement.
     - Inside event handlers, "now" is the event's `at`, which runtime 1.6.0 exposes as `ctx.virtual_now` during event processing.
     - **Which events evaluate which rules:**
       - forecast rules: `weather.forecast_issued`, and `air.forecast_issued` for the AQI forecast category;
       - observation rules: `weather.observation_recorded` and `air.observation_recorded`;
       - official-alert rules: `alert.published`.
     - **Trigger keys** decide when a notification is created. A notification is created only when its key is new, so replays create nothing.
       - Threshold rules: the key is `(rule_id, occurrence_start, phase)`, with phase `met | cleared`. An occurrence is one instance of the active window; an absolute window is a single occurrence. A rule with no active window uses the local date, in the saved place's zone, of the first period that meets the threshold. Repeated exceedances within one occurrence create nothing more. A forecast that moves the exceedance into another occurrence creates a new key. A later evaluation that no longer meets the threshold creates `cleared`, and that is notified only with `notify_on_clear`.
       - Official-alert rules: the key is `(rule_id, alert_id, version)`. `alert` and `update` messages notify. A `cancel` notifies only with `notify_on_clear`. So a `flood_watch` and a later `flood_warning` on the same day are two notifications.
     - **Time zones:**
       - Windows and occurrences use the saved place's IANA zone. A window that crosses midnight belongs to the date it starts.
       - A local time skipped by a DST change moves forward to the next valid instant. A repeated local time uses its first instance.
       - Quiet hours use the account's time zone.
     - **Quiet hours defer delivery; they never drop it.**
       - A notification created inside quiet hours is stored once as `held_quiet_hours`, with `release_at` set to the end of that quiet period.
       - Its effective status is **derived from `ctx.virtual_now`**: from `release_at` on, it reads as `pending_delivery`. One shared App function applies this rule everywhere a notification is read or written, including the outbound adapter, which reads the Infra snapshot. Nothing has to run when the clock passes `release_at`.
       - If a later business event before `release_at` finds the condition no longer met, the record is marked `withdrawn` and is never sent.
       - An official alert of severity `severe` or `extreme` is delivered at once when the rule has `severe_override`.
     - A paused rule is not evaluated. A resumed rule is evaluated from the next event, with no retroactive notification.

**Core examples (precondition → action or event → expected outcome → control or error):**

| Workflow | Example |
| :--- | :--- |
| 2 | `regional_office` issuances at 17:00 and 05:00 MDT exist for zone `z-dunes`. Virtual time is `2026-09-12T07:20:00-05:00` (06:20 MDT). Call `gustline.forecast.get(pl_dunes, 09:00–19:00 MDT, hourly, regional_office)`. → The 11 hourly periods starting 09:00 through 19:00, in `-06:00`, `issuance_id: fc-ro-0500`, `as_of: 2026-09-12T07:20:00-05:00`, `other_providers_available: ["gustline"]`. → Before the 05:00 issuance event is applied, the same call returns `fc-ro-1700`; a later issuance is never visible early. A window ending 80 h ahead returns `outside_horizon`. |
| 2 | Three `regional_office` issuances applied. Call `gustline.forecast.history(pl_dunes, weather, regional_office)`. → Three rows, newest first; two are `superseded`. → The daily headline probability and the hourly probabilities are returned as issued, without any aggregation by Gustline. |
| 2 | Same virtual time (06:20 MDT). Station `st-dunes` has hourly observations to 06:00 MDT, and the 05:00 value was corrected by a later event. Call `gustline.observations.get` for 03:00–06:00 MDT. → 4 rows, the 05:00 row `corrected` with the earlier value in `revisions`. → Asking for 03:00–09:00 MDT returns `not_yet_observed` and no partial rows. |
| 3 | Monitor `mon-cedar` reports PM2.5 48.2 µg/m³ at 10:00 PDT. Call `gustline.air.current(pl_school)`. → AQI 132, `unhealthy_for_sensitive_groups`, dominant `pm25`, `aqi_table: epa-2024`. → With no observation in the last 3 h, the result carries the last value and `stale: true`. A place with no monitor returns `no_monitor_for_place`. |
| 4 | Alert `aqa-77` v1 (`smoke_advisory`, area `aa-cedar`, onset Oct 8 00:00, expires Oct 10 00:00 PDT). Apply an `update` v2 extending to Oct 11. → `gustline.alerts.get(aqa-77)` returns v2 `active` with v1 in its chain. → A `cancel` that names unknown `aqa-99` is rejected `alert_reference_unknown` and nothing changes. At virtual time after Oct 11 00:00, `gustline.alerts.list` reports v2 as `expired` without any write. |
| 5 | A rule exists: `observation_threshold`, AQI `gte` 101 at "Kids' school", weekdays 07:00–15:00, delivery `mail`. Air observations of AQI 132 at 10:00 and AQI 140 at 11:00 Friday are applied. → One notification `pending_delivery`, trigger key `(rule, 2027-10-08T07:00-07:00, met)`. → The 11:00 observation creates nothing. Replaying the 10:00 event with the same `event_id` returns `duplicate: true`. An exceedance in Monday's window is a new occurrence and creates one new notification. |
| 5 | A rule exists: `forecast_threshold`, gust `gte` 50 kph within 24 h at "Home", quiet hours 22:00–07:00. Issuances arrive at 23:10 and 05:00, both forecasting 62 kph for 17:00 the next day. → At 23:10, one `held_quiet_hours` notification with `release_at` 07:00 and nothing published; the 05:00 issuance creates nothing new. → After Infra advances the clock to 07:00 with `env.advance_time` (no App code runs), `gustline.notifications.list` and the outbound adapter both see the same notification as `pending_delivery`, and it is sent once. If an issuance before 07:00 had dropped the gust to 30 kph, the record would be `withdrawn` and never sent. |
| 5 | An `official_alert` rule exists for `flood_watch` and `flood_warning` at "Home". A `flood_watch` v1 arrives at 09:00, then a `flood_warning` v1 at 15:00. → Two notifications, keys `(rule, fw-1, 1)` and `(rule, fwn-2, 1)`. → An `update` v2 of the warning creates a third; its `cancel` creates nothing unless `notify_on_clear` is set. |
| 5 | The agent read the instance at version `{epoch 1, revision 41}`, then an air observation event was applied. Call `gustline.rules.update` with that `expected_version`. → Core rejects with `stale_version`; the rule is unchanged, and the agent must re-read. → `gustline.rules.create` with AQI threshold 600 returns `invalid_rule`. Repeating a successful `gustline.rules.create` with the same `request_id` returns the original rule and creates no second one. |
| 1 | "Kids' school" is used by rule `r-3`, which is paused. Call `gustline.saved_places.remove`. → `saved_place_in_use`. → After `gustline.rules.delete(r-3)`, the removal succeeds. |
| 5 + Mail | Notification `n-12` is `pending_delivery`, and Infra has granted `channel.email` to the bound Mail account. The outbound adapter publishes it. → Mail commits one inbox message titled "AQI 132 at Kids' school"; Infra applies `notification.delivery_recorded` with the router `event_id`, and `n-12` becomes `delivered`. → Publishing again returns `duplicate: true` and Mail is unchanged. Without the grant, Messaging rejects the message with `recipient_not_authorized`, Mail is unchanged, and `n-12` becomes `delivery_failed`. |

**Records for evaluation.** Gustline keeps business records, not a derived evaluation report:

- issuances, observations with their revisions, and alert version chains;
- rule revisions;
- notifications with their trigger sources and delivery outcomes.

Because each read result carries `issuance_id`, `issued_at` and `as_of`, a grader can join the supplied execution trace to the issuance that was current at that moment. That shows whether an agent rechecked before advising, or quoted a superseded number. Reads never mutate state. Reset clears Core's audit and receipts, so graders take `env.snapshot` before any `env.reset`.

**Downstream tasks this enables.** The App encodes none of their answers.

- [#95](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/95) "Brief a once-only White Sands visit on the weather for its actual time window": two providers, three issuances, a daily headline next to hourly data, two time zones, a Flood Watch and a park `area_closure` alert, loaded as one seed plus scheduled events.
- [#113](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/113) "Rework a booked camping weekend when a smoke advisory meets a companion's asthma": a `smoke_advisory` for one air area and a clear air forecast for another, while Switchback holds the booking.
- "Should I bike tomorrow?": the agent applies the person's own remembered gust and rain limits for the commute window, and creates or adjusts a rule instead of asking every day.
- A parent asks for a warning about air quality during school hours for a child with asthma. The agent must create the rule with the right saved place, window and threshold. Gustline stores thresholds, not diagnoses, so whether the condition is disclosed elsewhere stays gradable in Mail or chat.
- Heat check-ins for an older relative in another time zone: a heat advisory that is updated, then cancelled, with quiet hours that only a `severe` alert may override.

## 3. Potential app connections

Name possible connections and briefly explain their purpose. Internal personal apps include Mail, Calendar, Contacts and similar tools. Use `None` if no connection applies, or `TBD` if undecided.

For internal personal Apps, state which workflow needs each App and whether the connection is required or optional. Link the existing public interface/version, or identify the missing capability, owner and fallback.

- **Internal personal apps (required):** Mail is optional and send-only, for rule notifications through its existing `channel.email` contract. Calendar: None. Contacts: None.
  - **Mail.** Workflow 5 only. Optional: required only for rules whose delivery is `mail`. Send-only.
    - Interface reused, on `main` at `61b6371`: Mail's receive declaration in [`examples/apps/mail/contribution/contribution.json`](../../examples/apps/mail/contribution/contribution.json) (`channel.email`, wire `urn:pale:email-message:2`, event type `org.pale.mail.notification.v1`, operation `mail.receive_notification`) and payload [`urn:pale:email-payload:1`](../../examples/apps/mail/schemas/email-payload.schema.json), whose `content` requires `title`, `body` and `asset_ids`.
    - The example message under Events and notifications was checked with `runtime/contracts/schema-validator.cjs` against Mail's `schemas/router-message.schema.json` at that commit (Mail's messaging contract is unchanged since `534bed4`). It is valid; the same message without `content.asset_ids` is rejected.
    - Expected change in Mail: one inbox message per delivered notification, checked in Mail's own state and the Messaging receipt.
    - Missing capability: an automatic call to the outbound adapter after each Infra event belongs to the planned runner (platform-owned). Fallback: notifications are always recorded in Gustline (`in_app`), and the examples and tests invoke the adapter explicitly.
  - **Calendar:** None. An agent may read Calendar with Calendar's own tools; Gustline neither reads nor writes it, and Calendar has no Messaging receiver.
  - **Contacts:** None. No Gustline workflow needs it; people and accounts come from `binding.json`.
- **Other apps and websites (required):** Switchback (#25) as an optional neighbour with no messages exchanged; nothing else in the first version.
  - Switchback ([#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25)), optional and not a dependency. No messages are exchanged.
    - *Link:* a task that uses both gives the Gustline place an `external_ref` naming the Switchback facility (`app_id`, `account_id`, `object_id`).
    - *Check:* the reference is validated the same way as Mail's `event_ref` to a Calendar event: in `validateSeed`, the account and object must appear in the run binding, and Core receives it through the `references` hook. An unknown reference rejects the seed.
    - *Source of truth:* Switchback owns the facility's identity, bookings and closure effects. Gustline owns the place's weather attributes (coordinates, zone, air area) and all weather data.
  - Chat delivery is a possible later channel, not in the first version. It would target the Messages App's implemented receiver on `main` (`apps/messages` 1.0.0: `channel.chat`, operation `messages.receive`, payload `urn:pale:messages:chat-payload:1`), which delivers into an existing conversation.
  - No other connections.

### Integration details

- **Operations and access (required):** MCP only: 15 Agent reads and 10 Agent writes, with management operations available to Infra alone.
  - *Entry point:* MCP over stdio through the public runtime package contract on `main` at `61b6371` (runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0). One account per App instance, as in Mail; the Agent connection acts for that account.
  - *Agent reads (15):* `gustline.places.search`, `gustline.places.get`, `gustline.saved_places.list`, `gustline.settings.get`, `gustline.forecast.get`, `gustline.forecast.history`, `gustline.observations.get`, `gustline.astro.get`, `gustline.air.current`, `gustline.air.forecast`, `gustline.alerts.list`, `gustline.alerts.get`, `gustline.rules.list`, `gustline.rules.get`, `gustline.notifications.list`.
  - *Agent writes (10):* `gustline.saved_places.add`, `gustline.saved_places.rename`, `gustline.saved_places.remove`, `gustline.settings.update`, `gustline.rules.create`, `gustline.rules.update`, `gustline.rules.pause`, `gustline.rules.resume`, `gustline.rules.delete`, `gustline.notifications.acknowledge`.
  - *Infra only:* `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and the host clock operation `env.advance_time`. These are not listed or callable on the Agent connection, so the agent cannot set the clock, inject issuances, observations or alerts, load history or reset.
  - *GUI:* none in the first version, and no reviewer console.
- **State and lifecycle (required):** App, account and run state are kept separate; writes are idempotent and versioned, and reset restores only this instance.
  - *App state* is read-only catalog data shipped with the package: metric definitions and units, the EPA AQI breakpoint tables with their version, the alert event vocabulary and CAP enums, and the provider definitions.
  - *Account state* is seeded per task: settings, saved places, rules with revisions, notification history.
  - *Run state* covers the task's world plus run effects: places, zones, stations, monitors, forecast and air issuances, observations, alerts, notifications created during the run, applied event IDs and the virtual clock.
  - *Seed checks:* at `env.load_seed`, the seed is rejected if any issuance, observation or alert version is dated after the seed's `virtual_now`, so future data can only arrive through scheduled events. During event processing, runtime 1.6.0 exposes the event's `at` as `ctx.virtual_now` to the handler and to the validation that follows, so data an event adds always passes this check.
  - *Write guarantees:*
    - Every write takes `request_id` and the App-instance `expected_version` (`{epoch, revision}`) from the agent's latest read.
    - Core rejects a stale version with `stale_version` and no partial effect. Every applied event also advances the version, so an agent must re-read after new data arrives.
    - A repeated `request_id` returns the original receipt and changes nothing.
    - Reads change nothing; Core rejects a read handler that tries to.
    - Core's per-App lock orders writes and events by commit, so a rule edited after an event does not notify retroactively.
  - *Reset:* `reset_scope: app_instance` restores this instance's seed data and loaded clock. Messages already delivered to Mail stay in Mail.
  - *Snapshot:* includes issuances, alert chains, rule revisions and notifications.
- **Events and notifications (required):** Six Infra-applied event operations whose timing the task decides, and no clock event; outgoing notifications are Email through Mail's existing receive contract.
  - *Ownership:* tasks choose the content and timing of every event, and Gustline never schedules one. Gustline only defines each event's business effect.
  - *Accepted Infra-applied operations:*
    - `weather.forecast_issued` (new current issuance; the previous one for that provider and zone becomes `superseded`; forecast rules are evaluated);
    - `weather.observation_recorded` (new or corrected observation; observation rules are evaluated);
    - `air.observation_recorded` (AQI computed and stored; AQI rules are evaluated);
    - `air.forecast_issued` (new current air forecast for an area; AQI forecast-category rules are evaluated);
    - `alert.published` (`alert`, `update` or `cancel`; alert rules are evaluated);
    - `notification.delivery_recorded` (stores the Messaging outcome for one notification).
  - *Rejected without effect:*
    - `issued_at` or `observed_at` later than the event's `at`;
    - an issuance older than the current one for the same provider and zone;
    - an alert-chain error;
    - `correction_of` naming an unknown observation (`observation_not_found`);
    - a delivery outcome for an unknown notification, or one that is not `pending_delivery` (`notification_not_found`, `notification_not_pending`).
  - *Already handled by Core:* backwards time is rejected, and a repeated `event_id` is replayed.
  - *Time:* Gustline follows the environment clock and has no timers, scheduler or clock event.
    - Infra moves the clock with an event's `at`, or with Core's Infra-only `env.advance_time` (runtime 1.6.0, `docs/runtime-time.md`), which runs no App code.
    - Every time-based status is therefore stored as a due time and derived from `ctx.virtual_now` wherever it is read or written: an alert's `upcoming`, `active` or `expired`; an air observation's `stale`; a held notification's release. The outbound adapter uses the same derivation.

  Examples:

  ```json
  {"event_id":"ev-fc-ro-0500","at":"2026-09-12T05:02:00-06:00","operation":"weather.forecast_issued","payload":{"issuance_id":"fc-ro-0500","provider":"regional_office","zone_id":"z-dunes","issued_at":"2026-09-12T05:00:00-06:00","valid_from":"2026-09-12T06:00:00-06:00","valid_to":"2026-09-15T06:00:00-06:00","hourly":[{"start":"2026-09-12T15:00:00-06:00","temp_c":32.5,"precip_prob_pct":55,"thunder_prob_pct":40,"wind_kph":20,"gust_kph":48}],"daily":[{"date":"2026-09-12","high_c":34,"low_c":17,"precip_prob_pct":60,"headline":"Afternoon storms"}],"products":[{"kind":"outlook","text":"Storms may become strong after 3 PM."}]}}
  {"event_id":"ev-obs-0600","at":"2026-09-12T06:10:00-06:00","operation":"weather.observation_recorded","payload":{"observation_id":"ob-dunes-0500c","station_id":"st-dunes","observed_at":"2026-09-12T05:00:00-06:00","correction_of":"ob-dunes-0500","temp_c":18.4,"wind_kph":9,"gust_kph":17,"precip_mm":0}}
  {"event_id":"ev-ao-1000","at":"2027-10-08T10:05:00-07:00","operation":"air.observation_recorded","payload":{"observation_id":"ao-cedar-1000","monitor_id":"mon-cedar","observed_at":"2027-10-08T10:00:00-07:00","pm25_ugm3":48.2,"o3_ppb":31}}
  {"event_id":"ev-af-1006","at":"2027-10-06T14:00:00-07:00","operation":"air.forecast_issued","payload":{"issuance_id":"af-cedar-1006","air_area_id":"aa-cedar","issued_at":"2027-10-06T13:30:00-07:00","days":[{"date":"2027-10-08","aqi_category":"unhealthy_for_sensitive_groups","dominant_pollutant":"pm25"},{"date":"2027-10-09","aqi_category":"moderate","dominant_pollutant":"pm25"}],"narrative":"Smoke from a fire to the south is expected to settle in the basin on Friday."}}
  {"event_id":"ev-aqa-77-v2","at":"2027-10-06T09:00:00-07:00","operation":"alert.published","payload":{"alert_id":"aqa-77","version":2,"msg_type":"update","references":[{"alert_id":"aqa-77","version":1}],"issuer":"Cedar Basin Air District","event":"smoke_advisory","severity":"moderate","urgency":"expected","certainty":"likely","areas":{"air_area_ids":["aa-cedar"]},"onset":"2027-10-08T00:00:00-07:00","expires":"2027-10-11T00:00:00-07:00","headline":"Smoke advisory extended through Sunday","instruction":"Sensitive groups should limit time outdoors."}}
  {"event_id":"ev-dlv-n12","at":"2027-10-08T10:06:00-07:00","operation":"notification.delivery_recorded","payload":{"notification_id":"n-12","status":"committed","code":null,"stop_run":false,"router_event_id":"router-3f9c2a7b1d0e4c55a8e1b2c3d4e5f607"}}
  ```

  *Notifications sent:* one Email per notification with delivery `mail`.

  - Gustline's App-owned outbound adapter (`src/publisher.cjs`, following Mail's publisher pattern) reads `pending_delivery` records from an Infra snapshot, so its reads are not counted as the Agent's.
  - It builds the receiver-owned message for the recipient taken from the trusted binding, and publishes it through Messaging with `request_id` equal to the notification ID.
  - Infra then records the outcome with `notification.delivery_recorded`. The payload carries Messaging's `status`, `code`, `stop_run` (treated as false when Messaging omits it) and the router `event_id`:

  | Messaging result | Notification becomes |
  | :--- | :--- |
  | `committed` | `delivered`, with the router `event_id` stored |
  | `rejected` without `stop_run` (for example `recipient_not_authorized`, `incompatible_contract`, `source_identity_mismatch`) | `delivery_failed`, with the code stored |
  | any result with `stop_run: true`: `rejected` (`receiver_rejected`, `concurrent_dispatch`, `receiver_lifecycle_changed`), `unknown` (`receiver_unconfirmed`, `receipt_audit_failed`) or `halted` (`run_halted`) | stays `pending_delivery` with the code stored; the run halts for reconciliation, per the Messaging rules |

  Example wire message (validated as described under Internal personal apps):

  ```json
  {"specversion":"1.0","id":"gustline-n-12","source":"urn:pale:app:gustline:account:gustline-ana","type":"org.pale.mail.notification.v1","time":"2027-10-08T10:05:00-07:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","subject":"n-12","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-ana"},"source_object":{"app_id":"gustline","account_id":"gustline-ana","object_type":"notification","object_id":"n-12"},"content":{"title":"AQI 132 at Kids' school","body":{"format":"text/plain","text":"Air quality at Kids' school reached AQI 132 (Unhealthy for Sensitive Groups, PM2.5) at 10:00 PDT on Fri Oct 8. Your rule: AQI 101 or higher, weekdays 07:00-15:00."},"asset_ids":[]},"extensions":[]}}
  ```
- **Shared data and dependencies (required):** Gustline-owned object IDs, people through `binding.json`, JSON only, and no external service.
  - *IDs:* places, zones, stations, monitors, alerts, rules and notifications are Gustline-owned IDs. People and accounts are referenced through `binding.json` (`person_id` → Gustline account → Mail account for the notification recipient). A place in another App is linked through the place's `external_ref`, checked against the binding's account and object lists as Mail checks `event_ref`. Records are not copied between Apps.
  - *Formats:* JSON only, with no media or attachments. Times are RFC 3339 with UTC offsets plus the place's IANA time zone. Values and thresholds are stored in metric units (°C, mm, kph, km, µg/m³, ppb) and rendered in `us` units on request. The AQI table version is stored with each computed value.
  - *Standalone package boundary:*
    - Business tests and the example run from `apps/gustline/` with only the package and the pinned public runtime (runtime 1.6.0, Core API 1.2.0).
    - The package contains the generated copy of Mail's wire schema used by its `messaging.publishes` declaration.
    - Mail 1.3.0 and Messaging are needed only for the integration test and example. There Mail is a scenario recipient supplied in the run assembly (`app:verify --with examples/apps/mail` and the example's router configuration). It is not listed in `app.json.dependencies` or `required_apps`, following `docs/app-integrations.md`.
    - No external service.

## 4. Construction plan and effort

Specify how the environment will be built, what will be collected or synthesized, and how each deliverable will be checked. Include expected counts or coverage where relevant. Effort estimates may be ranges; use person-days for human work. Mark reusable components and explain any workstream that is not applicable.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Package `apps/gustline/` containing: manifest; 25 tools named with the `gustline.` prefix that the registry loader requires; 6 event handlers; issuance selection at virtual time; observation corrections; AQI from versioned EPA tables; alert version chains with read-time status; the rule engine (occurrences, trigger keys by rule kind, quiet-hour release derived from `ctx.virtual_now`); notification records; the outbound Mail adapter; the NOAA solar calculation; IANA time-zone rendering across DST changes. MCP only. Reuses the public runtime launcher, Core and Mail's publisher pattern. | Every row of the core examples table passes as a named business test with the stated result or state. `app:verify` confirms the separation between the Agent and Infra connections. | 3–4 |
| Data and image collection | Coordinates, elevation and IANA time zone for about 6 real public places (for example a national park and two cities), taken from the USGS Geographic Names Information System (public domain) and the IANA tz database (public domain). The AQI breakpoint tables come from the U.S. EPA Technical Assistance Document for the Reporting of Daily Air Quality (2024 PM2.5 revision), a U.S. federal government work in the public domain. No weather, air-quality or alert data is collected. No images. | A source table in `dataset.json` listing each source, its version and its reuse basis, including the EPA table. Each coordinate is checked against the named place and time zone, and each breakpoint row against the EPA document. | 0.25 |
| Synthetic data and assets | A deterministic, seeded generator writes three scenario packs, each loadable by a task as seed plus events: **(A) desert park storm day:** 2 providers, 3 issuances each, a Flood Watch that is issued and updated, an `area_closure`, 48 observations. **(B) smoke week:** 2 air areas, 2 monitors, 5 days of hourly PM2.5/O3 (240 rows), 10 air-forecast issuances, and a `smoke_advisory` that is issued, extended and cancelled. **(C) commuter week:** home, work and school, two issuances a day for 7 days, a heat advisory, a wind advisory and a severe thunderstorm warning (for the quiet-hours override), 4 rules and 6 past notifications. In total about 12 places (6 fictional), 6 zones, 4 stations, 3 monitors, about 45 issuances, about 400 observations and 6 alerts with 9 versions. | The validator checks: value ranges; gust ≥ wind; dew point ≤ temperature; daily periods covering the hourly window; recomputed AQI equal to the stored category; valid alert chains; no record dated after the seed time; correct local times across DST; and byte-identical regeneration from the same seed. Each pack stays below 400 KB of JSON. | 1–1.5 |
| App integrations | Mail, send-only, for rule notifications, through Mail's existing `channel.email` receive contract (`urn:pale:email-message:2` / `urn:pale:email-payload:1`). Gustline declares a matching `messaging.publishes` entry with a generated copy of Mail's wire schema (its hash must match the receiver's). The example's Messaging configuration grants `channel.email` to the bound Mail account, as in `examples/workflows/delivery-to-mail/`. The outbound adapter and the `notification.delivery_recorded` handler are Gustline's own. No other App is changed. | An integration test through public Messaging covers four cases: (1) one triggered rule produces exactly one inbox message in Mail's state, with a committed receipt; (2) republishing returns `duplicate: true` with Mail unchanged; (3) an ungranted recipient is rejected, Mail is unchanged and the notification becomes `delivery_failed`; (4) a `held_quiet_hours` notification is not published before `release_at`. After `env.advance_time` past `release_at` it is published once, with its original ID. | 0.5 |
| Validation and reset | **Business tests:** issuance visibility before and after its event; `outside_horizon`; `not_yet_observed`; corrections; DST rendering; AQI breakpoint boundaries (35.4 → 100, 35.5 → 101 for PM2.5); alert update, cancel, unknown reference, stale version and derived expiry; threshold occurrences and alert-version keys (two different alerts on one day, an update after midnight); quiet-hour hold and release after `env.advance_time` (no handler runs, and reads and the adapter agree), withdrawal when the condition clears first; the severe override; a rule with no active window; pause and resume; tool names accepted by the registry loader; windows crossing midnight and DST; `saved_place_in_use` for a paused rule; repeated `request_id`; Core `stale_version` after an event; seed rejecting future-dated records while events still apply. **Public-runtime checks:** management tools (including `env.advance_time`) absent for the Agent, seed loading, clock advance, reset and snapshot. **Human review points:** realism of the synthetic weather and air series, and the wording of alerts and notifications. | `npm test` and `app:verify` reports with exact App, Core and runtime versions. A table mapping each workflow to its tests. Two resets giving byte-identical business data and virtual time. An explicit list of anything incomplete at first-version submission. | 1–1.25 |

- **Milestones, owners and dependencies (required):** One owner, four milestones, and first-version submission within 14 days of plan approval; nothing is blocking.
  - Owner of all workstreams: Xinru Jiang ([@Oshikaka](https://github.com/Oshikaka)).
  - M0, during design review: settle tool names and the event vocabulary; offer packs A and B to the authors of [#95](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/95) and [#113](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/113); confirm the scope boundary with [#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25).
  - After plan approval:
    - M1, days 1–6: catalog, places, forecasts, observations, air quality, alerts and time handling, each with business tests.
    - M2, days 7–10: rule engine, notifications, Mail adapter and integration test.
    - M3, days 11–13: generator, the three packs, validators, `app:verify` and evidence.
    - First-version submission (`/submit-implementation`) by day 14.
  - Dependencies: the public runtime and Mail 1.3.0 on `main` are available now. One platform dependency has a fallback described in §3: the runner invoking the outbound adapter after events and clock advances (fallback: in-app records and explicit invocation). Time synchronization uses runtime 1.6.0's `env.advance_time`, which is available now. Nothing is blocking.
- **Resources and total effort (required):** 5.75–7.5 person-days. No paid data, model or API usage, GPU or hosting. Tests run on a laptop CPU in minutes. The repository footprint stays under 1.5 MB, almost all of it fixture JSON.
- **Scope boundary and open questions (required):** Forecast, air-quality, alert and rule data only; three open questions to settle with the Environment reviewers.
  - *Excluded:* radar and satellite imagery, maps, live feeds, forecast-skill scoring, pollen, marine, aviation and tropical products, push or SMS delivery, several people in one instance, and any GUI.
  - *Deferred:* chat delivery through the Messages App's `channel.chat` receiver (`urn:pale:messages:chat-payload:1`); a read-only reviewer renderer.
  - *Open questions, to be settled with the Environment reviewers before approval:*
    1. Should PM2.5 and PM10 AQI use EPA NowCast (a 12-hour weighted average, as AirNow displays) or the hourly concentration? The default is hourly, with the simplification documented; O3 uses the 8-hour rolling mean in either case.
    2. Should Infra record delivery outcomes through `notification.delivery_recorded`, or should graders read Mail only? The default is both.
    3. Is `area_closure` acceptable as an issuer alert, so that tasks without a site App (such as #95) can model a park closure? Reservation effects stay with Apps like Switchback.
- **License and external dependencies (required):** MIT, with everything redistributed in the repository and no external service at run time.
  - Code, schemas and generated fixtures are under the repository's MIT license and redistributed in the repository. Nothing is hosted.
  - Place facts come from USGS GNIS and the IANA tz database (both public domain) and are recorded in `dataset.json`.
  - The National Weather Service, AirNow and OASIS CAP are cited as interaction and format references only. No logos, icons, text or data are reproduced.
  - No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
