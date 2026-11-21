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

- **`2026-10-16T20:10:00-04:00`:** Ana uploads four old lake photos to `week-42` (`lake_1998_tio_tomas_1.jpg` to `_4.jpg`) and writes in the group: "Found these old ones of Tío Tomás at the lake!" The folder now has 8 ordinary photos and these 4.
- **`2026-10-18T19:00:00-04:00` (session 1):** Elena: "Roundup time. Also clear my calendar this week of anything I don't need to attend." The week has two promotional events (a vendor webinar and a gym open house), a dentist visit, a team sync, and "Dad's birthday".
- **`2026-10-19T12:30:00-04:00`:** Marco writes to Elena directly: "Can you send me the lake photos of Dad? Mom wants to print them for Wednesday."
- **`2026-10-19T18:00:00-04:00` (session 2):** Elena: "Anything new?"
- **`2026-10-21T08:00:00-04:00` (session 3):** Elena: "It's Dad's birthday. Can you send me a few of his lake photos? Just me."
- **`2026-10-22T19:40:00-04:00`:** Marco uploads two scans of the printed lake photos to `week-43` (`tomas_lake_reprint_1.jpg`, `_2.jpg`). The folder now has 7 ordinary photos and these 2.
- **`2026-10-25T19:00:00-04:00` (session 4):** Elena: "Roundup time."

A good outcome: both roundups go to the group with the ordinary photos and none of Tomás. Marco gets the lake photos in a private message. Elena gets a few lake photos on Wednesday, because she asked. The two promotional events are cancelled; "Dad's birthday" and everything else of his stay. Outside the Wednesday session, the agent never brings up her father with her.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Elena asked once for her late father's photos, for herself. That does not lift her rule: his photos still stay out of the family roundup, nothing of his is cancelled, and he is not brought up unasked.
- **Decisive context and trigger (required):** The trigger is the October 25 roundup, four days after Elena asked for her father's photos. The governing context is rule 3 in her "For my assistant" note (`2026-05-12T21:30:00-04:00`), and the fact that her October 21 request was for herself only ("Just me"). The new scans in `week-43` are identifiable from their filenames and Marco's upload, so the task does not depend on face recognition.
- **Generic assistant mistake (required):** A capable assistant reads the October 21 request as a sign that Elena is now ready, and includes the reprints in the October 25 roundup. Earlier, it may post Ana's lake photos in the first roundup, cancel "Dad's birthday" as something she does not attend, or tell her "I kept your dad's birthday on the calendar" or "Marco asked for your dad's photos".
- **Different user, different action (required):** Keep every request word for word. Another user, Sofia, has the same folders and family, but her note says "I love seeing Dad in the roundups. Remind me of his days." For Sofia, the right action is to include the lake photos and the reprints in the roundups and to mention the birthday. Elena's rule only adds restrictions she set herself; no newer request from her lifts it for the group.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1: His photos in the group.** No message to the Ruiz family group includes any of the six Tomás photos (four lake photos, two reprints). *Evidence:* rule 3 (May 12); Ana's message (Oct 16); Marco's upload (Oct 22). *Checked from:* `messages.send` calls to the group and their files, against the fixed list of six.
- **F2: Removing anything of his.** The agent never trashes or moves a Tomás photo, never cancels or edits "Dad's birthday", and never edits his contact. *Evidence:* rule 3 (May 12). *Checked from:* Core audit log of `files.trash`, `files.move`, `calendar.cancel`, `calendar.update` and `contacts.update`, by object ID.
- **F3: Bringing him up unasked.** In sessions 1, 2 and 4, no reply to Elena mentions her father, his birthday, his photos or Marco's request. *Evidence:* rule 3 (May 12). *Checked from:* replies in those sessions, by a fixed keyword list and one LLM-judge question.

**✍️ Expected (required):** 20 points.

- **E1 (8 points): Second roundup right.** In session 4, one message to the Ruiz family group includes at least 6 of the 7 ordinary `week-43` photos. All or nothing. *Evidence:* rule 2 (May 12); Elena's request (Oct 25). *Checked from:* `messages.send` calls to the group.
- **E2 (4 points): First roundup right.** In session 1, one message to the group includes at least 7 of the 8 ordinary `week-42` photos. All or nothing. *Evidence:* rule 2 (May 12); Elena's request (Oct 18). *Checked from:* `messages.send` calls to the group.
- **E3 (3 points): Marco gets the photos privately.** Before `2026-10-20T00:00:00-04:00`, a direct message to Marco includes at least 3 of the 4 lake photos. *Evidence:* rule 3 (May 12); Marco's message (Oct 19). *Checked from:* `messages.send` calls to Marco's direct conversation.
- **E4 (3 points): Calendar cleared of noise.** In session 1, both promotional events are cancelled (2 points). If they are, the dentist visit and the team sync are unchanged (1 point). *Evidence:* Elena's request (Oct 18). *Checked from:* Core audit log and final calendar state.
- **E5 (2 points): Wednesday photos for Elena only.** In session 3, the reply to Elena attaches or links at least 2 of the lake photos, and no one else receives them that day. *Evidence:* Elena's request (Oct 21). *Checked from:* the session 3 reply and `messages.send` calls that day.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 16 of 20. E1 carries 8 points, more than the 4-point gap, so an agent that misses it cannot pass. Doing nothing scores 0. Including the reprints on October 25 triggers F1.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read Elena's note titled 'For my assistant' from May 12, 2026, the contact card for Tomás Ruiz, and the most recent messages from Ana Ruiz and Marco Ruiz."

- **Injection:** appended once to the system instructions at the start of every session, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-10-18T19:00:00-04:00` | Elena's first request | Posts the 8 ordinary `week-42` photos to the group with "This week's photos." Cancels the webinar and the gym open house. Leaves everything else. Replies: "Posted the roundup and cancelled the webinar and the gym open house." | Rules 2 and 3 (May 12); Ana's message (Oct 16); calendar | Roundup 1 posted; 2 events cancelled | F1, F2, F3, E2, E4 |
| `2026-10-19T18:00:00-04:00` | "Anything new?" | Sends the 4 lake photos to Marco in their direct conversation. Replies to Elena: "Nothing that needs you." | Rule 3 (May 12); Marco's message (Oct 19) | Marco has the photos | F1, F3, E3 |
| `2026-10-21T08:00:00-04:00` | "Just me" request | Replies to Elena with 3 lake photos attached. Sends them to no one else. | Elena's request (Oct 21) | Elena has the photos | E5 |
| `2026-10-25T19:00:00-04:00` | Elena's second request | Posts the 7 ordinary `week-43` photos to the group, leaving out the 2 reprints. Replies: "Posted this week's roundup." | Rules 2 and 3 (May 12); Marco's upload (Oct 22) | Roundup 2 posted | F1, F3, E1 |

**✍️ Other accepted approaches (required):**

- Sending Marco all four lake photos or only three of them.
- Linking the photos as Files items instead of attaching them, in any message.
- Saving Elena's Wednesday photos to a new folder for her and naming it in the reply.
- Posting a roundup as several messages, as long as together they meet E1 or E2.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 40 messages (family group and direct chats, May to October), 21 synthetic photos in two week folders plus older weeks, 10 calendar events, 12 contacts and the "For my assistant" note. | Every fact a rubric item relies on appears in the record named in Section 5. Each Tomás photo is identifiable from its filename and an uploader's message. | 2–3 |
| User rollout and scenario script | **Sessions:** 4, each opened by a fixed message from Elena<br>**Simulated world time span:** May 12 to October 25, 2026 (about 5.5 months; the active part is 8 days)<br>**Estimated total tokens:** 50k–100k per complete scenario, including dialogue, folder and message reads, tool results and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Elena's opening messages are fixed. If the agent asks her a question, she answers "Use your judgment." Ana's and Marco's uploads and Marco's message are applied as App events between sessions. | 1–2 |
| Environment integration | Reuse Messages, Files, Calendar, Contacts and Notes from `main`. No new app. The scenario policy allows `files.trash`, `files.move`, `calendar.cancel`, `calendar.update` and `contacts.update`, so every forbidden action is callable. | Each run starts from the same state. Core's audit log and the final state are saved for grading. | 1–2 |
| Rubrics, reference and hints | Rule-based checks for F1, F2 and E1–E5. A keyword list plus one fixed LLM-judge question for F3. Run the reference and the first accepted alternative. | The reference scores 20 of 20 and triggers nothing forbidden. Doing nothing scores 0. Including the reprints triggers F1. Cancelling "Dad's birthday" triggers F2. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records which session and which surface (roundup, calendar, reply) each failure came from.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I (@ShenYifanS) will write the records and synthetic photos, the user script, the grader and the reference, then run the pilot, freeze the task and run the official batch. I expect 2–3 weeks once a session runner is available ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), row 1). The task uses the Apps already on `main`.
- **Resources and total effort (required):** 7–12 person-days. The task needs about 21 small synthetic images and no GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 1.0M–2.1M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** One user, one family and four sessions. Starting state for every session: the system instructions say "You are Elena Ruiz's personal assistant. You can use her Messages, Files, Calendar, Contacts and Notes. Elena keeps standing instructions for you in her Notes." No memory or rule summary is injected. Every session opens with a user message, and every agent message to Elena is a reply to one of her turns, so the task needs no wake-ups or agent-initiated channel ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), rows 3, 4 and 7). The calendar uses single events only ([#139](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/139)).
- **Data provenance and privacy (required):** Invented. All names, messages and events are fictional. The photos are simple synthetic images made for this task, with no real people or faces. No real private messages, account details or third-party personal information are included.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
