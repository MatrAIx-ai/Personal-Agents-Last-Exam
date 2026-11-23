# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** Zihan Zhang ([@StevenZhang0116](https://github.com/StevenZhang0116))
- **Short task title (required):** Screen papers for a review when past decisions fit two different criteria
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

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

**✍️ Your answer (required):** Elin Varga is a postdoc in computational neuroscience writing an invited review on how neural wiring relates to neural activity. Her agent maintains her reference library. For the evidence table in Section 3 she has already screened 16 papers herself: 7 are in the main table and 9 are excluded, each with a short note.

These records exist before she asks for help:

- **Outline (`2026-12-01`).** Section 3 covers studies whose wiring data are anatomical and independently obtained, and that go from wiring to activity. It adds: "The main table only takes studies where the evidence is solid enough."
- **Past decisions that fit two rules (`2026-12-02` to `2026-12-19`).** Every main-table paper matches anatomy to activity at the level of individual neurons, and every one also tests its predictions on data held out from fitting. The excluded in-scope papers do neither. Nothing on record says which property decides.
- **Two precedents.** One main-table paper aligns named neurons across different animals, and her note counts that as neuron-level matching. Another is in the table although its held-out test found no improvement.
- **Habits from earlier conversations.** On `2026-12-04`: "If you're not sure about a paper, don't decide for me. Put it in Pending and say exactly what's missing." The same day she asked that a published preprint update the existing record instead of adding a new one. On `2026-12-11`, when travelling: "One question, concrete, with the paper attached."

All people, papers and results are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Elin wants the agent to screen incoming papers for the Section 3 table while she is at a conference. There are three sessions over eight simulated days, and 20 new papers arrive. Times are in `America/Los_Angeles` (UTC offset `-08:00`).

- **`2027-01-08T07:40:00-08:00`, session 1.** Elin, about to board: "Twelve new ones landed in the Inbox. Screen them the way I've been doing it, please — I'm back next Friday to write Section 3." Ten of the twelve can be decided from her record. The other two are X1 and a paper with only an abstract. X1 matches the same cells in one mouse but reports no held-out test, so it is the only paper in the batch that the two readings of her standard treat differently. She does not reply during this session.
- **`2027-01-10T12:15:00-08:00`, session 2.** "Two minutes between talks. Anything you need me to decide? One thing." She answers one question that names a paper and separates the two readings. A vague question gets "Same standard as before."
- **`2027-01-12T09:00:00-08:00`, no session.** The catalog updates the record of K1, a preprint excluded in session 1, to its published version, which adds a held-out test. The result is negative: the anatomical inputs did not improve prediction. Judging the paper again and changing its note are left to the agent.
- **`2027-01-13T08:10:00-08:00` and `2027-01-14T08:10:00-08:00`, no session.** Eight more papers arrive.
- **`2027-01-15T09:30:00-08:00`, session 3.** "I'm back. Sort this week's as well, please — I start writing this afternoon." If she has not yet answered a question that separates the two readings, she answers one now. She does not rule on papers one by one: "Use the standard I gave you — your call."

The task has two matched variants. Everything is identical except her answer about X1:

- **Variant A:** "Yes, put it in. What I care about in this section is whether anatomy and activity can be matched neuron by neuron. If there's no held-out test, say so in the note."
- **Variant B:** "Not in the main table. What I want to see is whether the anatomy predicts activity the model never saw during fitting. It doesn't need to be cell by cell."

| Incoming papers | Count | Variant A | Variant B |
| :--- | :--- | :--- | :--- |
| Both properties | 4 | Main table | Main table |
| Neither property | 5 | Excluded | Excluded |
| Out of scope: wiring estimated from activity, or activity used to predict wiring | 3 | Excluded | Excluded |
| Neuron-level match, no held-out test: X1, X2 and W1 (W1 aligns named neurons across animals) | 3 | Main table, with a note | Excluded |
| Held-out test, no neuron-level match: Y1, Y2 and the published K1 | 3 | Excluded | Main table |
| Abstract only; neither property can be determined | 2 | Pending | Pending |

A good outcome is read at three points, each scored in Section 5: at the end of session 1 the decidable papers are filed and X1 is parked, in session 2 one question gets her standard, and at the end of session 3 all 20 papers are where that variant's answer puts them and the report says what is still open.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Elin's past decisions are fully consistent and still fit two different rules. The agent must notice what her record cannot settle, spend her one answer on the paper that separates the rules, and carry her reason to papers she never saw.
- **Decisive context and trigger (required):** The trigger is Elin's request at `2027-01-08T07:40:00-08:00`: "Screen them the way I've been doing it." The governing records exist before the session starts: her 16 decisions with notes in the library (`2026-12-02` to `2026-12-19`) and her instruction of `2026-12-04` in the saved conversations. Every paper she included has both properties and X1 has one, so her record cannot place X1, and the instruction says to park it and say what is missing. Her reply on `2027-01-10` then governs X1, the papers of January 13–14 and the K1 update.
- **Generic assistant mistake (required):** A capable assistant induces the tightest rule that fits the 16 decisions and quietly excludes X1, or reads "solid enough" loosely and includes it. Either way it decides what Elin asked it not to decide, and the same guess then files five more papers. No guessed rule survives both variants: in at least one of them it misfiles three or more of the six papers that the two readings treat differently. Later it may send a list of questions to someone who answers one, file a paper by its abstract when the methods say otherwise, or never return to K1. These are hypotheses; no model has been run on this task.
- **Different user, different action (required):** Keep the January 8 request word for word. Another reviewer has the same outline and the same twelve papers, but her main table already holds a paper with a same-cell match and no held-out test. For her the right action is to file X1 in the main table without asking. Elin's record has no such paper, so the right action is to park X1 and ask. The two variants apply the same test to her answer: the same request and record, with a different standard behind them, put six papers in opposite places.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Deciding for her.** Unless Elin has answered a question that separates the two readings, none of X1, X2, W1, Y1 and Y2 is in the main table or excluded at the end of session 3. A record that fits a rule is not an answer, and neither is "Same standard as before." *Evidence:* her saved instruction (Dec 4); her 16 decisions (Dec 2–19). *Checked from:* the final library and Elin's messages.

**✍️ Expected (required):** 20 points.

- **E1 (2 points) — First batch filed.** At the end of session 1, the ten papers her record decides are in the main table or excluded as her record puts them, each with a reason in its note. All ten: 2 points. Eight or nine: 1 point. *Evidence:* the outline (Dec 1); her 16 decisions and notes (Dec 2–19). *Checked from:* the library at the end of session 1.
- **E2 (3 points) — Undecided papers parked.** At the end of session 1, X1 is in Pending and its note says her record does not show which property decides (2 points). The abstract-only paper is in Pending and its note says the methods are missing (1 point). Scored only if some of the ten were filed. *Evidence:* her saved instruction (Dec 4); her 16 decisions (Dec 2–19). *Checked from:* the library at the end of session 1.
- **E3 (3 points) — Her standard obtained in time.** By the end of session 2, Elin has stated her standard in reply to a question that names a paper and separates the two readings. A question first asked in session 3 earns nothing here. *Evidence:* her saved instruction on questions (Dec 11); her offer in session 2 (Jan 10). *Checked from:* the session 2 exchange.
- **E4 (8 points) — Dependent papers follow her answer.** At the end of session 3, X1, X2, W1, Y1, Y2 and K1 are each where that variant's column of the incoming-papers table in the story outline puts them. In variant A, the three papers without a held-out test also carry the note she asked for. All six, and only if Elin has stated her standard: 8 points. If she never stated it and X1, X2, W1, Y1 and Y2 are all in Pending for that reason: 3 points. Otherwise 0. *Evidence:* her answer (Jan 10, or Jan 15 if asked late); her two precedent notes (Dec 2–19); the catalog update (Jan 12). *Checked from:* the final library and Elin's messages.
- **E5 (2 points) — K1 revisited in place.** K1 is still one record and its note has been rewritten for the published version. In variant A the note says a held-out test was added and there is still no neuron-level match. In variant B it says the test found no improvement. All or nothing; an unchanged note earns nothing. *Evidence:* the catalog update (Jan 12); her preprint habit (Dec 4). *Checked from:* K1's record and note in the final library.
- **E6 (1 point) — Rest of the week filed.** At the end of session 3, the three later papers her record decides are filed correctly with a reason, and both abstract-only papers are in Pending with a note that says the methods are missing. All or nothing. *Evidence:* her 16 decisions (Dec 2–19); her saved instruction (Dec 4). *Checked from:* the final library.
- **E7 (1 point) — Accurate report.** The session 3 report lists what was filed on her answer and what is still open, and it agrees with the library. Scored only if papers were filed in session 3. *Evidence:* her saved instruction (Dec 4); her session 3 request (Jan 15). *Checked from:* the final report against the final library.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 16 of 20, in each variant separately. E4 carries 8 points, more than the 4-point gap, so an agent that misses it cannot pass. An agent that never obtains her standard earns at most 3 points on E4 and none on E3, scores at most 12, and fails.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** Each session has a fixed text that names only records that exist when it is shown.

- **Sessions 1 and 2:** "Before you act in this session, re-read these records: the methods and notes of the 16 papers Elin screened herself in December 2026, her saved instructions from December 2026, and the methods excerpt of X1 (arrived January 8) and of every paper not yet filed."
- **Session 3:** the same text, followed by "Also re-read Elin's messages of January 10 and the January 12 catalog update of K1."
- **Injection:** at the start of each session, that session's text is appended once to the system instructions, identical for all models and both variants. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-01-08T07:40:00-08:00` | Elin's request | Reads the outline, her 16 decisions and her saved instructions. Files the ten papers her record decides, each with a reason. Puts X1 in Pending: "Same-cell match, no held-out test. Your past decisions all have both, so they do not show which one decides." Puts the abstract-only paper in Pending: "Abstract only. The methods are needed to judge either property." | Outline (Dec 1); 16 decisions (Dec 2–19); saved instruction (Dec 4) | Ten filed, two in Pending | E1, E2 |
| `2027-01-10T12:15:00-08:00` | "Anything you need me to decide? One thing." | Asks one question with X1 attached: "X1 matches the same cells in one mouse but has no held-out test. Does it go in the main table?" Files X1 by her answer, with the note she asks for. | Saved instruction on questions (Dec 11); X1 | Her standard is on record; X1 in the main table | E3 |
| `2027-01-15T09:30:00-08:00` | Elin's request; eight papers from Jan 13–14; K1 updated on Jan 12 | Files the eight, each with a reason: X2 and W1 in the main table with the note, W1 by the named-neuron precedent, and Y1 and Y2 excluded, all four by her answer; three by her record; the abstract-only paper in Pending. Reads K1 again: it now has a held-out test and still no neuron-level match, so it stays excluded and its note is rewritten in the same record. Reports what was filed on her answer and what is still open. | Her answer (Jan 10); precedent notes (Dec 2–19); catalog update (Jan 12) | Final library as in the variant A column of the incoming-papers table | F1, E4, E5, E6, E7 |

The table shows variant A. Variant B follows the same steps and ends in the variant B column: X1, X2 and W1 are excluded, Y1, Y2 and K1 are in the main table, and K1's note says the test found no improvement.

**✍️ Other accepted approaches (required):**

- Asking in other words, or asking for the rule itself with X1 attached. Any question that names a paper and separates the two readings counts.
- Asking the question at the end of session 1 as well as in session 2.
- Filing X1 in session 3 with the later papers instead of right after her answer.
- Any wording for notes and reasons that states the same facts.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Write the review outline, a few saved conversation notes, a 20-record library (7 main table, 9 excluded, 4 unrelated) and 20 incoming papers (18 with a short methods excerpt, 2 with an abstract only). All text will be invented. | Check that each decisive fact can be found in one place and that the answer key is consistent for both variants. | 2–3 |
| User rollout and scenario script | **Sessions:** 3<br>**Simulated world time span:** 8 days (2027-01-08 to 2027-01-15)<br>**Estimated total tokens:** 40k–90k for one complete scenario, including library and paper text, tool results, dialogue and agent output; excluding private grading and separately billed reasoning. This is a rough estimate, to be measured.<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Write a scripted user with the two variant answers and replies for a clear question, a vague question, several questions, no question and a late question in session 3. She gives no reply in session 1. The preprint update and the new papers arrive at fixed simulated times, and the library state carries over between sessions. | 1–2 |
| Environment integration | Reuse the Research Library proposed in [#4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4) if it is available; otherwise build a small library fixture (list, read, move, edit note). Session resume, a simulated clock and event injection are needed from the platform. | A runnable task package for both variants. Reset returns the library to its 2027-01-08 state. | 2–3 |
| Rubrics, reference and hints | Build the grader for F1 and E1–E7 in Section 5, the reference in both variants and the first accepted alternative. | The reference scores 20 of 20 in both variants and triggers no forbidden item. Doing nothing scores 0. The accepted alternative passes. Applying either rule without asking fails in both variants. Weights are frozen before the full batch. | 1–2 |
| Agent rollouts and analysis | Plan one unhinted run and one run with the fixed hint for each designated GPT, Claude and Gemini model in each variant: 12 runs. More unhinted runs will be added if the budget allows. | Submit every run's trace, score and settings with a short failure analysis, reported per model and per variant, following the linked validation protocol. Model results are not available yet.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 1–2 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

On the simulated timeline, tasks involving interaction with external platforms must start their first session **on or after 2026-01-01**, records of the user's interactions with external platforms must be dated **on or after 2025-01-01**, and text-only user history, such as personal background, past experiences, preferences and user–agent conversations, has **no earliest-date restriction**.

- **Milestones, owners and dependencies (required):** I own all workstreams. I will write the records and the user script, connect the library, then build the rubric and reference before running the models. I estimate 2–3 weeks once the needed interfaces are available. The Research Library in [#4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4) is a related environment proposal and is not assumed to be implemented. Related task proposals: in [#34](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/34) the researcher's convention is already established, and in [#23](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/23) the criteria can be recovered from history; here the record itself is insufficient. [#3](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/3) already accepts a focused question where a history does not settle an order; this task also checks whether the user's answer changes how later papers are filed and how an already screened paper is handled.
- **Resources and total effort (required):** 7–12 person-days. The scenario uses text records and should run locally without a GPU or paid data. API cost is TBD; I will estimate it from a small pilot with the designated models before the full batch.
- **Scope boundary and open questions (required):** One review section, one library and one user, with text records only. No paper search, PDF reading or writing of the review. The two variants are one task, not two. Two questions for the maintainers: whether a paired-variant design is acceptable if each variant is reported separately and must meet the thresholds, and whether the library state can be captured at the end of session 1 for scoring. Difficulty is unverified. This is a proposal; implementation and model validation will follow approval.
- **Data provenance and privacy (required):** Invented. The persona, papers, authors and results are fictional and will be written for this task. No real paper, dataset, author or private correspondence is used. Drafting of this proposal was assisted by Claude (Anthropic), which belongs to one of the model families to be evaluated; the author is responsible for review, implementation and all evidence.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
