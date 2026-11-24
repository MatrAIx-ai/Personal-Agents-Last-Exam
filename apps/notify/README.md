# Notify App

Reminders and phone notifications for PALE tasks: an Agent schedules a reminder, the phone receives it at its time (or arrives silently inside a quiet window), and other Apps push notifications to the same lock-screen feed. Package version 1.0.0, Core API 1.2.0, synthetic data. Environment proposal: [#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191).

## Run locally

Requires Node.js 18 or newer. From the repository root:

```sh
node --test apps/notify/tests/business.test.cjs
node apps/notify/examples/run.cjs
node runtime/cli.cjs verify --app apps/notify --output .artifacts/notify.json
npm run example:calendar-reminder
```

With only this folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` inside it. `node build/schemas.cjs` regenerates `tools.json`, the seed, event, push-payload and wire schemas from one source; `--check` fails on drift and the business tests run it when the public runtime is present.

## Workflows

| Workflow | How it works |
| --- | --- |
| Timed reminders | `notify.reminder.create` takes either `fire_at` or a Calendar anchor (`calendar_account_id`, `calendar_event_id`, `event_start` as read with `calendar.get`, `minutes_before`); the fire time keeps the event start's UTC offset and fractional seconds. The time must be in the future. A reminder moves `scheduled → delivered \| silenced \| cancelled`. Update and cancel work only while it is `scheduled`. |
| Delivery | Infra applies `notify.reminder.fire` at the reminder's time. Firing early returns `not_due`; firing a reminder that already fired returns `already_fired`; firing a cancelled one is a recorded no-op; retrying the same event ID returns Core's original receipt. The reminder and its feed item are written in the same commit. |
| Notification feed | Other Apps publish to `channel.push` with the receiver-owned contract `urn:pale:push-payload:1` (wire schema `urn:pale:push-message:1`, type `org.pale.notify.push.v1`). Messaging applies it as `notify.receive`. The sender must be an App account bound to the device owner. The feed item keeps the source object, CloudEvent ID, producer time (not invented when missing) and arrival time. |
| Quiet hours | The device has an IANA time zone, focus windows in local wall-clock time (a window whose end is not after its start runs past midnight) and an optional `silence_until`. Anything that arrives while the phone is quiet is stored as `silenced` instead of `delivered`. `notify.focus.get` tells the Agent whether the phone is quiet now and why. |

## Who can do what

| Caller | Operations |
| --- | --- |
| Agent (8 MCP tools) | `notify.reminder.create`, `.list`, `.get`, `.update`, `.cancel`; `notify.feed.list`, `notify.feed.mark_read`; `notify.focus.get`. The fixture `scenario` profile allows only the four reads. |
| Infra events (`env.apply_event`) | `notify.reminder.fire` (runner), `notify.receive` (Messaging), and the user's own device actions: `notify.focus.set`, `notify.device.silence`, `notify.feed.dismiss`. |

Core 1.2 gives a package's tools only to the Agent role, and the Web Host connects as the Agent, so there is no separate user role. User actions are therefore Infra events that a user harness applies; the Agent can read focus and silence but never change them.

## Finding due reminders

The App never schedules itself, and Core 1.2 exposes only its fixed Infra lifecycle operations. A runner reads `data.reminders` from `env.snapshot`, selects the due ones with `src/due.cjs` (`due(data, from, to)` returns scheduled reminders with `from ≤ fire_at < to` in time order), and applies `fireEvent(reminder)` for each at its own time. The event ID is `fire-<reminder_id>`; a reminder ID too long to fit the 100-character event ID gets `fireh-<prefix>-<hash of the full ID>` instead, a form no literal ID can produce. A retry is deduplicated. Whether a delivered `actionable` reminder starts a user session is the runner's decision; the feed item and the reminder's `fired_at` are the evidence.

## State and time

`fixtures/minimal.json` is Maya's device: Sleep focus 22:30–07:00 daily, Work focus 13:00–15:00 on weekdays, four reminders (one delivered from a Calendar anchor, one cancelled, two scheduled) and two feed items (one read reminder, one push that arrived silently overnight). `fixtures/clock.json` is 2026-11-18 09:00 Pacific. Tasks replace these through `env.load_seed`, binding every App that will push to the device owner.

All writes use the run's virtual time, `expected_version` and `request_id`. Every reminder, feed item and the device keep an append-only `history`. `validateSeed` runs after every load, tool call and event and rejects a fired reminder without its matching feed item, a feed item that points at the wrong reminder, an anchor whose fire time disagrees with its event start, a push from an unbound sender, or reversed timelines. Diagnostics carry record IDs and step names only, never reminder or notification text.

## Integration

- **Calendar** (optional, read-only): the Agent reads an event with `calendar.get` and passes its start to `notify.reminder.create`. Notify stores the reference and never writes Calendar. A moved event does not move an existing reminder (see limitations). `references()` lets Core check anchors against Calendar fixtures when both are assembled.
- **Messaging**: receive-only on `channel.push`. `examples/workflows/calendar-reminder/` publishes from a send-only travel fixture through the real router and checks delivery, deduplication, an unknown recipient and an unbound sender.
- No `required_apps`. The package runs on the shared runtime alone.

## GUI

`gui/src/app.js` is a business page for the public Web Host: upcoming, fired and cancelled reminders, a lock-screen view of the feed with the current quiet state, and create, edit, cancel and mark-read actions. Focus, silence and dismissal are shown but not editable because the Host connects as the Agent. Start it with `node runtime/web/server.cjs --app notify --registry registry.notify.json --profile sandbox`. `gui/src/view.js` is the escaped reviewer renderer.

## Limitations

- A reminder anchored to a Calendar event keeps the time computed when it was set. Following a moved event needs a Calendar change notification, which Calendar does not publish today.
- No recurring reminders, snooze, location triggers, sounds, badges, time-sensitive breakthrough or per-App notification permissions beyond sender binding.
- No real device push (APNs or FCM). Text only.
- `notify` is not added to `apps.registry.json`: `runtime/tests/clock.test.cjs` expects exactly seven Apps there. `registry.notify.json` assembles Notify with Calendar for the workflow and the Web Host.

## Package map

```text
app.json, package.json, LICENSE   Identity, commands, MIT license
tools.json                         8 Agent tools (generated by build/schemas.cjs)
build/schemas.cjs                  Single source for tools.json and the seed/event/push/wire schemas
plugin.cjs                         Standard hooks
src/operations.cjs                 Agent tools
src/events.cjs                     fire, receive, focus.set, device.silence, feed.dismiss
src/attention.cjs                  Focus windows and silence in the device time zone
src/model.cjs                      Seed and state invariants, Calendar references
src/due.cjs                        Runner helper: due reminders from a snapshot, stable fire events
schemas/                           Generated business schemas plus copied public contracts
contribution/                      Interfaces, events, receive contract, GUI, dataset, empty asset catalog
fixtures/                          Seed, binding, policies, clock
examples/                          Runnable example, scenario event, replaceable task data
tests/                             Business tests, App-only harness, schema validator
gui/                               Business page and reviewer renderer
```
