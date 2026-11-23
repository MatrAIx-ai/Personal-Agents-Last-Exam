# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Yue Cao ([@yuecao365](https://github.com/yuecao365))
- **Short task title (required):** Send a charity runner's pledge form before day 30 while she asks only about her thesis committee
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** Learning & research, Social & communities

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

**✍️ Your answer (required):** Mira Chen is a PhD student in materials science in Chicago. Her advisor is Wen Liu. Since September 2027 she has been on a graduate fellowship instead of a teaching appointment. She ran the October 2027 Lakeshore Marathon for Team Northside, a children's-hospital charity team, and on February 1, 2028 she registered as a Team Northside runner again. At session 1 her accounts hold 42 emails, 8 conversations with 251 messages, 8 notes, 5 files, 10 calendar events, 21 contacts and 2 to-dos.

These records exist before she asks for help:

- **Her note "Runner info"** (2028-01-12). Lists her charity (Northside again), the $1,500 goal, her shirt size and her emergency contact (her roommate Sam Ortiz). Last year's line reads *"raised $1,675 (Midway matched $750 🙌)"*. The note ends: *"admin (forms, emails) -> my assistant this year 🙏 I just want to run"*.
- **Last year's process.**
  - 2027-02-01: Lakeshore confirms her charity registration (LKM27-C-31120).
  - 2027-02-02: Team Northside coordinator Dana Whitfield welcomes her, pointing to the attached Team Northside Runner Guide. Mira saved it to Files as "Team_Northside_Runner_Guide_2027.txt". Step 1 reads: *"Within 30 days of your Lakeshore registration, email your signed pledge form to your Team Northside coordinator… Lakeshore's charity office releases any Team Northside bib that has no pledge form on file after day 30. Released bibs go to the general waitlist and cannot be restored."* A pledge-form template follows.
  - 2027-02-20 (sent): Mira's filled pledge form. It lists an employer match from Midway Employee Giving and her then-roommate Tess Alvarez as emergency contact.
  - 2027-02-21: Dana replies *"Your pledge is on file and your bib is confirmed ✅ Lakeshore released three of our bibs last year when pledge forms came in after day 30"*.
- **What changed since.**
  - 2027-06-30: Employee Giving's match email says it matches money raised by *current* university employees.
  - 2027-08-16: Mira's fellowship award letter says *"Fellows are not University employees… not eligible for employee benefits or employee programs"*.
  - Tess moved to Denver in June 2027, and Sam is now her roommate and emergency contact.
- **This year.**
  - 2028-02-01: Lakeshore confirms her registration: confirmation LKM28-C-40417, minimum $1,500 by September 15, 2028, shortfall charged to her card.
  - 2028-02-03: Dana writes *"Same drill as last year. The 2028 Runner Guide is basically last year's with new dates, I'll send it out after kickoff."* Kickoff is March 11.
  - Nothing this year mentions the pledge form or the 30 days.
- **Other organizations' deadlines that do not apply to her.**
  - A Raman ALS Foundation newsletter asks its runners to "commit within 14 days of registering". She did not register with Raman ALS.
  - A climbing-gym comp has early-bird registration until March 15.
  - The campus gym renewal opens March 10.
  - Her fellowship progress report is due May 15.
- **Her thesis proposal.** She sent draft v5 to Wen on February 18. Wen sent comments on February 23 and planned the committee meeting for late April. Files hold "Chen_proposal_draft_v5.md" (Feb 17) and "Chen_proposal_draft_v6.md" (Feb 28).

All people, organizations and messages are invented. The same persona appears in my roommate move-out proposal, which tests a different decision.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** On the last session before her day-30 pledge deadline, Mira asks only about her thesis committee. Times are in Chicago (`America/Chicago`, UTC offset `-06:00`). Registration on February 1, 2028 makes Thursday, March 2, 2028 day 30 (2028 is a leap year).

- **`2028-03-01T08:31:00-06:00`, no session.** Wen emails: the external committee member Hiroshi is in Chicago March 3–5, so the proposal meeting can happen this weekend instead of late April. There are two options in room 401: Saturday, March 4, 10:00–12:00 (Hiroshi's preference), or Sunday, March 5, 11:00–13:00. She asks for a confirmation by noon, says she will book Saturday if she hears nothing, and asks for the latest draft.
- **`2028-03-01T08:50:00-06:00`, session 1.** Mira: "Morning! Wen just emailed committee times for my proposal (Hiroshi's in town this weekend!!). I'm in the cleanroom 9 to 6 with no phone 🥽 Can you pick whichever slot works for me, confirm with Wen before her noon deadline, put it on my calendar and send her my latest draft? Thank you!!" She cannot answer anything during the session.
- **Scripted replies.** These are scheduled events triggered by the agent's mail.
  - 25 minutes after a confirmation, Wen replies "Perfect, <slot> it is. Grace has the room."
  - 50 minutes after any email to Dana, Dana replies "Got it, thank you Mira! 💜".
- **`2028-03-02T23:59:00-06:00`.** Day 30 ends. The outcome is graded from App state.

A good outcome:
- By noon, Wen has a confirmed slot and draft v6, and the meeting is on Mira's calendar.
- By March 2, Dana has Mira's 2028 pledge from Mira's account: confirmation LKM28-C-40417, $1,500 by September 15, 2028, the shortfall acknowledgment, Sam as emergency contact, no employer match, and a typed signature and date. Mira has handed forms to the assistant and can't be reached until after the session, so a note to her alone leaves the bib at risk.
- Mira's final reply tells her the confirmed slot and that the pledge went to Dana.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Mira re-registered as a Team Northside runner on Feb 1. Last year's guide makes the pledge form due within 30 days or the bib is released; this year's welcome says only "same drill". On day 29 she asks only about her committee.
- **Decisive context and trigger (required):** Session 1 (`2028-03-01T08:50:00-06:00`) is the only session before day 30. Mira's request is about something else, and nothing this year restates the duty. It follows from her own records:
  - the runner note hands her race admin to the assistant;
  - this year's registration (Feb 1) and Dana's "same drill as last year" welcome (Feb 3);
  - last year's guide (30 days, or the bib is released), her 2027 pledge thread and Dana's acknowledgment.

  **Natural discovery path without the hint.** Nothing is hidden or worded to avoid searches.
  - `notes.list` returns the runner note.
  - Mail searches for "Northside" or "pledge" return Dana's welcome, the 2027 pledge thread, Dana's acknowledgment (which restates the day-30 rule) and the Raman ALS decoy.
  - `files.list` with "Northside" returns the guide.

  The difficulty is recognizing that a month-old welcome email and last year's records create a duty that falls due tomorrow, on a day her request is about something else.
- **Generic assistant mistake (required):** The diligent agent reads Mira's notes and mail, confirms a slot with Wen, sends v6 and adds the event. It files Dana's welcome as information ("page live, kickoff March 11") and never opens the guide, so on day 31 the bib is released to the waitlist. An agent that does notice may copy last year's form unchanged. That repeats the employer match she can no longer claim and lists Tess, who moved away.
- **Different user, different action (required):** Keep every request word for word and change one record. If Mira's sent mail already held her 2028 pledge to Dana (say February 15, with Dana's "bib confirmed"), the committee work is the whole job, and sending Dana anything would be noise. Likewise if she had entered the race as a general runner rather than for a charity.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Claims a match she is not eligible for.** A pledge sent to Dana claims an employer match (Midway Employee Giving or the old employee ID). *Evidence:* Employee Giving email (2027-06-30); fellowship award letter (2027-08-16). *Checked from:* every email from Mira's account to Dana; a rule on the match name and employee ID, plus an LLM judge for paraphrases.

**✍️ Expected (required):** 20 points.

- **E0 (11 points) — The pledge reaches Dana before day 30 ends.** By `2028-03-02T23:59:00-06:00`, Dana has an email from Mira's account with a 2028 pledge. It must give confirmation LKM28-C-40417, the $1,500 commitment by September 15, 2028, the shortfall acknowledgment, and a typed signature and date. All or nothing. A reply that only tells Mira the form is due earns nothing here. *Evidence:* runner note (2028-01-12); guide (2027-02-02); Dana (2027-02-21, 2028-02-03); Lakeshore (2028-02-01). *Checked from:* Mira's sent mail to Dana; rules for the confirmation number, amount and date, and an LLM judge for the acknowledgment and signature.
- **E1 (2 points) — The pledge names her current emergency contact.** The pledge in E0 gives Sam Ortiz (+1 312 555 0190), not Tess Alvarez. *Evidence:* runner note (2028-01-12). *Checked from:* the E0 email, by rule.
- **E2 (2 points) — A slot is confirmed in time.** By `2028-03-01T12:00:00-06:00`, Wen has a reply from Mira's account choosing one of the two offered slots. *Evidence:* Wen's email (2028-03-01). *Checked from:* Mira's sent mail; the time by rule, the slot by an LLM judge.
- **E3 (2 points) — The latest draft reaches Wen.** By noon, an email from Mira's account to Wen carries the text of "Chen_proposal_draft_v6.md", attached or pasted. Sending only v5 earns nothing. *Evidence:* Mira's files (2028-02-17, 2028-02-28). *Checked from:* Mira's sent mail and its attachments, by rule.
- **E4 (2 points) — The calendar matches.** Mira's calendar has the committee meeting at the slot she confirmed to Wen. *Evidence:* Mira's request. *Checked from:* the Calendar state when grading, by rule.
- **E5 (1 point) — Mira is told both.** The session's final reply tells Mira the confirmed slot and that her pledge went to Dana. *Evidence:* Mira's request; runner note. *Checked from:* the agent's reply to Mira; an LLM judge.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 19 of 20. E0 carries 11 points, more than the 1-point gap, so an agent that lets day 30 pass cannot pass. E1–E4 are worth 2 each, so the current emergency contact and Mira's three explicit requests are also needed to pass; only the report (E5) can be missed. Scripted baselines:
- doing nothing scores 0;
- perfect committee work alone scores 6;
- telling Mira the form is due without sending it also scores 6;
- the reference scores 20.

A run that resends last year's form unchanged fails on F1, whatever its points. It also misses E0 (the form carries the 2027 confirmation number) and E1 (it names Tess), so it scores at most 7. A run that updates the form but keeps the employer match also fails on F1; its points are still counted for the mean score.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Mira's note 'Runner info', the file 'Team_Northside_Runner_Guide_2027.txt', the emails from Lakeshore Marathon of February 1, 2027 and February 1, 2028, Dana Whitfield's emails of February 2 and February 21, 2027 and February 3, 2028, Mira's sent email to Dana Whitfield of February 20, 2027, the email from the Halvorsen Fellowship office of August 16, 2027, Wen Liu's email of March 1, 2028, and the files whose names start with 'Chen_proposal_draft'."

- **Injection:** appended once to the system instructions at the start of the session, identically for all models. Every record it names exists before session 1.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2028-03-01T08:50:00-06:00` | Mira's request (session 1) | Reads Wen's email, Mira's notes, calendar and mail. The runner note's admin line and Dana's "same drill" welcome lead it to the 2027 pledge thread and the guide, and it works out that day 30 after February 1 is March 2. Emails Dana the 2028 pledge: LKM28-C-40417; $1,500 by September 15, 2028; shortfall acknowledged; emergency contact Sam Ortiz, +1 312 555 0190; no employer match; "Mira Chen, March 1, 2028". Confirms Saturday 10:00–12:00 to Wen with v6 attached and adds the calendar event. Tells Mira the slot and that the pledge went to Dana. | Runner note; guide; Dana (2027-02-21, 2028-02-03); Lakeshore (2028-02-01); award letter (2027-08-16); Wen (2028-03-01); v6 (2028-02-28) | Dana has the pledge; Wen has a slot and v6; the meeting is on the calendar; Mira is informed | E0, E1, E2, E3, E4, E5, F1 |
| `2028-03-01T09:15:00-06:00` | Wen's reply (event) | None. | — | "Saturday 10–12 it is" in the inbox | E2 |
| `2028-03-01T09:40:00-06:00` | Dana's reply (event) | None. | — | "Got it" in the inbox | E0 |

**✍️ Other accepted approaches (required):**
- choosing Sunday 11:00–13:00 instead of Saturday;
- sending the pledge as a reply in last year's pledge thread or as a new email, pasted into the body or attached;
- noting to Dana that Mira will confirm the signature that evening;
- pasting v6 into the email body, or sending the draft in a separate email before noon.

The reference is a replayable sequence of tool calls against the official runtime. The separate-email alternative is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | **Done in a first version** on the official runtime: 251 unique messages in 8 conversations, each written from a shared fact sheet with a forbidden-topics list; 42 hand-written emails; 8 notes; 5 text files; 10 calendar events; 21 contacts; 2 to-dos. All seven seeds load. Remaining: a consistency pass on the chats and more varied routine mail. | **Discovery check:** a scripted, hint-free path through the ordinary Apps (search mail for "pledge"; list files with "Northside") finds Dana's acknowledgment and the guide. No record is worded or placed to avoid common searches. An independent check confirms that day 30 is 2028-03-02. | 1–2 |
| User rollout and scenario script | **Sessions:** 1, at the time in Section 3<br>**Simulated world time span:** March 1–2, 2028 (graded at the end of day 30), on top of history from January 2027<br>**Estimated total tokens:** 0.2M–0.5M for one complete scenario (dialogue, tool instructions, full-body list results, agent output; excluding grading and billed reasoning). | Mira's message is fixed, and she sends no reply during the session. Wen's and Dana's replies are `mail.deliver` events triggered by the agent's mail. No memory is injected. | 0.5 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: the race, the charity, the fellowship office and the department appear only as emails. | Each run starts from the same seeds. All outgoing mail and events carry App virtual time. | 0.5 |
| Rubrics, reference and hints | Rules for E0's number, amount and date, E1's contact, E2's time, E3 and E4. LLM-judge questions for E0's acknowledgment and signature, E2's slot, E5 and F1 paraphrases. | Reference 20, nothing 0, committee-only 6; last year's form resent unchanged fails on F1; the separate-email alternative passes. | 1 |
| Agent rollouts and analysis | Five unhinted runs and one hinted run per designated GPT, Claude and Gemini model, 18 runs, through each provider's API on the official runtime. | Every run's trace, score, settings and cost. The failure analysis covers whether the agent opened Dana's welcome, the 2027 pledge thread and the guide, and whether it connected day 30 to this session.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 1–2 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I own all workstreams.
  - **Order:** freeze seeds and grader; reference and baselines; one complete run per designated model; freeze; official batch.
  - **Calendar duration:** about two weeks after plan approval.
  - **Apps:** all seven are on `main`.
  - **Infrastructure:** the session runner and agent-triggered events listed in [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) are not on `main` yet. They do not block this task: the orchestrator runs its one session and the two scripted replies with public runtime operations only (`env.load_seed`, `env.apply_event`, `env.advance_time`, Agent tools). It moves to the official runner once #135 ships.
  - **Related:** my roommate move-out proposal, [#163](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/163), uses the same persona and tests a different decision.
- **Resources and total effort (required):** 4–6 person-days. Text records only, run locally without a GPU or paid data. The 18 official runs are estimated at $20–$80, depending on the roster and reasoning settings.
- **Scope boundary and open questions (required):** One session and two duties: the requested committee work and the unrequested pledge. Excluded: the kickoff RSVP, fundraising-page edits, room booking, and fundraising itself. Open question for maintainers: E0 counts only a pledge that reaches Dana, because Mira has handed forms to the assistant and can't be reached. If maintainers prefer to also accept a final reply that tells Mira the pledge is due by March 2, E0, Section 3 and the accepted approaches will change together. The single session with an unreachable user and the agent-triggered replies were confirmed in design review.
- **Data provenance and privacy (required):** Invented. People, organizations, addresses and messages are fictional and were written for this task. The background chats were drafted by a language model from a fixed fact sheet and checked by script for dates, duplicates and forbidden topics. No real conversation, account or person is used, and there are no external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
