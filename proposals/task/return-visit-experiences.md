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

## 3. Story outline

**✍️ Your answer (required):** Four sessions over four weeks contain three booking decisions and an intervening experience update. A good outcome is three suitable paid activities whose novelty is assessed against Leah's actual completed experiences at the time of each booking.

| Session and simulated timestamp | Request or event | Expected outcome |
| :--- | :--- | :--- |
| 1 — `2026-06-05T10:00:00-07:00` | “I'll have another free afternoon here. Find something new that fits what I enjoyed last time, and book it.” | Reconstruct prior experience from descriptions and attendance evidence. Both a North Gallery program at a familiar museum and the previously canceled foundry tour can be valid. |
| 2 — `2026-06-08T09:00:00-07:00` | Leah reports what she actually attended on June 6 and asks the assistant to keep it in mind. The corresponding provider record is available. | Preserve the completed sections without treating every item bundled into a ticket as completed. The main path confirms the booked core program; a documented interruption/no-show branch records less or no completion. |
| 3 — `2026-06-19T10:00:00-07:00` | “I have another afternoon tomorrow. Please book something I haven't already covered.” | Use the experience update when choosing from the next catalog. Do not repeat a completed program under another seller's title, or exclude an unvisited program merely because an old receipt exists. |
| 4 — `2026-07-03T10:00:00-07:00` | A new workshop at a familiar venue is now offered. Leah's June 20 diary and provider record are available. “What should I do this time? Go ahead and book within my usual limit.” | Distinguish the new workshop from the old venue overview, use the updated experience history, and complete an appropriate booking for July 4. |

Catalog changes and attendance records follow a fixed, published event schedule. Each later record refers to the activity the agent actually booked. A missed or canceled booking never creates a completed visit. Every reachable main or interruption branch retains at least one suitable offering at the next booking decision. The implementation must verify that invariant rather than assume the reference's earlier choice.

An illustrative first catalog makes the distinction concrete:

| Offering | Published contents | Relation to the seeded history |
| :--- | :--- | :--- |
| Makers of the Waterfront | The engine-hall overview and canal route are the advertised main program; a new seller uses a new title. | Repeats completed material; the new title does not make it a new experience. |
| North Gallery Engineering Visit | A short lobby introduction followed by the North Gallery's machinery exhibit, the advertised main program. | Valid new content at a venue Leah has already entered. |
| Foundry Demonstration | A working-foundry demonstration is the main activity. | Valid despite a historical paid ticket, because that earlier visit was canceled. |
| Old Engine Hall Overview | The same completed hall overview. | Repeats the completed visit. |
| Riverside Wildlife Walk | A nature walk without engineering or architectural content. | New to Leah, but outside the stated interest. |

Descriptions expose the actual rooms, stops, demonstrations, main programs and versions. A new hands-on engine workshop can qualify even if Leah has seen engines before; a renamed repeat of the same overview cannot. Later catalogs retain both a new program at a familiar venue and a previously uncompleted program where feasible, so blacklisting all familiar venues is not a valid general solution. Questions about attendance or uncertain overlap receive truthful answers; asking for clarification and choosing any qualifying activity can earn full credit.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** Novelty depends on this traveler's completed experiences and the contents of the current program. Neither a list of previously purchased tickets nor a blacklist of visited venues represents that history correctly. The assistant must reconcile intent, payment, attendance and partial completion, then carry actual new experiences forward into later decisions.

For example, when Leah asks for “something new” on June 5, a past receipt makes the foundry look familiar. A cancellation notice and diary entry establish that she never attended it. The museum looks familiar too, but her earlier diary says she left before the North Gallery. Current program descriptions establish that the North Gallery visit contains mostly unseen material, while the newly named waterfront package repeats known stops. Those sources are searchable before booking. Either valid activity can be chosen; the next session's experience record then changes what is appropriate later.

Related proposals: [#18](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/18) uses prior studio visits to determine trial eligibility; [#59](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/59) concerns preparing a personal museum audio walk for offline use.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Write about fourteen initial records; create four fictional venues, roughly ten dated offerings and approximately twelve specific content sections with public descriptions, main/introductory roles and ordinary durations. | Source-linked experience history; unambiguous overlap where graded; positive examples of an old venue with new content and a paid but unvisited activity. | 2–3 |
| User rollout and scenario script | **Sessions:** 4, with booking decisions in 1, 3 and 4.<br>**Simulated world time span:** June 5–July 4, 2026, plus two months of seeded history.<br>**Estimated total tokens:** 35k–75k per complete episode, including dialogue, retrieved history, repeated context, tools and agent outputs; exclude private grading and separately billed reasoning.<br>Use the UTC-offset session timestamps in Section 3 and timestamp attendance events on June 6, June 20 and July 4. | Action-dependent attendance updates and truthful interruption/no-show branches. Check all reachable accepted choices still leave a feasible next activity. Record real execution dates and wall-clock duration separately. | 2–3 |
| Environment integration | Reuse Vita attraction search, details, dated ticket booking and payment, with the common PALE bridge budgeted in the lunch proposal. Add versioned program descriptions and attendance/section-completion records. | Distinct booking and experience state; English public evidence; persistent events, complete transaction records and deterministic reset. | 2–3 |
| Rubrics, reference and hints | Grade relevant main-program novelty, booking feasibility and accurate experience reconciliation. Implement a reference covering alternative first choices and interruptions. | Reference reaches full credit; no-op and receipt/venue/name-only heuristics fail appropriate checks. Independently review main-program identity, accepted alternatives and fixed-hint coverage before the validation batch. | 2–3 |
| Agent rollouts and analysis | Plan three pilots, then five unhinted and one fixed-hint episode per designated GPT, Claude and Gemini model; budget six separate diagnostic episodes. | Frozen scenarios and budgets, all traces and scores, and failure analysis separating record reconciliation, content matching and booking execution. | 2–3 |

### Environment reuse and observable experience

Start from [VitaBench 2.0 at commit f60169e](https://github.com/meituan-longcat/VitaBench-2.0/tree/f60169e89f30499cb7883f3dad76bd03facc908d). Its [OTA toolkit](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/ota/tools.py) supplies attraction discovery, `create_attraction_order` and `pay_attraction_order`. The stock attraction model describes venues and ticket products; program versions, section durations and completion evidence are additions required by this task.

Expose human-readable provider programs, dated catalogs, cancellation notices and attributed diary entries through the history view. Keep normalized content IDs and scoring annotations private. A hidden content ID cannot be the only evidence that two tours overlap; public descriptions must support the equivalence. Independent review will distinguish repetition of the same exhibit or route segment from a different experience on a similar topic. The main program cannot be invented by the grader from a duration threshold: it must be clear from the public description. Unresolved equivalence or a genuinely mixed old/new main program must permit clarification or alternative acceptance rather than an arbitrary penalty. Freeze a reviewed mapping and acceptance sets before model runs.

Attendance is a separate event stream driven by actual bookings and the scenario schedule. The user can correct an experience summary, but cannot make an unmade purchase appear paid. Private completion state must have a corresponding discoverable diary or provider record before it affects a booking's score. The bridge will preserve both transactions and experience events across sessions, use PALE's approved memory lifecycle, and reset both between runs. No oracle experience summary is injected into the agent.

### Proposed grading and reference

Proposed scoring totals 100 points: selection of a relevant activity with an uncompleted main program at each booking decision (60; 20 each); correct paid ticket, date, quantity, price and available activity window (30; 10 each); and a concise, evidence-supported account of Leah's completed and still-unvisited content when acknowledging the Session 2 update and explaining the final booking (10; 5 each). A brief repeated introduction does not invalidate an otherwise suitable activity. New and repeated content are assessed together in the 20-point selection check, avoiding two penalties for the same duplicate-program choice. Different names or venues alone never earn novelty credit.

Full-task gates require three suitable completed purchases and no unwanted paid duplicates or unauthorized spending. The grader checks every transaction and the experience state available at the time of each decision. It accepts all offerings satisfying the public requirements, including different valid sequences; it does not require the author's favorite route. A failed gate does not automatically zero unrelated points. Check no-op, canceled-but-unvisited, entry-without-completion and partial-completion cases explicitly.

The reference reconciles receipts with attendance evidence, identifies specific completed sections, compares them with current main programs, books and pays for a qualifying offering, then incorporates the actual post-visit update before selecting again. The fixed hint is: “Separate what the traveler planned or paid for from what they actually experienced. Compare each current program's actual main activity and version against completed sections, including partial visits. Use the traveler's revisit rule and interests, then verify time, budget and the purchase.” It supplies neither a completed-section list nor an activity ID. The ordinary context supplies the requirements and current catalog.

Diagnostic controls hold receipts and venues constant while changing discoverable attendance evidence; rename a program without changing its content; and introduce new content at an old venue. These are variants within this task, not additional tasks. For qualification follow the [PALE protocol](../../CONTRIBUTING.md#task-difficulty-and-validation): freeze the scenario, rubric, exact model roster, memory configuration and budget; each designated model independently must have 0/5 unhinted full-task passes, mean score strictly below 50%, and a separate fixed-hint run at 100% with every gate under the same budget. Report every run and keep diagnostic variants outside the aggregate. A simple retrieval solution is valid; if it makes the task too easy, disclose the result rather than hide records or shorten context artificially.

- **Milestones, owners and dependencies (required):** @onepounchman owns history and program construction, independent overlap review, attendance-event integration, rubric/reference checks and model trials, in that order. Allow about 3–5 calendar weeks after PALE interfaces are available. Reuse the history, clock, ledger and session/reset bridge budgeted in the lunch proposal; this task owns content/version metadata and actual-experience events. Confirm API-environment compatibility, event visibility and the treatment of ambiguous content overlap before freeze.
- **Resources and total effort (required):** 10–15 person-days, excluding the shared bridge already budgeted in the lunch proposal. CPU-only fixtures with synthetic catalogs; no GPU, local model weights or paid travel data. Twenty-seven planned episodes imply about 0.95–2.03 million visible tokens plus reasoning and generation. Provisional API planning envelope: US$100–450, to be revised from pilots and the designated roster's pricing.
- **Scope boundary and open questions (required):** One traveler, one city, four venues and three paid activity decisions. Exclude route optimization, live maps, offline media preparation, group travel and refund accounting. Use explicit activity windows and simple published durations so logistics do not dominate experience reasoning. Final content-equivalence rules, interruption branches and accepted sequences require review. Model difficulty is unmeasured; no completed model rollouts are claimed.
- **Data provenance and privacy (required):** Adapted from the contributor's own real-life experiences of revisiting destinations and distinguishing planned activities from actual experiences. The traveler, city details, dates, venues, programs, diaries, messages and transactions will be fictionalized or synthesized for reproducibility. No original private correspondence, credentials or identifiable third-party records will be published. Reuse Vita's MIT-licensed code with notices retained; author fresh English programs and history rather than copy private itineraries or third-party exhibit text. Record fixture licensing and any later external reuse before release. Codex assisted with drafting.

After approval, add the scenario, domain extensions, grader, reference and author-run evidence in the same PR. Substantial changes require design re-review.
