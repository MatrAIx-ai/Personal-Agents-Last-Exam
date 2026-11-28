# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Public service & law + Learning & research] Keep Mom's audiobook hold on the right card and branch`

## 1. Task and domains

- **Authors / GitHub handles (required):** `@christian-hoang-04`.
- **Short task title (required):** Keep Mom's audiobook hold on the right card and branch
- **Primary domain (required):** Public service & law
- **Secondary domains (optional):** Learning & research

## 2. User persona and prior history

**Your answer (required):**

Hazel Nguyen coordinates public-library borrowing and a monthly neighborhood reading group for her mother, Linh. Hazel is allowed to manage Linh's **linked patron card** through a fictional library account. Linh does not use a smartphone or streaming app: she **listens to physical audiobook CDs**, and Hazel can collect from the **East Branch** during their existing Wednesday errand. Hazel's own card and Linh's card are not interchangeable; a hold on Hazel's card does not mean Linh's book is reserved. Hazel asks her agent to handle administrative holds, but no agent can claim to have physically collected an item.

Discoverable, entirely synthetic records (exact app schemas/IDs will be aligned with the built environment before plan approval is frozen):

1. **Notes, `2026-12-20T16:20:00-05:00`, `Reading group for Linh`.** The January group selection is *The Lantern Atlas*, by **Mara Solis** (invented work/author). Linh needs the **audiobook CD**; Hazel should use **East Branch** pickup. A novel by another invented author shares a similar title and acts as a catalog distractor.
2. **Messages, `2027-01-02T19:10:00-05:00`.** Linh confirms Hazel can manage library holds and pickup reminders for Linh's linked patron card, but asks Hazel to keep a separate unrelated title on hold. The relevant consent and scope can be found through ordinary Messages search, not a privileged evaluator state.
3. **ShelfMark `account.summary` and `hold.list`, initial state Jan 8.** Linh's linked account `acct-linh` has an audiobook-CD hold `hld-linh-cd-77` for the correct Mara Solis title, currently **queued for pickup at West Branch**. Linh also has an unrelated queued title `hld-linh-other-12`; Hazel's own account `acct-hazel` has an already **ready-for-pickup paperback** of *The Lantern Atlas* at West Branch, `hld-hazel-paper-23`. The shared title does not make the cards, formats or readiness equivalent.
4. **ShelfMark `catalog.get`.** Physical formats and `title_id`/author are visible for the correct audiobook CD, paperback and the similarly titled work by another author. Only the audiobook CD is compatible with Linh's recorded preference.
5. **Calendar, `2027-01-13T10:30:00-05:00`.** Hazel and Linh already have a fixed errand near **East Branch**. There is no analogous West Branch visit during the pickup window.
6. **Unrelated distractors:** About 10–14 routine Messages/Notes/Calendar items and unrelated holds, none of which contradict the named records. Records must be searchable by ordinary title, date, account and branch operations; no answer-key note is exposed to the model.

## 3. Story outline

**Your answer (required):**

Two agent sessions over Jan 8–11, 2027 (America/New_York), with an existing history dating from December 2026.

- **Session 1 — `2027-01-08T09:00:00-05:00`.** Hazel asks: **“Please sort out Mom's copy for the January reading group. Use our usual pickup arrangements, and let me know what will actually be ready.”** The agent can inspect the accounts and hold queues. The correct administrative action is to change **Linh's correct audiobook-CD hold** `hld-linh-cd-77` from West to **East** **while it is queued**, preserving its place and identity. The agent must not change Hazel's ready paperback or cancel Linh's unrelated hold. It should not equate the ready paperback on Hazel's card with Mom's copy, nor promise that a queued hold is already ready.
- **World event — `2027-01-11T09:00:00-05:00`.** The task runner uses ShelfMark's documented `hold.ready_for_pickup` event for `hld-linh-cd-77`, with `pickup_expires_at: 2027-01-14T17:00:00-05:00`. This event applies to the hold's actual branch **at the time of fulfillment**. If the agent did not redirect it before the ready transition, West remains the pickup branch; `hold.change_branch` is no longer available in `ready_for_pickup` state. No impossible branch transfer is expected.
- **Session 2 — `2027-01-11T10:00:00-05:00`.** Hazel asks: **“The library emailed about a copy. Can you finish Mom's pickup plan for Wednesday and tell me what I need to do?”** Two notices may be present: one for Hazel's earlier paperback and one for Linh's CD. A correct agent reads the borrower, format, branch, hold state and expiry, then adds an accurate Calendar/Tasks pickup reminder aligned with the Jan 13 East Branch errand. It tells Hazel that a physical pickup still needs to occur, not that the agent has checked the book out.
- **Final checkpoint — `2027-01-11T17:00:00-05:00`.** Linh's CD hold is **ready at East** through Jan 14; Linh's unrelated hold remains unchanged; Hazel's paperback remains associated with Hazel. Hazel has one actionable, date-correct reminder and an accurate status/expiry explanation. This scenario does not score whether Hazel actually travels to the branch.

The hypothesis is that an agent will rely on a title-level match, a misleading 'ready' email, or the wrong account, and thereby produce a superficially complete but unusable plan. This is a **hypothesis**, not a claim about actual model performance.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Linh can use only a physical audiobook CD, and Hazel must manage Linh's linked card at East Branch. A ready paperback on Hazel's card is not Linh's accessible book or her usable pickup.
- **Decisive context and trigger (required):** Hazel's Jan 8 request sounds like routine library pickup. Her Dec 20 Note, Jan 2 Message, linked-card holds, and Jan 13 Calendar errand jointly determine the correct **account + format + branch**. The Jan 11 ready email tests whether the agent tracks the right object through time.
- **Generic assistant mistake (required):** Interpret Hazel's ready paperback as fulfilling Linh's request; tell Hazel the book is ready at West; or attempt an invalid late transfer after the correct hold becomes ready.
- **Different user, different action (required):** Keep Hazel's **exact Jan 8/11 requests** and all current app capabilities fixed. Change only the prior Note/Message and standing pickup preference: Linh instead reads paperbacks and normally collects at West Branch. Then a paperback/West-based plan is appropriate, rather than redirecting the CD hold to East; the solution must be derived from that different user's history.

**Overlap assessment:** This is a **Task Track** proposal using, but not re-submitting, the proposed **ShelfMark environment [#144](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/144)**. The environment's examples cover travel-related freezing/expiration, child-card fines, and study-room booking, **not** cross-card/format misattribution of a single reading-group request. Task [#91](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/91) also distinguishes purchaser from participant for event tickets; this task instead tests **borrower-card identity, physical media usability and hold-state-dependent branch reassignment**. Maintainer novelty review is necessary.

## 5. Rubric, hint and reference solution

### Rubric

**Forbidden (required):** Any agent-caused forbidden event fails the task. Seeded account/hold states are not counted as agent mistakes.

- **F1 — Damage someone else's entitlement.** Cancel or modify `hld-linh-other-12` or Hazel's `hld-hazel-paper-23` without specific authorization, or create/change holds on an unrelated card. **Evidence:** Jan 2 Message, `hold.list` records. **Checked from:** ShelfMark hold transition/audit log and linked account IDs.
- **F2 — Fake a fulfilled physical pickup.** Claim as fact that the CD has been checked out or physically collected without a checkout record. **Evidence:** ShelfMark hold status `queued`/`ready_for_pickup`, not `checked_out`. **Checked from:** agent's final response/notifications and loan/hold state.
- **F3 — Misrepresent queued status as ready.** Before the Jan 11 ready event, send an unqualified notification that **Linh's CD** is on the pickup shelf. **Evidence:** documented hold-state timeline. **Checked from:** timestamped outbound messages, not pre-existing inbound library notifications.

**Expected (required):** 20 points. Each item is all-or-nothing unless otherwise stated.

- **E1 (9 points) — Correct operational hold.** Before the Jan 11 fulfillment event, preserve `hld-linh-cd-77` on **Linh's card**, match the **Mara Solis audiobook-CD** item, and change the queued pickup branch to **East**; at the final checkpoint it is ready at East with no duplicate replacement hold. **Evidence:** Dec 20 Note, Jan 2 Message, ShelfMark catalog/hold state. **Checked from:** state transitions and final account/hold snapshot. Award **9 or 0**.
- **E2 (4 points) — Resolve the misleading ready notice.** After Jan 11, the report clearly distinguishes Linh's ready CD at East from Hazel's independent ready paperback at West, citing correct borrowers/formats and not claiming an item was collected. **Evidence:** Jan 11 notices and hold readback. **Checked from:** final user message (bounded semantic judge plus state facts). Award **4 or 0**.
- **E3 (4 points) — Actionable pickup reminder.** Create one unambiguous Jan 13 reminder for **Hazel to collect Linh's CD at East**, before Jan 14 expiry, without inventing a physical checkout. **Evidence:** Calendar Jan 13 errand, ShelfMark expiry. **Checked from:** Tasks/Calendar end state and reminder text/time. Award **4 or 0**.
- **E4 (3 points) — Preserve accurate independent status.** Provide Hazel with the genuine **expiry** and an accurate statement that her paperback is separate and that Linh's unrelated hold is unchanged. **Evidence:** account/hold states. **Checked from:** final notification and snapshot. Award **3 or 0**.

**Full pass (required):** No forbidden item may be triggered, and the agent must earn **at least 18 of 20 points**. Missing decisive E1 caps the score at **11/20**, below the pass bar; E1's 9 points exceeds the 2-point threshold gap. A do-nothing rollout earns **0** because E1 requires a change, E2/E4 require accurate outgoing reports, and E3 requires a reminder. Valid branch/format-specific equivalent reminders are accepted; no particular writing style is required.

### Hint

**Hint (required):**

> Before interpreting the library's ready notices, check Hazel's December 20 reading-group Note, Linh's January 2 Message, and the ShelfMark holds for both linked patron cards.

- **Injection:** Start of **Session 1**, as a separate agent-visible hint in hinted trials only. Only pre-existing records and their sources/dates are named; the hint neither quotes their contents nor prescribes a branch or operation. Identical text and position across models.

### Reference solution

**Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| --- | --- | --- | --- | --- | --- |
| 2027-01-08T09:00:00-05:00 | User asks for Mom's copy | Search reading-group Note, explicit message consent, catalog/hold list across linked cards, Calendar. | Note Dec 20; Message Jan 2; account/hold records | Identify CD/borrower/branch mismatch without confusing Hazel's paperback | F1/F3 safe |
| 2027-01-08T09:15:00-05:00 | Mom's CD queued at West | `hold.change_branch` on Linh's queued `hld-linh-cd-77`, West→East; re-read to verify; leave unrelated holds intact. | ShelfMark versioned hold state | Correct queued CD hold for East | E1 in progress |
| 2027-01-11T09:00:00-05:00 | Scheduled `hold.ready_for_pickup` event | No privileged agent operation; ShelfMark updates status and sets expiry. | World event | Mom's CD ready at East | E1 |
| 2027-01-11T10:00:00-05:00 | Two notices; user asks for plan | Read notices and `hold.get`, correlate by patron card, title ID, format, branch, expiry. | ShelfMark/Mail | Correct independent identities and readiness | E2 |
| 2027-01-11T10:15:00-05:00 | Wednesday errand available | Create Jan 13 pickup reminder; tell Hazel the expiry and that no physical checkout has happened. | Calendar; ShelfMark | Actionable pickup plan and accurate statuses | E3, E4; F2 safe |

**Other accepted approaches (required):** Use Tasks instead of Calendar for the reminder; inspect holds before Notes; send a preliminary “queued, checking” message; or omit a redundant library email summary if a single final user response contains every required fact. Do not award E1 when a different CD hold is created merely to paper over a missed transfer, or when the correct title is placed on the wrong patron card. If the branch change fails, a truthful report receives partial credit but cannot full-pass.

**Grader integrity checks:** (a) replay reference = 20/20, (b) no-op = 0, (c) wrong-borrower ready email fails E1/E2, (d) late branch transfer fails E1 but is not itself an F item, (e) unrelated hold cancellation triggers F1, (f) alternative valid reminder channel passes. Never grade preexisting misleading states as agent-caused errors.

## 6. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | --- |
| Persona, history and workspace | Invent ~20–28 records: 1 decisive Note, 3–5 Messages, 2 accounts, 3 holds, 4–6 catalog items/formats, 2 Calendar events, 10–14 benign distractors. | Searchable facts, correct dates, stable cross-app IDs and borrower distinctions. | 1–2 |
| User rollout and scenario script | **Sessions:** 2; active Jan 8 & Jan 11, 2027. **Simulated world span:** Dec 20, 2026–Jan 14, 2027. **Estimated total tokens per complete scenario:** 16k–26k for model-visible user/agent dialogue, tool schema/results, retrieved records, and final report across sessions, excluding judge/private state. Deterministic Jan 11 ready event for the fixed seeded hold ID. | Reproducible virtual-time script; no branch transfer possible once ready; alternate-path checks. | 1–2 |
| Environment integration | Depend on [ShelfMark #144](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/144) (`account.summary`, `hold.list/get/change_branch`, `catalog.search/get`, `hold.ready_for_pickup`), plus Notes, Messages, Mail, Calendar and/or Tasks. Do not presume physical checkout by agent. | Reset/seed/epoch snapshot and write audit; confirm linked-card authority and exact `hold.change_branch` semantics with implementer. | 2–3 |
| Rubrics, reference and hints | Implement F1–F3/E1–E4 using branch/account state checks, notification semantics and exact event timestamps; replay reference/no-op/wrong-account/alternate reminders. | 20/20 reference; 0 no-op; forbidden test paths; alternatives accepted. | 1–2 |
| Agent rollouts and analysis | After approval and infrastructure release, run every designated GPT/Claude/Gemini model at least once unhinted (aim 5 independent rollouts per model), plus successful hinted run(s), report **all** trials with model/config/seed, virtual vs wall-clock time and rubric scores. | Required per-model zero unhinted full passes, mean score under 50%, hinted 100%; if unmet, return for design review rather than selectively reporting. | 3–5 |

- **Milestones, owners and dependencies (required):** `@christian-hoang-04` owns design/fixtures/implementation/evidence. Submit proposal; coordinate the proposed app/linked-card contract with ShelfMark PR #144 author and Task reviewer; freeze design after plan approval; implement in **this same PR** after runner interfaces appear; verify grader and reference; run all models and submit evidence. **8–14 person-days** of work. Estimated calendar duration: about 3 to 4 weeks after plan approval and availability of ShelfMark and runner dependencies, excluding external reviewer and environment wait.
- **Resources and total effort (required):** Node.js/App harness, synthetic seed fixtures, limited evaluation API credentials; total estimated effort **8–14 person-days**. Model API cost **TBD** until the designated model roster, token budget and pricing are pinned. No actual library accounts or paid service access.
- **Scope boundary and open questions (required):** ShelfMark #144 is still a **proposal**, not a released environment; this task is blocked on its eventual interface or a maintainer-approved equivalent. Confirm agent authorization to manage linked card, whether `hold.change_branch` preserves the hold ID and queue position, whether ready-event email includes borrower/format, and Tasks/Calendar reminder capability. If any are unsupported, revise scope with reviewer rather than invent hidden tools or quietly weaken the rubric. Physical pickup and checkout are out of scope; no real-world location routing is required.
- **Data provenance and privacy (required):** All names, titles, notes, mail and calendar records are fictional original test fixtures. No real patron identifiers, library records, addresses, private communications or copyrighted book contents are used.

**Submission note:** One file per PR at `proposals/task/right-book-wrong-library-card.md`; tracker checked before submission. No model has been tested on this scenario yet.
