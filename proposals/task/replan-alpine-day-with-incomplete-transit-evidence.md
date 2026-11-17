# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** @paralym. AI-assisted analysis and drafting based on author-provided travel experience.
- **Short task title (required):** Keep an alpine day trip feasible when the timetable stops matching the street
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Weather & outdoors

## 2. User persona and prior history

**✍️ Your answer (required):** Lin and a companion are based in a valley town for a short autumn trip. They have a regional guest pass, prefer public transport and short walks, and want both a small chapel view and a mountain panorama when feasible. Earlier messages clarify that “see everything” means these valued experiences, not a long hike or returning exhausted before an early reserved train. Lin is willing to consider a quoted taxi within a previously stated limit if it preserves a priority experience, but has not authorized open-ended spending or cancellation of the onward train.

Their history contains a normal-day route, a more conservative alternative, the location of their hotel, a fixed next-morning departure, a bilingual stop alias, and a prior request to verify transport before selecting timed attraction tickets. Preferences and authority are explicit and accessible. A later request to avoid rushing does not erase the preferred views; permission to consider a taxi does not make taxi the default for every leg.

## 3. Story outline

**✍️ Your answer (required):** Across four sessions over about 36 simulated hours, a planned afternoon valley visit meets late arrival, an apparently missing bus, a temporary boarding relocation, and a diminishing daylight window. A good outcome is a feasible, clearly communicated plan that uses current evidence, preserves the most valuable attainable experience, and protects the return and next-day commitment. It need not visit every stop or magically predict a delay.

1. **Before travel:** The agent builds the initial plan from current reservations, a guest pass and earlier preferences. Published schedules permit multiple routes; the fastest-looking connection has little walking/boarding margin. The agent can prepare fallbacks and concise bilingual boarding instructions.
2. **Arrival changes:** Lin reports a delay and needing time for essentials. An official-looking planner still lists its scheduled connections. The agent must compare surviving alternatives rather than simply shift every activity by the same delay or insist on an earlier route already superseded by an equivalent later departure.
3. **At the interchange:** Lin says the bus has not appeared. The planner lacks a clear roadwork instruction. A user-provided station photo shows a dated temporary stop notice; a scene query or request to inspect the sign supplies the location and a safe walking path. A simulated operator inquiry supplies limited service-status information with a timestamp, not perfect future knowledge. The agent should distinguish “late,” “wrong boarding point,” and “unknown,” then give a specific next action and a bounded wait/leave rule.
4. **After the decision:** The script reports progress and remaining daylight. The agent revises the visit/return together and preserves the onward reservation. It delivers a short current instruction card with superseded alternatives clearly marked; it does not continue presenting an old timetable as the active plan.

Two main event variants are planned: (A) a relocated stop with a delayed but catchable service and (B) an inaccessible or no-longer-useful connection, with a quoted fallback or a shorter local outing. A third no-roadwork control checks that the agent does not always invent disruption or recommend a taxi. Asking for decisive missing evidence, waiting briefly with a deadline, switching transport, shortening the visit, or abandoning the excursion can all be valid depending on the available facts.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** A timetable can be accurate as a publication and still be insufficient to guide this traveler standing at a particular stop. The agent must reconcile street-level observations with stale service data while remembering what Lin values, what the guest pass covers, the companion's pace, and tomorrow's departure. The same late bus warrants a different decision for a traveler prioritizing a photograph, a low-cost outing, or an early return.

This is not a test of knowing an undisclosed road closure. The decisive evidence is discoverable and timed. It is a test of recognizing when the evidence supporting an earlier plan is no longer adequate, obtaining the missing observation economically, and updating the whole travel commitment rather than just one leg. “Official app says so” is not sufficient certainty, but neither is a delayed vehicle proof that a service was canceled.

Related proposal [#47](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/47) concerns flight/hotel/transfer repair with provider arrangements; this task focuses on partial local observability, pedestrian boarding access, uncertain waiting and daylight-sensitive outdoor goals. [#44](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44) is a potential future hotel integration, not a dependency. The companion offline-guide task evaluates proactive media availability, not routing; these are distinct outcomes sharing only the underlying travel workspace.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 12–16 synthetic messages, 2 route versions, 1 onward reservation, guest-pass rules, 12-stop network, 4 timetable patterns, 3 scene images/notices | Provenance/timestamp map; consistent aliases, dates and service days; preferences and monetary authority accessible without privileged state | 2–3 |
| User rollout and scenario script | **Sessions:** 4<br>**Simulated world time span:** 36 hours<br>**Estimated total tokens:** 30k–50k for one scenario across sessions, including prior context, dialogue, route queries and other tool outputs; excluding private reasoning and image bytes | Executable arrival/interchange/progress branches; reply/no-reply paths; three variants with logged clock costs and deterministic schedules | 3–4 |
| Environment integration | TrailPocket itinerary, planner, evidence viewer, scene/phone observations, quotation fixture and daylight/return constraints; no real calls or purchases | Resettable task adapter; hidden event state inaccessible; every decisive fact has a documented agent-visible discovery path | 2–4 |
| Rubrics, reference and hints | Time-expanded route feasibility checks, personal-value rubric, decision-time uncertainty audit, 3 reference strategies and at least 7 negative controls | Feasible references pass; valid stop/shorten decisions accepted; brittle transfer, stale sign, wrong stop, excessive taxi spend and obsolete return handled correctly | 3–5 |
| Agent rollouts and analysis | Plan 5 independent unhinted runs per designated GPT/Claude/Gemini model and one separate hinted run per model, frozen task/config/budget | All 18 traces and per-model scores/costs; observable-evidence failure taxonomy; independent fresh-reset reproduction | 3–5 |

### Proposed grading and fairness

| Criterion | Points | Evidence |
| :--- | ---: | :--- |
| Maintain the current personal priorities, pass coverage and onward commitment | 20 | Itinerary/version history and authorized actions |
| Identify missing evidence and reconcile planner, scene and operator observations | 20 | Evidence provenance, timestamps and requested observations |
| Choose an achievable current route, boarding location and fallback/wait cutoff | 25 | Route graph, pedestrian access and decision-time information |
| Reconcile daylight, visit duration, return and next-day rest constraints | 20 | Time-window checks and actual scripted progress |
| Communicate concise current actions and propagate changes without unauthorized spending | 15 | Latest delivered instructions, superseded-plan state and spend log |

Full-success gates: an achievable protected return/onward connection; no instruction to board at a known inaccessible stop; no unauthorized commitment; and no asserted confirmed service status without supporting evidence. A shortened outing can pass if it is justified under the frozen personal priorities and information available. Feasibility accounts for finding the boarding point and walking to it, not only vehicle arrival/departure times.

The evaluator logs what was observable at each decision. It must not grade against future hidden events or demand that the agent foresee an unannounced disruption. Branches with no timely recoverable excursion must allow an honest local alternative or return. Delay ranges are supplied as observed operational uncertainty, not fabricated probability estimates. Scenario variants guarantee at least one feasible policy under the information available. All reference policies are tested against the entire event set, including normal-service controls.

Negative controls include doing nothing, repeating the static schedule, mistaking a train board for the current train's stops, waiting indefinitely, choosing a tight connection without walking time, overspending on a taxi, and compressing two full outings into an exhausting day despite a protected early train. The optional hint points to the user's earlier return constraint and the distinction between a scheduled stop and a currently usable boarding point; it does not reveal a route or hidden event.

- **Milestones, owners and dependencies (required):** Proposed owner @paralym. M1: freeze personal priorities and evidence visibility; M2: build route/event/user scripts on [TrailPocket environment proposal #58](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/58); M3: check reference feasibility and negative controls; M4: freeze designated model roster/budgets and run the entire batch; M5: fresh-state reproduction. Expected task duration 3–5 calendar weeks after environment/interface availability. Shared environment is blocking for execution; an equivalent existing controlled transit environment can replace it after design review.
- **Resources and total effort (required):** 13–21 person-days of task work, excluding shared environment construction. Eighteen planned runs at roughly 540k–900k scenario tokens before reasoning overhead; provisional USD 100–600 model budget, to be revised after the evaluation roster and a harness-cost pilot. A browser runner, fixture server and time-expanded route checker are sufficient; no real transport account or commercial routing API required. These are estimates, not executed trials or promised qualification results.
- **Scope boundary and open questions (required):** No live bus tracking, unrestricted real-world map search, emergency rescue, actual taxi dispatch, flight rebooking or lost-baggage workflow in v1. These would dilute the local-observation test. Walking durations, daylight window, permissible quotation actions and per-action simulated time will be finalized with maintainers before implementation. The grader will accept multiple routes and conservative decisions where justified, rather than hard-code a single itinerary. Design difficulty remains unmeasured; all runs will be disclosed and a changed task version requires a complete validation rerun.
- **Data provenance and privacy (required):** Transformed from the author's Italy/Spain travel experience. Reviewed interactions include delayed arrival, repeated timetable replanning, a bus reported missing, a subsequently corrected boarding-location instruction, and conflicts between completeness and fatigue. The author additionally reports unreliable bus timing and roadworks not clearly explained by the official app. Those reports motivate synthetic event branches; they do not establish the historical cause of any missed bus. No raw chats, real passenger identities, private booking references, payment details or third-party personal information are published. All dates, traveler details, route schedules, reservations, photos and notices used for evaluation will be invented, with original or explicitly licensed assets. The public transit website is an interaction reference, not a source of asserted current travel advice.

Validation will follow the [repository protocol](../../CONTRIBUTING.md#task-difficulty-and-validation): at least one unhinted rollout per designated model (five planned), 0/n full passes and mean score strictly below 50% separately for each model, and a separate hinted run per model with 100% and every gate passed. No such result is claimed at proposal stage.
