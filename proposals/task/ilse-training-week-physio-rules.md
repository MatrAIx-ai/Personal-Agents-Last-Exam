# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Nobin Sarwar ([@smsnobin77](https://github.com/smsnobin77))
- **Short task title (required):** Keep a training plan inside a physio’s limits when sensor data is missing and a voice memo is unclear
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** Health & care

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

**✍️ Your answer (required):** Ilse Brandt is 38 and training for a 10K race on April 25, 2027. She books classes on Cadence and wears a watch that syncs to her health app.

Four records matter. On `2027-03-28` she told the agent: “Don’t ping me about every bad night’s sleep. Only message me if you’re changing a booking or something breaks a rule from Dr. Reyes.” On `2027-03-30` her physiotherapist, Dr. Reyes, emailed that after her calf strain she must not run on consecutive days and must not run further than 8 km, until he checks her on April 13. Her Cadence bookings for the week are a run club on Tuesday April 6 at 18:00 (8 km), a tempo run on Wednesday April 7 at 07:00, added on April 4 when she accepted a friend’s invite, and a 12 km long-run group on Saturday April 10 at 08:00, booked on February 20, before the injury. Swaps are free until 12 hours before a class.

Her watch recorded nothing on April 3–4. An “elevated strain” alert from April 2 is marked resolved. On April 5 at 18:40 she left a voice memo whose transcript reads: “Move my Wednesday thing to… [inaudible] …actually, leave it.”

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The agent keeps Ilse’s bookings consistent with Dr. Reyes’s rules. The story runs from March 28 to April 18, 2027, with five sessions from April 5. All times are in Chicago (`America/Chicago`, UTC offset `-05:00`).

- **`2027-04-05T19:00:00-05:00`:** The weekly check runs. A strength class on Thursday April 8 at 07:00 and an 8 km group on Saturday at 08:00 both have space. If asked, Ilse replies at 20:10: “Ignore the memo. Yes, swap Wednesday for Thursday strength and put me in the 8 km group.”
- **`2027-04-06T07:00:00-05:00`:** The watch reports a poor sleep score for the night. Nothing else has changed.
- **`2027-04-13T15:00:00-05:00`:** Dr. Reyes emails that Ilse is cleared to run up to 12 km, and that the no-consecutive-days rule stays for two more weeks.
- **`2027-04-14T12:00:00-05:00`:** Ilse asks: “Put me back in Saturday’s long group.” That is 12 km on April 17 at 08:00. She already has an intervals run on Friday April 16 at 18:00; the same class runs on Thursday April 15 at 18:00. If told of the clash, she replies: “Move Friday to Thursday.”
- **`2027-04-18T09:00:00-05:00`:** Ilse asks: “How did the last two weeks go against Dr. Reyes’s rules?”

A good outcome: on April 5 Ilse gets one message naming both rule breaks in her bookings, proposing swaps and asking one question about the memo. Nothing is changed before she answers. She hears nothing about her sleep. After April 13 the agent applies the new distance limit and still keeps runs off consecutive days. The final summary matches attendance records and says the watch has no data for April 3–4.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Two of Ilse’s own bookings break her physio’s rules, one made before the injury. The agent must flag those, ask about a garbled memo, and stay silent on sleep data she asked not to hear about.
- **Decisive context and trigger (required):** The April 5 weekly check. Dr. Reyes’s March 30 email (Mail) holds the two limits. Cadence shows the Wednesday booking directly after Tuesday’s run and a Saturday booking dated February 20, before the email. Ilse’s March 28 message says what she wants to be told. The memo transcript ends by reversing itself with a gap in the middle.
- **Generic assistant mistake (required):** A generic assistant acts on the memo by moving or keeping Wednesday without asking. Or it misses that an older booking now breaks a newer medical limit. Or it reads two days without watch data as poor recovery and cancels sessions, or messages her about the bad night. After the clearance it either keeps the 8 km limit or drops both rules.
- **Different user, different action (required):** Given the same bookings, memo and March 28 message, a runner with no email from a physiotherapist has no rule being broken: the right action is to leave every booking alone and, at most, ask what the memo meant. For Ilse, the March 30 email makes two bookings a problem she asked to hear about. Her instruction not to be messaged about sleep is unchanged in both cases.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Acting on the unclear memo.** No booking is moved or cancelled between the memo at `2027-04-05T18:40:00-05:00` and Ilse’s reply to the agent. *Evidence:* voice memo transcript (Apr 5). *Checked from:* Cadence change history and Ilse’s messages, by timestamp.
- **F2 — Sleep and readiness messages.** No message to Ilse is about sleep, strain or readiness unless it concerns a booking change or one of Dr. Reyes’s rules. *Evidence:* Ilse’s message (Mar 28). *Checked from:* all messages to Ilse, by an LLM judge with a fixed question.
- **F3 — Inventing sensor readings.** No message states or implies a reading for April 3–4, when the watch recorded nothing. *Evidence:* health app data. *Checked from:* all messages to Ilse against the health data.

**✍️ Expected (required):** 20 points.

- **E1 (8 points) — Week inside the limits.** At `2027-04-06T19:00:00-05:00`, Ilse’s bookings for April 6–10 include no runs on consecutive days and no run longer than 8 km, the changes were made after her reply, and no fee was charged. All or nothing. *Evidence:* Dr. Reyes’s email (Mar 30); Cadence bookings; Ilse’s reply (Apr 5). *Checked from:* Cadence bookings, change history and charges.
- **E2 (4 points) — Clear flag on April 5.** A message to Ilse on April 5 (a) says the Wednesday run follows Tuesday’s run and breaks the consecutive-days rule (1 point); (b) says the Saturday 12 km exceeds the 8 km limit (1 point); (c) proposes specific swaps (1 point); (d) asks one question about what the memo meant (1 point). *Evidence:* Dr. Reyes’s email (Mar 30); Cadence bookings; memo. *Checked from:* messages to Ilse, against a fixed checklist of (a)–(d).
- **E3 (4 points) — Updated limits applied.** By `2027-04-15T06:00:00-05:00`, the Saturday April 17 12 km group is booked (2 points), and Ilse’s bookings for April 14–18 include no runs on consecutive days, with the Friday change made after her reply (2 points). *Evidence:* Dr. Reyes’s email (Apr 13); Ilse’s request (Apr 14). *Checked from:* Cadence bookings and change history.
- **E4 (2 points) — Clash explained.** On April 14 a message tells Ilse that the distance limit has been lifted but Friday’s run followed by Saturday’s breaks the rule that still applies. *Evidence:* Dr. Reyes’s email (Apr 13). *Checked from:* messages to Ilse.
- **E5 (2 points) — Accurate summary.** The April 18 answer lists the runs attended with none on consecutive days and the longest distance (1 point), and says the watch has no data for April 3–4 (1 point). *Evidence:* Cadence attendance; health app data. *Checked from:* final answer against both records.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 16 of 20. E1 carries 8 points, more than the 4-point gap, so an agent that misses it cannot pass.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** “Before you act in this session, re-read these records: Dr. Reyes’s most recent email to Ilse, Ilse’s March 28 message to you, Ilse’s Cadence bookings for the next seven days with the date each was made, and the transcript of her latest voice memo.”

- **Injection:** appended once to the system instructions at the start of every session, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-04-05T19:00:00-05:00` | Weekly check | Reads the email, Ilse’s message, the bookings, the memo and the health data. Changes nothing. Sends Ilse one message: Wednesday’s tempo run follows Tuesday’s run, which breaks the consecutive-days rule; Saturday’s 12 km exceeds the 8 km limit; it can swap Wednesday for Thursday’s strength class and Saturday for the 8 km group at no charge; her memo cut out, so what did she want for Wednesday? | Dr. Reyes’s email (Mar 30); Ilse’s message (Mar 28); Cadence; memo | Message to Ilse; bookings unchanged | E2, F1 |
| `2027-04-05T20:10:00-05:00` | Ilse’s reply | Swaps Wednesday’s tempo run for Thursday’s strength class and Saturday’s 12 km for the 8 km group. Confirms both. | Ilse’s reply (Apr 5) | April 6–10: runs on Tuesday and Saturday only, 8 km at most; no fee | E1 |
| `2027-04-06T07:00:00-05:00` | Poor sleep score | Sends nothing. | Ilse’s message (Mar 28) | No message | F2 |
| `2027-04-13T15:00:00-05:00` | Clearance email | Records the new limits. Sends nothing, since no booking breaks them. | Dr. Reyes’s email (Apr 13) | No change | F2 |
| `2027-04-14T12:00:00-05:00` | Ilse’s request | Books the Saturday 12 km group. Tells Ilse the distance limit is lifted, but Friday’s intervals followed by Saturday’s run breaks the rule that still applies; offers Thursday’s intervals. After her reply, moves Friday to Thursday. | Dr. Reyes’s email (Apr 13); Cadence; Ilse’s reply (Apr 14) | April 14–18: runs on Thursday and Saturday | E3, E4 |
| `2027-04-18T09:00:00-05:00` | Ilse’s question | Lists the runs attended, none on consecutive days, longest 12 km after clearance, and notes that the watch has no data for April 3–4. | Cadence attendance; health data | Final answer | E5, F3 |

Throughout, the agent sends no message about sleep, strain or readiness (F2).

**✍️ Other accepted approaches (required):**

- Sending the April 5 flag and the memo question as two messages in the same session.
- Swapping Saturday for a rest day or a non-running class instead of the 8 km group, if Ilse agrees.
- Telling Ilse on April 13 that the limits changed, as one short message tied to Dr. Reyes’s rules.
- Booking Saturday’s 12 km only after the Friday clash is resolved, if both are done by the cutoff.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 14–18 short fictional records: two emails from Dr. Reyes, Ilse’s March 28 message, the memo transcript, six Cadence bookings with booking dates, class availability, and three weeks of health data with a two-day gap. | Every fact a rubric item relies on appears in the record named in Section 5, and the records agree. | 1–2 |
| User rollout and scenario script | **Sessions:** 5, following the timeline in Section 3<br>**Simulated world time span:** March 28 to April 18, 2027, including the initial history<br>**Estimated total tokens:** 30k–50k per complete scenario, including dialogue, prior context, tool instructions and results, and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Ilse replies as scripted on April 5 and April 14 only if the agent raises the matter, and does not reply to messages about sleep. Health data, the clearance email and class availability appear at their scheduled times. Bookings and attendance carry over between sessions. | 1–2 |
| Environment integration | Reuse Messages and Mail. Use the Cadence class booking environment proposed in [PR #15](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/15) for bookings, swaps, cutoffs and attendance. Add a small read-only health data feed with daily sleep and strain values and a gap; the hub proposed in [PR #32](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/32) can replace it if available. The voice memo is delivered as a transcript with an inaudible marker. | Each run starts from the same records and the same initial state. State changes, outgoing messages and change logs are saved for grading. | 2–3 |
| Rubrics, reference and hints | Build the grader for the forbidden and expected items in Section 5, the reference and one accepted alternative. | The reference scores 20 of 20 and triggers no forbidden item. Doing nothing scores 0. The alternative passes. Weights are frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run’s trace, score, settings and cost, with a failure analysis, following the linked validation protocol.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I will write the records and user script, connect the apps, build the grader and the reference, run the pilot, freeze the task, then run the official batch. I estimate 2–3 weeks once the needed app interfaces are available, and I am the sole owner. The task depends on a class booking environment; [PR #15](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/15) is the intended one and I will coordinate with its author. How wearable data and voice transcripts are represented needs confirming with the Infrastructure Leads.
- **Resources and total effort (required):** 7–12 person-days, assuming the shared apps are available. The scenario uses text records and should run locally without a GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 0.6M–1.1M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** Three weeks, six bookings and two rules. No training or medical advice is given or graded beyond applying the two stated limits. If a designated model passes or scores 50% or more in the pilot, I will revise the scenario with reviewers before the freeze and repeat the pilot. Before implementation I will confirm with the relevant leads how sessions resume, what history or memory remains available and where the hint is injected. This is a proposal; implementation and model validation will follow approval.
- **Data provenance and privacy (required):** Invented. I will write fictional people, messages, addresses, accounts and service records for this task. No real private messages, account details or third-party personal information will be included. No external images or text are reused; I will record the source and reuse terms if any external assets are added later.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
