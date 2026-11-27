# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Public service & law + Learning & research] Trip paperwork portals: visa appointments, conference registration and travel signatures`

## 1. App and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Reference app or website / URL (required):** Three small, independently branded synthetic portals. Their workflows follow public pages:
  - **VisaSlot**, a Schengen consulate appointment scheduler: the [German Missions in the US visa appointment pages](https://www.germany.info/us-en/service/visa) and [France-Visas](https://france-visas.gouv.fr/) for jurisdiction, required documents and appointments.
  - **ConfDesk**, a conference registration desk: [ConfTool](https://www.conftool.net/) and typical IEEE/ACM author-registration and visa-letter pages.
  - **Passage**, a university international-office e-form portal: public university ISSO pages on I-20 travel signatures.

  No reference product's code, branding or data is used.
- **Primary domain (required):** Public service & law
- **Secondary domains (optional):** Learning & research. Conference registration and the university travel signature are academic workflows.

## 2. What you plan to build

**✍️ Your answer (required):** Three small packages, each loadable on its own, that cover the paperwork side of an international trip, where the deadlines live.

1. **VisaSlot: consulate appointments.**
   - Find the competent consulate from the trip's nights per country (main destination; on a tie, first entry).
   - Search slots, whose availability changes on the clock; book, reschedule or cancel an appointment.
   - Read the required-document checklist.
   - Before the appointment, the agent registers the visa file on it: the details of the invitation letter, the travel signature, the accommodation and the travel dates, each with a reference to the record it was read from. It can replace the file until the appointment starts.
   - At the appointment time, VisaSlot checks the registered file against its rules: the name on the letter matches the passport, the letter was issued by then, the travel signature is valid through the return date, accommodation covers every night, and the consulate is competent for the trip. The result is `complete` or `refused` with the missing items.

   Infra events: `slot.released`, `slot.taken`, `appointment.cancelled_by_consulate`, `appointment.held`.
2. **ConfDesk: conference registration.**
   - A registration window opens and closes at set times. Registering takes two steps: a preview shows the author rate and what it covers, then a confirmation with a payment label registers and records the payment.
   - The paper is removed from the program if no author registers by the deadline.
   - A visa invitation letter is issued a set number of business days after registration, using the details on file. The data can contain errors.
   - A correction request has its own business-day turnaround.

   Notices go to Mail.
3. **Passage: university travel signature.**
   - Submit a travel-signature request; it is processed in a set number of business days.
   - The signature has an issue date and a validity period; the current I-20 signature lapses on a given date.

   Notices go to Mail.

**Why it matters.** These portals carry the deadlines that a personal agent misses when it only answers what it is asked: a letter that arrives misspelled, a registration window that opens later, a signature that lapses. Task [#49](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/49) depends on all three. Other study-abroad, conference-travel or visa-appointment tasks could reuse them.

## 3. Potential app connections

- **Internal personal apps (required):**
  - **Mail** (required for notices): ConfDesk and Passage publish confirmations, letters and status changes to Mail through Mail's existing receive contract ([`urn:pale:email-payload:1`](../../examples/apps/mail/schemas/email-payload.schema.json), `channel.email`). Mail is not modified.
  - **Files** (optional): the agent may save letters or checklists to Files with the existing Files tools.
  - **Calendar** (optional): the agent may add appointments with existing Calendar tools. No automatic writes.
  - **Contacts** (optional): the applicant is a bound person reference.
- **Other apps and websites (required):**
  - Airline bookings ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)) and hotel bookings reach the VisaSlot file only as details the agent registers, read with those Apps' own tools. No live cross-App reads in v1.
  - Employee travel expenses ([#42](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/42)) and Inkwell e-signatures ([#188](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/188)) are complementary. #42 files and reimburses the expenses of a trip such as this one (its main example is also a conference trip); #188 signs contracts. Neither books consulate appointments, registers authors or issues travel signatures, so one task can use them together with these portals.
  - Reminders ([#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191)) are unrelated in scope, but are used by the same task.

### Integration details

- **Operations and access (required):**
  - **VisaSlot agent tools:** `visaslot.competence(trip)`, `visaslot.slots(consulate, from, to)`, `visaslot.book(consulate, slot)`, `visaslot.reschedule`, `visaslot.cancel`, `visaslot.appointments()`, `visaslot.checklist(category)`, `visaslot.file.submit(appointment_id, documents)`, `visaslot.file.get(appointment_id)`.
  - **ConfDesk agent tools:** `confdesk.conference.get()`, `confdesk.register.preview(paper_id)`, `confdesk.register.confirm(preview_id, payment_label)`, `confdesk.registration.get()`, `confdesk.letter.get()`, `confdesk.letter.request_correction(fields)`, `confdesk.paper.status()`.
    - `register.preview` returns a single-use preview ID, the author rate and its currency, what the rate covers and when the preview expires. It changes nothing.
    - `register.confirm` registers the author and records the payment against the label. A preview that has expired, was already used, or no longer matches the rate or the window is rejected and nothing is recorded. A task that requires the user's approval before paying can check that the approval came between the two steps.
  - **Passage agent tools:** `passage.travel_signature.request()`, `passage.requests.list()`, `passage.documents.status()`.
  - **Infra (all three):** `env.load_seed`, `env.snapshot`, reset, `env.advance_time` and `env.apply_event`. Example events:
    - `slot.released`, `appointment.cancelled_by_consulate` and `appointment.held` (VisaSlot);
    - `registration.open`, `deadline.passed`, `letter.issue` and `correction.issue` (ConfDesk);
    - `request.processed` (Passage).
  - **GUI:** a small page per portal.
- **State and lifecycle (required):**
  - State is per App instance, account and run; seeds set the applicant, conference, consulates and slots, and reset restores them.
  - Due-date effects are applied by Infra events at their scheduled times. The Apps never self-schedule: each event carries the business-day calculation the task supplies, and the App validates it against its own rule.
  - Writes are idempotent per request ID with version checks.
  - **The VisaSlot visa file.** `visaslot.file.submit` registers the file on a booked appointment, replacing any earlier one, until the appointment starts. Each document carries the facts VisaSlot checks plus a `source` reference to the record the agent read it from. For example:

    ```json
    {"appointment_id": "appt-0331",
     "documents": {
       "invitation_letter": {"source": {"app_id": "confdesk", "object_type": "invitation_letter", "object_id": "letter-0388"},
                             "name_on_letter": "ZHAO Mingyu", "issued_on": "2027-03-26"},
       "travel_signature": {"source": {"app_id": "passage", "object_type": "travel_signature", "object_id": "sig-0142"},
                            "signed_on": "2027-02-15", "valid_until": "2028-02-15"},
       "accommodation": [{"country": "DE", "check_in": "2027-04-19", "check_out": "2027-04-25", "source": {"app_id": "task-hotel", "object_type": "reservation", "object_id": "H-5521"}},
                         {"country": "FR", "check_in": "2027-04-25", "check_out": "2027-04-30", "source": {"app_id": "task-hotel", "object_type": "reservation", "object_id": "H-5530"}}],
       "travel": {"enter_on": "2027-04-19", "leave_on": "2027-04-30"}}}
    ```

    A document dated after the submission time is rejected, since the agent cannot register a letter or signature that does not exist yet; a corrected letter is registered once it has arrived. The passport name comes from the seed, not from the agent. VisaSlot checks the registered facts only; it does not read ConfDesk, Passage, a hotel or an airline. The `source` references let a task compare what was registered with the source records when it grades. `visaslot.file.get` returns the registered file, its history, and the items that would be missing if the appointment were held now.
  - **The appointment check** is the Infra event `visaslot.appointment.held`. It names the consulate and slot, not an ID the agent created, and matches the appointment booked in that slot:

    ```json
    {"event_id": "held-de-chi-20270331-0900", "at": "2027-03-31T09:00:00-05:00",
     "operation": "visaslot.appointment.held",
     "payload": {"consulate_id": "de-chicago", "slot_at": "2027-03-31T09:00:00-05:00"}}
    ```

    It applies the rules at the appointment time, locks the file and records the result on the appointment. A refused file lists one entry per failed rule, for example for a file that registered the uncorrected letter and left a night uncovered:

    ```json
    {"appointment_id": "appt-0331", "held_at": "2027-03-31T09:00:00-05:00", "result": "refused",
     "missing": [
       {"item": "invitation_letter", "rule": "name_matches_passport", "expected": "ZHAO Mingyu", "found": "ZHOU Mingyu"},
       {"item": "accommodation", "rule": "covers_every_night", "nights": ["2027-04-27"]}]}
    ```

    The rules are `file_submitted`, `consulate_competent`, `name_matches_passport`, `letter_issued_by_appointment`, `signature_valid_through_return` and `covers_every_night`. A complete file gives `"result": "complete"` and `"missing": []`. If no appointment is booked in that slot, the event is recorded with `"result": "no_appointment"` and changes nothing else. Replaying the same event ID returns the original result.
- **Events and notifications (required):**
  - **Accepts:** the Infra events listed above.
  - **Sends:** Mail notices through `channel.email`, as CloudEvents whose `data` follows Mail's [`urn:pale:email-payload:1`](../../examples/apps/mail/schemas/email-payload.schema.json) unchanged. For example, the `data` of a ConfDesk invitation letter: `{"channel":"channel.email","recipient":{"kind":"app_account_ref","app_id":"mail","id":"mail-mingyu"},"source_object":{"app_id":"confdesk","account_id":"confdesk-mingyu","object_type":"invitation_letter","object_id":"letter-0388"},"content":{"title":"Your SCDA invitation letter","body":{"format":"text/plain","text":"Dear Mr. ZHOU Mingyu, ..."},"asset_ids":[]},"extensions":[]}`. The sender identity comes from the CloudEvent `source` and `source_object`, not a free-form address.
  - VisaSlot sends no mail in v1; appointments are read in the portal.
- **Shared data and dependencies (required):**
  - People are bound person references; the passport name is seed data, used for the name-match check.
  - Text-only in v1: letters are structured text, not PDFs.
  - Each package runs on its own with only the shared runtime (Core API 1.2.0, runtime 1.6.0). Mail is a run-assembly recipient, not a `required_apps` dependency.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Three packages under `apps/` (`visaslot`, `confdesk`, `passage`) following the personal-Apps layout: `tools.json` (9, 7 and 3 agent tools), plugins with the state machines, business-day arithmetic, Infra event handlers and small GUIs. | Business tests for every transition and its error cases, for example:<br>- competence ties;<br>- a slot taken between search and book;<br>- booking or rescheduling against stale versions;<br>- a registration preview that expired, was reused or no longer matches the window;<br>- registration before the window opens or after it closes;<br>- paper removal at the deadline;<br>- a letter issued with the seeded data;<br>- correction turnaround;<br>- a signature processed or lapsed;<br>- a visa file replaced before the appointment and rejected after it;<br>- an appointment held with a complete file, with each rule failing on its own, and with no file or no appointment. | 7–8 |
| Data and image collection | N/A. No external data or images; rules are paraphrased from the public pages listed in section 1. | Source notes for each paraphrased rule. | 0.5 |
| Synthetic data and assets | Example seed, with every history date on or after 2026-01-01: one applicant whose conference profile, created at paper submission on 2026-10-15, misspells the surname; one conference with one paper, accepted on 2027-01-20; 2 consulates with about 10 slots; and an I-20 travel signature issued on 2026-03-09 that lapses on 2027-03-09. Tasks load their own history, with their own dates, through `env.load_seed`. | Seeds validate; dates and IDs are consistent; reset restores them exactly. | 0.5 |
| App integrations | Publish to Mail through the existing receive contract, plus a cross-App example in `examples/workflows/trip-paperwork/`: preview and confirm a registration, issue a letter with the wrong name, request a correction, receive the corrected letter in Mail, register the visa file, then hold the appointment as complete. A second run registers the uncorrected letter and is refused with `name_matches_passport`. | Real MCP connections to Mail with receiver-side evidence (Mail records and receipts) and a rejected delivery for an unbound recipient. Mail state is otherwise untouched. | 1.5 |
| Validation and reset | `node runtime/cli.cjs verify --app apps/<id>` for each package, the business tests, the workflow example, and history-loading, reset and `env.advance_time` checks. | After implementation: exact App and runtime versions, commands and reports covering permissions (the agent cannot fire Infra events), state consistency, reset and the Mail integration. | 1.5 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams. The order is:
  1. ConfDesk, the highest value for #49.
  2. VisaSlot.
  3. Passage.
  4. The Mail workflow example.
  5. The validation report.

  v1 within 14 days of plan approval, per CONTRIBUTING. Dependencies: runtime 1.6.0, Core API 1.2.0 and Mail 1.3.0 (all available). Dependent task: #49.
- **Resources and total effort (required):** 11–12 person-days. No GPU, paid data or hosted services. Small JSON state; local stdio MCP only.
- **Scope boundary and open questions (required):**
  - **Excluded:** visa decisions, biometrics, fees actually charged, real consulate rules beyond the paraphrased checklist, payment processing (registration records "paid" against a payment label), PDFs and document images, and rail or flight booking.
  - **Open questions:**
    1. Is one proposal with three small packages acceptable, following the shared personal-Apps suite, or should each portal be its own proposal? *Answered in review:* yes, if each package has its own `app.json`, seed, reset and verification command; v1 covers the core flows of all three.
    2. Should VisaSlot's file check read flight and hotel bookings live from #69 or a hotel App, or take task-supplied references, as v1 does? *Answered in review:* no live reads; the agent reads other Apps with their own tools and registers the details on the visa file (above).
    3. Should business-day calendars, with holidays, be App-owned rules or task-supplied? *Answered in review:* the App owns the N-business-day rule, and the holiday table is seed data with a default. The event details follow during implementation.
- **License and external dependencies (required):** Original code under the repository's MIT license. Rules are paraphrased from public government and university pages; no text, logos or screenshots are copied. No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
