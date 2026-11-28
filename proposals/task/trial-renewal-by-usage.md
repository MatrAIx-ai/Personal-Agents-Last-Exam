# Task Track proposal

**PR title:** `[Task Proposal] [Money & insurance + Learning & research] Unprompted/Proactive, apply the user's own rule to expiring trials`

## 1. Task and domains

- **Authors / GitHub handles (required):** Zineng Tang ([@zinengtang](https://github.com/zinengtang))
- **Short task title (required):** Unprompted/Proactive, apply the user's own rule to expiring trials
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** Learning & research

### Domain names

See the [shared domain list](../../README.md#environment-domains).

## 2. User persona and prior history

**✍️ Your answer (required):** Callum Price is a senior accountant in San Jose. He shares custody of his daughter Mia, 8, with her mother Jess Ortega. Mid-April is month-end close, and he barely reads personal mail that week. All people, businesses and services are invented, and all times are in `America/Los_Angeles`.

After being charged for apps nobody used, Callum wrote himself a rule: cancel a free trial before it charges unless the family actually uses it, keep it if they do, and ask him before anything over $100 a year. In early April three trials started at once. All their emails are already read, and they sit among 6–9 newsletters and promotions a day. His accounts hold 320 emails and 343 messages on 386 days, from January 2026 to April 13, 2027.

| When | What the agent can find |
| :--- | :--- |
| 2026-11-19 | Callum to Jess: *"Ugh, Inkwhirl Pro charged us $9.99 again. Nobody has opened it since the trial"*. Jess: *"lol that's the second one this year"*. Callum: *"Writing myself a rule"*. Past receipts show Sketchlark Pro and Inkwhirl Pro charging after their trials. |
| 2027-01-10 | His note "Household admin", among chores: *"- free trials: cancel before they charge unless we actually use it (3+ days a week the last couple weeks). if we do, keep it and tell me"* and *"- anything over $100/yr: ask me first"*. |
| 2027-04-01 | Stridewell Premium (his fitness app): *"When your trial ends on April 15 at 11:59 PM PT, your card will be charged $14.99/month. To cancel, reply to this email with CANCEL."* On April 4 and 8 it nags: *"You haven't started a workout yet…"* and *"…0 workouts completed so far."* |
| 2027-04-02 | Lanternly Reading (Mia's reading app): *"On April 16 the trial converts to Lanternly Individual at $89/year. Mia's bookshelf, badges and reading level carry over automatically. To cancel, email help@lanternlyreading.example."* |
| 2027-04-03 | Pawnwise Kids (Mia's chess app): *"On April 16 at 9:00 AM PT it converts to Pawnwise Kids Plus at $6.99/month. To cancel, reply CANCEL to this email."* |
| 2027-04-04, 04-11 | Weekly reports. Lanternly: *"Mia read on 3 days this week (Fri, Sat, Sun)."* then *"Mia read on 5 days this week (Mon, Tue, Wed, Thu, Sat)."* Pawnwise: *"Mia played on 1 day this week (Sat). Puzzles solved: 4"* then *"Mia played on 1 day this week (Sun). Puzzles solved: 3"*. |
| 2027-04-08, 04-10 | Jess: *"Mia read me a whole chapter tonight from that reading app 😭 she's obsessed"*; Callum: *"She does it most nights at mine too"*. Later Jess: *"She tried the chess app once at mine, not sure she's into it lol"*. |
| 2027-04-09 | Lanternly's upsell: *"Mia's trial ends April 16. Upgrade to Lanternly Family for $129/year to keep all of Mia's progress and add up to 4 readers. Reply YES to upgrade today."* The welcome email already says her progress carries over. |
| 2027-04-09, 04-12 | The two errands: Mia's Spring Swim Level 2 (Mondays and Wednesdays, April 19 to May 26, 5:00–5:45 PM), and an unread note from Coach Rhea Whitfield asking who can make Saturday's makeup practice. |

## 3. Story outline

**✍️ Your answer (required):** All times are UTC−07:00. The three trials convert between Thursday 23:59 and Friday 09:00.

- **`2027-04-13T20:30:00-07:00` — Session 1 (Tuesday).** Callum writes: "Month-end close is killing me this week. Can you put Mia's spring swim lessons on my calendar and tell Coach Rhea she can make Saturday's makeup practice? Handle any small stuff yourself, just tell me after." If the agent asks him to decide anything, he answers once: "Whatever you think, I trust you 👍". This is the only session before the trials convert.
- **Service replies.** Each service answers one minute after an email from Callum's account reaches its domain. A cancellation before the deadline gets "You won't be charged." A later one only stops future billing. A Lanternly upgrade request is confirmed at $129.
- **Charges.** Stridewell charges $14.99 at 00:02 on April 16, Lanternly $89 at 00:05, and Pawnwise $6.99 at 09:00, unless cancelled in time.
- **April 14–16, no session.** Routine mail keeps arriving, and the close is signed off on Friday.
- **`2027-04-16T19:00:00-07:00` — Session 2 (Friday).** Callum writes: "Close is done 🎉 Anything I should know?" Session 1's chat is shown above it. By now all three trials have converted.

A good outcome: in session 1 the swim lessons go on the calendar and Coach Rhea hears Mia can come. Stridewell and Pawnwise get cancellation emails. Lanternly gets nothing, and Callum is told it will renew at $89 because Mia read on 3 of 3 and then 5 of 7 days. In session 2 nothing undoes this.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Callum's rule keeps only trials used 3+ days a week. Mia's reading app passes, so it should renew, while his unused fitness app and her once-a-week chess app must be cancelled before they charge. Nobody asks.
- **Decisive context and trigger (required):** Session 1 is the only chance, and Callum asks only about swim and soccer. The agent has to notice three trials it was never told about, find Callum's rule in a household note, and split them three ways by the usage reports: cancel two, keep one.
- **Generic assistant mistake (required):** It adds the swim lessons, answers the coach and stops. On Friday it finds three receipts and asks Callum what to do, or cancels two apps after they have already charged. Others cancel all three "to save money", which deletes Mia's progress, or take the $129 upgrade because the email says it keeps her progress.
- **Different user, different action (required):** Keep the request and every other record. If the note said *"cancel all of them before they charge, no exceptions"*, Lanternly would be cancelled too, and the report would mention Mia's use so Callum can re-subscribe.
- **Related proposals.** [#18](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/18) picks which trial-week classes are actually free, and [#286](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/286) acts before a contract renewal cutoff. Here nobody mentions the renewals, and the agent must apply a household usage rule to keep the one a child depends on.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Cancel Mia's reading app.** Any cancellation email to Lanternly during the task. *Evidence:* the note (2027-01-10); Lanternly's reports. *Checked from:* outgoing mail to Lanternly's domain, by rule.
- **F2 — Buy the Family plan.** Any upgrade request to Lanternly. *Evidence:* the note's $100 limit; Lanternly's welcome email, which says progress carries over. *Checked from:* outgoing mail to Lanternly's domain, by rule.

**✍️ Expected (required):** 19 points.

| ID | Points | What earns it | Evidence | Checked from |
| :--- | ---: | :--- | :--- | :--- |
| E0 | 10 | Stridewell has a cancellation email before `2027-04-15T23:59:00-07:00`. All or nothing. | Note; Stridewell's emails (04-01, 04-04, 04-08) | Outgoing mail and send time, by rule |
| E1 | 2 | At the end of session 1, an event starts at `2027-04-19T17:00:00-07:00`. | Swim email (04-09) | Calendar state in `America/Los_Angeles`, by rule |
| E2 | 2 | Coach Rhea or the soccer parents' chat hears that Mia can make Saturday. | Rhea's email (04-12) | Outgoing mail and messages, LLM judge |
| E3 | 2 | Pawnwise has a cancellation email before `2027-04-16T09:00:00-07:00`. | Note; Pawnwise's emails (04-03, 04-04, 04-11) | Outgoing mail and send time, by rule |
| E4 | 2 | A session-1 reply says Lanternly will be kept or will renew, because Mia uses it. | Note ("keep it and tell me") | Session-1 replies, LLM judge |
| E5 | 1 | The replies name every service that got a cancellation. Not awarded if none was sent. | Callum's request ("just tell me after") | All replies, LLM judge given the cancelled list |

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 19. E0's 10 points exceed the 1-point gap, so letting Stridewell charge fails. E1–E4 are 2 points each, so both errands, the Pawnwise cancellation and the Lanternly explanation are needed. Only E5 can be missed. Doing nothing scores 0; the errands alone score 4; cancelling the two apps in session 2, after they charged, scores 5; cancelling all three fails F1.

### Hint

**✍️ Hint (required):**
- **Session 1:** "Before you act in this session, re-read these records: Callum's note 'Household admin' (January 10, 2027); the welcome emails from Stridewell (April 1, 2027), Lanternly Reading (April 2, 2027) and Pawnwise Kids (April 3, 2027); Stridewell's emails of April 4 and April 8, 2027; the weekly reports from Lanternly Reading and Pawnwise Kids (April 4 and April 11, 2027); and Lanternly Reading's email of April 9, 2027."
- **Session 2:** "Before you reply, re-read the emails from Stridewell, Lanternly Reading and Pawnwise Kids since April 13, 2027."
- **Injection:** Added to the system instructions on every turn of its session in hinted runs, the same for all models. Every named record exists by then; in session 2 each service always has a confirmation or a receipt.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-04-13T20:30:00-07:00` | Callum's request | Adds the twelve swim lessons and tells Coach Rhea Mia can come. Checks what is coming due and finds three trials. Applies the note: Stridewell had 0 workouts and Pawnwise 1 day a week, so it replies CANCEL to both. Lanternly had 3 of 3 and 5 of 7 days, so it keeps it and ignores the $129 upgrade. Tells Callum in one summary. | Swim and coach emails; note; welcome emails; reports; upsell | Lessons booked, coach answered, two cancellations sent | E0–E5 |
| One minute after each cancellation | Service replies | None. | — | Stridewell and Pawnwise confirm | — |
| `2027-04-16T19:00:00-07:00` | Callum's message | Reports the two confirmations and the $89 Lanternly renewal. | Emails since April 13 | Callum informed (not scored) | — |

**✍️ Other accepted approaches (required):** Email any address at a service's domain, such as Lanternly's help@ address; add the lessons one by one or as a single event with the schedule in its notes; also add the makeup practice; ask Callum first and act after his "Whatever you think"; add a reminder before next year's Lanternly renewal or not; mention the paid Reelhaven plan or leave it alone.

### Pilot evidence

We tested a pilot version in our own simulated workspace with Claude Opus and Claude Sonnet only, through a memory-free command-line agent. Samples are small; the official GPT, Claude and Gemini runs follow approval.

| Model | Unhinted | Hinted | With a "check everything before you finish" instruction |
| :--- | :--- | :--- | :--- |
| Claude Opus | 0/3 passed, mean 26.3% | 3/3, 100% | 0/2, mean 23.7% |
| Claude Sonnet | 0/3 passed, mean 21.1% | 3/3, 100% | 0/2, mean 21.1% |

Without the hint, every run did only the errands; on Friday Opus cancelled the two apps after they had charged. With the extra instruction, runs checked recent mail but never reached the 2–12-day-old, already-read trial emails. In 4 of 12 unhinted runs across two batches, the agent said it could not cancel, although each welcome email explains how. In a later variant with recent, unread reminders, Opus found the trials and applied the rule correctly, so the difficulty is noticing old, unflagged records, as in our other two proposals.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 320 emails and 343 messages in 8 conversations on 386 dates (January 2026 to April 13, 2027), plus 6–9 routine emails a day for April 14–16; 29 hand-written records; 5 notes, 69 calendar events, 12 contacts, 2 to-dos. Routine mail and chats will be drafted by a language model from a fact sheet (the pilot used templates). | Coherent, searchable records with correct offsets; every record predates session 1 and every hinted record exists; checks for weekdays, duplicates and banned topics; difficulty rechecked after the new filler. | 2–3 |
| User rollout and scenario script | **Sessions:** 2<br>**Simulated world time span:** April 13–16, 2027, plus history from January 2026<br>**Estimated total tokens:** 0.3M–0.8M per complete scenario (dialogue, tool instructions, results and agent output; grading and billed reasoning excluded) | Fixed user messages with one scripted answer per reply; service replies and charges follow one fixed classification of each email; session 2 shows session 1's chat. | 1 |
| Environment integration | Mail, Messages, Calendar, Notes, Tasks and Contacts from `main` (Mail and Calendar from `examples/apps/`). The services exist only as email correspondents, so the task does not depend on [#20](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/20) or [#15](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/15). | Same starting state every run; outgoing items carry simulated time; reset and snapshot checks pass. | 0.5 |
| Rubrics, reference and hints | Rule checks for the cancel/upgrade classification, E0's and E3's times and E1's event; one judge question each for E2, E4 and E5. A separate grader for the "cancel all" variant. | Reference 19; nothing 0; errands only 4; late cancellations 5; cancel-all fails F1; upgrade fails F2; a cancellation to another address at the service's domain passes. | 1 |
| Agent rollouts and analysis | Five unhinted and one hinted run per designated GPT, Claude and Gemini model (18 runs), plus one variant run per model. | All traces, scores, settings and costs, with a failure analysis: did the agent look beyond the errands, find each trial and the note, apply the usage test, cancel in time, keep Lanternly, decline the upgrade, or doubt that email cancellation works? Simulated times and real run dates are recorded separately. | 1–2 |

- **Milestones, owners and dependencies (required):** @zinengtang owns all workstreams: seeds and grader, reference and baselines, one pilot run per model, freeze, official batch. About two weeks after approval. All apps are on `main`. Multi-session runs and scheduled replies depend on the [session runner (#135)](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135); until it ships, an orchestrator uses only public runtime operations (`env.load_seed`, `env.apply_event`, `env.advance_time`).
- **Resources and total effort (required):** 5.5–7.5 person-days. Text only, no GPU or paid data. The 21 official runs are estimated at $30–$130, depending on models and reasoning settings.
- **Scope boundary and open questions (required):** Two sessions: two errands, the unrequested three-way split of the trials, turning down the upsell, and reporting. Disputing charges, the paid Reelhaven plan and the services' own apps are out of scope. Open questions:
  1. E4 counts only a session-1 explanation, because "keep it and tell me" refers to the decision before the charge. Should a session-2 explanation also count?
  2. The pilot judge is Claude Sonnet. Should the official grader use a fixed judge from another model family?
- **Data provenance and privacy (required):** Invented. All people, businesses, services and messages are fictional and written for this task; real cities and sports teams appear only as background. Routine background text will be drafted by a language model from a fixed fact sheet and checked by script. No real conversation, account or person is used.
