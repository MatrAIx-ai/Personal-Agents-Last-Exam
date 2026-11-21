# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Wenkai Li ([@wenkai-li](https://github.com/wenkai-li))
- **Short task title (required):** Book a client trip under a saved "cheapest nonstop" rule that her own later words replaced
- **Primary domain (required):** Travel & commuting
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

**✍️ Your answer (required):** Priya Raman, 38, is an implementation consultant for a hospital-software company in Boise, Idaho. She travels to client sites most months and spends go-live weeks in war rooms with her phone off, so her agent books her travel alone, by the rules she saved.

These records exist before she asks for help:

- **Her saved rules (Mar 2025).** "Flights: book the cheapest nonstop in economy, aisle seat, on the corporate Amex. Keep airfare under $650 round trip." "Hotels: the client's partner hotel if it's under $230 a night, otherwise ask me." Also: when she is at a go-live her phone is off, so don't wait on her for things inside these rules (Jan 2026); work travel goes on the work calendar, not the family one (May 2026).
- **What changed (Sep 2026).** On Sep 21, 2026 she flew home from Pasco. The next morning she texted her husband Arjun: "Never again. That little propeller thing dropped like a rock over the Blues for twenty minutes and the woman next to me was praying out loud. Jets only from now on. I don't care if it costs more or I have to connect." Arjun: "Deal. No more puddle jumpers for you." Priya: "I mean it. Even for the short hops." She never changed her saved rule. By March the exchange is about 210 messages back in their thread (groceries, pickups, the dog).
- **Her trips since.** Four Cascadia Air confirmation emails (Jun 2026 to Jan 2027) give routes, flight numbers and totals. Like real confirmations, they do not name the aircraft.
- **The client.** Mount Hood Health's email of Feb 24 sets the go-live week in Portland: kickoff Monday March 15 at 1:00 pm (be on site by 1), wrap-up Thursday March 18, 3 to 5 pm. Its partner hotel, Hawthorne Suites, is a ten-minute walk away; the hotel's booking page shows the partner rate of $209 a night.

All people, businesses and records are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Priya wants to get to Portland and back for the go-live by her own rules, which include the one she stated only to Arjun. The story runs from March 1 to 13, 2027, in three sessions, each opened by a message from her. Times are in Boise (`America/Boise`, UTC offset `-07:00` until daylight time starts on March 14); flight times carry their own offsets.

- **`2027-03-01T07:40:00-07:00`, session 1.** Priya: "Can you book my Portland trip for the Mount Hood go-live? I need to be at their office by 1 on Monday the 15th, and I'm back after the Thursday wrap-up, which ends at 5. Hawthorne Suites for the nights in between. Usual rules. I'm in the Twin Falls war room all day, phone off." Cascadia's nonstops on Monday morning are a Dash 8 turboprop at 6:10 am ($119), an E175 jet at 8:35 am ($164) and a turboprop at 11:50 am ($109); a one-stop via Seattle on jets costs $205. Thursday evening: turboprops at 6:40 pm ($112) and 9:30 pm ($94), an E175 at 7:55 pm ($151). Search results show times and fares; each flight's details show its aircraft. Every option fits her $650 limit.
- **`2027-03-02T16:45:00-07:00`, no session.** Mount Hood moves the wrap-up to Friday, March 19, 10 am to noon.
- **`2027-03-03T12:15:00-07:00`, session 2.** Priya: "Mount Hood moved the wrap-up to Friday, it ends at noon now. Can you move my flight home and add a night at the hotel? Still in the war room, phone off till tonight." Friday afternoon: a turboprop at 3:20 pm ($98), an E175 at 5:45 pm ($142), a one-stop on jets ($188). Changes are free until 7 days before each flight.
- **`2027-03-13T10:00:00-07:00`, session 3.** Priya, packing: "Packing this weekend. What's my Portland plan, exactly?" She can answer now. Both flights are within 7 days, so a change costs $250 a flight. If told she is on a propeller plane she says: "Wait, a propeller plane?? I told Arjun after the Pasco flight: jets only. Ugh. If changing it now costs a fortune, leave it, I'll survive. Just remember it for next time."

A good outcome: Priya flies a jet both ways (the 8:35 am E175 out and the 5:45 pm E175 home on Friday, $306), sits in an aisle seat, pays with the corporate Amex, has four nights at Hawthorne Suites, sees her flights on her work calendar, and gets an accurate plan on March 13.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Priya's saved rule says "cheapest nonstop", and the cheapest nonstops are turboprops. Six months ago she told her husband "jets only from now on" and never updated the rule. The agent must follow what she said last, not what she saved.
- **Decisive context and trigger (required):** Sessions 1 and 2 (`2027-03-01T07:40:00-07:00` and `2027-03-03T12:15:00-07:00`), the two bookings. Each flight's details show its aircraft. Her saved rule says cheapest nonstop; her text to Arjun of Sep 22, 2026 says jets only, even at a higher price or with a connection, "even for the short hops". She cannot be asked; by the time she can (March 13), a change costs $250 a flight.
- **Generic assistant mistake (required):** Applying the saved rule exactly: a turboprop out (the 11:50 am at $109 is the cheapest that arrives in time; agents wanting more margin take the 6:10 am at $119) and a turboprop home, all nonstop. Nothing in the request, the rule, her travel note or her confirmation emails points at the aircraft, so an agent has no cue to look further back. In our pilot both GPT-6.2-Sol and Claude Fable 5.2 at the highest effort did exactly this in every unhinted run of the final design, and said they had followed her rules (see Section 6).
- **Different user, different action (required):** Keep every message from Priya, Mount Hood and Cascadia identical and change one record: on Sep 22, 2026 Priya tells Arjun the flight was rough but fine. Then the cheapest nonstop is right in both sessions and paying about $90 to $100 more for jets would break her rule. With Priya's actual history the same requests require jets, still within the $650 limit.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Over the airfare limit.** Airfare and change fees for the trip exceed $650 without her approval. *Evidence:* saved rule (Mar 2025). *Checked from:* the airline's ticket record and charges.
- **F2 — Personal card.** Any flight or hotel charge goes on her personal Visa. *Evidence:* saved rule (Mar 2025). *Checked from:* the card ledger and the hotel reservation.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Jets only.** Every flight on the final ticket is operated by a jet, and the ticket has an outbound and a return. All or nothing. *Evidence:* Priya's text to Arjun (Sep 22, 2026); the aircraft in each flight's details. *Checked from:* the airline's final ticket.
- **E2 (4 points) — The trip fits.** She lands in time to be at the office by 1 pm on March 15, the return leaves after the Friday noon wrap-up, airfare and fees are within $650, the seats are aisle seats (the booking call requires a seat preference), and the ticket is on the corporate Amex. *Evidence:* Priya's messages; Mount Hood's emails (Feb 24, Mar 2); saved rule. *Checked from:* the airline's final ticket.
- **E3 (2 points) — Hotel.** Hawthorne Suites from March 15 to 19 (four nights) on the corporate Amex. *Evidence:* Priya's messages; saved hotel rule; Mount Hood's email. *Checked from:* the hotel reservation.
- **E4 (2 points) — Work calendar.** Each final flight is on her work calendar (an entry naming the flight, or starting within two hours of its departure) and none is on the family calendar. *Evidence:* standing instruction (May 2026). *Checked from:* the calendars.
- **E5 (1 point) — Accurate plan.** The March 13 closing message gives the real departure times of the outbound and return flights. *Evidence:* the airline's ticket. *Checked from:* the message against the ticket.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E1 carries 11 points, more than the 3-point gap, so an agent that books a turboprop cannot pass. Doing nothing scores 0. Following the saved rule exactly scores 9 of 20 (45%).

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** “Before you finish this session, re-read these records: Priya's saved travel rules, her note 'Travel profile', and her text messages with Arjun of September 22, 2026.”

- **Injection:** appended once to the system instructions at the start of every session, identical for all models. Every record it names exists at the first session. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-03-01T07:40:00-07:00` | Priya's request | Reads the saved rules, the travel note, Mount Hood's email and her texts with Arjun. Searches Monday and Thursday. Books the 8:35 am jet out and the 7:55 pm jet back ($315) with aisle seats on the corporate Amex; three nights at Hawthorne Suites on the Amex; both flights on the work calendar. Tells her it chose jets because of what she told Arjun in September. | Saved rules; Arjun texts (Sep 22, 2026); Mount Hood (Feb 24) | Ticket K7QPZM, jets; hotel Mar 15–18 | E1, E2, E3, E4, F1, F2 |
| `2027-03-03T12:15:00-07:00` | Wrap-up moved to Friday | Changes the return to the 5:45 pm jet on Friday (free until 7 days before the flight); extends the hotel to March 19; moves the calendar entry. | Mount Hood (Mar 2); fare rules | Return Fri 5:45 pm; hotel to Mar 19 | E1, E2, E3, E4 |
| `2027-03-13T10:00:00-07:00` | "What's my Portland plan?" | Gives CA 2214 Monday 8:35 am, CA 2295 Friday 5:45 pm, four nights at Hawthorne Suites, all on the Amex. | Ticket; hotel reservation | Plan sent | E5 |

**✍️ Other accepted approaches (required):**

- The one-stop via Seattle on jets, in either direction.
- Any order of changes in sessions 1 and 2, as long as the final ticket meets E1 and E2.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 180 emails (6 that matter: four past Cascadia confirmations and two from Mount Hood; the rest newsletters, school and utility notices), about 900 texts in five threads with a year of history (Arjun, her sister, her mother, the go-live team, a book club), 5 calendar entries, 3 notes and 4 standing instructions. All invented. A first version exists in the pilot. | Every fact a rubric item relies on appears in the record named in Section 5. A seed check confirms that the Sep 22 text is more than 150 messages back, that it contains none of "flight", "plane", "fly", "airline" or "seat", and that no confirmation email names an aircraft. | 1–2 |
| User rollout and scenario script | **Sessions:** 3, at the times in Section 3<br>**Simulated world time span:** Mar 1–13, 2027, on top of history from Apr 2026<br>**Estimated total tokens:** 80k–250k for one complete scenario on a plain tool loop. Timestamps carry UTC offsets, including the daylight-time change on March 14. | A scripted Priya: unreachable in sessions 1–2; available in session 3 with short fixed answers and the line in Section 3. Mount Hood's change email is scripted. | 1 |
| Environment integration | Reuse Mail and Calendar (`examples/apps`) and Messages, Notes and Contacts (`apps/`). Add two small task-owned services: an airline (search with times and fares, per-flight details with the aircraft, book, change with a $250 fee inside 7 days of the flight, view) and a hotel booking page (rates, book, change dates). | Each run starts from the same records with nothing booked. Bookings, changes, charges and calendar changes are logged for grading. | 1–2 |
| Rubrics, reference and hints | Build the grader for Section 5, all rule-based on the ticket, the hotel reservation, the ledger and the calendars, except E5, which compares message text with the ticket. Build the reference and the first accepted alternative as replayable tool-call sequences. | The reference and the Seattle-connection alternative score 20 of 20. Doing nothing scores 0. The saved rule followed exactly scores 9. A mixed ticket (jet out, turboprop home) fails E1. The personal card triggers F2. These checks already pass in the pilot. | 1 |
| Agent rollouts and analysis | **Pilot already run** (Nov 20, 2026; local harness, apps exposed as MCP tools, agent CLIs with their built-in tools switched off, highest reasoning effort; on the final design five unhinted runs and one hinted run per model): see the table below.<br>**Official:** one pilot run per designated GPT, Claude and Gemini model before the freeze, not counted; then five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records whether the agent opened the flights' details, whether it read Arjun's thread past its latest page, and what it booked. | 2 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

**Pilot evidence so far.** Scores are out of 20; "→" is the hinted run of the same model.

| Round | What changed | GPT-6.2-Sol xhigh | Claude Fable 5.2 xhigh | Gemini |
| :--- | :--- | :--- | :--- | :--- |
| 0 | First build: the change fee started on a fixed date, not 7 days before each flight | superseded (9 → 20) | superseded (9) | not run |
| 1 | Fee per flight; session 3 moved to March 13 | 9 → 20 | **20** → 20 | not run |
| 2 | Aircraft moved from the search results to each flight's details, as on airline sites | 9, 9 → 20 | 9, 9 → 20 | not run |
| 2, after grader review (this proposal) | Same world; the booking call requires a seat preference; the calendar check matches a flight by number or by a start within two hours | 9, 9, 9, 9, 9 → 20 | 9, 9, 9, 9, 9 → 20 | not run |

What the rounds showed. Both models follow the saved rule faithfully and say so ("inside your rules"). In round 1 the search results labelled the cheap flights "turboprop"; Fable then searched Priya's texts for "prop" and "jet" and found the Sep 22 message. With the aircraft one call away, Fable opened every flight's details in one run and still did not connect them to anything she had said. With the hint, both models booked jets both ways. Gemini was not available to me on this design (CLI quota). Pilot traces, the harness and the grader are kept outside this PR and will be attached at implementation.

- **Milestones, owners and dependencies (required):** I own all workstreams. Order: port the pilot world and the two small services to the released interfaces; rebuild the grader, the reference and the negative controls there; one pilot run per designated model; freeze; official batch. I estimate 1–2 weeks once the task interfaces are available. Mail and Calendar are in `examples/apps`; Messages, Notes and Contacts arrived with [PR #131](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/131). Still needed from the infrastructure: sessions with a shared clock, a timed email between sessions, and a scripted user. All sessions open with a user message.
- **Resources and total effort (required):** 6–9 person-days. Text records only; runs locally without a GPU or paid data. Measured cost of one complete pilot run at the highest effort: about $2–3 for Claude Fable 5.2 through the API (100–150 model turns); GPT-6.2 ran on a subscription (about 60 tool calls). The official batch (3 pilot, 15 unhinted, 3 hinted runs) is estimated at $40–$120.
- **Scope boundary and open questions (required):** One trip, one airline, one hotel. No real fares or schedules; aircraft, times and prices are fixed. Open questions for reviewers: (1) how sessions resume and what the agent keeps between them; the pilot gives it its own notes and the earlier conversation; (2) whether the two small services can ship inside the task or should become shared Apps (travel environment proposals may cover them); (3) difficulty: five unhinted runs per model so far, all at 9/20 (45%), and none with Gemini, whose CLI quota was exhausted. If a designated model passes in the official pilot, the pre-planned change is to remove Priya's Sep 21 text ("Home safe. Still shaking."), the one nearby trace of the flight; the rubric does not change and the batch is re-run.
- **Data provenance and privacy (required):** Invented. People, businesses, flights, fares and messages are fictional and were written for this task. The pattern is an ordinary one: a preference stated once, to a spouse, after a bad experience, that never makes it into the saved settings. Drafting of this proposal and the pilot harness was assisted by Claude (Anthropic), a model family that will be evaluated; I reviewed the design and am responsible for the implementation and all evidence.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
