# VisaSlot App

A synthetic Schengen consulate appointment scheduler for PALE tasks: find the competent consulate from the trip's nights per country, search slots whose availability changes over time, book, reschedule or cancel an appointment, read the document checklist, register the visa file before the appointment, and have the appointment checked against six rules when it is held. Package version 1.0.0, Core API 1.2.0, runtime 1.6.0, synthetic data. Environment proposal: [#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192) (Trip paperwork portals; VisaSlot is one of three packages with ConfDesk and Passage). Task [#49](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/49) reads its appointments.

## Run locally

Requires Node.js 18 or newer. From the repository root:

```sh
node --test apps/visaslot/tests/business.test.cjs
node apps/visaslot/examples/run.cjs
node apps/visaslot/build/schemas.cjs --check
node runtime/cli.cjs verify --app apps/visaslot --output .artifacts/visaslot.json
```

With only this folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` inside it; the one test that drives real Core (Agent/Infra permissions, request and event replay, reset) is skipped when the public runtime is not beside the package. `node build/schemas.cjs` regenerates `tools.json` and the seed and event schemas from one source; `--check` fails on drift.

## Workflows

| Workflow | How it works |
| --- | --- |
| Competence | `visaslot.competence(trip)` takes the trip's stays `{country, check_in, check_out}`. Nights are counted per country (check-in up to the day before check-out; stays may not share a night). The main destination is the country with the most nights (`rule: most_nights`); on a tie, the tied country entered first, i.e. with the earliest first night (`rule: tie_first_entry`). It returns the counts and the seeded consulates of that country. |
| Slots | `visaslot.slots(consulate_id, from, to)` lists open slots whose local date at the consulate is in `from`..`to` (inclusive), earliest first, each with its `version`. A slot that has started is no longer listed: availability changes on the clock, and through Infra events (`slot.released`, `slot.taken`, `appointment.cancelled_by_consulate`). |
| Book | `visaslot.book(consulate_id, slot_at, slot_version)`. The slot must exist (`not_found`), not have started and still be open (`slot_unavailable`: e.g. taken by another applicant between search and book), and have the version read (`stale_version`: e.g. taken and released again since). The appointment ID follows the slot's local date (`appt-0331`; a repeat date adds `-2`). Booking is free. |
| Reschedule | `visaslot.reschedule(appointment_id, appointment_version, slot_at, slot_version)` moves a booked appointment to another open slot at the same consulate before the current slot starts. A stale appointment or slot version fails with `stale_version`. The old slot reopens with a new version; the registered file stays on the appointment. |
| Cancel | `visaslot.cancel(appointment_id, appointment_version)` before the slot starts; the slot reopens. |
| Appointments | `visaslot.appointments()` (optional `id`) lists appointments in slot order with status (`booked`, `cancelled`, `held`), version, `history` (every booking, reschedule, cancellation and hold with the slot held after it), cancellation, check result and the file version. |
| Checklist | `visaslot.checklist(category)` (`business`, `tourism` in the fixture; seed data) lists required documents; each item names the rules VisaSlot applies to it, or none when the consulate checks it in person. |
| Visa file | `visaslot.file.submit(appointment_id, documents)` registers the file on a booked appointment, replacing any earlier one (kept in `file_history` with `replaced_at`), until the appointment starts. After the slot start, after the hold or on a cancelled appointment it fails with `invalid_state`. Documents: `invitation_letter {source, name_on_letter, issued_on}`, `travel_signature {source, signed_on, valid_until}`, `accommodation [{country, check_in, check_out, source}]`, `travel {enter_on, leave_on, source?}`; `source` is `{app_id, object_type, object_id}` of the record the agent read. A letter or signature dated after today at the consulate fails with `document_dated_after_submission`; inconsistent dates (a signature lapsing on or before its signing day, a return not after entry, stays sharing a night, a stay that starts before `enter_on` or ends after `leave_on`) fail with `invalid_arguments`. The result lists the items that would be missing if the appointment were held now. A file does not change the appointment version. |
| File read | `visaslot.file.get(appointment_id)` returns the file, its earlier versions, `missing_if_held_now` (while booked) and the check (once held). |
| Appointment check | Infra applies `visaslot.appointment.held` at the appointment time; see Rules. |

Error codes: `not_found`, `invalid_arguments`, `invalid_state`, `slot_unavailable`, `stale_version` (slot or appointment version), `document_dated_after_submission`, `not_due`, `already_exists`, `invalid_event`. Core adds `stale_version` for `expected_version`, `permission_denied`, `idempotency_conflict` and `invalid_arguments` for schema failures.

## Rules

The appointment check applies these rules, in this order, to the registered facts; VisaSlot does not read ConfDesk, Passage, a hotel or an airline. The passport name is seed data (`passport_name`), not supplied by the agent.

| Rule | Passes when | Missing entry when it fails |
| --- | --- | --- |
| `file_submitted` | A file is registered. Without one, the other rules are not evaluated. | `{"item":"visa_file","rule":"file_submitted","expected":"submitted","found":null}` |
| `consulate_competent` | The appointment's consulate is in the main destination computed from the file's accommodation (most nights; tie: first entry). | `{"item":"appointment","rule":"consulate_competent","expected":"DE","found":"FR"}` |
| `name_matches_passport` | The letter's name has the same letter tokens as the passport name, ignoring case, accents, order and punctuation (`Mingyu Zhao` matches `ZHAO Mingyu`; `ZHOU Mingyu` does not). | `{"item":"invitation_letter","rule":"name_matches_passport","expected":"ZHAO Mingyu","found":"ZHOU Mingyu"}` |
| `letter_issued_by_appointment` | `issued_on` is on or before the appointment's local date at the consulate. | `{"item":"invitation_letter","rule":"letter_issued_by_appointment","expected":"2027-03-31","found":"2027-04-01"}` |
| `signature_valid_through_return` | `travel.leave_on` is before `valid_until`. `valid_until` is the lapse date and exclusive, as in Passage: the signature is valid before it and lapsed from that day (a signature with `valid_until` 2027-03-09 is lapsed on 2027-03-09). | `{"item":"travel_signature","rule":"signature_valid_through_return","expected":"2027-04-30","found":"2027-04-30"}` (expected = return date, found = `valid_until`) |
| `covers_every_night` | Every night from `enter_on` to the day before `leave_on` falls in an accommodation stay. | `{"item":"accommodation","rule":"covers_every_night","nights":["2027-04-27"]}` |

The result is `complete` with `"missing": []`, or `refused` with one entry per failed rule. It is stored on the appointment as `check {appointment_id, held_at, result, missing}`, the file is locked (`locked_at`), the status becomes `held` and a `held` history entry is added. Every applied event is also listed in `checks` with its event ID, consulate, slot and result.

## Who can do what

| Caller | Operations |
| --- | --- |
| Agent (9 MCP tools) | Reads: `visaslot.competence`, `visaslot.slots`, `visaslot.appointments`, `visaslot.checklist`, `visaslot.file.get`. Writes: `visaslot.book`, `visaslot.reschedule`, `visaslot.cancel`, `visaslot.file.submit`. The fixture `scenario` profile allows only the five reads; `sandbox` allows all nine. |
| Infra events (`env.apply_event`) | `visaslot.slot.released`, `visaslot.slot.taken`, `visaslot.appointment.cancelled_by_consulate`, `visaslot.appointment.held`. |

The Agent cannot apply events, load seeds, reset or advance time (`permission_denied`, tested against real Core). Every write takes `expected_version` and `request_id`: Core rejects a stale version and returns the original result with `duplicate: true` for a repeated request ID. The App never schedules itself. VisaSlot sends no mail in v1.

## Events

Each event is `{event_id, at, operation, payload}`; `at` carries a UTC offset and is the handler's `virtual_now`. Slots are named by consulate and start time; times are compared as instants.

`visaslot.slot.released`: a future slot becomes open: a new slot (written with the consulate's local offset), or a `taken` or `closed` slot reopening with a new version. An open or booked slot, or a past one, is `invalid_event`.

```json
{"event_id":"release-de-chi-20270408-0900","at":"2027-02-11T08:00:00-06:00","operation":"visaslot.slot.released","payload":{"consulate_id":"de-chicago","slot_at":"2027-04-08T09:00:00-05:00"}}
```

`visaslot.slot.taken`: another applicant takes an open future slot; its version increases. An unknown slot is `not_found`; a slot that is not open (including the applicant's own) is `invalid_event`.

```json
{"event_id":"taken-de-chi-20270331-0900","at":"2027-02-10T12:00:00-06:00","operation":"visaslot.slot.taken","payload":{"consulate_id":"de-chicago","slot_at":"2027-03-31T09:00:00-05:00"}}
```

`visaslot.appointment.cancelled_by_consulate`: the booked appointment in that slot is cancelled before it starts (`cancellation.by: consulate`, optional `reason`), and the slot is `closed`. No booked appointment there is `not_found`; one that has started is `invalid_event`.

```json
{"event_id":"consulate-cancel-fr-chi-20270324","at":"2027-02-15T08:00:00-06:00","operation":"visaslot.appointment.cancelled_by_consulate","payload":{"consulate_id":"fr-chicago","slot_at":"2027-03-24T09:00:00-05:00","reason":"The consulate is closed that morning."}}
```

`visaslot.appointment.held`: the proposal's example. It matches the appointment booked in that slot and applies the rules (above). `at` before the slot is `not_due`. With no booked appointment in the slot, the event is recorded in `checks` with `"result":"no_appointment"` and nothing else changes. Replaying the same event ID changes nothing and keeps the original result (Core also returns its original receipt with `duplicate: true`); the same ID for another slot, or a second hold of a held slot, is `already_exists`.

```json
{"event_id":"held-de-chi-20270331-0900","at":"2027-03-31T09:00:00-05:00","operation":"visaslot.appointment.held","payload":{"consulate_id":"de-chicago","slot_at":"2027-03-31T09:00:00-05:00"}}
```

`examples/scenario.json` is the `slot.released` example above.

## State and time

`fixtures/minimal.json` is Zhao Mingyu's account `visaslot-mingyu` with passport name `ZHAO Mingyu`. Two consulates in `America/Chicago`: German Consulate General Chicago `de-chicago` (DE) and Consulate General of France in Chicago `fr-chicago` (FR). Twelve slots: German slots open on 2027-03-04, 03-09, 03-16, 03-17, 03-31 09:00 and 04-06, one taken on 04-01; French slots open on 2027-03-03 (the earliest), 03-10 and 04-07, one booked on 03-24, and the 2026-06-12 slot of a past appointment. Appointments: `appt-0612` at the French consulate, held on 2026-06-12 as complete with its file (version 2, replacing a version 1 that left a night uncovered), and `appt-0324`, a French appointment booked on 2027-01-20 with no file. Checklists `business` and `tourism`. Every date is on or after 2026-01-01. `fixtures/clock.json` is 2027-02-10T09:00:00-06:00. Slot times carry Chicago's offset at that instant (UTC-06:00 until 2027-03-14, UTC-05:00 after). The binding has Zhao Mingyu and this account.

Task #49 expects the German slots before the qual (from 2027-03-04), the first one after it at 2027-03-31T09:00:00-05:00 and the earliest French slot on 2027-03-03; the fixture matches. A Task replaces seed, binding and policies with its own history through `env.load_seed` (for #49, nothing booked at the start). Its grader can read `data.appointments[]` directly: `{id, consulate_id, country, slot_at, status, history:[{at, status, slot_at, action}]}`, where `history` has a `booked` entry for every booking and reschedule with the slot it held, then `cancelled` or `held`.

Dates in documents and checklists are calendar dates; "today" for the submission rule and the appointment date for the letter rule are local dates at the consulate. `validateSeed` runs after every load, tool call and event and checks the binding, time zones and local slot offsets, unique slots, that a slot is `booked` exactly when a booked or held appointment holds it, appointment history order and actions (only a reschedule changes the slot; booked before the slot, held at or after it), status and slot against the last history entry, version at least the number of steps, cancellation against the history, file versions 1..n replaced in order and submitted before the slot, document facts, lock and check: a held appointment's check must equal the rules applied to its locked file, and each held appointment has exactly one `checks` record. Diagnostics carry record IDs and step names only, never names or document sources.

## Integration

- No `required_apps`, no messaging publishes or receives, no live cross-App reads. Document `source` references are opaque provenance so a Task can compare what was registered with the source records (ConfDesk letter, Passage signature, hotel and airline bookings) when it grades.
- Calendar or Files: the agent may add the appointment or save the checklist with those Apps' own tools; VisaSlot writes nothing there.

## GUI

`gui/src/app.js` is a small business page for the public Web Host: booked, held and cancelled appointments with their history and check result, Find slots, Checklist and Book a slot, and Reschedule, Cancel appointment and Visa file on a selected appointment (versions are prefilled from the selection). The visa file is registered through MCP (`visaslot.file.submit`): its nested accommodation list has no form in the shared Host. `gui/src/view.js` is the escaped reviewer renderer.

```sh
node runtime/web/server.cjs --app visaslot --registry <registry including apps/visaslot> --run web-demo --profile sandbox
```

## Limitations

- Availability changes by other applicants, consulate cancellations and the appointment check happen only when Infra applies their events at their times.
- The check applies the six rules to registered facts. No visa decision, biometrics, fees, photos, insurance, funds or residence-based jurisdiction; checklist items without a rule are not checked.
- The same six rules apply whatever the checklist category.
- `letter_issued_by_appointment` cannot fail on its own through the agent tools: a letter dated after the submission day is already rejected, and the appointment is always later than the submission. It fails for a file a Task seeds as pre-registered (seeded files are not subject to the submission-day rule); a business test covers that path.
- VisaSlot sends no mail in v1. Text only.
- `visaslot` is not added to `apps.registry.json`.

## Source notes

Rules and checklist text are paraphrased; no text, logos or screenshots are copied. What was confirmed on 2026-11-24, and what was not:

- **Competent consulate.** Confirmed on the German Missions in the US short-stay visa page ([germany.info, Schengen/business visa](https://www.germany.info/us-en/service/visa/business-visa-963542)): the responsible state is the sole destination; with several destinations, the main destination by length or purpose of stay; if no main destination can be determined, the state whose external border is crossed first. VisaSlot implements the proposal's simpler form: most nights, and on a tie the country entered first (purpose of stay is not modelled). The page assigns applicants to a mission through a consulate finder (by residence); VisaSlot does not model jurisdiction.
- **Appointments.** Confirmed on the same page: applications need an appointment, scheduled online (through an external service provider for most US jurisdictions, directly with one consulate for its own area).
- **Documents.** Confirmed on germany.info: the online Schengen application form, travel medical insurance of at least EUR 30,000 valid in all Schengen states for the whole stay ([insurance page](https://www.germany.info/us-en/service/visa/medical-health-insurance/953982)), and that applicants must cover their costs from their own funds. Not found on the pages read (the linked document-checklist PDF could not be read): the passport validity rules, photo format, proof of accommodation, itinerary, invitation letter and proof of US status (I-20 travel signature). Those checklist entries in the fixture follow common Schengen short-stay practice and should be checked against the mission's checklist before a Task relies on their wording.
- **France-Visas.** [france-visas.gouv.fr](https://france-visas.gouv.fr/) refused automated reading (HTTP 403), so nothing was confirmed there; the French consulate in the fixture applies the same Schengen rules as the German one.
- **VisaSlot's own choices** (not from the sources): the letter's name is compared with the passport by letter tokens; a letter must be issued by the appointment date; the travel signature must still be valid on the return date (exclusive `valid_until`, as Passage issues it); accommodation must cover every night of the travel dates; insurance, funds, photo and passport are not checked.

## Package map

```text
app.json, package.json, LICENSE   Identity, commands, MIT license
tools.json                         9 Agent tools (generated by build/schemas.cjs)
build/schemas.cjs                  Single source for tools.json and the seed and event schemas
plugin.cjs                         Standard hooks
src/operations.cjs                 Agent tools
src/events.cjs                     slot.released, slot.taken, appointment.cancelled_by_consulate, appointment.held
src/rules.cjs                      Night counts, competence, document checks, the six appointment rules
src/schedule.cjs                   Slots, appointment IDs, history steps and views
src/common.cjs                     Calendar dates and consulate-local time
src/model.cjs                      Seed and state invariants
schemas/                           Generated business schemas plus copied public contracts
contribution/                      Interfaces, events, GUI, dataset, empty asset catalog
fixtures/                          Seed, binding, policies, clock
examples/                          Runnable example, scenario event, replaceable task data
tests/                             Business tests, App-only harness, schema validator
gui/                               Business page and reviewer renderer
```
