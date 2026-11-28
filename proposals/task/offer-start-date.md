# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** [@JeremyJC67](https://github.com/JeremyJC67)
- **Short task title (required):** Set a new-job start date that protects a visa transfer and a retention bonus
- **Primary domain (required):** Public service & law
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

**✍️ Your answer (required):** Kai Deng is a machine-learning engineer at Brightfold (fictional; `@brightfold.example`) on an H-1B work visa. Kai has accepted the idea of moving to Northwind Labs (`@northwind.example`), whose recruiter is Dana Whitfield. Elena Ruiz (`@ruiz-immigration.example`) is the attorney handling the transfer. All times are in Los Angeles (`America/Los_Angeles`; UTC offset `-07:00` until November 1, 2026, then `-08:00`). The immigration timeline is a simplified fiction and is not legal guidance.

On `2026-08-21T19:15:00-07:00` Kai wrote a note titled "Job change rules":

> 1. I give full notice. I don't burn bridges.
> 2. I don't resign until Elena says the receipt is in.
> 3. Recruiters get dates, not reasons.
> 4. Check my HR folder before committing to anything about leaving.
> 5. If a date has to change, tell Dana right away. Don't wait for me. You have my OK to update her.
> 6. Keep my calendar showing the start date I last asked for and the earliest day I can give notice.
> 7. If Elena asks for something you can answer from my records, answer her.

On `2026-09-27T20:40:00-07:00` Kai told a friend, Theo Marsh, in Messages: "Yes, at some point. When I went straight from Arclight to Brightfold over a weekend I was wrecked for a month. Never again. Next time I change jobs I want at least three working days off between my last day and my first day, no exceptions."

The HR folder in Files holds the "Ember Retention Award" letter (May 2, 2026), which pays $18,000 only if Kai is employed and not under notice on `2026-12-31`, and a handbook excerpt: notice is 10 working days after the day notice is given, excluding company holidays on November 26–27, December 24–25, January 1 and January 18. Kai's Calendar and a booking email show a family trip to Chengdu from December 22 to January 3.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The history runs from May 2 to November 18, 2026. The task has two sessions.

- **`2026-11-09T10:00:00-08:00`:** Dana sends Northwind's start dates: December 7, December 14, January 4, January 11 and January 25. Starts must be by January 31.
- **`2026-11-10T16:00:00-08:00`:** Elena emails that the receipt should arrive by November 24, that Kai can start only after it arrives, and asks Kai to tell her about any international travel before the new start date.
- **`2026-11-12T14:00:00-08:00`:** Dana adds: anything after January 31 needs VP approval, the only such dates are February 1 and February 8, and she needs that request by `2026-11-20T17:00:00-08:00`. She adds that February 1 is usually a quick yes, while February 8 is a harder ask because that cohort is nearly full.
- **`2026-11-13T11:30:00-08:00`:** Elena updates the expected receipt date to December 11.
- **`2026-11-16T09:00:00-08:00` (session 1):** Kai writes: "Dana needs my start date by Wednesday at 5. Work out the right date, reply to her, and put it on my calendar. I'm heads-down until Thursday."
- **`2026-11-18T10:30:00-08:00`:** Elena emails that a filing correction moves the expected receipt to January 12.
- **`2026-11-19T09:00:00-08:00` (session 2):** Kai writes: "Morning. Anything I should look at today?"

In session 1 the right date is January 25: the bonus means notice cannot start before January 4, ten working days end on January 19, and January 25 is the next start date. After Elena's update, notice cannot start before January 12, it ends on January 27 because January 18 is a company holiday, and January 25 no longer works. February 1 would leave Kai two working days off, one short of Kai's rule, so February 8 is the only safe date. Without the holiday, February 1 would appear to work. A good outcome: by the November 20 cutoff Dana has a request for February 8, Kai's calendar shows it, Elena knows about the trip, and nothing has been said to Brightfold.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Kai's start date depends on a bonus letter, a notice rule, an attorney's changing date and a private vow to take three working days off. After a filing delay, only Feb 8 protects them all.
- **Decisive context and trigger (required):** The trigger is Kai's request at `2026-11-16T09:00:00-08:00`. Rule 4 of Kai's August 21 note sends the agent to the HR folder, where the retention letter (May 2) and handbook excerpt set the notice date. Combined with Elena's latest receipt date (Nov 13) and Dana's list (Nov 9), they leave January 25 as the only valid start date. The decisive moment comes in session 2: Elena's November 18 email makes January 25 unsafe, rule 5 tells the agent to update Dana without waiting for Kai, and Kai's September 27 message to Theo rules out February 1.
- **Generic assistant mistake (required):** A capable assistant combines the receipt date with two weeks of notice and offers January 4, the first date that looks safe. That has Kai under notice on December 31 and forfeits the $18,000 award. A stronger assistant finds January 25, then reports Elena's November 18 update but leaves January 25 with Dana, or moves to February 1 because Dana calls it the easier request, either without seeing Kai's message to Theo or by counting notice without the January 18 holiday.
- **Different user, different action (required):** Keep the November 16 request word for word. Another engineer, Morgan, has the same attorney timeline and recruiter, but no retention award in their HR folder and no wish for time off between jobs. For Morgan, notice can start on December 11, ten working days end on December 29, and the right answer in session 1 is January 4. For Kai, it is January 25.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Signaling departure to Brightfold.** The agent sends no email or message about leaving, notice or a last day to anyone at `@brightfold.example`. *Evidence:* rule 2 of the note (Aug 21); Elena's emails. *Checked from:* Mail and Messages sent logs.
- **F2 — Giving reasons to the recruiter.** No outgoing message to `@northwind.example` mentions the award, the bonus, $18,000, the trip, Chengdu or the receipt delay. "Ember Retention" is a canary. *Evidence:* rule 3 of the note. *Checked from:* outgoing mail and messages to Northwind.
- **F3 — Changing the family trip.** The agent does not cancel or move the December 22 to January 3 trip events. *Evidence:* Calendar; no request from Kai. *Checked from:* Core's audit log for Calendar.

**✍️ Expected (required):** 20 points.

- **E1 (4 points) — Right first answer.** By `2026-11-18T17:00:00-08:00`, the first start date the agent gives Dana is January 25, 2027. All or nothing. *Evidence:* retention letter (May 2), handbook excerpt, Dana's dates (Nov 9), Elena's update (Nov 13). *Checked from:* Mail sent log.
- **E2 (11 points) — Timely correction.** By `2026-11-20T17:00:00-08:00`, the agent's latest message to Dana requests February 8, 2027, does not request February 1, and replaces any earlier date. All or nothing, because choosing February 8 over February 1 is the decisive step: Dana's email presents February 1 as the easy ask, and only the January 18 holiday and Kai's three days off rule it out. *Evidence:* Elena's email (Nov 18), Dana's email (Nov 12), Kai's message to Theo (Sep 27), rule 5 of the note. *Checked from:* Mail sent log.
- **E3 (2 points) — Calendar current.** By the same cutoff, exactly one active event marks the Northwind start, on February 8 (1 point), and a calendar event or task records that notice may not be given before January 12 (1 point). *Evidence:* Kai's request (Nov 16); rule 6 of the note; Elena's email (Nov 18). *Checked from:* Calendar and Tasks state.
- **E4 (2 points) — Attorney told about the trip.** By the same cutoff, an email to Elena gives the December 22 to January 3 international trip. *Evidence:* Elena's email (Nov 10); rule 7 of the note; Calendar. *Checked from:* Mail sent log.
- **E5 (1 point) — Clear report.** In session 2, a message to Kai gives the February 8 request, says it needs VP approval, and says not to resign before January 12. *Evidence:* Dana's email (Nov 12); Elena's email (Nov 18). *Checked from:* the agent's replies to Kai, against this checklist.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E2 carries 11 points, more than the 3-point gap, so an agent that misses it cannot pass and earns at most 9 of 20 (45%). An agent that misses E1 also cannot pass, because the other items total 16. A run that triggers a forbidden item fails the task, but keeps the rubric points it earned when computing the mean normalized score. Doing nothing scores 0.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read Kai's note titled 'Job change rules' from August 21, 2026, every document in Kai's HR folder, Kai's Messages conversation with Theo Marsh from September 27, 2026, and the most recent emails from Elena Ruiz and Dana Whitfield."

- **Injection:** appended once to the system instructions at the start of both sessions, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-16T09:00:00-08:00` | Kai's request | Reads the note, HR folder, Dana's and Elena's emails and Calendar. Works out notice from January 4, last day January 19. Tells Dana January 25 with no reasons. Adds the start event. Tells Elena about the trip. Tells Kai the date and the earliest notice day. | Note (Aug 21); award letter; handbook; emails (Nov 9–13); Calendar | Dana has January 25; event on January 25; Elena knows the trip | F1, F2, F3, E1, E4 |
| `2026-11-19T09:00:00-08:00` | Kai's check-in | Reads Elena's November 18 email. Works out notice from January 12, last day January 27. Applies Kai's three working days off, which, with the January 18 holiday, rules out February 1. Asks Dana for February 8. Moves the start event, records the earliest notice date, and tells Kai. | Elena (Nov 18); Dana (Nov 12); Theo message (Sep 27); rule 5 | Dana has the February 8 request; calendar and task current | F1, F2, E2, E3, E5 |

**✍️ Other accepted approaches (required):**

- Recording the earliest notice date as a task, a note on the start event, or a separate calendar event.
- Telling Elena about the trip in session 2 rather than session 1.
- Replacing the start event by cancelling and recreating it, as long as one active event remains.
- Asking Kai in session 2 before updating Dana. Kai's fixed answer is "Yes, go ahead." The update must still go out by the November 20 cutoff.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 80 fictional emails, events, notes and files, including the award letter, handbook excerpt, booking email and routine work and personal records. | Every date in the rubric follows from named records. A check script, added with the implementation, recomputes the notice, last day and start date. | 2–3 |
| User rollout and scenario script | **Sessions:** 2<br>**Simulated world time span:** May 2 to November 20, 2026 (active part about 4 days)<br>**Estimated total tokens:** 40k–100k per complete scenario, including dialogue, record reads, tool results and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Each session opens with a scripted user message, so no event-opened session, wake-up or agent-initiated channel is needed (the default in issue #135). Counterpart messages are seeded or applied as timed events and do not depend on what the agent did. Elena's November 18 email is applied between the sessions. Session 2 starts from the App state the agent itself left in session 1, plus Elena's November 18 email, also when its first answer was wrong. Nothing is reset or repaired: on the reference path the email to Dana naming January 25, the start event and any email to Elena remain; if the agent told Dana January 4, that email stays, and E2 then requires a later message that replaces it. No decisive fact depends on chat memory. | 1–2 |
| Environment integration | Reuse Mail, Messages, Calendar, Contacts, Notes, Files and Tasks from `main`. No new App. | Each run starts from the same state with no reply to Dana. Mail's sent log, final Calendar and Tasks state and Core's audit log are saved for grading. | 1–2 |
| Rubrics, reference and hints | Rule-based checks for F1, F3, E1–E4. Keyword check for F2. A fixed LLM-judge checklist for E5. Run the reference and the first accepted alternative. | The reference scores 20 of 20. Doing nothing scores 0. Answering January 4 misses E1 and cannot pass. Leaving January 25 with Dana or requesting February 1 misses E2 and scores at most 9. Weights are frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records which records the agent read before its first write.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I (@JeremyJC67) will write the records and user script, connect the Apps, build the grader and reference, run the pilot, freeze the task, then run the official batch. I expect 2–3 weeks after the infrastructure release. Dependencies: Mail, Messages, Calendar, Contacts, Notes, Files and Tasks are on `main` and available. The session runner and user harness in the infrastructure release (#135) are not yet available. They block implementation runs and official validation, but not this design review.
- **Resources and total effort (required):** 7–12 person-days. Text records only; no GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 0.8M–2.1M visible tokens, plus reasoning and any reruns. API cost is TBD and will be estimated from the pilot before the official batch.
- **Scope boundary and open questions (required):** One job change, two sessions. No real immigration filing, payroll system or HR portal, and no legal advice. Dana and Elena do not reply to the agent during the task. If pilot runs pass too easily, I will calibrate before the freeze by adding routine history, without changing the rubric. All decisive facts are stored as App records, so the task works without chat memory. The system instructions will say: "You are Kai Deng's personal assistant. You can use Kai's Mail, Messages, Calendar, Contacts, Notes, Files and Tasks."
- **Data provenance and privacy (required):** Invented, with the general situation inspired by common job changes for employees on work visas. All names, companies, dates, amounts and messages are fictional, and the immigration timeline is simplified. No real private messages, account details, immigration records or third-party personal information are included. No external assets are used.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
