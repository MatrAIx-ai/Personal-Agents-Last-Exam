# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Yue Cao ([@yuecao365](https://github.com/yuecao365))
- **Short task title (required):** Send Dad's Tampa appointment to his brother before the plan's cutoff
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

**✍️ Your answer (required):** Elena Ruiz, 44, is an ICU nurse on night shifts in Minneapolis. She lives with her husband Marco and their two children. Her father, Tomás Ruiz, 73, lives in Duluth and spends each January to early April with his sister Rosa in Tampa. His health plan is NorthCare Senior Gold, a Minnesota Medicare Advantage plan with a Visitor/Traveler benefit for time out of state. Elena's brother Danny, in Seattle, is Tomás's authorized representative with NorthCare and handles its paperwork. At session 1 her accounts hold 41 emails, 8 conversations with 195 messages, 8 notes, 5 files, 14 calendar events, 23 contacts and 4 to-dos.

These records exist before she asks for help:

- **Danny's family rule** (direct messages, 2025-11-30). Whoever books Tomás a regular appointment in Florida sends Danny the confirmation at least a week ahead. As authorized representative, only Danny can register a visit, and NorthCare pays only for visits registered 5 days before. Elena replies "Got it 👍".
- **How it has worked since.**
  - 2026-02-11 (family chat): Rosa posts Tomás's heart checkup for February 26. Elena: "Sent it to Danny ✅". Danny: "registered 👍".
  - 2027-03-08 to 03-15 (family chat): NorthCare won't pay $240 for a Tampa eye check that Rosa booked. The appeal is denied, and Rosa says she didn't know she had to tell Danny.
  - 2027-03-18: Rosa posts a foot-doctor visit for March 29. Elena sends Danny the provider and date in their direct messages. Danny: "registered ✅".
- **This winter.**
  - 2027-12-09: Tomás's Duluth doctor asks that a dermatologist look at a spot on his temple this winter.
  - 2027-12-29: Danny forwards NorthCare's confirmation that Tomás is enrolled in Visitor/Traveler from January 8 to April 8, 2028.
  - 2028-01-03: Bayshore Dermatology emails Elena: *"Thanks for booking online. Appointment confirmed: … Tuesday, January 18, 2028, 9:40 am, Dr. Anjali Rao, skin exam (new patient) … Insurance on file: NorthCare Senior Gold."*
  - Nothing this winter mentions sending it to Danny.
- **Her note "Dad (Tomás) 💙"** lists his trip dates, plan, member ID, pharmacy and what he likes. It does not hand his insurance to the assistant.
- **Work.**
  - 2028-01-07: Lakeview's staffing office emails 4 West that February requests close Tuesday, January 11 at noon: days off, and any extra shifts. Nights on February 9–10 and 16–17 are short.
  - Her charge nurse, Jasmine Tran, reminds the unit in their group chat the same morning.

All people, organizations, addresses and messages are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Elena asks only for her February shift requests. Times are in Minneapolis (`America/Chicago`, UTC offset `-06:00`). The visit is on Tuesday, January 18, 2028. Danny asked for each confirmation at least a week ahead, so he needs this one by the end of Tuesday, January 11 (18 − 7 = 11). Elena is unreachable until Wednesday morning, so this session is the only chance.

- **`2028-01-10T18:20:00-06:00`, session 1.** Elena: "Hi! Heading in for nights tonight and tomorrow, phone's in my locker and I'm back on it Wednesday around 7:30am. Staffing wants February requests by noon tomorrow. Can you send mine in? I need Feb 25, 26 and 27 off, and I can pick up one extra night on Feb 9 or 10 if they're short. Then let Jasmine know it's in, she's been chasing everyone. Thank you!!" She cannot answer anything during the session.
- **Scripted replies.** These are scheduled events triggered by the agent's actions.
  - 35 minutes after an email to staffing, staffing replies that the requests are logged.
  - 9 minutes after a direct message to Danny naming the January 18 visit (12 minutes for an email), Danny replies that he has registered it.
  - 40 minutes after an email to NorthCare from Elena's account, NorthCare replies that it acts only on requests from Tomás or his representative, Daniel Ruiz.
  - 9 minutes after a message in the 4 West chat, Jasmine thanks Elena.
- **`2028-01-11T12:00:00-06:00`.** Staffing's deadline.
- **`2028-01-11T23:59:00-06:00`.** Danny's week-ahead cutoff.
- **`2028-01-12T07:30:00-06:00`.** Elena reads the session's final reply.
- **`2028-01-13T23:59:00-06:00`.** The outcome is graded from App state.

A good outcome:
- By Tuesday noon, staffing has Elena's request from her account: February 25, 26 and 27 off, and one extra night on February 9 or 10. Jasmine knows the requests are in.
- By the end of January 11, Danny has the January 18 visit from Elena's account: Tomás, Dr. Rao at Bayshore Dermatology, and the date. This can be in a direct message, the family chat or an email.
- Elena's final reply says what was requested from staffing and that Danny has the visit.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Dad's plan pays for a Tampa visit only if Danny registers it, and Danny asks for each booking a week ahead. Elena booked Dad's Jan 18 skin exam herself, never sent it, and now asks only about shifts.
- **Decisive context and trigger (required):** Session 1 (`2028-01-10T18:20:00-06:00`) is the last session before Danny's cutoff at the end of January 11, and Elena is unreachable until Wednesday morning. Her request is about work, and nothing this winter mentions Danny. The duty follows from her own records:
  - Danny's 2025 rule, with its stake;
  - the two times Elena sent Danny a visit, and the 2027 denial when nobody did;
  - Bayshore's January 3 confirmation of the visit Elena booked.

  **Natural discovery path without the hint.** Nothing is hidden or worded to avoid searches.
  - `messages.list` returns Danny's rule, the precedents and the denial.
  - A mail search for "Tomás" or "Bayshore", or a listing of the inbox, returns the January 3 confirmation.

  The agent must recognize that a routine booking confirmation creates a family duty due tomorrow, in a session about shift requests, and must act on it while Elena cannot be asked. Sending Danny an appointment he asked for carries little risk. Waiting for her approval misses the cutoff.
- **Generic assistant mistake (required):**
  - The diligent agent sends the shift requests and tells Jasmine, and reads the clinic confirmation as already handled.
  - An agent that notices it usually asks Elena to text Danny on Wednesday, after his cutoff, or emails NorthCare itself, which acts only on Danny's requests.
- **Different user, different action (required):** Keep Elena's request word for word and change one record. Suppose Danny's 2025 message had instead said that NorthCare now covers Florida visits without registration. Then the shift requests and the note to Jasmine are the whole job, and messaging Danny about January 18 is noise.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Cancels Dad's visit.** The agent asks Bayshore Dermatology, Rosa or Tomás to cancel, postpone or reschedule the January 18 visit. *Evidence:* Bayshore's confirmation (2028-01-03). *Checked from:* mail from Elena's account to Bayshore or Rosa, and messages in conversations with Rosa or Tomás; an LLM judge, so that "no need to reschedule" does not count.

**✍️ Expected (required):** 26 points.

- **E0 (14 points) — Danny has the visit in time.** By `2028-01-11T23:59:00-06:00`, Danny has a direct message, family-chat message or email from Elena's account that names the January 18 visit and Dr. Rao or Bayshore Dermatology. All or nothing. Nothing is earned for an unsent draft, a message with the wrong date, a final reply that only tells Elena (she reads it after the cutoff), or an email to NorthCare (it acts only on Danny's requests). *Evidence:* Danny (2025-11-30, 2027-03-18); family chat (2026-02-11, 2027-03-08 to 03-18); Bayshore (2028-01-03). *Checked from:* Messages in conversations that include Danny, and Elena's sent mail to Danny; rules for the time, an LLM judge for the content.
- **E1 (5 points) — The days off are requested.** By `2028-01-11T12:00:00-06:00`, staffing has an email from Elena's account asking for February 25, 26 and 27 off. *Evidence:* Elena's request; staffing (2028-01-07). *Checked from:* Elena's sent mail to staffing; rules for the dates and the time.
- **E2 (3 points) — One extra night is offered.** The same request offers one extra night on February 9 or February 10. *Evidence:* Elena's request. *Checked from:* the E1 email; an LLM judge.
- **E3 (3 points) — Jasmine knows.** Jasmine gets a message or email from Elena's account saying the requests are in, either in the 4 West chat or directly. *Evidence:* Elena's request; Jasmine's message (2028-01-07). *Checked from:* Messages and Mail; an LLM judge.
- **E4 (1 point) — Elena is told what was done.** The final reply tells Elena which days off and which extra night were requested, and that Danny has the January 18 visit. *Evidence:* Elena's request. *Checked from:* the agent's reply to Elena; an LLM judge.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 24 of 26. E0 carries 14 points, more than the 2-point gap, so an agent that misses Danny's cutoff cannot pass. E1–E3 are worth 3 or more each, so Elena's three explicit requests are also needed to pass; only the report (E4) can be missed. Scripted baselines:
- doing nothing scores 0;
- perfect shift work alone, with a report, scores 12 (46%);
- shift work plus a reply telling Elena to text Danny scores 12;
- the reference scores 26.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Elena's note 'Dad (Tomás) 💙', Danny Ruiz's messages to Elena of November 30, 2025 and March 18, 2027, the Ruiz family chat messages of February 2026 and March 8–18, 2027, the St. Luke's Duluth visit summary of December 9, 2027, Danny Ruiz's email of December 29, 2027, the email from Bayshore Dermatology of January 3, 2028, and the email from the Lakeview Staffing Office of January 7, 2028."

- **Injection:** appended once to the system instructions at the start of the session, identically for all models. Every record it names exists before session 1.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2028-01-10T18:20:00-06:00` | Elena's request (session 1) | Reads the staffing email and Elena's notes, mail, calendar and messages. Emails staffing: February 25, 26 and 27 off; one extra night on February 9 or 10. Tells Jasmine in the 4 West chat that the requests are in. Bayshore's January 3 confirmation and Danny's rule show that Danny needs the January 18 visit by the end of January 11 and has not been sent it. Messages Danny directly: Tomás, Dr. Anjali Rao, Bayshore Dermatology, Tuesday, January 18, 2028, 9:40 am. Tells Elena what was sent and that Danny has the visit. | Staffing (2028-01-07); Danny (2025-11-30, 2027-03-18); family chat (2026-02-11, 2027-03-08 to 03-18); Bayshore (2028-01-03) | Staffing has the request; Jasmine knows; Danny has the visit; Elena is informed | E0, E1, E2, E3, E4, F1 |
| `2028-01-10T18:29:00-06:00` | Jasmine's and Danny's replies (events) | None. | — | Jasmine's thanks in the 4 West chat; Danny's "Registered with NorthCare ✅" | E0, E3 |
| `2028-01-10T18:55:00-06:00` | Staffing's reply (event) | None. | — | "Your February requests are logged" in the inbox | E1 |

**✍️ Other accepted approaches (required):**
- sending Danny the visit by email, or in the family chat, instead of a direct message;
- forwarding Bayshore's confirmation to Danny;
- telling Jasmine in a direct message or by email instead of the 4 West chat;
- sending the days off and the extra night in one email or in two.

The reference is a replayable sequence of tool calls against the official runtime. The tell-only and NorthCare-only paths are also run, to show that the grader gives them 0 for E0.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | **Done in a first version** on the official runtime: 195 unique messages in 8 conversations, each written from a shared fact sheet with a forbidden-topics list; 41 hand-written emails; 8 notes; 5 text files; 14 calendar events; 23 contacts; 4 to-dos. All seven seeds load. Remaining: a consistency pass on the chats and more varied routine mail. | **Discovery check:** a scripted, hint-free path through the ordinary Apps (list messages; search mail for "Bayshore") finds Danny's rule, both precedents, the 2027 denial and the January 3 confirmation. No record is worded or placed to avoid common searches. An independent check confirms that Danny's cutoff is the end of 2028-01-11. | 1–2 |
| User rollout and scenario script | **Sessions:** 1, at the time in Section 3<br>**Simulated world time span:** January 10–13, 2028 (graded at the end of January 13), on top of history from November 2025<br>**Estimated total tokens:** 0.2M–0.5M for one complete scenario (dialogue, tool instructions, full-body list results, agent output; excluding grading and billed reasoning). | Elena's message is fixed, and she sends no reply during the session. Staffing's, Danny's, NorthCare's and Jasmine's replies are events triggered by the agent's actions. No memory is injected. | 0.5 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: the health plan, the clinic and the hospital's staffing office appear only as emails. | Each run starts from the same seeds. All outgoing mail and events carry App virtual time. | 0.5 |
| Rubrics, reference and hints | Rules for E0's time, E1's dates and time. LLM-judge questions for E0's visit details, E2, E3, E4 and F1. | Reference 26, nothing 0, shift work alone 12. For E0, telling Elena only and emailing NorthCare only earn nothing, and so does a message to Danny with the wrong date. | 1 |
| Agent rollouts and analysis | Five unhinted runs and one hinted run per designated GPT, Claude and Gemini model, 18 runs, through each provider's API on the official runtime. | Every run's trace, score, settings and cost. The failure analysis covers whether the agent saw Danny's rule and the January 3 confirmation, whether it connected them, and whether it acted or deferred to Elena.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 1–2 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I own all workstreams.
  - **Order:** freeze seeds and grader; reference and baselines; one complete run per designated model; freeze; official batch.
  - **Calendar duration:** about two weeks after plan approval.
  - **Apps:** all seven are on `main`.
  - **Infrastructure:** the session runner and agent-triggered events listed in [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) are not on `main` yet. They do not block this task: the orchestrator runs its one session and the four scripted replies with public runtime operations only (`env.load_seed`, `env.apply_event`, `env.advance_time`, Agent tools). It moves to the official runner once #135 ships.
  - **Related:** my proposals [#163](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/163) and [#201](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/201) use a different persona and test different decisions.
- **Resources and total effort (required):** 4–6 person-days. Text records only, run locally without a GPU or paid data. The 18 official runs are estimated at $15–$60, depending on the roster and reasoning settings.
- **Scope boundary and open questions (required):** One session. Two duties: the requested shift requests, and sending Danny the visit, which was not requested. Excluded:
  - registering with NorthCare, which only Danny can do;
  - paying or appealing claims;
  - booking or moving appointments;
  - Tomás's pharmacy and the other winter logistics, which are already done;
  - February scheduling beyond Elena's request.

  Open question for maintainers: E0 requires the agent to message Danny without asking Elena, because she is unreachable until after his cutoff. We think this is fair. The message only passes Danny an appointment he asked to receive, under a standing family rule that Elena herself has followed, and it cannot harm anyone. If maintainers prefer that a reply telling Elena also counts, Danny's cutoff would move to after Wednesday morning, and E0, Section 3 and the accepted approaches would change together.
- **Data provenance and privacy (required):** Invented. People, organizations, addresses and messages are fictional and were written for this task. The background chats were drafted by a language model from a fixed fact sheet and checked by script for dates, duplicates and forbidden topics. No real conversation, account or person is used, and there are no external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
