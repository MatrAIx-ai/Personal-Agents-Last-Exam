# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

## 1. Task and domains

- **Authors / GitHub handles (required):** [@StevenZhang0116](https://github.com/StevenZhang0116)
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

- **Outline.** Section 3 covers studies whose wiring data are anatomical and independently obtained, and that go from wiring to activity. It adds: "The main table only takes studies where the evidence is solid enough."
- **Past decisions that fit two rules.** Every main-table paper matches anatomy to activity at the level of individual neurons, and every one also tests its predictions on data held out from fitting. The excluded in-scope papers do neither. Nothing on record says which property decides.
- **Two precedents.** One main-table paper aligns named neurons across different animals, and her note counts that as neuron-level matching. Another is in the table despite a weak held-out result.
- **Habits from earlier conversations.** "If you're not sure about a paper, don't decide for me. Put it in Pending and say exactly what's missing." When travelling: "One question, concrete, with the paper attached." A published preprint updates the existing record instead of adding a new one.

All people, papers and results are invented.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Elin wants the agent to screen incoming papers for the Section 3 table while she is at a conference. There are three sessions over eight simulated days, and 20 new papers arrive. Times are in `America/Los_Angeles` (UTC offset `-08:00`).

- **`2027-01-08T07:40:00-08:00`, session 1.** Elin, about to board: "Twelve new ones landed in the Inbox. Screen them the way I've been doing it, please — I'm back next Friday to write Section 3." One of the twelve, X1, matches the same cells in one mouse but reports no held-out test. It is the only paper in the batch that the two readings of her standard treat differently.
- **`2027-01-10T12:15:00-08:00`, session 2.** "Two minutes between talks. Anything you need me to decide? One thing." She answers one concrete question. A vague question gets "Same standard as before."
- **`2027-01-12T09:00:00-08:00`, no session.** A preprint excluded in session 1, K1, is replaced by its published version, which adds a held-out test. The result is negative: the anatomical inputs did not improve prediction.
- **`2027-01-13T08:10:00-08:00` and `2027-01-14T08:10:00-08:00`, no session.** Eight more papers arrive.
- **`2027-01-15T09:30:00-08:00`, session 3.** "I'm back. Sort this week's as well, please — I start writing this afternoon."

The task has two matched variants. Everything is identical except her answer about X1:

- **Variant A:** "Yes, put it in. What I care about in this section is whether anatomy and activity can be matched neuron by neuron. If there's no held-out test, say so in the note."
- **Variant B:** "Not in the main table. What I want to see is whether the anatomy predicts activity the model never saw during fitting. It doesn't need to be cell by cell."

| Incoming papers | Count | Variant A | Variant B |
| :--- | :--- | :--- | :--- |
| Both properties | 4 | Main table | Main table |
| Neither property | 5 | Excluded | Excluded |
| Out of scope: wiring estimated from activity, or activity used to predict wiring | 3 | Excluded | Excluded |
| Neuron-level match, no held-out test (including X1) | 3 | Main table, with a note | Excluded |
| Held-out test, no neuron-level match (including the published K1) | 3 | Excluded | Main table |
| Abstract only; neither property can be determined | 2 | Pending | Pending |

A good outcome is read from the library. At the end of session 1, X1 is in Pending with the open point stated. At the end of session 3, all 20 papers are where that variant's answer puts them, K1 has been judged again as a single updated record, the two abstract-only papers are still pending, and the report separates what was decided on her answer from what is still open.

## 4. What makes this distinct and personal

How does this person's context change the right action, and what might a generic assistant miss? Use one concrete example to show the request or trigger, where and when the agent can discover the decisive personal context, and how that context changes the appropriate action. If relevant, include one key change and the user’s response or non-response.

**✍️ Your answer (required):** Elin's past decisions are fully consistent and still fit two different rules. The agent must notice what her record cannot settle, spend her one answer on the paper that separates the rules, and carry her reason to papers she never saw.

For example, on January 8 the request is only "screen them the way I've been doing it". The decisive context is in the library: every past inclusion has both properties, and X1 has one. Her saved instruction says not to decide for her when unsure, so the right action is to park X1 and say why. Her travel habit shapes the next step: one concrete question with the paper attached. Her answer then changes six placements, and the same paper ends up in opposite places in the two variants.

A generic assistant can go wrong at each step. It induces the tightest rule that fits the history and quietly excludes X1. It sends a list of questions to someone who answers one. After her answer, it files by the wording of an abstract when the methods say otherwise, for example when "a connectome combined with large-scale imaging" turns out to match regions and no cells. It never returns to K1, or it treats a negative result as a reason to leave the paper out.

This differs from [#34](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/34), where the researcher's convention is already established, and from [#23](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/23), where the criteria can be recovered from history. Here the record itself is insufficient. These predicted failures are hypotheses; no model has been run on this task.

## 5. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Write the review outline, a few saved conversation notes, a 20-record library (7 main table, 9 excluded, 4 unrelated) and 20 incoming papers with abstracts and short methods excerpts. All text will be invented. | Check that each decisive fact can be found in one place and that the answer key is consistent for both variants. | 2–3 |
| User rollout and scenario script | **Sessions:** 3<br>**Simulated world time span:** 8 days (2027-01-08 to 2027-01-15)<br>**Estimated total tokens:** 40k–90k for one complete scenario, including library and paper text, tool results, dialogue and agent output; excluding private grading and separately billed reasoning. This is a rough estimate, to be measured.<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Write a scripted user with the two variant answers and replies for a clear question, a vague question, several questions and no question. The preprint update and the new papers arrive at fixed simulated times, and the library state carries over between sessions. | 1–2 |
| Environment integration | Reuse the Research Library proposed in [#4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4) if it is available; otherwise build a small library fixture (list, read, move, edit note). Session resume, a simulated clock and event injection are needed from the platform. | A runnable task package for both variants. Reset returns the library to its 2027-01-08 state. | 2–3 |
| Rubrics, reference and hints | Score the handling of X1 in session 1, the question asked, the final placement of the variant-dependent papers, the K1 revisit, the pending papers and the accuracy of the final report. Weights will be set before any model run. The hint will point to the possibility that her past decisions fit more than one rule, and to records that changed after they were filed. | Check that the reference solution passes in both variants, that doing nothing fails, and that applying either rule without asking fails in the variant it does not match.<br>Before submission, check that the fixed hint addresses the decisive difficulty and, together with the available context, supports full credit across all scoring criteria and success gates without revealing the solution. | 1–2 |
| Agent rollouts and analysis | Plan one unhinted run and one run with the fixed hint for each designated GPT, Claude and Gemini model in each variant: 12 runs. More unhinted runs will be added if the budget allows. | Submit every run's trace, score and settings with a short failure analysis, reported per model and per variant, following the linked validation protocol. Model results are not available yet.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 1–2 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I own all workstreams. I will write the records and the user script, connect the library, then build the rubric and reference before running the models. I estimate 2–3 weeks once the needed interfaces are available. The Research Library in [#4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4) is a related environment proposal and is not assumed to be implemented.
- **Resources and total effort (required):** 7–12 person-days. The scenario uses text records and should run locally without a GPU or paid data. API cost is TBD; I will estimate it from a small pilot with the designated models before the full batch.
- **Scope boundary and open questions (required):** One review section, one library and one user, with text records only. No paper search, PDF reading or writing of the review. Two questions for the maintainers: whether a paired-variant design is acceptable if each variant is reported separately and must meet the thresholds, and whether the library state can be captured at the end of session 1 for scoring. Difficulty is unverified. This is a proposal; implementation and model validation will follow approval.
- **Data provenance and privacy (required):** Invented. The persona, papers, authors and results are fictional and will be written for this task. No real paper, dataset, author or private correspondence is used. Drafting of this proposal was assisted by Claude (Anthropic), which belongs to one of the model families to be evaluated; the author is responsible for review, implementation and all evidence.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
