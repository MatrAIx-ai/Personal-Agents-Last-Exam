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

The central challenge is that the agent must learn how this particular person wants to live, rather than apply a generic productivity system.

The same event can require different responses depending on the user's context. For example, a free evening might be an opportunity for focused study for one user, but important recovery or family time for another. Missing a workout might call for rescheduling, reducing the target or simply letting it go, depending on the user's current priorities and recent workload.

The agent must distinguish between:
- **Goals:** Longer-term outcomes the user wants to achieve.
- **Priorities:** What matters most right now, which may change.
- **Preferences:** How the user likes to structure their day.
- **Constraints:** Fixed commitments, deadlines and practical limits.
- **Current state:** Short-term energy, motivation, workload and mood.

It should remember feedback across sessions, but also recognize when old preferences may no longer apply. It should explain meaningful trade-offs, ask before making consequential assumptions and leave room for spontaneity.

A generic assistant might repeatedly generate an attractive schedule. A successful personal agent should build an evolving understanding of the user and use it to make better decisions as circumstances change.

## 5. Construction plan and effort

### Work breakdown

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Create one detailed fictional persona, a two-week calendar, task and goal records, preferences, historical feedback and changing commitments. | Consistent user profile and records; important personalization facts are discoverable and used in the scenario. | 2 |
| User rollout and scenario script | **Sessions:** 6–8 interactions. **Simulated world time span:** 14 days. **Estimated total tokens:** 25,000–40,000 across all sessions, including dialogue, prior context and tool outputs. | Executable multi-session script with initial setup, schedule changes, feedback, unexpected events, changing priorities and response/no-reply branches. | 2 |
| Environment integration | Reuse available calendar, task and memory environments where possible. Create fixtures and reset logic for the initial profile, commitments and task state. | Runnable task package with reproducible initial state and verifiable schedule/task updates. | 2 |
| Rubrics, reference and hints | Define weighted grading criteria, reference decisions and hints for the main personalization and adaptation challenges. | Rubric with observable checks, partial-credit rules and a feasible reference trajectory. | 2 |
| Agent rollouts and analysis | Run unhinted scenarios on designated GPT, Claude and Gemini models, with additional runs where resources allow. Run hinted scenarios and inspect traces and failures. | Comparable rollout traces, rubric scores and failure analysis. | 3 |
| **Total** | | | **11** |

### Milestones, owners and dependencies

1. **Scenario design:** Define the persona, initial state, goals, constraints and two-week event sequence.
2. **Environment setup:** Identify reusable calendar, task and memory tools; build any missing fixtures and reset logic.
3. **Implementation:** Add the user script, scenario state, grading rubric and reference trajectory.
4. **Validation:** Run the scenario on the designated models, review traces and refine ambiguous grading checks.
5. **Review and merge:** Submit implementation and evidence in the same PR after proposal approval.

**Owners:** Nassim (@nassimberrada).  
**Expected development duration:** Approximately 2–3 weeks, subject to environment availability.  
**Dependencies:** Access to the relevant calendar, task and memory environments; model/API access for rollout testing.

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
