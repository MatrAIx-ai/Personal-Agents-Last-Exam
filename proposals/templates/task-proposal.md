# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

## 1. Task and domains

- **Authors / GitHub handles (required):** `[Fill in: names and @handles]`
- **Short task title (required):** `[Fill in: a concise task title]`
- **Primary domain (required):** `[Fill in: one domain from the table below]`
- **Secondary domains (optional):** `[Fill in: other relevant domains, or None]`

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

**✍️ Your answer (required):** `[Fill in: user persona and relevant history]`

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** `[Fill in: the story outline]`

## 4. What makes this distinct and personal

How does this person's context change the right action, and what might a generic assistant miss?

**✍️ Your answer (required):** `[Fill in: the central personalization challenge or insight]`

## 5. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | `[Fill in: context, records/media to create or reuse, quantities and sources]` | `[Fill in: coherent user context and discoverable evidence for the personalization insight]` | `[Fill in: estimate]` |
| User rollout and scenario script | **Sessions:** `[Fill in: number of sessions]`<br>**Simulated world time span:** `[Fill in: hours, days, months or years covered]`<br>**Estimated total tokens:** `[Fill in: range or order of magnitude across all sessions]` | `[Fill in: executable user script, response/no-reply paths, changes over simulated time and state carried across sessions]` | `[Fill in: estimate]` |
| Environment integration | `[Fill in: apps/environments to reuse or build, fixtures, actions and missing dependencies]` | `[Fill in: runnable task package and initial-state/reset checks]` | `[Fill in: estimate]` |
| Rubrics, reference and hints | `[Fill in: intended success criteria, key constraints, reference approach and hint design]` | `[Fill in: grading checks for success, partial/incorrect actions and reference feasibility]` | `[Fill in: estimate]` |
| Agent rollouts and analysis | `[Fill in: planned runs per designated GPT, Claude and Gemini model, hinted runs and analysis work]` | `[Fill in: traces, scores and failure analysis meeting the linked validation protocol]` | `[Fill in: estimate]` |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** `[Fill in: work order, responsible contributors, expected calendar duration and environment/infra dependencies; link related PRs]`
- **Resources and total effort (required):** `[Fill in: total person-days, estimated model/API and generation costs, and compute needs; estimates or explained TBDs]`
- **Scope boundary and open questions (required):** `[Fill in: what is excluded or deferred, and how unresolved decisions will be settled]`
- **Data provenance and privacy (required):** `[Fill in: invented, or transformed from a real experience; sources and reuse terms of any collected material; confirm that private messages, account details and third-party personal information are removed]`

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
