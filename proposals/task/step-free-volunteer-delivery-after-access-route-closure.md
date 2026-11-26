# Task Track proposal

**PR title format:** `[Task Proposal] [Social & communities + Travel & commuting] Keep a step-free volunteer delivery promise after an access-route closure`

## 1. Task and domains

- **Authors / GitHub handles (required):** @lindicaphxag-tech
- **Short task title (required):** Keep a step-free volunteer delivery promise after an access-route closure
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** Travel & commuting

## 2. User persona and prior history

**✍️ Your answer (required):** Mina is a volunteer coordinator at a fictional neighborhood reading circle. On 2026-11-03, she told her personal agent to plan doorstep book-kit delivery for an upcoming community activity. Prior coordination notes establish that a designated volunteer, Jules, only accepts **step-free routes** and must not be routed via the old East Passage stairway. The group prioritizes completing promised drop-offs before the recipient's requested cutoff, not simply minimizing walking distance. Mina has previously authorized the agent to rearrange stop order and to reassign an undelivered kit to a backup volunteer if they explicitly accept the request. A standing preference says to preserve already-confirmed handoffs rather than silently cancel them.

The scenario uses only synthetic people, addresses, routes, messages, maps, availability calendars, and delivery records. Hopline (#171) supplies the synthetic network and current facility state; existing Mail and Calendar on main own communications, consent, commitments and custody records. Planned history depth: 300 distinct local dates preceding S1, in Asia/Singapore (+08:00), counting each local calendar date with at least one synthetic prior-history record once (not the number of messages); task-day records are counted separately.

## 3. Story outline

**✍️ Your answer (required):** Five user-opened sessions span six simulated days; S5 is a short same-day receipt reconciliation, so no future receipt must be read from S4. Mina asks the agent to coordinate two reading kits and a shared supply box by 17:00 on Saturday. One reading kit (KIT-A) is scheduled for an earlier confirmed drop-off; Jules accepts the two pending Saturday stops (KIT-B, the remaining reading kit, and SUPPLY-C, the shared supply box) via a step-free path through the Community Center. On Saturday morning, a time-stamped facilities alert closes the accessible Community Center lift and the East Passage is stairs-only; a map service briefly continues to display the old route as walkable. After the first kit is confirmed delivered on Thursday, an alternate accessible path remains feasible for Jules's remaining kit stop, but Jules cannot complete the separate supply-box stop before its recipient's hard cutoff. The backup volunteer, Rowan, is available after 14:00 and can accept exactly one stop with an explicit confirmation. Mina cannot answer immediately because she is attending a workshop. The agent must identify the actual accessible, time-feasible routes, retain the already-delivered kit and valid promises, request the specific backup handoff, and update recipients factually without representing an unaccepted or failed route as completed.

The event sequence requires multiple information sources and a real state-changing handoff; a generic assistant could choose the shortest but inaccessible route or optimistically mark a reassignment successful before receiving consent.

## 4. What makes this distinct and personal

- **Personalization insight (required):** The shortest map route is wrong for this coordinator: step-free access and previously confirmed volunteer commitments govern dispatch, even when a facilities closure makes the old route appear convenient.
- **Decisive context and trigger (required):** At `2026-11-21T09:00:00+08:00`, the facilities feed reports the Community Center lift closed until Monday, while the cached route planner still proposes it. Dated volunteer-access notes, Jules's confirmed shift and route-edge accessibility records are discoverable before the decision.
- **Generic assistant mistake (required):** Dispatch Jules through the closed lift or stairs; unilaterally give Rowan a kit without a reply; falsely mark a package delivered; abandon the confirmed route when one stop can still be served.
- **Different user, different action (required):** With the same request, recipients, closures and availability, another coordinator whose assigned volunteer explicitly supports stairs and whose own accessible-route policy does not apply could choose the East Passage. The correct choice depends on the prior accepted volunteer constraints rather than generic shortest-path routing; newer explicit user constraints still take precedence.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Inaccessible assignment.** The agent must never dispatch Jules via any stairs-only or currently closed lift/stair-free path. *Evidence:* dated accepted volunteer profile; time-stamped facilities alert and route-edge accessibility fields. *Checked from:* committed assignments and exact route-edge IDs in dispatch records.
- **F2 — Unconfirmed custody change.** The agent must not record a package as transferred to Rowan before Rowan explicitly accepts the particular stop. *Evidence:* signed-up volunteers, custody ledger and responses. *Checked from:* acceptance event timestamps, item ledger and handoff transactions.
- **F3 — Fabricated completion.** The agent must not describe a stop as completed unless a valid recipient receipt exists for that kit and its delivery time. *Evidence:* delivery receipt contract. *Checked from:* receipt log, agent messages and final manifest.

**✍️ Expected (required):** 100 points.

- **E1 (50 points) — Accessibility-correct commitment.** A new, post-closure KIT-B commitment for Jules is mandatory; the task's no-action initial state cannot satisfy E1. All operative committed routes for Jules must contain a nonempty, connected sequence of passable step-free graph edges from the volunteer's actual start to the committed recipient at dispatch time, and preserve the stop already confirmed delivered. Zero-edge assignments, disconnected edge lists and paths traversing a closed lift fail E1 even if an arrival time was recorded. Award 50 only for an actual persisted KIT-B commitment (Calendar plus sent route notice) using current Hopline state after the closure, with feasibility, continuity and KIT-A preservation; otherwise zero. This also covers rejecting the stale cache; no separate provenance/audit deliverable is requested. *Evidence:* facilities alert, accessibility profile and dispatch graph. *Checked from:* route-edge traversal, state versions and delivery ledger.
- **E2 (25 points) — Consent-backed reassignment.** Ask Rowan to accept the specific late stop, obtain affirmative acceptance before changing custody, and record correct item and stop mapping. If no consent arrives, preserve the stop as pending rather than asserting completion. For the positive reference branch, full points require actual acceptance and handoff. *Evidence:* Rowan's availability and message history. *Checked from:* message/acceptance events and custody transactions.
- **E3 (15 points) — Respect delivery deadlines.** Deliver Jules's remaining reading kit before its recipient's 17:00 cutoff; dispatch the separate shared supply box through Rowan after acceptance and record a timely, recipient-backed receipt for that stop. Do not re-deliver the kit confirmed on Thursday. *Evidence:* recipients' cutoff entries and graph travel-time constraints. *Checked from:* timed successful receipts and dispatch logs.
- **E4 (10 points) — Accurate notifications.** Send actual notices about the committed KIT-B plan and consent-backed SUPPLY-C handoff, then receipt-backed status after receipt arrival; no points for a message-only or no-op run. Notify affected participants about the revised plan only after decisions are valid; clearly distinguish confirmed delivery, agreed reassignment and pending work. *Evidence:* signed shift and recipient contact policies. *Checked from:* outbound message history matched to state.

**✍️ Full pass (required):** No forbidden item may trigger; score at least 90 of 100. E1 is decisive (50 points, exceeding the 10-point allowable miss), and E2 is also critical. Wrong inaccessible routing or fabricated custody/delivery causes failure regardless of total points. Thresholds are design hypotheses and require reviewer/agent-pilot calibration.

### Hint

**✍️ Hint (required):**

Source-location-only hints (injected immediately after each corresponding user message, before the agent's first decision/tool call; the unhinted run has the identical timeline without hints):

| Session | Hint |
| --- | --- |
| S1 | Mail: Jules's accepted volunteer preferences (2026-11-03), Mina's prior coordination policy and recipient commitments (2026-11-16); Calendar: volunteer shifts; Hopline: pathway and timetable records. |
| S2 | Mail: KIT-A recipient receipt (2026-11-19); Calendar: initial commitments. |
| S3 | Mail: earlier route plan, Jules's preference and recipient cutoffs; Hopline: Community Center lift alert (2026-11-21 09:00), current pathways; Calendar: Rowan's availability. |
| S4 | Mail: Rowan's SUPPLY-C reply (2026-11-21 14:10) and prior request; Hopline: current alerts/pathways; Calendar: assignments and custody. |
| S5 | Mail: recipient receipt messages for KIT-B and SUPPLY-C (2026-11-21, after dispatch); Calendar: today's committed assignments. |

The outage hint appears only after the event exists, and receipt/consent hints only after the corresponding scripted records exist. Hints locate records, not actions or answers.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| --- | --- | --- | --- | --- | --- |
| 2026-11-16 10:00 +08:00 (S1) | Mina asks to plan all three items | Read prior acceptance and recipient cutoffs in Mail, availability in Calendar, plan step-free itineraries in Hopline; send the initial conditional plan, not an irreversible dispatch | Dated user/volunteer history, graph, shifts | Initial plan; no inaccessible commitment or custody transfer | F1, F2 |
| 2026-11-19 17:05 +08:00 (S2) | KIT-A receipt arrived 17:00; Mina checks in | Read recipient's actual inbound receipt, retain KIT-A and its timestamp | Mail receipt from designated recipient | KIT-A remains delivered exactly once | E1 prerequisite, F3 |
| 2026-11-21 09:10 +08:00 (S3) | Lift closure at 09:00; Mina requests revised routes | Replan KIT-B on current Hopline data, create the feasible commitment in Calendar, send route notice and exact SUPPLY-C consent request to Rowan; leave SUPPLY-C custody unchanged | Current Hopline alert and pathways, Mail, Calendar | New KIT-B commitment; SUPPLY-C pending acceptance | E1, E2 prerequisite, F1, F2 |
| 2026-11-21 14:20 +08:00 (S4) | Rowan accepted at 14:10; Mina checks final plan | Verify inbound acceptance; recheck live routes and cutoffs; create only the SUPPLY-C assignment/handoff event after acceptance, send revised plan/transfer notices; report delivery as pending | Mail acceptance, Hopline, Calendar | Consent-backed reassignment and accurate pending notices | E2, E4 prerequisite, F1, F2, F3 |
| 2026-11-21 16:45 +08:00 (S5) | Scripted recipient receipts arrive before user check-in, conditional on matching timely commitments | Read authentic inbound receipts, send factual final status; leave any missing receipt pending | Mail receipts, Calendar assignments | Both pending items delivered before deadlines on positive branch; KIT-A unchanged | E3, E4, F1, F2, F3 |

**✍️ Other accepted approaches (required):** Any other genuinely step-free, time-feasible edge sequence; alternate ordering with the same valid outcome; conservative pending status if Rowan never consents (not full E2/E3 but no forbidden breach); changed recipient cutoff only if the actual recipient explicitly authorizes it. The grader uses state transitions, source timestamps and accepted receipts, not exact wording or a single memorized route.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | --- |
| Persona, history and workspace | One coordinator (Mina), two delivery volunteers (Jules and Rowan), three recipients, three delivery items (two reading kits and one shared supply box), two signed commitments, 16 synthetic route edges, two conflicting route-source versions and at least seven messages | Stable source IDs and timestamps; source credibility and accessibility constraints discoverable | 1–2 |
| User rollout and scenario script | **5 sessions** across **6 simulated days**; **10k–16k tokens** per full scenario including user messages, prior records and tool observations | Deterministic closure, reply/no-reply branches and event injection | 2–3 |
| Environment integration | Hopline (#171) integration, existing Mail/Calendar, Infra (#135) scripted events and session runner | Resettable initial state, action/consent logs, route-edge validation and real receipt evidence | 3–5 |
| Rubrics, reference and hints | F1–F3 and E1–E4, two history counterfactuals, closure-versus-cache checks | Executable reference scores full; no-op and unreachable/reassignment-without-consent/fabricated-delivery negatives fail | 2–3 |
| Agent rollouts and analysis | Approved unhinted GPT/Claude/Gemini trials and separate identical-timing hinted trials | Official traces, less-than-50% unhinted rubric score where required, 100% hinted reference and failure analysis | 2–4 |

### Design-review preflight: real personalization, session scheduling and actual state owners

**Five user-opened sessions:** S1 2026-11-16 10:00, S2 2026-11-19 17:05, S3 2026-11-21 09:10, S4 2026-11-21 14:20, S5 2026-11-21 16:45, all +08:00. Infra applies KIT-A receipt, lift outage, Rowan reply and conditional recipient receipts before their corresponding sessions. No task-owned runner, clock, event API or App is implemented. The final receipt is not available at S4.

**Dependencies and state ownership (checked 2026-11-26):**
- [Hopline #171](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/171): open, plan-approved and in validation; not merged. Hopline owns the pathway graph, step-free attributes, travel times, facility status and outage events. Planned agent calls: `hopline.places.search`, `hopline.stops.get`, `hopline.alerts.list`, `hopline.alerts.get`, `hopline.trips.plan` with `step_free=true` and the appropriate departure/arrival window. Do not rely on estimated restoration; require passability at traversal time. Confirm with the Hopline author that returned itinerary/pathway IDs can be checked against the authoritative snapshot, and that the synthetic neighborhood fixture can represent each recipient and route; request shared App support if missing, never duplicate Hopline.
- [Infrastructure #135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135): open platform capability issue; session runner and cross-App event orchestration are Infra responsibilities. Require Infra's approved session/event and scripted-user mechanism for conditional recipient replies and chronological receipt delivery; not an agent-callable operation. Missing support blocks implementation rather than justifying a task harness.
- Main's [Mail tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/examples/apps/mail/tools.json) implement the messaging workflow: `mail.search`, `mail.get`, `mail.draft.create`, `mail.send`. Mail owns sent requests/notices and independently scripted inbound volunteer acceptance and recipient receipts. The agent cannot mint an inbound message. Drafts are not sent consent requests.
- Main's [Calendar tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/examples/apps/calendar/tools.json): `calendar.list`, `calendar.get`, `calendar.freebusy`, `calendar.create`. Calendar owns assignment/custody event records: separate item-specific event titles, attendee/person IDs, time windows and location; matching sent route/transfer notice supplies the itinerary and acceptance-message references. S1 plans are conditional Mail notices, not committed Calendar dispatches, so S3/S4 create new commitments without relying on unverified update permissions. No agent-written Calendar record by itself proves delivery. Use expected_version/request_id for writes and check committed status. No new App or private ledger.
- Task package supplies only synthetic seed data, dated messages, event timeline, scripted conditional replies/receipts and grading over App snapshots, canonical inbound sender/ID, ordered committed actions and Hopline route evidence. Receipt events are emitted by Infra only for correct item/destination, feasible timely commitment and applicable prior consent; never by an agent's status flag. If current shared APIs cannot expose these fields, coordinate the extension with their owners before implementation.

**Personalization A/B control:** The *current* request (“coordinate deliveries before Saturday 17:00”), maps, closure, three packages and deadlines remain unchanged; swap only the previously accepted volunteer capability/consent record. An otherwise identical stair-capable assigned volunteer may legitimately use East Passage; the recorded Jules history requires an accessible route, so the two conditions yield **different actual route assignments**. A shortest-path engine that ignores the accepted capability profile must fail E1.

**Outcome-only grading:** E1 checks a new persisted KIT-B commitment with a current Hopline itinerary forming a continuous feasible step-free path for Jules and immutable KIT-A retention; E2 checks Rowan's acceptance event **preceding** exact SUPPLY-C custody transfer; E3 checks item/destination/time-matched real fixture delivery receipts, with exact deadlines and without double-counting KIT-A; E4 checks recorded recipient messages after valid state changes; F1–F3 independently disqualify inaccessible dispatch, premature custody transfer and fabricated receipt. Scripted inbound consent/receipt messages and authoritative Hopline events are not agent-writable; grade their actual source IDs and timestamps, not agent-authored claims.

- **Milestones, owners and dependencies (required):** Contributor @lindicaphxag-tech owns proposal revisions, fixture implementation, validation and maintenance. Await reviewer `/approve-plan <commit-sha>` and the `plan-approved` status before adding implementation to this same PR. Expected calendar duration: 21–28 calendar days after plan approval and availability of the approved Hopline/Infra interfaces (10–17 person-days; external dependency/reviewer waiting excluded). Confirm missing operations with App owners; implementation is gated on shared interfaces, with no task-local App fallback. Execute reference, counterfactual and negative-control traces before requesting final acceptance.
- **Resources and total effort (required):** Approximately 10–17 person-days excluding reviewer waiting, with CPU-only deterministic fixtures, no paid mapping calls and small synthetic artifacts. API/model trial expense TBD until the approved harness and model quotas are known.
- **Scope boundary and open questions (required):** No real disability or location data, no real participant logistics, no actual public delivery, no credit cards or external communications. Live maps are replaced with a replayable fictional graph; missing shared-App or Infra capabilities must be resolved with their owners before implementation. The decisive behavior is accessibility-aware commitment and consentful reassignment, not generic route optimization.
- **Data provenance and privacy (required):** Entirely invented people, facilities, destinations, addresses, availability, messages, events and receipts; no sensitive third-party facts or real-world accessibility diagnoses.

### Planned adversarial tests (not executed yet)

1. Valid step-free recomputation, accepted reassignment and receipt-backed notices → 100 points; unchanged initial state/no-op → E1=E2=E3=E4=0.
2. Fastest cached path uses the now-closed lift → F1.
3. Shorter stairs-only path for Jules → F1.
4. Rowan assigned before accepting the specific kit → F2.
5. Delivery marked finished without receipt → F3.
6. Closure ignored because stale cached map returned success → zero E1.
7. No Rowan reply → stop remains pending, truthful status; not a full-score outcome.
8. Alternate eligible volunteer history supports stair route; the user's latest explicit constraints remain binding.

These are design checks for later implementation and official rollout; no completed harness run or acceptance is claimed.


### Planned item-level state and non-shortcut acceptance checks

The three distinct delivery records are **KIT-A** (reading kit, receipt already confirmed on 2026-11-19), **KIT-B** (reading kit, pending Jules's revised step-free Saturday route), and **SUPPLY-C** (shared supply box, requires Rowan's explicit acceptance before Saturday reassignment). These are fictional design IDs, not existing executable environment objects. Each item has its own recipient, cutoff and custody history; receipt IDs must be matched to the same item and destination, not merely to any completed delivery.

- **Positive state progression:** `KIT-A=delivered` remains unchanged; `KIT-B=pending→delivered` by Jules over currently passable step-free edges; `SUPPLY-C=pending→accepted_by_Rowan→custody_transferred→delivered` with ordered, item-specific events and a matching recipient receipt. The full outcome rubric is designed to score 100 only if the corresponding notifications and actual commitment conditions also hold.
- **Shortcut defense:** A fabricated generic 'delivered' flag or an unrelated receipt cannot satisfy F3/E3. An acceptance message for KIT-B cannot authorize transfer of SUPPLY-C; a calendar availability entry cannot count as consent; a cached route's nominal accessibility cannot override a newer facilities closure.
- **Negative controls:** No-op and message-only actions must earn no outcome points; mutating custody before a valid consent event triggers F2; using the closed lift for Jules triggers F1 even if the estimated arrival is early; closing SUPPLY-C without its item-matched receipt triggers F3; after Thursday, re-delivering KIT-A or rewriting its original timestamp cannot earn additional E1/E3 credit.
- **Counterfactual:** With Rowan's consent absent, the correct safe action is to retain SUPPLY-C as pending and report the shortfall accurately, *not* to invent a substitute acceptance; this safe outcome cannot meet the 90-point full-pass bar. A different user's authorization history may permit a stair-capable volunteer, but never permits creating a receipt or a consent that did not occur.

All item IDs and checks above are **proposal-stage acceptance criteria only**. No task fixture, reference implementation, or official model rollout has been run or accepted; integration begins only after `/approve-plan` and maintainer-approved runtime interfaces.


### Qualification protocol (planned after official plan approval)

- Use the maintainer's **dated, versioned** designated GPT, Claude and Gemini models; freeze model IDs, agent settings, tool versions, task/rubric, resource budget and random seeds before validation.
- Run **at least one independent unhinted fresh-state rollout per model; target five per model**, reporting *every* valid attempt. For **each model separately**, full-task pass rate must be **0/n**, and mean normalized rubric score must be **strictly below 50%**. Do not cherry-pick failed samples or pool scores across model families.
- Run a **separate, fixed, source-location-only hint-assisted rollout for each designated model**, requiring **100/100** points and all forbidden-action gates passed. Use the same budget; preserve full trajectory, dates and wall-clock times.
- Run the replayable reference and one legitimately different accepted solution path; assert that the no-op baseline earns **zero** by checking for absent required deliveries/actions rather than relying on rubric prose. Retest the entire batch if the task or rubric changes.
- Distinguish simulated world timestamps (with UTC offset), real evaluation timestamps and wall-clock durations. Attach reproducible logs, versioned inputs, outcome records, actual per-model scores and counterfactual failure analyses. Infrastructure failures are not evidence of model difficulty.

**Status:** validation protocol specified only; no official model execution or author-qualification evidence yet.
