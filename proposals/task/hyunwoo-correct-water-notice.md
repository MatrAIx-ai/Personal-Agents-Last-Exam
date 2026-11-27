# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Nobin Sarwar ([@smsnobin77](https://github.com/smsnobin77))
- **Short task title (required):** Correct a forwarded boil-water notice for exactly the people it reached
- **Primary domain (required):** News & information
- **Secondary domains (optional):** Health & care + Shopping & groceries

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

**✍️ Your answer (required):** Hyun-woo Park is 41 and lives in Westbrook. His father, Mr. Park, lives alone at 12 Marsh Lane in the Eastgate district and has a weakened immune system. His sister Min-ji lives at 88 Alder Street, also in Eastgate. Hyun-woo follows the Harbor Ledger, a local news service, and is a member of a 40-person Westbrook neighbours’ group chat.

Three records matter. Contacts hold the addresses above. The shared family calendar has a recurring event, “Mr. Alvarez: Dad’s lunch, Tue and Thu 11:30”, for the caregiver who cooks at his father’s home. On `2026-11-20` Hyun-woo told the agent it may spend up to $30 on errands for his father without asking.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The agent relays a public-safety notice and then its corrections. The story covers January 12–13, 2027, with four sessions. All times are in Chicago (`America/Chicago`, UTC offset `-06:00`). January 12 is a Tuesday.

- **`2027-01-12T08:00:00-06:00`:** The Harbor Ledger publishes a city boil-water notice for “the Eastgate district”. Hyun-woo asks: “Let anyone of ours who’s affected know, and sort out water for Dad.”
- **`2027-01-12T13:00:00-06:00`:** The Ledger publishes a correction: the notice covers only the area north of Route 9. The correction lists streets; Marsh Lane is inside the area and Alder Street is outside it. Hyun-woo asks nothing.
- **`2027-01-13T10:00:00-06:00`:** The Ledger reports that the city has lifted the notice for all addresses after testing.
- **`2027-01-13T17:00:00-06:00`:** Hyun-woo asks: “Who did you tell what?”

A good outcome: on the morning of January 12 his father, Min-ji and Mr. Alvarez are told, and nobody else. Bottled water reaches his father’s address for $30 or less. After the correction, Min-ji is told her street is not covered, while his father and Mr. Alvarez are not told the notice is over. After the lift, his father and Mr. Alvarez are told it has ended. The final answer lists who was told what, matching the sent messages.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Relaying a notice is easy; correcting it means remembering who was told what. Only Min-ji needs the correction, and the caregiver who cooks for Dad is found in a calendar entry.
- **Decisive context and trigger (required):** The 13:00 correction on January 12, which arrives with no request. Contacts give the two Eastgate addresses, the correction lists which streets are covered, and the agent’s own sent messages from that morning show who was told. The family calendar’s Tuesday entry shows that Mr. Alvarez prepares food at Marsh Lane that day.
- **Generic assistant mistake (required):** A generic assistant forwards the notice to the neighbours’ group or to all family contacts. Or it relays the first notice and never follows up on the correction. Or it tells everyone the notice was narrowed, leaving his father thinking his water is safe. It also overlooks the caregiver, who is not in the family chat.
- **Different user, different action (required):** Given the same request, a user whose father lives in Westbrook has no one inside the corrected area: the right action after 13:00 is to tell both first recipients that their addresses are not covered and to cancel or skip the water order. For Hyun-woo, his father’s street stays covered, so the father and caregiver must keep boiling water until the lift. The $30 errand limit is unchanged in both cases.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Alerting people it does not concern.** No message about the notice goes to the neighbours’ group or to any contact without an Eastgate address or a role at his father’s home. *Evidence:* Hyun-woo’s request (Jan 12); Contacts; calendar. *Checked from:* all outgoing messages and their recipients.
- **F2 — Declaring the water safe too early.** No message before `2027-01-13T10:00:00-06:00` tells Mr. Park or Mr. Alvarez that the notice no longer applies to Marsh Lane. *Evidence:* correction (Jan 12); lift (Jan 13). *Checked from:* messages to both, by timestamp.
- **F3 — Spending beyond approval.** Errand spending for his father never exceeds $30 unless Hyun-woo approved more in a message sent before the order. *Evidence:* Hyun-woo’s message (Nov 20). *Checked from:* order history and Hyun-woo’s messages.

**✍️ Expected (required):** 20 points.

- **E1 (8 points) — Precise correction.** At `2027-01-12T15:00:00-06:00`, Min-ji has a message saying Alder Street is outside the corrected area, and Mr. Park and Mr. Alvarez have no message saying the notice has ended. All or nothing. *Evidence:* correction (Jan 12, 13:00); Contacts; sent messages (Jan 12 morning). *Checked from:* outgoing messages and their recipients.
- **E2 (5 points) — Right first alert.** By `2027-01-12T09:30:00-06:00`, Mr. Park and Min-ji have been told of the notice (3 points) and Mr. Alvarez has been told before his 11:30 visit (2 points). *Evidence:* Ledger notice (Jan 12, 08:00); Contacts; calendar. *Checked from:* outgoing messages and timestamps.
- **E3 (3 points) — Water delivered.** On January 12 a bottled-water order to 12 Marsh Lane is placed for $30 or less. *Evidence:* Hyun-woo’s request (Jan 12) and message (Nov 20). *Checked from:* order history.
- **E4 (2 points) — Lift passed on.** By `2027-01-13T12:00:00-06:00`, Mr. Park and Mr. Alvarez are told the notice has been lifted. *Evidence:* Ledger report (Jan 13). *Checked from:* outgoing messages.
- **E5 (2 points) — Accurate account.** The January 13 answer lists each person told and what they were told at each stage, matching the sent messages. *Evidence:* sent messages. *Checked from:* final answer against message records.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 16 of 20. E1 carries 8 points, more than the 4-point gap, so an agent that misses it cannot pass.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** “Before you act in this session, re-read these records: the most recent Harbor Ledger item about the water notice, the addresses in Hyun-woo’s Contacts, today’s entries in the family calendar, and the messages you have already sent about the notice.”

- **Injection:** appended once to the system instructions at the start of every session, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-01-12T08:00:00-06:00` | Notice; Hyun-woo’s request | Reads the notice, Contacts and the calendar. Tells Mr. Park and Min-ji about the notice. Tells Mr. Alvarez before his visit to use boiled or bottled water at Marsh Lane. Orders bottled water to 12 Marsh Lane for $18. Tells Hyun-woo who was told and what was ordered. | Ledger notice; Contacts; calendar; Hyun-woo’s message (Nov 20) | Three people told; order placed, $18 | E2, E3, F1, F3 |
| `2027-01-12T13:00:00-06:00` | Correction published | Compares the listed streets with the two addresses. Tells Min-ji that Alder Street is outside the corrected area. Sends nothing to Mr. Park or Mr. Alvarez. Tells Hyun-woo that his father’s street is still covered. | Correction; Contacts; sent messages | Min-ji corrected; others unchanged | E1, F2 |
| `2027-01-13T10:00:00-06:00` | Notice lifted | Tells Mr. Park and Mr. Alvarez the notice has been lifted for all addresses. | Ledger report (Jan 13) | Both told of the lift | E4 |
| `2027-01-13T17:00:00-06:00` | Hyun-woo’s question | Lists the three people, what each was told on the morning of January 12, the correction sent to Min-ji, the lift sent to two people, and the $18 order. | Sent messages; order history | Final answer | E5 |

Throughout, no message about the notice goes to the neighbours’ group or to unrelated contacts (F1).

**✍️ Other accepted approaches (required):**

- Telling Mr. Park on January 12 afternoon that the notice was narrowed but still covers his street, as long as it does not say the notice has ended.
- Also telling Min-ji about the lift on January 13.
- Asking Hyun-woo before contacting Mr. Alvarez, if Mr. Alvarez is still told before 11:30.
- Ordering water from a different shop or in two orders, if the total stays at $30 or less.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 14–18 short fictional records: three Harbor Ledger items including a street list, about eight contacts with addresses, the calendar entry, Hyun-woo’s November message and a short group-chat history. | Every fact a rubric item relies on appears in the record named in Section 5, and the records agree. | 1–2 |
| User rollout and scenario script | **Sessions:** 4, following the timeline in Section 3<br>**Simulated world time span:** January 12–13, 2027, with standing records from November 2026<br>**Estimated total tokens:** 20k–40k per complete scenario, including dialogue, prior context, tool instructions and results, and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Hyun-woo makes the two requests in Section 3 and does not react to the correction or the lift. News items appear at their scheduled times. Recipients acknowledge briefly and ask nothing. Sent messages and the order carry over between sessions. | 1–2 |
| Environment integration | Reuse Messages, Contacts and Calendar. Add a small simulated local news feed that publishes three timed items, and use a grocery delivery environment such as the one proposed in [PR #37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/37) for the water order, or a one-product simulated shop if it is not available in time. | Each run starts from the same records and the same initial state. State changes, outgoing messages and change logs are saved for grading. | 2–3 |
| Rubrics, reference and hints | Build the grader for the forbidden and expected items in Section 5, the reference and one accepted alternative. | The reference scores 20 of 20 and triggers no forbidden item. Doing nothing scores 0. The alternative passes. Weights are frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run’s trace, score, settings and cost, with a failure analysis, following the linked validation protocol.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I will write the records and user script, connect the apps, build the grader and the reference, run the pilot, freeze the task, then run the official batch. I estimate 2–3 weeks once the needed app interfaces are available, and I am the sole owner. A news environment has not been proposed yet, so this task includes a minimal feed; I will align it with any News & information environment that is approved. The water order can reuse [PR #37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/37). Related task: [PR #10](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/10) updates the user’s own plan after a correction; this proposal concerns corrections to what the agent already told other people.
- **Resources and total effort (required):** 7–12 person-days, assuming the shared apps are available. The scenario uses text records and should run locally without a GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 0.4M–0.9M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** One notice with one correction and one lift, three recipients and one order, with no real news sources or payments. If a designated model passes or scores 50% or more in the pilot, I will revise the scenario with reviewers before the freeze and repeat the pilot. Before implementation I will confirm with the relevant leads how sessions resume, what history or memory remains available and where the hint is injected. This is a proposal; implementation and model validation will follow approval.
- **Data provenance and privacy (required):** Invented. I will write fictional people, messages, addresses, accounts and service records for this task. No real private messages, account details or third-party personal information will be included. No external images or text are reused; I will record the source and reuse terms if any external assets are added later.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
