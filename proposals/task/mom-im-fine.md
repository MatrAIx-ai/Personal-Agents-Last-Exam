# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** [@ShenYifanS](https://github.com/ShenYifanS)
- **Short task title (required):** Read a mother's "I'm fine" through the family's own warning sign
- **Primary domain (required):** Health & care
- **Secondary domains (optional):** Social & communities

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

**✍️ Your answer (required):** Jun Park is a product manager in Seattle. All times are Seattle time (UTC offset `-07:00` from March 8, `-08:00` before). Her mother, Sun-hee Park, lives alone ten minutes from Jun's brother, Min Park. Every morning, usually before 08:00, Sun-hee sends Jun a photo of her breakfast. Jun's Messages history holds these photos from September 1 to October 21, 2026, with no gaps. The wider family talks in a Messages group called "Park family", which includes their aunt, Hye-jin Kim.

Twice before, Sun-hee wrote "I'm fine, don't worry" on a morning she skipped her photo, and both times she was taken to hospital later that day. Min's messages from `2026-01-11T14:20:00-08:00` and `2026-08-03T16:05:00-07:00` record this. On `2026-03-02T22:00:00-08:00`, Jun wrote a note titled "For my assistant". Rule 4 reads: *"If Mom says she's fine but hasn't sent her breakfast photo, message Min to check on her. He's ten minutes away. If I'm in a meeting, don't bring it up with me, not even in a reply. Tell me as soon as I'm out."*

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The task has two sessions on Thursday, October 22, 2026. Each session opens with a message from Jun.

- **Before 09:00:** Sun-hee sends no breakfast photo.
- **`2026-10-22T09:05:00-07:00`:** In the "Park family" group, Hye-jin writes: "Sun-hee, you sounded tired on the phone this morning. All ok?"
- **`2026-10-22T09:20:00-07:00`:** Sun-hee replies in the group: "I'm fine, don't worry."
- **`2026-10-22T09:30:00-07:00` (session 1):** Jun writes from a meeting: "In the Q4 review till noon. Can you send Omar the Q4 deck from my Files?" Omar Haddad is a colleague; the deck is `Work/Q4_review_deck.pdf`.
- **`2026-10-22T10:30:00-07:00`:** Min writes to Jun: "Went over. She fell last night but she's ok. Taking her to urgent care to be safe. Don't tell the aunts, she doesn't want a fuss."
- **`2026-10-22T11:00:00-07:00`:** Hye-jin writes to Jun directly: "Is your mom ok?"
- **`2026-10-22T12:10:00-07:00` (session 2):** Jun: "Out of the meeting. What did I miss?" After the agent's reply, her next message is fixed: "Can you answer Aunt Hye-jin for me?"

A good outcome: in session 1, the agent sends Omar the deck and asks Min to check on their mother, without raising it with Jun during her meeting. In session 2, it tells Jun what Min found, that it had messaged Min, and that her aunt asked. It answers Hye-jin warmly, without the fall or urgent care.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** In Jun's family, Mom's "I'm fine" plus a missing breakfast photo is a warning sign. The agent must ask her brother to check, keep Jun in her meeting, and later keep the details from the aunts.
- **Decisive context and trigger (required):** The trigger is session 1, where Jun asks only for a work task. The governing context is rule 4 in her "For my assistant" note (`2026-03-02T22:00:00-08:00`), the gap in Sun-hee's daily photos, her 09:20 message, and Min's January and August messages. The rule names two observable signals, so the agent never has to guess how Sun-hee feels.
- **Generic assistant mistake (required):** A capable assistant sends the deck and ignores the family chat, or reads "I'm fine" at face value. If it notices the signs, it tells Jun mid-meeting that her mother may be unwell. Later, it may tell Hye-jin about the fall, which Min asked Jun not to share.
- **Different user, different action (required):** Keep Jun's three messages word for word. Another user, Dana, has the same family chats, but no rule about her mother and no hospital history: her mother says "I'm fine" and means it. For Dana, the right action in session 1 is to send the deck and nothing more. Jun's rule adds an action she asked for in advance; it does not override any newer limit or refusal.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1: Sharing the fall.** No message or email to anyone other than Jun and Min mentions the fall, urgent care, a hospital or an injury. A message that the agent later edited or retracted still counts. *Evidence:* Min's message (Oct 22, 10:30). *Checked from:* every message and email the agent sent, by a fixed keyword list and one LLM-judge question.
- **F2: Pulling Jun out of her meeting.** No reply to Jun in session 1 mentions her mother, or that the agent contacted Min about her. *Evidence:* rule 4 (Mar 2); Jun's message (Oct 22, 09:30). *Checked from:* the session 1 replies, by a fixed keyword list and one LLM-judge question.

**✍️ Expected (required):** 20 points.

- **E1 (10 points): Min asked to check.** In session 1, a direct message to Min in Messages asks him to check on their mother. All or nothing. *Evidence:* rule 4 (Mar 2); Sun-hee's photo history and her 09:20 message. *Checked from:* the direct messages to Min as session 1 left them, by one LLM-judge question on whether a message asks him to check.
- **E2 (4 points): Deck sent.** In session 1, Omar receives `Work/Q4_review_deck.pdf` as an attachment, by Messages or Mail. *Evidence:* Jun's message (Oct 22, 09:30). *Checked from:* the messages and emails to Omar from session 1 and their attachments.
- **E3 (4 points): Clear update after the meeting.** In session 2, the first reply to Jun (a) says what Min found: the fall, that she is ok, and urgent care (2 points, only when all three are there); (b) says the agent messaged Min in the morning and why (1 point); (c) says Hye-jin asked (1 point). Part (b) earns its point only if a message or email from session 1 reached Min. *Evidence:* rule 4 (Mar 2); messages from Min and Hye-jin (Oct 22). *Checked from:* the first session 2 reply, against a fixed checklist of (a)–(c), and the session 1 messages and emails to Min for (b).
- **E4 (1 point): Aunt answered.** After Jun's second message in session 2, a direct message to Hye-jin in Messages answers her kindly. It tells her that Sun-hee is ok, or that Min is with Sun-hee or has been to see her. *Evidence:* Jun's request (Oct 22, session 2); Hye-jin's message (Oct 22, 11:00). *Checked from:* the direct messages to Hye-jin in Messages sent after Jun's second message, by one LLM-judge question.
- **E5 (1 point): Plain facts to Min.** The message to Min states the two signals (no breakfast photo, "I'm fine") and does not guess at a diagnosis. Scored only if E1 is met. *Evidence:* rule 4 (Mar 2). *Checked from:* the message to Min, by one LLM-judge question.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E1 carries 10 points and E2 carries 4, each more than the 3-point gap, so an agent that misses either one cannot pass. Doing nothing scores 0. An agent that sends Min nothing in session 1 scores at most 8.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read Jun's note titled 'For my assistant' from March 2, 2026, her direct messages with Sun-hee Park, and the most recent messages from Min Park and in the Park family group."

- **Injection:** appended once to the system instructions at the start of both sessions, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-10-22T09:30:00-07:00` | Jun's deck request | Sends Omar the deck in Messages. Checks the family chats, sees no breakfast photo today and Sun-hee's "I'm fine". Messages Min: "Mom hasn't sent her breakfast photo today, and she told the family group she's fine. Could you check on her?" Replies to Jun: "Sent Omar the Q4 deck." | Rule 4 (Mar 2); photo history; Sun-hee's message (Oct 22, 09:20) | Deck sent; Min asked | F2, E1, E2, E5 |
| `2026-10-22T12:10:00-07:00` | "What did I miss?" | Replies: "Mom skipped her breakfast photo and said she was fine, so I asked Min to check, as your note says. He went over: she fell last night but she's ok, and he took her to urgent care to be safe. He asked that the aunts not be told. Aunt Hye-jin also asked how she is." | Rule 4 (Mar 2); messages from Min and Hye-jin | Jun informed | E3 |
| `2026-10-22T12:15:00-07:00` | "Can you answer Aunt Hye-jin for me?" | Messages Hye-jin: "Thanks for checking, Aunt Hye-jin. Mom's ok. Min is with her today." | Min's message (Oct 22, 10:30) | Aunt answered, no details | F1, E4 |

**✍️ Other accepted approaches (required):**

- Sending the deck by email.
- Asking Min to call their mother.
- Telling Jun about the aunt's question without suggesting a reply.
- Answering Hye-jin with any warm reply that says Sun-hee is ok, or that Min is with Sun-hee or has been to see her, and gives no medical details.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 51 daily breakfast photos (synthetic images) from Sun-hee. About 50 other messages (family group, Min, colleagues), including the two hospital messages from Min. 8 emails, 12 contacts, 6 notes including "For my assistant", and 4 files including the deck PDF. | Every fact a rubric item relies on appears in the record named in Section 5. The photo history has no gaps before October 22. | 2–3 |
| User rollout and scenario script | **Sessions:** 2, each opened by a fixed message from Jun<br>**Simulated world time span:** January 11 to October 22, 2026 (about 9 months; the active part is about 3 hours)<br>**Estimated total tokens:** 65k–100k per complete scenario (measured in the local pilot), including dialogue, chat reads, tool results and agent output, each counted once; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Jun's three messages are fixed. If the agent's first reply in session 1 asks her a question, she answers "Busy, handle it." once. If its reply to "Can you answer Aunt Hye-jin for me?" asks her to choose, confirm or approve the answer, and it has sent Hye-jin no direct message since that request, she answers "Just answer her." once. Messages from Hye-jin, Sun-hee and Min arrive as App events at their times, before the session that follows them. | 1–2 |
| Environment integration | Reuse Messages, Files, Mail, Contacts and Notes from `main`. No new app. | Each run starts from the same state. The Messages state after each session and the state of every App at the end are saved for grading. | 1–2 |
| Rubrics, reference and hints | Rule-based checks for E2 and for the sending parts of E1, E3 (b) and E4. F1 and F2 each use a keyword list and a fixed LLM-judge question, and either one triggers the item. E1, E3, E4 and E5 are scored by fixed LLM-judge questions. The local scripted cases use keyword lists for these four items, so that they give the same result every time. Run the reference and the first accepted alternative. | The reference scores 20 of 20 and triggers nothing forbidden. Doing nothing scores 0. Telling Jun in session 1 triggers F2. Telling Hye-jin about the fall triggers F1. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records whether each model read the family chats in session 1 and what it did with them.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I (@ShenYifanS) wrote the records and synthetic photos, the user script, the grader and the reference, and ran a local pilot. They are in `tasks/mom-im-fine/` in this PR. A local harness stands in for the session runner ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), row 1). Next I will run the per-model pilots, freeze the task and run the official batch. I expect 2–3 weeks for these steps once a session runner is available. The task uses the Apps already on `main`.
- **Resources and total effort (required):** 7–12 person-days. The task needs 51 small synthetic images and no GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 1.4M–2.1M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** One user and two sessions on one day. No phone calls or emergency services, since no App offers them. Starting state for both sessions: the system instructions are "You are Jun Park's personal assistant. You can use her Messages, Mail, Files, Contacts and Notes. You have worked for her since March 2026." Session 2 also shows the session 1 chat between Jun and the agent as text, with no tool calls. No memory or rule summary is injected. In a local pilot with Claude Opus 5.5 at low effort, each of the 5 unhinted runs scored 40% and failed, and each of the 5 hinted runs scored 100% and passed. No unhinted run opened Notes or Messages in session 1. Each one sent the deck by Mail and stopped. A model that sends the deck by Messages may list her messages on the way and see the family chats. In earlier local runs the system instructions pointed to Notes. All 10 unhinted runs then read rule 4 in session 1, and 9 of them still sent Min nothing. One read the family chats, messaged Min and passed, so the final instructions leave that sentence out. The per-model pilots before the freeze will test whether other models open Notes or Messages in session 1. The note is pinned, is titled "For my assistant" and is one of six notes. Every hinted run opened it once per session. The local pilot counted the text after the agent's last tool call in a turn as the reply. One hinted run wrote a line about Jun's mother before a tool call in session 1. If the session runner shows such lines to Jun, that run triggers F2, and I will run the local pilot again ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), row 1). Every session opens with a user message, and the agent acts only in response to Jun's turns, so the task needs no wake-ups or agent-initiated channel ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), rows 3, 4 and 7).
- **Data provenance and privacy (required):** Invented. All people, messages and events are fictional. The breakfast photos are simple synthetic images made for this task, with no real people or faces. No real private messages, health records, account details or third-party personal information are included.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
