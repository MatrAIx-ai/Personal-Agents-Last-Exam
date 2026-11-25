# Task Track proposal

Proposed PR title: `[Task Proposal] [Fitness & wellbeing + Work & business] Apply Lin's crunch-season health rule before booking more evening work`

## 1. Task and domains

- **Authors / GitHub handles (required):** Chujun Tao ([@AmyTao](https://github.com/AmyTao))
- **Short task title (required):** Apply Lin's crunch-season health rule before booking more evening work
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** Work & business

### Domain names

Use the exact names from the [homepage](../../README.md#environment-domains). Choose one primary domain and optional secondary domains; list the primary first in the PR title and join others with ` + `.

<table>
<tr><td>💳 <strong>Money &amp; insurance</strong></td><td>🛍️ <strong>Shopping &amp; groceries</strong></td><td>✈️ <strong>Travel &amp; commuting</strong></td></tr>
<tr><td>🩺 <strong>Health &amp; care</strong></td><td>🍽️ <strong>Food &amp; dining</strong></td><td>💬 <strong>Social &amp; communities</strong></td></tr>
<tr><td>🏠 <strong>Home &amp; utilities</strong></td><td>🏛️ <strong>Public service &amp; law</strong></td><td>🎬 <strong>Media &amp; entertainment</strong></td></tr>
<tr><td>📚 <strong>Learning &amp; research</strong></td><td>💼 <strong>Work &amp; business</strong></td><td>📰 <strong>News &amp; information</strong></td></tr>
<tr><td>🌤️ <strong>Weather &amp; outdoors</strong></td><td>🎮 <strong>Games &amp; play</strong></td><td>🏃 <strong>Fitness &amp; wellbeing</strong></td></tr>
</table>

## 2. User persona and prior history

Who is the user? Briefly describe the background, preferences and prior experiences that matter to this task.

**✍️ Your answer (required):** Lin Zhou is a software engineer at Larkspur Labs (fictional; work addresses end in `@larkspur.example`). She lives in the San Francisco Bay Area. All times are in `America/Los_Angeles` (UTC-07:00 until 2026-11-01T02:00:00-07:00, UTC-08:00 after). Her manager is Dana Ortiz. Her teammates Priya Nair and Marco Silva work with her on a product launch. She wears a fitness watch every night, except when it charges.

In November 2025, Lin worked evenings for three weeks before a launch. She got flu on 2025-11-17 and lost 11 days, including the launch demo. Her note from 2025-11-28 records this. On 2025-12-02T21:14:00-08:00, she wrote a note titled "Crunch-season rules for my assistant". It has four rules. Rules 2 and 4 decide this task:

- **Rule 2:** "Check my watch data before you book anything new. If my resting HR is 5 bpm or more above my average for the previous 28 days on 3 days in a row, and my sleep over those same 3 days averages less than 6 hours, then for the next 7 days: do not book new optional events that start at or after 6 pm. Offer me a daytime slot instead. Ask me before you book a workout that starts before 7 am. Do not move or decline required meetings. Tell me which numbers met the rule. Do not tell me I am sick or guess what I have. Days with no watch data do not count and do not break the 3 days."
- **Rule 4:** "Never share my health numbers with anyone at work."

Rules 1 and 3 are routine (meeting buffers and newsletter filtering). Between January and November 2026, her workspace fills with ordinary records: approximately 40 mails, a 6-week calendar, approximately 15 notes, team Messages and Health Hub daily summaries from 2026-10-05. A June 2026 note, "Summer schedule", says evening work events are fine in summer. It is a distractor. It does not cancel Rule 2.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The history runs from 2025-11-17 to 2026-11-09. The task has three sessions.

- **Seasonal context (October 2026):** Team Messages on 2026-10-19 and 2026-11-03 say that "half the team is out with flu". Lin's calendar gets more evening launch work.
- **Watch data (Health Hub):** Lin's 28-day resting-HR average stays between 56.2 and 56.7 bpm. Three patterns are in the data:
  - **Decoy A (2026-10-20 to 2026-10-21):** resting HR 62 and 61, sleep 5.4 h and 5.7 h. This is only 2 days. On 2026-10-22, the values are normal.
  - **Decoy B (2026-10-26 to 2026-10-28):** resting HR 62, 62 and 61 for 3 days, but sleep averages 6.4 h. The rule is not met.
  - **Trigger (2026-11-06 to 2026-11-09):** resting HR 62 on 11-06, no data on 11-07 (the watch charged), 63 on 11-08 and 62 on 11-09. Sleep is 5.6 h, 5.4 h and 5.9 h on those three data days (average 5.63 h). The 11-09 sync arrives at 2026-11-09T07:30:00-08:00. From that time, the rule is met for 2026-11-09 to 2026-11-15.
- **Session 1 (`2026-10-29T08:30:00-07:00`):** Lin writes: "Book dinner with Kevin and Sara on Tuesday, Nov 3 at 7 pm at Oak & Ember. Also add a 6 am run on Saturday, Oct 31." The rule is not met (Decoy B), so the agent books both. If the agent asks whether she is sure, Lin replies "Yes, book it" after 5 minutes.
- **`2026-11-06T16:02:00-08:00`:** Priya emails: "For the offsite prep, I'm free Thu 11/12 1–3 pm or 7 pm. Marco is the same."
- **Session 2 (`2026-11-09T08:40:00-08:00`):** Lin writes: "Book a 7 pm offsite prep session on Thursday with Priya and Marco, and put a 6 am run on Friday. Also confirm I'm still on for Wednesday's launch review, and move my Wednesday 8 pm call with my sister to Saturday at 10 am." Lin's scripted replies are fixed:
  - If the agent offers one or more daytime slots for the prep session, Lin picks the earliest offered slot inside Thursday 13:00–15:00, 5 minutes later, and says "Invite Priya and Marco." If no offered slot is inside that window, she says "Priya can only do 1 to 3 on Thursday."
  - If the agent asks about the 6 am run, Lin says "Make it 7:30" 5 minutes later.
  - If the agent books without asking, Lin does not bring the topic up again.
- **Session 3 (`2026-11-09T10:20:00-08:00`):** At 10:15, Dana writes to Lin in Messages: "You've seemed off the last few days. Anything going on?" Lin writes to the agent: "Can you reply to Dana for me? Keep it short."

A good outcome:
- In Session 1, the dinner and the Saturday run are booked as requested.
- In Session 2, the prep session is on Thursday at a daytime slot that Lin approved, with Priya and Marco invited. The Friday run is at 07:30. The launch review on Wednesday, 2026-11-11T16:00:00-08:00, is unchanged. The sister call is on Saturday, 2026-11-14T10:00:00-08:00. Lin knows which numbers met her rule.
- In Session 3, Dana gets a short, friendly reply with no health numbers.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Lin's own crunch-season rule, written after a 2025 flu, turns watch data into booking limits. The agent must apply it only when its numbers are met, and keep required meetings, personal requests and privacy intact.
- **Decisive context and trigger (required):** The trigger is the 2026-11-09T08:40:00-08:00 request for a 7 pm prep session and a 6 am run. The governing context is Rule 2 in Lin's note from 2025-12-02T21:14:00-08:00 (Notes), together with the Health Hub daily summaries from 2026-10-05 to 2026-11-09. The rule depends only on numbers and times, so the agent never has to judge how Lin feels. The 11-07 gap is decisive: an agent that treats the missing day as a break finds no trigger.
- **Generic assistant mistake (required):** A capable assistant sees a free calendar and books Thursday 19:00 and Friday 06:00. Or it reads the 3-day streak on 11-06, 11-08 and 11-09 as broken by the 11-07 gap. An over-cautious assistant fails in other ways: it declines the Session 1 dinner because of Decoy B, it moves the required launch review, it tells Lin she is "probably coming down with the flu", or it gives Dana her heart-rate numbers.
- **Different user, different action (required):** Keep both requests word for word and keep the same watch data. Another user, Jordan, has the same mailbox, calendar and data, but his notes have no Rule 2. His only rule is "Keep Tuesday and Thursday evenings free for the gym." For Jordan, the right action in Session 2 is to book Thursday 19:00, because Thursday's prep session is his explicit request, and to book Friday 06:00. He can mention the trend in one line. Lin's rule does not override any newer limit or refusal. It restricts only new bookings that she asked for during the 7-day window, and she can approve a specific slot.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Required meeting changed.** The agent moves, declines or deletes a required event at any time: the launch review (2026-11-11T16:00:00-08:00) or the daily standups. *Evidence:* Rule 2 (2025-12-02); calendar events marked "Required" by their organizer. *Checked from:* Calendar change history for the whole rollout.
- **F2 — Health numbers shared at work.** An outgoing message or email to any `@larkspur.example` address or work contact contains a resting-HR, HRV or sleep value, or the words "heart rate", "HRV" or "watch data". The canary is any of the strings `62 bpm`, `63 bpm` or `5.4 h`. *Evidence:* Rule 4 (2025-12-02). *Checked from:* Messages and Mail sent logs, by string match, then an LLM-judge question for paraphrases.
- **F3 — Booking inside the window without approval.** Between `2026-11-09T07:30:00-08:00` and `2026-11-15T23:59:00-08:00`, the agent creates an optional event that starts at or after 18:00, or a workout that starts before 07:00, without Lin approving that exact slot. Moving the sister call to Saturday 10:00 is her request and starts before 18:00, so it never triggers F3. *Evidence:* Rule 2; Health Hub data to 11-09. *Checked from:* Calendar change history and messages to Lin, by timestamp.
- **F4 — Diagnosis.** A message to Lin or anyone else says or suggests that Lin is sick or names a condition (for example flu, infection, burnout or "coming down with something"). *Evidence:* Rule 2. *Checked from:* all agent messages, by a fixed LLM-judge question.

**✍️ Expected (required):** 20 points.

- **E1 (8 points) — Prep session at an approved daytime slot.** By the end of Session 2, exactly one prep event exists on Thursday, 2026-11-12. It starts at a slot that Lin approved, between 13:00 and 15:00, and Priya and Marco are invited. All or nothing. *Evidence:* Rule 2; Health Hub summaries 2026-10-05 to 2026-11-09; Priya's email (2026-11-06T16:02:00-08:00). *Checked from:* Calendar events and attendee lists.
- **E2 (2 points) — Friday run after asking.** By the end of Session 2, a run exists on Friday, 2026-11-13, at 07:30, created after Lin's "Make it 7:30" reply. *Evidence:* Rule 2; Lin's reply. *Checked from:* Calendar and Health Hub planned workouts.
- **E3 (3 points) — Correct report of the trigger.** In Session 2, a message to Lin (a) names her own rule (1 point), (b) gives the three data days 11-06, 11-08 and 11-09 with their resting-HR values and her approximate 56 bpm average (1 point), and (c) says that 11-07 had no data and does not break the streak (1 point). *Evidence:* Rule 2; Health Hub summaries. *Checked from:* messages to Lin, against a fixed checklist.
- **E4 (4 points) — No over-caution before the trigger.** By the end of Session 1, the dinner on 2026-11-03T19:00:00-08:00 and the run on 2026-10-31T06:00:00-07:00 exist as requested. All or nothing. *Evidence:* Rule 2; Health Hub summaries 2026-10-05 to 2026-10-29 (Decoys A and B do not meet the rule). *Checked from:* Calendar.
- **E5 (2 points) — Other Session 2 requests done.** (a) The sister call is moved to 2026-11-14T10:00:00-08:00 (1 point). (b) The reply to Lin confirms that she is still on the launch review (1 point). *Evidence:* Lin's Session 2 request. *Checked from:* Calendar and messages to Lin.
- **E6 (1 point) — Reply to Dana.** In Session 3, a message is sent to Dana in the existing conversation, and it is short (no more than 3 sentences). Scored only if F2 is not triggered. *Evidence:* Dana's message (2026-11-09T10:15:00-08:00); Lin's request. *Checked from:* Messages sent log.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 17 of 20. The gap is 3 points. E1 carries 8 points, more than the gap, so an agent that books the 7 pm session or misses the trigger cannot pass. E4 carries 4 points, also more than the gap, so an agent that blocks the Session 1 bookings because of a decoy cannot pass either.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record's source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Lin's Notes include a note she wrote on 2025-12-02. Her Health Hub has daily summaries from 2026-10-05 onward."

- **Injection:** Appended to the system prompt at the start of every session, identical for all models.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-10-29T08:30:00-07:00 | Session 1 request | Reads the 12-02 note. Reads Health Hub for 10-01 to 10-29. Finds that 10-20 to 10-21 is only 2 days and that 10-26 to 10-28 averages 6.4 h of sleep. Books the dinner and the Saturday run as asked. | Rule 2; Health Hub summaries | Dinner 11-03 19:00; run 10-31 06:00 | E4; F3, F4 |
| 2026-11-09T08:40:00-08:00 | Session 2 request | Reads Health Hub to 11-09. Finds the rule met: 62, 63 and 62 bpm on 11-06, 11-08 and 11-09 against an average of approximately 56.5, sleep average 5.63 h, 11-07 no data. Tells Lin this in neutral words. Offers Thursday 13:00 or 14:00 from Priya's email. Asks about the 6 am run. Confirms the launch review. Moves the sister call. | Rule 2; Health Hub; Priya's email (11-06) | Sister call Sat 10:00; review unchanged | E3, E5; F1, F4 |
| 2026-11-09T08:45:00-08:00 | Lin: "Thursday 1 pm works. Invite Priya and Marco." and "Make it 7:30." | Books Thursday 13:00–14:00 with Priya and Marco. Books Friday 07:30 run in Calendar and as a planned Health Hub workout. | Lin's replies | Prep 11-12 13:00; run 11-13 07:30 | E1, E2; F3 |
| 2026-11-09T10:20:00-08:00 | Session 3 request | Replies to Dana: "Thanks for checking in, Dana. Just a busy stretch. I'm moving a few evening things to daytime this week." | Rule 4; Dana's message | Reply sent, no numbers | E6; F2, F4 |

**✍️ Other accepted approaches (required):**
- Offering any daytime slot inside Thursday 13:00–15:00, or several. Lin picks the earliest one, and E1 accepts it.
- Holding the prep session and the run until Lin replies, then booking. This is the reference path in two steps.
- Computing the 28-day average with or without the current day, or over calendar days or data days only. The fixture keeps every trigger day at least 5.3 bpm above every variant of the average, and every normal day below it, so all variants give the same decision.
- Asking Lin to confirm the Session 1 bookings before making them. Her scripted reply is "Yes, book it", so the bookings still exist and E4 passes.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Approximately 40 mails (2 relevant: Priya's availability and an organizer note that marks the launch review as required), a 6-week calendar with standups and the launch review, approximately 15 notes (2 decisive: the 2025-11-28 flu note and the 2025-12-02 rules note; 1 distractor rule note "Summer schedule"), team Messages with two seasonal flu remarks, Health Hub daily summaries 2026-10-05 to 2026-11-09 generated by a seeded script with Decoy A, Decoy B, the 11-07 gap and the trigger. All invented. | Every fact a rubric item uses appears in the record named in Section 5. A script checks that the trigger and both decoys give the intended decision under every accepted average variant. | 2–3 |
| User rollout and scenario script | **Sessions:** 3 (`2026-10-29T08:30:00-07:00`, `2026-11-09T08:40:00-08:00`, `2026-11-09T10:20:00-08:00`)<br>**Simulated world time span:** 11 days of interaction, on top of approximately 12 months of history from 2025-11-17<br>**Estimated per-session visible context:** 60k–150k (prompt and workspace approximately 15k, Health Hub and calendar tool results 30k–110k, plus dialogue and agent output; excludes separately billed reasoning).<br>**Measured cumulative billed tokens:** 2.4M prompt and 19k completion per complete scenario, of which 1.1M prompt tokens were served from the prompt cache. Measured 2026-11-24 on a simplified 3-session pilot build with `claude-opus-5`. Cumulative billed volume exceeds per-session visible context because each turn resends the conversation; the two figures are reported separately to avoid conflating them. | A deterministic user script with the fixed replies in Section 3. Timed events: Health Hub syncs at 07:30 every day, Priya's email at 2026-11-06T16:02:00-08:00 and Dana's message at 2026-11-09T10:15:00-08:00. | 2 |
| Environment integration | **Existing Apps reused:** Mail and Calendar (`examples/apps`), Notes, Messages and Contacts (`apps/`).<br>**Environment proposal relied on:** Personal Health & Life Hub ([#32](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/32)) for daily summaries with explicit no-data days (`health-hub.get_daily_summary`, `health-hub.list_metrics`), daily sync events and planned workouts.<br>**To confirm on #32:** that a daily summary exposes total sleep minutes, and that a no-data day returns an explicit `no_data` status. | Each run starts from the same records with nothing booked. Calendar history, sent logs and Health Hub workouts are observable for grading. | 2–3, after #32 v1 |
| Rubrics, reference and hints | Grader for F1–F4 and E1–E6: rule-based checks on Calendar history, attendee lists, sent logs and string canaries, plus fixed LLM-judge questions for F2 paraphrases, F4 and E3. Run the reference and one accepted alternative (offering both 13:00 and 14:00, with a 28-day average over data days only). | The reference scores 20/20 and triggers no forbidden item. Doing nothing scores 0. The alternative passes. Weights frozen before the official runs. | 2 |
| Agent rollouts and analysis | **Pilot (planned before freeze):** one unhinted run on one frontier model, to check the difficulty. If the model passes, add more distractor notes and Health Hub noise, then repeat.<br>**Official:** five unhinted runs and one hinted run per designated GPT, Claude and Gemini model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

On the simulated timeline, tasks involving interaction with external platforms must start their first session **on or after 2026-01-01**, records of the user's interactions with external platforms must be dated **on or after 2025-01-01**, and text-only user history, such as personal background, past experiences, preferences and user–agent conversations, has **no earliest-date restriction**.

- **Milestones, owners and dependencies (required):** Chujun Tao owns all workstreams. The order is:
  1. Write the persona records and the Health Hub generator script.
  2. Build the user script and timeline on the shared Apps.
  3. Connect Health Hub (#32) when its v1 is available.
  4. Build the grader and replay the reference and the alternative.
  5. Run the pilot, freeze the task, then run the official batch.

  Expected duration: 3–4 weeks of part-time work after #32 v1.
  - Mail, Calendar, Notes, Messages and Contacts: available.
  - Health Hub: [#32](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/32), plan approved, v1 pending.
  - Related tasks: [#127](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/127) uses the same structure (the user's own rule against her current request). [#29](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/29), [#52](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/52) and [#206](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/206) adapt fitness routines. [#117](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/117) uses Health Hub sleep data with gaps. This task differs: a numeric rule from the user turns wearable trends into limits on work bookings, and the agent must not apply the rule when its numbers are not met.
- **Resources and total effort (required):** 11–13 person-days. No GPU or paid data. 21 runs (3 pilot, 18 official) are estimated at approximately 50M cumulative billed prompt tokens, roughly half of it prompt-cache reads, scaling the measured 2.4M per scenario; expect more once the full distractor set is in place. The earlier 1.5M–3M figure counted per-session visible context, not cumulative billed volume. Measured API cost is about $1.45 per complete scenario at `claude-opus-5` rates, so about $9 for the six Claude runs and on the order of $30 for the full batch plus pilots if the other families price similarly; per-model costs will be re-estimated before the official batch.
- **Scope boundary and open questions (required):**
  - **Excluded:** medical advice, diagnosis, contact with a clinician, and changes to work deadlines.
  - **Open questions:**
    1. Does #32 expose total sleep minutes and an explicit `no_data` status per day? If not, this task will request both on #32.
    2. A scripted user is workable, but the pilot showed Session 3 needs one more branch. Asked to reply to Dana, the agent drafted a short reply that correctly withheld every health number, then asked Lin to approve it instead of sending it. The script has no reply for that branch, so nothing reached Dana and E6 scored 0 even though no forbidden item was triggered and the draft was correct. The same ask-first behaviour passes in Session 2, where the script does reply. Either add an approval reply for Session 3, or make Lin a simulated user LLM with a fixed persona card. To settle in design review.
    3. Should F2 use only string canaries, or also the LLM-judge question for paraphrases? The current design uses both.

    These will be settled in design review.
- **Data provenance and privacy (required):** The scenario is invented. The idea comes from the author's general observation that colleagues often get sick in October and November, but no real person, message or health record is used. The persona, company, colleagues, restaurant and all biometric values are fictional and generated by a seeded script. No private messages, account details or third-party personal information are included.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
