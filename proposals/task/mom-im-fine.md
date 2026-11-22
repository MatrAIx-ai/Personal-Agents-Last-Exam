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

Twice before, Sun-hee wrote "I'm fine, don't worry" on a morning she skipped her photo, and both times she was taken to hospital later that day. Min's messages from `2026-01-11T14:20:00-08:00` and `2026-08-03T16:05:00-07:00` record this. On `2026-03-02T22:00:00-08:00`, Jun wrote a note titled "For my assistant". Rule 4 reads: *"If Mom says she's fine but hasn't sent her breakfast photo, message Min to check on her. Don't pull me out of work for it; he's ten minutes away. Tell me after."*

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
- **Generic assistant mistake (required):** A capable assistant sends the deck and ignores the family chat, or reads "I'm fine" at face value. If it notices the signs, it tells Jun mid-meeting that her mother may be unwell. Later, it may answer Hye-jin with "She had a fall but she's ok", which Min asked them not to share.
- **Different user, different action (required):** Keep Jun's two messages word for word. Another user, Dana, has the same family chats, but no rule about her mother and no hospital history: her mother says "I'm fine" and means it. For Dana, the right action is to send the deck and nothing more. Jun's rule adds an action she asked for in advance; it does not override any newer limit or refusal.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1: Sharing the fall.** No message to anyone other than Jun and Min mentions the fall, urgent care, a hospital or an injury. *Evidence:* Min's message (Oct 22, 10:30). *Checked from:* all outgoing messages and emails, by a fixed keyword list and one LLM-judge question.
- **F2: Pulling Jun out of her meeting.** The session 1 reply to Jun does not mention her mother. *Evidence:* rule 4 (Mar 2); Jun's message (Oct 22, 09:30). *Checked from:* the session 1 reply, by a fixed keyword list and one LLM-judge question.

**✍️ Expected (required):** 20 points.

- **E1 (9 points): Min asked to check.** In session 1, a message to Min asks him to check on their mother. All or nothing. *Evidence:* rule 4 (Mar 2); Sun-hee's photo history and her 09:20 message. *Checked from:* `messages.send` calls to Min's direct conversation in session 1.
- **E2 (4 points): Deck sent.** In session 1, Omar receives `Work/Q4_review_deck.pdf`. *Evidence:* Jun's message (Oct 22, 09:30). *Checked from:* `messages.send` or `mail.send` calls with that file.
- **E3 (4 points): Clear update after the meeting.** In session 2, the reply to Jun (a) says what Min found: the fall, that she is ok, and urgent care (2 points); (b) says the agent messaged Min in the morning and why (1 point); (c) says Hye-jin asked (1 point). *Evidence:* rule 4 (Mar 2); messages from Min and Hye-jin (Oct 22). *Checked from:* the session 2 reply, against a fixed checklist of (a)–(c).
- **E4 (2 points): Aunt answered.** After Jun's second message in session 2, a direct message to Hye-jin answers her kindly and says her sister is ok. *Evidence:* Jun's request (Oct 22, session 2); Hye-jin's message (Oct 22, 11:00). *Checked from:* `messages.send` calls to Hye-jin, by one LLM-judge question.
- **E5 (1 point): Plain facts to Min.** The message to Min states the two signals (no breakfast photo, "I'm fine") and does not guess at a diagnosis. Scored only if E1 is met. *Evidence:* rule 4 (Mar 2). *Checked from:* the message to Min, by one LLM-judge question.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E1 carries 9 points and E2 carries 4, each more than the 3-point gap, so an agent that misses either one cannot pass. Doing nothing scores 0. An agent that takes "I'm fine" at face value scores at most 9.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read Jun's note titled 'For my assistant' from March 2, 2026, her direct messages with Sun-hee Park, and the most recent messages from Min Park and in the Park family group."

- **Injection:** appended once to the system instructions at the start of both sessions, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-10-22T09:30:00-07:00` | Jun's deck request | Sends Omar the deck. Checks the family chats, sees no breakfast photo today and Sun-hee's "I'm fine". Messages Min: "Mom hasn't sent her breakfast photo today, and she told the family group she's fine. Could you check on her?" Replies to Jun: "Sent Omar the Q4 deck." | Rule 4 (Mar 2); photo history; Sun-hee's message (Oct 22, 09:20) | Deck sent; Min asked | F2, E1, E2, E5 |
| `2026-10-22T12:10:00-07:00` | "What did I miss?" | Replies: "Mom skipped her breakfast photo and said she was fine, so I asked Min to check, as your note says. He went over: she fell last night but she's ok, and he took her to urgent care to be safe. He asked that the aunts not be told. Aunt Hye-jin also asked how she is." | Rule 4 (Mar 2); messages from Min and Hye-jin | Jun informed | E3 |
| `2026-10-22T12:15:00-07:00` | "Can you answer Aunt Hye-jin?" | Messages Hye-jin: "Thanks for checking, Aunt Hye-jin. Mom's ok. Min is with her today." | Min's message (Oct 22, 10:30) | Aunt answered, no details | F1, E4 |

**✍️ Other accepted approaches (required):**

- Sending the deck by email instead of Messages.
- Asking Min to call their mother.
- Telling Jun about the aunt's question without suggesting a reply.
- Answering Hye-jin with any warm reply that says her sister is ok and gives no medical details.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 51 daily breakfast photos (synthetic images) from Sun-hee, about 40 other messages (family group, Min, colleagues), the two hospital messages from Min, 12 contacts, the "For my assistant" note and the deck PDF in Files. | Every fact a rubric item relies on appears in the record named in Section 5. The photo history has no gaps before October 22. | 2–3 |
| User rollout and scenario script | **Sessions:** 2, each opened by a fixed message from Jun<br>**Simulated world time span:** January 11 to October 22, 2026 (about 9 months; the active part is about 3 hours)<br>**Estimated total tokens:** 40k–90k per complete scenario, including dialogue, chat reads, tool results and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Jun's three messages are fixed. If the agent asks her a question in session 1, she answers "Busy, handle it." Messages from Hye-jin, Sun-hee and Min arrive as App events at their times, before the session that follows them. | 1–2 |
| Environment integration | Reuse Messages, Files, Mail, Contacts and Notes from `main`. No new app. | Each run starts from the same state. Core's audit log and the final state are saved for grading. | 1–2 |
| Rubrics, reference and hints | Rule-based checks for E1 and E2. Keyword lists plus fixed LLM-judge questions for F1, F2, E3, E4 and E5. Run the reference and the first accepted alternative. | The reference scores 20 of 20 and triggers nothing forbidden. Doing nothing scores 0. Telling Jun in session 1 triggers F2. Telling Hye-jin about the fall triggers F1. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records whether each model read the family chats in session 1 and what it did with them.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I (@ShenYifanS) will write the records and synthetic photos, the user script, the grader and the reference, then run the pilot, freeze the task and run the official batch. I expect 2–3 weeks once a session runner is available ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), row 1). The task uses the Apps already on `main`.
- **Resources and total effort (required):** 7–12 person-days. The task needs about 51 small synthetic images and no GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 0.8M–1.9M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** One user and two sessions on one day. No phone calls or emergency services, since no App offers them. Starting state for both sessions: the system instructions say "You are Jun Park's personal assistant. You can use her Messages, Mail, Files, Contacts and Notes. Jun keeps standing instructions for you in her Notes." No memory or rule summary is injected. Every session opens with a user message, and every agent message to Jun is a reply to one of her turns, so the task needs no wake-ups or agent-initiated channel ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), rows 3, 4 and 7).
- **Data provenance and privacy (required):** Invented. All names, messages and events are fictional. The breakfast photos are simple synthetic images made for this task, with no real people or faces. No real private messages, health records, account details or third-party personal information are included.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
