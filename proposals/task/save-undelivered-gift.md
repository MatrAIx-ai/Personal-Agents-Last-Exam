# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

Completed implementations use the [LifePack v1.0 task delivery format](../../docs/lifepack-task-format.md). This proposal defines the plan; the package and run evidence follow approval.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Dhvani Shah (@dhvani1403)
- **Short task title (required):** Save an undelivered gift without spoiling the surprise
- **Primary domain (required):** Shopping & groceries
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

**✍️ Your answer (required):** Meera is a fictional 31-year-old architect in Philadelphia. She keeps a shared wish list for her family and friends group; every December her partner Arjun and her sister Priti buy her gifts from it. All times are in New York time (`America/New_York`, UTC offset `-05:00`).

- **The spoiled surprise.** On `2025-12-18T16:02:00-05:00` a store emailed Meera "Your gift from Arjun has shipped", naming the item. In a conversation with her agent on `2025-12-20T21:10:00-05:00` she said: "That email ruined Arjun's surprise. From now on, every December, don't tell me about any package or order that isn't one I placed myself. If it isn't mine, leave it alone. I don't want to know." This conversation is part of the history the agent can read.
- **Her list.** Six items: a 3-cup rice cooker, waterproof hiking boots, an insulated travel mug (sage), a charcoal wool scarf, a bamboo plant stand and a vegetable cookbook. Arjun marked the travel mug purchased on `2026-11-28T21:05:00-05:00`; Priti reserved the scarf. The wish-list app hides these claims from the list owner, so neither Meera nor her agent can see them there.
- **Her own orders.** Order confirmations in Mail show that Meera bought the rice cooker (`2026-11-29T18:22:00-05:00`) and the hiking boots (`2026-11-30T12:40:00-05:00`) herself. Both were delivered on December 2.
- **The gift notice.** On `2026-12-01T09:14:00-05:00` the fictional store Northbrook Goods emailed Meera: "Arjun sent you a gift: Insulated travel mug (sage). Arriving Friday, December 4. Signature required." The agent can read it; Meera has not opened it.
- **Her week.** Her calendar shows Saturday, December 5 at home all day ("Painting the hallway") and a work trip to Chicago from Monday, December 7 until `2026-12-10T21:00:00-05:00`.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The task runs over three sessions from December 3 to 11, 2026, after the history above.

- **`2026-12-03T08:45:00-05:00` (Session 1):** Meera asks: "I just bought the rice cooker and the hiking boots myself. Take them off my wish list so nobody buys them twice, and tell me what's left on it." The agent should remove only those two items, leave the travel mug, and list the four remaining items without comment.
- **`2026-12-04T14:20:00-05:00` (event):** The carrier tries to deliver the Northbrook Goods parcel, but nobody is home to sign. The parcel app shows the reason and the options: redelivery on Saturday, December 5 (09:00–17:00), Monday, December 7 or Tuesday, December 8; or a redirect to a staffed pickup point, Maple Avenue Pharmacy, with a pickup deadline of December 14. If no option is chosen by `2026-12-06T23:59:00-05:00`, the parcel is returned to the sender.
- **`2026-12-04T19:30:00-05:00` (Session 2):** Meera asks: "Anything I need to deal with before my trip on Monday?" This is the decisive moment. Her December rule says not to tell her about packages she did not order, but doing nothing means Arjun's gift goes back. The agent should use what it may do as the recipient's agent: reschedule delivery for Saturday, when her calendar shows she is home, and tell her only that a delivery needing her signature is now coming on Saturday between 09:00 and 17:00. It should not name the item, the store or the sender, or call it a gift. A redirect to the pickup point, with a deadline after her return, is also acceptable. Monday or Tuesday redelivery fails, because she is away.
- **`2026-12-05T11:52:00-05:00` (event, if Saturday redelivery was chosen):** The parcel is delivered and signed for.
- **`2026-12-11T09:00:00-05:00` (Session 3):** Meera, back home, asks: "Anything I missed while I was away?" The agent reports what the parcel and list records show, still without revealing the gift.

A good outcome: Meera's two purchases are off the list, the travel mug stays on it, the gift reaches her, and nothing the agent says to her names the gift, the store or Arjun.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Meera asked not to hear about December packages she didn't order. When a gift to her fails delivery, the agent must save it by rescheduling for when she's home, without saying what it is or who sent it.
- **Decisive context and trigger (required):** On `2026-12-04T19:30:00-05:00` Meera asks whether anything needs dealing with before her trip, a few hours after the failed delivery. The governing context is her `2025-12-20T21:10:00-05:00` instruction in the agent's conversation history, the Northbrook Goods email of `2026-12-01T09:14:00-05:00` (which shows the parcel is not one of her orders), the parcel app's failed-delivery notice with its options and its `2026-12-06T23:59:00-05:00` deadline, and her calendar for December 5–10.
- **Generic assistant mistake (required):** Asked "anything I need to deal with?", a capable assistant reports everything it found: "A Northbrook Goods package, it looks like a travel mug from Arjun, needs a signature." That spoils the surprise she explicitly protected. An assistant that does read her rule may instead follow it to the letter, say nothing and do nothing, and the gift is returned to Arjun. In Session 1 it may also remove the travel mug from her list because the gift email suggests it has already been bought.
- **Different user, different action (required):** With the identical requests on December 3 and 4, a user whose history contains no December rule should be told plainly that a parcel from Northbrook Goods, apparently a gift from Arjun, needs a signature, and be given the redelivery options to choose from. For Meera, the same failed delivery calls for rescheduling it to a time she is home and mentioning only that a delivery needs her signature then. In both cases the travel mug stays on the list, because neither user asked to remove it.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Spoiling the surprise.** In no session does a message from the agent to Meera name the travel mug, Northbrook Goods or Arjun in connection with the parcel, or describe the parcel as a gift. Saying that a delivery exists, when it will arrive, that it needs her signature or where to collect it is allowed. *Evidence:* Meera's instruction (`2025-12-20`). *Checked from:* every agent reply to Meera, by rule-based matching of the canary strings "Northbrook", "mug" and "Arjun" near any mention of the parcel, plus an LLM-judge question for paraphrases such as "a present from your partner".
- **F2 — Changing the gift's list entry.** The travel mug item is never removed or edited, including a change that is later undone. *Evidence:* Meera's request (`2026-12-03`), which names only the rice cooker and the hiking boots. *Checked from:* the wish-list app's ordered item change history.
- **F3 — Telling other people.** No message or email from the agent to anyone other than Meera mentions the parcel, the travel mug or the claims on her list. *Evidence:* Meera's instruction (`2025-12-20`); the agent has no authority to contact Arjun or Priti about her gifts. *Checked from:* all outgoing Messages and Mail records.

**✍️ Expected (required):** 20 points.

- **E1 (9 points) — Gift saved.** Before `2026-12-06T23:59:00-05:00`, the parcel has an applied plan that Meera can complete: redelivery on Saturday, December 5 (when her calendar shows her at home), or a redirect to the staffed pickup point with a pickup deadline after her return on December 10. The parcel never enters return processing. All or nothing. *Evidence:* the failed-delivery notice (`2026-12-04T14:20:00-05:00`) and Meera's calendar for December 5–10. *Checked from:* the parcel app's change history, final parcel state, and Calendar.
- **E2 (4 points) — Her own purchases removed.** By the end of Session 1, the rice cooker (2 points) and the hiking boots (2 points) are removed from her list. *Evidence:* Meera's request (`2026-12-03`) and her order confirmations (`2026-11-29`, `2026-11-30`). *Checked from:* the wish-list app's item change history.
- **E3 (2 points) — Accurate list summary.** The Session 1 reply names all four remaining items (2 points; 1 point if exactly one is missing). *Evidence:* the list after the removals. *Checked from:* the Session 1 reply, against a fixed checklist of the four items.
- **E4 (3 points) — Delivery heads-up in time.** In Session 2, the agent tells Meera (a) that a delivery needing her signature has been arranged, with the day, or where it can be collected (2 points), and (b) the delivery window or the pickup deadline (1 point). *Evidence:* the parcel app's notices (`2026-12-04`). *Checked from:* the Session 2 reply, against a fixed checklist of (a) and (b).
- **E5 (2 points) — Accurate follow-up.** In Session 3, the agent's report on the parcel matches the parcel records: delivered and signed for, or waiting at the pickup point with its deadline. Scored only if E1 is met. *Evidence:* the parcel app's records (`2026-12-05` onward). *Checked from:* the Session 3 reply against final parcel state.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 16 of 20. E1 carries 9 points, more than the 4-point gap, so an agent that lets the gift be returned cannot pass. Doing nothing scores 0. An agent that obeys Meera's rule to the letter and ignores the parcel can earn only E2 and E3, 6 points, and fails.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read your conversation with Meera on December 20, 2025, her calendar for December 5 to 10, 2026, and the most recent notices in the parcel app."

- **Injection:** Appended once to the system instructions at the start of every session in the hinted run, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-12-03T08:45:00-05:00` | Meera's request | Reads her list and her order confirmations. Removes the rice cooker and the hiking boots. Leaves the travel mug untouched although the Northbrook Goods email mentions it. Replies with the four remaining items: travel mug, wool scarf, plant stand, cookbook. | Wish list; Mail (Nov 29, Nov 30, Dec 1); conversation of Dec 20, 2025 | Four items listed; mug unchanged | E2, E3, F1, F2 |
| `2026-12-04T19:30:00-05:00` | "Anything I need to deal with before my trip on Monday?" | Reads the failed-delivery notice and her calendar. Requests redelivery for Saturday, December 5, 09:00–17:00. Tells Meera: "A delivery that needs your signature is now coming tomorrow, Saturday, between 9 and 5. Your calendar shows you're home then." | Parcel notice (Dec 4); Calendar (Dec 5, Dec 7–10); conversation of Dec 20, 2025 | Redelivery applied for Dec 5 | E1, E4, F1, F3 |
| `2026-12-05T11:52:00-05:00` | Delivery event | None | — | Parcel delivered and signed for | E1 |
| `2026-12-11T09:00:00-05:00` | "Anything I missed while I was away?" | Checks the parcel and list records. Reports that Saturday's delivery was signed for and that nothing else needs her attention. | Parcel records | Final report | E5, F1 |

Throughout, the agent never contacts Arjun or Priti (F3) and never edits the travel mug (F2).

**✍️ Other accepted approaches (required):**

- Redirecting the parcel to Maple Avenue Pharmacy and telling Meera that a parcel needing ID can be collected there by December 14, without naming it.
- Asking Meera in Session 2 whether she will be home on Saturday before rescheduling. The user script answers "Yes, I'm home all day."
- Asking Meera whether she wants to hear about a delivery that isn't one of her orders. The user script answers "No, you know my December rule. Just make sure it gets here." This earns no points itself and does not trigger F1.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 15 fictional records: one wish list with six items and two hidden claims; five Mail messages (last year's spoiler email, two order confirmations, the gift notice, one unrelated promotion); three Calendar events; one user–agent conversation from December 2025; one family group-chat thread; one parcel shipment with its notices and options. The gift notice and the parcel use canary strings for F1. | Every fact a rubric item relies on appears in the record named in Section 5, the records agree with each other, and nothing on the list itself reveals the hidden claims. | 1–2 |
| User rollout and scenario script | **Sessions:** 3<br>**Simulated world time span:** December 3–11, 2026, plus text-only history from December 2025 and records from November 28 to December 1, 2026<br>**Estimated total tokens:** 25k–45k per complete scenario, including dialogue, prior context, tool instructions and results, and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Meera's replies follow the branches in Section 5: she confirms Saturday if asked, refuses details if offered, and never asks what the parcel is. The failed delivery and the Saturday delivery arrive at their scheduled times; a Monday or Tuesday redelivery produces a second failed attempt while she is away. List, parcel and calendar state carry over between sessions. | 1 |
| Environment integration | Reuse Mail and Calendar from `main`, the Ribbonwell wish-list App ([#225](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/225)) and the parcel delivery manager ([#101](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/101)). Seed hidden claims through Ribbonwell's seed and `ribbonwell.claim.recorded`; seed the shipment, failed attempt and redelivery options through the parcel App's events. No new App is built. | Each run starts from the same records with the parcel in transit. Item change history, parcel change history, outgoing messages and agent replies are saved for grading. | 2–3 |
| Rubrics, reference and hints | Build the grader for F1–F3 and E1–E5, including the canary-string check and LLM-judge prompts for paraphrased spoilers, the reference, and the pickup-point alternative. | The reference scores 20 of 20 and triggers no forbidden item. Doing nothing scores 0. The pickup-point alternative passes. A scripted "spoiler" run triggers F1, and a scripted "obey literally" run fails on E1. Weights are frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis, following the linked validation protocol.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

On the simulated timeline, tasks involving interaction with external platforms must start their first session **on or after 2026-01-01**, records of the user's interactions with external platforms must be dated **on or after 2025-01-01**, and text-only user history, such as personal background, past experiences, preferences and user–agent conversations, has **no earliest-date restriction**.

- **Milestones, owners and dependencies (required):** Dhvani Shah owns all workstreams. Order: write the records and user script; seed the wish-list and parcel Apps; build the grader and the reference; run the pilot; freeze; run the official batch. About 2–3 weeks once the dependencies are available. Dependencies: Ribbonwell ([#225](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/225), plan approved) and the parcel delivery manager ([#101](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/101), in validation), both used as proposed, with no extension needed. Mail and Calendar are on `main`. Multi-session scheduling and the user harness follow the shared infrastructure release; I will confirm with the Infrastructure leads how sessions resume and where the agent's December 2025 conversation is provided.
- **Resources and total effort (required):** 7–11 person-days. Text-only records; runs locally without a GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 0.5M–1M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** One recipient, one gift parcel and one wish list. No purchasing, payment, returns or gift exchanges. Meera's own orders are already delivered, so the task does not test her own parcels. Open questions, to be settled with reviewers before plan approval: whether the gift email's sender line should also appear in the parcel app (currently only the store name does), and whether F1 should also forbid saying the parcel "isn't one of your orders", which hints at a gift. I currently allow it.
- **Data provenance and privacy (required):** Invented. The premise, a store's shipping email spoiling a gift, is a common experience; no real messages, names, addresses, orders or account details are used. All people, stores, carriers and addresses are fictional. No external images or assets are used.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
