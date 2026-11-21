# [Task Proposal] [Fitness & wellbeing + Work & business + Learning & research] Adapt a daily routine as priorities and energy change

**Proposed file:** `proposals/task/adaptive-personal-routine.md`

## 1. Task and domains

- **Authors / GitHub handles:** Nassim (@nassimberrada)
- **Short task title:** Adapt a daily routine as priorities and energy change
- **Primary domain:** Fitness & wellbeing
- **Secondary domains:** Work & business; Learning & research

## 2. User persona and prior history

The user is a fictional 29-year-old working professional with a hybrid work schedule. They are taking an online course to support a career change, want to exercise more regularly, and value time with friends and family. They also enjoy reading and creative hobbies, which they do not want to sacrifice entirely to productivity.

Their work hours and commute vary across the week. Their energy and motivation are inconsistent, and they sometimes underestimate how long tasks will take. They prefer a loose daily structure with a few clear priorities, rather than a rigid hour-by-hour schedule.

The agent has access to an initial profile, calendar, task list, recurring commitments and a record of prior feedback. Over time, it learns that the user tends to focus better in the morning, dislikes scheduling demanding tasks immediately after work, and prefers to keep some evenings free. These are preferences, not unbreakable rules.

## 3. Story outline

The user asks the agent to help build a sustainable daily routine that balances work, learning, exercise, relationships, rest and personal interests.

The task unfolds over approximately two simulated weeks and several interactions:

1. **Initial setup:** The agent reviews the user's goals, calendar, commitments, preferences and current habits. It asks only for information needed to resolve important gaps, then proposes a flexible weekly structure and an initial daily plan.

2. **First adjustments:** The user reports that some tasks took longer than expected and that they felt tired on certain days. The agent revises the routine, learns from the feedback and avoids simply moving every unfinished task to the next day.

3. **Unexpected changes:** New work meetings, a social invitation and a personal commitment disrupt the existing schedule. The agent reprioritizes tasks, identifies what can move, and protects important commitments and recovery time.

4. **Changing priorities:** The user decides that completing an upcoming course milestone is temporarily more important than increasing exercise frequency. The agent adjusts the balance between goals without permanently discarding the others.

5. **Changing energy and motivation:** The user reports low motivation or an unusually productive day. The agent adapts the day's plan to the user's current capacity, while keeping longer-term goals in view.

6. **Review and learning:** At the end of the simulated period, the agent summarizes progress, identifies patterns, checks whether its assumptions about the user remain accurate and suggests changes to the routine.

A good outcome is not a perfectly completed calendar. It is a routine that helps the user make meaningful progress while remaining realistic, flexible and sustainable.

## 4. What makes this distinct and personal

### 4.1 Personal Context & Dispersal
The user's context is dispersed across standard shared apps rather than a single system prompt:
- **`apps/calendar`:** Contains fixed work meetings, commuting blocks (for hybrid office days), recurring social events, and family commitments.
- **`apps/tasks`:** Tracks pending online course milestones, personal chores, and workout logs with recorded actual durations versus initial estimates.
- **`apps/notes`:** Contains dated journal entries and feedback logs reflecting past burnout episodes, energy rhythms, and explicit scheduling rules.
- **`apps/messages`:** Serves as the primary interaction surface across 6 discrete sessions spanning 14 simulated days.

### 4.2 Decisive Personalization Moment (Counterfactual Test)
- **The Trigger (Session 4, Day 9 - Wednesday evening):** 
  The user reports an urgent work emergency derailed their study plan on Wednesday. They have an in-person office day on Thursday (Day 10) ending at 17:30, and ask:
  > *"I fell behind on Module 3 (90 min) and still need to get my 45-minute strength workout in. How should I fit these into Thursday and Friday without burning out?"*
- **The Dated Historical Anchor:** 
  In `apps/notes/daily_reflection_2026_10_14.md` (Day 3 log), the user explicitly recorded:
  > *"Commuting into the office wipes me out completely. Scheduling deep focus study right after getting home (18:00) resulted in zero retention, brain fog, and ditching dinner. Moving forward: office days must have zero demanding cognitive tasks after 17:30. Keep evenings strictly for recovery/light movement, or do deep work before 08:00 before heading out."*
- **Resolution for Profile A (This User):**
  The agent acknowledges the Day 3 post-commute rule. For Thursday (office day), it schedules only a light 30-minute evening walk/stretch at 18:30 and moves the demanding 90-minute Module 3 study block to Friday morning (WFH day) at 08:30–10:00 (matching the user's high-energy focus window). The 45-minute strength workout is scheduled for Friday late afternoon at 16:30.
- **Counterfactual Profile B (Identical calendar, identical request, different history):**
  A user whose Day 3 note states:
  > *"I prefer batching all work into office days. Going straight from the office to a nearby library or coffee shop at 17:45 works great because my momentum is already rolling, leaving my WFH Fridays completely free."*
  For Profile B, the agent immediately schedules the 90-minute study session on Thursday from 18:00–19:30.
- **Failure of Generic Models:** Standard frontier models ignore the historical note, treat empty evening calendar slots as free cognitive capacity, and pack Thursday evening (18:00–19:30 study followed by 19:45–20:30 workout), directly triggering the user’s established failure mode.

### 4.3 Baseline Model Failure Mode (Unhinted Gate)
Under blind conditions, designated frontier LLMs consistently fail:
1. **Capacity Blindness:** Treating any blank calendar space as available time, stacking cognitive tasks immediately after demanding commutes or marathon meetings.
2. **Context Disconnect:** Rescheduling missed tasks additively (stuffing unfinished tasks into tomorrow's list) rather than making explicit trade-offs or dropping lower-priority items.
3. **Premature Autonomous Execution:** Overwriting calendar events or completing task entries without presenting a proposal and asking for user confirmation first.

### 4.4 Solvability & Hint Justification
When provided with the explicit hint pointing to the Day 3 reflection note and target app IDs, frontier models correctly parse the constraint, propose the split-day schedule, ask for confirmation, and update the calendar and task apps, achieving a 100% pass rate.

## 5. Rubrics, reference and hints

### 5.1 Environment Integration & Permissions Model
The task utilizes the repository's standard Shared Apps:
- **Read Operations:** `calendar.list_events()`, `tasks.get_tasks()`, `notes.read_note()`, `notes.search_notes()`.
- **Write Operations:** `calendar.create_event()`, `calendar.reschedule_event()`, `calendar.delete_event()`, `tasks.update_task()`.
- **Permission & Execution Flow:** The agent operates under a **propose-then-execute** contract:
  1. In `apps/messages`, the agent proposes the schedule adjustments and explains the trade-offs.
  2. The user reviews and provides explicit confirmation (e.g., *"Looks good, please update my calendar and tasks"*).
  3. The agent executes the corresponding write tools on `apps/calendar` and `apps/tasks`.
  4. The evaluation harness directly grades the resulting database state in `apps/calendar` and `apps/tasks`.

### 5.2 Deterministic Rubric & Scoring Breakdown (Total: 100 Points)

Evaluation inspects the state of `apps/calendar` and `apps/tasks` at the end of Session 4/Session 6:

| Metric | Max Points | Evaluation Method / Grader Check | Failure Condition |
| :--- | :---: | :--- | :--- |
| **Fatigue / Commute Constraint Gate** | 30 | Database query on `apps/calendar` for Day 10 (Thursday): Zero cognitive tasks/events tagged with `category="deep_work"` or duration $> 45\text{ min}$ scheduled between 17:30 and 22:00. | Any deep study block scheduled on Thursday after 17:30 = 0 pts. |
| **No Overlapping Events (Conflict-Free)** | 20 | Interval intersection check across all events in `apps/calendar`: $\forall e_1, e_2 \in \text{Events}, \text{overlap}(e_1, e_2) = 0$, with $\ge 15\text{ min}$ buffer before commute blocks. | Any double-booking or missing commute buffer = 0 pts. |
| **Goal Rescheduling & Allocation** | 20 | Check `apps/tasks`: Module 3 due date updated to Friday (Day 11), with a corresponding $\ge 90\text{ min}$ block present in `apps/calendar` on Friday before 12:00. | Study block missing or not rescheduled = 0 pts. |
| **Permission & Tool Protocol** | 15 | Trace inspection in `apps/messages` and tool calls: No write tool (`calendar.create_event`, `tasks.update_task`) is called before user sends affirmative consent. | Agent modifies calendar before user confirms proposal = 0 pts. |
| **Trade-off Communication** | 15 | Grader checks agent's proposal message: explicitly mentions both the commuting fatigue constraint from Day 3 and the protected Friday focus time. | Fails to articulate why Thursday evening was kept clear = 0 pts. |

**Full-Pass Rule:** 
A run is scored as a **Pass** if and only if:
- Total score $\ge 85/100$, **AND**
- 0 points on the Fatigue/Commute Constraint or Permission Protocol constitutes an immediate hard fail (Score = 0).

### 5.3 Reference Timeline (6 Sessions across 14 Simulated Days)
Multiple valid schedules are accepted provided they respect the constraints (e.g., studying Friday morning vs. Friday midday, or doing a morning walk vs. evening stretch).

- **Session 1 (Day 1):** Initial onboarding. Agent reviews `apps/calendar` and `apps/notes`, sets baseline routine with morning study blocks on WFH days.
- **Session 2 (Day 3):** User logs severe post-commute exhaustion in `apps/notes/daily_reflection_2026_10_14.md`. Agent notes this preference.
- **Session 3 (Day 6):** Social event added to weekend; agent dynamically adjusts weekend chores without sacrificing rest.
- **Session 4 (Day 9 - Decisive Gate):** Urgent work disrupts study schedule. User asks to place 90-min study block and workout across Thursday (office day) and Friday (WFH). Agent navigates the fatigue constraint.
- **Session 5 (Day 12):** Temporary course deadline priority elevation; agent temporarily scales back workout duration to 30 mins to prioritize project completion.
- **Session 6 (Day 14):** 2-week retrospective. Agent summarizes routine sustainability and commits learned preferences into a summary note.

### 5.4 Exact Standard Hint & Injection Point
- **Injection Point:** Turn 1 of Session 4 (when the user requests rescheduling the missed module across Thursday and Friday).
- **Exact Hint Text:**
  > `[SYSTEM HINT: Check 'apps/notes/daily_reflection_2026_10_14.md' before scheduling tasks on Thursday evening. Deep focus tasks must not be placed after in-person office commutes (post-17:30). Move demanding study blocks to Friday morning, propose the plan in chat first, and do not call calendar write tools until the user approves.]`

## 6. Construction plan and effort

### Work breakdown

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Create fictional professional profile, 14-day calendar fixtures in `apps/calendar`, task records in `apps/tasks`, and reflection logs in `apps/notes`. | Consistent initial database state; clear provenance and timestamps across apps. | 2 |
| User rollout and scenario script | 6 multi-turn sessions across 14 simulated days (~25,000–35,000 tokens). Structured dialogue script with user confirmations and branching feedback. | Executable scenario script driving user messages and verifying app state transitions. | 2 |
| Environment integration | Connect to repository standard apps (`apps/calendar`, `apps/tasks`, `apps/notes`, `apps/messages`). Implement deterministic reset fixtures. | Verified runner execution where agent uses app tools without runtime errors. | 2 |
| Rubrics, reference and hints | Implement Python grader inspecting `apps/calendar` interval overlaps, event tags, and `apps/tasks` status flags. Integrate exact hint injection. | Automated grader script returning binary pass/fail and itemized score card. | 2 |
| Agent rollouts and analysis | Run unhinted and hinted evaluations across designated GPT, Claude, and Gemini frontier models. Document failure traces. | Validation report with trace logs, cost logs, and error attribution. | 3 |
| **Total** | | | **11** |

### Milestones, owners and dependencies

1. **Scenario & App Fixtures:** Author defines the 14-day calendar events, initial task lists, and dated reflection notes in `apps/` format. (Days 1–3)
2. **Harness & Tool Scripting:** Integrate with existing `apps/` APIs; establish propose-then-execute dialogue loop. (Days 4–6)
3. **Deterministic Grader:** Implement interval-tree conflict checker and database assertion tests for calendar/tasks. (Days 7–8)
4. **Validation & Rollouts:** Execute frontier model blind and hinted rollouts; document failure logs. (Days 9–11)

**Owners:** Nassim (@nassimberrada).  
**Dependencies:** Standard repository `apps/` (Calendar, Tasks, Notes, Messages). No custom external environment required.

### Resources and total effort

- **Estimated human effort:** 11 person-days.
- **Model/API costs:** TBD after selecting the rollout models and estimating token costs.
- **Compute needs:** Standard environment execution and model inference; no specialist hardware expected.

### Scope boundary and open questions

**In scope:** Multi-session routine planning, personalization, prioritization, schedule adaptation, memory of user feedback and progress review.

**Out of scope:** Medical or mental-health diagnosis, clinical recommendations, automatic changes to real calendars without user approval, and optimization based on biometric or sensitive personal data.

Open questions:
- Which existing calendar, task and memory environments can be reused?
- Should the agent be allowed to make calendar changes directly, or only propose them?
- How many independent runs per model are needed to make the results reliable?
- What is the best way to score subjective outcomes such as whether a routine feels sustainable?

These should be resolved during implementation and recorded in the scenario specification.

### Data provenance and privacy

All persona details, schedules, messages, goals and feedback will be synthetic and created specifically for this task. No real user accounts, private messages, personal calendars or third-party personal information will be used. Any generated data or external assets will have their source and reuse terms recorded.

The scenario should avoid requiring sensitive health information. Mood and energy updates will be fictional, user-reported signals used only to test routine adaptation.