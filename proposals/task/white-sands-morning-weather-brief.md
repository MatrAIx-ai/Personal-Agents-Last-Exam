# Task Track proposal

Proposed PR title: `[Task Proposal] [Travel & commuting + Weather & outdoors] Brief a once-only White Sands visit on the weather for its actual time window`

## 1. Task and domains

- **Authors / GitHub handles (required):** Minghao Guo ([@minghokwok](https://github.com/minghokwok)).
- **Short task title (required):** Brief a once-only White Sands visit on the weather for its actual time window
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Weather & outdoors

## 2. User persona and prior history

**✍️ Your answer (required):** Kai Lin (fictional) is on a two-week New Mexico / Texas road trip with Ren, a friend visiting from abroad for whom every stop is once-only. Kai relies on the agent's briefs while driving, and spot-checks them with a personal weather app.

The agent built the itinerary (Calendar and memory). On Saturday `2026-09-12`, Kai and Ren drive from Fort Stockton, TX (CDT, `-05:00`) to White Sands National Park, NM (MDT, `-06:00`). They arrive 10:30–11:30 MDT, sled and hike until about 13:00, and leave by 15:00–16:00 for Las Cruces. The dunes are exposed, so lightning and flash floods matter. At `2026-09-11T15:10:00-05:00` the agent gave a correct hour-level brief: low morning chances, rising in the afternoon, a Flood Watch from 18:00 MDT and an evening peak near 88%. Its advice was "go in the morning, be out by 3–4 PM". Kai replied, "Keep me updated on tomorrow's stop."

## 3. Story outline

**✍️ Your answer (required):** Three live sessions span about 11 simulated hours, after seeded history from `2026-09-09`.

- **`2026-09-11T20:30:00-05:00` (event):** The provider raises the park's daily headline to **"Strong Storms, 60%"**, and an outlook warns of strong to severe storms "this evening". The hourly forecast barely moves: 10–25% from 09:00 to 13:00 MDT, 30–45% from 14:00 to 16:00, and 88% at 18:00–19:00. A second provider shows 50% for the day and an 80% peak. The park is open on Saturday; a US-70 test closure is listed for Monday.
- **`2026-09-11T20:45:00-05:00` (S1):** Kai sends only "White Sands?". The agent must infer the request (closures and weather for tomorrow).
- **`~21:15-05:00` (S2, conditional):** If S1 raised an unjustified alarm, Kai pushes back: "My weather app looks fine for the morning — are you sure?" Otherwise Kai says good night.
- **`2026-09-12T07:20:00-05:00` (S3):** "Heading out. Anything changed?" The 05:00 MDT issuance has really changed. The morning is still 10–20%, but the build-up comes earlier: 45% at 14:00 and 60% at 15:00 MDT.

A good outcome keeps the morning, reports risk by part of the day, and moves departure earlier in S3 with a margin.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Kai's once-only White Sands morning is set in Calendar and the agent's own earlier brief; a scarier daily headline reflects evening risk the plan already avoids, so hourly data for Kai's window must decide.
- **Decisive context and trigger (required):** At `2026-09-11T20:45:00-05:00` Kai sends only "White Sands?", 15 minutes after the provider raised the daily headline to "Strong Storms, 60%". The visit window (arrive 10:30–11:30 MDT, on the dunes until about 13:00, leave by 15:00–16:00) is in Calendar and in the agent's memory of its `2026-09-11T15:10:00-05:00` brief. The hourly forecast for that window is available from the weather tool but is not in the headline. In S3 at `2026-09-12T07:20:00-05:00`, the 05:00 MDT issuance moves the build-up earlier.
- **Generic assistant mistake (required):** A capable assistant without Kai's context reads the headline, compresses or cuts the morning, and overturns its own earlier, correct analysis; in the real case behind this task it retracted only after the user checked another source. The opposite mistake, always reassuring, misses the real change in S3 and leaves two people on exposed dunes as storms build.
- **Different user, different action (required):** With the identical message "White Sands?", a user whose Calendar and earlier brief put the dune visit at sunset, from about 16:30 to 19:30 MDT, would be inside the 88% evening peak and the Flood Watch, so the right action is to warn clearly and suggest an earlier visit. For Kai, whose window is the morning, the same headline is no reason to change the plan. The current message adds no new limit; only the earlier itinerary changes the right action.

The core challenge is proactive, context-aware evidence seeking: when a daily summary is too coarse to decide anything about this user's activity window, the agent has to notice that gap on its own. Errors cost both ways: a false alarm wastes an unrepeatable visit; under-warning leaves two people on exposed dunes in lightning. All facts are findable and all tools work; the difficulty is time granularity, time-zone alignment, and consistency with the agent's own earlier analysis.

## 5. Rubric, hint and reference solution

### Rubric

S1 is scored as sent; a later recovery never erases an initial error. Forecast figures are judged against the issuance current when each message is sent, within ±5 points and in MDT.

**✍️ Forbidden (required):**

- **F1: Unjustified alarm in S1.** The S1 reply does not shorten the morning visit, set an exit before 13:00 MDT, or claim a severe-storm risk for the morning, because no hour-level data supports it at that time. *Evidence:* the hourly forecast current at `2026-09-11T20:30:00-05:00` (10–25% from 09:00 to 13:00 MDT); Calendar entries for `2026-09-12`. *Checked from:* the S1 message to Kai and any Calendar edits in S1.
- **F2: Under-warning.** By the end of S3, the agent has not told Kai about the evening storms or the Flood Watch together with advice to be off the dunes before them. *Evidence:* the Flood Watch from 18:00 MDT and the 88% peak at 18:00–19:00 MDT in the issuance current at `2026-09-11T20:30:00-05:00`; the outlook text. *Checked from:* all messages to Kai through S3.
- **F3: Wrong numbers or wrong time zone.** No stated forecast figure differs from the current issuance by more than 5 points, and no hour is given in the wrong local time. *Evidence:* the issuance current at each message's send time. *Checked from:* every number and hour in messages to Kai, against the issuance log.
- **F4: Staying into high-risk hours.** No S3 advice keeps Kai on the dunes into an hour at 60% or above. *Evidence:* the 05:00 MDT issuance of `2026-09-12` (45% at 14:00, 60% at 15:00 MDT). *Checked from:* the S3 message to Kai.
- **F5: Unapproved changes.** No Calendar, booking or message change is made on Kai's behalf without Kai's approval. *Evidence:* Kai's reply of `2026-09-11T15:10:00-05:00` asks only for updates. *Checked from:* Calendar, Mail and Messaging write logs.

**✍️ Expected (required):** 20 points.

- **E1 (7 points): Activity-window evidence.** Uses the remembered window without asking Kai; fetches hourly data for that window before the S1 reply; reports the morning (about 10–25%), the departure period (about 30–45%) and the evening separately, in MDT; answers the closures question (park open Saturday, US-70 test closure on Monday). *Evidence:* Calendar entries for `2026-09-12`; memory of the `2026-09-11T15:10:00-05:00` brief; the hourly forecast and park status current at `2026-09-11T20:45:00-05:00`. *Checked from:* weather tool-call log (time and hours queried) and the S1 message to Kai.
- **E2 (5 points): Daily-vs-hourly interpretation.** Treats the "Strong Storms, 60%" headline as day-wide, not as a morning forecast; places the strongest storms late in the day; makes no unsupported claim about how the daily figure is computed. Scored only if an S1 reply was sent. *Evidence:* the daily headline, outlook and hourly forecast current at `2026-09-11T20:30:00-05:00`. *Checked from:* the S1 message to Kai, by LLM judge with a fixed checklist.
- **E3 (4 points): Justified risk and advice.** Keeps the morning in the plan unless an hour-level change justifies otherwise; gives at least one concrete precaution (extras are never penalised); in S3, gives a departure grounded in the new hourly data with a margin before the build-up. There is no fixed deadline. Scored only if an S1 reply was sent. *Evidence:* Calendar entries for `2026-09-12`; the 05:00 MDT issuance of `2026-09-12`. *Checked from:* the S1 and S3 messages to Kai.
- **E4 (4 points): Uncertainty, sources and recovery.** Surfaces the disagreement between the headline and the hourly data or between the two providers; states a recheck plan and re-queries the forecast in S3; if S2 fires, retracts with hourly evidence and keeps the evening warning (this part is earned automatically if S2 does not fire). Scored only if an S1 reply was sent. *Evidence:* both providers' forecasts current at `2026-09-11T20:30:00-05:00`; the 05:00 MDT issuance of `2026-09-12`; Kai's S2 message if it fires. *Checked from:* weather tool-call log in S3 and messages to Kai.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 18 of 20. E1, the decisive outcome, carries 7 points, more than the 2-point gap, and every other item carries at least 4, so an agent that misses any one of them cannot pass.

### Hint

**✍️ Hint (required):** "Before you continue in this session, re-read Kai's Calendar entries for September 12, your conversation with Kai on the afternoon of September 11 about the White Sands stop, and the most recent hourly forecast issuance for White Sands National Park from each weather provider."

- **Injection:** appended once to the system instructions at the start of every live session (S1, S2 if it fires, and S3), identical for all models.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-09-11T20:45:00-05:00` | Kai sends "White Sands?" | Reads the Calendar entries for `2026-09-12` and the 15:10 brief, then queries both providers' hourly forecasts for 09:00–19:00 MDT and the park status. | Calendar; memory (Sep 11, 15:10); hourly issuance; park status | Window and current evidence known; nothing changed | E1, F5 |
| `2026-09-11T20:50:00-05:00` | Same session | Replies: the park is open Saturday and the US-70 test closure is Monday; morning 10–25%, departure period 30–45%, evening 88% with a Flood Watch from 18:00 MDT; the 60% headline covers the whole day and the storms come late; the second provider shows 50% and an 80% peak. Keeps the morning, suggests leaving the dunes at the first thunder, and says it will recheck in the morning. | Hourly and daily issuance; both providers | S1 message sent; plan unchanged | E1, E2, E3, E4, F1, F2, F3 |
| `2026-09-11T21:15:00-05:00` | Kai says good night (S2 does not fire) | No action. | None | No change | E4 |
| `2026-09-12T07:20:00-05:00` | Kai: "Heading out. Anything changed?" | Re-queries both providers and finds the 05:00 MDT issuance: morning 10–20%, 45% at 14:00 and 60% at 15:00 MDT. | 05:00 MDT issuance | New evidence known | E4 |
| `2026-09-12T07:25:00-05:00` | Same session | Says the morning is unchanged but the build-up comes earlier; advises being off the dunes by about 13:30 MDT, ahead of the 45% hour, and repeats the evening storms and Flood Watch. | 05:00 MDT issuance; Calendar | S3 message sent; morning kept | E3, F2, F3, F4 |

**✍️ Other accepted approaches (required):**

- Answering the closures question before or after the weather.
- Reporting from either provider as primary, provided the disagreement between them is surfaced.
- Giving the S3 departure as a range or a latest time, as long as it is grounded in the 05:00 MDT issuance and leaves a margin before the build-up.
- Adding further precautions; extras are never penalised.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 6–8 Calendar events, 1 motel email, 2 seeded memory sessions, 10–15 distractor messages. | Decisive facts are each discoverable in one plausible place, consistent in time and offset, and never only in grader files. | 1 |
| User rollout and scenario script | **Sessions:** 3 live (S2 conditional) plus 2 seeded.<br>**Simulated world time span:** about 3.7 days (`2026-09-09` to `2026-09-12T07:30:00-05:00`).<br>**Estimated total tokens:** 25k–50k per scenario, covering instructions, seeded context, forecast outputs, dialogue and agent output; excluding grading and hidden reasoning. | Fixed user messages; forecast revisions released on schedule. S2 fires on a fixed, reproducible rule over observable S1 signals (edits that shorten the morning, an exit before 13:00 MDT, a severe-morning claim); details follow approval. | 1–2 |
| Environment integration | Reuse Calendar and Mail (reference Apps in `examples/apps/`, 1.3.0), Messages (`apps/messages`) and infra memory, all in `main` since #12 was integrated. **Weather, first choice:** reuse Gustline ([#126](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/126)), which already covers this task's needs: hourly and daily forecasts with headlines, issuances returned as of virtual time with superseded ones kept, two providers, a Flood Watch, outlook text, per-place time zones, and an `area_closure` alert for park status. **Alternative:** Rainshadow ([#123](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/123)), using its daily summary for the outlook and a task-owned park status. **Fallback:** a narrow task-owned forecast/alert/park-status fixture (2 providers, 3 issuances, no live APIs). The task supplies only the forecast content and release times. | Versioned snapshots; pre-S1 reset; queries return the issuance current at world time, with UTC offsets; tool logs kept. | 1–2 |
| Rubrics, reference and hints | The 20-point rubric (E1–E4) and forbidden items F1–F5 in Section 5, scored by trace checks plus an LLM judge; the reference run, the first accepted alternative and the fixed hint. | The reference earns 20/20; doing nothing earns 0; the first accepted alternative passes; headline-alarm, always-reassure and no-S3-recheck responses fail; ≥90% judge agreement on ≥30 labelled responses; a counterfactual bad-morning fixture makes the reference change plan. | 1–2 |
| Agent rollouts and analysis | After `plan-approved`: a pilot, then freeze; at least 1 unhinted run per designated GPT, Claude and Gemini model (5 recommended), plus 1 hinted run per model. | All traces, scores, configurations, seeds and costs; no run selection; failure analysis; re-run after design changes. The hinted run must score 20/20. | 1–2 |

- **Milestones, owners and dependencies (required):** @minghokwok owns M0 scope, M1 records and script, M2 fixtures and integration, M3 grader validation, M4 pilot, rollouts and analysis; about 3–4 working weeks after approval and interfaces. Blocking: session memory, timed events, conditional turns and the model roster. Calendar, Mail and Messages (#12) and the runtime validation guidance (#61) are now merged into `main`. Related: [#60](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/60) (closed) is about transit replanning, and [#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25) is a campground environment with no forecasts. The weather environments #126 and #123 are open proposals and are not assumed to be implemented.
- **Resources and total effort (required):** 5–9 person-days, assuming reusable PALE infrastructure and coding-agent-assisted implementation (synthetic data, fixtures, scripts, grading logic and test automation); additional effort may be needed if infrastructure adapters are unavailable or the task needs difficulty refinement after the pilot; CPU-only fixtures; 9–21 runs, about 0.25–1.1M visible tokens plus reasoning and judge calls; API cost TBD after the pilot. No difficulty result is claimed.
- **Scope boundary and open questions (required):** One park visit and one forecast day. No live APIs, routing, booking changes or forecast-skill scoring; each issuance is treated as ground truth. Open questions: (a) are memory and timed events infra primitives, or should history be seeded as records? (b) Should S2 be conditional, or an always-run neutral check-in? (c) Should the counterfactual fixture be scored? (d) Which weather environment should this task build on: #126 or #123? Will Gustline keep `area_closure` as an alert type? If neither is available, can the fixture service stay inside this task? **Design risk:** once hourly data is fetched the reasoning is fairly direct; if the pilot is too easy, pre-planned levers (push-notification headline, longer memory, paginated hourly output) are applied before freezing, never broken tools or hidden facts.
- **Data provenance and privacy (required):** Adapted from the author's own experience (accepted in PersonalAgentEval human review). People, dates and party size are fictional; only public place names remain. Forecasts are synthetic but keep the case's causal structure; no provider data, branding or third-party personal information. Code contributions fall under the repository's MIT License. Licensing for synthetic data will follow maintainer guidance, as the Task template does not specify it.

After approval, implementation and evidence follow in this PR under the [Task validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation).
