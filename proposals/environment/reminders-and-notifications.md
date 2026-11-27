# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Work & business] Reminders and phone notifications`

## 1. App and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Reference app or website / URL (required):** Calendar event alerts and the phone notification center:
  - [Google Calendar event notifications](https://support.google.com/calendar/answer/37242)
  - [Apple Reminders](https://support.apple.com/guide/reminders/welcome/mac)
  - [iOS notifications and Focus](https://support.apple.com/guide/iphone/intro-to-notifications-iph7c3d6f7bf/ios)
  - [ntfy](https://github.com/binwiederhier/ntfy) and [Gotify](https://github.com/gotify/server) as open-source push-feed references.
- **Primary domain (required):** Work & business
- **Secondary domains (optional):** None. This is a shared personal-device App: the workflows (timed alerts, a notification feed, quiet hours) are used across domains. Our tasks use it for travel, fitness and money, but it adds no domain-specific behavior.

## 2. What you plan to build

**✍️ Your answer (required):** A small App, `notify`, with three workflows that the current Apps cannot express.

1. **Timed reminders.** An agent creates a reminder that fires at a time or a set number of minutes before a Calendar event, with a short actionable text, then lists, edits or cancels it. A reminder moves through `scheduled → delivered | silenced | cancelled`.
   - Calendar events carry no alert fields, and `docs/personal-apps.md` notes that reminder execution needs a host capability.
   - Tasks therefore cannot test the most common personal-agent handoff: "put it on my calendar with an alert".
2. **Notification feed.** Other Apps push notifications to the user's phone through Messaging on `channel.push`. Examples are a grocery substitution, an airline schedule change or a delivered reminder. The feed stores each item with its source, time and read or dismissed state.
3. **Device attention settings.** Focus or Do-Not-Disturb schedules and a "silence until" state. A reminder or push that arrives inside a quiet window is stored as `silenced` rather than `delivered`, so tasks can grade whether an agent respected the user's quiet hours.

**Why it matters.** Many personal-agent tasks hinge on what happens while the agent is not running. In each case the only way to reach the user later is an alert the user actually receives. Three open task proposals depend on this today:
- [#49](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/49): a two-alert budget across weeks;
- [#52](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/52): eight alerts a day with quiet windows;
- [#55](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/55): a check-in timed between a spouse's action and a seat sell-out.

The App records exactly which alerts reached the user and when. That is also the evidence a runner needs to start a user session when an actionable alert fires.

## 3. Potential app connections

- **Internal personal apps (required):**
  - **Calendar** (optional, read-only): a reminder may reference a Calendar event by ID and fire relative to its start. The reference is stored and resolved by the runner or the agent through the existing [`calendar.get`](../../examples/apps/calendar/tools.json) tool. Calendar is not modified, and `notify` does not become a Calendar receiver. Without Calendar, reminders use absolute times.
  - **Contacts** (optional): the device owner is a bound person reference. No contact data is copied.
  - **Mail** (none in initial scope): pushes are a separate channel from email.
- **Other apps and websites (required):** Any App may publish to `channel.push` using this App's receive contract. The examples are FreshCart ([#37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/37)) substitution alerts and an airline schedule change ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)). Initial scope ships only the receive contract and a test sender fixture; senders adopt it in their own PRs.

### Integration details

- **Operations and access (required):**
  - **Agent MCP tools:**
    - `notify.reminder.create(title, fire_at | {calendar_event_ref, minutes_before}, body?, actionable?)`
    - `notify.reminder.list(from?, to?, status?)`, `notify.reminder.get(id)`
    - `notify.reminder.update(id, …)` (only while `scheduled`), `notify.reminder.cancel(id)`
    - `notify.feed.list(since?, unread_only?)`, `notify.feed.mark_read(id)`
    - `notify.focus.get()`
  - **User-side tools** (for the user harness or GUI): `notify.focus.set(schedule)`, `notify.device.silence_until(time)`, `notify.feed.dismiss(id)`.
  - **Infra management:**
    - `env.load_seed` (reminders, focus schedule, feed history);
    - `env.snapshot` and reset;
    - `env.advance_time` (runtime 1.6.0);
    - `env.apply_event` with `reminder.fire`: the runner fires each due reminder at its time, in chronological order. Apps do not schedule themselves.
    - The read-only management query `notify.reminder.due(from, to)` tells the runner which reminders fall due in a window.
  - **GUI:** a lock-screen style feed and a reminder list.
- **State and lifecycle (required):**
  - State is per App instance, account and run, following Core.
  - Seeds set the initial reminders, focus schedule and past feed items; reset restores them.
  - `reminder.fire` is idempotent per reminder ID:
    - a second fire returns the original receipt;
    - firing a cancelled reminder is a recorded no-op;
    - firing before `fire_at` returns `not_due`.
  - When fired, a reminder becomes `delivered` or `silenced`, depending on focus and silence state at that virtual time. A matching feed item is written in the same commit.
  - Agent writes use version checks; concurrent edits after a fire are rejected with `stale_version`.
- **Events and notifications (required):**
  - **Accepts:**
    - `reminder.fire` from Infra, example `{"event_id":"fire-r12","at":"2027-03-02T21:40:00-06:00","operation":"reminder.fire","payload":{"reminder_id":"r12"}}`;
    - `channel.push` messages through Messaging, receiver-owned payload `urn:pale:push-payload:1`: `{source_app, title, body, actionable, deep_link?}`.
  - **Sends:** nothing in initial scope.
  - **Task scenarios decide** when reminders fire (via the runner) and when pushes arrive.
- **Shared data and dependencies (required):**
  - People are bound person references, and Calendar events are opaque references `{app_id:"calendar", event_id}`.
  - No media in v1: text only.
  - The package runs on its own with only the shared runtime (Core API 1.2.0, runtime 1.6.0). Calendar and Contacts are optional connections, not `required_apps`.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `apps/notify/` package following the personal-Apps layout: `tools.json` with 8 agent tools and 3 user-side tools, a plugin with the reminder state machine, focus and silence evaluation at `ctx.virtual_now`, a feed store, the `reminder.fire` and push receive handlers, and a small GUI with a feed and a reminder list. Reuses the shared validator and helper templates. | Business tests for every transition and error: create/update/cancel; fire when due, early, twice or after cancel; silenced inside focus or silence; push received, read and dismissed. Every test asserts the resulting state. | 4–5 |
| Data and image collection | N/A: no external data or images. | N/A | 0 |
| Synthetic data and assets | Example seed: one owner, a weekday focus schedule, 5 reminders (some tied to Calendar events), 6 past feed items from 3 sources. | Seed validates against the schema; IDs and times are consistent; reset restores it exactly. | 0.5 |
| App integrations | Push receive contract (`urn:pale:push-payload:1`), declared in `messaging.receives`, plus a publish-only test sender. Optional Calendar reference resolved through the existing `calendar.get`. A cross-App example in `examples/workflows/calendar-reminder/`: create a Calendar event, create a reminder 15 minutes before it, advance time, fire the due reminder, read the delivered feed item; repeat inside a focus window to see `silenced`. | Real MCP connections to Calendar and Messaging; receiver-side evidence (feed item and receipt) for push; a rejected push for an unbound recipient; no Calendar state changed. | 2 |
| Validation and reset | `node runtime/cli.cjs verify --app apps/notify`, the business tests, and the workflow example, plus history-loading, reset and `env.advance_time` checks. | After implementation: exact App and runtime versions, commands and reports covering permissions (agent cannot call `reminder.fire` or `focus.set`), state consistency, reset, and the declared Calendar and Messaging integrations. | 1.5 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams. The order is:
  1. Schemas and the reminder state machine.
  2. Feed and push receiver.
  3. Focus and silence.
  4. Calendar workflow example.
  5. Validation report.

  v1 within 14 days of plan approval, per CONTRIBUTING. Dependencies: public runtime 1.6.0 and Core API 1.2.0 (available); Calendar reference App (available, used read-only). **Not owned by this App:** a runner or user harness that starts a user session when an actionable reminder is delivered. The App supplies the delivery record and the `notify.reminder.due` query; the session start belongs to the planned runner (see `docs/environment-architecture.md`). We will coordinate this hook with the Infrastructure Leads. Dependent task proposals: #49, #52, #55.
- **Resources and total effort (required):** 8–9 person-days. No GPU, paid data or hosted services. Small JSON state; local stdio MCP only.
- **Scope boundary and open questions (required):**
  - **Excluded:** recurring reminders, snoozing, location-based reminders, real device push (APNs or FCM), sounds and badges, and per-App notification permissions beyond sender binding.
  - **Open questions:**
    1. Should reminders tied to a Calendar event follow it when the event moves (that needs a Calendar change notification, which Calendar lacks today), or stay at the original time? v1 keeps the original time and records the event reference.
    2. Should the runner's session trigger be a field on the reminder (`actionable: true`) or a task-level rule? v1 stores `actionable` and leaves the decision to the task.
    3. Should per-user behaviors, such as "silences the phone after eight buzzes", be App state (`silence_until`, set by the user harness) as proposed, or task logic only?

    These will be settled in design review.
- **License and external dependencies (required):** Original code under the repository's MIT license. No code, assets or screenshots are copied from the reference products. ntfy (Apache-2.0 / GPL-2.0) and Gotify (MIT) informed only the feed model. No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
