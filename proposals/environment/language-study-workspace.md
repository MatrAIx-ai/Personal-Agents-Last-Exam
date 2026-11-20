# Environment Track proposal

**PR title:** `[Environment Proposal] [Learning & research] Language Study Workspace`

## 1. App and domains

- **Authors / GitHub handles (required):** @2018cx
- **Reference app or website / URL (required):** Anki, https://docs.ankiweb.net/manual/studying, as an interaction reference for decks, answer reveal and review history. This independently branded simulator does not reproduce Anki's scheduler or import its code, branding or decks.
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None.

## 2. What you plan to build

**✍️ Your answer (required):** A language-study workspace connecting editable vocabulary cards, a personal study plan and an auditable review schedule. Five complete workflows cover preparation through follow-up:

1. Create and edit text-only cards, organize them into decks, and suspend or restore a card without deleting its review history.
2. Select decks, target date, daily review limit and new-card limit; preview the resulting workload, then save or discard the plan.
3. Open the due queue, reveal an answer and record a learner-provided Again or Good rating; pause and resume without losing the session position.
4. Inspect history, undo the latest eligible review, correct a card and resume against its current version without duplicate counts.
5. Compare remaining cards and due work with the current plan; revise it after a changed target date or report that the requested coverage exceeds the available daily slots.

The agent manages the learner's workflow, never invents recall ratings or claims proficiency. Ratings come from explicit user input or scenario-controlled synthetic learner responses. A changed deadline must not justify silently increasing a remembered daily limit. A corrected card must not erase earlier activity or permit submitting an already-open obsolete answer form.

Scheduling is synthetic and deterministic. Each card starts at stage zero. Good advances the stage up to three and schedules the next review after 1, 3 or 7 simulated days respectively; Again resets stage zero and schedules tomorrow. One effective review per card per simulated day is allowed. Due cards precede new cards, ordered by due date then stable ID. The daily review limit includes both; the new-card limit additionally bounds first reviews. Suspension excludes a card without changing its history or due date. A target date changes plan projections, not historical results or due dates. These are test rules, not an educational efficacy claim.

Unlike research-record organization in #4, provenance reporting in #34 general routine adaptation in #29 or [Milepost #70](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/70) skill and prerequisite planning, correctness here depends on card-level recall inputs, undo semantics, content versions and conserved daily capacity across sessions.

## 3. Potential app connections

- **Internal personal apps (required):** None. Study dates and notifications remain inside this app; no Mail, Calendar or Contacts connection.
- **Other apps and websites (required):** None. Anki is only a public workflow reference, not a runtime dependency.

### Integration details

- **Operations and access (required):** Use the [business Web Host](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/runtime/web/README.md) and [Core runtime](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/runtime/core/runtime.cjs) at main `61b6371` (public runtime 1.6.0, Core API 1.2.0). App-owned deck, plan, queue and history pages call the fixed Agent MCP connection; both paths use the same run/account state. Learner and authorized Agent use business operations; observer reads only; Infra alone seeds, advances time, injects events, snapshots and resets. No extra generic bridge is proposed. Names below are App proposals, not shipped APIs.

  | Workflow / proposed calls | Input and committed read-back |
  | :--- | :--- |
  | Cards: `study.list_cards`, `study.get_card` (read); `study.save_card`, `study.set_suspension` (write) | Read by deck/card; write fields or suspension with request ID and expected version; verify same card ID, version and history. |
  | Plan: `study.preview_plan` (read), `study.save_plan` (write) | Decks, target and remembered capacity produce projected workload; only explicit save returns plan ID/version. Discard sends no write. |
  | Session: `study.get_queue`, `study.reveal` (read); `study.set_session`, `study.record_review` (write) | Persist pause/resume cursor; a learner-provided Again/Good and card version commit one ledger entry, due date and count. No invented ratings. |
  | History/correction: `study.get_history` (read); `study.undo_review`, `study.save_card` (write) | Undo uses latest eligible review ID and releases one slot; correction keeps ledger and rejects obsolete forms; read back ledger/card. |
  | Capacity: `study.get_capacity`, `study.preview_plan` (read), `study.save_plan` (write) | Report available and missing slots using remembered limits; revise only on confirmed save with matching version. |

- **State and lifecycle (required):** Study owns seeded cards, plans, review ledger, session cursor and day-derived business state in one isolated run/account. UI and Agent re-read the authoritative App record after writes. Use Core request IDs and expected versions; successful calls return object ID and version. Exact retries return the prior receipt without duplicating state, and conflicting/stale/denied calls leave business data unchanged. Cancel operates on uncommitted UI state. Undo reverses only the latest eligible effective review, retains its audit entry and restores stage, due date and daily slot once. Infra `env.reset` restores the seeded App business state and virtual clock; compare business fields only because epoch, receipts and audit change. The task harness owns its session/event cursor. Snapshot is evidence, not restore.
- **Events and notifications (required):** Seed study day 0 at 2027-01-08T00:00:00+08:00 using a fixed UTC+08:00 calendar; use elapsed local calendar days from that date, derived from `ctx.virtual_now`. Tasks/Infra choose session times, call `env.advance_time` or inject event envelopes and synchronize enabled Apps. A time change does not fire timers or record reviews. Reopening on the same day retains the same ledger/capacity; skipping days creates no phantom ledger entries and overdue cards remain due.

  ```json
  {"event_id":"deadline-01","at":"2027-01-09T09:00:00+08:00","operation":"study.change_target","payload":{"plan_id":"P1","expected_revision":2,"target_day":9}}
  {"event_id":"correction-01","at":"2027-01-09T09:15:00+08:00","operation":"study.correct_card","payload":{"card_id":"C12","expected_revision":4,"answer":"revised answer"}}
  ```

  The first event changes projections without changing limits, historical reviews or due dates. The second increments content version, keeps the ledger and invalidates open old-version forms. Replay of an accepted event ID has no second effect; unknown objects, stale versions and invalid payloads reject without committing data. In-app notices identify the source object and change; nothing is sent outside the App.
- **Shared data and dependencies (required):** Stable synthetic account, deck, card, plan, review and event IDs; UTF-8 structured fixtures, fixed local-day mapping above and pinned public Core/Web Host. No private real learner data, attachments, external accounts or personal-App dependency.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Four views: decks/cards, plan, review queue, history; five workflows and deterministic scheduling | Completed and aborted plans; pause/resume; suspension, correction and safe undo | 3 |
| Data and image collection | Reference documentation only; no crawling, imported decks or images | Source/reuse note; no bundled third-party content | 0.25 |
| Synthetic data and assets | Three decks, 36 original cards, two permission fixtures, seeded review histories and six scenarios | Checked text pairs, unique IDs, valid stages/dates and consistent ledger totals | 0.75 |
| App integrations | Local platform-facing setup/reset/event boundary only; no external apps | GUI/action consistency and rejected observer writes; pinned Core/Web Host mapping and authoritative read-back | 0.75 |
| Validation and reset | Happy path, plan abort, daily limits, duplicate rating/undo, stale correction, changed deadline and permission failure | Local tests and expected-state fixtures for platform validation; reproducible snapshots and repeated business-state reset equality | 1.75 |

Planned acceptance uses local business tests for schedule and ledger invariants, then public Agent calls and the App GUI at the pinned runtime version. Match read-back by run/account, object ID and revision; record expected persisted state and non-mutation on denial. Exact run commands and evidence will be supplied at delivery, not claimed here.

| Workflow | Success and control evidence |
| :--- | :--- |
| Cards | Edit and suspend/restore one card; Agent reads new version, unchanged ledger, correct due-queue visibility. Observer write leaves prior card intact. |
| Plan | Preview/discard leaves prior plan and revision; confirmed save appears in GUI and direct Agent read-back; stale save leaves it unchanged. |
| Review session | Persist pause/resume cursor, then authorized explicit rating changes stage, due day and ledger exactly once; duplicate/stale rating does not consume a slot. |
| Undo/correction | Undo restores due day and releases capacity once; correction preserves history and denies submission from the old-version form. |
| Changed target/capacity | Inject deadline event and verify projection and notice; impossible target reports missing slots without raising daily cap or touching history. |

Infra scenarios use `env.load_seed`, `env.apply_event`, `env.advance_time`, `env.snapshot` and `env.reset`. Include event replays, boundary/skipped-day reads and repeat reset equality on seeded business fields (exclude epoch, receipts and audit). No implementation or validation runs have been completed.

- **Milestones, owners and dependencies (required):** This remains a design-only proposal until an implementation owner and separate maintenance arrangements are agreed. Proposed first runnable slice for the 14-calendar-day window after first formal plan approval: standalone seeded cards and plan, queue, explicit rating and history on public Core, with reproducible load/read/write/reset. Follow-on milestones: full UI parity, correction and undo controls, deadline/capacity scenarios and final validation. This proposal does not make a staffing, maintenance or delivery commitment. Related #4, #29, #34 and #70 are scope comparisons, not dependencies.
- **Resources and total effort (required):** Nonbinding sizing: 6.5 person-days. Expected local resources: two CPU cores, 2 GB RAM and under 100 MB of fixtures; no paid collection, model generation or runtime services. Actual implementation resources require separate agreement.
- **Scope boundary and open questions (required):** Complete text-card study loop only. No audio, automatic translation, generated tutoring, grading inference, proficiency certification, social sharing, purchases or live synchronization. Review concurrency and adapter details require design agreement. Next step is design review, not implementation.
- **License and external dependencies (required):** Tentative MIT for any future original code and synthetic fixtures, subject to contributor approval and dependency-license review before implementation. Assets would be locally redistributable; none hosted separately. No external runtime service. Dependency versions and notices are TBD; this proposal makes no new licensing commitment.
