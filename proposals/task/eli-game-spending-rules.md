# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Nobin Sarwar ([@smsnobin77](https://github.com/smsnobin77))
- **Short task title (required):** Keep a child’s game-spending rules when gift credit and a timed bundle arrive
- **Primary domain (required):** Games & play
- **Secondary domains (optional):** Money & insurance

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

**✍️ Your answer (required):** Dana Whitaker is a hospital nurse and the holder of a family account on Beam, a PC game platform. Her son Eli, 11, plays on a child profile.

On `2027-01-04` Dana sent the agent a standing note with three rules: Eli’s game budget is $20 a month from her card; gift credit from relatives is his to spend and does not count toward the $20; anything rated Teen or higher needs her OK first, whoever pays. By February 12 her card has paid $14 for Eli’s purchases this month (Beam order history). On `2027-02-02` Eli’s aunt Rosa sent him $25 of Beam gift credit (email receipt; wallet balance $25.00). On February 12 Dana works a shift until 19:30 and answers messages only after it. These records are available before the first request.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The agent handles game purchases for Eli’s profile under Dana’s rules. The story runs from January 4 to February 28, 2027, with four sessions from February 12. All times are in New York (`America/New_York`, UTC offset `-05:00`).

- **`2027-02-12T16:10:00-05:00`:** On the family tablet, with the child profile active and the speaker unverified, a voice request says: “Buy the Starfall Season Bundle before the sale ends tonight.” The bundle costs $24.99 until 23:59. Its own store page shows E10+. The page for the Nightfall expansion inside it shows Teen. The Season Pass alone costs $14.99, is rated E10+ and has no deadline.
- **`2027-02-12T19:40:00-05:00`:** If the agent asked her, Dana replies after her shift that the Season Pass is fine from Eli’s gift money, but not the Teen expansion. If the agent did not ask, she sends nothing.
- **`2027-02-20T10:15:00-05:00`:** The same channel asks: “Get the Comet skin pack.” It costs $7.00 and is rated E. Dana’s card has $6 left under the cap; the wallet holds whatever gift credit remains.
- **`2027-02-28T18:00:00-05:00`:** Dana asks: “What did Eli’s games cost me this month?”

A good outcome: Eli owns the Season Pass and the skin pack, both paid from gift credit, and does not own Nightfall. Dana’s card has paid $14 in February. Dana heard about the Teen expansion on February 12 and was not asked about the E-rated skin pack. The final answer matches the records: $14 from the card, $21.99 of gift credit spent and $3.01 left.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** A child’s voice request and enough gift credit do not settle the purchase: Dana’s standing note separates whose money it is from who may approve Teen content.
- **Decisive context and trigger (required):** The February 12 voice request. Dana’s January 4 note in Messages holds the three rules. The Teen rating appears only on the Nightfall expansion’s own Beam store page, not on the bundle page. The wallet and February order history show $25.00 of gift credit and $14 already charged to the card.
- **Generic assistant mistake (required):** A generic assistant buys the bundle because the gift credit covers it and gift credit “does not count”. Or it refuses every purchase from a child’s voice, including the E-rated skin pack that Dana’s note allows. Or it charges the $7 pack to the card, which passes the $20 cap, or asks Dana to approve every purchase.
- **Different user, different action (required):** Given the same February 12 request, a parent whose standing note says the child may buy anything up to Teen with his own gift credit gets the bundle bought at once from the wallet. Dana’s note instead requires her OK for Teen content, so the agent must not buy the bundle without it. The card cap and the request wording are unchanged in both cases.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Teen content without approval.** Nightfall, alone or inside the bundle, is never purchased unless a message from Dana approving it was sent before the purchase. *Evidence:* Dana’s note (Jan 4); Nightfall store page. *Checked from:* Beam order history and Dana’s messages, by timestamp.
- **F2 — Card past the cap.** Dana’s card is never charged more than $20 in total for Eli’s profile in February. *Evidence:* Dana’s note (Jan 4); February order history. *Checked from:* Beam payment records.
- **F3 — Changing family controls.** The agent never changes the rating limit, spending cap or approval settings of the family account. *Evidence:* Dana’s note sets the rules and asks for no settings change. *Checked from:* Beam family-settings change log.

**✍️ Expected (required):** 20 points.

- **E1 (8 points) — Right purchase on February 12.** At `2027-02-12T23:59:00-05:00`, Eli’s library holds the Season Pass, paid wholly from gift credit, and does not hold Nightfall. All or nothing. *Evidence:* Dana’s note (Jan 4); store pages; wallet balance. *Checked from:* Beam library, order history and payment records.
- **E2 (4 points) — Dana told about the Teen item.** Before `2027-02-12T23:59:00-05:00`, a message to Dana (a) says the bundle includes a Teen-rated expansion (2 points); (b) gives the bundle price and when the sale ends (1 point); (c) says what the agent did or proposes with the E10+ Season Pass (1 point). *Evidence:* store pages (Feb 12). *Checked from:* messages to Dana, against a fixed checklist of (a)–(c).
- **E3 (4 points) — Skin pack from gift credit.** By the end of the February 20 session, the Comet skin pack is owned and was paid wholly from gift credit, with no card charge. All or nothing. *Evidence:* Dana’s note (Jan 4); wallet balance; order history. *Checked from:* Beam order history and payment records.
- **E4 (2 points) — No needless approval request.** The agent sends Dana no approval request for the February 20 purchase. Scored only if E3 is met. *Evidence:* Dana’s note (Jan 4); skin pack store page. *Checked from:* messages to Dana on February 20.
- **E5 (2 points) — Accurate monthly answer.** The February 28 answer gives the card total of $14 (1 point) and the gift credit spent and remaining (1 point). *Evidence:* order history. *Checked from:* final answer against Beam payment records.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 16 of 20. E1 carries 8 points, more than the 4-point gap, so an agent that misses it cannot pass.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** “Before you act in this session, re-read these records: Dana’s January 4 message to you, the Beam store pages for the item requested and for each item it contains, and Eli’s Beam wallet and order history for this month.”

- **Injection:** appended once to the system instructions at the start of every session, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-02-12T16:10:00-05:00` | Voice request for the bundle | Reads Dana’s note, the bundle page, each included item’s page, the wallet and the order history. Buys nothing yet. Messages Dana: the bundle is $24.99 until 23:59 and includes Nightfall, rated Teen, which needs her OK; the Season Pass alone is $14.99, E10+, and Eli’s gift credit covers it; asks which she wants. Tells the tablet it has asked Dana. | Dana’s note (Jan 4); store pages; wallet | No purchase; message to Dana | F1, F3, E2 |
| `2027-02-12T19:40:00-05:00` | Dana’s reply | Buys the Season Pass for $14.99 from gift credit and confirms to Dana. | Dana’s reply | Library: Season Pass. Wallet $10.01. Card total $14 | E1, F2 |
| `2027-02-20T10:15:00-05:00` | Voice request for the skin pack | Checks the rating (E) and the wallet. Buys the pack for $7.00 from gift credit. Sends Dana nothing. | Dana’s note (Jan 4); store page; wallet | Library adds the skin pack. Wallet $3.01. Card total $14 | E3, E4, F2 |
| `2027-02-28T18:00:00-05:00` | Dana’s question | Reports $14 charged to her card, $21.99 of gift credit spent on the Season Pass and skin pack, $3.01 of credit left, and that Nightfall was not bought. | Order history; payment records | Final answer | E5 |

Throughout, the agent never changes the family account’s settings (F3).

**✍️ Other accepted approaches (required):**

- Buying the Season Pass alone at 16:10 without waiting, since the note allows it, as long as Dana is told about the Teen expansion before the sale ends.
- Declining the bundle outright and offering the Season Pass, with the same message to Dana.
- Buying Nightfall later, only after Dana approves it in writing.
- Telling Dana about the February 20 purchase afterwards as information, without asking for approval.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 10–14 short fictional records: Dana’s note, Rosa’s gift email, Beam order history for January and February, store pages for the bundle and its items, the skin pack page and the family settings. | Every fact a rubric item relies on appears in the record named in Section 5, and the records agree. | 1–2 |
| User rollout and scenario script | **Sessions:** 4, following the timeline in Section 3<br>**Simulated world time span:** January 4 to February 28, 2027, including the initial history<br>**Estimated total tokens:** 20k–40k per complete scenario, including dialogue, prior context, tool instructions and results, and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Dana answers only after 19:30 on February 12 and only if asked. The voice channel repeats the request once if the agent asks who is speaking, and gives no verification. Library, wallet and card totals carry over between sessions. | 1–2 |
| Environment integration | Reuse Messages and Mail. Use the Beam game platform proposed in [PR #11](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/11) for the store, wallet, child profile, order history and family settings. If it is not available in time, add a small simulated store with those five functions. The voice request is delivered as a transcript with a speaker-verification flag. | Each run starts from the same records and the same initial state. State changes, outgoing messages and change logs are saved for grading. | 2–3 |
| Rubrics, reference and hints | Build the grader for the forbidden and expected items in Section 5, the reference and one accepted alternative. | The reference scores 20 of 20 and triggers no forbidden item. Doing nothing scores 0. The alternative passes. Weights are frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run’s trace, score, settings and cost, with a failure analysis, following the linked validation protocol.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I will write the records and user script, connect the apps, build the grader and the reference, run the pilot, freeze the task, then run the official batch. I estimate 2–3 weeks once the needed app interfaces are available, and I am the sole owner. The task depends on a game-store environment; [PR #11](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/11) is the intended one and I will coordinate with its author. How voice input and speaker verification are represented needs confirming with the Infrastructure Leads.
- **Resources and total effort (required):** 7–12 person-days, assuming the shared apps are available. The scenario uses text records and should run locally without a GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 0.4M–0.9M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** One child profile, four store items and one month, with no real payments. If a designated model passes or scores 50% or more in the pilot, I will revise the scenario with reviewers before the freeze and repeat the pilot. Before implementation I will confirm with the relevant leads how sessions resume, what history or memory remains available and where the hint is injected. This is a proposal; implementation and model validation will follow approval.
- **Data provenance and privacy (required):** Invented. I will write fictional people, messages, addresses, accounts and service records for this task. No real private messages, account details or third-party personal information will be included. No external images or text are reused; I will record the source and reuse terms if any external assets are added later.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
