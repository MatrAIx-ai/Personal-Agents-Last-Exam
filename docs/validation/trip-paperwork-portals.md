# Trip paperwork portals v1 validation

First runnable version of the plan in [#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192) (proposal at `9b5144f`; the proposal file is unchanged). Three packages: [ConfDesk](../../apps/confdesk/), [VisaSlot](../../apps/visaslot/) and [Passage](../../apps/passage/), each 1.0.0. No App was changed for the workflow example.

## Versions and commands

Public runtime 1.6.0, Core API 1.2.0, Messaging router 1.2.0, Mail 1.3.0 (reference App, receiver of notices). Run locally on 2026-11-24 on macOS with Node v26.7.0. CI runs Node 18 and 22. From the repository root:

| Command | Result |
| --- | --- |
| `node --test apps/confdesk/tests/business.test.cjs` | 25/25 tests pass |
| `node --test apps/visaslot/tests/business.test.cjs` | 25/25 tests pass |
| `node --test apps/passage/tests/business.test.cjs` | 17/17 tests pass |
| `node apps/<id>/examples/run.cjs` for each | Runs: registration, misspelled letter, correction, deadline kept and removed (ConfDesk); competence, cancel, book, file replaced, held as complete (VisaSlot); early event refused, signature issued, both Mail messages (Passage) |
| `node runtime/cli.cjs verify --app apps/<id> --output .artifacts/<id>.json` | `passed: true`: ConfDesk 39 checks, VisaSlot 39, Passage 36 |
| `node apps/<id>/build/schemas.cjs --check` for each | No drift: schemas and `tools.json` are current. ConfDesk's and Passage's `email-message.schema.json` are byte-identical to Mail's `router-message.schema.json`. |
| `node runtime/build-contracts.cjs --check` | CloudEvents and receiver-owned payload copies match |
| `node runtime/sdk/sync.cjs --check` | Shared schemas, reference helpers and derived declarations match |
| `npm run example:trip-paperwork` | `passed: true`, 47 checks over real MCP, Messaging and Mail; temporary state removed |
| `npm test` | 22/22 stages pass (no existing App or runtime file is changed) |
| `npm run test:web` | 4/4 pass |

Inside `verify`, the package is copied without the runtime, so the one business test per App that drives real Core (VisaSlot, Passage) skips there (24 + 1 skipped, 16 + 1 skipped); run from the repository root as above, all tests run and pass. `registry.paperwork.json` assembles the three packages with Mail 1.3.0; `apps.registry.json` is unchanged.

## Approved deliverables → evidence

| Planned deliverable | Evidence |
| --- | --- |
| Three packages under `apps/` with `tools.json` (9, 7 and 3 Agent tools), state machines, business-day arithmetic, Infra event handlers and small GUIs | `apps/visaslot` (9 tools; `slot.released`, `slot.taken`, `appointment.cancelled_by_consulate`, `appointment.held`), `apps/confdesk` (7 tools; `registration.open`, `deadline.passed`, `letter.issue`, `correction.issue`), `apps/passage` (3 tools; `request.processed`). Event names are prefixed with the App ID. Each has its own `app.json`, seed, reset and verification command (review answer to open question 1). |
| Business tests for every transition and its error cases | Rule-coverage tables below |
| Example seed: applicant with a misspelled conference profile created 2026-10-15; one paper accepted 2027-01-20; 2 consulates with about 10 slots; an I-20 signature issued 2026-03-09 that lapses 2027-03-09; every history date on or after 2026-01-01 | `apps/confdesk/fixtures/minimal.json` (profile `ZHOU Mingyu`, passport ZHAO; paper-214); `apps/visaslot/fixtures/minimal.json` (`de-chicago`, `fr-chicago`, 12 slots); `apps/passage/fixtures/minimal.json` (`sig-0141` signed 2026-03-09, `valid_until` 2027-03-09). Seeds validate after every load, tool call and event; reset restores each exactly (verifier). |
| Mail notices through the existing receive contract | ConfDesk and Passage store each notice's CloudEvent at `data.notices[].message` (`urn:pale:email-payload:1` unchanged, wire `urn:pale:email-message:2`); `contribution.json` declares the `channel.email` publish. Mail is not modified. |
| Cross-App example in `examples/workflows/trip-paperwork/` | [`examples/workflows/trip-paperwork/`](../../examples/workflows/trip-paperwork/README.md): preview and confirm, the letter with the wrong name, correction, corrected letter in Mail, visa file, appointment held as complete; a second run refused with `name_matches_passport` |
| Real MCP connections to Mail with receiver-side evidence and a rejected delivery for an unbound recipient; Mail otherwise untouched | Same workflow; see Mail integration below |
| Validation and reset: verify, business tests, workflow, history loading, reset and `env.advance_time` | This report |

## Permissions

- The Agent connection lists no `env.*` operation on any of the four Apps, and neither ConfDesk nor Passage has a publish or outbound tool, so the Agent sees mail only in Mail (workflow check 1).
- On real MCP, the Agent cannot issue a letter (`confdesk.letter.issue`), hold an appointment (`visaslot.appointment.held`), process a signature (`passage.request.processed`), deliver mail (`mail.receive_notification`) or call `env.advance_time`: each is `permission_denied` (workflow check 2). The verifier also checks that every `env.*` operation (`advance_time`, `apply_event`, `event_status`, `load_seed`, `reset`, `snapshot`, `validate_bundle`) is denied to the Agent for each package.
- The fixture `scenario` profile allows only reads: confirming a registration is `permission_denied` (workflow check 3). The `sandbox` profile allows all Agent tools.
- The Messaging publisher connections are held by Infra only and fixed to one App identity each; the Agent never receives them.

## State consistency

- Writes need `expected_version` and `request_id`; Core returns the original receipt for a repeated request ID and rejects a stale version (verifier; VisaSlot's slot and appointment versions in its own tests).
- A replayed Infra event ID returns its original receipt with no change (verifier "Identical event retry is deduplicated", workflow check 39 for `visaslot.appointment.held`).
- A refused event or tool call changes nothing: an early `passage.request.processed` is `not_due` (check 12), an expired preview records no payment (checks 17–18), and a file cannot be replaced after the hold (check 40).
- The Agent's Passage request produces exactly the fixture's `req-0142` and `notice-3`, including the stable Mail message ID (check 10).
- At the end, every App clock is at the appointment time (check 44), and ConfDesk holds one registration, one payment, both letters and one correction (check 45).

## Reset, history loading and time

- Verifier, per package: Infra loads history and relationships, the loaded records match the input, invalid history is rejected and leaves state unchanged, reset returns ready, restores the loaded baseline and advances the epoch, a separate run keeps its own data, and a new MCP process reads persisted state.
- Workflow: Passage is loaded with the history before the request and Mail with an empty mailbox through `env.load_seed`; a `sandbox` reset restores the loaded Passage history, not the fixture (check 5).
- Time moves only through Infra. Each due event is applied at its time and `env.advance_time` then moves ConfDesk, VisaSlot, Passage and Mail to that time before the next action or delivery, ten times in the run. The Apps never schedule themselves.
- Business-day events carry the computation the App checks: Passage 5 days (2027-02-08 → 2027-02-15), ConfDesk letter 10 days (2027-02-22 → 2027-03-08) and correction 12 days (2027-03-10 → 2027-03-26, across the 2027-03-14 DST change). A wrong computation is `invalid_event` and an early one `not_due` (App tests).

## Mail integration

Five notices reach `mail-mingyu`: Passage `request_received` and `signature_issued`, ConfDesk `registration_confirmed`, `letter_issued` and `correction_issued`. For each, Infra reads the stored CloudEvent from `env.snapshot` and calls `router.publish` under that App's identity, and the run checks from the receiver side: the receipt targets `mail/mail-mingyu` and was applied at the notice's own time; `mail.get` under the delivery event ID returns a record whose `thread_id` is the CloudEvent ID, with the sender App, title, text and receipt time; and Mail's `env.event_status` receipt names the same CloudEvent (source, ID, type, time). The Agent then finds `ZHOU Mingyu` in the first letter and `ZHAO Mingyu` in the corrected one in the inbox.

- A repeated publish returns the original receipt (`duplicate: true`, same event ID).
- A copy addressed to `mail-elise`, which has no Mail account bound in the run, is `recipient_unavailable`; a ConfDesk publisher granted only `mail-elise` is refused for `mail-mingyu` with `recipient_not_authorized`. Mail's version is unchanged by the repeat and both refusals.
- Mail's final data equals its loaded seed plus exactly the five delivered records, and since that load only Infra deliveries and clock moves changed Mail.

## Rule coverage

ConfDesk (`apps/confdesk/tests/business.test.cjs`):

| Rule | Test |
| --- | --- |
| Window opens at or after `opens_at`, once; replay is a no-op | `registration.open: not before opens_at, not after the window, only once; replay is a no-op` |
| Preview before the window and after it closes is refused; a preview changes nothing | `preview: registration before the window opens and after it closes is refused; inside it, a preview changes nothing` |
| Confirm registers, records the payment against the label, sends a notice | `confirm registers the author, records the payment against the label and sends a Mail notice` |
| Unknown, reused or expired preview and unknown label are rejected with nothing recorded | `confirm rejects an unknown, reused or expired preview and an unknown label; nothing is recorded` |
| A preview that no longer matches the rate or the window | `confirm rejects a preview that no longer matches the rate or the open window` |
| Paper removed at the deadline without a registration, kept with one | `deadline.passed removes the paper when no author registered, keeps it when one did; only after closes_at` |
| Letter issued N business days after registration with the seeded (misspelled) details | `letter.issue issues the letter N business days after registration with the details on file (misspelled surname)` |
| The event's business-day computation and date are checked | `letter.issue validates the event's business-day computation against the desk rule and the date it is applied`, `business days: day 0 is the date in the business calendar; weekends and seeded holidays are skipped; holidays [] means none` |
| Correction turnaround and supersession | `request_correction records the request, its business-day turnaround and nothing else`, `correction.issue issues the corrected letter after its own turnaround and supersedes the first`, `the correction deadline in #49: ...` |
| Agent cannot fire Infra events; idempotency and reset through Core | `the agent cannot fire Infra events or load history: ...`, `Core: agent is denied Infra events, writes are idempotent per request ID with version checks, reset restores the seed` |
| Notices carry stable Mail messages | `notices carry stable Mail messages; without a Mail account they carry none` |

VisaSlot (`apps/visaslot/tests/business.test.cjs`):

| Rule | Test |
| --- | --- |
| Competence by most nights; tie goes to first entry | `competence: the main destination has the most nights; a tie goes to the country entered first` |
| Slots change on the clock | `slots lists open future slots by local date, and past slots disappear on the clock` |
| A slot taken between search and book; stale slot version | `a slot taken between search and book is refused; a slot that changed since it was read is stale` |
| Reschedule and cancel against stale versions | `reschedule moves the appointment and releases the old slot; stale versions are refused`, `cancel releases the slot, needs the current version and closes when the slot starts` |
| File replaced before the appointment, rejected after it starts; no future-dated documents | `the visa file is replaced until the appointment starts and rejected after it starts`, `a letter or signature dated after the submission day at the consulate is rejected` |
| Held with a complete file | `appointment held with a complete file: complete, file locked, recorded once` |
| Each of the six rules failing on its own (including no file) | `each rule fails on its own with one missing entry` |
| No appointment in the slot; replay; not due before the slot | `held with no appointment in that slot records no_appointment and changes nothing else`, `a replayed held event keeps the original result; the check is not due before the slot` |
| Availability events | `slot.released and slot.taken change availability and are validated`, `appointment.cancelled_by_consulate cancels the booked appointment and closes its slot` |
| Agent cannot fire Infra events; replay, stale versions and reset through Core | `Core: the Agent cannot fire Infra events; request and event replays, stale versions and reset` |

Passage (`apps/passage/tests/business.test.cjs`):

| Rule | Test |
| --- | --- |
| Processed on the 5th business day; 12-month signature and notice | `a request is processed on the 5th business day: the processed event issues a 12-month signature and a notice` |
| Weekends and holidays skipped; holiday table is seed data | `a fresh request counts business days after the submission date, skipping weekends and the holiday in between`, `the holiday table is seed data: absent uses the default, an empty table means Monday to Friday only` |
| Early or incorrect event rejected with no change | `an early or incorrect processed event is rejected with no state change` |
| Signature lapses at 00:00 office time on `valid_until` | `signature validity flips to lapsed at 00:00 office time on valid_until` |
| One request in processing; replayed event is a no-op | `a duplicate request while one is in processing returns it and changes nothing`, `a replayed processed event ID is a no-op` |
| Mail notices follow Mail's receive contract | `Mail notices follow Mail's receive contract unchanged and are stable` |
| Agent cannot fire Infra events; idempotency and reset through Core | `through Core: the Agent cannot fire Infra events; request IDs and event IDs are idempotent; reset restores the seed` |

## Not covered yet

- No package is added to `apps.registry.json` (`runtime/tests/clock.test.cjs` expects exactly seven Apps there); `registry.paperwork.json` assembles them. Adding them is a maintainer decision.
- The pinned Playwright browser test runs only the Apps in `apps.registry.json`, so it does not cover these pages.
- VisaSlot reads no other App: hotel and airline details reach the visa file only as facts the Agent registers, with opaque `source` references (review answer to open question 2). The workflow's hotel references (`task-hotel` `H-5521`, `H-5530`) are task data, not a running App.
- Letters and signatures are text only; there is no atomic outbox or delivery receipt inside ConfDesk or Passage (Infra publishes from state).
- Validated locally on Node v26.7.0 only; Node 18 and 22 run in CI.
- Human review of fixture realism and of the paraphrased source notes.
