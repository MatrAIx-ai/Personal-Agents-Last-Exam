# Notify v1 validation

First runnable version for the approved plan in [#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191) (plan approval recorded at commit `466d0f2`; the proposal file is unchanged since review at `97b957f`).

## Versions and commands

Notify 1.0.0, public runtime 1.6.0, Core API 1.2.0, Calendar 1.3.0 (reference App, read-only). Run locally on macOS with Node v26.7.0 after merging `main` on 2026-11-27. CI runs Node 18 and 22. From the repository root:

| Command | Result |
| --- | --- |
| `node --test apps/notify/tests/business.test.cjs` | 22/22 tests pass |
| `node apps/notify/examples/run.cjs` | Two due reminders fired in order: 17:30 delivered, 23:00 silenced by Sleep focus |
| `node runtime/cli.cjs verify --app apps/notify --output .artifacts/notify.json` | `passed: true`, 38 checks, business and event-example stages passed |
| `npm run example:calendar-reminder` | `passed: true`, 23 checks over real MCP and Messaging |
| `node apps/notify/build/schemas.cjs --check`, `node runtime/sdk/sync.cjs --check`, `node runtime/build-contracts.cjs --check` | No drift |
| `npm test` | 22/22 stages pass (Notify does not change any existing App or the runtime) |
| `npm run test:web` | 4/4 pass |

The Web Host page was exercised by hand (`node runtime/web/server.cjs --app notify --registry registry.notify.json`): create, edit, cancel, the lock-screen feed with Mark read, a silenced reminder, a rejected past time and a reload. Screenshots, in order, with the reference products, are in [`evidence/README.md`](../evidence/README.md).

## Approved deliverables → evidence

| Planned deliverable | Evidence |
| --- | --- |
| `apps/notify/` package: 8 Agent tools, reminder state machine, focus and silence at `ctx.virtual_now`, feed store, fire and push handlers, GUI | `tools.json`, `src/`, `gui/`; verifier report |
| Business tests for every transition and error: create, update, cancel; fire when due, early, twice, after cancel; silenced inside focus or silence; push received, read, dismissed | `tests/business.test.cjs` (22 tests, including overnight focus windows, a daylight-saving change, Calendar-anchor arithmetic with fractional seconds, fire-event IDs for the longest reminder IDs and for a literal ID shaped like a shortened one, an Edit form that leaves the fire time out, the page showing times in the device time zone, seed invariants, the seed's planned counts, diagnostics and renderer escaping) |
| Example seed: one owner, a weekday focus schedule, reminders tied to Calendar events, past feed items | `fixtures/minimal.json`: Sleep and Work focus; 5 reminders (one Calendar-anchored and delivered, one silenced inside Work focus, one cancelled, two scheduled); 6 past feed items from 3 sources (the two fired reminders, `order-notifier` and `bank-alerts`, both bound to the owner). A business test checks these counts; reset restores the seed exactly (verifier). |
| Push receive contract `urn:pale:push-payload:1` in `messaging.receives`, plus a publish-only test sender | `schemas/push-payload.schema.json`, `schemas/router-message.schema.json`, `contribution/contribution.json`; sender in `examples/workflows/calendar-reminder/publisher/` |
| Calendar workflow example: create an event, a reminder 15 minutes before, advance time, fire, read the feed; repeat inside focus to see `silenced` | `examples/workflows/calendar-reminder/run.cjs` |
| Real MCP connections to Calendar and Messaging; receiver-side evidence for push; a rejected push for an unbound recipient; no Calendar state changed | Same workflow: router receipt and the stored feed item; `recipient_unavailable` for an unknown account; `receiver_rejected` / `permission_denied` for an unbound sender with the feed unchanged; Calendar snapshot equality |
| Permissions: the Agent cannot fire reminders or change focus | Workflow checks 1–3; verifier checks that every `env.*` operation is denied to the Agent |

## Interfaces adjusted to runtime 1.6.0

Scope and workflows are as approved. Two interface details in the plan could not run on the pinned runtime; both were raised in the automated review on #191 before approval, and v1 uses the supported paths:

1. **User-side operations are Infra events, not tools.** Core 1.2 gives package tools only to the Agent role, and the Web Host connects as the Agent. So `focus.set`, `silence_until` and `feed.dismiss` are the events `notify.focus.set`, `notify.device.silence` and `notify.feed.dismiss`, applied by a user harness through `env.apply_event`. The Agent can read them with `notify.focus.get` but cannot change them.
2. **No `notify.reminder.due` management query.** The Infra connection exposes only Core's fixed lifecycle operations. A runner reads `data.reminders` from `env.snapshot` and uses the package helper `src/due.cjs` to select due reminders and build stable `notify.reminder.fire` events.
## Implementation notes

- **Calendar anchor.** As planned, the Agent resolves the event with `calendar.get`; `notify.reminder.create` takes its reference (`calendar_account_id`, `calendar_event_id`), its start (`event_start`) and `minutes_before` as flat optional fields, and the stored record keeps them as one `anchor`. A Calendar-anchored reminder keeps its original time when the event moves (open question 1 in the proposal).
- **Registry.** `registry.notify.json` assembles Notify with Calendar for the workflow and the Web Host. `apps.registry.json` is unchanged because `runtime/tests/clock.test.cjs` expects exactly seven Apps there; adding Notify to it is a maintainer decision.

## Delivery evidence (docs/submission-evidence.md)

`docs/submission-evidence.md` was added to `main` after this plan was approved. Where #191 stands on each section:

1. **GUI.** [`evidence/README.md`](../evidence/README.md): the reference products from the proposal with what each illustrates, the implementation run (commit, browser, viewport, time zones, synthetic account), and a 12-step ordered demonstration with screenshots, including an edit that keeps the time, a cancel confirmation, a rejected input and a reload.
2. **Declared dependencies.** `npm run example:calendar-reminder` runs Calendar 1.3.0 (read-only) and Messaging over real MCP: the reminder's time comes from the Calendar event that `calendar.get` returns; the push lands as a feed item with its router receipt; an unknown account gets `recipient_unavailable`; an unbound sender gets `permission_denied` with the feed unchanged; and the Calendar snapshot is unchanged at the end. Its output lists each check (23, `passed: true`).
3. **Environment data coverage (2025-01-01 to 2026-12-31).** Not met. The approved plan's data is a small example seed (row "Synthetic data and assets": 5 reminders and 6 feed items), now dated 2026-11-12 to 2026-11-18, all synthetic. Notify holds one device's state for a Task, and each Task loads its own reminders and feed through `env.load_seed`. I'd like to agree with the reviewer whether this approved scope stands for v1, or whether to add a synthetic two-year history (reminders and pushes across 2025–2026, with a monthly count by source) as agreed extra delivery work.
4. **Task history depth.** Not applicable to an Environment.

## Not covered yet

- The runner hook that starts a user session when an actionable reminder is delivered belongs to the planned runner, not this App. The workflow shows the data it would use.
- The pinned Playwright browser test (`npm run test:web:browser`) runs only the Apps in `apps.registry.json`, so it does not cover this page.
- Human review of fixture realism.
