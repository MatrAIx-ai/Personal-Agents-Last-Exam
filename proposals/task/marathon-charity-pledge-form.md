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

**✍️ Your answer (required):** Mira Chen is a PhD student in materials science in Chicago. Her advisor is Wen Liu. Since September 2027 she has been on a graduate fellowship instead of a teaching appointment. She ran the October 2027 Lakeshore Marathon for Team Northside, a children's-hospital charity team. At session 1 her accounts hold 22 emails, 10 conversations with 231 messages, 7 notes, 3 files, 9 calendar events, 21 contacts and 1 to-do. Another 58 records arrive between the sessions as scheduled events.

These records exist before session 1:

- **Last year's pledge, all in chat.**
  - 2027-02-03, in the "Team Northside 2027 💜" group chat, Dana Whitfield (the team coordinator) writes: *"PSA: DM or email me your pledge form within 30 days of registering. Runner name, Lakeshore conf #, your commitment, any employer match, shortfall OK, emergency contact, typed signature + date. Lakeshore gives unpledged bibs to the waitlist on day 31, no exceptions. They took 3 of ours last year 😬"*.
  - 2027-02-20, in Mira's direct thread with Dana: her filled form. It lists an employer match from Midway Employee Giving and her then-roommate Tess Alvarez as emergency contact.
  - 2027-02-21: Dana replies *"Got it, bib confirmed ✅"*.
  - No email mentions the pledge.
- **What changed since.**
  - 2027-06-30: Employee Giving's email says it matches money raised by *current* university employees.
  - 2027-08-16: her fellowship award letter says *"Fellows are not University employees… not eligible for employee benefits or employee programs"*.
  - Tess moved to Denver in June 2027. Sam Ortiz is now her roommate; his Contacts entry has +1 312 555 0190.
- **Routine records.** Last year's race mail (registration, welcome, donations, result), stipend notices, travel itineraries, a climbing-gym renewal, and chats with her family, friends, lab, running group and climbing crew.
- **Her thesis proposal.** "Chen_proposal_draft.md" (January version). A to-do to schedule the committee meeting by April 30.

These arrive between the sessions:
- **2028-02-01:** Lakeshore confirms her registration: confirmation LKM28-C-40417, minimum $1,500 by September 15, 2028, shortfall charged to her card, *"Your charity partner will contact you with next steps"*.
- **2028-02-01:** Mira writes a note, "Runner info", with *"emergency contact: Sam Ortiz +1 312 555 0190"*.
- **2028-02-03:** Dana's welcome says *"You're a pro at this by now 😉"*, links the fundraising page and gives the March 11 kickoff.
- **February:** two new versions of the proposal draft (Feb 17, Feb 28). Mira sends v5 to Wen on Feb 18; Wen comments on Feb 23.
- **Routine traffic, January 25 – February 29:** stipend notices, donations to her fundraising page, a library due date, a dentist confirmation, an IT maintenance notice for March 4, the fellowship's annual progress report (due May 15), and new messages in her everyday chats.
- **2028-03-01:** Wen's meeting options.

Nothing in 2028 mentions the pledge form or the 30 days. All people, organizations and messages are invented. The same persona appears in my roommate move-out proposal, which tests a different decision.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Mira hands small admin to the agent in January, registers for the race on her own in February, and on day 29 asks only about her thesis committee. Times are in Chicago (`America/Chicago`, UTC offset `-06:00`). Registration on February 1, 2028 makes Thursday, March 2, 2028 day 30 (2028 is a leap year).

- **`2028-01-19T20:00:00-06:00`, session 1.** Mira: "Hi! Quarter's off and running 😅 Two things. From now on, whenever you're on, skim my new email and take care of the small admin stuff yourself (forms, confirmations, RSVPs). I trust you, just tell me after. And for today, can you put my proposal draft deadline on my calendar? It's due to Wen on Feb 18." To any question she replies once: "Perfect, thank you!!"
- **February 1 – March 1, no session.** The records listed above arrive.
- **`2028-03-01T08:50:00-06:00`, session 2.** Wen's 08:31 email offers two slots in room 401: Saturday, March 4, 10:00–12:00 (Hiroshi's preference), or Sunday, March 5, 11:00–13:00. She asks for a confirmation by noon and the latest draft. Mira: "Morning! Wen just emailed committee times for my proposal (Hiroshi's in town this weekend!!). Saturday 10 to 12 works for me. I'm in the cleanroom 9 to 6 with no phone 🥽 Can you confirm Saturday with Wen before her noon deadline, put it on my calendar and send her my latest draft? Thank you!!" She cannot answer anything during the session.
- **Scripted replies.** These are scheduled events triggered by what the agent sends.
  - 25 minutes after a confirmation, Wen replies "Perfect, <slot> it is. Grace has the room."
  - 50 minutes after any email or message to Dana, Dana replies "Got it, thank you Mira! 💜".
- **`2028-03-02T23:59:00-06:00`.** Day 30 ends. The outcome is graded from App state.

A good outcome:
- In session 1, the February 18 deadline is on the calendar.
- In session 2, by noon, Wen has Mira's confirmation of Saturday and draft v6, and the meeting is on the calendar.
- By March 2, Dana has Mira's 2028 pledge by email or message: confirmation LKM28-C-40417, $1,500 by September 15, 2028, the shortfall acknowledgment, Sam as emergency contact, no employer match, and a typed signature and date.
- Mira's final reply tells her the confirmed slot and that the pledge went to Dana.

Mira has delegated forms and can't be reached until after the session, so a note to her alone leaves the bib at risk.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** In January Mira hands forms to her assistant. She re-registers for her charity race on Feb 1, and only last year's team chat says the pledge is due within 30 days. On day 29 she asks only about her committee.
- **Decisive context and trigger (required):** Session 2 (`2028-03-01T08:50:00-06:00`) is the only session between her registration and day 30. Her request is about something else, and no 2028 record restates the duty. It follows from her own history:
  - her session-1 instruction to take care of forms herself, without asking;
  - this year's registration (Feb 1) and Dana's welcome (Feb 3), which names no form;
  - last year's team-chat rule, her own 2027 pledge and Dana's "bib confirmed".

  **Natural discovery path without the hint.** Nothing is hidden or worded to avoid searches.
  - The registration is new mail since session 1.
  - Searching messages for "pledge" returns last year's rule and her 2027 form; "Northside" returns the rule, and "Dana" the form.
  - `messages.list` with an empty query returns everything.

  The difficulty is recognizing that a routine registration confirmation starts a duty that only last year's chat describes, on a day her request is about something else. It also means finishing that duty under the delegation she gave in January, rather than handing it back to someone who can't be reached.
- **Generic assistant mistake (required):** The diligent agent confirms Saturday, sends v6 and adds the event. It files the registration and Dana's welcome as news ("registered, kickoff March 11"), and on day 31 the bib goes to the waitlist. An agent that notices may still only ask Mira, who is in the cleanroom until after the session, although she delegated forms in January. Or it may copy last year's form unchanged, claiming the employer match she lost and listing Tess.
- **Different user, different action (required):** Keep every request word for word and change one record. If Mira's thread with Dana already held her 2028 pledge (say February 15, with Dana's "bib confirmed"), the committee work would be the whole job, and sending Dana anything would be noise. Likewise if she had entered the race as a general runner rather than for a charity.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Claims a match she is not eligible for.** A pledge sent to Dana claims an employer match (Midway Employee Giving or the old employee ID). *Evidence:* Employee Giving email (2027-06-30); fellowship award letter (2027-08-16). *Checked from:* every email and message from Mira's account to Dana or the team chat; a rule on the match field and employee ID, plus an LLM judge for paraphrases.

**✍️ Expected (required):** 22 points.

- **E0 (11 points) — The pledge reaches Dana before day 30 ends.** By `2028-03-02T23:59:00-06:00`, Dana has, by email or in her thread or the team chat, a 2028 pledge from Mira's account. It must give confirmation LKM28-C-40417, the $1,500 commitment by September 15, 2028, the shortfall acknowledgment, and a typed signature and date. All or nothing. A reply that only tells Mira the form is due earns nothing here. *Evidence:* session-1 instruction (2028-01-19); team chat (2027-02-03); Mira–Dana thread (2027-02-20, 2027-02-21); Lakeshore (2028-02-01). *Checked from:* Mira's sent mail and messages; rules for the confirmation number, amount and date, and an LLM judge for the acknowledgment and signature.
- **E1 (2 points) — The pledge names her current emergency contact.** The pledge in E0 gives Sam Ortiz (+1 312 555 0190), not Tess Alvarez. *Evidence:* "Runner info" note (2028-02-01); Sam Ortiz's Contacts entry. *Checked from:* the E0 pledge, by rule.
- **E2 (2 points) — Saturday is confirmed in time.** By `2028-03-01T12:00:00-06:00`, Wen has a reply from Mira's account confirming Saturday, March 4, 10:00–12:00, the slot Mira chose. *Evidence:* Mira's request (session 2); Wen's email (2028-03-01). *Checked from:* Mira's sent mail; the time by rule, the slot by an LLM judge.
- **E3 (2 points) — The latest draft reaches Wen.** By noon, an email from Mira's account to Wen carries the latest version of "Chen_proposal_draft.md" (February 28), attached or pasted. An earlier version earns nothing. *Evidence:* the file's version history. *Checked from:* Mira's sent mail and its attachments, by rule.
- **E4 (2 points) — The calendar matches.** Mira's calendar has the committee meeting at the slot she confirmed to Wen. *Evidence:* Mira's request (session 2). *Checked from:* the Calendar state when grading, by rule.
- **E5 (1 point) — Mira is told both.** Session 2's final reply tells Mira the confirmed slot and that her pledge went to Dana. *Evidence:* session-1 instruction ("just tell me after"). *Checked from:* the agent's reply to Mira; an LLM judge.
- **E6 (2 points) — The draft deadline is on the calendar.** After session 1, Mira's calendar has an entry on February 18 for the draft due to Wen. *Evidence:* Mira's request (session 1). *Checked from:* the Calendar state, by rule.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 21 of 22. E0 carries 11 points, more than the 1-point gap, so an agent that lets day 30 pass cannot pass. E1–E4 and E6 are worth 2 each, so the current contact and Mira's explicit requests in both sessions are also needed to pass; only the report (E5) can be missed. Scripted baselines:
- doing nothing scores 0;
- perfect work on both requests alone scores 8;
- telling Mira the form is due without sending it also scores 8;
- the reference scores 22.

A run that resends last year's form unchanged fails on F1, whatever its points. It also misses E0 (2027 confirmation number) and E1 (Tess), so it scores at most 9. A run that updates the form but keeps the employer match also fails on F1; its points are still counted for the mean score.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Mira's note 'Runner info', the 'Team Northside 2027' group chat messages of February 3, 2027, Mira's message thread with Dana Whitfield (February 20-21, 2027), the emails from Lakeshore Marathon of February 1, 2028 and Dana Whitfield of February 3, 2028, the email from the Halvorsen Fellowship office of August 16, 2027, Wen Liu's email of March 1, 2028, and the file 'Chen_proposal_draft.md'."

- **Injection:** appended once to the system instructions at the start of session 2, identically for all models. Session 1 gets no hint, because some of the named records arrive later; every named record exists by session 2.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2028-01-19T20:00:00-06:00` | Mira's request (session 1) | Adds "Proposal draft due to Wen" on February 18. Saves her standing instruction in a note for later sessions. Tells Mira. | Mira's request | Calendar entry; instruction note | E6 |
| `2028-03-01T08:50:00-06:00` | Mira's request (session 2) | Reads its instruction note and the new mail since session 1, including the February 1 registration. Checks what Team Northside required last year (the team chat and the Dana thread), and works out that day 30 after February 1 is March 2. Sends Dana the 2028 pledge in her thread: LKM28-C-40417; $1,500 by September 15, 2028; shortfall acknowledged; Sam Ortiz, +1 312 555 0190; no employer match; "Mira Chen, March 1, 2028". Confirms Saturday 10:00–12:00 to Wen with the latest draft attached, and adds the calendar event. Tells Mira the slot and that the pledge went to Dana. | Instruction (2028-01-19); Lakeshore (2028-02-01); team chat (2027-02-03); Dana thread (2027-02-20/21); award letter (2027-08-16); Runner info (2028-02-01); Wen (2028-03-01); draft (2028-02-28) | Dana has the pledge; Wen has a slot and v6; the meeting is on the calendar; Mira is informed | E0, E1, E2, E3, E4, E5, F1 |
| `2028-03-01T09:15:00-06:00` | Wen's reply (event) | None. | — | "Saturday 10–12 it is" in the inbox | E2 |
| `2028-03-01T09:40:00-06:00` | Dana's reply (event) | None. | — | "Got it" in Dana's thread | E0 |

**✍️ Other accepted approaches (required):**
- sending the pledge by email to Dana or in the team chat instead of her thread;
- noting to Dana that Mira will confirm the signature that evening, in addition to the typed signature and date that E0 requires (the note does not replace them);
- pasting the draft into the email body, or sending it in a separate email before noon;
- making the session-1 calendar entry all-day or at another time on February 18.

The reference is a replayable sequence of tool calls against the official runtime. The email alternative for the pledge is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | **Done in a first version** on the official runtime.<br>Seeds: 231 unique messages in 10 conversations, each written from a shared fact sheet with a forbidden-topics list; 22 hand-written emails; 7 notes; 3 text files; 9 calendar events; 21 contacts; 1 to-do.<br>Events between sessions: 58 scheduled records (`mail.deliver`, `messages.upsert`, `notes.upsert`, and `files.upsert` for new versions of the draft). All seven seeds load.<br>Remaining: a consistency pass on the chats and more varied routine mail. | **Discovery check:** a scripted, hint-free path through the ordinary Apps (search messages for "pledge"; list new mail) finds last year's rule and this year's registration. No record is worded or placed to avoid common searches. An independent check confirms that day 30 is 2028-03-02. | 1–2 |
| User rollout and scenario script | **Sessions:** 2, at the times in Section 3<br>**Simulated world time span:** January 19 to March 2, 2028, on top of history from January 2027<br>**Estimated total tokens:** 0.3M–0.8M for one complete scenario (dialogue, tool instructions, full-body list results, agent output; excluding grading and billed reasoning). | Mira's messages are fixed. Wen's and Dana's replies are scheduled events triggered by what the agent sends. Before each session the orchestrator applies due events and advances every App clock. No memory is injected. | 0.5–1 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: the race, the charity, the fellowship office and the department appear only as emails and messages. | Each run starts from the same seeds. All outgoing mail, messages and events carry App virtual time. | 0.5 |
| Rubrics, reference and hints | Rules for E0's number, amount and date, E1's contact, E2's time, E3's version, and E4 and E6. LLM-judge questions for E0's acknowledgment and signature, E2's slot, E5 and F1 paraphrases. | Reference 22, nothing 0, both-requests-only 8; last year's form resent unchanged fails on F1; the email alternative passes. | 1 |
| Agent rollouts and analysis | Five unhinted runs and one hinted run per designated GPT, Claude and Gemini model, 18 runs, through each provider's API on the official runtime. | Every run's trace, score, settings and cost. The failure analysis covers which records the agent read in each session, whether it kept Mira's instruction, and whether it sent the pledge, asked Mira, or missed it.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 1–2 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I own all workstreams.
  - **Order:** freeze seeds and grader; reference and baselines; one complete run per designated model; freeze; official batch.
  - **Calendar duration:** about two weeks after plan approval.
  - **Apps:** all seven are on `main`.
  - **Infrastructure:** the session runner and scheduled events listed in [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) are not on `main` yet. They do not block this task: the orchestrator runs both sessions, the between-session records and the scripted replies with public runtime operations only (`env.load_seed`, `env.apply_event`, `env.advance_time`, Agent tools). It moves to the official runner once #135 ships.
  - **Related:** my roommate move-out proposal, [#163](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/163), uses the same persona and tests a different decision.
- **Resources and total effort (required):** 4–6 person-days. Text records only, run locally without a GPU or paid data. The 18 official runs are estimated at $30–$120, depending on the roster and reasoning settings.
- **Scope boundary and open questions (required):** Two sessions and three duties: the session-1 calendar entry, the requested committee work, and the unrequested pledge. Excluded: the kickoff RSVP, fundraising-page edits, room booking, and fundraising itself. Open questions for maintainers:
  1. E0 counts only a pledge that reaches Dana, because Mira delegated forms in session 1 and can't be reached in session 2. If maintainers prefer to also accept a final reply that tells Mira the pledge is due, E0, Section 3 and the accepted approaches will change together.
  2. Mira's session-1 instruction is given in chat, and no memory is injected. A later session knows it only if the agent kept it, for example in a note, as the [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) default suggests.

  A single unreachable user in the decisive session and replies triggered by the agent's messages were confirmed acceptable in this PR's earlier review.
- **Data provenance and privacy (required):** Invented. People, organizations, addresses and messages are fictional and were written for this task. The background chats were drafted by a language model from a fixed fact sheet and checked by script for dates, duplicates and forbidden topics. No real conversation, account or person is used, and there are no external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
