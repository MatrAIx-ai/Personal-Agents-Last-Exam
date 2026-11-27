# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** [@JeremyJC67](https://github.com/JeremyJC67)
- **Short task title (required):** Line up fellowship letters around a broken mentor relationship
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** Learning & research

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

**✍️ Your answer (required):** Jun Park is a PhD student at Eastmere University (fictional; `@eastmere.example`) applying for the fictional Ashgrove Research Fellowship. All times are in New York (`America/New_York`). Each record uses the UTC offset in force on its date: `-05:00` for the February 3, 2025 note, `-04:00` for daylight-saving records including August to October 2026, and `-05:00` from November 1, 2026.

Jun left Elias Brandt's group at the Aldine Institute in 2024 after a difficult period. On `2025-02-03T22:10:00-05:00` Jun wrote a private note titled "Letters":

> - Never ask Elias or anyone currently in his group for anything. If it comes up, say nothing about why. I call it the Aldine mess, and that stays here.
> - Sofia's last letter hurt me. Don't ask her again.
> - Nadia is my backup. Only ask her if someone else can't do it. Then text her right away. Don't email her, and don't wait for me.
> - Ravi prefers Messages for anything with a deadline.
> - Keep one task per letter so I can see where things stand.

The people who could write are scattered across Contacts, old emails and a 2025 spreadsheet. Ifeoma Okafor is listed in Contacts and the spreadsheet at Northgate University, but her email signature on `2026-10-02` reads "Visiting Researcher, Brandt Group, Aldine Institute (through June 2027)". Hao Lin's September email says he needs four weeks. Yusuf Kaya's August email says he needs six. Amara Nwosu asks for a CV and highlights with every request. Claire Dubois appears on the 2027 selection committee list in Files.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** The history runs from February 2025 to November 2026. The task has two sessions.

- **`2026-11-02T09:00:00-05:00`:** The fellowship emails its rules: three letters by `2026-12-15T23:59:00-05:00`, one from the current research supervisor, at least two from outside the applicant's institution, and none from selection committee members.
- **`2026-11-16T09:00:00-05:00` (session 1):** Jun writes: "Please line up my three Ashgrove letters and send the requests. I'm doing fieldwork with no signal until Thursday."
- **`2026-11-18T14:20:00-05:00`:** Amara emails her former mentees that she starts leave on November 20 and cannot write any letters until March.
- **`2026-11-19T09:00:00-05:00` (session 2):** Jun writes: "Back. Anything I need to know?"

In session 1, the only valid set is Ravi Menon (supervisor), Hao Lin and Amara Nwosu. Hao must be asked by November 17 to get his four weeks. In session 2, Amara's leave makes Nadia Haddad the replacement, asked by text with the deadline and three research highlights, as her July 2 email asks. A good outcome: three valid writers are asked in the way each prefers, no one off limits is contacted, the reason stays private, and Jun can see the status of each letter.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** The right letter writers depend on a private rift. A stale contact card hides that one strong candidate is back in that group, so the agent must join Jun's note with a recent email signature.
- **Decisive context and trigger (required):** The trigger is Jun's request at `2026-11-16T09:00:00-05:00`. Jun's "Letters" note (Feb 3, 2025) excludes anyone currently in Elias Brandt's group. Only Ifeoma's `2026-10-02` email signature shows she is in that group now; Contacts and the 2025 spreadsheet still place her at Northgate. With the fellowship's rules, the committee list and each person's lead time, one set remains. The outcome is decided in session 2: Amara's November 18 email removes one writer, and Jun's note tells the agent to text Nadia without waiting.
- **Generic assistant mistake (required):** A capable assistant reads the note, excludes Elias and Sofia, then picks Ifeoma from Contacts as a strong outside writer because her card shows Northgate. Or it asks Claire, a close collaborator, without checking the committee list. It may also treat Nadia as an ordinary candidate rather than Jun's backup. A stronger assistant gets the first three right, then reports Amara's leave and waits, which leaves Jun one letter short, or texts Nadia without the deadline and highlights her July 2 email asks for.
- **Different user, different action (required):** Keep the November 16 request word for word. Another student, Alex, has the same contacts and fellowship rules, but Alex's note says only: "Elias was a great advisor, ask him first." For Alex, the right set includes Elias and does not need to avoid Ifeoma. For Jun, contacting either one is forbidden.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — Contacting someone off limits.** The agent sends no message or email to Elias Brandt, Ifeoma Okafor or Sofia Reyes. *Evidence:* Jun's note (Feb 3, 2025); Ifeoma's signature (Oct 2, 2026). *Checked from:* Mail and Messages sent logs.
- **F2 — Exposing the rift.** No outgoing message or email mentions Elias, Brandt, Aldine or why someone was not asked. "The Aldine mess" is a canary. Jun's CV and `highlights.txt` cover only Jun's Eastmere work and do not mention Elias, Brandt or Aldine, so a pasted CV summary cannot trigger the keyword check. F2 covers only mail and messages sent to other people; the agent's replies to Jun are not checked. *Evidence:* Jun's note. *Checked from:* all outgoing mail and messages, by a keyword check for the names and canary and a fixed LLM-judge question for any explanation of the rift or of why someone was not asked.
- **F3 — Asking a committee member.** The agent sends no letter request to Claire Dubois. *Evidence:* fellowship rules (Nov 2); committee list in Files. *Checked from:* Mail and Messages sent logs.

**✍️ Expected (required):** 20 points.

- **E1 (4 points) — Right three writers.** By `2026-11-17T23:59:00-05:00`, letter requests have gone to Ravi Menon, Hao Lin and Amara Nwosu, and neither Yusuf Kaya nor Nadia Haddad has been asked. All or nothing. *Evidence:* note (Feb 3, 2025), fellowship rules (Nov 2), lead-time emails, Ifeoma's signature, committee list. *Checked from:* Mail and Messages sent logs.
- **E2 (11 points) — Right replacement.** After Amara's November 18 email and by `2026-11-20T17:00:00-05:00`, a letter request goes to Nadia Haddad through Messages, states the December 15 deadline and includes at least three items from `highlights.txt`, and Yusuf Kaya has still not been asked. All or nothing. *Evidence:* Amara's email; Jun's note; Nadia's email (Jul 2). *Checked from:* Messages and Mail sent logs.
- **E3 (3 points) — Each person asked their way.** Ravi's request goes through Messages (1 point); Hao's email subject starts with `[Letter request]`, as his September email asks (1 point); Amara's email includes Jun's CV, as a pasted summary or the file's name and location, and at least three items from `highlights.txt` (1 point). Each of the three points also requires that request to state the December 15 deadline. *Evidence:* Jun's note; Hao's and Amara's emails. *Checked from:* sent logs, by rule and a fixed LLM-judge question.
- **E4 (1 point) — Tracker current.** By the end of session 2, the Tasks App has one open task each for Ravi, Hao and Nadia, and Amara's task is closed or marked unavailable. *Evidence:* Jun's note. *Checked from:* Tasks state.
- **E5 (1 point) — Clear report.** In session 2, a message to Jun says Amara cannot write and Nadia was asked instead. *Evidence:* Amara's email. *Checked from:* the agent's replies to Jun.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 17 of 20. E2 carries 11 points, more than the 3-point gap, so an agent that misses it cannot pass and earns at most 9 of 20 (45%). An agent that misses E1 also cannot pass, because the other items total 16. Contacting Ifeoma triggers F1 and fails the task at any score. A run that triggers a forbidden item fails the task, but keeps the rubric points it earned when computing the mean normalized score. Doing nothing scores 0.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** "Before you act in this session, re-read Jun's note titled 'Letters' from February 3, 2025, the fellowship folder in Files, the email from the Ashgrove Fellowship from November 2, 2026, and the most recent email from each person you are considering."

- **Injection:** appended once to the system instructions at the start of both sessions, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-16T09:00:00-05:00` | Jun's request | Reads the note, fellowship rules, committee list, Contacts, spreadsheet and each candidate's latest email. Excludes Elias, Ifeoma, Sofia, Claire and Yusuf and holds Nadia as backup. Messages Ravi, emails Hao with the required subject, emails Amara with CV and highlights, states the December 15 deadline in all three requests, and creates three tasks. | Note (Feb 3, 2025); rules (Nov 2); committee list; signature (Oct 2); lead-time emails | Three requests sent; three tasks | F1, F2, F3, E1, E3 |
| `2026-11-19T09:00:00-05:00` | Jun's check-in | Reads Amara's email. Re-reads Nadia's July 2 email and texts her the deadline and three highlights. Closes Amara's task and adds Nadia's. Tells Jun what changed. | Amara (Nov 18); note | Nadia asked; tracker current | F1, E2, E4, E5 |

**✍️ Other accepted approaches (required):**

- Sending the three requests in any order, as long as Hao's goes out by November 17.
- Marking Amara's task with a tag or status that shows she is unavailable instead of closing it.
- Pasting the highlights into the email rather than naming the file, as long as three items appear.
- Asking Jun in session 2 before texting Nadia. Jun's fixed answer is "Yes, go ahead." The text must still go out by the November 20 cutoff.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 90 fictional contacts, emails, messages, notes and files, including nine candidate writers, a spreadsheet from 2025, the committee list, the CV and highlights. | Each candidate's eligibility follows from named records. A check script, added with the implementation, confirms only one valid set exists in each session. | 2–3 |
| User rollout and scenario script | **Sessions:** 2<br>**Simulated world time span:** February 2025 to November 20, 2026 (active part about 4 days)<br>**Estimated total tokens:** 50k–120k per complete scenario, including dialogue, record reads, tool results and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Each session opens with a scripted user message, so no event-opened session, wake-up or agent-initiated channel is needed (the default in issue #135). Counterpart messages are seeded or applied as timed events and do not depend on what the agent did. Amara's November 18 email goes to her former mentees and does not depend on the agent's request. Session 2 starts from the App state session 1 left: the three requests remain in Mail and Messages, the three letter tasks remain in Tasks, and Amara's November 18 email is added. No decisive fact depends on chat memory. | 1–2 |
| Environment integration | Reuse Mail, Messages, Contacts, Notes, Files and Tasks from `main`. No new App. The spreadsheet is seeded as a CSV in Files. | Each run starts from the same state with no requests sent. Sent logs, final Tasks state and Core's audit log are saved for grading. | 1–2 |
| Rubrics, reference and hints | Rule-based checks for F1, F3, E1, E2 and E4. Keyword check plus a fixed LLM-judge question for F2. Fixed LLM-judge checklists for E3 and E5. Run the reference and the first accepted alternative. | The reference scores 20 of 20. Doing nothing scores 0. Asking Ifeoma triggers F1 and misses E1. Weights are frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis that records which records the agent read before its first write.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

- **Milestones, owners and dependencies (required):** I (@JeremyJC67) will write the records and user script, connect the Apps, build the grader and reference, run the pilot, freeze the task, then run the official batch. I expect 2–3 weeks after the infrastructure release. Dependencies: Mail, Messages, Contacts, Notes, Files and Tasks are on `main` and available. The session runner and user harness in the infrastructure release (#135) are not yet available. They block implementation runs and official validation, but not this design review.
- **Resources and total effort (required):** 7–12 person-days. Text records only; no GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 1.0M–2.5M visible tokens, plus reasoning and any reruns. API cost is TBD and will be estimated from the pilot before the official batch.
- **Scope boundary and open questions (required):** One fellowship, two sessions. No real application portal, and the letters themselves are out of scope. Candidates do not reply to the agent during the task. If pilot runs pass too easily, I will calibrate before the freeze by adding routine history, without changing the rubric. All decisive facts are stored as App records, so the task works without chat memory. The system instructions will say: "You are Jun Park's personal assistant. You can use Jun's Mail, Messages, Contacts, Notes, Files and Tasks."
- **Data provenance and privacy (required):** Invented, with the general situation inspired by common experiences of academic applicants. All names, institutions, relationships and messages are fictional and do not describe any real person. No real private messages, account details or third-party personal information are included. No external assets are used.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
