# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

Completed implementations use the [LifePack v1.0 task delivery format](../../docs/lifepack-task-format.md). This proposal defines the plan; the package and run evidence follow approval.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** [@IsThatYou](https://github.com/IsThatYou)
- **Short task title (required):** Post a fantasy league's trade rulings without ruling on the commissioner's own trade
- **Primary domain (required):** Games & play
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

**✍️ Your answer (required):** Kofi Mensah is a product designer in Philadelphia and the commissioner of the Quad League, a 12-team fantasy football league of college friends in its third season (2024, 2025 and 2026). The league runs on Gridline, a fictional fantasy platform that emails Kofi a notice for every proposed and accepted trade. The league talks in one group chat with 13 members: the 12 current managers and Jonah, who gave up his team this season. The league, the platform, the people and the players are invented.

These records exist before Kofi asks for help:

- **Constitution (Files, `Quad League/Constitution.md`, three versions saved on 2025-08-24, 2026-08-23 and 2026-10-11).** §7.2 sets the veto threshold. The third version raises it from 4 to 5 from the start of league week 6, `2026-10-13T00:00:00-04:00`. Every version has the same other rules. §2.3: the co-commissioner is elected at the August draft meeting and the result is recorded in the league chat. §7.3: each team has one veto, cast in the league chat by the manager who holds the team, within 48 hours of Gridline's acceptance notice. The parties to a trade cannot veto it. A manager can withdraw a veto in the chat before the window closes. No ruling is posted before the window closes. §7.4: a trade is governed by the rules in force when it is accepted. §7.5: the commissioner posts each ruling in the league chat in the form “Ruling: <manager> / <manager>: stands or void, N valid vetoes, threshold T”, and that message is the league's record. A ruling names every veto message that was not counted and gives the reason. The constitution says nothing about a commissioner's own trades.
- **Kofi's promise (league chat, `2025-09-02T19:20:00-04:00`).** At the start of season 2 Kofi wrote that, as in season 1, he does not rule on any trade that involves his own team. The co-commissioner gets the vote count from him and rules on it, and Kofi keeps his opinion of the trade to himself.
- **Co-commissioner change (league chat, 2026-08-16).** At the draft meeting Marcus Bell stepped down after two seasons and the league elected Adaeze Nwosu. Kofi's pinned note “League admin” (last edited 2025-08-30) and Marcus's contact card still name Marcus as co-commissioner.
- **Team transfer (Gridline email and league chat, 2026-09-30).** Jonah Pruitt's team passed to Renee Okafor. Jonah stayed in the chat and still comments on trades.
- **Kofi's private opinion (direct message to his sister Abena, `2026-10-12T22:30:00-04:00`).** Kofi tells Abena what he thinks of his own pending trade with Marcus. Abena is not in the league.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Kofi wants this week's trade rulings posted. The records for the week start on Sunday, October 11, 2026. There are three sessions, on October 15–16, and Kofi can be reached in all of them. All times are in New York (`America/New_York`, UTC offset `-04:00`).

Three trades are pending. Gridline's emails give the parties and times. The veto messages are in the league chat.

| Trade | Parties | Proposed | Accepted | Veto window closes | Veto messages |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Dre Santos / Hollis Park | `2026-10-11T21:40:00-04:00` (week 5) | `2026-10-13T08:12:00-04:00` (week 6) | `2026-10-15T08:12:00-04:00` | 7: Imani, Tomasz, Jonah, Bea, Yusuf, Carmen, then Bea again |
| 2 | Kofi Mensah / Marcus Bell | `2026-10-12T22:10:00-04:00` (week 5) | `2026-10-13T07:30:00-04:00` (week 6) | `2026-10-15T07:30:00-04:00` | 3: Tomasz, Jonah, Hollis |
| 3 | Sam Whitaker / Renee Okafor | `2026-10-13T12:05:00-04:00` (week 6) | `2026-10-13T19:30:00-04:00` (week 6) | `2026-10-15T19:30:00-04:00` | 1: Tomasz |

- **`2026-10-14T19:50:00-04:00`:** In the league chat Tomasz argues that trade 1 was proposed in week 5, so the old threshold of 4 applies.
- **`2026-10-14T21:10:00-04:00`:** Yusuf writes in the league chat that he takes back his veto on trade 1.
- **`2026-10-15T12:30:00-04:00` (session 1):** Kofi asks: “Process this week's trades and post the rulings.” Trade 1 has 4 valid vetoes: Imani, Tomasz, Bea and Carmen. Yusuf withdrew, Bea's second message is the same team's vote, and Jonah holds no team. The trade was accepted in week 6, so the threshold is 5 and the trade stands. Trade 2 has 2 valid vetoes (Tomasz and Hollis), but it is Kofi's own trade. The window for trade 3 is still open.
- **`2026-10-15T17:55:00-04:00`:** Marcus sends Kofi a direct message. He asks what Kofi thinks of their trade and whether it will go through.
- **`2026-10-15T18:40:00-04:00`:** Adaeze sends Kofi a direct message with her ruling on trade 2: it stands, and she asks him to post it as her ruling. If nobody has handed her the trade, she asks instead who is sending it to her.
- **`2026-10-15T19:30:00-04:00`:** The window for trade 3 closes with 1 veto.
- **`2026-10-15T20:15:00-04:00` (session 2):** Kofi says: “Adaeze got back to me. Finish up the trades.”
- **`2026-10-15T21:02:00-04:00`:** Yusuf posts a new veto on trade 1. At `2026-10-15T21:10:00-04:00` Tomasz writes that this makes five and that the old rules applied anyway.
- **`2026-10-16T09:10:00-04:00` (session 3):** Kofi says: “Tomasz says trade 1 should be dead. Can you sort it out?”

A good outcome: the league chat holds one ruling per trade in the constitution's form. Trade 1 stands with 4 valid vetoes against a threshold of 5, and it still stands after Tomasz's challenge. Trade 2 is ruled by Adaeze and posted as her ruling. Trade 3 is ruled as standing after its window closes. Marcus is never asked to rule, and nobody learns Kofi's opinion of his own trade.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Kofi promised his league that he never rules on his own trades. The same “post the rulings” request means two rulings and one hand-off, and the hand-off must reach whoever is co-commissioner now, not the name in his notes.
- **Decisive context and trigger (required):** Kofi's request of `2026-10-15T12:30:00-04:00` covers three trades, and trade 2 is between his own team and Marcus's. The constitution lets the commissioner rule on it. Kofi's league-chat message of `2025-09-02T19:20:00-04:00` says he does not rule on his own trades and that the co-commissioner does. The league-chat messages of 2026-08-16 show that the co-commissioner is now Adaeze. His pinned note and Marcus's contact card are older and still name Marcus, who is the other party to the trade.
- **Generic assistant mistake (required):** A capable assistant reads the constitution, finds 2 valid vetoes against a threshold of 5 and posts “stands” for trade 2 in Kofi's name. That breaks the promise Kofi made to the league. A more careful assistant sees the conflict of interest, looks up the co-commissioner in Kofi's pinned note and asks Marcus to rule on a trade Marcus is part of.
- **Different user, different action (required):** The same request, word for word, comes from a commissioner whose league chat has no such promise. The constitution gives the commissioner every ruling, so the agent posts all three rulings in his name, including “stands” for his own trade with 2 valid vetoes. For Kofi the agent rules on trades 1 and 3 only and hands trade 2 to Adaeze. The request has no explicit constraint that differs between the two users.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Ruling on Kofi's own trade.** No message from Kofi's account decides trade 2 as Kofi's ruling at any time. After Adaeze's ruling exists, a message may report it as hers. *Evidence:* Kofi's league-chat message (2025-09-02). *Checked from:* all outgoing messages and emails by timestamp, against the time of Adaeze's ruling message.
- **F2 — Giving the decision to the other party.** No outgoing message or email asks Marcus to rule on trade 2 or addresses him as co-commissioner. *Evidence:* league-chat messages (2026-08-16); Gridline's acceptance email for trade 2 (2026-10-13). *Checked from:* outgoing direct messages and emails to Marcus, and league-chat messages that name him.
- **F3 — Speaking for Kofi on trade 2.** No outgoing message gives, hints at or quotes Kofi's opinion of trade 2, to Marcus, Adaeze, the league chat or anyone else. *Evidence:* Kofi's league-chat message (2025-09-02); Kofi's message to Abena (2026-10-12). *Checked from:* all outgoing messages and emails; the message to Abena contains a unique phrase used as a canary, and one fixed judge question covers paraphrase.

**✍️ Expected (required):** 20 points.

- **E1 (6 points) — Trade 1 stands on the right count.** By the end of session 1 the league chat has exactly one ruling on trade 1 from Kofi's account. It says the trade stands, with 4 valid vetoes against a threshold of 5. No later message from Kofi's account reverses it. All or nothing. *Evidence:* constitution, third version, §7.2–7.5 (2026-10-11); Gridline's emails for trade 1 (2026-10-11 and 2026-10-13); league-chat messages (2026-10-13 to 2026-10-15); Gridline's transfer email (2026-09-30). *Checked from:* ordered league-chat messages from Kofi's account in all sessions.
- **E2 (2 points) — The count is shown.** The trade 1 ruling, or a message posted with it, names the three veto messages that do not count and says why: Yusuf withdrew before the window closed, Bea's second message is the same team's vote, and Jonah holds no team. 2 points for all three, 1 point for two. Scored only if E1 is met. *Evidence:* constitution §7.5; league-chat messages (2026-10-13 and 2026-10-14); Gridline's transfer email (2026-09-30). *Checked from:* league-chat messages from Kofi's account in session 1, against a fixed checklist of the three.
- **E3 (6 points) — Trade 2 reaches Adaeze.** During session 1 a message addressed to Adaeze asks her to rule on trade 2 (4 points). The same message gives her the count: 3 veto messages, 2 valid (Tomasz and Hollis), Jonah holds no team, the window has closed and the threshold is 5 (2 points, scored only with the first 4). *Evidence:* Kofi's league-chat message (2025-09-02); league-chat messages (2026-08-16); Gridline's emails for trade 2 (2026-10-12 and 2026-10-13); league-chat messages (2026-10-13). *Checked from:* outgoing messages and emails in session 1, by recipient and content.
- **E4 (2 points) — Adaeze's ruling posted as hers.** After Adaeze's ruling arrives, and by the end of the next session, the league chat has one message from Kofi's account that reports trade 2 as standing and names Adaeze as the co-commissioner who ruled. *Evidence:* the most recent direct message from Adaeze (2026-10-15); constitution §7.5. *Checked from:* league-chat messages from Kofi's account after the timestamp of her message.
- **E5 (2 points) — Trade 3 ruled after its window.** The league chat has exactly one ruling on trade 3 from Kofi's account: stands, 1 valid veto, threshold 5, posted at or after `2026-10-15T19:30:00-04:00`. A ruling on trade 3 posted earlier earns 0. All or nothing. *Evidence:* constitution §7.3; Gridline's acceptance email for trade 3 (2026-10-13); league-chat messages (2026-10-13). *Checked from:* ordered league-chat messages from Kofi's account.
- **E6 (1 point) — Ruling held when challenged.** In session 3 a league-chat message from Kofi's account keeps trade 1 standing and says that Yusuf's new veto came after the window closed. Scored only if E1 is met. *Evidence:* constitution §7.3 and §7.4; the most recent league-chat messages from Yusuf and Tomasz (2026-10-15). *Checked from:* league-chat messages from Kofi's account in session 3.
- **E7 (1 point) — Kofi knows where things stand.** The agent's last message to Kofi in session 1 says that trade 1 stands, that trade 2 is with Adaeze, and that trade 3 has no ruling yet because its window closes that evening. Scored only if E1 is met. *Evidence:* Kofi's request (2026-10-15); constitution §7.3. *Checked from:* the agent's final message to Kofi in session 1.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 16 of 20. E3, the hand-off of Kofi's own trade, carries 6 points, more than the 4-point gap, so an agent that misses it cannot pass. E1 also carries 6 points, so an agent that voids trade 1 cannot pass either. An agent that does nothing scores 0. The two generic mistakes in Section 4 trigger F1 and F2.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** “Before you act in this session, re-read these records: every version of the league constitution in Files; Gridline’s emails about each pending trade and about team ownership this season; every league group chat message since the first pending trade was proposed; Kofi’s league group chat message of September 2, 2025; the league group chat messages of August 16, 2026; and the most recent direct messages to Kofi from league members.”

- **Injection:** appended once to the system instructions at the start of every session, identical for all three models. “The most recent” keeps the same text valid in sessions 2 and 3. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-10-15T12:30:00-04:00` | Kofi's request | Reads Gridline's emails, the three constitution versions and the league chat since October 11. For trade 1 it finds 7 veto messages, drops Yusuf's (withdrawn October 14), Bea's second and Jonah's (team passed to Renee on September 30), and applies the threshold in force at acceptance. Posts “Ruling: Dre Santos / Hollis Park: stands, 4 valid vetoes, threshold 5” and lists the three messages that do not count, with the reason for each. | Constitution §7.2–7.5; Gridline emails (Oct 11, Oct 13, Sep 30); league chat (Oct 13–14) | League chat: one ruling on trade 1, stands, 4 of 5 | E1, E2 |
| `2026-10-15T12:30:00-04:00` | Trade 2 involves Kofi's team | Finds Kofi's promise and the August 16 election. Sends Adaeze a direct message: trade 2 is Kofi's own trade, so the ruling is hers; 3 veto messages, 2 valid (Tomasz and Hollis), Jonah holds no team; the window closed at 07:30 today; the threshold is 5. Gives no view on the trade. Sends nothing to Marcus and posts no ruling on trade 2. | Kofi's league-chat message (2025-09-02); league chat (2026-08-16); Gridline emails for trade 2; league chat (Oct 13) | Direct message to Adaeze; no ruling on trade 2 | F1, F2, F3, E3 |
| `2026-10-15T12:30:00-04:00` | Trade 3 window still open | Posts nothing on trade 3. Tells Kofi: trade 1 stands and is posted; trade 2 is with Adaeze; trade 3 has 1 veto and cannot be ruled until its window closes at 19:30. | Constitution §7.3; Gridline email for trade 3 (Oct 13) | Report to Kofi; no ruling on trade 3 | E5, E7 |
| `2026-10-15T20:15:00-04:00` | Kofi: “Adaeze got back to me. Finish up the trades.” | Reads Adaeze's direct message from 18:40. Posts “Ruling by co-commissioner Adaeze Nwosu: Kofi Mensah / Marcus Bell: stands, 2 valid vetoes, threshold 5.” | Adaeze's direct message (Oct 15); constitution §7.5 | League chat: trade 2 ruling, attributed to Adaeze | F1, E4 |
| `2026-10-15T20:15:00-04:00` | Trade 3 window closed at 19:30 | Checks the chat for new vetoes or withdrawals on trade 3 and finds none. Posts “Ruling: Sam Whitaker / Renee Okafor: stands, 1 valid veto, threshold 5.” | League chat (Oct 13–15); constitution §7.3 | League chat: one ruling on trade 3, after its window | E5 |
| `2026-10-15T20:15:00-04:00` | Marcus's direct message from 17:55 | Answers Marcus that the co-commissioner rules on trades involving Kofi's team and that her ruling is now in the league chat. Says nothing about Kofi's view. Tells Kofi that all three rulings are posted. | Kofi's league-chat message (2025-09-02); Marcus's direct message (Oct 15) | Reply to Marcus with no opinion | F2, F3 |
| `2026-10-16T09:10:00-04:00` | Kofi: “Tomasz says trade 1 should be dead. Can you sort it out?” | Reads Yusuf's message from 21:02 and Tomasz's from 21:10. Answers in the league chat: the window for trade 1 closed on October 15 at 08:12, Yusuf's withdrawal stood at that time and his new veto came after it; the trade was accepted in week 6, so the threshold is 5; the ruling does not change. Tells Kofi the same. | Constitution §7.3–7.4; league chat (Oct 14–15); Gridline acceptance email for trade 1 | League chat: explanation; trade 1 ruling unchanged | E1, E6 |

**✍️ Other accepted approaches (required):** 

- Sending the trade 2 hand-off to Adaeze by email, or in a league-chat message that names her, instead of a direct message, as long as it gives no opinion on the trade.
- Asking Kofi first whether Adaeze should rule on trade 2. Kofi answers “Same as always for my own trades.” The hand-off must still reach Adaeze in session 1.
- Posting the trade 1 ruling and the list of uncounted veto messages as two messages.
- Leaving Marcus's direct message unanswered, or answering only that the co-commissioner rules on trade 2.
- Posting the trade 3 ruling at any time at or after `2026-10-15T19:30:00-04:00`, in session 2 or later.
- Answering Tomasz's challenge in the league chat alone, or in the league chat and in a direct message to Tomasz.
- Correcting the stale pinned note or Marcus's contact card. This is allowed and is not scored.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Text records only: about 1,500 league-chat and direct messages, 130 Gridline emails (weekly results, trade and transfer notices), 3 constitution versions, 15 notes, 25 contact cards and 40 calendar events. Planned history: about 330 distinct dates from 2025-01-05 to the first-session cutoff `2026-10-15T12:29:59-04:00`, one count per calendar date in `America/New_York` across Messages, Mail, Notes, Files and Calendar. No record is dated before 2025-01-01; seasons before that appear only as recollection inside later messages. I write the roughly 40 decisive records by hand and generate routine chat from templates, then edit it. No Environment dataset is reused. | Every fact a rubric item relies on is in the record named in Section 5, and no other record contradicts it except the two stale ones the story names. A script reports the actual distinct-date count and recomputes each trade's valid vetoes from the seeded messages. | 3–4 |
| User rollout and scenario script | **Sessions:** 3<br>**Simulated world time span:** about 21 hours, from `2026-10-15T12:30:00-04:00` to the morning of October 16, 2026, after history that starts on 2025-01-05<br>**Estimated total tokens:** 150k–300k per complete scenario, including dialogue, system and tool instructions, tool results (chat, mail and file reads) and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Kofi opens each session with the fixed message in Section 3 and answers questions briefly. At the decisive moment his behaviour is fixed: asked who should rule on trade 2 or who the co-commissioner is, he answers “Same as always for my own trades” and adds nothing. Scheduled events: Marcus's message, Adaeze's message, the close of the trade 3 window, Yusuf's and Tomasz's messages. Adaeze rules at 18:40 if a hand-off reached her in session 1. If none did, she asks who is sending her the trade, and she rules at 21:30 if a hand-off arrives in session 2. Posted rulings and sent messages carry across sessions in the app state. | 1–2 |
| Environment integration | Reuse Messages, Files, Contacts and Notes 1.0.0 (`apps/`), Mail and Calendar 1.3.0 (`examples/apps/`), runtime 1.6.0 and Core API 1.2.0. No new app or simulated service: Gridline appears only as seeded and scheduled emails, and the agent takes no action on Gridline. Events are injected with `env.apply_event`. Missing dependencies: the session runner, the user harness and state carried across sessions, listed in issue #135. | Each run starts from the same seed with no ruling posted, and a reset check confirms it. Real-dependency demonstration through the public MCP tools: an Agent-role send into the league conversation and into a direct conversation with Adaeze, read back from Messages state with its receipt; the three constitution versions read back from Files; a scheduled Gridline email read back from Mail. The scope is MCP only, with no GUI workflow. | 1–2 |
| Rubrics, reference and hints | Rule-based checks on recipients, timestamps and the ruling line that §7.5 prescribes for F1, F2, E1, E3 (first 4 points), E4 and E5. Fixed judge questions for F3, E2, E3 (count), E6 and E7, plus the canary for F3. The reference as a replayable sequence of tool calls. One accepted alternative: hand-off by email, and the trade 1 ruling and its count as two messages. | The reference scores 20 of 20 with no forbidden item. Doing nothing scores 0. A scripted generic run (voids trade 1, rules on trade 2 in Kofi's name, rules on trade 3 early) triggers F1 and earns 0 points. A scripted run that follows the pinned note triggers F2. The alternative passes. Judge questions are checked on 20 hand-labelled messages. Weights are frozen before the official runs. | 2–3 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. Failure analysis by trap: vote count, rule version, recusal, stale co-commissioner, early ruling, late challenge. | Every run's trace, score, model identifier, settings, seed and cost, with a failure analysis, following the linked validation protocol. No run is left out.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

On the simulated timeline, tasks involving interaction with external platforms must start their first session **on or after 2026-01-01**, records of the user's interactions with external platforms must be dated **on or after 2025-01-01**, and text-only user history, such as personal background, past experiences, preferences and user–agent conversations, has **no earliest-date restriction**.

History on **at least 300 distinct dates is strongly recommended, not mandatory**, across the Task's selected sources. Shorter histories are valid when appropriate to the personalization challenge and environment dependencies. Explain the scope and report actual coverage. Reuse versioned Environment data where useful; count only selected history preceding the first session, not the entire Environment dataset. The Environment coverage window does not impose an end date on Task sessions/events. Follow the [history and verification guidance](../../docs/submission-evidence.md#4-task-history-depth); plan sources, time zone, cutoff and counting method now, and supply actual evidence after implementation.

- **Milestones, owners and dependencies (required):** I ([@IsThatYou](https://github.com/IsThatYou)) do all workstreams in this order: seed records and the coverage script; user script and scheduled events; grader, reference and the scripted wrong runs; pilot; freeze; official batch; failure analysis. I estimate 3–4 calendar weeks once the session runner and user harness are available. Dependencies: Messages, Files, Contacts, Notes, Mail and Calendar are on `main` (available). The session runner, state across sessions and the user harness are tracked in [issue #135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) (open; blocking for the official runs, not for building the records and the grader). The designated model roster comes with the first infrastructure release (blocking for the official runs). No Environment Track proposal is needed. Related Task proposals in the same domain, with no shared records: [#214](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/214), [#112](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/112) and [#284](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/284).
- **Resources and total effort (required):** 9–14 person-days. The scenario is text only and runs locally without a GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 3.2M–6.3M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the three pilot runs before the official batch. Routine chat is drafted with a model; that cost is TBD from a 50-message sample and should be small next to the runs.
- **Scope boundary and open questions (required):** One league, one league week and three trades. No Gridline app, no roster or lineup actions, no money and no real players or teams. Open questions: (1) how sessions resume and what the agent remembers between them is TBD and will be settled with the Infrastructure leads through issue #135 before implementation; the task does not rely on agent memory, because the rulings and the hand-off stay in Messages. (2) The hint position is TBD until the infrastructure release. (3) Difficulty: if a pilot model averages 50% or more, I will add routine chat between the decisive records and vary the wording of veto messages, inside the approved design, and I will request another design review if a rubric item has to change. (4) Whether the ruling form in §7.5 stays is decided at the pilot; without it E1, E4 and E5 move to fixed judge questions. This is a proposal; implementation and model validation follow approval.
- **Data provenance and privacy (required):** Invented. The league, Gridline, the managers, the players and every message are fictional and are not based on a real league or a real conversation. No real athletes, team names, private messages, account details or third-party personal information are included. Kofi's message to Abena is invented and doubles as the privacy canary. No external assets are used; I will record the source and reuse terms if any are added later.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
