# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Yue Cao ([@yuecao365](https://github.com/yuecao365))
- **Short task title (required):** Settle a roommate's move-out by what actually happened, not the plan
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

- **The apartment agreement** (note, written 2025-06-03, last edited 2026-09-30). Bills are split 50/50 for the days both live there; days when only one lives there are that person's. A line added on 2026-09-30, after Mira's summer internship in Berkeley, says a trip of 7 nights or more counts as not living there. Shared purchases go in the "House expenses" note and are split 50/50; personal items don't count, and anything already Venmo'd for is settled. Whoever keeps a shared item pays the other their share, less 25% for each full year since purchase; if nobody keeps it, nothing is owed. Whoever causes damage pays for it, even if Greywick splits the charge. Everything is settled within two weeks of moving out. The note lists the couch ($840, June 2025, Mira paid), a rug ($180, Tess paid) and a microwave ($120, August 2026, Tess paid).
- **The house note** since the last settle-up on March 31. Among ordinary entries are Mira's protein powder inside a Costco run, picture hooks marked "mine", a refunded shower liner, and dinner-party groceries Mira already Venmo'd Tess for on May 10.
- **Payments and bills.** Venmo emails show who sent half of what (couch, microwave, April ComEd on May 3, May wifi on May 6). Xfinity moved Tess's account to Mira on May 20 and cut Tess's May charge to $39.84 for May 1–19. Greywick booked Tess's move-out inspection for May 29.
- **Tess's thread with Mira.**
  - 2026-09-12: she puts up her TV mount on the living-room wall and will patch the holes when she moves out.
  - 2026-09-30: the Q3 settle-up, in which Tess took ComEd and wifi for Mira's weeks in Berkeley, per the agreement.
  - 2027-05-12: *"flying to Denver tomorrow morning for Corvane onboarding 🧳 I'm gone May 13 through the 26th, back the 27th to pack."*
  - 2027-05-23: she keeps the microwave, Mira keeps the couch, the rug goes to Goodwill, and *"when everything's in just send me ONE final number and whoever owes venmos. no ping-pong pls."*
- **The game-night group** "Greenview game night 🎲" (Mira, Tess and three friends; about 360 messages since September 2025). On 2026-10-17 Tess knocks Mira's desk lamp off a shelf during Codenames and insists on replacing it. Mira: *"65 at Target. just take it off whenever we do the final tally, no rush"*. Tess: *"deal 🤝"*.
- **A concert ticket** (Mail, 2027-04-08). TixLoop: "Tess Alvarez sent you a ticket" for the Lantern Choir on May 1, $89.00 paid by Tess, with her note *"got us both tix!! yours was $89, just throw it in next time we square up, no rush"*. No Venmo repays it.
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
- **June 2–4, no session.** Tess: *"update lol: my mom bought herself a new microwave so I dropped ours at the goodwill with the rug on my way out 🙃"*. ComEd's May bill ($96.20) and Mira's first Xfinity statement ($24.00 for May 20–31, plus June) arrive. Tess, June 4: "is everything in yet? would love to close this out before I start at Corvane on the 14th. just one final number pls."
- **`2027-06-05T11:00:00-05:00`, session 4.** Mira asks the agent to move her dentist cleaning and email her advisor.
- **June 9–10, no session.** Greywick's final statement puts the wall at $95 and the hinge at $40, split equally, with $67.50 posted to Mira's ledger, due with July rent. Tess then writes that she already paid her half of May ComEd ("the $41.10 on May 3"), which was in fact April's, and that the cabinet hinge was her doing: "put that one on me."
- **`2027-06-13T19:00:00-05:00`, session 5.** Mira: "Boarding for LA now, I'll be offline until Tuesday night (June 15) helping Grandma move. Quick one before I lose signal: can you look at my calendar and suggest a week in July to visit my parents? Thanks!!" She does not reply in this session, the last before the deadline.
- **`2027-06-15T21:00:00-05:00`, session 6.** Mira: "Back! Anything I need to know?"

In sessions 2–4 Mira answers the first question or offer with "Use your judgment!"; in session 6 her one reply is "Yes, go ahead." Tess answers each message an hour later: short true answers to factual questions (for example "yep, I was in Denver May 13-26, back the 27th"), "sounds good, no rush!" to a holding update, "got it, thanks!!" to the first number, and "wait which one is it now 😅" to a second, different one.

A good outcome: Tess's June 4 question gets a holding reply without a number. After the final statement and by June 14, Tess receives exactly one settlement message: Mira owes her $340.28. That number prorates May's utilities for Tess's two weeks in Denver, charges nothing for the microwave, counts the lamp and the ticket, and notes that the May 3 payment was April's ComEd. Mira learns what she owes and that $67.50 is on her Greywick ledger.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Tess's lease ended May 31, but she left for Denver on May 13 and later gave away the microwave she said she'd keep. Settling by Mira's agreement means applying its rules to what actually happened, not to the plan.
- **Decisive context and trigger (required):** Session 5 (`2027-06-13T19:00:00-05:00`), which is about a July trip. The settlement is due the next day, Mira cannot be asked, and her trip notes say to finish it. The number depends on three changes the agent has to connect to the agreement's rules:
  - Tess's May 12 message (away May 13–26) against the 7-night rule. This cuts her share of May ComEd and changes both Xfinity periods, including the days Mira lived there alone.
  - Tess's June 2 message (microwave given away) against the furniture rule, so nobody keeps it and nothing is owed.
  - Greywick's final statement (June 9) replacing the estimate, with the damage rule applied to Tess's TV mount and her hinge admission.

  Two older items are ordinary personal history, each in its own record, and Tess confirms either if asked: the lamp from game night and the April ticket.
- **Generic assistant mistake (required):** The diligent agent reads the agreement and every bill, gets the arithmetic right, and still settles the plan instead of what happened. Either it splits May 50/50 because Tess's lease ran to May 31 (a pilot run said so explicitly: "she lived there until May 31"), or it prorates ComEd but splits Mira's solo days on the Xfinity bill. It also tends to bill Tess $60 for the microwave from her May 23 message, or to stop at the shared ledger without counting the two older debts. The narrow agent answers only the trip question. The deferring agent asks Mira for an OK she cannot give before the deadline.
- **Different user, different action (required):** Keep Mira's request and Tess's messages word for word and change one record: the agreement has no 7-night line, so a trip still counts as living there. Then May is split evenly and the right number is $304.22. Or Tess's mother does not buy a microwave and Tess keeps it, and the right number is $280.28.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**Answer key.** Positive means Tess owes Mira. Tess was away May 13–26 (14 nights), so the two lived there together on 17 days of May.

| Line | Amount |
| :--- | ---: |
| House log, net | +44.60 |
| May ComEd: half of $96.20 for 17 of 31 days | +26.38 |
| Xfinity May 1–19 on Tess's account ($39.84): Mira owes half of 12 shared days plus all 7 days she lived there alone, $27.26, and prepaid $32.50 | +5.24 |
| Xfinity May 20–31 on Mira's account ($24.00): half of the 5 shared days, May 27–31 | +5.00 |
| Wall, Mira's $47.50 share of the final $95 | +47.50 |
| Hinge, Mira's $20 share | +20.00 |
| Microwave: given away, nobody keeps it | 0 |
| Desk lamp, agreed at game night on 2026-10-17 | +65.00 |
| Concert ticket Tess bought for Mira (2027-04-08) | −89.00 |
| Couch, $420 less 25% for one full year | −315.00 |
| Tess's $150 | −150.00 |
| Rug | 0 |
| **Net: Mira owes Tess** | **$340.28** |

**✍️ Forbidden (required):**

- **F1 — Number ping-pong.** Tess receives more than one message, by any channel, that states a settlement amount or asks her to pay one. *Evidence:* Tess's messages (May 23, June 4). *Checked from:* every email and message to Tess; an LLM judge decides "states or requests a settlement amount".

**✍️ Expected (required):** 20 points.

- **E1 (10 points) — The right number, on time.** The settlement message to Tess says Mira owes her $340.28 (±$0.50) and is sent after the final statement (`2027-06-09T10:05:00-05:00`) and by `2027-06-14T23:59:00-05:00`. All or nothing. *Evidence:* the records in Section 2 and the June 1–10 events. *Checked from:* the last settlement message to Tess before the deadline; amount and time by rule, direction by an LLM judge.
- **E2 (2 points) — Utilities follow where Tess actually was.** That message prorates May's ComEd for Tess's May 13–26 trip ($26.38, or an explicit day-based split). *Evidence:* the agreement's 7-night line (2026-09-30); Tess (2026-09-30, 2027-05-12); ComEd (June 2). *Checked from:* the same message; amount by rule, otherwise an LLM judge.
- **E3 (2 points) — The microwave follows what happened to it.** That message charges Tess nothing for the microwave. *Evidence:* the agreement's furniture rule; Tess (June 2). *Checked from:* the same message, by rule and an LLM judge.
- **E4 (2 points) — Older debts.** That message counts the $65 lamp in Mira's favour (1 point) and the $89 ticket in Tess's favour (1 point). *Evidence:* the game-night group (2026-10-17); TixLoop (2027-04-08). *Checked from:* the same message; amounts by rule, direction by an LLM judge.
- **E5 (2 points) — Mira knows the outcome.** In session 5 or 6, Mira is told she owes Tess $340.28 (1 point) and that $67.50 is on her Greywick ledger (1 point). *Evidence:* Mira's request (May 24); the final statement (June 9). *Checked from:* messages to Mira in sessions 5–6.
- **E6 (2 points) — Tess not left hanging.** Between Tess's June 4 message and the final statement, the agent replies to her without giving an amount. *Evidence:* Tess (June 4). *Checked from:* messages to Tess, by time.

The ComEd claim (Tess's June 10 message) and the Xfinity periods are not separate items; getting them wrong makes E1 wrong.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 20. E1 carries 10 points, more than the 2-point gap, so a wrong, late or missing number fails. On the pilot implementation, doing nothing scores 0, settling in session 1 with what is known 0, settling early on the preliminary estimate 6, and a late send with three rule errors 2. An agent that settles the plan (no proration, microwave billed) but counts both older debts scores 5. The reference scores 20.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Mira's to-dos, her file 'LA_trip_notes.txt', the notes 'Apartment agreement (Mira + Tess)' and 'House expenses', Mira's message thread with Tess Alvarez (including her messages of September 30, 2026 and May 12 and June 2, 2027), the 'Greenview game night' group chat from October 2026, the April 2027 email from TixLoop, and the most recent emails from Venmo, ComEd, Xfinity and Greywick Residential."

- **Injection:** appended once to the system instructions at the start of every session, identically for all models. Every record it names exists before session 1, except Tess's June 2 message. The hint is therefore injected from session 4, the first session after that message arrives.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-05-24T20:00:00-05:00` | Mira's request (session 1) | Messages Priya. Reads the agreement and the house note, then everything involving Tess: her thread, the other conversations she is in and mail that mentions her. Notes her May 13–26 trip against the 7-night line, the lamp and the ticket. Sends Tess nothing; leaves a working note and a dated to-do for the pending bills and the final statement, and tells Mira what is outstanding. | Agreement; house note; Tess (2026-09-30, 2027-05-12, 2027-05-23); game night (2026-10-17); TixLoop (2027-04-08); Venmo; Xfinity | Working note; nothing sent to Tess | F1 |
| `2027-05-28T21:00:00-05:00` | Kevin request (session 2) | Does the errands; records Tess's $150 and her May 26 entry. | Venmo (May 28); house note | Note updated | F1 |
| `2027-06-01T20:00:00-05:00` | Sam request (session 3) | Does the errand; notes the preliminary results and that the wall holes are Tess's TV mount; waits for the final statement. | Greywick (June 1); Tess (2026-09-12) | Note updated | F1 |
| `2027-06-05T11:00:00-05:00` | Dentist and advisor request (session 4) | Does the errands. Records that the microwave went to Goodwill. Tells Tess the bills are in and only Greywick's final statement, due by June 11, is outstanding; she will get one number then. | Tess (June 2, June 4); ComEd (June 2); Xfinity (June 4) | Holding reply sent | E6, F1 |
| `2027-06-13T19:00:00-05:00` | Trip request (session 5) | Suggests a July week. Checks its to-do and note and reads the trip notes: the job is due tomorrow and Mira cannot be asked. Reads the final statement and Tess's June 10 claims. Prorates May ComEd and both Xfinity periods by the days each lived there, drops the microwave, and counts the lamp and the ticket. Sends Tess one message, "I owe you $340.28", with the lines and the April/May ComEd explanation. Tells Mira the amount, that the Venmo is hers to send, and the $67.50 ledger charge. | Greywick (June 9); Tess (June 10); Venmo (May 3); agreement; working note; trip notes | One settlement message; Mira informed | E1, E2, E3, E4, E5, F1 |
| `2027-06-15T21:00:00-05:00` | "Back! Anything I need to know?" (session 6) | Repeats the outcome: $340.28 to Venmo to Tess, $67.50 due with July rent. | Its working note | Mira informed | E5 |

**✍️ Other accepted approaches (required):**
- sending the settlement or the holding reply by email instead of a message;
- asking Tess factual questions first, such as her exact travel dates or whose holes those were, as long as no question states an amount;
- showing the lines as a table or a one-line formula;
- rounding each prorated line to the cent in a different order, as long as the net stays within $0.50;
- telling Mira the outcome in session 6 instead of session 5.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | A seeded generator for about 155 emails, 8 conversations with about 700 messages (about 360 in the game-night group), 19 notes, 7 files, a calendar and contacts, plus about 40 hand-written key records: agreement, house note, bills, Greywick, Venmo, Tess's thread (2026-09-12, 2026-09-30, 2027-05-12, 2027-05-23, 2027-06-02, 2027-06-10), the game-night exchange, the TixLoop email, trip notes and to-do. A first version exists in the pilot. | An independent script recomputes the answer key from the records and gets $340.28. Every rubric fact appears in the record named in Section 5. **Discovery check:** a scripted, hint-free path through the ordinary Apps finds every decisive record. It reads the agreement and house note, reads Mira's thread with Tess in full, opens each conversation Tess belongs to and pages back through it, and searches mail for "Tess" and opens each result. No record is worded or placed to avoid common searches; the older records simply sit where they were written. | 2–3 |
| User rollout and scenario script | **Sessions:** 6, at the times in Section 3<br>**Simulated world time span:** May 24 to June 15, 2027, on top of history from June 2025<br>**Estimated total tokens:** 300k–600k for one complete scenario (dialogue, tool instructions, paginated mail and chat results, agent output; excluding grading and billed reasoning). Timestamps carry UTC offsets. | Mira and Tess follow the fixed replies in Section 3; events arrive at their scheduled times; app state carries over and no memory is injected. | 2 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: Greywick, ComEd, Xfinity, Venmo and TixLoop appear only as emails. Tess's May 26 note entry is a timed event on Notes (fallback: her message with the same entry). | Each run starts from the same records; all outgoing mail and messages are logged with virtual timestamps. | 1–2 |
| Rubrics, reference and hints | Rules for amounts and times (E1, E2, E4, E5, E6); LLM-judge questions for F1, the direction in E1 and E4, E2 when no amount is stated, and E3. Run the reference, the email alternative and the scripted baselines in Section 5. | The reference scores 20 with no forbidden item, doing nothing scores 0, and each baseline lands where Section 5 says. Judge questions are checked against labelled pilot messages. | 2 |
| Agent rollouts and analysis | **Pilot:** decisive-session runs on a local harness (below).<br>**Official:** one complete pilot run per designated GPT, Claude and Gemini model before the freeze, not counted; then five unhinted runs and one hinted run per model, 18 runs. | Every run's trace, score, settings and cost, with a failure analysis recording, for session 5: which rule each line used, whether the agent read Tess's May 12 and June 2 messages, and whether it sent without Mira's OK. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

**Pilot evidence so far.** Local harness, decisive session only: the world is replayed through an earlier complete run's sessions 1–4, then a fresh agent runs session 5. Claude models ran through mock tools; GPT ran through the API with the same tools. Scores are out of 20; "→" is the hinted run.

| Model | Score | What it did |
| :--- | :--- | :--- |
| Claude Fable 5.2 | 8 → 20 | Unhinted: prorated, dropped the microwave and counted the ticket, but missed the lamp ($405.28). Hinted: $340.28. |
| Claude Opus 5.5 | 5 → 18 | Unhinted: prorated ComEd but split Mira's solo Xfinity days, and found neither older debt ($301.60). Hinted: $340.28; E6 was lost in the replayed session 4. |
| GPT-6.2-Astra xhigh | 6 | Prorated and dropped the microwave, citing the Berkeley precedent; found neither older debt ($316.28). |

In a first draft of this version the agreement had no 7-night line. There, hinted Fable declined to prorate ("she lived there until May 31"). That ambiguity is why the line, and Tess's matching 2026 precedent, are now explicit. Gemini has not been run. Difficulty will be re-measured with complete runs on the official harness.

- **Milestones, owners and dependencies (required):** I own all workstreams. Order: generator, key records, answer-key script and discovery check; then grader, baselines and reference; one complete pilot run per designated model; freeze; official batch. I estimate 2–3 weeks after approval. All seven Apps are on `main`. Still needed from #135: the session runner (row 1), the user harness (row 5) and a scripted counterpart for Tess (row 6); no wake-ups or agent-first channel.
- **Resources and total effort (required):** 10–13 person-days. Text records only; runs locally without a GPU or paid data. A decisive session cost about $0.45 for GPT-6.2-Astra at xhigh in the pilot; the 21 complete runs (3 pilot, 18 official) are estimated at 6M–13M tokens plus reasoning, about $100–$400 depending on the roster.
- **Scope boundary and open questions (required):** One household and one settlement. Excluded: sending the Venmo itself (Mira does that), Tess's deposit refund, Sam's share of June bills and disputing Greywick's charges. As in #127, each session starts with only the system instructions and the apps, and the system instructions say Mira keeps her to-dos in Tasks. Open questions for reviewers:
  1. whether "no memory injected" is the intended runner default;
  2. how Tess's scripted replies are delivered (row 6);
  3. whether an LLM judge is acceptable for F1 and E3.
- **Data provenance and privacy (required):** Invented. People, the property manager, utilities, employer, addresses and messages are fictional and were written for this task; background records are generated from templates with a fixed seed. No real conversation, account or person is used, and there are no external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
