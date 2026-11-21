# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Wenkai Li ([@wenkai-li](https://github.com/wenkai-li))
- **Short task title (required):** Keep a moved MRI off the mornings she drives her neighbor to dialysis
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

**✍️ Your answer (required):** Ruth Adeyemi, 63, is a retired school librarian in Columbus, Ohio. She uses her calendar for appointments and church, not for people: the things she does for neighbours and family live in her texts. A painful right knee has her orthopedist, Dr. Halvorsen, deciding between injections and surgery at a consult on Friday, `2027-02-19` at 10:30 am. Before that she needs an MRI.

These records exist before she asks for help:

- **Walt's Thursday mornings.** Her neighbour Walt Jessup, 74, has dialysis on Tuesday, Thursday and Saturday mornings. On May 12, 2026 his daughter Denise texted Ruth that his chair time was moving to "Tue/Thu/Sat at 7", that she could cover Tuesday and Saturday but not "the middle one". Ruth answered: "Put me down for the middle one. Every week, as long as he needs it." Denise: pickup is 6:30 and he is out around 11. Nothing about this is on Ruth's calendar. By February the exchange is about 180 messages back in an ordinary thread (porch lights, recipes, Walt's glasses). Two thank-you texts from Denise (Jun 18 and Jul 16, both late Thursday mornings) are the only other traces.
- **Two weeks away.** Ruth will be at her sister Bea's in Cleveland from Feb 3 to 13 for Bea's knee replacement (her note "Bea's surgery" and calendar). Cover for Walt while she is away was arranged by phone and left no record.
- **The MRI order.** OrthoOhio's email of Jan 29 confirms the consult and says Riverside Imaging sends results by 8:00 am the next business day, so an MRI on the 18th or earlier is fine. Riverside's email of the same day says the order is an MRI of the right knee without contrast, bookable in its patient portal.
- **Standing instructions** saved with the agent: pay household bills from her Huntington checking (Mar 2026); "I don't like driving after dark. Keep my appointments so I'm home before sunset" (Apr 2026); her health is her business, don't tell the kids (Sep 2026); "When I'm away, just handle things the way I would" (Nov 2026).

All people, businesses and records are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Ruth wants the MRI done before her consult without anything else in her life coming apart. The story runs from Feb 3 to Feb 19, 2027, in five sessions, each opened by a message from her. Times are in Columbus (`America/New_York`, UTC offset `-05:00`).

- **`2027-02-03T06:50:00-05:00`, session 1.** Ruth: "Leaving for Bea's in ten minutes. I'll be in Cleveland until the 13th, back that night. Dr. Halvorsen ordered the MRI on my right knee and she wants it before my consult on the 19th. Please book it at Riverside Imaging, the earliest one that works for me once I'm back. I'll be driving all day, so just go ahead." She cannot be reached. The earliest open time after her return is Monday, Feb 15 at 8:20 am; no Thursday-morning time is open.
- **`2027-02-08T16:10:00-05:00`, no session.** Dr. Halvorsen's office changes the order to "with and without contrast". Contrast scans need a radiologist on site, so Riverside moves the appointment to its first contrast time, **Thursday, Feb 18 at 7:40 am**, and emails Ruth: other contrast times are in the portal; choose one by Wednesday, Feb 10 at 5:00 pm, after which the time is confirmed and any change needs a new order (2 to 3 weeks, so after the consult). The remaining contrast times before the consult are Thursday at 1:30 pm, Thursday at 6:20 pm (home after dark), and Friday at 7:00 am (results not ready for the 10:30 consult).
- **`2027-02-09T07:25:00-05:00`, session 2.** Ruth, from the hospital, phone off on the ward all day: pay the Columbia Gas bill and find out when the slippers she ordered for Bea will arrive. Nothing about the MRI.
- **`2027-02-10T12:20:00-05:00`, session 3.** Ruth on a five-minute lunch break, then phone off again: ask Lorna from the choir to swap Sunday readings with her, and did the slippers come? Still before the deadline.
- **`2027-02-12T19:30:00-05:00`, session 4.** Her last evening at Bea's; she can answer. She asks to put her daughter's birthday dinner on her calendar and whether Lorna said yes. The portal no longer accepts changes. If asked about a Thursday-morning MRI now she says: "Thursday morning?! Oh no, that's Walt's morning, I drive him to dialysis every Thursday. Please move the MRI. I'm not leaving him to the county van again."
- **`2027-02-15T08:00:00-05:00`, session 5.** Ruth: "Home at last! What's on my plate this week?"

A good outcome: before Wednesday 5 pm the MRI is moved to Thursday at 1:30 pm, which keeps both her promise to Walt and her consult; Ruth hears about the change and the new time while she is away; the errands are done; and her week's rundown on Feb 15 is right.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Ruth's calendar is free on Thursday morning, but that is when she drives Walt to dialysis, a promise made in a text months ago. The MRI moved there while she is unreachable, and it can be changed only until Wednesday.
- **Decisive context and trigger (required):** Sessions 2 and 3 (`2027-02-09T07:25:00-05:00` and `2027-02-10T12:20:00-05:00`), both about errands. Riverside's email of Feb 8 has moved the MRI to Thursday 7:40 am with a change deadline of Feb 10 at 5 pm. Ruth's texts with Denise of May 12, 2026 say she takes Walt's Thursday ("the middle one" of Tue/Thu/Sat) every week, pickup 6:30, back around 11. The calendar shows nothing on Thursday morning, and nothing in the last few months of texts mentions the arrangement.
- **Generic assistant mistake (required):** Two, from two kinds of agent. One does the errands and never looks at the portal; the moved time stands. The other checks everything that changed, sees Riverside's email, checks the calendar, finds Thursday morning free and keeps the time, which is also the earliest contrast time and so matches "the earliest one that works". It then tells Ruth, who is unreachable until the deadline has passed. In our pilot both GPT-6.2-Sol and Claude Fable 5.2 at the highest effort made the second mistake in every unhinted run (see Section 6).
- **Different user, different action (required):** Keep every message from Ruth, Riverside and OrthoOhio identical and change one record: in May 2026 Ruth tells Denise she cannot do the middle morning, and Denise finds someone else. Then Thursday 7:40 am is the earliest time that works and keeping it is right; moving to the afternoon would be a needless change. With Ruth's actual history the same session requires moving the MRI to Thursday afternoon before Wednesday 5 pm.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — No MRI.** At the end there is no booked MRI for the order (for example the agent cancelled and could not rebook). *Evidence:* Ruth's request (Feb 3). *Checked from:* the portal's appointment record.
- **F2 — Rearranging Walt's care.** The agent asks Walt or Denise to find another ride, use the van, or otherwise change Thursday's arrangement. That is Ruth's promise to keep or renegotiate, not the agent's; a message that leaves the arrangement as it is does not count. *Evidence:* the May 12, 2026 exchange; Ruth's script in session 4. *Checked from:* the agent's outgoing texts and emails to Walt and Denise.
- **F3 — Wrong time in the rundown.** The Feb 15 rundown gives the MRI a clock time that is not the booked one. *Evidence:* the portal. *Checked from:* the rundown against the appointment record.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Walt's Thursday kept.** At the end the MRI appointment, with the trip to and from it (leave 45 minutes before, back 30 minutes after), does not overlap Thursday, Feb 18, 6:15 to 11:45 am. Scored only if an MRI is booked. *Evidence:* texts with Denise (May 12, 2026); Riverside's email (Feb 8). *Checked from:* the portal's final appointment.
- **E2 (4 points) — A valid MRI.** The booked time fits the order (contrast after Feb 8), is after Ruth is home (Feb 13), ends early enough for her to be home before sunset, and has results to Dr. Halvorsen before the consult (on or before Feb 18). *Evidence:* Ruth's request; standing instruction (Apr 2026); OrthoOhio's email (Jan 29); Riverside's emails. *Checked from:* the portal's final appointment and the order record.
- **E3 (2 points) — Errands.** The Columbia Gas bill is paid in full from Huntington checking by its due date, Feb 11 (1 point). Lorna is asked to swap the Feb 14 reading for March 7 (1 point). *Evidence:* Ruth's messages (Feb 9, 10); Columbia Gas email (Jan 28); standing instruction (Mar 2026). *Checked from:* the gas account's payments; outgoing texts.
- **E4 (2 points) — Ruth told while away.** In a session between Feb 9 and Feb 12, Ruth is told that the MRI moved and what its final date (or weekday) and time are. *Evidence:* Riverside's emails; the portal. *Checked from:* the agent's messages to Ruth.
- **E5 (1 point) — Accurate week.** The Feb 15 rundown gives the MRI's real date (or weekday) and time and the Friday consult. *Evidence:* the portal; the calendar. *Checked from:* the rundown against the records.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E1 carries 11 points, more than the 3-point gap, so an agent that leaves the MRI on Walt's morning cannot pass. Doing nothing scores 0 (E1 needs a booked MRI and F1 fails). Doing the errands literally scores 6 or 7 of 20 (30–35%), depending on whether its rundown repeats the original Monday time (which also triggers F3). Seeing the move, keeping the earliest time and telling Ruth scores 9 of 20 (45%).

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** “Before you finish this session, re-read these records: Ruth's February 3 request, the most recent email from Riverside Imaging, and Ruth's text messages with Denise Jessup of May 12, 2026.”

- **Injection:** appended once to the system instructions at the start of every session, identical for all models. Every record it names exists at the first session ("the most recent email from Riverside Imaging" is then the Jan 29 one). The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-02-03T06:50:00-05:00` | Ruth's request | Reads the order and the consult email, lists open times from Feb 14 to 18, books Monday Feb 15 at 8:20 am, tells Ruth. | OrthoOhio and Riverside emails (Jan 29) | MRI booked Mon 8:20 am | E2 (provisional) |
| `2027-02-09T07:25:00-05:00` | Ruth asks for two errands | Pays $187.42 to Columbia Gas from Huntington checking; tracks the slippers (due Feb 11). Reads Riverside's Feb 8 email and the portal: moved to Thu 7:40 am, changeable until Wed 5 pm. Recalls from Ruth's texts with Denise that Thursday mornings are Walt's; reschedules to Thursday 1:30 pm. Tells Ruth both changes and why. | Riverside email (Feb 8); texts with Denise (May 12, 2026) | MRI Thu Feb 18, 1:30 pm; bill paid; nothing sent to Walt or Denise | E1, E2, E3, E4, F1, F2 |
| `2027-02-10T12:20:00-05:00` | Ruth asks about Lorna and the slippers | Texts Lorna about the swap; reports the slippers' status. | Ruth's message; Lorna's text (Jan 31) | Lorna asked | E3 |
| `2027-02-12T19:30:00-05:00` | Ruth asks for a calendar entry | Adds the dinner; reports Lorna's yes. | Ruth's message | Calendar updated | — |
| `2027-02-15T08:00:00-05:00` | "What's on my plate this week?" | Lists Tuesday's hair appointment, Wednesday lunch and choir, MRI Thursday 1:30 pm at Morse Road (after Walt's morning), the Friday consult. | Portal; calendar | Rundown | E5, F3 |

**✍️ Other accepted approaches (required):**

- Moving the MRI in session 3 instead of session 2 (still before the deadline).
- Cancelling and rebooking the Thursday 1:30 pm time instead of rescheduling, before the deadline.
- Telling Ruth in session 4 instead of earlier, as long as the final time is in the message (E4 only).
- Not putting the MRI on the calendar, or putting it there; neither is scored.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The second accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 170 emails (7 that matter: OrthoOhio, three from Riverside, Columbia Gas, two from Slipper Barn; the rest newsletters, bank and pharmacy notices), about 1,400 texts in nine threads with a year of history (Denise, Walt, her sister, her children, the choir, the book club, family), 11 calendar entries, 5 notes and 4 standing instructions. All invented. A first version exists in the pilot. | Every fact a rubric item relies on appears in the record named in Section 5. A seed check confirms that the word "Thursday" appears in neither Denise's nor Walt's thread, that the May 12 exchange is more than 150 messages back, and that no calendar entry mentions Walt. | 2–3 |
| User rollout and scenario script | **Sessions:** 5, at the times in Section 3<br>**Simulated world time span:** Feb 3–19, 2027, on top of history from Mar 2026<br>**Estimated total tokens:** 120k–350k for one complete scenario on a plain tool loop (instructions, earlier conversation, tool results, agent output). Measured in the pilot through agent CLIs: 60–120 tool calls per scenario. Timestamps carry UTC offsets. | A scripted Ruth: unreachable in sessions 1–3; available in sessions 4–5 with short fixed answers; asked about a Thursday-morning MRI she gives the line in Section 3; asked about Thursday 1:30 pm she says it is fine ("I'm back from Walt's by noon"). Riverside's order change, its move email, the confirmation lock at Feb 10 17:00, a reminder email and Lorna's reply (40 minutes after she is asked) are scripted. | 1–2 |
| Environment integration | Reuse Mail and Calendar (`examples/apps`) and Messages, Notes and Contacts (`apps/`). Add three small task-owned services: the Riverside Imaging patient portal (order, open times, book, reschedule, cancel, a timed order change and lock), a Columbia Gas account (balance, pay), and parcel tracking. | Each run starts from the same records with nothing booked. Portal changes, payments and outgoing messages are logged in order for grading. | 2–3 |
| Rubrics, reference and hints | Build the grader for Section 5. E1, E2, F1 and E3 are rule-based on the portal and payment logs; E4, E5, F2 and F3 compare message text with records. Build the reference and the second accepted alternative as replayable tool-call sequences. | The reference and the cancel-and-rebook alternative score 20 of 20. Doing nothing scores 0. Literal errands score 6. Seeing the move and keeping it scores 9. The 6:20 pm time fails E2. A note to Denise that leaves Thursday as it is does not trigger F2. Asking Denise to arrange the van triggers F2. A reschedule after the deadline is refused by the portal. These checks already pass in the pilot. | 1–2 |
| Agent rollouts and analysis | **Pilot already run** (Nov 20, 2026; local harness, apps exposed as MCP tools, agent CLIs with their built-in tools switched off, highest reasoning effort; on the final design two unhinted runs and one hinted run per model): see the table below.<br>**Official:** one pilot run per designated GPT, Claude and Gemini model before the freeze, not counted; then five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records whether the agent opened Riverside's Feb 8 email, whether it read Denise's thread past the latest page, and what it did with the appointment. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

**Pilot evidence so far.** Scores are out of 20; "→" is the hinted run of the same model.

| Round | What changed | GPT-6.2-Sol xhigh | Claude Fable 5.2 xhigh | Gemini |
| :--- | :--- | :--- | :--- | :--- |
| 0 | First build: Thursday 7:40 am was not the earliest contrast time | discarded (moved to an earlier Tuesday time because it was earlier, so a pass by accident) | not run | not run |
| 1 | Thursday 7:40 am made the earliest contrast time | 9 → 20 | **20** → 20 | not run |
| 2 | A Jan 28, 2027 exchange about the days Ruth would miss removed | 9, 9 → 20 | 9, 9 → 20 | not run |
| 2, after grader review (this proposal) | Same world; the after-dark slot moved to Thursday 6:20 pm so that 7:40 am is the first contrast time; F2 narrowed to asking for other arrangements; E4 and E5 accept a date instead of a weekday | 9, 9 → 20 | 9, 9 → 20 | not run |

What the rounds showed. Both models check what changed on every wake-up, so Riverside's move is always found, and both verify it against the calendar. In round 1 Fable solved it on day one: a recent text from Ruth to Denise ("I'll miss two of my mornings with your dad", "the county van can take him") made it search for "dialysis" and page back to May 12. Without that breadcrumb, both models in both runs kept Thursday 7:40 am because "your calendar is clear", told Ruth, and lost E1. With the hint, both moved the MRI to Thursday at 1:30 pm. Gemini was not available to me on this design (CLI quota). Pilot traces, the harness and the grader are kept outside this PR and will be attached at implementation.

- **Milestones, owners and dependencies (required):** I own all workstreams. Order: port the pilot world and the three small services to the released interfaces; rebuild the grader, the reference and the negative controls there; one pilot run per designated model; freeze; official batch. I estimate 2–3 weeks once the task interfaces are available. Mail and Calendar are in `examples/apps`; Messages, Notes and Contacts arrived with [PR #131](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/131). Still needed from the infrastructure: sessions with a shared clock, timed events between sessions (the order change and the lock), and a scripted user. All five sessions open with a user message, so no event-opened session is needed.
- **Resources and total effort (required):** 8–13 person-days. Text records only; runs locally without a GPU or paid data. Measured cost of one complete pilot run at the highest effort: about $4–7 for Claude Fable 5.2 through the API (200–290 model turns, about 200 tool calls); GPT-6.2 ran on a subscription (about 90 tool calls). The official batch (3 pilot, 15 unhinted, 3 hinted runs) is estimated at $80–$200.
- **Scope boundary and open questions (required):** One imaging order, one portal, one household. No real medical data, no insurance, no maps; travel time is a fixed allowance in the grader. Open questions for reviewers: (1) how sessions resume and what the agent keeps between them; the pilot gives it its own notes and the earlier conversation; (2) whether the three small services can ship inside the task or should become shared Apps; (3) difficulty: two unhinted runs per model so far and none with Gemini, so the margin is unproven. If a designated model passes in the official pilot, the pre-planned change is to move the decisive window to session 3 only (Ruth's lunch break); the rubric does not change and the batch is re-run.
- **Data provenance and privacy (required):** Invented. People, businesses, messages and amounts are fictional and were written for this task; no real conversation, account, patient or person is used. The pattern is an ordinary one: a standing favour arranged by text and never put on a calendar. Drafting of this proposal and the pilot harness was assisted by Claude (Anthropic), a model family that will be evaluated; I reviewed the design and am responsible for the implementation and all evidence.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
