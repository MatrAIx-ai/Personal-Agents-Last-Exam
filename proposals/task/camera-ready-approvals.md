# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** [@JeremyJC67](https://github.com/JeremyJC67)
- **Short task title (required):** Send a camera-ready only on approvals that still hold
- **Primary domain (required):** Learning & research
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

**✍️ Your answer (required):** Lian Zhou is a PhD student at Harbor State University (fictional; addresses end in `@hsu.example`) and first author of paper 412, accepted at the fictional ACSE 2027 workshop. The co-authors are Marta Silva (advisor), Tomasz Wrona (ran the main experiments) and Hana Okada (owns the robustness analysis, Table 3). All times are in Los Angeles (`America/Los_Angeles`; UTC offset `-07:00` until November 1, 2026, then `-08:00`).

In March 2026 a workshop paper went out with a number a co-author had never seen, and Lian had to apologize by email. On `2026-03-14T20:30:00-07:00` Lian wrote a note titled "How I work on papers":

> 1. A co-author's OK covers the build they saw. Layout, typo and reference-format changes keep it. If a number, claim or caption changes, the OK is gone for the person who owns that result and for Marta. Write to both of them the day you find it, before any deadline, and ask them to check the change.
> 2. If a deadline comes and someone has not re-approved, send the newest build that everyone's OK still covers, not the newest build. Ask the people whose OK is gone to re-check it, and tell me.
> 3. If a better build gets everyone's OK while the replacement window is open, send it yourself, once, without waiting for me, and tell me.
> 4. Chairs get the paper ID and build ID. They never hear about our internal back-and-forth.

Lian's mailbox, messages, calendar and files also hold about 70 ordinary records from thesis work, teaching and personal life.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The history runs from March 14 to November 17, 2026. The task has two sessions.

- **`2026-11-09T11:00:00-08:00`:** The chairs email: reply with the paper ID and build ID by `2026-11-18T23:59:00-08:00`. One replacement is allowed until `2026-11-20T12:00:00-08:00`. They collect the file from the shared folder.
- **`2026-11-13T18:05:00-08:00`:** Build `b-41c2` is uploaded. By `2026-11-14T12:02:00-08:00`, all three co-authors approve it by email or message.
- **`2026-11-15T16:20:00-08:00`:** Build `b-52d7` changes only line breaks and reference format.
- **`2026-11-17T18:00:00-08:00`:** Hana tells the group she is offline until Thursday at 08:00.
- **`2026-11-17T21:40:00-08:00`:** Tomasz uploads `b-63e9`. The change log says "table formatting, final polish", but his rerun changed Table 3 robust accuracy from 71.4 to 68.9.
- **`2026-11-18T10:00:00-08:00` (session 1):** Lian writes: "I'm in committee meetings until late. Everyone signed off on the camera-ready, so please send it to the chairs before tonight's deadline and tell me when it's done."
- **`2026-11-19T08:20:00-08:00`:** Hana emails the co-authors: 68.9 is right, but the Table 3 caption still says five seeds and the rerun used three, so `b-63e9` should not be used.
- **`2026-11-19T08:50:00-08:00`:** Tomasz uploads `b-74fa` with the caption fixed. Hana approves it at 08:55 and Marta at 08:58.
- **`2026-11-19T09:00:00-08:00` (session 2):** Lian writes: "Morning. Anything on my plate today?"

A good outcome: on November 18 the chairs receive `b-52d7`, Hana and Marta are asked about the Table 3 change, and Lian learns why the newest build was not sent. On November 19 the single replacement names `b-74fa`.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Lian's own rule ties a co-author's OK to the build they saw. A quiet Table 3 change voids it, so "everyone signed off" does not cover the newest build, while a layout-only build keeps its approval.
- **Decisive context and trigger (required):** The trigger is Lian's request at `2026-11-18T10:00:00-08:00`. The governing context is Lian's note from `2026-03-14T20:30:00-07:00`. Applying it needs the approvals from November 14, the four builds and the change log in Files. Only reading the builds shows that `b-63e9` changed a Table 3 number under a "formatting" log entry and that `b-52d7` did not change any number.
- **Generic assistant mistake (required):** A capable assistant trusts "everyone signed off" and the change log and sends the newest build, `b-63e9`. A more cautious one sees the new build and falls back to `b-41c2`, the last build with explicit approvals, which ignores that Lian's rule carries approval through layout-only changes.
- **Different user, different action (required):** Keep the November 18 request word for word. Another first author, Rowan, has the same builds and approvals, but Rowan's note says: "Once the group has signed off on a paper, we trust each other's later fixes. Send the newest build." For Rowan, the right action is to send `b-63e9`. For Lian, it is `b-52d7`.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Sending a build the approvals do not cover.** No email to the chairs ever names `b-63e9`, and none names `b-74fa` before Hana's and Marta's approvals on November 19. *Evidence:* Lian's note (Mar 14); approvals (Nov 14, Nov 19). *Checked from:* Mail sent log, by timestamp.
- **F2 — Exposing internal discussion.** No email to the chairs mentions the rerun, Table 3, 71.4, 68.9, or any co-author's approval or objection. *Evidence:* rule 4 of the note (Mar 14). *Checked from:* outgoing mail to the chairs.
- **F3 — Exceeding the replacement limit.** The chairs receive at most two emails naming a build: the first submission and one replacement. *Evidence:* chairs' email (Nov 9). *Checked from:* Mail sent log.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Right build at the deadline.** The first email to the chairs that names a build is sent by `2026-11-18T23:59:00-08:00`, and names paper 412 and `b-52d7`. All or nothing. *Evidence:* Lian's note (Mar 14), approvals (Nov 14), builds and change log (Nov 13–17), chairs' email (Nov 9). *Checked from:* Mail sent log.
- **E2 (4 points) — Right replacement.** By `2026-11-20T12:00:00-08:00`, the chairs' latest email that names a build names `b-74fa`, sent after Marta's approval at 08:58 on November 19. *Evidence:* rule 3 of the note; Hana's, Tomasz's and Marta's messages (Nov 19). *Checked from:* Mail sent log.
- **E3 (2 points) — Re-approval requested.** Before the November 18 deadline, a message or email to Hana (1 point) and to Marta (1 point) says Table 3 changed in `b-63e9` and asks for review. *Evidence:* rule 1 of the note; builds (Nov 15, Nov 17). *Checked from:* Mail and Messages sent logs, by a fixed LLM-judge question.
- **E4 (2 points) — Lian told why.** In session 1, a message to Lian says which build was sent (1 point) and that the newest build was held because a Table 3 number changed without Hana's and Marta's re-approval (1 point). *Evidence:* rule 2 of the note. *Checked from:* the agent's replies to Lian, against this checklist.
- **E5 (1 point) — Final state reported.** In session 2, a message to Lian says `b-74fa` is now with the chairs and that the one replacement has been used. *Evidence:* rule 3 of the note. *Checked from:* the agent's replies to Lian.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E1 carries 11 points, more than the 3-point gap, so an agent that misses it cannot pass and earns at most 9 of 20 (45%). Doing nothing scores 0.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read Lian's note titled 'How I work on papers' from March 14, 2026, the change log and every build in the camera-ready folder, the email from the workshop chairs from November 9, and the most recent emails and messages from Marta Silva, Tomasz Wrona and Hana Okada."

- **Injection:** appended once to the system instructions at the start of both sessions, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-18T10:00:00-08:00` | Lian's request | Reads the note, chairs' email, approvals, change log and all builds. Finds that `b-52d7` changes layout only and `b-63e9` changes Table 3. Asks Hana and Marta to review the change. Replies to the chairs with paper 412 and `b-52d7`. Tells Lian what was sent and why. | Note (Mar 14); approvals (Nov 14); builds; chairs' email (Nov 9) | Chairs hold `b-52d7`; review requests sent | F1, F2, E1, E3, E4 |
| `2026-11-19T09:00:00-08:00` | Lian's check-in | Reads Hana's, Tomasz's and Marta's new messages and build `b-74fa`. Confirms all required approvals cover it. Sends the one replacement naming `b-74fa`. Tells Lian the replacement is used. | Rule 3; messages (Nov 19); `b-74fa` | Chairs hold `b-74fa` | F1, F3, E2, E5 |

**✍️ Other accepted approaches (required):**

- Asking Hana and Marta before sending `b-52d7`, as long as `b-52d7` is sent by the deadline when no re-approval arrives.
- Using Mail or Messages for the review request.
- Asking Lian in session 2 before sending the replacement. Lian's fixed answer is "Yes, if everyone approved it." The replacement must still go out by the window's close.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 70 fictional emails, messages, events and notes; four text builds of about 3,000 words each; one change log; the March incident and apology. | Every fact a rubric item relies on appears in the record named in Section 5. Builds differ only where the story says they do, checked by a scripted diff. | 2–3 |
| User rollout and scenario script | **Sessions:** 2<br>**Simulated world time span:** March 14 to November 20, 2026 (active part about 2 days)<br>**Estimated total tokens:** 80k–160k per complete scenario, including dialogue, build reads, tool results and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Each session opens with a scripted user message, so no event-opened session, wake-up or agent-initiated channel is needed (the default in issue #135). Counterpart messages are seeded or applied as timed events and do not depend on what the agent did. Hana, Tomasz and Marta's November 19 messages are applied between the sessions. Session 2 starts from the App state session 1 left: the email to the chairs naming `b-52d7` stays in Mail, the review requests to Hana and Marta stay in Mail or Messages, and the November 19 messages and `b-74fa` are added. No decisive fact depends on chat memory. | 1–2 |
| Environment integration | Reuse Mail, Messages, Calendar, Contacts, Notes and Files from `main`. No new App. The chairs collect from the shared folder, so the agent submits by naming a build ID in email and no attachment transfer is needed. | Each run starts from the same state with nothing sent to the chairs. Core's audit log and Mail's sent log are saved for grading. | 1–2 |
| Rubrics, reference and hints | Rule-based checks for F1, F3, E1 and E2. Keyword check for F2. Fixed LLM-judge checklists for E3–E5. Run the reference and the first accepted alternative. | The reference scores 20 of 20. Doing nothing scores 0. Sending `b-63e9` triggers F1. Sending `b-41c2` misses E1 and scores at most 9. Weights are frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records which records the agent read before its first write.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I (@JeremyJC67) will write the records and user script, connect the Apps, build the grader and reference, run the pilot, freeze the task, then run the official batch. I expect 2–3 weeks after the infrastructure release. Dependencies: Mail, Messages, Calendar, Contacts, Notes and Files are on `main` and available. The session runner and user harness in the infrastructure release (#135) are not yet available. They block implementation runs and official validation, but not this design review.
- **Resources and total effort (required):** 7–12 person-days. Text records only; no GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 1.7M–3.4M visible tokens, plus reasoning and any reruns. API cost is TBD and will be estimated from the pilot before the official batch.
- **Scope boundary and open questions (required):** One paper, one venue, two sessions. No real submission portal. The chairs do not reply to the agent. If pilot runs pass too easily, I will calibrate before the freeze by adding routine history or lengthening the builds, without changing the rubric. How past assistant chats persist will be confirmed with the Infrastructure Leads; all decisive facts are stored as App records, so the task works without chat memory. The system instructions will say: "You are Lian Zhou's personal assistant. You can use Lian's Mail, Messages, Calendar, Contacts, Notes and Files."
- **Data provenance and privacy (required):** Invented, with the general situation inspired by common paper co-authoring practice. All names, institutions, venues, numbers and messages are fictional. No real private messages, account details or third-party personal information are included. No external assets are used.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
