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
   - At the appointment time, the file is checked for completeness: names must match the passport, the invitation letter must be in hand, the travel signature must be valid, and accommodation must cover every night.

   Infra events: `slot.released`, `slot.taken`, `appointment.cancelled_by_consulate`.
2. **ConfDesk: conference registration.**
   - A registration window opens and closes at set times; registering pays the author rate.
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
  - Airline bookings ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)) and hotel bookings appear in the VisaSlot file check only as references the task supplies, recording dates and countries. No live cross-App reads in v1.
  - Reminders ([#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191)) are unrelated in scope, but are used by the same task.

### Integration details

- **Operations and access (required):**
  - **VisaSlot agent tools:** `visaslot.competence(trip)`, `visaslot.slots(consulate, from, to)`, `visaslot.book(consulate, slot)`, `visaslot.reschedule`, `visaslot.cancel`, `visaslot.appointments()`, `visaslot.checklist(category)`.
  - **ConfDesk agent tools:** `confdesk.conference.get()`, `confdesk.register(paper_id, pay)`, `confdesk.registration.get()`, `confdesk.letter.get()`, `confdesk.letter.request_correction(fields)`, `confdesk.paper.status()`.
  - **Passage agent tools:** `passage.travel_signature.request()`, `passage.requests.list()`, `passage.documents.status()`.
  - **Infra (all three):** `env.load_seed`, `env.snapshot`, reset, `env.advance_time` and `env.apply_event`. Example events:
    - `slot.released` and `appointment.cancelled_by_consulate` (VisaSlot);
    - `registration.open`, `deadline.passed`, `letter.issue` and `correction.issue` (ConfDesk);
    - `request.processed` (Passage).
  - **GUI:** a small page per portal.
- **State and lifecycle (required):**
  - State is per App instance, account and run; seeds set the applicant, conference, consulates and slots, and reset restores them.
  - Due-date effects are applied by Infra events at their scheduled times. The Apps never self-schedule: each event carries the business-day calculation the task supplies, and the App validates it against its own rule.
  - Writes are idempotent per request ID with version checks.
  - The VisaSlot appointment check is an Infra event, `appointment.held`, that records `complete` or `refused` with the missing items.
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
| Web / app construction | Three packages under `apps/` (`visaslot`, `confdesk`, `passage`) following the personal-Apps layout: `tools.json` (7, 6 and 3 agent tools), plugins with the state machines, business-day arithmetic, Infra event handlers and small GUIs. | Business tests for every transition and its error cases, for example:<br>- competence ties;<br>- a slot taken between search and book;<br>- booking or rescheduling against stale versions;<br>- registration before the window opens or after it closes;<br>- paper removal at the deadline;<br>- a letter issued with the seeded data;<br>- correction turnaround;<br>- a signature processed or lapsed;<br>- an appointment held with complete and incomplete files. | 6–7 |
| Data and image collection | N/A. No external data or images; rules are paraphrased from the public pages listed in section 1. | Source notes for each paraphrased rule. | 0.5 |
| Synthetic data and assets | Example seed: one applicant (with a deliberately misspelled conference profile), one conference with one paper, 2 consulates with about 10 slots, and one I-20 signature date. | Seeds validate; dates and IDs are consistent; reset restores them exactly. | 0.5 |
| App integrations | Publish to Mail through the existing receive contract, plus a cross-App example in `examples/workflows/trip-paperwork/`: register, issue a letter with the wrong name, request a correction, receive the corrected letter in Mail, then hold the appointment as complete. | Real MCP connections to Mail with receiver-side evidence (Mail records and receipts) and a rejected delivery for an unbound recipient. Mail state is otherwise untouched. | 1.5 |
| Validation and reset | `node runtime/cli.cjs verify --app apps/<id>` for each package, the business tests, the workflow example, and history-loading, reset and `env.advance_time` checks. | After implementation: exact App and runtime versions, commands and reports covering permissions (the agent cannot fire Infra events), state consistency, reset and the Mail integration. | 1.5 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams. The order is:
  1. ConfDesk, the highest value for #49.
  2. VisaSlot.
  3. Passage.
  4. The Mail workflow example.
  5. The validation report.

  v1 within 14 days of plan approval, per CONTRIBUTING. Dependencies: runtime 1.6.0, Core API 1.2.0 and Mail 1.3.0 (all available). Dependent task: #49.
- **Resources and total effort (required):** 10–11 person-days. No GPU, paid data or hosted services. Small JSON state; local stdio MCP only.
- **Scope boundary and open questions (required):**
  - **Excluded:** visa decisions, biometrics, fees actually charged, real consulate rules beyond the paraphrased checklist, payment processing (registration records "paid" against a payment label), PDFs and document images, and rail or flight booking.
  - **Open questions:**
    1. Is one proposal with three small packages acceptable, following the shared personal-Apps suite, or should each portal be its own proposal?
    2. Should VisaSlot's file check read flight and hotel bookings live from #69 or a hotel App, or take task-supplied references, as v1 does?
    3. Should business-day calendars, with holidays, be App-owned rules or task-supplied?

    These will be settled in design review.
- **License and external dependencies (required):** Original code under the repository's MIT license. Rules are paraphrased from public government and university pages; no text, logos or screenshots are copied. No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
