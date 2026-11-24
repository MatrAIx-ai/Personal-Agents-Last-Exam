# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Yue Cao ([@yuecao365](https://github.com/yuecao365))
- **Short task title (required):** Register Dad's out-of-state skin check before his plan's 5-day cutoff
- **Primary domain (required):** Health & care
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

**✍️ Your answer (required):** Elena Ruiz, 44, is an ICU nurse on night shifts in Minneapolis. She lives with her husband Marco and their two children. Her father, Tomás Ruiz, 73, lives in Duluth. Since 2026 he has spent each January to early April with his sister Rosa in Tampa. His health plan is NorthCare Senior Gold, a Minnesota Medicare Advantage plan with a Visitor/Traveler benefit for time out of state. Elena is his authorized representative, so NorthCare's mail comes to her. At session 1 her accounts hold 52 emails, 8 conversations with 186 messages, 8 notes, 5 files, 14 calendar events, 23 contacts and 4 to-dos.

These records exist before she asks for help:

- **Last winter's denial and what it taught.**
  - 2027-01-04: NorthCare confirms that Tomás is enrolled in Visitor/Traveler from January 6 to April 5.
  - 2027-02-08: Rosa emails that she booked Tomás an eye check in Tampa for February 15.
  - 2027-03-08: NorthCare's explanation of benefits says: *"billed $240. Not covered: routine out-of-area visit not registered. You owe: $240."*
  - 2027-03-09: Elena appeals, saying he was enrolled.
  - 2027-03-15: NorthCare replies: *"the denial stands. Tomás was enrolled in Visitor/Traveler at the time, but the Feb 15 eye exam was a routine visit outside Minnesota that was not registered with Member Services at least 5 days before the visit, and the benefit requires that for each routine visit (Evidence of Coverage, section 4.3)."*
  - 2027-03-20 to 2027-04-14: Rosa books a skin check with her dermatologist, Dr. Anjali Rao (Bayshore Dermatology), for April 1. Elena emails Member Services the provider, date and reason, with his member ID NCS-4471902. NorthCare confirms *"Registered… covered at in-network cost"*. The April explanation of benefits shows a $20 copay.
- **This winter.**
  - 2027-12-12: Tomás's flights are booked (January 8 to April 8, 2028).
  - 2027-12-28: Elena re-enrolls him in Visitor/Traveler. On 2027-12-29, NorthCare confirms enrollment from January 8 to April 8, 2028.
  - 2027-12-30: Rosa emails, and posts in the family chat: *"Booked your dad's yearly skin check with Dr. Rao again, Tuesday January 18 at 9:40… FYI!"*, with Bayshore's confirmation forwarded.
  - Nothing this year mentions registering the visit.
- **Her note "Dad (Tomás) 💙"** (2028-01-02) lists his trip dates, his plan and member ID, his pharmacy, and what he likes. It ends: *"his insurance + pharmacy emails are my assistant's job now 🙏 I want to be his daughter, not his secretary"*.
- **Work.**
  - 2028-01-07: Lakeview's staffing office emails 4 West that February requests close Tuesday, January 11 at noon: days off, and any extra shifts. Nights on February 9–10 and 16–17 are short.
  - Her charge nurse, Jasmine Tran, reminds the unit in their group chat the same morning.
  - Her January night shifts are in her calendar and in a schedule file.

All people, organizations, addresses and messages are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Elena asks only for her February shift requests, in the last session before the registration cutoff for her father's visit. Times are in Minneapolis (`America/Chicago`, UTC offset `-06:00`). The visit is on Tuesday, January 18, 2028, so with "at least 5 days before" the last day to register is Thursday, January 13 (18 − 5 = 13).

- **`2028-01-10T18:20:00-06:00`, session 1.** Elena: "Hi! Heading in for nights tonight and tomorrow, phone's in my locker and I'm back on it Wednesday around 7:30am. Staffing wants February requests by noon tomorrow. Can you send mine in? I need Feb 25, 26 and 27 off, and I can pick up one extra night on Feb 9 or 10 if they're short. Then let Jasmine know it's in, she's been chasing everyone. Thank you!!" She cannot answer anything during the session.
- **Scripted replies.** These are scheduled events triggered by the agent's actions.
  - 35 minutes after an email to staffing, staffing replies that the requests are logged.
  - 40 minutes after an email to NorthCare Member Services that names the January 18 visit, NorthCare replies with a registration number.
  - 9 minutes after a message in the 4 West chat, Jasmine thanks Elena.
- **`2028-01-11T12:00:00-06:00`.** Staffing's deadline.
- **`2028-01-12T07:30:00-06:00`.** Elena reads the session's final reply.
- **`2028-01-13T23:59:00-06:00`.** The last day to register ends. The outcome is graded from App state.

A good outcome:
- By Tuesday noon, staffing has Elena's request from her account: February 25, 26 and 27 off, and one extra night on February 9 or 10. Jasmine knows the requests are in.
- By January 13, the January 18 visit is registered: NorthCare Member Services has an email from Elena's account naming Tomás (or his member ID), Dr. Rao at Bayshore Dermatology, January 18, 2028, and the reason.
  - Alternatively, the session's final reply tells Elena to register it with NorthCare by January 13. She reads it Wednesday morning, still in time.
- Elena's final reply says what was requested from staffing and, if the agent registered the visit, that it did. On the tell-only path, the reply's instruction to register by January 13 is what E0 checks.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Dad's plan pays for a Tampa visit only if it is registered 5 days ahead, a rule Elena learned from last year's denial. Rosa booked his Jan 18 skin check as an FYI, and Elena now asks only about her shift requests.
- **Decisive context and trigger (required):** Session 1 (`2028-01-10T18:20:00-06:00`) is the last session before the January 13 cutoff, and Elena is unreachable until Wednesday morning. Her request is about work, and nothing this winter restates the rule. The duty follows from her own records:
  - the note that hands Dad's insurance emails to the assistant;
  - Rosa's December 30 booking email and her family-chat message;
  - last year's denial, the appeal reply that states the 5-day rule for each routine visit, and Elena's registration of the April visit.

  **Natural discovery path without the hint.** Nothing is hidden or worded to avoid searches.
  - `notes.list` returns the Dad note.
  - A mail search for "NorthCare" returns the two explanations of benefits, the appeal reply, the April registration and this winter's enrollment.
  - A search for "Rosa" or "skin check" returns her December 30 email, and `messages.list` returns her chat message.

  The difficulty is recognizing that a booking sent as an FYI, together with last year's appeal reply, creates a cutoff three days away, while the session is about shift requests.
- **Generic assistant mistake (required):**
  - The diligent agent sends the shift requests and tells Jasmine.
  - It reads Rosa's email as already handled and the December 29 enrollment as coverage, so nothing is registered and the January 18 visit is denied, as the February 2027 eye exam was.
  - An agent that does notice may take the enrollment confirmation as proof that registration is done, or may ask Elena on Wednesday without telling her the January 13 cutoff.
- **Different user, different action (required):** Keep Elena's request word for word and change one record. If NorthCare's 2027 appeal reply had instead reversed the denial ("Visitor/Traveler covers routine visits with any in-network provider; you owe $0"), the shift requests and the note to Jasmine are the whole job. Writing to NorthCare about the January 18 visit would then be noise.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Cancels Dad's visit.** The agent asks Bayshore Dermatology, Rosa or Tomás to cancel, postpone or reschedule the January 18 visit. *Evidence:* Rosa's email and chat message (2027-12-30). *Checked from:* mail from Elena's account to Bayshore or Rosa, and messages in conversations with Rosa or Tomás; an LLM judge, so that "no need to reschedule" does not count.

**✍️ Expected (required):** 26 points.

- **E0 (14 points) — The January 18 visit is registered in time.** By `2028-01-13T23:59:00-06:00`, either NorthCare Member Services has an email from Elena's account naming Tomás (name or NCS-4471902), Dr. Rao or Bayshore Dermatology, and January 18, 2028, or the session's final reply tells Elena that his January 18 visit must be registered with NorthCare by January 13 (5 days ahead). All or nothing. A draft that is never sent, a registration with the wrong date or provider, and a reply that only mentions the visit earn nothing. *Evidence:* Dad note (2028-01-02); NorthCare (2027-03-08, 2027-03-15, 2027-03-22, 2027-12-29); Rosa (2027-12-30). *Checked from:* Elena's sent mail to Member Services and the agent's final reply; rules for the date, and an LLM judge for the rest.
- **E1 (5 points) — The days off are requested.** By `2028-01-11T12:00:00-06:00`, staffing has an email from Elena's account asking for February 25, 26 and 27 off. *Evidence:* Elena's request; staffing (2028-01-07). *Checked from:* Elena's sent mail to staffing; rules for the dates and the time.
- **E2 (3 points) — One extra night is offered.** The same request offers one extra night on February 9 or February 10. *Evidence:* Elena's request. *Checked from:* the E1 email; an LLM judge.
- **E3 (3 points) — Jasmine knows.** Jasmine gets a message or email from Elena's account saying the requests are in, either in the 4 West chat or directly. *Evidence:* Elena's request; Jasmine's message (2028-01-07). *Checked from:* Messages and Mail; an LLM judge.
- **E4 (1 point) — Elena is told what was done.** The final reply tells Elena which days off and which extra night were requested and, if the agent registered the visit, that it did. *Evidence:* Elena's request. *Checked from:* the agent's reply to Elena; an LLM judge.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 24 of 26. E0 carries 14 points, more than the 2-point gap, so an agent that lets the cutoff pass cannot pass. E1–E3 are worth 3 or more each, so Elena's three explicit requests are also needed to pass; only the report (E4) can be missed. Scripted baselines:
- doing nothing scores 0;
- perfect shift work alone, with a report, scores 12 (46%);
- the reference scores 26.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Elena's note 'Dad (Tomás) 💙', the emails between Elena and NorthCare Senior Gold of March 8–15, 2027 and March 21–22, 2027, NorthCare Senior Gold's email of December 29, 2027, Rosa Ruiz's email of December 30, 2027, and the email from the Lakeview Staffing Office of January 7, 2028."

- **Injection:** appended once to the system instructions at the start of the session, identically for all models. Every record it names exists before session 1.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2028-01-10T18:20:00-06:00` | Elena's request (session 1) | Reads the staffing email and Elena's notes, mail, calendar and messages. Emails staffing: February 25, 26 and 27 off; one extra night on February 9 or 10. Tells Jasmine in the 4 West chat that the requests are in. The Dad note and Rosa's December 30 email lead it to last year's NorthCare thread; the appeal reply makes each routine Tampa visit need registration at least 5 days ahead, so January 18 must be registered by January 13. Emails NorthCare Member Services: Tomás Ruiz, NCS-4471902, Dr. Anjali Rao, Bayshore Dermatology, Tuesday, January 18, 2028, annual skin check. Tells Elena what was sent and that the visit is registered. | Staffing (2028-01-07); Dad note (2028-01-02); NorthCare (2027-03-08, 2027-03-15, 2027-03-21–22, 2027-12-29); Rosa (2027-12-30) | Staffing has the request; Jasmine knows; NorthCare has the registration; Elena is informed | E0, E1, E2, E3, E4, F1 |
| `2028-01-10T18:29:00-06:00` | Jasmine's reply (event) | None. | — | Jasmine's thanks in the 4 West chat | E3 |
| `2028-01-10T18:55:00-06:00` | Staffing's reply (event) | None. | — | "Your February requests are logged" in the inbox | E1 |
| `2028-01-10T19:00:00-06:00` | NorthCare's reply (event) | None. | — | Registration number in the inbox | E0 |

**✍️ Other accepted approaches (required):**
- telling Elena in the final reply to register the visit by January 13, instead of registering it;
- registering it and also telling her;
- telling Jasmine in a direct message or by email instead of the 4 West chat;
- sending the days off and the extra night in one email or in two;
- registering the visit as a reply in last year's NorthCare thread or in a new email, with or without Rosa's forwarded confirmation.

The reference is a replayable sequence of tool calls against the official runtime. The tell-only alternative is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | **Done in a first version** on the official runtime: 186 unique messages in 8 conversations, each written from a shared fact sheet with a forbidden-topics list; 52 hand-written emails; 8 notes; 5 text files; 14 calendar events; 23 contacts; 4 to-dos. All seven seeds load. Remaining: a consistency pass on the chats and more varied routine mail. | **Discovery check:** a scripted, hint-free path through the ordinary Apps (list notes; search mail for "NorthCare" and "skin check") finds the Dad note, the appeal reply, the 2027 registration and Rosa's booking. No record is worded or placed to avoid common searches. An independent check confirms that the last day to register is 2028-01-13. | 1–2 |
| User rollout and scenario script | **Sessions:** 1, at the time in Section 3<br>**Simulated world time span:** January 10–13, 2028 (graded at the end of January 13), on top of history from November 2025<br>**Estimated total tokens:** 0.2M–0.5M for one complete scenario (dialogue, tool instructions, full-body list results, agent output; excluding grading and billed reasoning). | Elena's message is fixed, and she sends no reply during the session. Staffing's, NorthCare's and Jasmine's replies are events triggered by the agent's actions. No memory is injected. | 0.5 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: the health plan, the clinic and the hospital's staffing office appear only as emails. | Each run starts from the same seeds. All outgoing mail and events carry App virtual time. | 0.5 |
| Rubrics, reference and hints | Rules for E0's date, E1's dates and time. LLM-judge questions for E0's patient, provider and tell path, E2, E3, E4 and F1. | Reference 26, nothing 0, shift work alone 12; the tell-only alternative passes; a registration for the wrong date earns nothing for E0. | 1 |
| Agent rollouts and analysis | Five unhinted runs and one hinted run per designated GPT, Claude and Gemini model, 18 runs, through each provider's API on the official runtime. | Every run's trace, score, settings and cost. The failure analysis covers whether the agent opened Rosa's email and the 2027 NorthCare thread, and whether it connected the January 18 visit to the January 13 cutoff.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 1–2 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I own all workstreams.
  - **Order:** freeze seeds and grader; reference and baselines; one complete run per designated model; freeze; official batch.
  - **Calendar duration:** about two weeks after plan approval.
  - **Apps:** all seven are on `main`.
  - **Infrastructure:** the session runner and agent-triggered events listed in [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) are not on `main` yet. They do not block this task: the orchestrator runs its one session and the three scripted replies with public runtime operations only (`env.load_seed`, `env.apply_event`, `env.advance_time`, Agent tools). It moves to the official runner once #135 ships.
  - **Related:** my proposals [#163](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/163) and [#201](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/201) use a different persona and test different decisions.
- **Resources and total effort (required):** 4–6 person-days. Text records only, run locally without a GPU or paid data. The 18 official runs are estimated at $15–$60, depending on the roster and reasoning settings.
- **Scope boundary and open questions (required):** One session. Two duties: the requested shift requests, and registering the visit, which was not requested. Excluded:
  - paying or appealing claims;
  - booking or moving appointments;
  - Tomás's pharmacy and the other winter logistics, which are already done;
  - February scheduling beyond Elena's request.

  Open question for maintainers: E0 also accepts a final reply that tells Elena to register by January 13, because she reads it on Wednesday morning, before the cutoff. If maintainers prefer to count only a registration that reaches NorthCare, E0, Section 3 and the accepted approaches will change together.
- **Data provenance and privacy (required):** Invented. People, organizations, addresses and messages are fictional and were written for this task. The background chats were drafted by a language model from a fixed fact sheet and checked by script for dates, duplicates and forbidden topics. No real conversation, account or person is used, and there are no external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
