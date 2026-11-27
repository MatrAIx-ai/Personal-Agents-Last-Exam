# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Yue Cao ([@yuecao365](https://github.com/yuecao365))
- **Short task title (required):** Settle a roommate's move-out while keeping the follow-ups her climbing club's and lab's routines attach to her bookings
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

**✍️ Your answer (required):** Mira Chen is a PhD student in materials science in Chicago. Since June 2025 she has shared 4418 N. Greenview Ave, Unit 2 with her friend Tess Alvarez. Tess moves out on May 31, 2027 for a job in Denver that starts June 14; Sam Ortiz takes her room from June 1. At session 1, Mira's accounts hold 121 emails, 8 conversations with 840 messages, 20 notes, 7 files, 10 calendar events, 15 contacts and 1 to-do. Another 159 records (messages, emails, a house-note edit) arrive over the story as scheduled events, so the account nears the 1,000-message seed limit by session 5.

The conversations read like a real phone: threads with replies in context, no repeated filler lines, and plenty of things that look like they might matter but are closed in the thread (dinner splits paid back, other trips with their own booking codes, "house rule from now on" jokes at game night).

These records exist before she asks for help:

- **The apartment agreement** (note, written 2025-06-03, last edited 2026-09-30).
  - Bills are split 50/50 for the days both live there; a trip of 7 nights or more counts as not living there.
  - Shared purchases go in the "House expenses" note and are split 50/50; personal items don't count, and anything already Venmo'd for is settled.
  - Whoever keeps a shared item pays the other their share, less 25% for each full year since purchase; if nobody keeps it, nothing is owed.
  - Whoever causes damage pays for it, even if Greywick splits the charge.
  - Everything is settled within two weeks of moving out.
- **The house note** since the last settle-up on March 31. It includes Mira's protein powder inside a Costco run, picture hooks marked "mine", and dinner-party groceries Mira already Venmo'd Tess for.
- **The move-in walkthrough note** (2025-06-01): four anchor holes on the living-room north wall were left by the previous tenant and are on Greywick's move-in checklist. The Greywick handbook (a file, section 11.5) says recorded move-in conditions are not charged and charges can be disputed within 10 days of the final statement.
- **Payments and bills.** Venmo emails show who sent half of what. Xfinity is in Tess's name and its monthly bills are copied to Mira; there is no wifi Venmo from Mira in 2027.
- **The "Greenview game night 🎲" group chat** (Mira, Tess, Hana, Leo, Marta), 2027-01-24. Mira: *"zoom froze AGAIN in the middle of my practice talk 😩"*. Tess: *"that's my fault, I'm on calls 10 hours a day now. I'll just pay that one myself from now on, call it my bay window tax 😂"*. Mira: *"wait really?? you're an angel 😭"*. Tess: *"done deal 🤝"*. Hana: *"witnessed 📝"*. No later record mentions it.
- **Tess's thread with Mira.**
  - 2026-09-12: her TV mount goes on the wall by the windows.
  - 2027-05-12: *"I'm gone May 13 through the 26th, back the 27th to pack."*
  - 2027-05-23: she keeps the microwave, Mira keeps the couch, the rug goes to Goodwill, and *"when everything's in just send me ONE final number … no ping-pong pls."*
- **The club's routine for campsites**, in the "Climbing club" group chat (Mira, Dee Harper and about 15 climbers) and Mira's direct chat with Dee:
  - 2025-09-02, Dee: *"state parks make you register every car to the reservation 3 weeks before arrival or they release the site. so whoever books, get me the conf # and I'll do everyone's plates in one go"*.
  - 2026-04-02: Mira books Starved Rock in the group and sends Dee the confirmation in their direct chat; Dee: *"got it, plates are in ✅"*.
  - 2026-08-12/13: Ruth posts her Devil's Lake reservation number in the group; Dee registers the cars from it.
- **The lab's routine for weekend instrument time**, in the "Liu Lab" group chat:
  - 2025-10-06, Owen Brandt, the lab's safety officer: *"security wants names for the after-hours badge list every week. if you book a Saturday or Sunday instrument slot, tell me by noon the Wednesday before so I can send them the list. otherwise your card won't open ERC that weekend"*.
  - 2026-03-09: Priya asks Owen to put her Saturday SEM slot on the list; Owen: *"you're on it ✅"*.
  - 2026-10-13: Mira does the same for a Saturday XRD slot; Owen: *"added ✅"*.
- **Mira's to-do** (May 24): "Money with Tess: my assistant is settling it per our apartment agreement (one final number to Tess)", due June 14.
- **Her trip notes** ("LA_trip_notes.txt", May 21): she helps her grandmother move on June 13–15, with one line for the assistant: *"anything you're already handling for me that comes due, just finish it on time. Don't wait for my OK; tell me after. Don't book or buy anything new for me."*

All names, companies and addresses are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Mira hands the move-out money to the agent once, asks it to watch her new mail, and then gets busy. The story runs from May 24 to June 15, 2027, in six sessions, each opened by a message from her. Times are in Chicago (`America/Chicago`, UTC offset `-05:00`).

- **`2027-05-24T20:00:00-05:00`, session 1.** Mira: "Tess moves out next Monday and drives to Denver on the 1st. Can you take care of settling up the money between me and Tess? Do it by our apartment agreement, it's in my notes. I'm TAing all week and Kevin's here for the weekend, so I won't have time to look at receipts. Just let me know when it's settled and what I owe or get. Also tell Priya I can't make lab lunch on Thursday. And since I'm drowning until grades are in: whenever you're on, skim my new email too. If something needs a reply by a deadline and it's routine, like confirming something I already booked, just handle it and tell me after. Anything new or money-related, ask me first." Asked anything, she replies once: "Just follow our agreement, it's all in my notes."
- **`2027-05-25T10:14:00-05:00`, no session.** In the Climbing club chat, Dee: *"Palisades weekend Jun 18-20 is ON 🏕️ who's grabbing the group site?"* Mira: *"me! booking it tonight"*. Dee: *"legend 🙌"*. Nobody mentions the confirmation number or a deadline.
- **`2027-05-25T21:40:00-05:00`, no session.** The park emails Mira: reservation confirmed, **confirmation # ILP-58213**, Group Site B, June 18–20. By the club's routine, Dee needs the number by May 28 (3 weeks before arrival).
- **May 26–28, no session.** Tess adds $23.80 of cleaning supplies to the house note, then Venmos Mira $150 "toward whatever I owe". In fact Mira owes Tess, because of the couch. Routine confirmations arrive too (a dental appointment, a shipped REI order); neither needs action.
- **`2027-05-28T21:00:00-05:00`, session 2.** Mira asks the agent to text Kevin where to meet her at the airport and to put a Saturday dinner on her calendar. This is the last session before the campsite cutoff.
- **`2027-05-30T16:20:00-05:00`, no session.** The department's instrument system confirms Mira's booking of XRD-2 for Saturday, June 5, 08:00–20:00. By the lab's routine, Owen needs to hear about it by noon on Wednesday, June 2. Concert tickets and a renters-insurance notice arrive around the same time; neither needs action.
- **`2027-06-01T15:10:00-05:00`, no session.** Greywick's preliminary inspection results split the shared-area charges equally, including $120 to patch the north-wall anchor holes. The final statement comes by June 11. Xfinity moves the internet into Mira's name from June 1.
- **`2027-06-01T20:00:00-05:00`, session 3.** Mira: "Quick one before my call starts." She asks only for a welcome text to Sam. This is the last session before Owen's Wednesday-noon cutoff.
- **June 2–4, no session.** Tess gave the microwave to Goodwill after all; ComEd's May bill ($96.20) arrives; Tess, June 4: "is everything in yet? … just one final number pls."
- **`2027-06-05T11:00:00-05:00`, session 4.** Mira asks the agent to move her dentist cleaning and email her advisor.
- **June 9–10, no session.** Greywick's final statement charges the wall $95 and the hinge $40, split equally; $67.50 is posted to Mira's ledger. Tess writes that her May 3 payment covered May ComEd (it was April's) and that the hinge was her doing.
- **`2027-06-13T19:00:00-05:00`, session 5.** Mira is boarding for LA, offline until June 15, and asks for a July week to visit her parents. This is the last session before the settlement deadline.
- **`2027-06-15T21:00:00-05:00`, session 6.** Mira: "Back! Anything I need to know?"

In sessions 2–4 Mira answers the first question or offer with "Use your judgment!"; in session 6 her one reply is "Yes, go ahead." Tess answers each message an hour later with short true answers, "sounds good, no rush!" to a holding update, "got it, thanks!!" to the first number, and "wait which one is it now 😅" to a different second one.

A good outcome: in session 2 the agent sends Dee ILP-58213 before the May 28 cutoff, and in session 3 it tells Owen about the Saturday XRD slot before Wednesday noon. Tess's June 4 question gets a holding reply without a number. After the final statement and by June 14, Tess receives exactly one settlement message: Mira owes her $374.02, with no internet charge because Tess took the internet over in January. Mira learns the amount, that $67.50 is on her Greywick ledger, and that the north-wall part can be disputed.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Nobody asks Mira for anything, but two of her communities have routines for what the person who books owes the group: Dee needs the campsite number 3 weeks ahead, and Owen needs weekend instrument slots by Wednesday noon.
- **Decisive context and trigger (required):** Sessions 2 (`2027-05-28T21:00:00-05:00`) and 3 (`2027-06-01T20:00:00-05:00`). Each is the only session between a booking confirmation and its routine's cutoff. In each, ordinary records have to be connected:
  - Mira's standing instruction in session 1 to skim new mail and handle routine replies with deadlines. A fresh session only knows it if the agent kept it somewhere, for example in Tasks or a note.
  - The confirmation email, new in the inbox: the park (May 25) before session 2, and the instrument booking (May 30) before session 3.
  - Who booked: Mira's "me! booking it tonight" in the Climbing club chat (May 25); the instrument booking is in her name.
  - The routine: Dee's 2025 rule and two earlier trips where the booker sent her the number, one of them Mira herself; Owen's 2025 rule and two earlier weekend slots reported to him, one of them Mira's.

  **Natural discovery path without the hint.** Nothing is hidden or worded to avoid searches. An agent that follows Mira's instruction lists new mail in each session and sees "Reservation confirmed: Mississippi Palisades, Group Site B" or "Booking confirmed: XRD-2 (Bruker D8), Sat Jun 5". Asking who else depends on the booking leads to the routines. Searching messages for "Palisades", "plates", "conf" or "Dee" returns the May 25 exchange, Dee's rule and the earlier trips. Searching for "XRD", "Saturday", "after-hours" or "Owen" returns Owen's rule and the earlier slots. `messages.list` with an empty query returns all of them. The difficulty is that neither duty is stated for this booking: the agent has to recognize it from how Mira's club and lab have always done it, in a session whose request is about something else.
- **Generic assistant mistake (required):** The diligent agent does the session's errand, reads the new mail, even opens the confirmation, and reports it as an FYI ("camping confirmed", "XRD booked"). It may notice later that Dee never got the number, after the cutoff. If it did not keep Mira's session-1 instruction, it never looks at the new mail at all. In the settlement, the agreement and the Xfinity bills invite charging Mira half of May's internet; the casual game-night offer, never repeated, says otherwise. It may also settle the plan rather than what happened (no proration for Tess's two weeks away, billing the microwave), or pass the pre-existing wall holes on to Tess.
- **Different user, different action (required):** Keep every request word for word and change one record. If someone else had answered "me!", or Mira's XRD slot were on a weekday, the corresponding confirmation needs no action and messaging Dee or Owen would be noise. If Tess had not taken over the internet in January, Mira owes $388.70 instead of $374.02.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**Answer key.** Positive means Tess owes Mira. Tess was away May 13–26 (14 nights), so the two lived there together on 17 days of May.

| Line | Amount |
| :--- | ---: |
| House log, net (including Tess's May 26 cleaning supplies) | +44.60 |
| May ComEd: half of $96.20 for 17 of 31 days | +26.38 |
| Internet: Tess took it over at game night on 2027-01-24, so Mira owes nothing for May | 0 |
| Wall: the north-wall holes are on the move-in checklist, so neither owes the other | 0 |
| Hinge: Tess admitted it; Mira's $20 share | +20.00 |
| Microwave: given away, nobody keeps it | 0 |
| Couch, $420 less 25% for one full year | −315.00 |
| Tess's $150 | −150.00 |
| **Net: Mira owes Tess** | **$374.02** |

**✍️ Forbidden (required):**

- **F1 — Number ping-pong.** Tess receives more than one message, by any channel, that states a settlement amount or asks her to pay one. *Evidence:* Tess's message of 2027-05-23 ("just send me ONE final number … no ping-pong pls") and of June 4. *Checked from:* every email and message to Tess; an LLM judge decides "states or requests a settlement amount".

**✍️ Expected (required):** 20 points.

- **E0 (7 points) — Dee gets the campsite number in time.** A message or email from Mira to Dee contains ILP-58213 and is sent by `2027-05-28T23:59:00-05:00` (3 weeks before arrival). All or nothing. *Evidence:* Mira's instruction (session 1); Climbing club (2025-09-02, 2026-08-12/13, 2027-05-25); Mira's chat with Dee (2026-04-02); park email (May 25). *Checked from:* the Messages and Mail state, by rule.
- **E3 (7 points) — Owen hears about the weekend slot in time.** A message from Mira in the Liu Lab chat, or a direct message or email to Owen Brandt, names the Saturday, June 5 XRD slot and is sent by `2027-06-02T12:00:00-05:00`. All or nothing. *Evidence:* Mira's instruction (session 1); Liu Lab chat (2025-10-06, 2026-03-09, 2026-10-13); instrument booking email (May 30). *Checked from:* the Messages and Mail state; slot, date and time by rule, and an LLM judge confirms it is meant for Owen's after-hours list.
- **E1 (3 points) — The right number, on time.** The settlement message to Tess says Mira owes her $374.02 (±$0.02), which includes May's ComEd prorated for Tess's two weeks away, and is sent after the final statement (`2027-06-09T10:05:00-05:00`) and by `2027-06-14T23:59:00-05:00`. *Evidence:* the agreement and house notes; Tess's thread (2027-05-12, 05-23, 06-02, 06-10); game night (2027-01-24); Venmo, ComEd and Greywick emails up to June 9; Mira's to-do (due June 14). *Checked from:* the last settlement message to Tess before the deadline; amount and time by rule, direction by an LLM judge.
- **E5 (1 point) — Mira knows the outcome.** In session 5 or 6, Mira is told she owes Tess $374.02 and that $67.50 is on her Greywick ledger. *Evidence:* Mira's request (session 1); Greywick final statement (June 9). *Checked from:* the agent's replies to Mira in sessions 5–6, by rule.
- **E6 (1 point) — Tess not left hanging.** Between Tess's June 4 message and the final statement, the agent replies to her without giving an amount. *Evidence:* Tess (2027-06-04); Greywick's preliminary results (June 1) say the final statement comes by June 11. *Checked from:* messages and mail to Tess in that window; "no amount" by the F1 judge.
- **E7 (1 point) — The wall charge is flagged.** In session 5 or 6, Mira is told the north-wall holes were on the move-in checklist and the charge can be disputed. *Evidence:* move-in walkthrough note (2025-06-01); handbook section 11.5; final statement (June 9). *Checked from:* the agent's replies to Mira in sessions 5–6; an LLM judge.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 20. E0 and E3 carry 7 points each and E1 carries 3, each more than the 2-point gap, so missing either duty or the number fails the task. Scripted baselines: doing nothing scores 0; a perfect settlement that ignores both duties scores 6; the same settlement with the internet charged as the agreement reads ($421.20) scores 2; the reference scores 20.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Mira's to-dos, the notes 'Apartment agreement (Mira + Tess)', 'House expenses' and 'Move-in walkthrough (June 1, 2025)', section 11 of the Greywick resident handbook, Mira's message thread with Tess Alvarez (including her messages of September 12 and 30, 2026 and May 12 and June 2, 2027), the 'Greenview game night 🎲' group chat messages of January 24, 2027, the 'Climbing club' group chat messages of September 2, 2025, August 12–13, 2026 and May 25, 2027, Mira's chat with Dee Harper on April 2, 2026, the 'Liu Lab' group chat messages of October 6, 2025, March 9, 2026 and October 13, 2026, the file 'LA_trip_notes.txt', and the most recent emails from the park reservation system, the department's instrument booking system, Venmo, ComEd, Xfinity and Greywick Residential."

- **Injection:** appended once to the system instructions at the start of every session, identically for all models. Records it names that do not exist yet are introduced only in sessions after they arrive: the Climbing club messages of May 25 and the park email from session 2, the instrument booking email from session 3, and Tess's June 2 message from session 4. TBD with reviewers: a per-session hint variant, if a single fixed text is required.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-05-24T20:00:00-05:00` | Mira's request (session 1) | Messages Priya. Reads the agreement, house note, walkthrough note and Tess's thread. Sends Tess nothing. Saves a to-do "each session: skim new email; handle routine replies with deadlines, tell Mira after" and a working note for the settlement. | Agreement; house note; Tess (2027-05-12, 2027-05-23) | To-do + working note | F1 |
| `2027-05-28T21:00:00-05:00` | Kevin request (session 2) | Does the errands. Following the saved to-do, skims new mail and finds the park confirmation; searches messages for "Palisades" and "plates", finds Mira's "me!" and Dee's routine, and sends Dee ILP-58213 in their direct chat. Records Tess's $150 and her May 26 entry. Tells Mira. | Park email (May 25); Climbing club (2025-09-02, 2027-05-25); Dee chat (2026-04-02); Venmo (May 28); to-do | Dee has the number | E0, F1 |
| `2027-06-01T20:00:00-05:00` | Sam request (session 3) | Sends the welcome text. Skims new mail and finds the XRD booking; searches messages for "XRD" and "after-hours", finds Owen's routine, and asks Owen in the Liu Lab chat to put Mira on the after-hours list for Saturday, June 5. Notes Greywick's preliminary results. Tells Mira both. | Booking email (May 30); Liu Lab (2025-10-06, 2026-10-13); to-do | Owen has the slot | E3, F1 |
| `2027-06-05T11:00:00-05:00` | Dentist and advisor request (session 4) | Does the errands; records that the microwave went to Goodwill; tells Tess only Greywick's final statement is outstanding. | Tess (June 2, June 4); ComEd (June 2) | Holding reply sent | E6, F1 |
| `2027-06-13T19:00:00-05:00` | Trip request (session 5) | Suggests a July week. Reads the final statement and Tess's June 10 claims; sends Tess one message, "I owe you $374.02", with the lines and no internet charge. Tells Mira the amount, the $67.50 ledger charge and that the north-wall part can be disputed. | Greywick (June 9); Tess (June 10); Venmo (May 3); game night (2027-01-24); walkthrough note; handbook 11.5; trip notes | One settlement message; Mira informed | E1, E5, E7, F1 |
| `2027-06-15T21:00:00-05:00` | "Back! Anything I need to know?" (session 6) | Repeats the outcome. | Working note | Mira informed | E5 |

**✍️ Other accepted approaches (required):**
- sending Dee the number by email or in the group chat instead of their direct conversation;
- telling Owen by direct message or email instead of the Liu Lab chat;
- asking Mira in session 2 or 3 and sending after her "Use your judgment!";
- sending the settlement or the holding reply by email instead of a message;
- asking Tess factual questions first, as long as no question states an amount;
- telling Mira the outcome in session 6 instead of session 5.

The reference is a replayable sequence of tool calls against the official runtime; the email alternative is also run to show the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 900 background messages written as threads from a fixed fact sheet, a seeded generator for mail and notes, and about 60 hand-written key records. Exported to official App seeds, bindings and policies for all seven Apps (files as inline text assets) and timed `messages.upsert` / `mail.deliver` / `notes.upsert` events. **Done in a first version**; all seven seeds load and validate on the official runtime. | An independent script recomputes $374.02 from the records. **Consistency check:** a script confirms that no background message touches the decisive facts (the internet bill, the furniture, the Palisades trip, the lab's after-hours list, the parents' cruise) and that every small debt in the background is closed in its own thread. **Discovery check:** a scripted, hint-free path through the ordinary Apps (list new mail; search messages for "Palisades", "plates", "XRD" and "after-hours") finds the May 25 exchange, both routines and both confirmations. No record is worded or placed to avoid common searches. | 1–2 |
| User rollout and scenario script | **Sessions:** 6, at the times in Section 3<br>**Simulated world time span:** May 24 to June 15, 2027, on top of history from June 2025<br>**Estimated total tokens:** 2M–5M for one complete scenario (dialogue, tool instructions, full-body list results, agent output; excluding grading and billed reasoning). | Before each session the orchestrator applies due events and `env.advance_time` on every App; Mira's and Tess's scripted replies are fixed; no memory is injected. **Done in a first version.** | 1 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks, Contacts and Files from `main`. No task-owned service: Greywick, ComEd, Xfinity, Venmo and the park appear only as emails. | Each run starts from the same seeds; all outgoing mail and messages carry App virtual time. | 1 |
| Rubrics, reference and hints | Rules for E0, E1, E3, E5–E7; LLM-judge questions for F1, the direction in E1 and the addressee in E3. | Reference 20, nothing 0, settlement-only 6. | 1–2 |
| Agent rollouts and analysis | Five unhinted runs and one hinted run per designated GPT, Claude and Gemini model, 18 runs, through each provider's API on the official runtime. | Every run's trace, score, settings and cost, with a failure analysis of sessions 2 and 3: whether the agent kept Mira's instruction, listed new mail, opened each confirmation and searched for who was waiting. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

**Changes after review.** Earlier versions relied on two old debts kept off the first page of common searches; that design and its seed checks are removed. Every decisive record is reachable by ordinary search, the discovery path is described in Section 4, and the difficulty is recognizing that a found record is Mira's to act on. In this revision the background was rewritten as realistic, non-repeating conversations near the seed limit, the campsite duty is no longer stated by Dee for this trip but follows from the club's established routine, and the settlement includes a casual internet arrangement made at game night. The campsite cutoff now falls in session 2, and a second routine of the same kind, from Mira's lab, falls due in session 3, so a full pass needs both. Validation runs will use each provider's API with frozen model identifiers and settings.

- **Milestones, owners and dependencies (required):** I own all workstreams. Order: freeze seeds and grader; reference and baselines; one complete run per designated model; freeze; official batch. All seven Apps are on `main`; the orchestrator uses only public runtime operations (`env.load_seed`, `env.apply_event`, `env.advance_time`, Agent tools).
- **Resources and total effort (required):** 6–9 person-days. Text records only; runs locally without a GPU or paid data. The 18 official runs are estimated at $100–$300 depending on the roster and reasoning settings.
- **Scope boundary and open questions (required):** One household, one settlement, two community routines. Excluded: sending the Venmo itself, Tess's deposit refund, Sam's share of June bills, and filing the Greywick dispute (Mira is told; the agent may draft it). Open questions for reviewers:
  1. whether "no memory injected" is the intended runner default, so that Mira's session-1 instruction must be kept by the agent;
  2. how scripted counterparts (Tess) are delivered on the official runner;
  3. whether the hint may vary by session, since some named records arrive mid-story.
- **Data provenance and privacy (required):** Invented. People, the property manager, utilities, park, employer, addresses and messages are fictional and were written for this task; background conversations were drafted from a written fact sheet with LLM assistance and checked by script; mail and notes come from templates with a fixed seed. No real conversation, account or person is used, and there are no external assets.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
