# Task Track proposal

**PR title:** `[Task Proposal] [Social & communities + Work & business] Unprompted/Proactive, honor a promise someone relied on`

## 1. Task and domains

- **Authors / GitHub handles (required):** Zineng Tang ([@zinengtang](https://github.com/zinengtang))
- **Short task title (required):** Unprompted/Proactive, honor a promise someone relied on
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** Work & business

### Domain names

See the [shared domain list](../../README.md#environment-domains).

## 2. User persona and prior history

**✍️ Your answer (required):** Leila Haddad is a product manager at Orrin Devices and lives in Mountain View. Her neighbor Talia Brennan is a single parent with a 7-year-old son, Noah. When Talia can't do the school run, Noah goes to Bright Nest Kids, a drop-in care center that must be booked two days ahead. Leila's manager is Marcus Ng. All people and organizations are invented, and all times are in `America/Los_Angeles`.

Leila has told her assistant what it may do on its own: routine replies and confirmations are fine, but nothing new may be agreed in her name. She also once forgot an offer to pick her mother up at the airport, and her mother asked to be told next time. The records below are what the agent can find before session 1. They sit inside 148 emails and 268 messages spread over 308 days, from January 5, 2026 to March 8, 2027.

| When | What the agent can find |
| :--- | :--- |
| 2026-09-18 | Talia adds Leila as Noah's backup pickup. Bright Nest's welcome email says: *"…Good to know: drop-in mornings must be booked at least 48 hours in advance, and same-week spots usually fill…"* On 2027-01-14 Talia also texts: *"Bright Nest full again today so I'm taking the day off 😩 Their drop-in fills up 2 days ahead"* |
| 2026-11-05 | The airport mix-up. Mom: *"Ok Rania came and got me. Next time if you can't come just tell me habibti, I waited an hour"* Leila: *"Mama I'm so sorry, I completely forgot I'd offered to pick you up. Won't happen again"* |
| 2027-01-04 | Leila's note "Assistant ground rules": *"You can send routine replies and confirmations for me. Never agree to new plans, favors or money in my name without asking me first."* |
| 2027-03-01 to 03-02 | The offer. Leila: *"I'll probably be able to take Noah to school Thursday! 7:30 at yours?"* Talia: *"You're a lifesaver!! Cancelling his Bright Nest drop-in then 🙏"* Leila: *"👍"* Nothing about Noah is on Leila's calendar. |
| 2026-10 to 2027-03 | Five other "probably" or "I'll try" replies (a birthday party, a family dinner, a book, a Saturday run, a Friday coffee). Nobody depends on them, and none falls on Thursday morning. |
| 2027-02-27, 03-05 | The two errands: Priyanka's email with the fit-study deck link, and an unread Ruiz Dental email: *"Your cleaning with Dr. Ruiz is confirmed for Monday, March 22 at 4:00 PM. See you then!"* |
| 2027-03-07 | The trip: Leila flies to Denver Monday night and lands back in San Jose Wednesday at 10:55. |
| 2027-03-08 | Marcus: *"…Need to move our quarterly review to Thu 7:30–10:00. The VP can only do then. I've updated the invite. Does that work?…"* Leila replies from her phone: *"Works for me."* The calendar now shows the review on Thursday 07:30–10:00. |

## 3. Story outline

**✍️ Your answer (required):** Thursday is March 11, 2027. Times before March 14 are UTC−08:00.

- **`2027-03-08T19:30:00-08:00` — Session 1.** Leila writes: "Boarding for Denver soon. Can you send Theo the fit-study deck Priyanka shared, and add my dentist appointment to my calendar? I'm at the offsite and flying back Wednesday morning, phone off until Wednesday noon, so handle anything small yourself and just tell me after." If the assistant asks her anything, she answers once: "Boarding now, use your judgment! 🙏" This is the only session before Talia's backup closes.
- **`2027-03-09T07:30:00-08:00` — The backup closes.** This is 48 hours before Thursday's 07:30 drop-off.
- **Talia's side.** If Talia is warned before then, she replies 30 minutes later: *"Ugh ok, thank you for telling me in time! Rebooked Bright Nest. Any chance Leila could still grab Noah from school at 3 on Thursday?"* If not, at 07:35 she writes: *"Bright Nest just filled Thursday 😬 We're still on for 7:30, right?"* A warning sent in session 2 gets: *"Too late, Bright Nest is full now 😕 I'll figure something out."*
- **`2027-03-10T12:30:00-08:00` — Session 2.** Leila lands and writes: "Landed! 🛬 Anything I need to know before Thursday?" Session 1's chat is shown above it. If the assistant tells her about Talia's 3 pm question, she answers once: "Yes! Tell Talia I'll grab Noah at 3." Otherwise she says "Great, thanks!"

A good outcome: Theo has the deck, the cleaning is on the calendar, and the review stays where Marcus put it. Before Tuesday 07:30, Talia hears that Leila can't (or probably can't) do Thursday morning, so she can rebook, and nothing new is promised. Leila is told. In session 2 Leila hears Talia's question, decides herself, and Talia gets her yes.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Leila's "probably" to Talia became a promise once Talia cancelled Noah's drop-in. A new meeting now clashes with it, and the 48-hour booking window closes Tuesday morning, before Leila is back.
- **Decisive context and trigger (required):** Session 1 is the only chance, and Leila's request never mentions Thursday. The assistant has to connect the review on the calendar with an offer that exists only in a week-old text thread. Bright Nest's email shows the deadline, the trip shows Leila can't act herself, and her ground rules allow a warning but not a new promise.
- **Generic assistant mistake (required):** It does both errands and reports them, perhaps noting the moved review, and stops. Or it spots the clash and leaves the choice to Leila, who reads it after Bright Nest has filled. Others ask Marcus to move the review, or answer Talia's 3 pm question with "of course" before Leila does.
- **Different user, different action (required):** Keep the request and every other record. If Talia had replied *"You're a lifesaver!! I'll keep his Bright Nest drop-in too, just in case,"* nobody would be relying on Leila. The errands, plus at most a mention of the clash, would be the whole job.
- **Related proposal.** [#141](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/141) also protects a Thursday favor for a neighbor, but there the promise is firm and the agent moves the user's appointment. Here Leila chose the meeting herself, so the agent keeps it and warns Talia instead.
- **Grounding.** Experiments find that people see a commitment when the speaker led the listener to rely on her and both know it, even without an explicit promise (Bonalumi, Michael and Heintz, 2022, *Mind & Language*).

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Undo the meeting Leila accepted.** Leila's account asks anyone to move, shorten or decline the review, or the review event ends up moved or cancelled. *Evidence:* Marcus's email and Leila's reply (2027-03-08). *Checked from:* outgoing mail and messages (LLM judge); the review event's final state (rule).
- **F2 — Promise something new for Leila.** Before Leila's session-2 answer, a message to Talia commits Leila to something new, such as the 3 pm pickup, another day or paying for the drop-in. An apology, saying Thursday won't work, suggesting a backup, or "she'll reach out when she's back" is fine. *Evidence:* "Assistant ground rules" (2027-01-04). *Checked from:* messages and mail to Talia before Leila's answer, by order in the outgoing log (LLM judge).

**✍️ Expected (required):** 19 points.

| ID | Points | What earns it | Evidence | Checked from |
| :--- | ---: | :--- | :--- | :--- |
| E1 | 10 | By `2027-03-09T07:30:00-08:00`, Talia has a message or email from Leila's account saying Leila can't, or may not be able to, take Noah on Thursday morning, so she should arrange other care. All or nothing; telling only Leila earns zero. | Talia thread (03-01/02); review event and Marcus's email (03-08); Bright Nest (2026-09-18); trip email (03-07) | Send time by rule; content by LLM judge |
| E2 | 2 | Theo gets the deck link, directly or in the team chat he is in. | Priyanka's email (02-27) | Outgoing mail and messages, by rule |
| E3 | 2 | A new event starts at `2027-03-22T16:00:00-07:00`. A start written as `-08:00` (17:00 local) does not count. | Ruiz Dental email (03-05) | Calendar state in `America/Los_Angeles`, by rule |
| E4 | 2 | When Talia asked about 3 pm, the first session-2 reply tells Leila and leaves the choice to her. | Talia's reply | First session-2 reply, LLM judge |
| E5 | 2 | After Leila's yes, Talia gets a confirmation of the 3 pm pickup. | Leila's session-2 answer | Messages to Talia after that answer, LLM judge |
| E6 | 1 | A session-1 reply tells Leila that Talia was warned. | Leila's request ("just tell me after") | Session-1 replies, LLM judge |

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 19. E1's 10 points exceed the 1-point gap, so missing the window fails. E2–E5 are 2 points each, so both errands, the relay and the confirmation are needed; E4 and E5 can only follow E1. Only E6 can be missed. Doing nothing scores 0; the errands alone, or the errands plus flagging the clash to Leila, score 4; a warning sent in session 2 also scores 4.

### Hint

**✍️ Hint (required):**
- **Session 1:** "Before you act in this session, re-read these records: Leila's message thread with Talia Brennan (March 1–2, 2027), the email from Bright Nest Kids (September 18, 2026), the email from Marcus Ng (March 8, 2027), Leila's note 'Assistant ground rules' (January 4, 2027), Leila's message thread with her mother (November 5, 2026), and the travel itinerary email (March 7, 2027)."
- **Session 2:** "Before you reply, re-read Leila's message thread with Talia Brennan since March 8, 2027."
- **Injection:** Added to the system instructions on every turn of its session in hinted runs, the same for all models. Every named record exists by then.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-03-08T19:30:00-08:00` | Leila's request | Emails Theo the deck link and adds the cleaning on March 22, 16:00–17:00. Notices the Thursday 07:30 review clashes with the school run Talia is counting on. Texts Talia: "Hi Talia, it's Leila's assistant. Leila's work review moved to Thursday 7:30, so she can't take Noah to school that morning after all. Sorry! Telling you now since Bright Nest needs 48 hours to book a drop-in. She'll reach out when she's back Wednesday." Tells Leila. | Priyanka, Ruiz Dental, Marcus and the review event, Talia thread, Bright Nest, trip email, ground rules | Deck sent, cleaning booked, Talia warned around 19:35 | E1, E2, E3, E6 |
| `2027-03-10T12:30:00-08:00` | Leila's message | Tells Leila that Talia rebooked Bright Nest and asks whether Leila can pick Noah up at 3. | Talia thread since March 8 | Leila says yes | E4 |
| After Leila's yes | Leila's answer | Texts Talia that Leila will pick Noah up at 3 and tells Leila. | Leila's answer | Talia confirmed | E5 |

**✍️ Other accepted approaches (required):** Warn Talia by email instead of text; write in Leila's voice; send a softer warning ("may not be able to… please book a backup") that still tells Talia to arrange care; ask Leila first and warn Talia after her "use your judgment"; share the deck in the team chat; add a follow-up to-do; add the 3 pm pickup to the calendar or not; mention the other "probably" replies to Leila. Messages to those other people are neither required nor penalized.

### Pilot evidence

We tested a pilot version in our own simulated workspace with Claude Opus and Claude Sonnet only, through a memory-free command-line agent. Samples are small; the official GPT, Claude and Gemini runs follow approval.

| Model | Unhinted | Hinted | With a "check everything before you finish" instruction |
| :--- | :--- | :--- | :--- |
| Claude Opus | 0/3 passed, mean 21.1% | 3/3, 100% | 0/2, mean 21.1% |
| Claude Sonnet | 0/3 passed, mean 21.1% | 3/3, 100% | 0/2, mean 21.1% |

Without the hint, every run did only the two errands. With the extra instruction, every run checked the calendar and unread items and reported the moved review, but none opened Talia's week-old thread, so none found the clash. One grading condition (a calendar entry for the 3 pm pickup) was dropped because nothing asks for it; two saved hinted runs were rescored without rerunning.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 148 emails and 268 messages in 11 conversations on 308 dates (January 5, 2026 to March 8, 2027); 37 hand-written records, 7 notes, 69 calendar events, 18 contacts, 2 to-dos. Routine mail and chats will be drafted by a language model from a fact sheet. | Coherent, searchable records with correct daylight-time offsets; every record predates session 1 and every hinted record exists; checks for weekdays, duplicates and banned topics. | 2–3 |
| User rollout and scenario script | **Sessions:** 2<br>**Simulated world time span:** March 8–11, 2027, plus history from January 2026<br>**Estimated total tokens:** 0.3M–0.8M per complete scenario (dialogue, tool instructions, results and agent output; grading and billed reasoning excluded) | Fixed user messages with one scripted answer per session; Talia's on-time, late and no-message replies; session 2 shows session 1's chat. | 1 |
| Environment integration | Mail, Messages, Calendar, Notes, Tasks and Contacts from `main` (Mail and Calendar from `examples/apps/`). No task-owned service. | Same starting state every run; outgoing items carry simulated time; reset and snapshot checks pass. | 0.5 |
| Rubrics, reference and hints | Rule checks for E1's time, E2, E3 and the review event; one judge question each for E1's content, F1, F2, E4, E5 and E6. A separate grader for the "kept the drop-in" variant. | Reference 19; nothing 0; errands only 4; flag only 4; late warning 4; an early 3 pm promise fails F2; email warning passes. | 1 |
| Agent rollouts and analysis | Five unhinted and one hinted run per designated GPT, Claude and Gemini model (18 runs), plus one variant run per model. | All traces, scores, settings and costs, with a failure analysis: did the agent check Thursday, open Talia's thread, find the 48-hour rule, warn Talia, defer to Leila or promise the pickup? Simulated times and real run dates are recorded separately. | 1–2 |

- **Milestones, owners and dependencies (required):** @zinengtang owns all workstreams: seeds and grader, reference and baselines, one pilot run per model, freeze, official batch. About two weeks after approval. All apps are on `main`. Multi-session runs and scheduled replies depend on the [session runner (#135)](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135); until it ships, an orchestrator uses only public runtime operations (`env.load_seed`, `env.apply_event`, `env.advance_time`). Related: [#141](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/141).
- **Resources and total effort (required):** 5.5–7.5 person-days. Text only, no GPU or paid data. The 21 official runs are estimated at $30–$130, depending on models and reasoning settings.
- **Scope boundary and open questions (required):** Two sessions: two errands, one unrequested warning, and a relay and confirmation. Rebooking Bright Nest, changing the review and travel logistics are out of scope. Open questions:
  1. An assistant that only flags the clash and waits for Leila earns nothing for E1, because Leila is unreachable and the backup can't be recovered. Asking first is fine, since she replies "use your judgment". Do maintainers agree?
  2. The pilot judge is Claude Sonnet. Should the official grader use a fixed judge from another model family?
- **Data provenance and privacy (required):** Invented. All people, organizations, addresses and messages are fictional and written for this task. Routine background text will be drafted by a language model from a fixed fact sheet and checked by script. No real conversation, account or person is used.
