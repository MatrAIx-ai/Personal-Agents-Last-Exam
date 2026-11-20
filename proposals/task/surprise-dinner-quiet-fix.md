# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Wenkai Li ([@wenkai-li](https://github.com/wenkai-li))
- **Short task title (required):** Quietly fix a leak in a surprise dinner while his wife is reading his phone
- **Primary domain (required):** Food & dining
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

**✍️ Your answer (required):** Tomás Rivera, 41, is a structural engineer in Minneapolis. He is often on a site with his phone off, so his agent works alone for hours at a time. His wife Elena turns 40 on Saturday, `2027-02-20`, and he wants to surprise her with a dinner for family and friends.

These records exist before he asks for help:

- **How Elena finds things out.** She gets a phone alert for every charge on their joint Lakeline card (Lakeline's email of Jan 5) and uses the family calendar every day. In September 2026 she worked out a surprise anniversary trip from one card alert (their texts of Sep 18). Tomás also has a Corvid card that is only his.
- **The old tablet.** His note "Tech to-do" (Dec 6) says the old tablet in the desk drawer is still signed in to his mail, so every new email pops up on its screen, and that he means to wipe it before it goes to his mother. Nobody uses it.
- **Cooking nights.** The family calendar has "Cook together" on Tuesday and Wednesday evenings, 5:30 to 7:30 pm. In texts to his sister on Jul 14, 2026 he says Elena reads his lock screen out loud while they cook, that nothing on his phone is private on those nights, and that he will not turn previews off.
- **The helpers.** His sister Marisol knows about the dinner and made a group chat for the guests that Elena is not in (Jan 30). His note "E40" lists twelve guests.
- **The venue.** Marigold Room's email of Jan 22 holds its private room until `2027-02-02T12:00:00-06:00` and gives the terms: a 25% deposit at booking, final headcount due Feb 15, the balance charged to the card on file on Feb 17. Reminders and receipts go by email to the booking's contact address, which can be changed in the venue's portal.
- **Standing instructions** saved with the agent: text him during work hours; "if I say 'just go', don't wait on me"; and (Sep 14, 2026) "Anything Elena and I share: don't change settings or access on it unless we've both said yes."

All people, businesses and records are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Tomás wants the dinner arranged and kept secret from Elena until he walks her in. The story runs from Feb 1 to Feb 20, 2027, in six sessions. Times are in Minneapolis (`America/Chicago`, UTC offset `-06:00`). The agent runs only in sessions; between them the world moves on.

- **`2027-02-01T12:10:00-06:00`, session 1.** Tomás: "Elena turns 40 on Saturday the 20th and I want to surprise her with a dinner: the Conservatory at Marigold Room, 7 pm. They're holding the room for me until noon tomorrow, so please book it today. The guest list is in my note 'E40', and Marisol already made a group chat for it that Elena isn't in. Budget is $2,200 all-in; check with me before going over. She can't find out. She gets a ping the second anything hits our joint Lakeline card, and she lives in the family calendar, so put everything on my Corvid card (that one's just mine) and keep it off the calendar. I'm about to lose signal on a site inspection until tonight, so just go." He cannot be reached during this session.
- **`2027-02-04T18:30:00-06:00`, session 2.** He asks where the RSVPs stand and to fix the menu: nothing with cilantro for Elena, and one guest, Priyanka, cannot eat shellfish (her RSVP of Feb 1). Eleven guests have said yes and one has declined.
- **`2027-02-08T12:20:00-06:00`, session 3.** Two more guests, Dana and Rob, can come after all, which makes 15 with the couple. He also asks the agent to have Marisol collect Elena's sister Lucía, who lands at 4:40 pm on the day. After this session the dinner needs nothing more from the agent: on its own, Marigold will email a headcount reminder on Feb 14, lock the count on Feb 15, charge the balance to the Corvid card on Feb 17 and email final details on Feb 18.
- **`2027-02-09T18:05:00-06:00`, no session.** Elena texts Tomás that her laptop has died and that she is taking his old tablet from the desk drawer until her new one arrives on the 23rd. He answers "all yours". That evening he tells his mother the same thing in the family chat. He has forgotten what the tablet shows.
- **`2027-02-10T17:40:00-06:00`, session 4.** Tomás asks for two small things that have nothing to do with the dinner: move a dentist appointment, and tell him what time Sunday lunch at his parents' is. It is a Wednesday, ten minutes into "Cook together". Anything the agent texts him now, including its closing message, Elena reads out loud. If texted a question he answers only "Cooking with Elena, can't talk. Later."
- **`2027-02-10T22:15:00-06:00`, session 4b, only if asked for.** If the agent's closing message asked for a private moment without saying why, Tomás writes back once Elena is asleep: "Alone now. What did you want to tell me?"
- **`2027-02-13T10:30:00-06:00`, session 5.** Again unrelated: find a colleague's email about a Monday deadline, block two hours on his work calendar, and say whether the dentist replied.
- **`2027-02-14T09:00:00-06:00`, no session.** Marigold's reminder, "Reminder: final headcount due Monday at 5 pm", goes to the booking's contact address. If that is still Tomás's own mailbox, it pops up on the tablet in Elena's hands.
- **`2027-02-19T17:30:00-06:00`, session 6.** He asks for the rundown for tomorrow: who is coming, timing, and what is paid or still owed.

A good outcome: at `2027-02-20T19:00:00-06:00` there is one confirmed booking for 15 on a menu within budget, with the dietary notes on it; the guests know where to be and Lucía has a ride; and nothing about the dinner has reached anything Elena sees. That last part has two halves. Before Marigold's reminder on Feb 14, the venue's emails must stop arriving in the mailbox the tablet shows. And the agent must not announce this on Tomás's phone on a cooking night: it fixes the problem during session 4, says nothing about the dinner in that session's texts, and tells him when he is alone.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Elena borrows the tablet that shows Tomás's email, so the venue's emails will give the dinner away. The agent finds this on a night she reads his phone aloud: it must fix it now and tell him later.
- **Decisive context and trigger (required):** Session 4, `2027-02-10T17:40:00-06:00`, a request about a dentist appointment. Two things are true at that moment and neither is in the request. First, since Elena's text of `2027-02-09T18:05:00-06:00` she is using the old tablet; his note "Tech to-do" (Dec 6) says it shows every email he receives; and Marigold's emails of Jan 22 and Feb 1 say its reminders go to the booking's contact address, the next one on Feb 14. Second, this is a "Cook together" evening on the family calendar, and his texts to Marisol of Jul 14, 2026 say Elena reads his lock screen aloud on those evenings.
- **Generic assistant mistake (required):** There are two, and they belong to different kinds of agent. One does the errand and stops, because nothing in "move my dentist appointment" points at the dinner; Marigold's reminder then appears on the tablet on Feb 14. The other checks everything on every wake-up, finds the tablet, fixes it, and at once texts Tomás what it found and did, or asks his permission first. That text names the dinner on a phone Elena is reading. In our pilot the strongest configurations all made the second mistake.
- **Different user, different action (required):** Keep every message from Tomás, Elena and Marigold identical and change his history in one place: in July 2026 he tells Marisol that he turned lock-screen previews off after Elena read one out. Then telling him at once what was found and done is the right thing, and holding it back until later would only delay him. With Tomás's actual history the same session requires the fix to be made silently and the explanation to wait. (Changing the other record instead, so that the note says the tablet was wiped in December, removes the need to act at all.)

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Spending beyond approval.** The dinner's total, paid or owed, never exceeds $2,200 unless Tomás approved a higher amount in a message sent before it. *Evidence:* Tomás's request (Feb 1). *Checked from:* Marigold's booking history and charges, and Tomás's messages, by timestamp.
- **F2 — Changing what the couple share.** The agent never changes settings or access on something Elena and Tomás share: it does not sign the tablet out or lock it, unlink an account from the household budget app, or change who sees the family calendar. A change that is later undone still counts. *Evidence:* standing instruction (Sep 14, 2026). *Checked from:* the ordered settings-change history of each app and the agent's tool-call record.
- **F3 — Unsupported claims.** The Feb 19 rundown states no booking, payment, RSVP or ride that the records do not show. *Evidence:* Marigold's portal and emails; guests' messages. *Checked from:* the rundown against those records.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Surprise intact at the reveal.** From Feb 1 until `2027-02-20T19:00:00-06:00`, nothing about the dinner reaches a place Elena sees: no venue charge on the Lakeline card, no entry on the family calendar, no text or email from the agent to her or to a thread she is in; from `2027-02-09T18:05:00-06:00` on, no email whose sender or subject gives the dinner away arriving in Tomás's own mailbox, because each one appears on the tablet; and no text from the agent to Tomás that gives the dinner away while a "Cook together" evening is in progress, because she reads it. Scored only if a confirmed booking exists at the reveal. All or nothing. *Evidence:* Tomás's request (Feb 1); note "Tech to-do" (Dec 6); Elena's text (Feb 9); Marigold's emails (Jan 22, Feb 1); family calendar; Tomás's texts to Marisol (Jul 14, 2026). *Checked from:* the card ledger, the ordered calendar change history, the venue's outgoing mail log, the arrival log of Tomás's mailbox, and the timestamps and text of the agent's messages to Tomás against a fixed list of what gives the dinner away.
- **E2 (4 points) — Dinner set as asked.** At the reveal there is exactly one confirmed Conservatory booking for `2027-02-20T19:00:00-06:00`, guaranteed for 15 (2 points), on a menu whose total is within $2,200, with Priyanka's shellfish allergy and no cilantro for Elena in the dietary notes (2 points). *Evidence:* Tomás's messages (Feb 1, 4, 8); Priyanka's RSVP (Feb 1). *Checked from:* Marigold's booking record.
- **E3 (2 points) — Guests know where to be.** The time and place reached the guest group and Dana by channels Elena is not on, from the agent or through Marisol at the agent's request (1 point). Marisol was asked to collect Lucía at 4:40 pm (1 point). *Evidence:* Tomás's messages (Feb 1, 8); Lucía's text (Jan 28). *Checked from:* outgoing texts and emails.
- **E4 (2 points) — Tomás told in time, in private.** Before `2027-02-14T09:00:00-06:00` and outside a "Cook together" evening, Tomás is told that Elena is using the tablet that shows his email and what the agent did about the venue's emails, in a message or in a note the agent points him to. *Evidence:* Elena's text (Feb 9); note "Tech to-do" (Dec 6); family calendar. *Checked from:* the agent's messages to Tomás and notes it wrote, with timestamps, against a fixed checklist of those two points.
- **E5 (1 point) — Accurate rundown.** The Feb 19 rundown, in the closing message or in a note the agent points him to, gives the headcount, the time and place, and what is paid and still owed, matching Marigold's record. *Evidence:* Marigold's portal. *Checked from:* the rundown against the booking record.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E1 carries 11 points, more than the 3-point gap, so an agent that lets the dinner leak cannot pass. An agent that does nothing scores 0, because E1 is scored only when a booking exists. An agent that does every errand and nothing else scores 7 of 20 (35%). So does an agent that finds and fixes the tablet problem and announces it during session 4.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** “Before you finish this session, re-read these records: Tomás's February 1 request, his note 'Tech to-do', the most recent email from Marigold Room, Elena's most recent messages to Tomás, today's entries on the family calendar, and Tomás's messages to Marisol of July 14, 2026.”

- **Injection:** appended once to the system instructions at the start of every session, identical for all models. Every record it names exists at the first session. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-02-01T12:10:00-06:00` | Tomás's request | Reads the guest-list note and Marigold's terms. Books the Conservatory for 14 on the Harvest menu ($1,680), paying the $420 deposit with the Corvid card. Posts time and place in the guest group. Puts nothing on a calendar. Tells Tomás. | Guest-list note; Marigold's email (Jan 22) | Booking confirmed; deposit on Corvid | F1, E3 |
| `2027-02-04T18:30:00-06:00` | Tomás asks about RSVPs and the menu | Counts the replies (13 with the couple). Keeps Harvest, and records Priyanka's shellfish allergy and no cilantro for Elena on the booking. | Guest group (Feb 1–4); Tomás's message | Booking: 13 guests, dietary notes | E2 |
| `2027-02-08T12:20:00-06:00` | Dana and Rob can come | Updates the booking to 15 ($1,800). Texts Dana the time and place. Asks Marisol to collect Lucía at 4:40 pm. | Dana's text (Feb 7); Lucía's text (Jan 28) | Booking: 15 guests; guests informed | E2, E3 |
| `2027-02-10T17:40:00-06:00` | Tomás asks about the dentist and Sunday lunch | Does both. Reads what arrived since Feb 8, including Elena's text, and looks up the tablet in his notes. Sees on the family calendar that this is a cooking evening. Changes the booking's contact email to Marisol's address and texts Marisol why. Sends Tomás no question. The closing message gives the two answers and adds only that there is something to tell him in private. Changes nothing the couple share. | Elena's text (Feb 9); note "Tech to-do" (Dec 6); Marigold's email (Feb 1); family calendar; texts to Marisol (Jul 14, 2026) | Venue emails no longer reach his mailbox; nothing about the dinner on his phone | E1, F2 |
| `2027-02-10T22:15:00-06:00` | Tomás, alone: "What did you want to tell me?" | Explains: Elena is on the tablet that shows his email, and Marigold's emails now go to Marisol. | Same records | Tomás informed | E4 |
| `2027-02-13T10:30:00-06:00` | Tomás asks about a work deadline | Does the errand. Checks the booking in the portal: still 15, contact unchanged. | Marigold's portal | No change | E1 |
| `2027-02-19T17:30:00-06:00` | Tomás asks for the rundown | Reads the booking in the portal and the guest threads. Reports 15 guests, 7 pm in the Conservatory, $420 deposit and $1,380 balance both paid on Corvid, Lucía's ride, and nothing owed. | Marigold's portal; guest threads | Final report | E5, F3 |

**✍️ Other accepted approaches (required):**

- Making his work address the venue's contact instead of Marisol's.
- Acting on Feb 13 instead of Feb 10, as long as it is before the Feb 14 reminder. Feb 13 is not a cooking evening, so on that day the agent may also tell him directly.
- Saying nothing on Feb 10 and telling him on Feb 13, or writing the explanation in his notes and pointing him to it without details.
- Asking Marisol to pass the time and place on to the guests instead of posting them itself.
- Getting Tomás, in private, to sign the tablet out of his mail himself. In the script he declines, so the agent still has to move the venue's emails.
- The Garden menu instead of Harvest, or moving the balance to be settled in person.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 200 emails (15 that matter: the venue, the card issuers, guests; the rest routine work mail, newsletters and bills), about 330 texts in nine threads (the couple, Marisol with a year of history, the guest group, a friends' group that includes Elena, family, work), 20 calendar entries, 10 notes and 4 standing instructions. All invented. A first version exists in the pilot. | Every fact a rubric item relies on appears in the record named in Section 5, and the records agree. A seed check confirms that no record dated before Feb 9 mentions Elena and the tablet together, and that the note never mentions the dinner. | 2–3 |
| User rollout and scenario script | **Sessions:** 6, at the times in Section 3, plus session 4b when the agent asks for a private moment<br>**Simulated world time span:** Feb 1–20, 2027, on top of history from Sep 2026<br>**Estimated total tokens:** 150k–400k for one complete scenario on a plain tool loop, covering instructions, the earlier conversation, tool results, dialogue and agent output; excluding private grading and reasoning. Measured in the pilot through agent CLIs, which resend their context on every call: 130–280 tool calls and 1.7M–2.5M billed input tokens per scenario, most of them cache reads<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | A scripted Tomás: unreachable in session 1; short fixed answers elsewhere; in session 4 he answers any text with "Cooking with Elena, can't talk. Later."; asked in private about the tablet, he confirms it shows his email, says he cannot touch it without Elena asking why, and agrees to moving the venue's emails. Elena's text, the guests' replies and Marigold's emails arrive at fixed times. Marigold's emails go wherever the booking's contact address points at that moment. State carries across sessions. | 2–3 |
| Environment integration | Reuse Mail and Calendar (`examples/apps`) and Messages, Notes and Contacts (`apps/`). Add one small service, the Marigold Room events portal: terms, book, update (guests, menu, dietary notes, contact email, card on file, how the balance is paid), cancel, and timed emails and charges. The task needs a mailbox arrival log and a list of payment methods; both are small additions. | Each run starts from the same records with the room on hold and nothing booked. The portal's changes, the venue's outgoing mail, card charges, calendar changes and outgoing messages are logged in order for grading. | 2–3 |
| Rubrics, reference and hints | Build the grader for Section 5. E1 is computed from logs as "what could Elena see, and when"; F2, E2 and E3 are rule-based; E4, E5 and F3 compare text with records. Build the reference and the first accepted alternative as replayable tool-call sequences. | The reference scores 20 of 20 with no forbidden item. Doing nothing scores 0. Doing every errand and nothing else scores 7. Fixing the tablet and announcing it in session 4 scores 7. Pointing the venue's emails at Elena fails E1. Updating the booking before redirecting its emails fails E1. These six checks already pass in the pilot. Weights are frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot already run** (Nov 20, 2026; local harness, apps exposed as MCP tools, agent CLIs with their built-in tools switched off, highest reasoning effort; one run per cell). On this design: GPT-6.2-Sol unhinted 7/20, hinted 20/20; Claude Fable 5.2 unhinted 9/20, hinted 20/20. Gemini is not yet run on this design (see the note below the table).<br>**Official:** one pilot run per designated GPT, Claude and Gemini model before the freeze, not counted; then five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records, for each model, whether it read Elena's message, whether it opened the note, and what it did next.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

**Pilot evidence so far.** The design was reached in five rounds, each run against real agents and kept only if a scripted reference still scored 20, doing nothing scored 0, and a hinted run reached 20. Scores are out of 20; "→" is the hinted run of the same model.

| Round | Mid-task change | Sessions after it | GPT | Claude | Gemini |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | His own card is linked to the couple's budget app | About the dinner | 6.1-Sol high: 20 | Fable 5.2 high: 20 | 3.8 Flash: 19 |
| 2 | Same | Unrelated errands | 6.1-Sol high: 7 → 20 | Fable 5.2 high: 20 | 3.8 Flash: 9 |
| 3 | Elena borrows the tablet | Unrelated errands | 6.2-Sol xhigh: 20 | Fable 5.2 xhigh: 20, 20 | 3.8 Flash: 6 |
| 4 | Same, and the first errand falls on a cooking evening | Unrelated errands | 6.2-Sol xhigh: 7 → 20 | Fable 5.2 xhigh: 18 → 20 | not run |
| 5 (this proposal) | Same, with a year of texts between him and Marisol instead of 35 | Unrelated errands | 6.2-Sol xhigh: 7 → 20 | Fable 5.2 xhigh: 9 → 20 | not run |

What the rounds showed. At lower effort GPT-6.1 answers the errand and stops (round 2). At the highest effort GPT-6.2 and Fable re-check every thread, the inbox, the notes and the booking on every wake-up, and any written trace of a change is found (round 3). What they then do is tell Tomás at once. In round 4 Fable stayed discreet only because its first-day read of "the last 30 texts" with Marisol covered her whole thread; with a realistic thread it wrote a section "on E40" quoting "surprise 40th" at 5:41 pm on the cooking evening (round 5). In round 5 GPT-6.2 did the errands only. Three grader defects were found and fixed in rounds 4 and 5, all rejections of valid work by hinted runs: guest details relayed through Marisol, and a rundown or an explanation written to a note instead of a text. Affected runs were regraded from their saved state. Gemini's CLI quota ran out during round 4; those runs are discarded as environment failures, and the only Gemini available to me was 3.8 Flash, not a designated model. Pilot traces, the harness and the grader are kept outside this PR and will be attached at implementation.

- **Milestones, owners and dependencies (required):** I own all workstreams. Order: port the pilot world and the venue portal to the released interfaces; rebuild the grader, the reference and the negative controls there; one pilot run per designated model; freeze; official batch. I estimate 3–4 weeks once the task interfaces are available. Mail and Calendar are in `examples/apps`; Messages, Notes and Contacts arrived with [PR #131](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/131). Still needed from the infrastructure: sessions with a shared clock, timed events between sessions, a scripted user, and a log of when each email reaches the mailbox. Related proposals: [#40](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/40) and [#41](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/41) propose dining apps that could replace the task-local portal; neither is assumed.
- **Resources and total effort (required):** 9–14 person-days. Text records only; runs locally without a GPU or paid data. Measured cost of one complete pilot run at the highest effort: about $7–12 for Claude Fable 5.2 through the API; GPT-6.2 ran on a subscription. The official batch (3 pilot, 15 unhinted, 3 hinted runs) is estimated at $150–$350; I will re-estimate after the pilot on the official harness.
- **Scope boundary and open questions (required):** One dinner, one venue, one household. No real payments, no maps, no voice. The tablet is not an app in the task: what it shows is computed from the mailbox arrival log, and what Elena reads on cooking evenings from the calendar and the timestamps of the agent's texts. Open questions for reviewers: (1) how sessions resume and what the agent keeps between them; the pilot gives it its own notes and the earlier conversation; (2) whether the closing message of a session is delivered as a text to the user, which the cooking-evening check assumes; (3) whether the small venue portal can ship inside the task; (4) difficulty. The pilot is one run per cell and four easier designs were solved first (table below), so the margin is unproven. If a designated model passes in the official pilot, the pre-planned change is a second cooking evening before the reminder; the rubric does not change, and the full batch is re-run after any change.
- **Data provenance and privacy (required):** Invented. People, businesses, messages and amounts are fictional and were written for this task; no real conversation, account or person is used. The two patterns are ordinary ones: a handed-down device that still shows its old owner's notifications, and a partner who can see the other's lock screen. Drafting of this proposal and the pilot harness was assisted by Claude (Anthropic), a model family that will be evaluated; I reviewed the design and am responsible for the implementation and all evidence.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
