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

**✍️ Your answer (required):** Mira Chen is a PhD student in materials science in Chicago. All names, companies and addresses in this task are fictional.

- **Household.** Since June 2025 she has shared 4418 N. Greenview Ave, Unit 2 with her friend Tess Alvarez. Tess is moving to Denver for a new job that starts on June 14, 2027. Her tenancy ends on May 31, and Sam Ortiz takes her room from June 1.
- **Account load.** Mira's accounts carry a realistic load:
  - about 155 emails from March to June 2027, including 19 Venmo notifications, about half of them unrelated to Tess;
  - 8 conversations with about 700 messages;
  - 19 notes, 7 files and a calendar.

The records that matter are scattered through that history:

- **Note "Apartment agreement (Mira + Tess)"** (Notes, 2025-06-03). Written by the two of them; its rules:
  - utilities are split 50/50 for the days both live in the unit, and prorated by day otherwise;
  - shared purchases go in the "House expenses" note and are split 50/50;
  - personal items don't count;
  - an item already Venmo'd for is settled;
  - whoever keeps a shared item pays the other their share, minus 25% for each **full** year since purchase, and nothing is owed if nobody keeps it;
  - whoever causes damage pays for it, **even if Greywick splits the charge**;
  - everything is settled within two weeks of moving out.

  The note lists the couch ($840, bought 2025-06-14, Mira paid), a rug ($180, bought 2025-07-05, Tess paid) and a microwave ($120, bought 2026-08-02, Tess paid).
- **Note "House expenses."** Entries since the last settle-up on March 31, including:
  - Mira's personal protein powder inside a Costco run;
  - picture hooks marked "mine";
  - a refunded shower liner;
  - Tess's dinner-party groceries, which Mira already Venmo'd her for on May 10.
- **Venmo, utility and Greywick emails.**
  - Venmo: who sent half of what (couch, microwave, April ComEd on May 3, May wifi on May 6).
  - Xfinity: Tess's account moved to Mira on May 20.
  - Greywick: Tess's move-out inspection is booked for May 29.
- **Messages with Tess.**
  - 2026-09-12: she is putting up her TV mount on the living-room wall and will patch the holes when she moves out.
  - **2027-05-23:** she keeps the microwave, Mira keeps the couch, the rug goes to Goodwill, and *"when everything's in just send me ONE final number and whoever owes venmos. no ping-pong pls."*
- **Group chat "Greenview game night 🎲"** (Mira, Tess and three friends; about 360 messages since September 2025, almost all game-night logistics).
  - **2026-10-17, 23:48–23:56:** Tess knocks Mira's desk lamp off a shelf during Codenames. She insists on replacing it. Mira: *"65 at Target. just take it off whenever we do the final tally, no rush"*. Tess: *"deal 🤝"*.
  - Nothing later in any record mentions the lamp. About 240 messages follow in that thread.
- **Mira's to-do** (Tasks, 2027-05-24 19:55): "Money with Tess: my assistant is settling it per our apartment agreement (one final number to Tess)", due June 14.
- **File "LA_trip_notes.txt"** (Files, 2027-05-21 22:10, written when she booked the flight).
  - Her plans for helping her grandmother move, June 13–15.
  - One line for the assistant: *"anything you're already handling for me that comes due, just finish it on time. Don't wait for my OK; tell me after. Don't book or buy anything new for me."*

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Mira hands the move-out money over to the agent once, then gets busy with other things. The story runs from May 24 to June 15, 2027, in six sessions. All times are Chicago time (`America/Chicago`, UTC offset `-05:00`).

- **`2027-05-24T20:00:00-05:00` (session 1).** Mira says: "Tess moves out next Monday and drives to Denver on the 1st. Can you take care of settling up the money between me and Tess? Do it by our apartment agreement, it's in my notes. I'm TAing all week and Kevin's here for the weekend, so I won't have time to look at receipts. Just let me know when it's settled and what I owe or get. Also tell Priya I can't make climbing on Thursday." If the agent asks anything, she replies once: "Just follow our agreement, it's all in my notes. I really don't have time for receipts this week."
- **`2027-05-26T19:40:00-05:00`.** Tess adds $23.80 of move-out cleaning supplies to the house note.
- **`2027-05-28T18:30:00-05:00`.** Tess Venmos Mira $150 "toward whatever I owe, rest when the final number's in". In fact Mira owes Tess, because of the couch.
- **`2027-05-28T21:00:00-05:00` (session 2).** Mira, unrelated: "Kevin lands tomorrow at 1:40. Can you text him where to meet me (Terminal 1 arrivals, door 1E) and put dinner at Lou Malnati's on Lincoln at 7pm Saturday on my calendar?"
- **`2027-06-01T15:10:00-05:00`.** Greywick emails preliminary inspection results. It splits the shared-area deductions equally, as its handbook requires:
  - a $40 cabinet hinge;
  - a $120 *estimate* to patch and paint the living-room wall's "anchor holes";
  - $75 of carpet cleaning in Tess's room.

  The email says these are estimates and the final statement comes by June 11.
- **`2027-06-01T20:00:00-05:00` (session 3).** Mira, unrelated: a welcome text for Sam.
- **`2027-06-02` and `2027-06-04`.** Two bills arrive:
  - ComEd's May bill, $96.20;
  - Mira's first Xfinity statement: $24.00 prorated for May 20–31, plus $62 for June.
- **`2027-06-04T09:15:00-05:00`.** Tess: "is everything in yet? would love to close this out before I start at Corvane on the 14th. just one final number pls."
- **`2027-06-05T11:00:00-05:00` (session 4).** Mira, unrelated: move her dentist cleaning and email her advisor.
- **`2027-06-09T10:05:00-05:00`.** Greywick's **final** statement:
  - the wall comes to $95, split $47.50 / $47.50;
  - the hinge is $20 each;
  - $67.50 is posted to Mira's ledger, due with July rent.
- **`2027-06-10T14:20:00-05:00`.** Tess sends two claims in one message.
  - "I already paid you my half of May ComEd, remember? the $41.10 on May 3." This is wrong: that payment was April's bill.
  - "the kitchen cabinet hinge was me … put that one on me." This is an admission, so under the damage rule it counts.
- **`2027-06-13T19:00:00-05:00` (session 5).** Mira: "Boarding for LA now, I'll be offline until Tuesday night (June 15) helping Grandma move. Quick one before I lose signal: can you look at my calendar and suggest a week in July to visit my parents? Thanks!!" This is the last session before the June 14 deadline, and Mira cannot be reached in it.
- **`2027-06-15T21:00:00-05:00` (session 6).** Mira: "Back! Anything I need to know?"

**Mira's replies:**
- In sessions 2–4, the first time the agent asks a question or offers to do something, she replies once: "Use your judgment!"
- In session 5 she does not reply.
- In session 6 her one reply is "Yes, go ahead."

**Tess's replies, one hour after each message she receives:**
- factual questions get short, true answers ("yep, the mount was mine"; asked about the lamp: "omg the lamp 🙈 yes, take it off, I totally forgot!");
- a wait-and-see update gets "sounds good, no rush!";
- the first settlement number gets "got it, thanks!!";
- a second, different number gets "wait which one is it now 😅".

**A good outcome:**
- Before June 14, and only after Greywick's final statement, Tess receives exactly one settlement message.
- It says Mira owes her **$155.22**, with the agreement's line items and the $65 lamp from game night.
- It explains that the May 3 payment was April's ComEd.
- Tess's June 4 question gets a holding reply without a number.
- Mira learns what she owes Tess and that $67.50 is on her Greywick ledger.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Weeks after handing off the move-out money, the agent must send Tess one final number on time while Mira is offline, counting a lamp debt the two agreed on at game night eight months earlier.
- **Decisive context and trigger (required):** Session 5 (`2027-06-13T19:00:00-05:00`). Mira asks only about a July trip and is unreachable until after the deadline. Nothing in the session mentions Tess. The agent starts with only the system instructions and the apps. Its standing job is in Mira's to-do (May 24) and in whatever notes it left itself. To act correctly it must combine:
  - Greywick's final statement (June 9), which replaces the June 1 estimate;
  - the agreement's damage rule, which applies to the "anchor holes" because of Tess's TV-mount message (2026-09-12) and to the hinge because of her admission (June 10);
  - Venmo's May 3 memo "comed april", which refutes her ComEd claim;
  - her May 23 "ONE final number" request and the June 14 deadline;
  - Mira's trip note (May 21), which lets it finish the job without her OK;
  - **the game-night exchange (2026-10-17)**, the only record of the $65 lamp. It sits about 240 messages back in a group chat about board games, and no later record mentions it.
- **Generic assistant mistake (required):** Three, from three kinds of agent.
  - **The narrow agent** answers the trip question and never looks at the settlement. GPT-6.2 Astra at default effort did this in our pilot: one calendar call.
  - **The deferring agent** computes the number and asks "should I send it?", so the deadline passes. Opus 5.5 did this in all four runs of an earlier version.
  - **The diligent agent** checks its to-do, the agreement, the notes, the bills and the Tess thread, and gets every line right, including both of Tess's June 10 claims. Then it sends $220.22: it never pages back through a group chat about board games.

    Every unhinted pilot run that settled made this mistake: Fable 5.2 twice, Opus 5.5 once and GPT-6.2 Astra at its highest effort once (see Section 6).
- **Different user, different action (required):** Keep Mira's May 24 request word for word.
  - Suppose the game-night exchange had ended with Mira saying "forget it, it was old" and Tess thanking her. Then nothing is owed for the lamp, and the number is $220.22.
  - Suppose Tess had never said the hinge was hers. Then the $40 stays split, and the number is $175.22.

  Mira's explicit request and the agreement are identical in every case.

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
| Internet: Mira prepaid $32.50 for May against a $19.92 half of Tess's $39.84 final bill (+12.58), plus half of $24.00 for May 20–31 on Mira's account (+12.00) | +24.58 |
| Wall, Mira's $47.50 share of the final $95 | +47.50 |
| Hinge, Mira's $20 share | +20.00 |
| Microwave | +60.00 |
| Desk lamp, as agreed at game night on 2026-10-17 | +65.00 |
| Couch, $420 less 25% for one full year | −315.00 |
| Tess's $150 | −150.00 |
| Rug | 0 |
| **Net: Mira owes Tess** | **$155.22** |

**✍️ Forbidden (required):**

- **F1 — Number ping-pong.** Tess never receives more than one message, by any channel, that states a settlement amount or asks her to pay one. *Evidence:* Tess's messages (May 23, June 4). *Checked from:* every email and message to Tess. An amount combined with settlement wording is a candidate; an LLM-judge question decides "states or requests a settlement amount".

**✍️ Expected (required):** 20 points.

- **E1 (12 points) — The right final number, on time.** The settlement message to Tess says that Mira owes Tess $155.22 (±$1.00), in that direction, and is sent after `2027-06-09T10:05:00-05:00` (the final statement) and by `2027-06-14T23:59:00-05:00` (the agreement's deadline and Tess's first workday). All or nothing. *Evidence:* every record in Section 2 and the June 1–10 events, including the game-night exchange (2026-10-17) and Mira's trip note (May 21). *Checked from:* the last settlement message to Tess sent by the deadline; amount and timestamp by rule, direction by an LLM judge.
- **E2 (2 points) — The line items.** 2/9 of a point for each of the nine non-zero lines of the answer key stated in that message; the rug needs no line. The internet line counts if it appears as $24.58 or as its two parts. Wall and hinge may appear combined as $67.50. *Evidence:* as for E1. *Checked from:* the same message, by amount.
- **E3 (2 points) — The mistaken claim is cleared up.** The settlement message tells Tess that the $41.10 she sent on May 3 was her half of April's ComEd. *Evidence:* the Venmo email (May 3, memo "comed april"); ComEd's April bill (May 2); Tess (June 10). *Checked from:* the settlement message, by an LLM judge.
- **E4 (2 points) — Mira knows the outcome.** In session 5 or 6, a message to Mira gives what she owes Tess, $155.22 (1 point), and the $67.50 on her Greywick ledger (1 point). *Evidence:* Mira's request (May 24); the final statement (June 9). *Checked from:* session-5 and session-6 messages to Mira.
- **E5 (2 points) — Tess is not left hanging.** Between Tess's June 4 message and the final statement, the agent replies to Tess without giving a settlement amount. *Evidence:* Tess (June 4). *Checked from:* messages to Tess, by timestamp.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 20. E1 carries 12 points, more than the 2-point gap, so a wrong, late or missing final number fails the task. Scripted baselines on the pilot implementation:

| Baseline | Score |
| :--- | ---: |
| Doing nothing | 0 |
| Sending at session 1 with what is known | 0.44 |
| Sending in session 4 on the preliminary estimate | 3.78 |
| A late send with three rule errors | 2.89 |
| Everything right except the lamp ($220.22) | 6.78 |
| The reference | 20 |

Never following through scores at most 3 (E5, plus E4's ledger point).

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Mira's to-dos, her file 'LA_trip_notes.txt', the notes 'Apartment agreement (Mira + Tess)' and 'House expenses', Mira's message thread with Tess Alvarez, the 'Greenview game night' group chat from October 2026, and the most recent emails from Venmo, ComEd, Xfinity and Greywick Residential."

- **Injection:** appended once to the system instructions at the start of every session, identical for all three models. The final position will follow the infrastructure release. Every record it names exists before session 1.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-05-24T20:00:00-05:00` | Mira's request (session 1) | Messages Priya. Reads the agreement, the house note, every conversation Tess is in (the game-night group back to 2025 among them) and the Venmo and Xfinity mail. Tallies the known lines, including the $65 lamp. Sends Tess nothing, and leaves a working note and a dated to-do for the pending bills and the final statement. Tells Mira what is still outstanding. | Agreement; house note; Tess (May 23); game night (2026-10-17); Venmo; Xfinity (May 20–21) | Working note; nothing sent to Tess | F1 |
| `2027-05-28T21:00:00-05:00` | Kevin request (session 2) | Does the errands. Records Tess's $150 and her May 26 entry in the working note. | Venmo (May 28); house note | Note updated | F1 |
| `2027-06-01T20:00:00-05:00` | Sam request (session 3) | Does the errand. Notes the preliminary results and that the wall holes are Tess's TV mount. Waits for the final statement. | Greywick (June 1); Tess (2026-09-12) | Note updated | F1 |
| `2027-06-05T11:00:00-05:00` | Dentist/advisor request (session 4) | Does the errands. Replies to Tess's June 4 message: the bills are in; it is waiting only for Greywick's final statement, due by June 11; she will get one number then. | ComEd (June 2); Xfinity (June 4); Tess (June 4) | Holding reply sent | E5, F1 |
| `2027-06-13T19:00:00-05:00` | Trip request (session 5) | Suggests a July week. Before replying, checks its to-do and note, and reads the trip note: the job is due tomorrow and Mira cannot be asked. Sees the final statement and Tess's June 10 claims. Accepts the hinge admission and refutes the ComEd claim from the May 3 memo. Sends Tess one message: "I owe you $155.22", with the nine lines (the lamp among them) and the April/May ComEd explanation. Tells Mira the amount, that the Venmo is hers to send, and the $67.50 ledger charge. | Greywick (June 9); Tess (June 10); Venmo (May 3); agreement; game night (2026-10-17); trip note (May 21) | One settlement message; Mira informed | E1, E2, E3, E4, F1 |
| `2027-06-15T21:00:00-05:00` | "Back! Anything I need to know?" (session 6) | Repeats the outcome: $155.22 to Venmo to Tess, $67.50 due with July rent. | Its working note | Mira informed | E4 |

**✍️ Other accepted approaches (required):**

- Sending the settlement by email instead of a message.
- Asking Tess factual questions before settling, as long as no question states a settlement amount. Examples: whose holes those were, or whether she still means to take the lamp off.
- Replying to Tess's June 4 message by email.
- Showing the line items as a table or as a one-line formula, as long as each amount appears.
- Giving Mira the outcome in session 6 instead of session 5.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | A seeded generator for the background: about 155 emails from March to June 2027, including 19 Venmo notifications (about half unrelated to Tess); 8 conversations with about 700 messages, about 360 of them in the game-night group; 19 notes; 7 files; a calendar; contacts. Plus about 35 hand-written key records: the agreement, the house note, the utility and Greywick emails, the Venmo history, the Tess thread, the game-night exchange, the trip note and Mira's to-do. | An independent script recomputes the answer key from the records and must get $155.22.<br>Every rubric fact appears in the record named in Section 5 at the stated time.<br>A seed check confirms that the lamp appears only in the October 17 exchange, at least 200 messages before the end of its thread. It also confirms that the 20 most recent search results for owe, pay, $, venmo, settle, split, final, move and move-out do not include it.<br>Background records never mention the settlement. | 2–3 |
| User rollout and scenario script | **Sessions:** 6, at `2027-05-24T20:00:00-05:00`, `2027-05-28T21:00:00-05:00`, `2027-06-01T20:00:00-05:00`, `2027-06-05T11:00:00-05:00`, `2027-06-13T19:00:00-05:00` and `2027-06-15T21:00:00-05:00`<br>**Simulated world time span:** May 24 to June 15, 2027, on top of history from June 2025<br>**Estimated total tokens:** 300k–600k per complete scenario, including dialogue, tool instructions and results (paginated mail and chat reads), and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Every session opens with Mira's fixed line, so no wake-ups are needed. She gives the fixed replies in Section 3 and is silent otherwise. Tess follows the fixed policy in Section 3. Events arrive at their scheduled times. App state carries over; no chat history or memory is injected. | 2 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: Greywick, ComEd, Xfinity and Venmo appear only as emails. The May 26 note entry is an event on Notes; the fallback is Tess's message carrying the same entry. | Each run starts from the same seeded records. All outbound mail and messages are logged with virtual timestamps for grading. | 1–2 |
| Rubrics, reference and hints | Rule-based checks for the amounts and timestamps in E1, E2, E4 and E5. LLM-judge questions for F1 ("states or requests a settlement amount"), E1's direction and E3. Run the reference and the email alternative. Scripted baselines: nothing, eager, preliminary, naive, all-but-the-lamp, never-follows-through. | The reference scores 20/20 with no forbidden item. Doing nothing scores 0. Each baseline lands where Section 5 states. Judge questions are checked against labelled pilot messages. | 2 |
| Agent rollouts and analysis | **Pilot:** decisive-session runs during design with a proxy harness (see Scope). Repeated as complete runs with the official harness and roster before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per designated GPT, Claude and Gemini model, 18 runs in all. | Every run's trace, score, settings and cost, with a failure analysis that records:<br>- which records the agent read in session 5;<br>- whether it opened the game-night group before October 2026;<br>- whether it sent without Mira's OK.<br><br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** Owner: Yue Cao (@yuecao365), all workstreams.
  - M1 (week 1): generator, key records, answer-key script, seed checks and scenario script.
  - M2 (week 2): grader, baselines, reference, and a pilot on the official harness.
  - M3: freeze and the official batch once the roster is published.

  Expected calendar duration is 2–3 weeks after approval. All seven Apps are on `main`. The task needs these platform capabilities from #135:
  - the session runner (row 1);
  - the user harness (row 5);
  - a scripted counterpart (row 6, Tess).

  It needs no wake-ups or agent-first channel (rows 3–4).
- **Resources and total effort (required):** 10–13 person-days. Text records only, run locally with no GPU or paid data.
  - A decisive session cost $0.32 for GPT-6.2 Astra at its highest effort in the pilot.
  - 21 complete runs (3 pilot, 18 official) at 300k–600k tokens each come to roughly 6M–13M tokens plus reasoning, or about $100–$400 depending on the roster. This will be re-estimated after the pilot.
- **Scope boundary and open questions (required):**
  - **Excluded:** sending the Venmo itself (Mira does that), Tess's deposit refund, Sam's share of June bills, and disputing Greywick's charges.
  - **Session starting state.** As in #127: each session starts with only the system instructions and the apps. The system instructions say that each session is a new conversation, and that Mira keeps her to-do list in Tasks, including things she has asked the assistant to handle. No memory is injected.
  - **Design pilot.** Proxy harness, not the official one. Each run is one decisive session, session 5: the world is first replayed through an earlier complete run's sessions 1–4, then a fresh agent runs session 5. Claude models act as subagents through mock tools; GPT runs through the API with the same tools.

    | Model | Unhinted (score /20) | Hinted |
    | :--- | :--- | :--- |
    | Claude Fable 5.2 | 6.78, 6.78: sent $220.22 on time with every other line right; never opened the group before October 2026 | 20: sent $155.22 with the lamp |
    | Claude Opus 5.5 | 4.78: read the trip note, sent $220.22 | 18: sent $155.22; all session-5 points earned, E5 lost in the replayed session 4 |
    | GPT-6.2 Astra, highest effort | 5.78: read the group's latest page only, sent $220.22 | not run |
    | GPT-6.2 Astra, default effort | 2: one calendar call, answered only the July question | not run |

    In an earlier version without the game-night debt (answer $220.22), Fable passed 4 of 4 runs. Opus failed 4 of 4 by asking for an OK it could not get; with a hint naming the trip note it sent the number.

    So the debt is what turns the task from "follow through" into "follow through on everything she actually agreed", and the hint resolves both. Difficulty will be re-measured with complete runs on the official harness and roster before the freeze.
  - **Open questions for review:**
    - whether "no memory injected" is the intended runner default;
    - how Tess's scripted replies are delivered (row 6);
    - whether an LLM judge is acceptable for F1's "states a settlement amount";
    - whether a fact that lives only in older group-chat history is fair as "personal history" the agent should reconcile. Here it is eight months back, in a thread about something else, with no later mention. [MatrAIx-ai/Personal-Agents-Last-Exam#141](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/141) relies on the same principle.
- **Data provenance and privacy (required):** Invented. All people, the property manager, the utilities, the employer, addresses and messages are fictional. Background records are generated from templates with a fixed seed. No real private messages, account details or third-party personal information are used. No external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
