# ConfDesk App

A synthetic conference registration desk for PALE tasks: an author registration window that opens and closes at set times, a two-step registration (preview, then confirm with a payment label), a paper removed from the program when no author registers by the deadline, a visa invitation letter issued a set number of business days after registration from the details on file (which can be wrong), and letter corrections with their own business-day turnaround. Notices go to Mail. Package version 1.0.0, Core API 1.2.0, runtime 1.6.0, synthetic data. Environment proposal: [#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192) (Trip paperwork portals; ConfDesk is one of three packages with VisaSlot and Passage). Dependent task: [#49](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/49).

## Run locally

Requires Node.js 18 or newer. From the repository root:

```sh
node --test apps/confdesk/tests/business.test.cjs
node apps/confdesk/examples/run.cjs
node apps/confdesk/build/schemas.cjs --check
node runtime/cli.cjs verify --app apps/confdesk --output .artifacts/confdesk.json
```

With only this folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` inside it. `node build/schemas.cjs` regenerates `tools.json`, the seed and event schemas and the copy of Mail's email wire schema from one source; `--check` fails on drift, and the business tests run it when the public checkout is present.

## Workflows

| Workflow | How it works |
| --- | --- |
| Conference | `confdesk.conference.get`: dates and venue, the registration window (`opens_at`, `closes_at`, `status` = `not_open`, `open` or `closed`), the author rate in effect now and the whole rate schedule, what the rate covers, the preview lifetime, the letter and correction business-day rules and the business calendar. |
| Registration window | The window is `open` once Infra has applied `confdesk.registration.open` (at or after `opens_at`) and until `closes_at`, inclusive. Before that a preview fails with `registration_not_open`, after it with `registration_closed`. |
| Preview | `confdesk.register.preview(paper_id)` returns a single-use `preview_id`, the author rate and currency in effect now, what it covers, the payment labels, `previewed_at` and `expires_at` (`preview_ttl_minutes`, 30 in the fixture). It changes nothing: the ID encodes the preview time and is checked against this account and paper. |
| Confirm | `confdesk.register.confirm(preview_id, payment_label)` registers the author (`SCDA27-R-0388`), records one payment of the previewed rate against the label and puts the paper `in_program`. Rejected with nothing recorded: unknown or altered ID (`not_found`), the preview already used (`preview_used`), past `expires_at` (`preview_expired`), the window no longer open or the rate changed since the preview (`preview_mismatch`), another registration already done (`already_registered`), unknown label (`invalid_payment_label`). A task can check that the user's approval came between `previewed_at` and `completed_at`. |
| Deadline | Infra applies `confdesk.deadline.passed` after `closes_at`. Without a registration the paper becomes `removed` (`removed_at`) and a notice is written; with one the paper is kept and nothing is sent. |
| Invitation letter | Infra applies `confdesk.letter.issue` on or after the due date. The letter uses the attendee details on file at that moment, so the seeded profile's misspelled surname is printed (`ZHOU Mingyu`). `name_on_letter` is `SURNAME Given names`; the text is structured plain text. |
| Correction | `confdesk.letter.request_correction(fields)` records corrected values for the current letter (`salutation`, `surname`, `given_names`, `date_of_birth`, `nationality`; surnames are stored in capitals; each must differ from the letter). It needs an issued letter and no other pending request (`invalid_state`). Nothing else changes until Infra applies `confdesk.correction.issue`, which issues `letter-0388-c1` with the corrected details, supersedes the previous letter and updates the details on file. |
| Reads | `confdesk.registration.get` (registration or null, the details and name on file, labels, payments), `confdesk.letter.get` (letters newest first, `current`, `letter_expected_on` before the first letter, every correction request with `expected_on`), `confdesk.paper.status` (paper, `registered`, deadline). |

Error codes: `not_found`, `registration_not_open`, `registration_closed`, `paper_removed`, `already_registered`, `invalid_payment_label`, `preview_used`, `preview_expired`, `preview_mismatch`, `invalid_arguments`, `invalid_state`, `not_due`, `invalid_event`. Core adds `stale_version`, `idempotency_conflict`, `permission_denied` and `invalid_arguments` for schema failures.

## The business-day rule

The desk owns the rule; the Task owns when events happen.

- Business days are Monday to Friday, except the holidays of the business calendar.
- Day 0 is the registration date (for the letter) or the correction request date (for a corrected letter), read in the calendar's time zone, whatever the hour. Counting starts the next day; the due date is the N-th business day. `letter_business_days` is 10 and `correction_business_days` is 12 in the fixture.
- The calendar is `business_calendar` in the seed (`timezone`, `holidays`). Without it the desk uses its default: `America/Chicago` and the US federal holidays (observed dates) for 2026 to 2028. `holidays: []` means no holidays.
- Each letter event carries the computation: `counted_from`, `business_days`, `counted_days`, `skipped_holidays` and `due_on`. The desk recomputes it and rejects any difference (`invalid_event`), and rejects an event dated before `due_on` (`not_due`). An event on a later date is accepted; the letter is dated by the event's own time (`issued_at`) and keeps the computed `due_on`.

With the fixture: a registration on Monday 2027-02-22 gives a letter on 2027-03-08; a correction requested on 2027-03-10 gives the corrected letter on 2027-03-26; one requested on 2027-03-12 gives 2027-03-30.

## Who can do what

| Caller | Operations |
| --- | --- |
| Agent (7 MCP tools) | Reads: `confdesk.conference.get`, `confdesk.register.preview`, `confdesk.registration.get`, `confdesk.letter.get`, `confdesk.paper.status`. Writes: `confdesk.register.confirm`, `confdesk.letter.request_correction`. The fixture `scenario` profile allows only the five reads. |
| Infra events (`env.apply_event`) | `confdesk.registration.open`, `confdesk.deadline.passed`, `confdesk.letter.issue`, `confdesk.correction.issue`. |

The Agent cannot open the window, process the deadline or issue letters; Core denies `env.*` on the Agent connection and no event operation is an Agent tool. The App never schedules itself. Writes need `expected_version` and `request_id`; Core returns the original result for a repeated request ID and rejects a stale version.

## Events

Each event is `{event_id, at, operation, payload}`; `at` carries a UTC offset and is the handler's `virtual_now`. Every applied event is recorded in `events` (`opened`, `kept`, `removed` or `issued`, with the object), and a replayed event ID is a no-op, also when the ID came in with a loaded history.

`confdesk.registration.open`: at or after `opens_at` (`not_due` before), not after `closes_at` (`invalid_event`), once (`invalid_state`).

```json
{"event_id":"scda27-registration-open","at":"2027-02-22T09:00:00-06:00","operation":"confdesk.registration.open","payload":{}}
```

`confdesk.letter.issue`: names the registration, which must exist (`invalid_state` without one, `not_found` for another ID); issues the one original letter (`invalid_state` for a second).

```json
{"event_id":"scda27-letter-0388","at":"2027-03-08T10:00:00-06:00","operation":"confdesk.letter.issue","payload":{"registration_id":"SCDA27-R-0388","counted_from":"2027-02-22","business_days":10,"counted_days":["2027-02-23","2027-02-24","2027-02-25","2027-02-26","2027-03-01","2027-03-02","2027-03-03","2027-03-04","2027-03-05","2027-03-08"],"skipped_holidays":[],"due_on":"2027-03-08"}}
```

`confdesk.deadline.passed`: after `closes_at` (`not_due` at or before it), once. Removes the paper when no author registered.

```json
{"event_id":"scda27-deadline","at":"2027-03-16T07:10:00-05:00","operation":"confdesk.deadline.passed","payload":{}}
```

`confdesk.correction.issue`: names the registration and issues the pending correction (`invalid_state` when none is pending), counted from the request date.

```json
{"event_id":"scda27-letter-0388-c1","at":"2027-03-26T10:00:00-05:00","operation":"confdesk.correction.issue","payload":{"registration_id":"SCDA27-R-0388","counted_from":"2027-03-10","business_days":12,"counted_days":["2027-03-11","2027-03-12","2027-03-15","2027-03-16","2027-03-17","2027-03-18","2027-03-19","2027-03-22","2027-03-23","2027-03-24","2027-03-25","2027-03-26"],"skipped_holidays":[],"due_on":"2027-03-26"}}
```

`examples/scenario.json` is the `confdesk.registration.open` example above.

## Mail notices

ConfDesk writes four notices: `registration_confirmed` (object `registration`), `letter_issued` and `correction_issued` (object `invitation_letter`, with the letter text) and `paper_removed` (object `paper`). Each notice stores, in `notices[].message`, a stable CloudEvent for Mail's receive contract: `type` `org.pale.mail.notification.v1`, `dataschema` `urn:pale:email-payload:1`, and `data` following Mail's payload unchanged, for example `{"channel":"channel.email","recipient":{"kind":"app_account_ref","app_id":"mail","id":"mail-mingyu"},"source_object":{"app_id":"confdesk","account_id":"confdesk-mingyu","object_type":"invitation_letter","object_id":"letter-0388"},"content":{"title":"Your SCDA 2027 invitation letter","body":{"format":"text/plain","text":"Dear Mr. ZHOU Mingyu, ..."},"asset_ids":[]},"extensions":[]}`. The sender identity comes from `source` and `source_object`. Infra reads the message from `env.snapshot` and publishes it with `router.publish`; the message ID is stable, so a retry is deduplicated. ConfDesk sends nothing itself. With `mail_account_id: null` notices are kept with `message: null`.

`messaging.publishes` declares `channel.email` with Mail's `urn:pale:email-message:2` (`schemas/email-message.schema.json`, a verbatim copy of `examples/apps/mail/schemas/router-message.schema.json`); the business tests validate every notice kind against it. Mail is a run-assembly recipient, not a `required_apps` dependency.

## State and time

`fixtures/minimal.json` is Mingyu Zhao's account `confdesk-mingyu` (Mail account `mail-mingyu`, labels `First Prairie Visa ending 2291` and `NPU travel card ending 7710`) at SCDA 2027, the Symposium on Circuit Design Automation, Centre des Congres de Lyon, 26-29 April 2027. The attendee profile was created at paper submission on 2026-10-15 and misspells the surname: `ZHOU Mingyu` (passport: ZHAO). Paper #214 (`paper-214`), accepted 2027-01-20, is awaiting registration. Registration opens 2027-02-22T09:00:00-06:00 and closes 2027-03-15T23:59:00-05:00; author rate USD 720.00; registration number 388 (`SCDA27-R-0388`, letters `letter-0388`, `letter-0388-c1`, corrections `correction-0388-1`). No `business_calendar`, so the default calendar applies. `fixtures/clock.json` is 2027-02-08T20:30:00-06:00. Every history date is on or after 2026-01-01. `examples/task-data/seed.json` is a later history (registered, letter issued, correction pending).

The IDs and fields line up with the shapes #49 reads as `run.portals.confdesk`: `registration` `{id, type: 'author', status: 'completed', completed_at, payment_label}`, `letters[]` `{id, name_on_letter, issued_at}` and `correction_requests[]` `{id, at, via: 'letter.request_correction', fields}`, directly in `env.snapshot().data`.

All writes use the run's virtual time. The paper, registration, letters, correction requests and attendee profile keep an append-only `history`. `validateSeed` runs after every load, tool call and event and checks the binding, the window and rate schedule, the paper status against the registration and deadline, the registration against its preview (ID, lifetime, window, rate), the one payment, every letter against its business-day computation and the details it prints, corrections against the letter they correct and the turnaround rule, the current letter against the details on file, notice references and Mail messages, unique event IDs and record timelines. Diagnostics carry IDs and field names only, never names, labels or letter text.

## GUI

`gui/src/app.js` is a business page for the public Web Host: a Registration view (window, rate, rules, paper and registration) and an Invitation letters view (due date, correction requests, letters as printed), with Preview registration, Confirm registration and Request letter correction mapped to the Agent tools. Payment labels are offered as choices. `gui/src/view.js` is the escaped reviewer renderer.

## Limitations

- The window opening, the deadline and letter issuing happen only when Infra applies their events; the App never schedules itself.
- One conference, one attendee account and one accepted paper per seed; author registration only. No cancellation, refund, extra paper, other registration types, invoices or receipts.
- Payment labels are opaque; the payment is recorded in ConfDesk, not posted to a card App. Fees are recorded as paid; nothing is charged.
- Letters are structured text, not PDFs, and carry no passport number. Only one correction request can be pending at a time.
- Notices are published by Infra from state; there is no atomic outbox or delivery receipt inside ConfDesk.
- `confdesk` is not added to `apps.registry.json`.

## Source notes

Rules are paraphrased; no text, logos or screenshots are copied, and no reference product's code or data is used.

| Rule | Paraphrased from |
| --- | --- |
| Author registration opens and closes at set times, one registered author per accepted paper, papers without one are dropped from the program and proceedings | Typical IEEE/ACM author-registration pages and the [ConfTool](https://www.conftool.net/) registration workflow (registration periods, author registration tied to a submission). |
| Two-step registration: a summary of the rate and what it covers, then a confirmation with payment | ConfTool-style registration: a review page before the binding submission of the registration and payment. |
| Visa invitation letters issued after a completed registration, using the participant's details, with a stated processing time and a correction route | Typical conference visa-letter pages (letters only for registered participants, details taken from the registration, "check your details" notes). |
| Business days are Monday to Friday excluding holidays; the default holiday table | US federal holidays and their observed dates as published by the US Office of Personnel Management. |

## Package map

```text
app.json, package.json, LICENSE   Identity, commands, MIT license
tools.json                         7 Agent tools (generated by build/schemas.cjs)
build/schemas.cjs                  Single source for tools.json, the seed and event schemas and the email copy
plugin.cjs                         Standard hooks
src/operations.cjs                 Agent tools: conference, preview, confirm, registration, letters, correction, paper
src/events.cjs                     registration.open, deadline.passed, letter.issue, correction.issue
src/desk.cjs                       Business calendar, window, rate schedule, preview IDs, record IDs, letter text
src/dates.cjs                      Local dates and business-day arithmetic
src/notices.cjs                    Notices and their Mail messages
src/model.cjs                      Seed and state invariants
schemas/                           Generated business schemas plus copied public contracts
contribution/                      Interfaces, events, publish contract, GUI, dataset, empty asset catalog
fixtures/                          Seed, binding, policies, clock
examples/                          Runnable example, scenario event, replaceable task data
tests/                             Business tests, App-only harness, schema validator
gui/                               Business page and reviewer renderer
```
