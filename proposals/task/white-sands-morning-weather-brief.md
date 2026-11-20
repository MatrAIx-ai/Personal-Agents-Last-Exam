# Task Track proposal

Proposed PR title: `[Task Proposal] [Travel & commuting + Weather & outdoors] Proactive Weather Evidence Seeking for Personalized Activities`

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

**✍️ Your answer (required):** The core challenge is proactive, context-aware evidence seeking. When a daily summary is too coarse to decide anything about this user's activity window, the agent has to notice that gap on its own. It must recover the visit window from memory and Calendar and fetch hourly evidence before advising. Here, a scarier headline reflects day-wide and evening risk that the plan already avoids. That is no reason to cut a once-only morning, or to overturn the agent's own earlier, correct analysis.

The decisive context is in Calendar and the 15:10 memory, not in "White Sands?". In the real case behind this task, the agent read the headline, compressed the morning, and retracted only after the user checked another source. Errors cost both ways: a false alarm wastes an unrepeatable visit; under-warning leaves two people on exposed dunes in lightning. S3's real change defeats always-reassure. All facts are findable and all tools work; the difficulty is time granularity, time-zone alignment, and consistency with the agent's own earlier analysis.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 6–8 Calendar events, 1 motel email, 2 seeded memory sessions, 10–15 distractor messages. | Decisive facts are each discoverable in one plausible place, consistent in time and offset, and never only in grader files. | 1 |
| User rollout and scenario script | **Sessions:** 3 live (S2 conditional) plus 2 seeded.<br>**Simulated world time span:** about 3.7 days (`2026-09-09` to `2026-09-12T07:30:00-05:00`).<br>**Estimated total tokens:** 25k–50k per scenario, covering instructions, seeded context, forecast outputs, dialogue and agent output; excluding grading and hidden reasoning. | Fixed user messages; forecast revisions released on schedule. S2 fires on a fixed, reproducible rule over observable S1 signals (edits that shorten the morning, an exit before 13:00 MDT, a severe-morning claim); details follow approval. | 1–2 |
| Environment integration | Reuse Calendar, Mail, Messaging ([#12](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/12)) and infra memory. **Weather, first choice:** reuse Gustline ([#126](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/126)), which already covers this task's needs: hourly and daily forecasts with headlines, issuances returned as of virtual time with superseded ones kept, two providers, a Flood Watch, outlook text, per-place time zones, and an `area_closure` alert for park status. **Alternative:** Rainshadow ([#123](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/123)), using its daily summary for the outlook and a task-owned park status. **Fallback:** a narrow task-owned forecast/alert/park-status fixture (2 providers, 3 issuances, no live APIs). The task supplies only the forecast content and release times. | Versioned snapshots; pre-S1 reset; queries return the issuance current at world time, with UTC offsets; tool logs kept. | 1–2 |
| Rubrics, reference and hints | A 20-point rubric and gates (below), scored by trace checks plus an LLM judge; a reference run and a fixed hint. | Reference earns 20/20; no-op, headline alarm, always-reassure and no-S3-recheck responses fail; ≥90% judge agreement on ≥30 labelled responses; a counterfactual bad-morning fixture makes the reference change plan. | 1–2 |
| Agent rollouts and analysis | After `plan-approved`: a pilot, then freeze; at least 1 unhinted run per designated GPT, Claude and Gemini model (5 recommended), plus 1 hinted run per model. | All traces, scores, configurations, seeds and costs; no run selection; failure analysis; re-run after design changes. | 1–2 |

**Scoring (20 points).** S1 is scored as sent; a later recovery never erases an initial error.

- **Activity-window evidence (7):** uses the remembered window without asking; fetches hourly data for it before S1; reports the morning (about 10–25%), the departure period (about 30–45%) and the evening separately, within ±5 points and in MDT; answers the closures question.
- **Daily-vs-hourly interpretation (5):** treats the headline as day-wide, not as a morning forecast; places the strongest storms late in the day; makes no severe-morning claim and no unsupported claim about how the daily figure is computed.
- **Justified risk and advice (4):** keeps the morning unless an hour-level change justifies otherwise; gives at least one concrete precaution (extras are never penalised); in S3, gives a departure grounded in the new hourly data with a margin.
- **Uncertainty, sources and recovery (4):** surfaces disagreement between the headline and the hourly data or between providers; states a recheck plan and re-queries in S3; if S2 fires, retracts with hourly evidence and keeps the evening warning (this point is earned automatically if S2 does not fire).

**Success gates (all required):** **G1** no unjustified alarm in S1. **G2** no under-warning: the evening storms or the Flood Watch and advice to get off the dunes appear by S3. **G3** every stated number matches the current issuance in the correct local time. **G4** the S3 departure responds to the earlier onset with a grounded margin and keeps the morning; there is no fixed deadline, but staying on the dunes into hours at 60% or above fails. **G5** no unapproved changes. **Full-task success:** all gates and at least 18/20; the hinted run must score 20/20.

**Fixed hint:** "Before you send Kai a weather update, make sure it's about the hours Kai will actually be at the park, and check what the headline number covers."

- **Milestones, owners and dependencies (required):** @minghokwok owns M0 scope, M1 records and script, M2 fixtures and integration, M3 grader validation, M4 pilot, rollouts and analysis; about 3–4 working weeks after approval and interfaces. Blocking: Calendar, Mail and Messaging ([#12](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/12), open), runtime guidance ([#61](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/61), open), session memory, timed events, conditional turns and the model roster. Related: [#60](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/60) (closed) is about transit replanning, and [#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25) is a campground environment with no forecasts. The weather environments #126 and #123 are open proposals and are not assumed to be implemented.
- **Resources and total effort (required):** 5–9 person-days, assuming reusable PALE infrastructure and coding-agent-assisted implementation (synthetic data, fixtures, scripts, grading logic and test automation); additional effort may be needed if infrastructure adapters are unavailable or the task needs difficulty refinement after the pilot; CPU-only fixtures; 9–21 runs, about 0.25–1.1M visible tokens plus reasoning and judge calls; API cost TBD after the pilot. No difficulty result is claimed.
- **Scope boundary and open questions (required):** One park visit and one forecast day. No live APIs, routing, booking changes or forecast-skill scoring; each issuance is treated as ground truth. Open questions: (a) are memory and timed events infra primitives, or should history be seeded as records? (b) Should S2 be conditional, or an always-run neutral check-in? (c) Should the counterfactual fixture be scored? (d) Which weather environment should this task build on: #126 or #123? Will Gustline keep `area_closure` as an alert type? If neither is available, can the fixture service stay inside this task? **Design risk:** once hourly data is fetched the reasoning is fairly direct; if the pilot is too easy, pre-planned levers (push-notification headline, longer memory, paginated hourly output) are applied before freezing, never broken tools or hidden facts.
- **Data provenance and privacy (required):** Adapted from the author's own experience (accepted in PersonalAgentEval human review). People, dates and party size are fictional; only public place names remain. Forecasts are synthetic but keep the case's causal structure; no provider data, branding or third-party personal information. Code contributions fall under the repository's MIT License. Licensing for synthetic data will follow maintainer guidance, as the Task template does not specify it.

After approval, implementation and evidence follow in this PR under the [Task validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation).
