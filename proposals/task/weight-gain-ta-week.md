# Task Track proposal

Proposed PR title: `[Task Proposal] [Fitness & wellbeing + Food & dining + Learning & research] Run a weight-gain week for a TA who only does what his calendar tells him`

## 1. Task and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Short task title (required):** Run a weight-gain week for a TA who only does what his calendar tells him
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** Food & dining; Learning & research

## 2. User persona and prior history

**✍️ Your answer (required):** Yifan Song is an EE PhD student and teaching assistant with a BMI of 17.5. On Friday his dietitian set firm targets starting Monday:
- at least 2,900 kcal and 130 g protein a day;
- 5–6 eating occasions of no more than about 700 kcal each (early satiety);
- full-body lifting three times a week, at least 48 hours apart;
- explicitly: do not change the plan because of a single weigh-in.

He is lactose intolerant and has a $90 weekly grocery budget. His roommate's food shares the fridge shelf, which holds eight meal-prep containers.

Earlier chats give the agent the rules that actually govern his behaviour:
- If something isn't on his calendar with an alert, he won't do it.
- If food takes more than 10 minutes to make, he skips it.
- Never ping him while he teaches, holds office hours or sits in group meeting.
- More than eight buzzes in a day and he silences his phone for the rest of the day.
- After a late night he can't eat breakfast or finish a normal plate.
- Lifting within 90 minutes of a big meal makes him sick.
- Anything substantial after 20:30 gives him reflux.
- When nothing is planned he falls back to a dining-hall sandwich and instant noodles.

The workspace holds about 15 mails, a week calendar, the dietitian plan, recipes, a pantry with dates, grocery product pages, gym hours and a weigh-in log, plus about a dozen memory notes, some irrelevant.

## 3. Story outline

**✍️ Your answer (required):**

**Session 1 (Sunday 20:00).** Yifan asks the agent to "set up my week so it actually happens". The agent runs only when he messages it; calendar alerts are its only way to reach him. A good agent:
- plans six or fewer sub-700 kcal eating occasions a day that are each ready in 10 minutes;
- fits them, three lifts and any cooking into at most eight alerts a day, none in quiet windows;
- orders groceries that arrive in time, stay in date all week, fit the fridge, avoid lactose (substitutions are on by default) and stay under budget;
- respects dependencies such as thawing chicken 24 hours ahead;
- reads nutrition labels correctly ("serving = 2 scoops", "1/4 cup").

The week then moves on its own:
- A Campus Rec mail already in the inbox closes the weight room Thursday–Sunday evenings.
- On Tuesday at 14:05 the course instructor assigns about 10 hours of midterm grading due Friday 17:00. If no grading time is scheduled, Yifan crams two late nights, losing breakfasts and appetite on Thursday and Friday.
- Perishables (bananas, bagels, milk) expire on their own clocks.

**Session 2 (Tuesday 21:40).** Yifan asks only whether a 0.6 kg drop on the scale means he should eat a lot more. A good agent:
- applies the dietitian's rule and changes nothing;
- also checks what has changed in his world, finds the grading email, and schedules ten hours of grading around his meals.

**Session 3 (Friday 20:45).** He asks only for bananas. A good agent checks state, notices what went wrong, and fixes the weekend: for example, it catches that Monday's bagels expire Sunday morning.

**Outcome.** A deterministic one-week simulator applies his behaviour rules to whatever the agent actually put on the calendar and ordered. The task succeeds when, among other conditions:
- at least six of seven days meet both targets;
- no lactose is eaten;
- no alert lands in a quiet window;
- grading is done without cramming;
- three valid lifting sessions happen;
- the budget holds.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** A plan that is nutritionally perfect on paper fails for Yifan, because what he eats is decided by his calendar and his habits, not by the plan document. The right schedule depends on his alert budget, his quiet hours, his 10-minute rule, his satiety ceiling, his reflux cut-off, his post-meal training rule and his roommate's shelf space. None of these appear in the request; all of them are in his history.

The hardest part is that the week keeps changing while the agent is not running. A generic assistant answers the narrow question it is asked ("should I eat more?") well, and never notices that a grading deadline has landed and will cost him two breakfasts. It can also track food dates on day one and then forget them by day seven.

Unlike routine-coaching tasks that grade a sense of balance, here every consequence is computed. A meal either happened or it didn't, and the targets are either met or not.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 15 mails (3 decisive: gym closures, substitution policy, instructor's "grading instructions coming"), a week calendar, the dietitian plan, trainer program, recipes, syllabus, a dated pantry with roommate items and lactose items, 15 product pages with real-style serving-size labels, a weigh-in log with one water-weight dip, and 11 memory notes (8 decisive). All invented; drafted in the pilot. | Every behavioural rule the simulator enforces is stated in at least one artifact. The reference plan reaches all gates. | 2 |
| User rollout and scenario script | **Sessions:** 3 scripted (Sun 20:00, Tue 21:40, Fri 20:45) plus 0–3 alert-triggered check-ins the agent can create<br>**Simulated world time span:** 8 days (Sun evening to the following Sunday), on top of about 4 months of memory notes<br>**Estimated total tokens:** 100k–250k for one complete scenario (prompt and workspace about 10k; tool results about 40k–150k; long session-1 plans dominate) | Deterministic user model and timeline (grading mail Tue 14:05, closures Thu–Sun 18–22, delivery windows, expiries, the delivery that substitutes regular yogurt for lactose-free when substitutions are on) implemented in a one-week simulator. Check-in sessions open when the agent sets an alerted "message me" event. | 2–3 |
| Environment integration | Reuse shared Mail, Calendar (with an alert flag), Files and Notes. Grocery ordering can reuse the FreshCart grocery environment (#37), which already models substitutions and fees. Needs a small pantry/fridge state service with dates and container capacity, a gym-hours page, and a scale log; these can be folded into the task fixture if no household environment is adopted. | Runnable package with reset; calendar events, orders and pantry state are observable and feed the simulator. | 2–3 |
| Rubrics, reference and hints | **Seven gates:** (G1) ≥6/7 days at both targets; (G2) no lactose eaten; (G3) no alerts in quiet windows; (G4) grading finished without cramming; (G5) ≥3 valid lifts; (G6) truthful reporting; (G7) spend ≤ $90. **30 weighted points:** alert budgeting and self check-ins 5; nutrition math 4; dependencies and perishables 4; finding the grading task 5; weigh-in handling 3; substitution risk 3; gym timing 3; S3 state check and honesty 3. Full pass = all gates and ≥24. **Hint** for the feasibility run: "Yifan only acts on alerted calendar events and you only run when he messages you. Check what changed in his inbox and pantry every time you run, and plan around his notes." | Simulator already built (`simulate.py`). The reference plan passes every gate (7/7 days, $79.70); a typical conscientious plan fails 5 gates; doing nothing fails G1 and G5. | 1–2 |
| Agent rollouts and analysis | Five unhinted rollouts per designated GPT, Claude and Gemini model plus one hinted run each, under a frozen script. **Manual pilot already run** (Claude Code as environment, claude.ai incognito, Nov 2026): Opus 5.5 High scored 20/30 and failed G1 and G4. Its static plan was near-perfect (labels, quiet hours, alert cap, gym closure, substitutions, even avoiding the thaw dependency). But in session 2 it answered the weigh-in question without checking mail and missed the grading deadline, and it did not re-check expiry dates late in the week. | Traces, simulator outputs and per-criterion failure analysis; all traces submitted. | 3 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams.
  - **M0:** design review, with pilot materials attached (prompt, harness, simulator, reference and naive plans, transcript).
  - **M1:** port the simulator and user model to the platform's simulated clock and alert-triggered sessions.
  - **M2:** reference and hinted runs.
  - **M3:** full rollout batch.

  Calendar duration: 3–4 weeks of part-time work after the infrastructure release. Dependencies: shared Calendar with alerts and alert-triggered sessions; FreshCart (#37) or an equivalent grocery fixture; the designated model roster. Related: #29 (routine coaching) and #38 (grocery restock) touch nearby themes but neither has computed outcomes or a calendar-driven user model.
- **Resources and total effort (required):** 10–13 person-days. Model and API cost for 18 full runs is estimated at $120–$300. No GPU and no paid data.
- **Scope boundary and open questions (required):**
  - **Excluded:** clinical nutrition advice beyond the dietitian's written plan, weight change itself (the simulator stops at intake and activity), meal photos, and multi-week adaptation.
  - **Open questions:**
    1. Should the user model live in the task (a deterministic simulator) or in the environment (a household or pantry service)?
    2. Same platform question as our other proposal: is "the agent only runs when the user messages it" acceptable as a stated property of the user's setup?
    3. Should borderline expiry timing (an item expiring exactly at a delivery time) be resolved in the agent's favour?
- **Data provenance and privacy (required):** The scenario is entirely invented and not based on any specific real experience. The persona, dietitian, course, roommate, store ("QuickCart"), products and prices are fictional. Nutrition values are typical label values. Health details are generic and framed as a dietitian's plan, not medical advice. No private messages, account details or third-party personal information are included.

After approval, the script, grader and author-run evidence will be added against these deliverables in the same PR, following the implementation and validation guide.
