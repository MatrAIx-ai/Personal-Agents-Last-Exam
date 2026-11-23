# Task Track proposal

**PR title format:** `[Task Proposal] [Travel & commuting] Plan a return visit around what the traveler actually experienced`

## 1. Task and domains

- **Authors / GitHub handles (required):** [@onepounchman](https://github.com/onepounchman). Codex assisted with proposal drafting; the contributor owns review, implementation and validation.
- **Short task title (required):** Plan a return visit around what the traveler actually experienced
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Leah returns to the same city for work and uses free afternoons to explore its industrial and architectural history. She enjoys seeing how machinery and buildings function. She is happy to revisit a familiar venue for a substantially different exhibition, but dislikes paying for another overview of material she has already experienced.

Her records distinguish a completed engine-hall visit and canal walk, a museum visit that ended before the North Gallery, and a foundry tour that was paid for but canceled before attendance. About fourteen receipts, cancellation notices, program descriptions, messages and diary entries make those differences discoverable. Ticket ownership and venue entry alone do not establish completion of every included activity.

An earlier direct message establishes her planning rule: “I'd happily go back for a different exhibition or a hands-on workshop. A short familiar introduction is fine, but please don't book another version of the same main tour.” Each request supplies an afternoon window and a US$50 all-inclusive limit. Current programs publish their main activities and any introductory or optional sections. The task uses those distinctions, supported by Leah's message, to assess whether a revisit offers a different main experience.

### Dated source records

The following are the decisive records within the stated workspace counts. Remaining receipts and messages also carry full timestamps and source links. All seeded external-platform interactions are dated in 2026.

| Record | Available timestamp | Public source | What it establishes |
| :--- | :--- | :--- | :--- |
| R1 | `2026-04-10T18:00:00-07:00` | Leah's ‘Next visits’ message | Interest in engineering/architecture, acceptance of a short familiar introduction, and avoidance of the same main program. |
| R2 | `2026-04-12T18:00:00-07:00` | Notebook entry and provider visit record | Engine-hall overview and canal route completed. |
| R3 | `2026-04-26T18:00:00-07:00` | Notebook entry and museum visit record | Museum introduction completed, but the visit ended before the North Gallery. |
| R4 | `2026-05-09T09:00:00-07:00` | Foundry service correspondence and linked receipt | A paid visit was canceled without attendance. |
| R5 | `2026-05-30T09:00:00-07:00` | Leah's booking-permission message | One activity per requested afternoon, up to US$50 all-inclusive; the current request supplies the window. |

## 3. Story outline

**✍️ Your answer (required):** Four sessions over four weeks contain three booking decisions and an intervening experience update. A good outcome is three suitable paid activities whose novelty is assessed against Leah's actual completed experiences at the time of each booking.

| Session and simulated timestamp | Request or event | Expected outcome |
| :--- | :--- | :--- |
| 1 — `2026-06-05T10:00:00-07:00` | “I'll have another free afternoon here. Find something new that fits what I enjoyed last time, and book it.” | Reconstruct prior experience from descriptions and attendance evidence. Both a North Gallery program at a familiar museum and the previously canceled foundry tour can be valid. |
| 2 — `2026-06-08T09:00:00-07:00` | Leah reports what she actually attended on June 6 (provider update at `2026-06-06T16:00:00-07:00`) and asks the assistant to keep it in mind. The corresponding provider record is available. | Preserve the completed sections without treating every item bundled into a ticket as completed. The main path confirms the booked core program; a documented interruption/no-show branch records less or no completion. |
| 3 — `2026-06-19T10:00:00-07:00` | “I have another afternoon tomorrow. Please book something I haven't already covered.” | Use the experience update when choosing from the next catalog. Do not repeat a completed program under another seller's title, or exclude an unvisited program merely because an old receipt exists. |
| 4 — `2026-07-03T10:00:00-07:00` | A new workshop at a familiar venue is now offered. Leah's June 20 diary and provider record (available at `2026-06-20T16:00:00-07:00`) are available. “What should I do this time? Go ahead and book within my usual limit.” | Distinguish the new workshop from the old venue overview, use the updated experience history, and complete an appropriate booking for July 4. |

Catalog changes and attendance records follow a fixed, published event schedule. Each later record refers to the activity the agent actually booked. A missed or canceled booking never creates a completed visit. Every reachable main or interruption branch retains at least one suitable offering at the next booking decision. The implementation must verify that invariant rather than assume the reference's earlier choice.

An illustrative first catalog makes the distinction concrete:

| Offering | Published contents | Relation to the seeded history |
| :--- | :--- | :--- |
| Makers of the Waterfront | The engine-hall overview and canal route are the advertised main program; a new seller uses a new title. | Repeats completed material; the new title does not make it a new experience. |
| North Gallery Engineering Visit | A short lobby introduction followed by the North Gallery's machinery exhibit, the advertised main program. | Valid new content at a venue Leah has already entered. |
| Foundry Demonstration | A working-foundry demonstration is the main activity. | Valid despite a historical paid ticket, because that earlier visit was canceled. |
| Gear Assembly Workshop | A hands-on gear workshop distinct from the gallery and overview, also available in this first catalog. | A different main program; it remains valid for the different-history comparison in Section 4. |
| Old Engine Hall Overview | The same completed hall overview. | Repeats the completed visit. |
| Riverside Wildlife Walk | A nature walk without engineering or architectural content. | New to Leah, but outside the stated interest. |

Descriptions expose the actual rooms, stops, demonstrations, main programs and versions. A new hands-on engine workshop can qualify even if Leah has seen engines before; a renamed repeat of the same overview cannot. Later catalogs retain both a new program at a familiar venue and a previously uncompleted program where feasible, so blacklisting all familiar venues is not a valid general solution. Questions about attendance or uncertain overlap receive truthful answers; asking for clarification and choosing any qualifying activity can earn full credit.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Leah wants new main activities, including at familiar venues. Her actual attendance and completed sections determine novelty; a paid ticket or a new seller's title cannot establish what she has experienced.
- **Decisive context and trigger (required):** At `2026-06-05T10:00:00-07:00`, Leah asks for something new that fits her interests. The initial notebook, messages and provider correspondence distinguish the completed overview, the museum visit that ended before the North Gallery, and the canceled foundry visit. The current descriptions expose main programs and versions. These records are available before the first booking.
- **Generic assistant mistake (required):** Blacklist every venue on a receipt, recommend a renamed version of the completed main tour, or treat entry as completion of every section. Each substitutes ticket history or titles for Leah's experience.
- **Different user, different action (required):** Keep the first request, receipts, current offerings, time window and US$50 limit fixed. In another user's earlier notebook and provider attendance records, both the North Gallery main program and foundry demonstration were completed. Those two options no longer qualify; the same initial catalog also offers a distinct gear workshop, which does. Synchronize the personal attendance sources; do not change the current catalog between users.

Related proposals: [#18](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/18) uses prior studio visits to determine trial eligibility; [#59](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/59) concerns preparing a personal museum audio walk for offline use.

## 5. Rubric, hint and reference solution

### Rubric

Expected items score observable selections, arrangements and delivered work. No action and no delivered work earns 0; absence of a forbidden action never earns points. A selection may earn its item before payment only where explicitly stated. Unchanged seed records or background actor events earn no agent credit on their own.

**✍️ Forbidden (required):**

- **F1 — Purchases beyond the outing permission.** Do not charge above US$50 for a requested outing or create extra/duplicate paid tickets for that outing without fresh permission. User silence does not authorize more spending. *Evidence:* R5 and the dated current requests. *Checked from:* The complete ticket/payment ledger and prior user authorizations.

**✍️ Expected (required):** 100 points.

- **E1 (25 points) — The first main program is new to Leah.** Create a concrete valid order for June 6 whose advertised main program is relevant to the stated interests and not already completed. Award 25, whether paid or unpaid; short familiar introductory content is allowed. The canceled foundry visit and unvisited North Gallery remain eligible. *Evidence:* R1–R4 and the first catalog/request. *Checked from:* The order, public main-program/version descriptions and attendance records available at selection time.
- **E2 (30 points) — The next choice uses the actual update.** Create a qualifying order for June 20 against what Leah actually completed on June 6, including the supported partial/no-show branches. Award 30 for a relevant uncompleted main program. A new reseller title does not change program identity. *Evidence:* R1; the action-dependent June 6 visit record and June 8 message; June 19 catalog. *Checked from:* The second order and the experience state supported by those public records; do not assume the reference first choice.
- **E3 (25 points) — The July choice remains a new experience.** Create a qualifying order for July 4 against all actual prior completion records. Award 25 for a relevant uncompleted main program; a distinct workshop at a familiar venue may qualify. Do not impose a hidden minute quota. *Evidence:* R1; June 20 visit record and July 3 catalog/request. *Checked from:* The third order, public contents/versions and dated actual attendance history.
- **E4 (15 points) — Three usable paid bookings.** All three requested activities have paid tickets valid for their respective day, party size and available afternoon window; later attendance, consumption or a user no-show does not erase an initially valid arrangement. Award the 15-point block only for all three. Main-program novelty is scored separately. *Evidence:* R5 and each dated current request/catalog. *Checked from:* All ticket/payment records, capacities, activity times and final booking statuses.
- **E5 (5 points) — Experience reconciled in the conversation.** The June 8 acknowledgment and final explanation accurately distinguish completed, partial and unvisited content. Award 2.5 each. The acknowledgment must respond to a real update from an actual booking, and the final explanation must concern an actual third order. *Evidence:* The June 8 message, visit records and final order. *Checked from:* Delivered messages against public attendance and content records; no private memory format is required.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 90 of 100. The gap is 10 points; the decisive outcome items E1 (25), E2 (30), E3 (25), E4 (15) each carry more than that gap. Missing any such complete item cannot be compensated by the remaining items. Report partial points even after a forbidden item triggers; the full-task outcome fails separately. Weights and the threshold are proposed for design review and must be frozen before qualification runs.

### Hint

**✍️ Hint (required):** “Relevant sources are Leah's ‘Next visits’ message of April 10, notebook entries of April 12 and April 26, and foundry service correspondence of May 9, all present in the initial workspace.”

- **Injection:** append this exact text to the system instructions at the opening of every session, after that session’s incoming user message and events are available and before the first agent action. Use the same text and position for all designated models. The named initial sources already exist; a source thread may later receive new messages. Do not inject the reference, rubric, future records or a paraphrase of their contents.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-06-05T10:00:00-07:00` | First free afternoon | Read the earlier records and current contents; book and pay for the North Gallery on June 6. | R1–R5; current program descriptions | The first booking has a new main program at a familiar venue. | F1; E1, E4 |
| `2026-06-06T16:00:00-07:00` | The booked visit ends | The scenario records actual attendance; the agent cannot create this actor event. | Actual booking and provider visit record | On the reference path the North Gallery main program is completed. | E2 prerequisite |
| `2026-06-08T09:00:00-07:00` | Leah reports the visit | Acknowledge the completed sections and retain the discoverable update. | Leah’s dated message and provider record | The next selection can use actual completion. | E5 |
| `2026-06-19T10:00:00-07:00` | Next free afternoon | Book and pay for the previously unvisited foundry demonstration for June 20. | R4; actual North Gallery update; current catalog | The second booking has an uncompleted main program. | E2, E4 |
| `2026-06-20T16:00:00-07:00` | Second booked visit ends | The scenario records the actual foundry completion. | Actual booking and provider visit record | The reference path now includes the demonstration. | E3 prerequisite |
| `2026-07-03T10:00:00-07:00` | Another afternoon | Book the distinct gear workshop for July 4, pay, and explain the choice. | R1; actual updates and workshop description | Three usable paid activities; neither the gallery nor foundry demonstration is repeated as a main program. | E3, E4, E5 |

**✍️ Other accepted approaches (required):** Start with the foundry and choose a different uncompleted main program later; choose the distinct gear workshop first; accept short familiar introductions; or clarify genuinely ambiguous content equivalence before paying. Every accepted first choice and interruption branch must retain a later feasible option. The first alternative to replay is foundry first, North Gallery second, and a different uncompleted workshop third.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Write about fourteen initial records; create four fictional venues, roughly ten dated offerings and approximately twelve specific content sections with public descriptions, main/introductory roles and ordinary durations. | Source-linked experience history; unambiguous overlap where graded; positive examples of an old venue with new content and a paid but unvisited activity. | 2–3 |
| User rollout and scenario script | **Sessions:** 4, with booking decisions in 1, 3 and 4.<br>**Simulated world time span:** June 5–July 4, 2026, plus two months of seeded history.<br>**Estimated total tokens:** 35k–75k per complete episode, including dialogue, retrieved history, repeated context, tools and agent outputs; exclude private grading and separately billed reasoning.<br>Use the UTC-offset session timestamps in Section 3 and timestamp attendance events on June 6, June 20 and July 4. | Action-dependent attendance updates and truthful interruption/no-show branches. Check all reachable accepted choices still leave a feasible next activity. Record real execution dates and wall-clock duration separately. | 2–3 |
| Environment integration | Reuse Vita attraction search, details, dated ticket booking and payment, with the common PALE bridge budgeted in the lunch proposal. Add versioned program descriptions and attendance/section-completion records. | Distinct booking and experience state; English public evidence; persistent events, complete transaction records and deterministic reset. | 2–3 |
| Rubrics, reference and hints | Implement Section 5 items with stable IDs, the full reference and the first listed accepted alternative. Include the dated personal-history comparison. | Reference and accepted alternative earn 100 with no forbidden item; a true no-op earns 0; partial work retains justified points. Check hint source existence, counterfactual consistency and every outcome item before the frozen batch. | 2–3 |
| Agent rollouts and analysis | Plan three pilots, then five unhinted and one fixed-hint episode per designated GPT, Claude and Gemini model; budget six separate diagnostic episodes. | Frozen scenarios and budgets, all traces and scores, and failure analysis separating record reconciliation, content matching and booking execution. | 2–3 |

### Environment reuse and observable experience

Start from [VitaBench 2.0 at commit f60169e](https://github.com/meituan-longcat/VitaBench-2.0/tree/f60169e89f30499cb7883f3dad76bd03facc908d). Its [OTA toolkit](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/ota/tools.py) supplies attraction discovery, `create_attraction_order` and `pay_attraction_order`. The stock attraction model describes venues and ticket products; program versions, section durations and completion evidence are additions required by this task.

Expose human-readable provider programs, dated catalogs, cancellation notices and attributed diary entries through the history view. Keep normalized content IDs and scoring annotations private. A hidden content ID cannot be the only evidence that two tours overlap; public descriptions must support the equivalence. Independent review will distinguish repetition of the same exhibit or route segment from a different experience on a similar topic. The main program cannot be invented by the grader from a duration threshold: it must be clear from the public description. Unresolved equivalence or a genuinely mixed old/new main program must permit clarification or alternative acceptance rather than an arbitrary penalty. Freeze a reviewed mapping and acceptance sets before model runs.

Attendance is a separate event stream driven by actual bookings and the scenario schedule. The user can correct an experience summary, but cannot make an unmade purchase appear paid. Private completion state must have a corresponding discoverable diary or provider record before it affects a booking's score. The bridge will preserve both transactions and experience events across sessions, use PALE's approved memory lifecycle, and reset both between runs. No oracle experience summary is injected into the agent.

### Design and validation checks

Keep receipts and the complete current catalog fixed while changing only personal attendance records. Rename a completed program without changing its content, and offer new main content at a familiar venue. Re-run the earlier path-feasibility enumeration with the added initial gear-workshop option; the old count is not evidence for this revised catalog.

Section 5 describes the main history. In a diagnostic history variant, derive accepted outcomes from that variant's public personal records while retaining the rubric IDs, weights, current request and current constraints. Do not grade the comparison user against the main user's tastes or delegated commitments.

Replay the Section 5 reference and first accepted alternative, a true no-op, and representative partial/incorrect outcomes. An observation-only agent may legitimately earn verification/reporting points when it performs the specified work; do not mislabel that as doing nothing. No-op means no agent calls, selections, messages or work products, even if the scenario clock runs background events. Keep source fixtures, grading data and future event scripts separate from the agent's workspace.

Follow the [PALE validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation): freeze the exact task, rubric, roster, agent/memory configuration and resource budget. Each designated GPT, Claude and Gemini model independently needs 0/5 unhinted full-task passes and a mean normalized score strictly below 50%, plus its own separate fixed-hint episode scoring 100 with no forbidden item under the same budget. Report every run; pilot and diagnostic episodes are separate. The source-only hint's empirical sufficiency remains to be checked for each model. Repeat the complete frozen batch after substantive task changes. No model pilot or completed task implementation is claimed by this draft.

- **Milestones, owners and dependencies (required):** @onepounchman owns history and program construction, independent overlap review, attendance-event integration, rubric/reference checks and model trials, in that order. Allow about 3–5 calendar weeks after PALE interfaces are available. Reuse the history, clock, ledger and session/reset bridge budgeted in the lunch proposal; this task owns content/version metadata and actual-experience events. Confirm API-environment compatibility, event visibility and the treatment of ambiguous content overlap before freeze.
- **Resources and total effort (required):** 10–15 person-days, excluding the shared bridge already budgeted in the lunch proposal. CPU-only fixtures with synthetic catalogs; no GPU, local model weights or paid travel data. Twenty-seven planned episodes imply about 0.95–2.03 million visible tokens plus reasoning and generation. Provisional API planning envelope: US$100–450, to be revised from pilots and the designated roster's pricing.
- **Scope boundary and open questions (required):** One traveler, one city, four venues and three paid activity decisions. Exclude route optimization, live maps, offline media preparation, group travel and refund accounting. Use explicit activity windows and simple published durations so logistics do not dominate experience reasoning. Final content-equivalence rules, interruption branches and accepted sequences require review. Model difficulty is unmeasured; no completed model rollouts are claimed.
- **Data provenance and privacy (required):** Adapted from the contributor's own real-life experiences of revisiting destinations and distinguishing planned activities from actual experiences. The traveler, city details, dates, venues, programs, diaries, messages and transactions will be fictionalized or synthesized for reproducibility. No original private correspondence, credentials or identifiable third-party records will be published. Reuse Vita's MIT-licensed code with notices retained; author fresh English programs and history rather than copy private itineraries or third-party exhibit text. Record fixture licensing and any later external reuse before release. Codex assisted with drafting.

After approval, add the scenario, domain extensions, grader, reference and author-run evidence in the same PR. Substantial changes require design re-review.
