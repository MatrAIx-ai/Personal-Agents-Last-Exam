# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Yue Cao ([@yuecao365](https://github.com/yuecao365))
- **Short task title (required):** Settle a roommate's move-out on time, counting a debt agreed months ago at game night
- **Primary domain (required):** Home & utilities
- **Secondary domains (optional):** Money & insurance, Social & communities

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

**✍️ Your answer (required):** Mira Chen is a PhD student in materials science in Chicago. Since June 2025 she has shared 4418 N. Greenview Ave, Unit 2 with her friend Tess Alvarez. Tess moves out on May 31, 2027 for a job in Denver that starts June 14; Sam Ortiz takes her room from June 1. Mira's accounts hold about 155 emails from March to June 2027 (19 of them Venmo notifications, about half unrelated to Tess), 8 conversations with about 700 messages, 19 notes, 7 files and a calendar.

These records exist before she asks for help:

- **The apartment agreement** (note, 2025-06-03), written by both of them. Utilities are split 50/50 while both live there and prorated by day otherwise. Shared purchases go in the "House expenses" note and are split 50/50; personal items don't count, and anything already Venmo'd for is settled. Whoever keeps a shared item pays the other their share, less 25% for each full year since purchase. Whoever causes damage pays for it, even if Greywick splits the charge. Everything is settled within two weeks of moving out. The note lists the couch ($840, June 2025, Mira paid), a rug ($180, Tess paid) and a microwave ($120, August 2026, Tess paid).
- **The house note** since the last settle-up on March 31. Among ordinary entries are Mira's protein powder inside a Costco run, picture hooks marked "mine", a refunded shower liner, and dinner-party groceries Mira already Venmo'd Tess for on May 10.
- **Payments and bills.** Venmo emails show who sent half of what (couch, microwave, April ComEd on May 3, May wifi on May 6). Xfinity moved Tess's account to Mira on May 20. Greywick booked Tess's move-out inspection for May 29.
- **Tess's thread.** On 2026-09-12 she put up her TV mount on the living-room wall and said she would patch the holes when she moved out. On 2027-05-23 she keeps the microwave, Mira keeps the couch, the rug goes to Goodwill, and *"when everything's in just send me ONE final number and whoever owes venmos. no ping-pong pls."*
- **The game-night group** "Greenview game night 🎲" (Mira, Tess and three friends; about 360 messages since September 2025, almost all logistics). On 2026-10-17 at 23:48 Tess knocks Mira's desk lamp off a shelf during Codenames and insists on replacing it. Mira: *"65 at Target. just take it off whenever we do the final tally, no rush"*. Tess: *"deal 🤝"*. About 240 messages follow in that thread, and no later record mentions the lamp.
- **Mira's to-do** (May 24): "Money with Tess: my assistant is settling it per our apartment agreement (one final number to Tess)", due June 14.
- **Her trip notes** ("LA_trip_notes.txt", May 21), for helping her grandmother move on June 13–15, with one line for the assistant: *"anything you're already handling for me that comes due, just finish it on time. Don't wait for my OK; tell me after. Don't book or buy anything new for me."*

All names, companies and addresses are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Mira hands the move-out money to the agent once and then gets busy. The story runs from May 24 to June 15, 2027, in six sessions, each opened by a message from her. Times are in Chicago (`America/Chicago`, UTC offset `-05:00`).

- **`2027-05-24T20:00:00-05:00`, session 1.** Mira: "Tess moves out next Monday and drives to Denver on the 1st. Can you take care of settling up the money between me and Tess? Do it by our apartment agreement, it's in my notes. I'm TAing all week and Kevin's here for the weekend, so I won't have time to look at receipts. Just let me know when it's settled and what I owe or get. Also tell Priya I can't make climbing on Thursday." Asked anything, she replies once: "Just follow our agreement, it's all in my notes. I really don't have time for receipts this week."
- **May 26–28, no session.** Tess adds $23.80 of cleaning supplies to the house note, then Venmos Mira $150 "toward whatever I owe, rest when the final number's in". In fact Mira owes Tess, because of the couch.
- **`2027-05-28T21:00:00-05:00`, session 2.** Mira asks the agent to text Kevin where to meet her at the airport and to put a Saturday dinner on her calendar.
- **`2027-06-01T15:10:00-05:00`, no session.** Greywick's preliminary inspection results split the shared-area charges equally, as its handbook requires: a $40 cabinet hinge, a $120 estimate to patch the living-room wall's "anchor holes", and $75 of carpet cleaning in Tess's room. The final statement comes by June 11.
- **`2027-06-01T20:00:00-05:00`, session 3.** Mira asks for a welcome text to Sam.
- **June 2–4, no session.** ComEd's May bill ($96.20) and Mira's first Xfinity statement ($24.00 for May 20–31, plus June) arrive. Tess, June 4: "is everything in yet? would love to close this out before I start at Corvane on the 14th. just one final number pls."
- **`2027-06-05T11:00:00-05:00`, session 4.** Mira asks the agent to move her dentist cleaning and email her advisor.
- **June 9–10, no session.** Greywick's final statement puts the wall at $95 and the hinge at $40, split equally, with $67.50 posted to Mira's ledger, due with July rent. Tess then writes that she already paid her half of May ComEd ("the $41.10 on May 3"), which was in fact April's, and that the cabinet hinge was her doing: "put that one on me."
- **`2027-06-13T19:00:00-05:00`, session 5.** Mira: "Boarding for LA now, I'll be offline until Tuesday night (June 15) helping Grandma move. Quick one before I lose signal: can you look at my calendar and suggest a week in July to visit my parents? Thanks!!" She does not reply in this session, the last before the deadline.
- **`2027-06-15T21:00:00-05:00`, session 6.** Mira: "Back! Anything I need to know?"

In sessions 2–4 Mira answers the first question or offer with "Use your judgment!"; in session 6 her one reply is "Yes, go ahead." Tess answers each message an hour later: short true answers to factual questions (asked about the lamp: "omg the lamp 🙈 yes, take it off, I totally forgot!"), "sounds good, no rush!" to a holding update, "got it, thanks!!" to the first number, and "wait which one is it now 😅" to a second, different one.

A good outcome: Tess's June 4 question gets a holding reply without a number. After the final statement and by June 14, Tess receives exactly one settlement message: Mira owes her $155.22, with the line items, the lamp among them, and a note that the May 3 payment was April's ComEd. Mira learns what she owes and that $67.50 is on her Greywick ledger.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Weeks after handing off the move-out money, the agent must send Tess one final number on time while Mira is offline, counting a lamp debt the two agreed on at game night eight months earlier.
- **Decisive context and trigger (required):** Session 5 (`2027-06-13T19:00:00-05:00`), which is about a July trip. The settlement is due the next day, Mira cannot be asked, and her trip notes say to finish it. The number has to combine Greywick's final statement (June 9), the damage rule applied to Tess's TV mount (2026-09-12) and her hinge admission (June 10), Venmo's May 3 memo "comed april", and the game-night exchange of 2026-10-17, the only record of the lamp.
- **Generic assistant mistake (required):** Three, from three kinds of agent. A narrow one answers the trip question and never settles. A deferring one computes the number and asks Mira whether to send it, so the deadline passes. A diligent one checks its to-do, the agreement, the house note, the bills and Tess's thread, gets every line right including both of Tess's June 10 claims, and sends $220.22: it has no reason to page back through a group chat about board games. In our pilot every unhinted run that settled made the third mistake (see Section 6).
- **Different user, different action (required):** Keep Mira's request word for word and change one record: in October Mira tells Tess "forget it, it was old", and Tess thanks her. Then nothing is owed for the lamp and the right number is $220.22. If instead Tess had never said the hinge was hers, the $40 would stay split and the number would be $175.22.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**Answer key.** Positive means Tess owes Mira.

| Line | Amount |
| :--- | ---: |
| House log, net | +44.60 |
| May ComEd, half of $96.20 | +48.10 |
| Internet: Mira prepaid $32.50 for May against half of Tess's $39.84 final bill (+12.58), plus half of $24.00 on Mira's account (+12.00) | +24.58 |
| Wall, Mira's $47.50 share of the final $95 | +47.50 |
| Hinge, Mira's $20 share | +20.00 |
| Microwave | +60.00 |
| Desk lamp, agreed at game night on 2026-10-17 | +65.00 |
| Couch, $420 less 25% for one full year | −315.00 |
| Tess's $150 | −150.00 |
| Rug | 0 |
| **Net: Mira owes Tess** | **$155.22** |

**✍️ Forbidden (required):**

- **F1 — Number ping-pong.** Tess receives more than one message, by any channel, that states a settlement amount or asks her to pay one. *Evidence:* Tess's messages (May 23, June 4). *Checked from:* every email and message to Tess; an LLM judge decides "states or requests a settlement amount".

**✍️ Expected (required):** 20 points.

- **E1 (12 points) — The right number, on time.** The settlement message to Tess says Mira owes her $155.22 (±$1.00) and is sent after the final statement (`2027-06-09T10:05:00-05:00`) and by `2027-06-14T23:59:00-05:00`. All or nothing. *Evidence:* the records in Section 2 and the June 1–10 events. *Checked from:* the last settlement message to Tess before the deadline; amount and time by rule, direction by an LLM judge.
- **E2 (2 points) — The line items.** 2/9 of a point for each non-zero line of the answer key stated in that message. The internet line counts as $24.58 or as its two parts; wall and hinge may appear together as $67.50. *Evidence:* as for E1. *Checked from:* the same message, by amount.
- **E3 (2 points) — Tess's claim corrected.** The message says the $41.10 from May 3 was her half of April's ComEd. *Evidence:* Venmo (May 3, memo "comed april"); ComEd's April bill (May 2); Tess (June 10). *Checked from:* the settlement message, by an LLM judge.
- **E4 (2 points) — Mira knows the outcome.** In session 5 or 6, Mira is told she owes Tess $155.22 (1 point) and that $67.50 is on her Greywick ledger (1 point). *Evidence:* Mira's request (May 24); the final statement (June 9). *Checked from:* messages to Mira in sessions 5–6.
- **E5 (2 points) — Tess not left hanging.** Between Tess's June 4 message and the final statement, the agent replies to her without giving an amount. *Evidence:* Tess (June 4). *Checked from:* messages to Tess, by time.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 20. E1 carries 12 points, more than the 2-point gap, so a wrong, late or missing number fails. On the pilot implementation, doing nothing scores 0, settling in session 1 with what is known 0.44, settling on the preliminary estimate 3.78, a late send with three rule errors 2.89, and everything right except the lamp ($220.22) 6.78 (34%). The reference scores 20.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Mira's to-dos, her file 'LA_trip_notes.txt', the notes 'Apartment agreement (Mira + Tess)' and 'House expenses', Mira's message thread with Tess Alvarez, the 'Greenview game night' group chat from October 2026, and the most recent emails from Venmo, ComEd, Xfinity and Greywick Residential."

- **Injection:** appended once to the system instructions at the start of every session, identically for all models. Every record it names exists before session 1.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-05-24T20:00:00-05:00` | Mira's request (session 1) | Messages Priya. Reads the agreement, the house note, every conversation Tess is in (the game-night group back to 2025 among them) and the Venmo and Xfinity mail. Tallies the known lines, the $65 lamp included. Sends Tess nothing; leaves a working note and a dated to-do for the pending bills and the final statement, and tells Mira what is outstanding. | Agreement; house note; Tess (May 23); game night (2026-10-17); Venmo; Xfinity | Working note; nothing sent to Tess | F1 |
| `2027-05-28T21:00:00-05:00` | Kevin request (session 2) | Does the errands; records Tess's $150 and her May 26 entry. | Venmo (May 28); house note | Note updated | F1 |
| `2027-06-01T20:00:00-05:00` | Sam request (session 3) | Does the errand; notes the preliminary results and that the wall holes are Tess's TV mount; waits for the final statement. | Greywick (June 1); Tess (2026-09-12) | Note updated | F1 |
| `2027-06-05T11:00:00-05:00` | Dentist and advisor request (session 4) | Does the errands. Tells Tess the bills are in and only Greywick's final statement, due by June 11, is outstanding; she will get one number then. | ComEd (June 2); Xfinity (June 4); Tess (June 4) | Holding reply sent | E5, F1 |
| `2027-06-13T19:00:00-05:00` | Trip request (session 5) | Suggests a July week. Checks its to-do and note and reads the trip notes: the job is due tomorrow and Mira cannot be asked. Reads the final statement and Tess's June 10 claims. Sends Tess one message, "I owe you $155.22", with the nine lines and the April/May ComEd explanation. Tells Mira the amount, that the Venmo is hers to send, and the $67.50 ledger charge. | Greywick (June 9); Tess (June 10); Venmo (May 3); agreement; game night (2026-10-17); trip notes | One settlement message; Mira informed | E1, E2, E3, E4, F1 |
| `2027-06-15T21:00:00-05:00` | "Back! Anything I need to know?" (session 6) | Repeats the outcome: $155.22 to Venmo to Tess, $67.50 due with July rent. | Its working note | Mira informed | E4 |

**✍️ Other accepted approaches (required):** sending the settlement or the holding reply by email instead of a message; asking Tess factual questions first, such as whose holes those were or whether she still means to take the lamp off, as long as no question states an amount; showing the lines as a table or a one-line formula; and telling Mira the outcome in session 6 instead of session 5.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | A seeded generator for about 155 emails, 8 conversations with about 700 messages (about 360 in the game-night group), 19 notes, 7 files, a calendar and contacts, plus about 35 hand-written key records (agreement, house note, bills, Greywick, Venmo, Tess's thread, the game-night exchange, trip notes, to-do). A first version exists in the pilot. | An independent script recomputes the answer key from the records and gets $155.22. Every rubric fact appears in the record named in Section 5. A seed check confirms the lamp appears only in the October 17 exchange, at least 200 messages before the end of its thread, and not among the 20 most recent results for searches such as owe, pay, $, venmo, settle, split, final or move-out. | 2–3 |
| User rollout and scenario script | **Sessions:** 6, at the times in Section 3<br>**Simulated world time span:** May 24 to June 15, 2027, on top of history from June 2025<br>**Estimated total tokens:** 300k–600k for one complete scenario (dialogue, tool instructions, paginated mail and chat results, agent output; excluding grading and billed reasoning). Timestamps carry UTC offsets. | Mira and Tess follow the fixed replies in Section 3; events arrive at their scheduled times; app state carries over and no memory is injected. | 2 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: Greywick, ComEd, Xfinity and Venmo appear only as emails. Tess's May 26 note entry is a timed event on Notes (fallback: her message with the same entry). | Each run starts from the same records; all outgoing mail and messages are logged with virtual timestamps. | 1–2 |
| Rubrics, reference and hints | Rules for amounts and times (E1, E2, E4, E5); LLM-judge questions for F1, E1's direction and E3. Run the reference, the email alternative and the scripted baselines in Section 5. | The reference scores 20 with no forbidden item, doing nothing scores 0, and each baseline lands where Section 5 says. Judge questions are checked against labelled pilot messages. | 2 |
| Agent rollouts and analysis | **Pilot:** decisive-session runs on a local harness (below).<br>**Official:** one complete pilot run per designated GPT, Claude and Gemini model before the freeze, not counted; then five unhinted runs and one hinted run per model, 18 runs. | Every run's trace, score, settings and cost, with a failure analysis recording which records the agent read in session 5, whether it opened the game-night group before October 2026, and whether it sent without Mira's OK. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

**Pilot evidence so far.** Local harness, decisive session only: the world is replayed through an earlier complete run's sessions 1–4, then a fresh agent runs session 5. Claude models ran through mock tools; GPT ran through the API with the same tools. Scores are out of 20; "→" is the hinted run.

| Model | Score | What it did |
| :--- | :--- | :--- |
| Claude Fable 5.2 | 6.78, 6.78 → 20 | Sent $220.22 on time with every other line right; never opened the group before October 2026. Hinted, sent $155.22. |
| Claude Opus 5.5 | 4.78 → 18 | Read the trip notes and sent $220.22. Hinted, earned every session-5 point; E5 was lost in the replayed session 4. |
| GPT-6.2-Astra xhigh | 5.78 | Read only the group's latest page and sent $220.22. Hinted run not done. |
| GPT-6.2-Astra default effort | 2 | One calendar call; answered only the July question. |

In an earlier version without the lamp debt (answer $220.22), Fable passed 4 of 4 runs and Opus failed 4 of 4 by asking for an OK it could not get. The lamp is what makes the diligent agent fail, and the hint resolves it. Gemini has not been run. Difficulty will be re-measured with complete runs on the official harness.

- **Milestones, owners and dependencies (required):** I own all workstreams. Order: generator, key records, answer-key script and seed checks; then grader, baselines and reference; one complete pilot run per designated model; freeze; official batch. I estimate 2–3 weeks after approval. All seven Apps are on `main`. Still needed from #135: the session runner (row 1), the user harness (row 5) and a scripted counterpart for Tess (row 6); no wake-ups or agent-first channel.
- **Resources and total effort (required):** 10–13 person-days. Text records only; runs locally without a GPU or paid data. A decisive session cost $0.32 for GPT-6.2-Astra at xhigh in the pilot; the 21 complete runs (3 pilot, 18 official) are estimated at 6M–13M tokens plus reasoning, about $100–$400 depending on the roster.
- **Scope boundary and open questions (required):** One household and one settlement. Excluded: sending the Venmo itself (Mira does that), Tess's deposit refund, Sam's share of June bills and disputing Greywick's charges. As in #127, each session starts with only the system instructions and the apps, and the system instructions say Mira keeps her to-dos in Tasks. Open questions for reviewers: (1) whether "no memory injected" is the intended runner default; (2) how Tess's scripted replies are delivered (row 6); (3) whether an LLM judge is acceptable for F1; (4) whether a fact that lives only in older group-chat history, eight months back in a thread about something else, is fair personal history for the agent to reconcile. [#141](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/141) relies on the same principle.
- **Data provenance and privacy (required):** Invented. People, the property manager, utilities, employer, addresses and messages are fictional and were written for this task; background records are generated from templates with a fixed seed. No real conversation, account or person is used, and there are no external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
