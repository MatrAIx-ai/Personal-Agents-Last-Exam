# Task Track proposal

**PR title format:** `[Task Proposal] [Fitness & wellbeing + Food & dining + Learning & research] Run a weight-gain week for a TA who only does what his calendar tells him`

## 1. Task and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Short task title (required):** Run a weight-gain week for a TA who only does what his calendar tells him
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** Food & dining + Learning & research

## 2. User persona and prior history

Who is the user? Briefly describe the background, preferences and prior experiences that matter to this task.

**✍️ Your answer (required):** Yifan Song is an EE PhD student and teaching assistant with a BMI of 17.5. On Fri 2027-02-26 his dietitian set firm targets starting Monday:
- at least 2,900 kcal and 130 g protein a day;
- 5–6 eating occasions of no more than about 700 kcal each (early satiety);
- full-body lifting three times a week, at least 48 hours apart;
- explicitly: do not change the plan because of a single weigh-in.

He is lactose intolerant and has a $90 weekly grocery budget. His roommate Alex keeps food on the same fridge shelf, which holds eight meal-prep containers.

Memory notes from earlier conversations (2026-09 to 2027-02) record how he actually behaves:
- If something isn't on his calendar with an alert, he won't do it.
- If food takes more than 10 minutes to make, he skips it.
- Never ping him while he teaches, holds office hours or sits in group meeting.
- More than eight buzzes in a day and he silences his phone for the rest of the day.
- After a late night he can't eat breakfast or finish a normal plate.
- Lifting within 90 minutes of a big meal makes him sick.
- Anything substantial after 20:30 gives him reflux.
- When nothing is planned he falls back to a dining-hall sandwich and instant noodles.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** One week, from Sunday evening 2027-02-28 to Sunday 2027-03-07, in Minneapolis (UTC−06:00).

**Session 1 (Sun 20:00).** Yifan asks the agent to "set up my week so it actually happens". The agent runs only when he messages it; calendar alerts are its only way to reach him. A good agent turns the dietitian's targets into alerted calendar events Yifan will follow:
- eating occasions that are each under 700 kcal and ready in 10 minutes;
- three lifts, any cooking, and dependencies such as thawing chicken 24 hours ahead;
- at most eight alerts a day, none in a quiet window.

It also orders groceries that arrive in time, stay in date, fit the fridge, avoid lactose and stay under budget. Substitutions are on by default, so lactose-free yogurt can be replaced with regular yogurt.

The week then moves on its own:
- A Campus Rec mail already in the inbox closes the weight room on Thursday–Sunday evenings.
- On Tue 14:05 the course instructor assigns about 10 hours of midterm grading, due Fri 17:00. If no grading time is on his calendar, Yifan crams two late nights and loses breakfast and appetite on Thursday and Friday.
- Bananas, bagels and milk expire on their own dates.

**Session 2 (Tue 21:40).** Yifan asks only whether a 0.6 kg drop on the scale means he should eat a lot more. A good agent applies the dietitian's rule and changes nothing. It also checks what has changed, finds the grading mail, and schedules ten hours of grading around his meals.

**Session 3 (Fri 20:45).** He asks only for bananas. A good agent checks the pantry, notices that Monday's bagels expire Sunday morning, and fixes the weekend.

A deterministic one-week simulator applies his behavior rules to what the agent put on the calendar, as it stood at each moment, and to what it ordered; it then computes daily intake, workouts and grading.

## 4. What makes this distinct and personal

How does this person's context change the right action, and what might a generic assistant miss?

**✍️ Your answer (required):** Yifan eats, lifts and grades only when an alert tells him to, within quiet hours and an eight-alert cap, so a plan helps him only once it has been turned into alerts, and only if it is kept current as his week changes.

- **Decisive context and trigger:** In session 2 (2027-03-02T21:40−06:00) Yifan asks only about a 0.6 kg weigh-in drop. Two records decide what the agent should do: the instructor's grading mail, delivered to Mail at 14:05 the same day, and the memory note from 2027-01-10 that late nights cost him breakfast and appetite the next day. The agent finds both only if it checks his mail and notes before answering.
- **Generic assistant mistake:** A capable assistant answers the question it was asked well. It cites the dietitian's rule and leaves the plan alone, but it never opens the inbox. No grading time gets scheduled, so Yifan crams on Wednesday and Thursday nights, skips two breakfasts and misses his targets on two days.
- **Different user, different action:** Keep the session-2 message word for word and the same grading mail. Suppose instead his notes said he blocks his own grading time and asked the agent never to schedule work. Then the right action is to answer the weigh-in question and only mention the mail. Rescheduling his week would be wrong.

## 5. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 14 mails (3 decisive: gym closures, grocery substitution policy, the instructor's "grading instructions coming"); a week calendar; Files for the dietitian plan, trainer program, recipes, syllabus and the bathroom scale's weigh-in export (one water-weight dip); 11 memory notes in Notes (8 decisive); Contacts for the dietitian, instructor and roommate; a dated pantry; 15 product pages with real-style serving-size labels. All invented and drafted in the pilot. | Every fact a rubric item relies on appears in the record named in the planned rubric below, and the records agree. The reference earns 30/30. | 2 |
| User rollout and scenario script | **Sessions:** 3 scripted (2027-02-28T20:00−06:00, 2027-03-02T21:40−06:00, 2027-03-05T20:45−06:00), plus 0–3 alert-triggered check-ins the agent can create<br>**Simulated world time span:** 8 days (2027-02-28 to 2027-03-07), on top of memory notes from 2026-09 to 2027-02<br>**Estimated total tokens:** 100k–250k per complete scenario: prompt and workspace about 10k, tool results 40k–150k, plus dialogue and agent output. Excludes separately billed reasoning. | A deterministic user model and timeline, already implemented in the pilot simulator (`simulate.py`). Timed events: grading mail 2027-03-02T14:05−06:00; weight-room closures Thu–Sun 18:00–22:00; delivery windows; expiries; the substitution on the first yogurt order when substitutions are on. Yifan's session messages are fixed. Calendar, orders and pantry carry over between sessions. | 2–3 |
| Environment integration | **Existing Apps reused, unchanged:**<br>- Mail (`examples/apps/mail`): inbox and the grading mail delivered at 14:05.<br>- Calendar (`examples/apps/calendar`): his week and the events the agent creates.<br>- Files (`apps/files`): dietitian plan, trainer program, recipes, syllabus, weigh-in export.<br>- Notes (`apps/notes`): memory notes.<br>- Contacts (`apps/contacts`): dietitian, instructor, Alex.<br>**Environment proposals relied on:**<br>- Calendar alerts, the delivery log and alert-triggered sessions: Reminders and phone notifications ([#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191)), opened by us.<br>- Pantry with use-by dates, leftovers and a meal plan: Platewright ([#196](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/196)), plan approved. The eight-container shelf is a task rule the simulator applies to Platewright's leftover portions (one container per portion), so it needs no new capability.<br>- Grocery ordering with delivery windows and substitutions: FreshCart ([#37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/37)), replacing the pilot's "QuickCart".<br>The weigh-in series moves from Personal Health & Life Hub ([#32](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/32)) to a Files export, since the agent only reads it. The pilot's gym-hours tool is dropped, since closures are already in Mail. | Each run starts from the same records with no orders and no week events. Calendar history, the alert delivery log, orders and pantry state are saved for grading and feed the simulator. | 2–3, after #191, #196 and #37 are available |
| Rubrics, reference and hints | Grader for F1–F5 and E1–E7 in the planned rubric below: the simulator for outcome items, plus an LLM judge for F5, E4 and E7. Run the reference and one accepted alternative (a mid-week check-in). | The reference scores 30/30 and triggers no forbidden item. Doing nothing scores 0: default sandwich and noodles miss E1, there is no grading or lifting, and E5–E6 need scheduled meals. The alternative passes. Weights frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot (done):** one manual run, Claude Opus 5.5 at High effort, Nov 2026, Claude Code as environment, claude.ai incognito. Re-scored under this rubric: 13/30, no forbidden item.<br>- Correct: the static plan, with labels, quiet hours, alert cap, gym closure, substitutions and avoiding the thaw.<br>- E1 = 0: only 4 days on target.<br>- E2 = 0: it never checked mail in session 2.<br>- E5 lost a point when the bagels expired on Sunday.<br>**Official:** five unhinted runs and one hinted run per designated GPT, Claude and Gemini model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams. The order is:
  1. Port the pilot records and simulator onto the reused Apps.
  2. Connect alerts (#191), the pantry (#196) and grocery ordering (#37).
  3. Build the grader and replay the reference.
  4. Run the pilot, freeze the task, then run the official batch.

  Expected duration: 3–4 weeks of part-time work once the dependencies are available.
  - Mail and Calendar: available in `examples/apps`. Files, Notes and Contacts: available in `apps/`.
  - Calendar alerts and alert-triggered sessions: [#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191), opened by us, in implementation.
  - Pantry: [#196](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/196), plan approved.
  - Grocery: [#37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/37), in design review. Blocking for grocery ordering.
  - Related tasks: [#29](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/29) (routine coaching) and [#38](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/38) (grocery restock); [#49](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/49) and [#55](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/55) share the alert-driven user model.
- **Resources and total effort (required):** 10–13 person-days, assuming the dependencies above. No GPU or paid data. 18 official runs plus 3 pilot runs are estimated at 2M–5M visible tokens. API cost is TBD and will be estimated from the pilot before the official batch.
- **Scope boundary and open questions (required):**
  - **Excluded:** clinical nutrition advice beyond the dietitian's written plan, weight change itself (the simulator stops at intake and activity), meal photos, and multi-week adaptation.
  - **Open questions, to be settled in design review:**
    1. Is the deterministic user model (Yifan follows only alerted events, within his rules) acceptable as task-owned scenario logic rather than an App?
    2. Is "the agent only runs when the user messages it" acceptable as a stated property of his setup?
    3. Should borderline expiry timing (an item expiring exactly at a delivery time) be resolved in the agent's favor?
- **Data provenance and privacy (required):** The scenario is entirely invented and not based on any specific real experience. The persona, dietitian, course, roommate, store and products are fictional; prices and nutrition values are typical label values. Health details are generic and framed as a dietitian's written plan, not medical advice. All interactions with external platforms are dated 2027-02 to 2027-03. Memory notes are text-only history from 2026-09 onward. No private messages, account details or third-party personal information are included.

### Planned rubric, hint and reference

All times are UTC−06:00. "The simulator" is the task's deterministic user model. It never reads the final calendar. It replays the week in time order from two time-stamped sources:
- the alert delivery log of #191, which records each alert that actually fired and when;
- Calendar's per-event history, which records when each event was created, moved or edited.

At each moment Yifan acts only on an alert that fired then, for an event as it stood at that time. An event created, moved or edited after its start time changes nothing that already happened, so backfilling a missed lift or meal earns no credit. The replay also reads order history and pantry changes, and produces the consumption, workout and grading log.

**Forbidden.**
- **F1 — Lactose eaten.** Yifan eats any item containing lactose, including regular yogurt substituted for lactose-free yogurt and Alex's yogurt. *Evidence:* memory note 2026-12-12; grocery policy mail 2027-02-27 ("substitutions are on by default"); product pages. *Checked from:* simulator consumption log.
- **F2 — Alert in a quiet window.** An alerted event starts during sleep (23:30–07:30), group meeting (Mon 10:00–11:30), discussion sections (Tue/Thu 14:30–16:20) or office hours (Wed 13:00–15:00). *Evidence:* memory note 2027-02-14; syllabus; Calendar. *Checked from:* the alert delivery log.
- **F3 — Over budget.** Grocery orders for the week total more than $90. *Evidence:* session-1 request and memory notes. *Checked from:* grocery order history.
- **F4 — Roommate's food.** Any plan step uses Alex's food. *Evidence:* memory note 2027-01-27; Alex's mail 2027-02-15. *Checked from:* simulator consumption log.
- **F5 — False report.** The agent says something is scheduled, ordered or achieved when the state shows it is not. *Checked from:* transcript compared with Calendar, order history and the simulator log (LLM judge with state).

**Expected (30 points).**
- **E1 (8) — Daily targets met.** Days on which Yifan reaches both 2,900 kcal and 130 g protein: 7 days earn 8, 6 days earn 6, 5 or fewer earn 0. *Evidence:* dietitian plan in Files (2027-02-26). *Checked from:* simulator intake log.
- **E2 (7) — Grading without cramming.** At least 10 hours of alerted grading blocks between Tue 14:05 and Fri 17:00, outside quiet windows, so no late nights occur. All or nothing. *Evidence:* instructor mail 2027-03-02T14:05; memory note 2027-01-10. *Checked from:* the alert delivery log; simulator log.
- **E3 (4) — Three valid lifts.** Each lift is alerted, at least 48 hours from the previous one, while the weight room is open, and at least 90 minutes after a meal of 500 kcal or more. All or nothing. *Evidence:* trainer program; Campus Rec mail 2027-02-25; memory note 2026-12-05. *Checked from:* simulator workout log.
- **E4 (3) — Weigh-in handled.** In session 2 the agent does not raise intake beyond the plan, and it explains why using the dietitian's single-reading rule. *Evidence:* dietitian plan; weigh-in export. *Checked from:* session-2 transcript (LLM judge) and calendar changes in that session.
- **E5 (3) — Dependencies and dates.** Scored only if the agent scheduled alerted meals on at least five days. 1 point each for: no meal cooked from frozen; never more than 8 containers on the shelf; no planned meal fails for an expired or missing item. *Evidence:* recipes; pantry dates; product pages. *Checked from:* simulator log.
- **E6 (2) — Alert cap respected.** At most 8 alerts fire on every day, scored only if the agent scheduled alerted meals on at least five days. *Evidence:* memory note 2027-02-21. *Checked from:* the alert delivery log.
- **E7 (3) — Session-3 check and honesty.** 1 point each for: checking the pantry or mail before answering; reporting the week's actual shortfalls and their cause; covering the weekend (for example, reordering bagels before they run out on Sunday). *Checked from:* session-3 transcript, orders and simulator log.

**Full pass.** No forbidden item is triggered and the score is at least 24 of 30. The gap is 6 points. Each decisive item, E1 (8) and E2 (7), carries more than that, so an agent that misses either one cannot pass. In practice, missing E2 also costs E1, because the two crammed nights take two days off target.

**Hint.** "Before you reply in each session, check Yifan's mail received since your previous session, his memory notes, and the dietitian plan in his Health folder." Appended to the system prompt at the start of each of the three scripted sessions, identical for all models.

**Reference.**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-02-28T20:00−06:00 | Session 1 request | Reads the notes, dietitian plan, recipes and product labels. Orders groceries for Monday 10:00–12:00 delivery with substitutions off and no yogurt ($79.70 in total). Creates alerted events: chicken thaw Sun 20:30; 5–6 sub-700 kcal meals a day, each ready in 10 minutes; cook Mon 20:30; lifts Tue/Thu/Sat 16:30. No day has more than 8 alerts, and none falls in a quiet window. | Memory notes 2026-10-02 to 2027-02-21; dietitian plan 2027-02-26; Campus Rec mail 2027-02-25; grocery policy mail 2027-02-27 | Order placed; about 40 alerted events | E1, E3, E5, E6; F1–F4 |
| 2027-03-02T14:05−06:00 | Grading mail arrives (agent not running) | None | — | Grading not yet scheduled | — |
| 2027-03-02T21:40−06:00 | Session 2 weigh-in question | Explains the single-reading rule and keeps intake unchanged. Checks mail, finds the grading mail, and adds alerted grading blocks: Wed 08:45 (3 h), Thu 09:00 (3 h), Fri 13:00 (4 h). Also adds a second thaw (Wed 20:00) and cook (Thu 20:00) for the rest of the week. | Weigh-in export; dietitian plan; instructor mail 2027-03-02; memory note 2027-01-10 | 10 h of grading on the calendar; no late nights | E2, E4 |
| 2027-03-05T20:45−06:00 | Session 3 banana request | Checks the pantry and dates. Orders 6 bananas and 1 bag of bagels for Saturday delivery. Reports the week honestly. | Pantry; order history | Weekend meals stocked | E5, E7; F5 |

Replaying this reference in the simulator gives 7 of 7 days on target, 10 hours of grading with no late nights, 3 valid lifts, no lactose and $79.70 spent: 30/30.

**Other accepted approaches.**
- Setting an alerted "message me" check-in, for example Tue 17:00, and scheduling grading in that alert-triggered session.
- Any other foods or quantities that meet the targets within the per-meal, 10-minute, lactose, container and budget limits. This includes avoiding chicken altogether.
- Any split of at least 10 hours of alerted grading that keeps every day's meals on target.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
