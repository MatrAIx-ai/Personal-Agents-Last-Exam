# Passage App

A synthetic university international-office e-form portal for PALE tasks: the student submits the I-20 Travel Signature Request, the office processes it after a set number of business days, and the signature has a signing date and a validity period after which it lapses. Notices go to Mail. Package version 1.0.0, Core API 1.2.0, runtime 1.6.0, synthetic data. Environment proposal: [#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192) (Trip paperwork portals; Passage is one of three packages with VisaSlot and ConfDesk).

## Run locally

Requires Node.js 18 or newer. From the repository root:

```sh
node --test apps/passage/tests/business.test.cjs
node apps/passage/examples/run.cjs
node apps/passage/build/schemas.cjs --check
node runtime/cli.cjs verify --app apps/passage --output .artifacts/passage.json
```

With only this folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` inside it; the tests that need the public runtime or Mail's schemas skip themselves. `node build/schemas.cjs` regenerates `tools.json`, the seed and event schemas and the copy of Mail's email wire schema from one source; `--check` fails on drift, and the business tests run it when Mail's schema is present.

## Workflows

| Workflow | How it works |
| --- | --- |
| Request | `passage.travel_signature.request` submits the e-form for the student's I-20. The request records `submitted_at`, its office date `submitted_on`, the rule in force (`business_days`) and `due_on`. A `request_received` notice is written with its Mail message. While a request is in processing, submitting again returns it with `created: false` and changes nothing. |
| Processing | Infra applies `passage.request.processed` with the business-day computation. Passage checks it against its own rule and the clock, then issues the signature (`sig-NNNN` for `req-NNNN`), marks the request `processed` and writes a `signature_issued` notice. |
| Status | `passage.documents.status` reports the I-20, the current (most recently issued) travel signature and every signature on file, each `valid` or `lapsed` today at the office with `days_until_lapse`, and any request in processing. |
| History | `passage.requests.list` lists requests newest first with status, due date, processing time and the signature produced. |

Error codes: `not_found`, `invalid_event` (computation does not match the rule; unsupported operation), `not_due` (event before the due date), `invalid_state` (request already processed by another event). Core adds `stale_version`, `idempotency_conflict`, `permission_denied` and `invalid_arguments`.

## The business-day rule

The App owns the rule; the holiday table is seed data.

- Day 0 is the office date of `submitted_at` in `office.timezone`, whatever the hour. A request sent at 23:30 on a Thursday counts from that Thursday.
- Counting forward, a business day is a Monday to Friday date that is not in the holiday table. `due_on` is the `rules.processing_business_days`-th business day (5 in the fixture). Example: submitted Thursday 2027-01-14 → Fri 15, Tue 19, Wed 20, Thu 21, Fri 22, skipping the weekend and Monday 18 (Martin Luther King Jr. Day); due 2027-01-22.
- `holidays` absent: the built-in default table (US university closures for 2026–2028 in `src/office.cjs`; Presidents' Day is a working day). `holidays: []`: Monday to Friday with no holidays. A listed array: exactly those dates.
- The processing event must carry `submitted_on`, `business_days`, `counted_days` (the N dates counted, in order), `skipped_holidays` (weekday holidays skipped) and `due_on`, each equal to Passage's own computation; otherwise it is rejected with `invalid_event` and a message giving the expected values. It must also arrive at or after 00:00 office time on `due_on` (`not_due` otherwise). A later event is accepted: the office signs on the day it processes, so `signed_on` is the office date of the event.
- The App never schedules itself. Rejected events change neither data nor the clock.

## Signature validity

`signed_on` is the office date of `issued_at` (the processing event time, when the student has the signed I-20). `valid_until` is `signed_on` plus `rules.signature_validity_months` (12) calendar months, with the day clamped to a shorter month's end. It is the lapse date: the signature is `valid` on dates before `valid_until` and `lapsed` from 00:00 office time on `valid_until`. The fixture signature signed 2026-03-09 is valid through 2027-03-08 and lapsed at 2027-03-09T00:00:00-06:00; one signed 2027-02-15 runs to `valid_until` 2028-02-15. A consumer checking "valid through the return date" should test `return_date < valid_until`.

## Who can do what

| Caller | Operations |
| --- | --- |
| Agent (3 MCP tools) | Write: `passage.travel_signature.request`. Reads: `passage.requests.list`, `passage.documents.status`. The fixture `scenario` profile allows only the two reads. |
| Infra (`env.apply_event`) | `passage.request.processed`, at the time the task's runner chooses. Infra also reads notice messages from `env.snapshot` and publishes them. |

The Agent cannot process requests, issue signatures or change the clock: the `env.*` operations are not listed or callable on its connection (tested through Core).

## Events

Each event is `{event_id, at, operation, payload}`; `at` carries a UTC offset and is the handler's `virtual_now`. A replayed event ID returns Core's original receipt (`duplicate: true`) without calling the App; if one reaches the App anyway, the request already records `processed_event_id` and the event is a no-op. Another event ID for a processed request is `invalid_state`.

`passage.request.processed`: the fixture's pending request req-0142, submitted 2027-02-08, on its due date.

```json
{"event_id":"processed-req-0142","at":"2027-02-15T10:00:00-06:00","operation":"passage.request.processed","payload":{"request_id":"req-0142","submitted_on":"2027-02-08","business_days":5,"counted_days":["2027-02-09","2027-02-10","2027-02-11","2027-02-12","2027-02-15"],"skipped_holidays":[],"due_on":"2027-02-15"}}
```

`examples/scenario.json` is this event.

## Mail notices

Two notices, written into state with the business change: `request_received` (title "Travel signature request received", gives the request ID, business days and expected date) and `signature_issued` (title "Your I-20 travel signature is ready", gives `signed_on` and `valid_until`). When `mail_account_id` is set, each notice's `message` is a CloudEvent for Mail's existing receive contract: type `org.pale.mail.notification.v1`, `dataschema` `urn:pale:email-payload:1`, wire schema `urn:pale:email-message:2` (`schemas/email-message.schema.json`, a verbatim copy of `examples/apps/mail/schemas/router-message.schema.json`). The payload is unchanged Mail format: `channel.email`, recipient `{kind: app_account_ref, app_id: mail, id: <mail_account_id>}`, `source_object` `{app_id: passage, account_id, object_type: travel_signature_request | travel_signature, object_id: req-NNNN | sig-NNNN}`, plain-text content and no assets. `source` is `urn:pale:app:passage:account:<account_id>`, `time` the notice time, and the ID is a hash of the notice and payload, so retries are stable. With `mail_account_id: null` the notice is kept with `message: null`.

Infra reads `data.notices[].message` from `env.snapshot` and calls Messaging `router.publish`. `contribution.json` declares the `channel.email` publish. Mail is a run-assembly recipient, not a `required_apps` dependency; a business test validates every message against Mail's wire and payload schemas.

## State and time

`fixtures/minimal.json` is ZHAO Mingyu's account `passage-mingyu` (person `person-mingyu`, Mail account `mail-mingyu`) at the International Student & Scholar Office of North Plains University (America/Chicago): one I-20 `i20-mingyu`; the rule 5 business days and 12 months; the default holiday table written out; request `req-0141` submitted 2026-03-02 and processed 2026-03-09 with signature `sig-0141` (signed 2026-03-09, lapses 2027-03-09); request `req-0142` submitted 2027-02-08T20:30:00-06:00, due 2027-02-15 and still in processing; and three notices. `fixtures/clock.json` is the moment req-0142 was submitted. Applying the scenario event gives `sig-0142` (signed 2027-02-15, valid until 2028-02-15). All history is on or after 2026-01-01. Remove req-0142 and notice-3 for a student who has not asked yet; the next request is then numbered req-0142.

The snapshot carries `requests: [{id, kind: 'travel_signature', submitted_at, status, signature_id, ...}]` and `signatures: [{id, issued_at, signed_on, valid_until, ...}]` as task #49 plans to read them.

All writes use the run's virtual time, `expected_version` and `request_id`; Core returns the first receipt for a repeated `request_id`. Requests keep an append-only `history`. `validateSeed` runs after every load, tool call and event and checks the binding and Mail account, the time zone and holiday dates, record IDs, at most one request in processing, each request's office date, due date and processing fields against the rule, signature links, signing date and lapse date, notice references, and that each notice message is the one Passage would build. Diagnostics carry record IDs and step names only, never notice text.

## GUI

`gui/src/app.js` is a business page for the public Web Host: an "I-20 & signature" panel (current signature, valid or lapsed, days left, any request in processing, all signatures) and "My requests", with a Request travel signature action mapped to the Agent tool. `gui/src/view.js` is the escaped reviewer renderer. See `gui/README.md`.

## Limitations

- Processing happens only when Infra applies `passage.request.processed`; nothing is scheduled by the App. There is no rejection outcome: every request is eventually processed.
- One I-20 per account and one request in processing at a time. Travel signatures only: no OPT (6-month) validity, program-end limits, DS-2019, address updates or other e-forms.
- Notices are written to state with their Mail CloudEvent; delivery is Infra's `router.publish`. There is no outbound tool, so the Agent sees mail only in Mail.
- Text only: no PDF or image of the signed I-20.
- `passage` is not added to `apps.registry.json`.

## Source notes

Rules are paraphrased from public university international-office pages (checked 2026-11-24); no text, logos or screenshots are copied, and the office, school and student are fictional.

- Students request the I-20 travel signature through an online e-form, and only the school's designated officials sign: [USC Office of International Services](https://ois.usc.edu/?p=104), [Harvard International Office request form](https://www.hio.harvard.edu/forms/travel-signature-request.md), [Cal Poly Pomona](https://cpp.edu/international/students/isso-forms/travel-signature-request.shtml).
- Processing is quoted in business days, typically 3 to 7 (USC 7; [Vanderbilt ISSS](https://www.vanderbilt.edu/isss/immigration/travel/) 5–7; Harvard 3–5), and students are told to request ahead of departure ([Stony Brook](https://www.stonybrook.edu/commcms/visa/immigration-status/f1-students/Travel/Travel%20Endorsement)). Passage uses 5, as the #49 scenario does.
- A signature allows re-entry for about one year from the signing date; one example states a signature issued on 31 December allows re-entry up to 30 December of the next year ([Colorado State ISSS](https://international.colostate.edu/isss/resources/travel/)). Passage models this as a lapse on the anniversary date.
- Office holidays: the default table follows a common US university closure calendar (federal holidays observed by universities plus the day after Thanksgiving and a winter closure day); it is not any one university's calendar.

## Package map

```text
app.json, package.json, LICENSE   Identity, commands, MIT license
tools.json                         3 Agent tools (generated by build/schemas.cjs)
build/schemas.cjs                  Single source for tools.json and the seed, event and email schemas
plugin.cjs                         Standard hooks
src/operations.cjs                 Agent tools: request, requests.list, documents.status
src/events.cjs                     request.processed
src/office.cjs                     Business-day rule, default holidays, signature validity
src/dates.cjs                      Office dates, calendar months with month-end clamp
src/notices.cjs                    Notices and their Mail CloudEvents
src/model.cjs                      Seed and state invariants
schemas/                           Generated business schemas plus copied public contracts
contribution/                      Interfaces, events, publish contract, GUI, dataset, empty asset catalog
fixtures/                          Seed, binding, policies, clock
examples/                          Runnable example, scenario event, replaceable task data
tests/                             Business tests (App-only harness and in-process Core), schema validator
gui/                               Business page and reviewer renderer
```
