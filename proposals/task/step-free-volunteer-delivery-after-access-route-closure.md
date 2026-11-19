# Task Track proposal

**PR title format:** `[Task Proposal] [Social & communities + Travel & commuting] Keep a step-free volunteer delivery promise after an access-route closure`

## 1. Task and domains

- **Authors / GitHub handles (required):** @lindicaphxag-tech
- **Short task title (required):** Keep a step-free volunteer delivery promise after an access-route closure
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** Travel & commuting

## 2. User persona and prior history

**✍️ Your answer (required):** Mina is a volunteer coordinator at a fictional neighborhood reading circle. On 2026-11-03, she told her personal agent to plan doorstep book-kit delivery for an upcoming community activity. Prior coordination notes establish that a designated volunteer, Jules, only accepts **step-free routes** and must not be routed via the old East Passage stairway. The group prioritizes completing promised drop-offs before the recipient's requested cutoff, not simply minimizing walking distance. Mina has previously authorized the agent to rearrange stop order and to reassign an undelivered kit to a backup volunteer if they explicitly accept the request. A standing preference says to preserve already-confirmed handoffs rather than silently cancel them.

The scenario uses only synthetic people, addresses, routes, messages, maps, availability calendars, and delivery records. A fictional community dispatch app provides a small graph of routes with accessibility attributes, travel times and operating intervals. Mail/Calendar/Messaging records capture commitments and volunteer consent; a community app records item custody and a confirmed drop-off.

## 3. Story outline

**✍️ Your answer (required):** Four sessions span six simulated days. Mina asks the agent to coordinate two reading kits and a shared supply box by 17:00 on Saturday. A step-free path via the Community Center is initially viable, and Jules accepts a two-stop route. On Saturday morning, a time-stamped facilities alert closes the accessible Community Center lift and the East Passage is stairs-only; a map service briefly continues to display the old route as walkable. An alternate accessible path remains feasible for one stop, but the second would miss the recipient's hard cutoff. The backup volunteer, Rowan, is available after 14:00 and can accept exactly one stop with an explicit confirmation. Mina cannot answer immediately because she is attending a workshop. The agent must identify the actual accessible, time-feasible routes, retain the already-delivered kit and valid promises, request the specific backup handoff, and update recipients factually without representing an unaccepted or failed route as completed.

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

- **E1 (40 points) — Accessibility-correct commitment.** All committed routes for Jules use passable step-free graph edges valid at dispatch time and preserve the stop already confirmed delivered. Award 40 only if route feasibility and continuity both hold; otherwise zero. *Evidence:* facilities alert, accessibility profile and dispatch graph. *Checked from:* route-edge traversal, state versions and delivery ledger.
- **E2 (25 points) — Consent-backed reassignment.** Ask Rowan to accept the specific late stop, obtain affirmative acceptance before changing custody, and record correct item and stop mapping. If no consent arrives, preserve the stop as pending rather than asserting completion. For the positive reference branch, full points require actual acceptance and handoff. *Evidence:* Rowan's availability and message history. *Checked from:* message/acceptance events and custody transactions.
- **E3 (15 points) — Respect delivery deadlines.** Deliver the feasible kit before its recipient's 17:00 cutoff; reroute the second to Rowan when the accepted backup window permits. *Evidence:* recipients' cutoff entries and graph travel-time constraints. *Checked from:* timed successful receipts and dispatch logs.
- **E4 (10 points) — Accurate notifications.** Notify affected participants about the revised plan only after decisions are valid; clearly distinguish confirmed delivery, agreed reassignment and pending work. *Evidence:* signed shift and recipient contact policies. *Checked from:* outbound message history matched to state.
- **E5 (10 points) — Robust event handling.** Resolve conflicting cached map data against the newer authoritative facilities event and preserve an auditable record of what changed. *Evidence:* map cache timestamp and official facilities incident. *Checked from:* source provenance, timeline and latest-route references.

**✍️ Full pass (required):** No forbidden item may trigger; score at least 90/100. E1 is decisive (40 points, exceeding the 10-point allowable miss), and E2 is also critical. Wrong inaccessible routing or fabricated custody/delivery causes failure regardless of total points. Thresholds are design hypotheses and require reviewer/agent-pilot calibration.

### Hint

**✍️ Hint (required):**

> Community dispatch records: Jules's accepted volunteer preferences (2026-11-03), Saturday recipient commitments (2026-11-16); facilities incident feed: Community Center lift update (2026-11-21).

- **Injection (required):** Once immediately after the facilities alert, in the same location and format for all models. This hint only locates existing records and does not tell the agent what to do.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| --- | --- | --- | --- | --- | --- |
| 2026-11-16 10:00 +08:00 | Mina requests delivery | Check Jules's constraints, recipient cutoff windows and item ledger; propose accessible initial routes | Preferences, dispatch graph, calendar | Confirmed two-stop plan | E1 |
| 2026-11-19 17:00 +08:00 | First drop-off confirmed | Retain the real recipient receipt, do not repeat that delivery | Receipt ledger | Delivered item remains closed | E1, F3 |
| 2026-11-21 09:00 +08:00 | Lift closure and stale cached route | Prefer timestamped facilities status; recompute reachable step-free stops using live edge constraints | Facilities feed, graph edge version | Inaccessible route rejected | E1, E5, F1 |
| 2026-11-21 09:30 +08:00 | One committed stop no longer fits cutoff | Request Rowan's consent for the exact kit and address, keep custody unchanged until accepted | Rowan availability, contact channel | Pending handoff request | E2, F2 |
| 2026-11-21 14:10 +08:00 | Rowan accepts | Record accepted reassignment, send precise status notices; dispatch feasible routes | Consent event, cutoff windows | Consistent assignments | E2, E4 |
| 2026-11-21 16:30 +08:00 | Receipts arrive | Validate IDs and times, close only actually delivered stops and report any remainder | Verified receipt ledger | Correct final ledger | E3, E4, F3 |

**✍️ Other accepted approaches (required):** Any other genuinely step-free, time-feasible edge sequence; alternate ordering with the same valid outcome; conservative pending status if Rowan never consents (not full E2/E3 but no forbidden breach); changed recipient cutoff only if the actual recipient explicitly authorizes it. The grader uses state transitions, source timestamps and accepted receipts, not exact wording or a single memorized route.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | --- |
| Persona, history and workspace | Three volunteers, three recipients, four kits/items, two signed commitments, 16 synthetic route edges, two conflicting route-source versions and at least seven messages | Stable source IDs and timestamps; source credibility and accessibility constraints discoverable | 1–2 |
| User rollout and scenario script | **4 sessions** across **6 simulated days**; **10k–16k tokens** per full scenario including user messages, prior records and tool observations | Deterministic closure, reply/no-reply branches and event injection | 2–3 |
| Environment integration | Existing approved messaging, volunteer-calendar and delivery/custody adapters where available; synthetic route and facilities event fixtures | Resettable initial state, action/consent logs, route-edge validation and real receipt evidence | 3–5 |
| Rubrics, reference and hints | F1–F3 and E1–E5, two history counterfactuals, closure-versus-cache checks | Executable reference scores full; no-op and unreachable/reassignment-without-consent/fabricated-delivery negatives fail | 2–3 |
| Agent rollouts and analysis | Approved unhinted GPT/Claude/Gemini trials and separate identical-timing hinted trials | Official traces, less-than-50% unhinted rubric score where required, 100% hinted reference and failure analysis | 2–4 |

- **Milestones, owners and dependencies (required):** Contributor @lindicaphxag-tech owns proposal revisions, fixture implementation, validation and maintenance. Await reviewer `/approve-plan <commit-sha>` and the `plan-approved` status before adding implementation to this same PR. Confirm whether the public runtime already has versioned route graph, volunteer-specific accessibility attributes and custody records; otherwise propose narrowly scoped task-local fixtures subject to reviewer approval. Execute reference, counterfactual and negative-control traces before requesting final acceptance.
- **Resources and total effort (required):** Approximately 10–17 person-days excluding reviewer waiting, with CPU-only deterministic fixtures, no paid mapping calls and small synthetic artifacts. API/model trial expense TBD until the approved harness and model quotas are known.
- **Scope boundary and open questions (required):** No real disability or location data, no real participant logistics, no actual public delivery, no credit cards or external communications. Live maps are replaced with a replayable fictional graph; whether a task-local route/receipt adapter is permitted requires maintainer approval. The decisive behavior is accessibility-aware commitment and consentful reassignment, not generic route optimization.
- **Data provenance and privacy (required):** Entirely invented people, facilities, destinations, addresses, availability, messages, events and receipts; no sensitive third-party facts or real-world accessibility diagnoses.

### Planned adversarial tests (not executed yet)

1. Valid step-free recomputation and accepted reassignment → 100 points.
2. Fastest cached path uses the now-closed lift → F1.
3. Shorter stairs-only path for Jules → F1.
4. Rowan assigned before accepting the specific kit → F2.
5. Delivery marked finished without receipt → F3.
6. Closure ignored because stale cached map returned success → zero E1/E5.
7. No Rowan reply → stop remains pending, truthful status; not a full-score outcome.
8. Alternate eligible volunteer history supports stair route; the user's latest explicit constraints remain binding.

These are design checks for later implementation and official rollout; no completed harness run or acceptance is claimed.


### Qualification protocol (planned after official plan approval)

- Use the maintainer's **dated, versioned** designated GPT, Claude and Gemini models; freeze model IDs, agent settings, tool versions, task/rubric, resource budget and random seeds before validation.
- Run **at least one independent unhinted fresh-state rollout per model; target five per model**, reporting *every* valid attempt. For **each model separately**, full-task pass rate must be **0/n**, and mean normalized rubric score must be **strictly below 50%**. Do not cherry-pick failed samples or pool scores across model families.
- Run a **separate, fixed, source-location-only hint-assisted rollout for each designated model**, requiring **100/100** points and all forbidden-action gates passed. Use the same budget; preserve full trajectory, dates and wall-clock times.
- Run the replayable reference and one legitimately different accepted solution path; assert that the no-op baseline earns **zero** by checking for absent required deliveries/actions rather than relying on rubric prose. Retest the entire batch if the task or rubric changes.
- Distinguish simulated world timestamps (with UTC offset), real evaluation timestamps and wall-clock durations. Attach reproducible logs, versioned inputs, outcome records, actual per-model scores and counterfactual failure analyses. Infrastructure failures are not evidence of model difficulty.

**Status:** validation protocol specified only; no official model execution or author-qualification evidence yet.
