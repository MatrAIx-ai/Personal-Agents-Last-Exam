# Pegboard

Pegboard is a synthetic staff-scheduling App for PALE, seen from one hourly employee's account: the posted shifts of the whole team, and the employee's own availability, time off and requests to hand a shift over, trade it, release it or pick one up. A shift stays the employee's until a coworker has accepted it and the manager has approved, and every request has a cut-off. It follows the Environment proposal `proposals/environment/pegboard.md` (PR #173). All data is invented; there is no real employer, schedule or person.

Status: version 1.0.0, the first-version submission for PR #173, on public runtime 1.6.0. All four workflows of the approved plan, the eight events, the optional Mail notifications and the tests are in place. The evidence report is `docs/validation/pegboard-v1.0.0.md`; what remains is listed under "Remaining work".

## Run locally

Node.js 18 or later. No package installation, credentials, GPU or network.

```sh
cd apps/pegboard
npm test            # App-only business tests (node --test tests/business.test.cjs)
npm run example     # one declared event changing state, with the package fixture
```

Both run from a copy of this folder alone. Against the public reference runtime (1.6.0 or later), from the repository root:

```sh
npm run app:verify -- --app apps/pegboard --output .artifacts/pegboard.json
node apps/pegboard/tests/mcp.integration.cjs --runtime runtime     # every tool, the Core contracts and env.advance_time through real MCP
node apps/pegboard/tests/mail.integration.cjs --runtime runtime    # Pegboard -> Messaging -> real Mail
```

Both scripts take `--report FILE` to write their check names and versions as JSON.

The two scripts are given the runtime directory (`--runtime DIR`, or `PALE_RUNTIME_ROOT=DIR`); the first needs nothing else. The Mail flow also needs this package and the pinned Mail package inside that checkout, because the public Messaging router resolves a publisher package and its receiver registry relative to its own checkout. With `PALE_RUNTIME_ROOT` set, `npm test` runs both scripts as T18 and T16b; without it they are skipped and say so.

## What it does

| Workflow | Tools (`pegboard.` prefix) |
| --- | --- |
| W1 Schedule and hours (read-only) | `workplace.get`, `team.list`, `shifts.list`, `shifts.get`, `hours.summary`, `eligibility.check` |
| W2 Availability, time off and preferences | `availability.get`, `availability.update`, `time_off.list`, `time_off.request`, `time_off.cancel`, `preferences.get`, `preferences.update` |
| W3 Getting a shift covered, and answering coworkers | `handoffs.cover`, `handoffs.trade`, `handoffs.release`, `handoffs.respond`, `handoffs.cancel`, `handoffs.list`, `handoffs.get` |
| W4 Open shifts | `shifts.list` with `open`, `eligibility.check`, `handoffs.pickup`, `handoffs.cancel` |
| All | `notifications.list` |

Twelve tools read and ten write. Every write takes Core's `request_id` and `expected_version`. The target object is always the argument `id` (a shift, a handoff or a time-off entry; for a new handoff, the shift it is about) and a time window is always `start` / `end`. A new handoff or time-off entry is returned as `id`. The objects are called handoffs and time-off entries, so nothing is confused with Core's `request_id`.

Eight incoming events, applied by Infra with `env.apply_event`: `pegboard.schedule.published`, `pegboard.shift.changed`, `pegboard.shift.cancelled`, `pegboard.handoff.received`, `pegboard.handoff.answered`, `pegboard.handoff.decided`, `pegboard.handoff.withdrawn`, `pegboard.time_off.decided`. Managers and coworkers are not accounts: what they do arrives as these events.

### Time

Time is the environment's. Pegboard has no timers, no scheduler and no clock event. Infra moves `virtual_now` with an event or with Core's `env.advance_time`, which runs no App code.

- Every time-based state is stored as a due time and read against `ctx.virtual_now`: a shift's `phase` (`upcoming`, `started`, `ended`) from its start and end, a handoff's `expired` from its `cutoff_at`, a time-off entry's `expired` from its first day, a notification's `held` or `released` from its `release_at`. Nothing is rewritten when a due time passes.
- Writes use the same derivation. An expired handoff cannot be answered or cancelled (`invalid_state`), a shift that has started or whose cut-off has passed cannot be handed over (`too_late`), and an expired handoff no longer blocks a new one for the same shift.
- An event is handled at its own `at`: a handoff whose cut-off has passed by then takes no answer, decision or withdrawal (`invalid_event`), and a notification written then is held or released by the quiet hours at that time.
- The App never reads the wall clock. A shift counts in the week and on the day in which it starts, in the workplace's time zone.

### Rules worth knowing

- Responsibility does not move while anything is pending. A shift belongs to its assignee until a handoff that names it is `approved`. A cover or a trade goes `awaiting_coworker` (or `awaiting_me`, when a coworker asks) → `awaiting_manager` → `approved`; a release and a pickup go straight to `awaiting_manager`. Where `policy.manager_approval` is off, the acceptance of a cover or trade, and a pickup, are approved at once; a release always needs the manager.
- One eligibility check is used by `eligibility.check`, by every handoff I ask for and when I accept a coworker's request. A person may take a shift when they hold its position (`not_qualified`), it overlaps none of their assigned shifts (`overlap`), it leaves at least `min_rest_hours` between the last shift of one working day and the first shift of the next (`short_rest`; two shifts on one day need no rest between them) and it does not take their week past their cap (`over_hours`; the cap is the lower of the workplace's and their own, and a shift that adds no hours never fails this rule). In a trade each person is checked with the shift they give up left out.
- A handoff write checks, in this order: the shift is mine, the coworker's or open as the kind requires (`not_yours`, `not_theirs`, `not_open`); it has not started and its cut-off has not passed (`too_late`); it has no pending handoff (`already_requested`); then the four rules for whoever would take a shift. In a trade I ask for, the coworker is checked first and then me; when I accept a coworker's trade, I am checked first and then the coworker. The write returns the first refusal; `eligibility.check` lists every rule that fails, with the hours and rest gaps that would result.
- The cut-off of a handoff is `handoff_cutoff_hours` before the earliest shift it names. It is the last moment to ask, answer and decide; a handoff still pending then reads `expired`.
- Managers are not checked. A posted schedule, a change and a decision are applied as given, and my own shifts carry `flags` where the result breaks the policy or my own records: `overlap`, `short_rest` (on both shifts either side of the short rest), `over_hours` (on the shifts that take the week past the cap, counted in order of start), `outside_availability`, `during_time_off`. Flags are computed when read and never stored.
- Any manager's change to a shift that a pending handoff names makes that handoff `void`, whatever the change. Expired and closed handoffs are left as they are.
- Time off: the first day must be after today and at least `time_off_notice_days` after today (`too_late`); a request covers at most 30 days (`invalid_window`), no day on which I hold a shift (`shift_assigned`) and no day of another pending or approved entry (`conflict`). A pending entry reads `expired` when its first day begins. It can be cancelled while pending, or once approved before its first day.
- Notifications are written for what other people do, never for my own writes and never for a change that time alone causes: `schedule.published`, `shift.changed` (with `change`: `changed`, `assigned`, `unassigned` or `cancelled`), `open_shift.posted` (a shift for a position I hold that becomes open after its week was posted, while `open_shift_notices` is on; never for a shift I released myself), `handoff.received`, `handoff.updated` (an answer, a decision, a withdrawal or a voiding) and `time_off.decided`.
- A notification written in quiet hours (taken in the account's time zone) gets the end of that quiet period as its release time, unless it is about a shift that starts less than 12 hours after it is written. Any other notification is released as it is written.
- "Estimated pay" is scheduled hours times the position's hourly rate, and is labelled an estimate. A cancelled shift counts nowhere.
- App errors: `not_found`, `not_yours`, `not_theirs`, `not_open`, `too_late`, `not_qualified`, `overlap`, `short_rest`, `over_hours`, `already_requested`, `shift_assigned`, `conflict`, `invalid_window`, `invalid_state`, `invalid_timezone`. The App also answers `invalid_arguments` for what the input schema cannot express: an empty `patch`, quiet hours that start and end at the same time, availability blocks that overlap or end before they start, a handoff to myself, a cursor that is not a `next_cursor`. Events that would leave records inconsistent are rejected with `invalid_event`.

### Records for evaluators

- `data.activity`: one row for every committed Agent write, every applied event and every effect of an event (`shift.reassigned`, `handoff.voided`, `notification.created`), with sequence, virtual time, actor (`agent` or `event`), action, object ID and the `request_id` or `event_id` behind it. An event's own row comes first, then its effects.
- Each shift's `history` (the posting, every manager's change with each field as `{from, to}`, every handoff that moved it); each handoff's and time-off entry's `history` with the state after every step; each handoff's `cutoff_at`; each notification's `created_at` and `release_at`.
- A replay (the same `request_id` or `event_id` again) returns the stored receipt marked `duplicate` and writes nothing: no activity row and no audit row. Count it as a retry of the original.
- A rejected call writes no activity row; Core appends one denial audit row for each attempt.
- Time-driven changes (a handoff or time-off entry expired, a shift started or ended, a notification released) run no App code and write no row. Read them from the stored due times and the clock; Core's audit has one row for each `env.advance_time` with the clock before and after.

## Data and seeds

`fixtures/minimal.json` is a snapshot of a scripted synthetic history: one invented café with 2 locations, 3 positions and a policy of five values; 10 people (the account holder Noor, 8 coworkers and the manager); 4 posted weeks with 168 shifts (12 open, 3 cancelled, 16 the account holder's); 3 availability blocks; 5 time-off entries and 14 handoffs that between them cover every kind and state; 16 notifications. Its clock is Saturday 21 November 2026, 18:00 in Los Angeles (`fixtures/clock.json`). `dev/build-fixture.cjs` rebuilds it by replaying that history through the App's own functions; `dev/check-fixture.cjs` checks it independently. The tests build their small variations from this fixture in code.

A task supplies its own records in the same shape (`schemas/seed.schema.json`) through `env.load_seed`, with its own `virtual_now`. The seed is history: everything in it has already happened, and new facts arrive only through events. A seed stores no time-based state: a shift carries its start and end, a handoff its cut-off, a time-off entry its dates and a notification its release time, and all are read against the clock. Two consistency rules go beyond references and IDs:

- A shift's `history` must lead to the shift as it is: each row follows from the rows before it, and the last value a row gives for a field is the stored one. A shift may have an empty history.
- A pending handoff must fit the shifts it names (still held as it states, one pending handoff per shift), and an approved one must have a history row on each shift it moved. An approved cover whose shift is still the requester's is therefore refused unless a later change gave it back.

The App's rules answer `invalid_seed`. A shape the seed schema refuses (a timestamp without its UTC offset, a stored `expired`, `phase` or `released`) does not reach them on the host: Core checks `env.load_seed` against the schema first and answers `invalid_arguments`. Either way nothing is loaded. In the same way, an event that does not match `schemas/events.schema.json` is refused by Core with `invalid_arguments`, and an event the App's rules refuse with `invalid_event`.

New IDs are `ho-NNNN`, `to-NNNN` and `ntf-NNNN`: one more than the largest number in use, and never an ID that another record has.

`tools.json` and the App-owned schemas are generated from `dev/contracts.cjs` (`node dev/build.cjs`, `--check` for drift). `dev/walk.cjs` is a seeded random walk over every write, every event and the clock: it fails if the App ever accepts something that leaves its own records inconsistent, if a read changes data, or if a call fails with anything but a declared error (`node dev/walk.cjs [first seed] [last seed] [steps]`; one walk runs with `npm test`). Nothing under `dev/` runs at run time.

## Package boundary

The package runs on its own. It imports only Node built-ins and its own files, reads no file outside its folder and uses no other App's files or state; a test checks this. `service.cjs` is the provided launcher, which finds the pinned runtime. `tests/schema-validator.cjs` is a copy of the public runtime's schema validator, so the App-only tests check every argument, result and state against the contracts without the runtime. The two real-MCP scripts are given the runtime's location.

## Other Apps

No App is required. Mail is optional and send-only. When `preferences.email_notices` is on at the moment a notification is written, the notification also carries the full wire message for Mail's existing receive declaration (Mail 1.3.0: `channel.email`, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), dated at the notification's release time. `schemas/router-message.schema.json` is a copy of Mail's wire schema; Messaging compares the two by content. Pegboard builds no inbox, never writes to another App and does not read or write Calendar: an agent that wants a shift in Calendar adds it with Calendar's own tools.

Delivery is Infra's. `infra/sender.cjs` is an outbound adapter in the pattern of Mail's `src/publisher.cjs`: Infra runs it with its own connections and supplies both clients.

```js
const { publishReleased } = require('./infra/sender.cjs');
// source: an Infra MCP client of this Pegboard instance; router: a publisher client of Messaging
const { stage, results, sent } = await publishReleased({ source, router, sent: previousLog });
```

- It reads notifications through `env.snapshot`, treats one as released once the snapshot's `virtual_now` has reached its `release_at`, and calls `router.publish` with the stored wire message, in order of release time. A notification held at 23:10 is published by the first run after Infra has moved the clock to 07:00 or later, with no App event.
- Messaging decides from the run's bindings and grants whether the message reaches Mail. `infra/router.config.example.json` shows an Infra config that names this package as the publisher and grants the bound Mail account for `channel.email`; its paths are relative to the public checkout, as the router requires. Without a grant the delivery is rejected and Mail gets no record.
- Notifications that came with the seed are history, unless they were still held when the seed was loaded.
- The sender never writes into Pegboard. `sent` is the caller's log; pass it back on the next run. A rejected or unknown delivery does not roll anything back; Messaging stops the run on an unknown acknowledgement.
- Messaging deduplicates in one router session. After `env.reset` of Pegboard, start Messaging with a new run, because notification IDs start again.

`tests/mail.integration.cjs` checks this with the real Mail package: the committed receipt, the message the Mail Agent reads, a held notification that is published only after `env.advance_time` has passed its release time, an identical retry, changed content, a forged source, a message of another type, a missing grant, a person with no Mail account bound in the run, email notices switched off, that Pegboard's state is identical before and after dispatch, and that resetting Pegboard leaves what Mail received. The pinned Mail package ships its own example account, so the script first has Infra load the account holder's empty mailbox into the run's Mail instance with the run's shared binding (`fixtures/binding.json`), as a task would.

## Workflow-to-test mapping

| Workflow | App-only tests (`tests/business.test.cjs`) | Real MCP |
| --- | --- | --- |
| W1 Schedule and hours | T01, T02, T03, T04, T05 | `mcp.integration.cjs`: all W1 tools; reads leave data and version unchanged; the audit row of a read |
| W2 Availability, time off and preferences | T06, T07 | `mcp.integration.cjs`: the W2 writes; a pending entry expired by `env.advance_time` |
| W3 Getting a shift covered | T08, T09, T10, T11, T12, T14 | `mcp.integration.cjs`: cover, answer and decision events, policy narrowing by tool, object and field |
| W4 Open shifts | T13, T14 | `mcp.integration.cjs`: release, then pickup and approval |
| All: events and notifications | T15, T16 | `mcp.integration.cjs`: event receipt and replay; `mail.integration.cjs` (T16b) |
| All: the platform clock | T17, T17b | `mcp.integration.cjs`: `env.advance_time` with no App event |
| All: Core contracts | T18 runs `mcp.integration.cjs` | replays, stale versions, authority, failure atomicity |
| All: seeds, reset, activity log | T19 | `mcp.integration.cjs`: task seed with `virtual_now`, reset to the loaded seed and time |
| All: consistency in any reachable state | the random-walk test (`dev/walk.cjs`), the contract and package-boundary tests | |

## Remaining work

- Independent reproduction and acceptance by a maintainer.
- Human review of realism (the schedule, the policy values, notification wording) and of the invented workplace and names.
- No agent trials are included.
- MCP only, as planned: no GUI, no manager's console and no Web/CUA adapter.
- Mail is the only connected App. Delivery uses the public Messaging router with a local Infra config; production Messaging credentials are a platform matter.
