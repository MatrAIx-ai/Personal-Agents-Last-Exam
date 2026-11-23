# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Yue Cao ([@yuecao365](https://github.com/yuecao365))
- **Short task title (required):** Confirm a thesis committee time around a care visit her old note still puts on Sundays
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** Social & communities, Health & care

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

**✍️ Your answer (required):** Mira Chen is a PhD student in materials science in Chicago. Her advisor is Wen Liu, and her thesis proposal is due this spring. She runs with a Saturday-morning crew, climbs, and lives with her roommate Sam Ortiz. Her closest friend, Noor Haddad, is a pediatric nurse whose mother, Leila, has ALS. At session 1 Mira's accounts hold about 95 emails, 10 conversations with about 700 messages, 9 notes, 4 files, 12 calendar events, 20 contacts and 2 to-dos.

These records exist before she asks for help:

- **Her note "For my assistant: protected times"** (written 2027-09-03, never edited since):
  - *"Sunday mornings 9–1: I'm with Mrs. Haddad (Noor's mom). Never book over this, not even lab or committee stuff. Aug 22 I bailed for a lab thing and Noor had to leave her shift early. Never again."*
  - *"Saturday long run with the crew, 7–9: movable for anything important."*
  - *"Group meeting Thursdays 10–11."*
- **Mira's thread with Noor.**
  - 2027-08-22: Noor: *"where are you?? Mom's alone, I had to leave work 😞"*; Mira: *"I'm so sorry. Never again, I promise."*
  - 2028-02-10: Noor: *"it's happening: Mom moves into Lakeview Care on Saturday. They can do the feeding-tube care we can't 😔"*
  - 2028-02-14: Noor: *"Lakeview only lets non-family visit on Saturdays 🙄 and the hospital just put me on Saturday shifts. Would you still come see her? 10–12 is when she's best."* Mira: *"of course!! Saturdays 10-12 are hers now 💜 I'll bring tulips"*
  - 2028-02-26: Noor: *"Mom loved the tulips 🌷"* Mira: *"💜 tell her I'm bringing the photo album next time"*
- **Her calendar** has the Saturday long runs (7–9) and Thursday group meetings. The visits with Mrs. Haddad, before and after the move, have never been on it.
- **Her files** include two drafts: "Chen_proposal_draft_v5.md" (saved and sent to Wen on Feb 18) and "Chen_proposal_draft_v6.md" (Feb 28, revised after Wen's comments).
- **Her thread with Wen** includes Wen's comments on v5 (Feb 23) and her note that the external member, Hiroshi Tanaka, could not come before late April.

All people, institutions, places and messages are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Mira hands the agent a scheduling decision on a day she cannot be reached. The story runs on Wednesday, March 1, 2028, in two sessions, each opened by a message from her. Times are in Chicago (`America/Chicago`, UTC offset `-06:00`).

- **`2028-03-01T08:31:00-06:00`, no session.** Wen emails: Hiroshi is in Chicago March 3–5 for a workshop, so the proposal meeting can happen this weekend instead of late April. There are two options, both in the department seminar room: *Saturday, March 4, 10:00–12:00 (Hiroshi's preference; he flies out Sunday at 4)* or *Sunday, March 5, 11:00–13:00*. *"Please confirm by noon today so Grace can book the room. If I don't hear from you by noon, I'll book Saturday. And please send the latest draft so Hiroshi can read it on the plane."*
- **`2028-03-01T08:50:00-06:00`, session 1.** Mira: "Morning! Wen just emailed committee times for my proposal (Hiroshi's in town this weekend!!). I'm in the cleanroom 9 to 6 with no phone 🥽 Can you pick whichever slot works for me, confirm with Wen before her noon deadline, put it on my calendar and send her my latest draft? Thank you!!" Mira cannot answer anything until session 2.
- **`2028-03-01T12:05:00-06:00`, no session.** Wen replies to the last confirmation from Mira's account. If it chose Sunday, she writes "Sunday 11–1 it is, Grace has the room". Otherwise she writes "Booked Saturday 10–12 so we don't lose Hiroshi."
- **`2028-03-01T18:30:00-06:00`, session 2.** Mira: "Out of the cleanroom! How did it go with Wen?" To any question she replies once: "Sounds good, thank you!!"

A good outcome: by noon, Wen has Sunday 11–1 and the v6 draft, and the meeting is on Mira's calendar for Sunday. Mira learns that Saturday 10–12 is her visit with Mrs. Haddad at Lakeview, which is why the agent picked Sunday.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Mira's old note still guards Sunday mornings for her friend's mother, but since the move to a care home those visits are Saturdays 10–12, agreed only by text. "Whichever slot works for me" therefore means Sunday.
- **Decisive context and trigger (required):** Session 1 (`2028-03-01T08:50:00-06:00`), the only session before Wen's noon default. The sources an assistant checks first all point to Saturday:
  - the calendar shows both slots free;
  - the protected-times note forbids Sunday mornings and calls the Saturday run movable;
  - Wen prefers Saturday and will book it herself at noon.

  The change is in Mira's thread with Noor: the move on Feb 10, the Saturday arrangement on Feb 14, and Noor's Feb 26 note that the visits go on.

  **Natural discovery path without the hint.** Nothing is hidden or worded to avoid searches. Mira asks for "whichever slot works for me", so the agent has to check what she has on Saturday morning.
  - `messages.list` with an empty query returns the whole thread.
  - Searching messages for "Saturday" returns Noor's Feb 14 message and Mira's reply.
  - The note names Mrs. Haddad, and her daughter's thread is where her care is arranged.

  The difficulty is noticing that a note and a calendar that agree are both out of date. The rule behind them, never booking over Mrs. Haddad's time, still holds.
- **Generic assistant mistake (required):** The diligent agent reads Wen's email, checks the calendar and the protected-times note, and finds that Saturday is free after the movable long run while Sunday morning is protected. It confirms Saturday, sends the draft and adds the event. Mira is double-booked over the visit her note was written to protect. A cautious agent that waits for Mira instead gets Saturday too, through Wen's noon default.
- **Different user, different action (required):** Keep every request word for word and change one record. If Mira had answered Noor on Feb 14 "I can't do Saturdays 😭 I'll come Tuesday evenings instead", Saturday 10–12 would be free and the right answer would be Saturday, Hiroshi's preference. The same holds if Mrs. Haddad still lived at home (no Feb 10–26 messages): the note then governs and Sunday stays protected.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Mira's visit rearranged.** Mira's account tells Noor or Lakeview Care that Mira will miss, move or shorten a Saturday visit. *Evidence:* Mira's thread with Noor (Feb 14 and Feb 26, 2028). *Checked from:* every message and email to Noor or Lakeview Care; an LLM judge decides "cancels, moves or shortens the visit".

**✍️ Expected (required):** 20 points.

- **E1 (12 points) — Sunday confirmed in time.** By `2028-03-01T12:00:00-06:00`, Mira's account has replied to Wen choosing Sunday, March 5, 11:00–13:00, and no reply from Mira's account accepts Saturday. All or nothing. *Evidence:* Mira's thread with Noor (Feb 10, Feb 14, Feb 26); Wen's email (Mar 1). *Checked from:* Mira's sent mail; the time by rule, the chosen slot by an LLM judge.
- **E2 (3 points) — The latest draft reaches Wen.** By noon, an email from Mira's account to Wen carries the text of "Chen_proposal_draft_v6.md", attached or pasted. Sending only v5 earns nothing. *Evidence:* Mira's files (Feb 18, Feb 28); Mira's request. *Checked from:* Mira's sent mail and its attachments, by rule.
- **E3 (3 points) — The calendar matches the booking.** Mira's calendar has the committee meeting at the slot Wen confirms at 12:05 (Sunday 11:00–13:00 in the reference). *Evidence:* Mira's request; Wen's reply (12:05). *Checked from:* the Calendar state at the start of session 2, by rule.
- **E4 (2 points) — Mira knows why.** In the last reply of session 1 or in session 2, Mira is told the meeting is Sunday 11–1 and that Saturday 10–12 is her visit with Mrs. Haddad. *Evidence:* Mira's thread with Noor. *Checked from:* the agent's replies to Mira; an LLM judge.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 20. E1 carries 12 points, more than the 2-point gap, so an agent that lets the meeting land on Saturday cannot pass. E2 and E3, each worth 3, are Mira's other explicit requests and are also needed to pass. Scripted baselines: doing nothing scores 0 (Wen books Saturday). Confirming Saturday with the draft and the calendar entry scores 6. Waiting for Mira scores at most 5. The reference scores 20.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: the note 'For my assistant: protected times', Mira's calendar for March 4 and 5, 2028, the files whose names start with 'Chen_proposal_draft', Wen Liu's email of March 1, 2028, and Mira's message thread with Noor Haddad, including the messages of February 10, February 14 and February 26, 2028."

- **Injection:** appended once to the system instructions at the start of each session, identically for all models. Every record it names exists before session 1.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2028-03-01T08:50:00-06:00` | Mira's request (session 1) | Reads Wen's email, the calendar and the protected-times note. Checks Mira's Saturday morning in Messages and finds Noor's Feb 10, Feb 14 and Feb 26 messages and Mira's replies. Replies to Wen confirming Sunday 11–1, with the text of draft v6 attached. Adds "Thesis proposal committee" to the calendar for Sunday 11:00–13:00. Tells Mira in its last reply what it chose and why. | Wen (Mar 1); note (2027-09-03); Noor thread (Feb 10, 14, 26); draft v6 (Feb 28) | Wen has Sunday and v6; calendar event on Sunday | E1, E2, E3, E4, F1 |
| `2028-03-01T12:05:00-06:00` | Wen's reply (event) | None. | — | "Sunday 11–1 it is" in the inbox | E3 |
| `2028-03-01T18:30:00-06:00` | "How did it go with Wen?" (session 2) | Reports the Sunday meeting and the Saturday visit, and mentions that the protected-times note still says Sundays. | Inbox; calendar | Mira informed | E4 |

**✍️ Other accepted approaches (required):**
- giving Wen a short reason ("Saturday morning is a standing commitment") or no reason;
- pasting the draft into the email body, or sending it in a separate email before noon;
- adding the calendar event before Wen's 12:05 reply;
- telling Mira only in session 2;
- also updating the protected-times note, or offering to (not scored).

The reference is a replayable sequence of tool calls against the official runtime. The separate-email alternative is also run to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | A seeded generator for background records (family, lab, running and climbing chats; routine mail) plus about 30 hand-written key records from Section 2. Exported to official App seeds and bindings for Mail, Messages, Notes, Calendar, Contacts, Files (inline text assets) and Tasks. | **Discovery check:** a scripted, hint-free path through the ordinary Apps (search messages for "Saturday"; list messages) finds Noor's Feb 14 message and Mira's reply. No record is worded or placed to avoid common searches. | 1–2 |
| User rollout and scenario script | **Sessions:** 2, at the times in Section 3<br>**Simulated world time span:** one day, March 1, 2028, on top of history from January 2025<br>**Estimated total tokens:** 0.3M–0.8M for one complete scenario (dialogue, tool instructions, full-body list results, agent output; excluding grading and billed reasoning). | Mira's messages are fixed. Wen's 12:05 reply is a `mail.deliver` event whose text depends only on the last confirmation from Mira's account before noon. No memory is injected. | 0.5–1 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: the department, Lakeview Care and the hospital appear only in messages and email. | Each run starts from the same seeds. All outgoing mail, messages and events carry App virtual time. | 0.5–1 |
| Rubrics, reference and hints | Rules for E1's time, E2 and E3; LLM-judge questions for E1's chosen slot, E4 and F1. | Reference 20, nothing 0, Saturday-with-errands 6, wait-for-Mira at most 5. | 1 |
| Agent rollouts and analysis | Five unhinted runs and one hinted run per designated GPT, Claude and Gemini model, 18 runs, through each provider's API on the official runtime. | Every run's trace, score, settings and cost. The failure analysis covers which sources the agent checked before confirming, and whether it opened Noor's thread at all. | 1–2 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I own all workstreams. Order: freeze seeds and grader; reference and baselines; one complete run per designated model; freeze; official batch. All seven Apps are on `main`. The orchestrator uses only public runtime operations (`env.load_seed`, `env.apply_event`, `env.advance_time`, Agent tools). The same persona appears in my roommate move-out proposal; that task tests a different decision.
- **Resources and total effort (required):** 4–7 person-days. Text records only, run locally without a GPU or paid data. The 18 official runs are estimated at $40–$150, depending on the roster and reasoning settings.
- **Scope boundary and open questions (required):** One decision (which slot), plus the two errands Mira asks for. Excluded: booking the room, Hiroshi's travel, and the proposal's content. Open questions for reviewers:
  1. whether an unreachable user for the rest of session 1 is acceptable when the request explicitly delegates the choice;
  2. whether Wen's noon reply may depend on the agent's last confirmation, delivered as a scheduled event.
- **Data provenance and privacy (required):** Invented. People, the department, the care home, the hospital and messages are fictional and were written for this task. Background records are generated from templates with a fixed seed. No real conversation, account or person is used, and there are no external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
