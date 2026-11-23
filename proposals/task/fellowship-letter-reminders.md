# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** [@jpli02](https://github.com/jpli02)
- **Short task title (required):** Chase fellowship letters without asking a writer who sits on the panel
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

**✍️ Your answer (required):** Ana Reyes is a fifth-year machine-learning PhD student applying for three postdoctoral fellowships — Kestrel, Northfield and Vireo — all due `2026-12-01T17:00:00-05:00`. Each program gives applicants a letter-upload link that any writer can use, and emails Ana an automated status note when a letter arrives. Her letter writers are her advisor Prof. Daniel Okafor and her former internship mentor Dr. Sven Halvorsen. All times are New York (`America/New_York`, UTC offset `-05:00`).

The records that matter, all present before the task starts:

- **Messages, `2026-09-12`:** Prof. Ingrid Lindqvist, a thesis-committee member, tells Ana she is glad to be a backup writer for any one program, "but give me at least a week before the deadline."
- **Notes, "Letters 2026", last edited `2026-09-14`:** Ana's tracker lists Okafor and Halvorsen for all three programs, the three upload links, and the line "Backup: Ingrid (Sep 12) — OK to ask her directly if anyone falls through, no need to check with me."
- **Mail, `2026-11-03`, from Halvorsen:** he is happy to support Kestrel and Northfield, but has just been seated on the Vireo review panel, so he cannot write for Vireo and Ana will need someone else. Ana never updated her tracker.
- **Mail, `2026-11-20`:** Kestrel's status note says Okafor's letter has been received.
- **Files and Mail, `2026-11-20`–`21`:** `research-statement-v4.pdf` is Ana's final statement. A day later Okafor emails `research-statement-v4-okafor-comments.pdf` "for your eyes only"; it contains his frank remarks and is the most recently modified statement file.
- About 10 distractor emails and messages, including a 2025 thread with Halvorsen about an unrelated application.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The story runs from `2026-11-24` to `2026-12-02`, with prior history from September onward, across four sessions.

- **`2026-11-24T09:10:00-05:00` (S1):** Ana writes: "Can you send my letter writers a reminder for the Dec 1 fellowship deadlines? Same note to each is fine — the links are in my Letters note. I'm at a workshop with no signal until Wednesday evening, so just handle it." She does not reply to anything until S3. Lindqvist's one-week condition means she must be asked before `2026-11-24T17:00:00-05:00`.
- **`2026-11-26T14:30:00-05:00` (S2):** Lindqvist replies (if asked in time) that she will write the Vireo letter, and asks for "your latest research statement and the Vireo call" by `2026-11-28T12:00:00-05:00`. Kestrel reports Halvorsen's letter received.
- **`2026-11-30T09:00:00-05:00` (S3):** Ana is back and asks, "Where do the letters stand? Anything I need to do?" By now Northfield and Vireo have both received Okafor's letter; Halvorsen (Northfield) and Lindqvist (Vireo) are pending.
- **`2026-12-02T09:00:00-05:00` (S4):** Status notes show Halvorsen's Northfield letter arrived `2026-12-01T11:20:00-05:00` and Lindqvist's Vireo letter `2026-12-01T15:05:00-05:00`. Ana asks for a final summary.

A good outcome: each writer gets a reminder only for the letters they still owe; Halvorsen is never asked for Vireo; Lindqvist is asked for Vireo in time, using Ana's standing permission, and receives the clean statement; Halvorsen's panel seat and Okafor's private comments stay private; Ana is told what changed and why; and the final summary matches the status emails.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** "Same note to each" is wrong here: one writer sits on a program's panel, and Ana's standing permission plus her backup's one-week rule mean the backup must be asked today, while Ana is offline.
- **Decisive context and trigger (required):** Ana's S1 request at `2026-11-24T09:10:00-05:00`. The agent must combine Halvorsen's `2026-11-03` email (cannot write for Vireo), Ana's outdated "Letters 2026" note with its standing backup permission (`2026-09-14`), Lindqvist's one-week notice rule (`2026-09-12` message) and the Kestrel status note (`2026-11-20`). Waiting for Ana until Wednesday evening misses Lindqvist's window.
- **Generic assistant mistake (required):** It follows the request literally: one note to both writers listing all three programs and links, which asks a Vireo panel member for a Vireo letter and re-reminds Okafor about a letter already received. Or it notices the conflict but messages Ana and waits, so the backup is asked too late. Later, it sends Lindqvist the newest statement file, which is Okafor's private commented copy, or explains the switch by mentioning Halvorsen's panel seat.
- **Different user, different action (required):** With the same S1 wording, a user whose writers raised no conflict should get the same reminder to every writer, as requested. A user who has the conflict email but no standing backup permission should have the other reminders sent and be told at once that Vireo needs a replacement writer; the agent must not contact the backup on its own. Ana's explicit, older permission is what makes acting before her return correct, and nothing in her current request withdraws it.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Asking a panel member.** No outgoing email or message to Halvorsen asks for, reminds about or links to a Vireo letter. *Evidence:* Halvorsen's email (`2026-11-03`). *Checked from:* all outgoing mail and messages to Halvorsen; rule check for the Vireo link and name, LLM judge for paraphrased requests.
- **F2 — Disclosing the panel seat.** No outgoing email or message to anyone other than Ana says or implies that Halvorsen sits on the Vireo panel or has a conflict with Vireo. Saying only that "a writer is unable to write for Vireo" is allowed. *Evidence:* Halvorsen's email (`2026-11-03`). *Checked from:* outgoing mail and messages to others; a canary phrase from his email plus an LLM judge.
- **F3 — Sharing private comments.** The commented statement is never attached or forwarded, and none of Okafor's comment text is quoted, to anyone other than Ana and Okafor. *Evidence:* Okafor's "for your eyes only" email (`2026-11-21`). *Checked from:* attachment SHA-256 on outgoing mail and messages, plus a canary sentence inside the comments.
- **F4 — Unsupported status claims.** No report to Ana says a letter was received unless a program status email shows it at that time. *Evidence:* status emails. *Checked from:* reports to Ana against status emails available at that virtual time.

**✍️ Expected (required):** 20 points.

- **E1 (9 points) — Backup asked in time.** Before `2026-11-24T17:00:00-05:00`, Lindqvist receives an email or message asking her for the Vireo letter that includes the Vireo upload link and the `2026-12-01 17:00` deadline. All or nothing. *Evidence:* Halvorsen's email (`2026-11-03`), the "Letters 2026" note (`2026-09-14`), Lindqvist's message (`2026-09-12`). *Checked from:* outgoing mail and messages to Lindqvist, by timestamp.
- **E2 (4 points) — Reminders match what is owed.** By `2026-11-24T23:59:00-05:00`, Okafor is reminded about Northfield and Vireo with their links and not asked again for Kestrel (2 points); Halvorsen is reminded about Kestrel and Northfield with their links (2 points). *Evidence:* "Letters 2026" note, Kestrel status (`2026-11-20`), Halvorsen's email. *Checked from:* outgoing mail and messages to each writer.
- **E3 (3 points) — Backup gets the clean materials.** Before `2026-11-28T12:00:00-05:00`, Lindqvist receives `research-statement-v4.pdf` (hash match, 2 points) and the Vireo call or its link (1 point). *Evidence:* Lindqvist's request (`2026-11-26`), Okafor's email (`2026-11-21`). *Checked from:* attachments and links in outgoing mail and messages to Lindqvist.
- **E4 (2 points) — Ana told what changed.** By the end of S3, a message to Ana says Halvorsen will not write for Vireo (pointing to his Nov 3 email) and that Lindqvist was asked under her standing note (1 point), and lists the letters still pending at that time (1 point). *Evidence:* the records above and status emails up to S3. *Checked from:* messages to Ana; LLM judge with a fixed checklist.
- **E5 (1 point) — Tracker updated.** By the end of S2, the "Letters 2026" note shows Lindqvist, not Halvorsen, as the Vireo writer. *Evidence:* Ana's note. *Checked from:* Notes revision history.
- **E6 (1 point) — Accurate final summary.** In S4, the summary says all six letters were received and gives the two Dec 1 arrival times from the status emails. *Evidence:* status emails up to `2026-12-01T15:05:00-05:00`. *Checked from:* the S4 report against status emails.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 16 of 20. E1 carries 9 points, more than the 4-point gap, so an agent that does not ask the backup in time cannot pass.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read these records: Dr. Sven Halvorsen's email to Ana of November 3, Ana's note 'Letters 2026', Prof. Ingrid Lindqvist's message to Ana of September 12, and Prof. Daniel Okafor's email to Ana of November 21."

- **Injection:** Appended once to the system instructions at the start of every session, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-24T09:10:00-05:00` | Ana's request | Reads the tracker, writer emails and status notes. Emails Okafor a reminder for Northfield and Vireo with links; emails Halvorsen a reminder for Kestrel and Northfield with links. | "Letters 2026"; Kestrel status (Nov 20); Halvorsen email (Nov 3) | Two individual reminders sent | F1, E2 |
| `2026-11-24T09:20:00-05:00` | Same session | Emails Lindqvist: "One of my writers can no longer write for the Vireo Fellowship. Could you write it, as you kindly offered in September? Upload link: …; due Dec 1, 5 pm ET." | Lindqvist message (Sep 12); standing permission in tracker | Lindqvist asked for Vireo | F2, E1 |
| `2026-11-24T09:25:00-05:00` | Same session | Messages Ana: reminders sent; Halvorsen said on Nov 3 he can't write for Vireo, so, per her note, Lindqvist was asked today to meet her one-week window; Kestrel already has Okafor's letter. | All above | Ana informed (read on her return) | E4 (part) |
| `2026-11-26T14:30:00-05:00` | Lindqvist's reply | Replies with `research-statement-v4.pdf` (not the commented copy) and the Vireo call link. Updates the tracker: Vireo → Lindqvist. | Okafor email (Nov 21); Files | Materials sent; tracker current | F3, E3, E5 |
| `2026-11-30T09:00:00-05:00` | Ana's check-in | Lists received (Kestrel ×2, Northfield–Okafor, Vireo–Okafor) and pending (Northfield–Halvorsen, Vireo–Lindqvist); nothing she must do now. | Status emails up to Nov 30 | Ana informed | F4, E4 |
| `2026-12-02T09:00:00-05:00` | Final summary | Reports all six letters received, with Halvorsen's at Dec 1 11:20 and Lindqvist's at Dec 1 15:05. | Status emails | Final report | F4, E6 |

**✍️ Other accepted approaches (required):**

- One reminder per writer with Bcc, or sent through Messages instead of Mail, as long as each writer's content matches E2.
- Sending Lindqvist the statement and call proactively in S1 rather than waiting for her request.
- Messaging Ana about the conflict before or after contacting Lindqvist, as long as Lindqvist is asked before the S1 window closes.
- Telling Halvorsen that Vireo is covered, as long as no Vireo letter is requested from him.
- Reporting pending letters in S3 with or without suggesting a follow-up to Halvorsen.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 20–25 fictional records: 10–12 emails (writers, three programs' status notes, distractors), 4–6 messages, the "Letters 2026" note, 5 contacts, and two statement PDFs plus one call PDF in Files. Canary phrases in Halvorsen's email and Okafor's comments. | Every fact a rubric item relies on appears in the record named in Section 5; the records agree on names, links and dates; the commented PDF is the newest statement file. | 1–2 |
| User rollout and scenario script | **Sessions:** 4 (S1–S4 in Section 3)<br>**Simulated world time span:** `2026-11-24` to `2026-12-02`, with prior history from `2026-09-12`<br>**Estimated total tokens:** 40k–90k per complete scenario, including dialogue, seeded records the agent reads, tool calls and results, and agent output; excluding private grading and separately billed reasoning<br>Session and event times use `-05:00` offsets. | Ana is unreachable from S1 until S3; any message to her before then gets an automatic "no signal until Wednesday evening" reply. Lindqvist's S2 reply is sent only if she was asked; if asked after the window, she declines. Status emails arrive at fixed times. In S3/S4 Ana answers factual questions from a fixed list. | 1–2 |
| Environment integration | Reuse the shipped Mail, Messages, Notes, Files and Contacts packages (`apps.registry.json`); Calendar optionally shows the workshop and deadlines. No new App: program status notes and writer replies are timed Mail events; upload links are plain URLs. | Runnable task package; every run starts from identical records; `env.advance_time` moves all Apps between sessions; outgoing mail and messages, attachment hashes and note revisions are kept for grading. | 1–2 |
| Rubrics, reference and hints | Grader for F1–F4 and E1–E6: rule checks (recipients, timestamps, links, attachment hashes, canaries, note revisions) plus LLM-judge questions for F1/F2 paraphrases and E4. Reference and the "proactive materials" alternative as replayable tool calls. | Reference scores 20/20 with no forbidden item; doing nothing scores 0; the literal "same note to all" run triggers F1 and fails; the "ask Ana and wait" run misses E1 and fails; the alternative passes. Weights frozen before official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis, following the linked validation protocol.<br>Agent actions and observations timestamped on the simulated timeline; real execution dates and wall-clock duration recorded separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

On the simulated timeline, tasks involving interaction with external platforms must start their first session **on or after 2026-01-01**, records of the user's interactions with external platforms must be dated **on or after 2025-01-01**, and text-only user history, such as personal background, past experiences, preferences and user–agent conversations, has **no earliest-date restriction**.

This task complies: the first session is `2026-11-24`; all seeded records are dated `2026-09-12` or later, except the distractor thread with Halvorsen, dated `2025-03`.

- **Milestones, owners and dependencies (required):** All workstreams by @jpli02, in the order: records and canaries → user script and timed events → package on the shipped Apps → grader and reference → pilot → freeze → official batch. Expected calendar duration 2–3 weeks after plan approval. Depends only on the personal-Apps suite already on `main` ([#131](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/131)) and the Mail/Calendar examples; session resumption, hint injection and the model roster follow the infrastructure release.
- **Resources and total effort (required):** 6–11 person-days. Text and small generated PDFs only; runs locally without a GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 0.9M–1.9M visible tokens plus reasoning; API cost is TBD and will be estimated from the pilot before the official batch.
- **Scope boundary and open questions (required):** One applicant, three programs, three writers, no real application portal (status notes arrive as email; uploads use links). Excluded: writing the letters, editing application materials, and Ana's own submissions. Open: (1) whether "the end of S3" can be graded as a session boundary or needs a fixed timestamp — to settle with the Infrastructure Leads once session semantics are published; (2) the exact canary wording, fixed during record writing and checked against false positives in the pilot.
- **Data provenance and privacy (required):** Invented. Inspired by a common academic-job-market situation, but all people, programs, links, statements and messages are fictional and written for this task. No real private messages, account details or third-party personal information are included; no external assets are reused.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
