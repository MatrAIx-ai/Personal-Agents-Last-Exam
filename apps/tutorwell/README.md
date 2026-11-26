# Tutorwell tutoring and writing centre

Self-contained PALE App package, version 1.0.0, Core API 1.2.0, for the approved proposal [`proposals/environment/tutoring-center.md`](../../proposals/environment/tutoring-center.md) (PR #161, plan approved at `af78883`). Tutorwell is a resettable university tutoring and writing centre for one student: the centre's services, tutors, open slots and rules, and the student's appointments with their intakes, session reports and follow-ups, so tasks can check from App state whether an agent books the right help within the centre's rules and acts on the tutor's advice. It judges no tutoring quality. All people, courses, tutors and records are synthetic. WCONLINE and university tutoring and writing centres are workflow references only; no affiliation is claimed.

## Run locally

Node.js 18 or newer. No package install, account, model API or remote service is needed. From the repository root:

```sh
node --test apps/tutorwell/tests/business.test.cjs   # App-only business tests, including E1-E7
node apps/tutorwell/examples/run.cjs                  # walkthrough: book, slot released, attend, report, follow-up, check
node --test apps/tutorwell/tests/runtime.test.cjs     # real public runtime: MCP, versions, receipts, clock, reset
npm run app:verify -- --app apps/tutorwell --output .artifacts/tutorwell.json
node apps/tutorwell/scripts/build-contracts.cjs --check   # tools.json and the seed/event schemas match their definitions
node apps/tutorwell/scripts/build-fixtures.cjs --check    # the two full fixtures match their hand-written sources
node apps/tutorwell/scripts/build-scenarios.cjs --check   # the scenario bundles match their scenario.json and fixtures
node apps/tutorwell/examples/scenarios/play.cjs s2-cannot-make-it base reference   # one reference scenario over MCP
```

Inside this folder alone, `npm test` and `npm run example` work without the runtime.

## Workflows, tools and events

| Workflow | Agent tools (prefix `tutorwell.`) | Infra events (`env.apply_event`) |
| --- | --- | --- |
| 1. What help is available | `services.list`, `tutors.list`, `slots.list`, `appointments.list`, `reports.list`, `profile.get` | `slot.released`, `slot.withdrawn`, `rules.changed` |
| 2. Book with an intake | `appointments.book`, `appointments.update_intake` | — |
| 3. Keep the appointment or cancel | `appointments.list` (cutoff), `appointments.cancel` | `appointment.attended` |
| 4. Follow up after the session | `reports.list`, `followups.set_status` | `report.posted` |

Six tools read and four write. Tool results do not carry Core's clock, so every read returns the current virtual time as `as_of`, and every time in a result is written in the student's time zone with its UTC offset (`2027-03-08T09:00:00-05:00`); `profile.get` names the zone (IANA). `appointments.list` gives each booked appointment its `cancellation_cutoff`, and a refusal that depends on time states the current time. No agent tool moves the clock.

Writes need `request_id` and `expected_version`; Core returns the first result for a repeated request, `idempotency_conflict` for a reused ID with a different request and `stale_version` for an old version. Business refusals: `not_found` (the message lists the valid IDs with what they are, such as the booked appointments with their start and tutor or the open follow-ups with their kind and items, and names the read tool that lists them; a skill ID given as a service, or the reverse, is named as what it is), `unknown_reference` (an unknown skill in an intake), `slot_unavailable` (booked, withdrawn or started), `suspended`, `weekly_cap`, `not_tutorable` (take-home exam work), `draft_required` (writing centre without a draft reference), `session_started`, `invalid_state` and `invalid_arguments`. `tools.json` and `schemas/events.schema.json` give the exact inputs, outputs and payloads. Both policy profiles, `scenario` (the runtime's default) and `sandbox`, offer all ten tools.

## Centre rules (`centre-rules/1`)

Settings: `weekly_cap`, `cancel_cutoff_hours`, `no_show_limit`, `no_show_window_days`, `suspension_days`. The code is `src/rules.cjs`; it is computed from the record when read, so reads change nothing.

- Durations are exact (a day is 24 hours). Weeks run Monday to Sunday, and weeks, dates and weekdays are those of the student's time zone. An appointment counts toward the week of its start unless it is cancelled (`cancelled`, `late_cancel` or `cancelled_by_centre`).
- At most `weekly_cap` appointments per week across services; no booking while suspended; a slot must be open and in the future; the writing centre requires a draft reference; `take_home_exam` work is not tutored.
- The cancellation cutoff is `cancel_cutoff_hours` before the start. A cancellation at or before the cutoff is `cancelled`, one after it `late_cancel`; from the start on, cancelling and editing the intake are refused with `session_started`.
- No outcome is inferred from the clock. After its start a booked appointment is `awaiting_outcome`: it counts toward its week, is not a no-show and cannot receive a report. Only `tutorwell.appointment.attended` sets `completed` or `no_show`; it is accepted once, however late, and the outcome is final.
- Each appointment adds at most one to the no-show count: a `no_show`, dated at its session start, or a `late_cancel`, dated at the cancellation. When one is recorded and at least `no_show_limit` recorded by then are dated within the last `no_show_window_days` (inclusive), the student is suspended for `suspension_days` from that moment, never earlier. A suspension refuses new bookings only.
- Results are judged by the settings in force when they are recorded: a later `tutorwell.rules.changed` changes no earlier result, while the cutoff a read shows follows the settings in force now.

The proposal's expected states E1–E7 are business tests in `tests/expected-states.cjs`, each from `fixtures/minimal.json` (Mon 2027-03-08 09:00, `America/New_York`, whose clocks move forward on Sun 03-14). For example, E3's late cancellation at Tue 08:00 suspends Jun until Tue 03-23 09:00 (−04:00), and E7's no-show recorded on Thu 03-11 10:00 suspends Jun until Thu 03-25 11:00 (−04:00). `tests/rules.cjs` checks the boundaries: a cancellation exactly at the cutoff and one second after, the window's edge across the clock change, an outcome recorded seven weeks late, settings changes, the end of a suspension, and the Sunday–Monday week boundary.

## Events, with a complete example of each

Each file in `examples/events/` is one complete event; `tests/events.cjs` applies every one and each ID rule. A missing reference is `unknown_reference`, a reused ID `duplicate_id`, a bad value `invalid_value`, and a slot or appointment in the wrong state `invalid_state`; a refused event changes neither data nor the clock.

| Event | Payload and rules | Example (`examples/events/`) and effect |
| --- | --- | --- |
| `tutorwell.slot.released` | `{slot_id, tutor_id, start, minutes, mode}`: a new slot ID, a known tutor, a start after the event, a mode the tutor offers, no overlap with that tutor's slots. | `slot-released.json`: `{"event_id":"ev-1","at":"2027-03-08T12:00:00-05:00","operation":"tutorwell.slot.released","payload":{"slot_id":"s5","tutor_id":"t-ana","start":"2027-03-12T15:00:00-05:00","minutes":50,"mode":"online"}}`. Slot `s5` (Fri 15:00, online) is listed by `slots.list`. This is also `examples/scenario.json`, which the public verifier applies. |
| `tutorwell.slot.withdrawn` | `{slot_id}`: an existing slot that is not withdrawn and has not started. | `slot-withdrawn.json`: `{"event_id":"ev-2","at":"2027-03-08T13:00:00-05:00","operation":"tutorwell.slot.withdrawn","payload":{"slot_id":"s2"}}`. `s2` is no longer listed; an appointment booked on it becomes `cancelled_by_centre` and does not count against the student. |
| `tutorwell.appointment.attended` | `{appointment_id, outcome}` with outcome `completed` or `no_show`: a booked appointment whose session has started and has no outcome yet. | `appointment-attended.json`: `{"event_id":"ev-4","at":"2027-03-10T15:00:00-05:00","operation":"tutorwell.appointment.attended","payload":{"appointment_id":"apt-1","outcome":"completed"}}`. With `s3` booked as `apt-1` (Wed 14:00), it becomes `completed`. A `no_show` is dated at the session start and can start a suspension (E7). |
| `tutorwell.report.posted` | `{appointment_id, covered_skill_ids, followups, next_focus?}`, each follow-up `{followup_id, kind, item_refs, minutes, due_at?}`: a completed appointment without a report, known skills, new follow-up IDs, due dates after the report. | `report-posted.json` (the proposal's example): `{"event_id":"ev-5","at":"2027-03-10T15:30:00-05:00","operation":"tutorwell.report.posted","payload":{"appointment_id":"apt-1","covered_skill_ids":["wr-thesis"],"followups":[{"followup_id":"fu-1","kind":"revise","item_refs":["hist-essay-2"],"minutes":30,"due_at":"2027-03-11T17:00:00-05:00"}],"next_focus":"wr-evidence"}}`. Report `rep-1` with follow-up `fu-1`, `open` (E5). |
| `tutorwell.rules.changed` | `{setting, value}`: one of the five settings, within its range (`weekly_cap` 1–20, `cancel_cutoff_hours` 0–168, `no_show_limit` 1–20, `no_show_window_days` 1–365, `suspension_days` 1–365), different from the current value, and not dated at the very time of a recorded cancellation or attendance (which it would re-judge; date it later). | `rules-changed.json`: `{"event_id":"ev-3","at":"2027-03-08T14:00:00-05:00","operation":"tutorwell.rules.changed","payload":{"setting":"cancel_cutoff_hours","value":24}}`. From 14:00 the cutoff is 24 hours; earlier cancellations keep their result. |

Tutorwell neither publishes nor receives messages.

## How graders use the integrity checker

`src/checker.cjs` exports `checkAppointments(snapshot)`, a pure function for Task graders (not an agent tool) that takes `env.snapshot`'s `snapshot`. It returns, with times in the student's zone: each intake as written by `appointments.book` or `appointments.update_intake`, with the consents in force at that moment and `shared_without_consent` (the accommodations shared although the student had not consented, E6); every cancellation with the cutoff it was judged against and who made it (an agent write, the seeded record or the centre); the no-shows with their dates and recording times; every suspension with its cause and the incidents it counted; and each follow-up with its status, when and by whom it was marked done, and every agent write that changed it. Tutorwell does not stop an intake that shares accommodations without consent, misstates the type of work or aims at the wrong skill; the task's grader decides from these records.

## Data and IDs

- **Seed.** Centre data (settings history, services, skills, tutors, slots), the student's record (accommodations with consents, appointments with intakes, reports, follow-ups) and the evaluator-only activity log. A task loads its own seed, including past appointments and no-shows, with its starting time (`virtual_now`); `validateSeed` checks unique IDs, valid references, slots that do not overlap for a tutor, outcomes only for started sessions, reports only for completed ones, cancellations consistent with the cutoff then in force, and past records not after the run's virtual time, while slot starts and due dates may be later (`tests/seeds-validation.cjs`).
- **Full fixtures.** `fixtures/students/` holds two load bundles, Maya Ortiz and Daniel Kim, the same invented students as Milepost's full fixtures with the same person IDs and loading time (Mon 2027-03-01 09:00, New York). Each has a term of 12 appointments (completed sessions with their reports and follow-ups, cancellations in time and late, a no-show and a slot the centre withdrew), accommodations with different consents, and one centre: six tutors across both services, 46 skills and 40 open slots in two weeks. `scripts/build-fixtures.cjs` builds them from `fixtures/centre.json` and `fixtures/profiles/` and refuses a history the centre's rules would not have produced; see [`fixtures/students/README.md`](fixtures/students/README.md).
- **IDs.** New appointments continue the account's sequence (`apt-1`, `apt-2`, ... in the minimal fixture; `apt-13` first in the full fixtures); reports `rep-N`; settings entries `set-N`. Slot and follow-up IDs come from the centre's events; in the full fixtures a slot ID is the tutor, the local date and the start (`ana-0304-0800`). The minimal fixture's skill IDs are Tutorwell's own; the full fixtures use Milepost's 40 math skill IDs and titles, so a task can load both Apps for the same student. A binding maps the student and the tutors to person IDs.
- **Evaluator-only records.** The activity log is returned only by `env.snapshot`, never by a tool result, error or page; tests plant marker values to check this.

## Reference scenarios and agent trials

[`examples/scenarios/`](examples/scenarios/README.md) holds four reference scenarios on the full fixtures that cover the four workflows, each with a twin that changes one part of the student's record: s1 "book me a math session this week" (the weakest skill in the latest report decides the tutor and the problems to bring), s2 "I can't make it tomorrow, cancel it" (a late cancellation would suspend him; in the twin it would not), s3 "update my follow-ups" (a reading is done, a revision is not; in the twin both are readings) and s4 "book me timed practice" (sharing accommodations without consent; in the twin she consents). Their setups use all five event types. `grade.cjs` grades a snapshot from state alone; `tests/scenarios.cjs` and `tests/runtime.test.cjs` check that each reference and valid alternative passes, each control fails exactly the checks it names, neither member's reference passes the other, and a scripted baseline that uses only the Agent tools solves all eight members.

[`trials/`](trials/README.md) records two rounds of 12 runs with a local 7B model (`qwen2.5:7b-instruct`): 3 of 12 passed in each, only on s2 and by not finding the appointment. The first round's invented IDs and skill IDs given as services led to the richer `not_found` messages and ID descriptions above; in the second round the model relayed the listed IDs but asked the student instead of retrying. The traces are kept, and `trials/replay.cjs` reproduces every recorded grade from them.

## Files

`app.json`, `plugin.cjs` and `service.cjs` are the package entry points; `src/` holds the business code (`rules.cjs` for `centre-rules/1`, `checker.cjs` for graders); `scripts/build-contracts.cjs` generates `tools.json` and the seed and event schemas; `fixtures/` holds the example seed of the proposal, its clock, binding and the two policy profiles, plus the centre (`centre.json`), the student profiles and the two full fixtures built from them (`scripts/build-fixtures.cjs`); `examples/` holds one complete example of each event, the walkthrough and the reference scenarios (`scripts/build-scenarios.cjs` builds their bundles); `trials/` holds the trial harness, the traces and the replay check; `docs/` holds the guide for Task authors (`task-authoring.md`) and the reproduction steps for an independent reviewer (`reproduce.md`); `gui/src/view.js` is the read-only reviewer renderer (four views: services and rules, open slots, appointments with intakes, reports and follow-ups); `contribution/` holds the contribution declaration, dataset record and GUI declaration.

## Remaining work before final validation

Planned in the proposal and still open: my own check of every fixture and scenario record (the full fixtures are built from hand-written sources and pass the automated checks, which do not replace that check), and an independent reproduction of one scenario from a clean checkout, following [`docs/reproduce.md`](docs/reproduce.md).

## Limitations

`centre-rules/1` is Tutorwell's own test rule, modelled on common centre policies, not any centre's policy. One student account per instance; no payment, tutor marketplaces, waitlists, video sessions, tutoring dialogue, tutor-side interface, real student records or live sync with any product.

License: MIT (see `LICENSE`).
