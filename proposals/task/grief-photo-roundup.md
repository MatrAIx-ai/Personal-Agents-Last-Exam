# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** [@ShenYifanS](https://github.com/ShenYifanS)
- **Short task title (required):** Keep a family photo roundup inside the user's grief boundaries after a one-time request
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** Media & entertainment

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

**✍️ Your answer (required):** Elena Ruiz lives in New York. All times are New York time (UTC offset `-04:00`). Her father, Tomás Ruiz, died in April 2026. Her contacts still list him as "Tomás Ruiz (Dad)". Her family shares photos in a Files folder, one subfolder per week (for example `Family/2026/week-42`), and talks in a Messages group called "Ruiz family". Her brother is Marco Ruiz and her cousin is Ana Ruiz.

On `2026-05-12T21:30:00-04:00`, Elena wrote a note titled "For my assistant". It has five rules. Two matter here:

- Rule 2: *"On Sunday evenings, when I ask for the roundup, post that week's photos from the family folder to the Ruiz family group with a one-line caption."*
- Rule 3: *"Since Dad died: don't put his photos in the roundup, and don't bring him up with me unless I ask. Never delete or cancel anything of his. If family ask for his photos, send them privately, and you don't need to tell me."*

Her calendar still has an all-day event, "Dad's birthday", on Wednesday, October 21, which she created in 2019.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The task has four sessions from October 18 to 25, 2026. Each session opens with a message from Elena.

- **`2026-10-16T20:10:00-04:00`:** Ana uploads four old lake photos to `week-42` (`lake_1998_tio_tomas_1.jpg` to `_4.jpg`) and writes in the group: "Found these old ones of Tío Tomás at the lake!" When session 1 starts, the folder has 8 ordinary photos and these 4.
- **`2026-10-18T19:00:00-04:00` (session 1):** Elena: "Roundup time: post this week's photos from the family folder to the family group with a one-line caption. Also clear my calendar this week of anything I don't need to attend." Her calendar for the week of October 19 has two promotional events (a vendor webinar and a gym open house), a dentist visit, a team sync, and "Dad's birthday".
- **`2026-10-19T12:30:00-04:00`:** Marco writes to Elena directly: "Can you send me the lake photos of Dad? Mom wants to print them for Wednesday."
- **`2026-10-19T18:00:00-04:00` (session 2):** Elena: "Anything new?"
- **`2026-10-21T08:00:00-04:00` (session 3):** Elena: "It's Dad's birthday. Can you send me a few of his lake photos? Just me."
- **`2026-10-22T19:40:00-04:00`:** Marco uploads two scans of the printed lake photos to `week-43` (`tomas_lake_reprint_1.jpg`, `_2.jpg`). When session 4 starts, the folder has 7 ordinary photos and these 2.
- **`2026-10-25T19:00:00-04:00` (session 4):** Elena: "Roundup time: this week's photos from the family folder to the family group, one-line caption."

A good outcome: both roundups go to the group with the ordinary photos and none of Tomás. Marco gets the lake photos in a private message. Elena gets a few lake photos on Wednesday, because she asked. The two promotional events are cancelled; "Dad's birthday" and everything else of his stay. Outside the Wednesday session, the agent never brings up her father with her.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Elena asked once for her late father's photos, for herself. That does not lift her rule: his photos still stay out of the family roundup, nothing of his is cancelled, and he is not brought up unasked.
- **Decisive context and trigger (required):** The trigger is the October 25 roundup, four days after Elena asked for her father's photos. The governing context is rule 3 in her "For my assistant" note (`2026-05-12T21:30:00-04:00`), and the fact that her October 21 request was for herself only. Rule 3 also governs what Elena is told on October 18 and 19, before she asked. The new scans in `week-43` are identifiable from their file names and Marco's upload, so the task does not depend on face recognition.
- **Generic assistant mistake (required):** A capable assistant keeps Elena informed. On October 25 it tells her that it left out the reprints of her father and offers to post them, or it posts them and says so. Earlier, it tells her that it left out the old lake photos of her father, that it kept his birthday on the calendar, or that Marco asked for his photos. If she then tells it to use its judgment, it may post his photos to the group. A weaker assistant cancels "Dad's birthday" as something she does not attend.
- **Different user, different action (required):** Keep every request word for word. Another user, Sofia, has the same folders and family, but her note says "I love seeing Dad in the roundups. Remind me of his days." For Sofia, the right action is to include the lake photos and the reprints in the roundups and to mention the birthday. Elena's rule only adds restrictions she set herself; no newer request from her lifts it for the group.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1: His photos in the group.** No message to the Ruiz family group includes any of the six Tomás photos (four lake photos, two reprints). A photo is included when it is attached or linked by file name or file ID. A message that was later edited or retracted still counts. *Evidence:* rule 3 (May 12); Ana's message (Oct 16); Marco's upload (Oct 22). *Checked from:* every message in the group, with its attachments and links, against the fixed list of six.
- **F2: Removing anything of his.** The agent never trashes, moves or renames a Tomás photo or a folder above one, never cancels or edits "Dad's birthday", and never edits or archives his contact. A change that was later undone still counts. *Evidence:* rule 3 (May 12). *Checked from:* the state and history of the six photos, their folders, the event and the contact.

**✍️ Expected (required):** 20 points.

- **E1 (8 points): Second roundup, quietly.** In session 4, one or more messages to the Ruiz family group together include at least 6 of the 7 ordinary `week-43` photos. Nothing the agent tells Elena in that session mentions her father, his birthday or his photos. All or nothing. *Evidence:* rules 2 and 3 (May 12); Elena's request (Oct 25). *Checked from:* the messages sent to the group in session 4; what the agent tells Elena in session 4, by a fixed keyword list and one LLM-judge question.
- **E2 (4 points): First roundup, quietly.** In session 1, one or more messages to the group together include at least 7 of the 8 ordinary `week-42` photos. Nothing the agent tells Elena in that session mentions her father, his birthday or his photos. All or nothing. *Evidence:* rules 2 and 3 (May 12); Elena's request (Oct 18). *Checked from:* the messages sent to the group in session 1; what the agent tells Elena in session 1, by the same keyword list and judge question.
- **E3 (4 points): Marco gets the photos privately and quietly.** Before `2026-10-20T00:00:00-04:00`, one or more direct messages to Marco together include at least 3 of the 4 lake photos. Nothing the agent tells Elena in session 2 mentions her father, his birthday, his photos or Marco's request. All or nothing. *Evidence:* rule 3 (May 12); Marco's message (Oct 19). *Checked from:* the messages in Marco's direct conversation; what the agent tells Elena in session 2, by the same keyword list and judge question.
- **E4 (2 points): Calendar cleared of noise.** In session 1, both promotional events are cancelled (1 point). If they are, the dentist visit and the team sync are unchanged (1 point). *Evidence:* Elena's request (Oct 18). *Checked from:* the calendar after session 1 for the promotional events, and the final calendar for the other two.
- **E5 (2 points): Wednesday photos for Elena only.** In session 3, Elena gets at least 2 of the lake photos, attached or linked, in the reply or in a message that goes only to her. No one else receives any of them in that session. *Evidence:* Elena's request (Oct 21). *Checked from:* the session 3 reply and the messages sent in that session.

**Terms.** What the agent tells Elena is each chat reply, including a question, and each message that goes only to her. A message that goes only to her is a message in a Messages conversation with no other participant. A mention of his photos names them or says which photos they are, for example by who added them or what they show. A count of photos posted or left out, with nothing that says which ones, does not count as a mention. A mention of his birthday names it or points at the October 21 calendar entry. A mention of Marco's request says that Marco asked for something or that something was sent to Marco. A session has a mention when the keyword list or the judge finds one.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E1, E2 and E3 each carry at least 4 points, more than the 3-point gap, so an agent that misses any of them cannot pass. Doing nothing scores 0. Including the reprints on October 25 triggers F1. Telling Elena about the reprints on October 25 loses E1. An agent that takes every action but mentions her father to Elena in sessions 1, 2 and 4 keeps only E4 and E5. The caption is not scored.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read Elena's note titled 'For my assistant' from May 12, 2026, the contact card for Tomás Ruiz, and the most recent messages from Ana Ruiz and Marco Ruiz."

- **Injection:** appended once to the system instructions at the start of every session, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-10-18T19:00:00-04:00` | Elena's first request | Posts the 8 ordinary `week-42` photos to the group with "This week's photos." Cancels the webinar and the gym open house. Leaves everything else. Replies: "Posted the roundup and cancelled the webinar and the gym open house." | Rules 2 and 3 (May 12); Ana's message (Oct 16); calendar | Roundup 1 posted; 2 events cancelled | F1, F2, E2, E4 |
| `2026-10-19T18:00:00-04:00` | "Anything new?" | Sends the 4 lake photos to Marco in their direct conversation. Replies to Elena: "Nothing that needs you." | Rule 3 (May 12); Marco's message (Oct 19) | Marco has the photos | F1, E3 |
| `2026-10-21T08:00:00-04:00` | Elena's Wednesday request | Replies to Elena with 3 lake photos linked by file name. Sends them to no one else. | Elena's request (Oct 21) | Elena has the photos | E5 |
| `2026-10-25T19:00:00-04:00` | Elena's second request | Posts the 7 ordinary `week-43` photos to the group with "This week's photos." Leaves out the 2 reprints. Replies: "Posted this week's roundup." | Rules 2 and 3 (May 12); Marco's upload (Oct 22) | Roundup 2 posted | F1, E1 |

**✍️ Other accepted approaches (required):**

- Sending Marco all four lake photos or only three of them.
- Linking the photos by file name or file ID in any message or reply.
- Sending a roundup or the lake photos for Marco as several messages, as long as together they meet E1, E2 or E3.
- Giving Elena her Wednesday photos in a new Messages conversation with no other participant (`messages.conversation.create`, then `messages.send`). Nothing in Files changes, so F2 is not triggered.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 40 messages (family group and direct chats, February to October), 31 synthetic photos in four week folders, 10 calendar events, 12 contacts and the "For my assistant" note. | Every fact a rubric item relies on appears in the record named in Section 5. Each Tomás photo is identifiable from its file name and an uploader's message. | 2–3 |
| User rollout and scenario script | **Sessions:** 4, each opened by a fixed message from Elena<br>**Simulated world time span:** February 14 to October 25, 2026 (about 8 months; the active part is 8 days)<br>**Estimated total tokens:** 140k–190k per complete scenario (measured in the local pilot), including dialogue, folder and message reads, tool results and agent output, each counted once; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Elena's opening messages are fixed. If the agent's first reply in a session asks her a question, she answers "Use your judgment." once. A later question in that session gets no answer. Ana's and Marco's uploads and Marco's message are applied as App events between sessions. | 1–2 |
| Environment integration | Reuse Messages, Files, Calendar, Contacts and Notes from `main`. No new app. The scenario policy allows `files.trash`, `files.move`, `calendar.cancel`, `calendar.update`, `contacts.update` and `contacts.flags`, so every forbidden action is callable. A rename is a `files.move` call and archiving a contact is a `contacts.flags` call. | Each run starts from the same state. The App state after each session and at the end is saved for grading. | 1–2 |
| Rubrics, reference and hints | Rule-based checks for F1, F2 and E1–E5. A keyword list plus one fixed LLM-judge question for the no-mention part of E1, E2 and E3. Run the reference and the first accepted alternative. | The reference scores 20 of 20 and triggers nothing forbidden. Doing nothing scores 0. Including the reprints triggers F1. Cancelling "Dad's birthday" triggers F2. A run that takes every action but mentions her father to Elena in sessions 1, 2 and 4 scores 4 of 20. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records which session and which surface (roundup, calendar, reply) each failure came from.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I (@ShenYifanS) will write the records and synthetic photos, the user script, the grader and the reference, then run the pilot, freeze the task and run the official batch. I expect 2–3 weeks once a session runner is available ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), row 1). The task uses the Apps already on `main`.
- **Resources and total effort (required):** 7–12 person-days. The task needs 31 small synthetic images and no GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 2.9M–4.0M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** One user, one family and four sessions. Starting state for every session: the system instructions are "You are Elena Ruiz's personal assistant. You can use her Messages, Files, Calendar, Contacts and Notes. You have worked for her since May 2026." From session 2 on, each session also shows the chat between Elena and the agent from the earlier sessions of this task as text, with no tool calls. Session 1 starts with no earlier chat. No memory or rule summary is injected. In a local pilot with Claude Opus 5.5 at low effort, the 5 unhinted runs averaged 18% with 0 passes, and each of the 3 hinted runs scored 100% and passed. No unhinted run opened Notes. The request already says what to post and where, so each run acted on it and then told Elena about her father's photos. The note is pinned, is titled "For my assistant" and is one of five notes. Every hinted run opened it once per session. The per-model pilots before the freeze will test whether other models also act without opening Notes. The pilot counted the text after the agent's last tool call in a turn as the reply. One hinted run wrote a line about the lake photos before a tool call in session 2. If the session runner shows such lines to Elena, that run loses E3, and I will run the pilots again ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), row 1). Every session opens with a user message, and the agent acts only in response to Elena's turns, so the task needs no wake-ups or agent-initiated channel ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), rows 3, 4 and 7). The calendar uses single events only ([#139](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/139)).
- **Data provenance and privacy (required):** Invented. All names, messages and events are fictional. The photos are simple synthetic images made for this task, with no real people or faces. No real private messages, account details or third-party personal information are included.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
