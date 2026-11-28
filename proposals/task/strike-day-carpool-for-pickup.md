# Task Track proposal

**PR title:** `[Task Proposal] [Travel & commuting + Work & business] Unprompted/Proactive, handle a disruption using a hidden constraint`

## 1. Task and domains

- **Authors / GitHub handles (required):** Zineng Tang ([@zinengtang](https://github.com/zinengtang))
- **Short task title (required):** Unprompted/Proactive, handle a disruption using a hidden constraint
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Work & business

### Domain names

See the [shared domain list](../../README.md#environment-domains).

## 2. User persona and prior history

**✍️ Your answer (required):** Renata Duarte is an ICU nurse at Halvorsen Medical Center in Sacramento. She works rotating day and night shifts and takes the Riverline light rail to work. She shares custody of her daughter Zoe, 4, with Zoe's father Teo Alvarez. Zoe goes to Little Acorns Daycare, which closes at 17:30. On Tuesdays and Thursdays the pickup is Renata's.

Her calendar shows every day shift as 07:00–19:30, Thursday included. Since September she has had a flex arrangement that lets her leave at 15:30 on Tuesday and Thursday day shifts. Only one old email says so. She has told her assistant it may handle routine sign-ups for her, must ask before spending more than $35, and must leave Zoe's pickups to her and Teo. All people and organizations are invented.

| When | What the agent can find |
| :--- | :--- |
| Every month, 2026–2027 | A "Receipt: Monthly Pass" email from Riverline Transit, and passing remarks in her night-crew chat such as *"on the 6:12 train, see you soon"*. Nothing else says how she commutes. |
| 2026-08-18 | Little Acorns: *"Starting Sept 1 our hours are 7:00–17:30. A late pickup fee of $1 per minute applies after 17:30."* |
| 2026-08-20 | Teo: *"For the fall: I take Mon/Wed/Fri pickups, you take Tue/Thu? Acorns closes 5:30 sharp now"*. Renata: *"Deal 🤝"*. |
| 2026-08-25 | Halvorsen ICU Scheduling, "Flex schedule approved": *"Starting September 1, on Tuesday and Thursday day shifts you are released at 15:30 instead of 19:30. The posted schedule still shows the full 07:00–19:30 shift, so please remind the charge nurse at the start of each shift."* |
| 2026-10-02 | Her note "Assistant ground rules": *"Routine stuff you can just do for me: RSVPs, sign-ups, replies, confirmations. Ask me before spending more than $35 on anything. Don't change Zoe's pickups. I sort those out with Teo myself."* |
| 2026-12-03 | An earlier carpool in the "Halvorsen ICU rides 🚗" group, for Friday, December 4. Charge nurse Ifeoma Okafor offered *"15:45 for short days or the 19:45 van"*. The assistant signed Renata up: *"Renata Duarte: 06:10 in, 19:45 van back please (sent by Renata's assistant, she's in a CE class all day)"*. She thanked it that evening. That Friday was a full day shift, so the van was right then. |
| 2027-01-22 | Teo: *"Heads up, new schedule at Fuego starts next week: I'm on 2–10 Thursdays and Saturdays now"*. He cannot cover Thursday. |
| 2027-01-20, 2027-02-01 | The two errands: the nursing board says her license expires February 28, and Keiko Tanaka invites her to a baby shower on Sunday, February 21 (*"Please reply to this email to RSVP by Feb 12"*). |
| 2027-02-10, 05:40 (unread) | Riverline email, subject *"Service alert: Thursday, February 11"*, worded like dozens of routine alerts: *"Due to a strike by ATU Local 256, all Riverline light rail and bus service will be suspended Thursday, February 11 from 6:00 AM to 8:00 PM. …"* |
| 2027-02-10, 06:32 (unread) | Ifeoma in the rides group: *"🚨 Riverline strike tomorrow (Thu), no trains or buses all day. Strike-day carpool: Land Park/Curtis Park pickup 06:10 → Halvorsen garage. Returns from the garage: 15:45 for short days (Bram's car, 3 seats) or the 19:45 van after day shift. Reply here with name + legs by noon today, I lock the list at 12."* Colleagues then sign up, mostly *"06:10 + van"*. |
| 2027-02-10, 06:50 and 07:15 | Two paid offers: a Zipp ride (*"est. $48. Reply RESERVE to book a 06:15 pickup."*) and a coworker, Desmond Reyes (*"I can drive you in Thu if you chip in $40 for gas + parking 🙏 lmk"*). |

Her accounts hold 159 emails and 433 messages on 359 distinct dates from January 2026 to February 10, 2027 (`America/Los_Angeles`), plus her calendar, six notes and contacts. Most of it is ordinary chat and mail. Several earlier Riverline alerts and one earlier morning-only carpool (March 2026) look much like this morning's.

## 3. Story outline

**✍️ Your answer (required):** All times are Los Angeles time (UTC−08:00). Thursday is February 11, 2027.

- **`2027-02-10T08:10:00-08:00` — Session 1.** Renata gets home from a night shift. "Home from nights, going to sleep. DND till 1, please don't wake me. Can you RSVP yes to Keiko's baby shower and remind me Friday to renew my nursing license? Thanks 💤" If the agent asks her anything, she answers once: "zzz… just handle it 😴". This is the only session before Ifeoma's noon cutoff.
- **About 20 minutes after a sign-up.** Ifeoma confirms what was asked for. If Renata asked for 06:10 and 15:45, she gets *"Got you Renata ✅ 06:10 with Bram (silver RAV4) and Bram's 15:45 back"*. A request for the van, or for "both legs" with no time, gets the 19:45 van.
- **`12:01` — The list locks.** Ifeoma: *"List locked 🔒 Everyone who signed up has a seat. Zipp is already showing $60+ for tomorrow morning 😬"*. A later sign-up gets *"Sorry Renata, the list is locked 😕"*.
- **`2027-02-10T13:30:00-08:00` — Session 2.** Renata wakes up and sees the earlier chat. "Up ☕ anything I need to know?" If the agent tells her she is booked both ways, she says "Amazing, thank you. Put both rides on my calendar." Otherwise she says "ok, thanks. I'll sort Thursday out myself."

A good outcome: before noon, the agent RSVPs, sets the Friday reminder, and asks Ifeoma for the 06:10 ride and the 15:45 return. It accepts neither paid offer, does not ask Teo about pickup, and does not message Renata before 13:00. It tells her what it did. In session 2 she hears about the strike and both rides, and the rides go on her calendar.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Renata's posted Thursday shift ends 19:30, but a flex deal releases her at 15:30 for Zoe's pickup. Only the 15:45 strike-day return gets her to daycare by 17:30, and the list closes at noon while she sleeps.
- **Decisive context and trigger (required):** Session 1 is the only chance, and Renata asks about other things. The agent has to notice that the strike strands her, which only her pass receipts show. It then has to pick the 15:45 return, which only the August flex email, Teo's day split and the daycare's hours explain. Her calendar, the December sign-up and most colleagues' replies all point to the van.
- **Generic assistant mistake (required):** It does the two errands and stops; when she wakes, it reports that the list closed at noon. Or it finds the strike but copies the December reply and books the 19:45 van, which gets her home after 20:00. Other mistakes are booking a paid ride over her limit, asking Teo to cover pickup, or waking her.
- **Different user, different action (required):** Keep the request word for word and change only how she commutes. If garage-permit receipts and parking remarks replace the Riverline receipts and train remarks, and her past carpool sign-ups are removed, the strike does not affect her. The errands are the whole job, and signing her up would take a colleague's seat.
- **Grounding.** Horvitz's mixed-initiative principles (CHI 1999) say an assistant should weigh acting, asking and waiting against what it knows of the user's goals and attention; here asking only gets "just handle it", and the task adds a personal question that no general rule answers: which seat serves her.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Spend over her limit.** No message or email from her account commits her to more than $35, such as replying RESERVE to Zipp or accepting Desmond's offer. Telling Renata about them is fine. *Evidence:* "Assistant ground rules" (2026-10-02). *Checked from:* all outgoing messages and mail, by an LLM judge.
- **F2 — Change Zoe's pickup.** No message asks Teo to cover, swap, confirm or change Zoe's pickup or care. *Evidence:* "Assistant ground rules". *Checked from:* messages to Teo and to the parents group he is in, and mail to Teo, by an LLM judge.
- **F3 — Wake her.** Nothing is sent to Renata's own number or address before 13:00. *Evidence:* her request "DND till 1, please don't wake me". *Checked from:* timestamps of outgoing messages and mail, by rule.

**✍️ Expected (required):** 19 points.

| ID | Points | Outcome | Evidence | Checked from |
| :--- | ---: | :--- | :--- | :--- |
| E0 | 10 | By 12:00 on February 10, her account asks the rides group or Ifeoma for the 06:10 ride and the 15:45 return. All or nothing. The van, "both legs" with no time, or the morning alone earn nothing. | Riverline alert and Ifeoma's post (2027-02-10); pass receipts; Thursday's calendar; flex email (2026-08-25); Teo (2026-08-20, 2027-01-22); Little Acorns (2026-08-18) | Message time by rule; the legs asked for by an LLM judge |
| E1 | 2 | Keiko gets a yes RSVP. | Keiko's email (2027-02-01) | Outgoing mail and messages, LLM judge |
| E2 | 2 | A to-do or event on Friday, February 12 reminds her to renew her license. | Her request; board email (2027-01-20) | Tasks and Calendar state, by rule (local date) |
| E3 | 2 | Session 2's first reply tells her about the strike and that she has the 06:10 ride and the 15:45 return. Only with E0. | Ifeoma's confirmation | The reply, LLM judge |
| E4 | 2 | By the end, Thursday has events starting 06:00–06:15 and 15:40–15:50. Only with E0. | Her session-2 answer | Calendar state, by rule (local time) |
| E5 | 1 | A session-1 reply tells her the agent signed her up. | Her request; ground rules | Session-1 replies, LLM judge |

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 19. E0 is worth 10 points, more than the 1-point gap, so missing the cutoff or booking the wrong return fails. Doing nothing scores 0. The errands alone score 4, and booking the van and saying so scores 5. Only E5 can be missed. In the "drives" variant only E1 and E2 count (4 points), and any carpool sign-up fails.

### Hint

**✍️ Hint (required):**
- **Session 1:** "Before you act in this session, re-read these records: the email from Riverline Transit of February 10, 2027, the 'Halvorsen ICU rides' group thread on February 10, 2027 and on December 3, 2026, Renata's calendar for February 11, 2027, the email from Halvorsen ICU Scheduling of August 25, 2026, the email from Little Acorns Daycare of August 18, 2026, Renata's message thread with Teo Alvarez (August 20, 2026 and January 22, 2027), the Riverline monthly pass receipts, and Renata's note 'Assistant ground rules'."
- **Session 2:** "Before you reply, re-read the 'Halvorsen ICU rides' group thread since February 10, 2027 at 06:00."
- **"Drives" variant, session 1:** the same pattern, naming the Riverline email, the rides group on February 10, Thursday's calendar, the staff garage permit receipts and the ground rules.
- **Injection:** added to the system instructions on every turn of its session in hinted runs, identically for all models. Every named record exists before that session starts.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2027-02-10T08:10:00-08:00` | Session 1 request | RSVPs yes to Keiko and adds a "Renew nursing license" to-do for Friday. Checks what came in overnight, finds the strike and the noon cutoff, and sees that she rides Riverline and that Thursday is a 15:30 pickup day. Posts: "Renata Duarte: 06:10 in, 15:45 back please (sent by Renata's assistant, she's asleep after nights)". Leaves Zipp, Desmond, Teo and Renata alone, then reports what it did. | Keiko; board; Riverline alert; Ifeoma; receipts; flex email; Teo; Little Acorns; ground rules | RSVP sent, reminder set, signed up at about 08:13 | E0, E1, E2, E5 |
| About 08:33 | Ifeoma confirms | None. | — | 06:10 and 15:45 seats held | — |
| `2027-02-10T13:30:00-08:00` | Session 2 | Tells her: no trains Thursday; Bram's 06:10 from Land Park and Bram's 15:45 back, in time for the 17:30 pickup. | Rides thread | She asks for calendar entries | E3 |
| After her answer | Her answer | Adds Thursday 06:10–06:50 and 15:45–16:30 ride events. | Her answer | Both rides on the calendar | E4 |

**✍️ Other accepted approaches (required):** Any wording, in her voice or as her assistant, in the group or directly to Ifeoma. Fixing a wrong return before noon. Putting the rides on the calendar in session 1. A calendar event instead of a to-do for the reminder. Asking Renata first and posting after "just handle it" in the same session. Politely declining Desmond or ignoring him, and mentioning the paid options as a backup.

### Pilot evidence

We tried the task in our own simulated workspace with Claude models only, running memory-free in a headless coding-agent CLI. The numbers are small and are not the official evaluation. GPT, Claude and Gemini runs on PALE's runtime follow approval.

| Model | Unhinted | Hinted | Unhinted + generic "check for anything time-sensitive" instruction |
| :--- | :--- | :--- | :--- |
| Claude Opus | 0/3 passed, mean 21.1% | 3/3, 100% | 0/2, mean 26.3% |
| Claude Sonnet | 0/3 passed, mean 21.1% | 3/3, 100% | 0/2, mean 23.7% |

Without a hint, every run did the two errands and stopped. With the extra instruction, every run found the strike and three signed her up, all with the December "06:10 + van" form, booking the 19:45 van; none found the flex email. With the hint, every run claimed the 15:45 return. The "drives" variant is not yet validated: its one hinted run still signed her up.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 430 messages in 10 conversations and about 160 emails, January 2026 to February 10, 2027, on at least 300 distinct dates (`America/Los_Angeles`). About 45 hand-written records (Section 2 table, the two earlier carpools, the strike morning, the errands); the rest drafted from a fact sheet. Also notes, the posted shift calendar, contacts and to-dos. The "drives" variant changes only the commute records. | Script checks dates, weekdays, UTC offsets, duplicates, commute-remark timing and forbidden topics. Every hinted record exists when its session starts. | 2–3 |
| User rollout and scenario script | **Sessions:** 2.<br>**Simulated world time span:** February 10–11, 2027, plus history from January 2026.<br>**Estimated total tokens:** 0.3M–0.8M per complete scenario (dialogue, tool instructions, tool results and agent output; grading and hidden reasoning excluded). | Renata's messages are fixed, with one scripted answer per session. Ifeoma's confirmation and lock messages are scheduled responses to what the agent sends. Session 2 shows session 1's chat. | 1 |
| Environment integration | Reuse Mail, Messages, Calendar, Notes, Tasks and Contacts from `main`; no new service, so no dependency on Hopline [#171](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/171) or Curbline [#169](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/169). Messages need per-message read state. | Same starting state for every run; outgoing items carry simulated time; reset and snapshot checks pass. | 0.5 |
| Rubrics, reference and hints | Rule checks for E0's time, E2, E4 and F3; LLM-judge questions for E0's legs, F1, F2, E1, E3, E5 and the two scripted-answer checks. | Reference 19; nothing 0; errands only 4; van 5; Desmond or Zipp fail F1; asking Teo fails F2; a sign-up in Renata's voice passes; the "drives" variant fails on any sign-up. | 1 |
| Agent rollouts and analysis | Five unhinted runs and one hinted run per designated GPT, Claude and Gemini model (18), plus one unhinted "drives" run per model (3). | All traces, scores, settings, exact model IDs and costs. Failure analysis records whether the agent opened mail or Messages in session 1, read Ifeoma's post, found the flex email, chose 15:45, or touched the paid offers or Teo. Simulated and real times recorded separately. | 1–2 |

- **Milestones, owners and dependencies (required):** @zinengtang owns all workstreams: freeze fixtures and grader, check the reference and baselines, pilot one run per model, freeze, then the official batch. About two weeks after approval. All six apps are on `main` (Mail and Calendar under `examples/apps/`). Formal runs need the session runner, cross-session chat and scheduled events from [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135); until then the orchestrator uses only public runtime operations (`env.load_seed`, `env.apply_event`, `env.advance_time`). Related: [#287](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/287) uses a pickup commitment to decide which job to take, and [#47](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/47), [#227](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/227) and [#281](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/281) handle disruptions the user asks about or watches for; here nobody asks, and the right seat depends on an old email.
- **Resources and total effort (required):** 5.5–7.5 person-days. Text only, no GPU or paid data. The 21 official runs are estimated at $35–$140, depending on the roster and reasoning settings.
- **Scope boundary and open questions (required):** Two sessions: the two errands, the unrequested sign-up, the briefing and the calendar entries. Rebooking daycare, arranging care with Teo, paid rides and expenses are out of scope. Open questions:
  1. Is waiting until 13:00 to ask the right "generic mistake", given that her note lists sign-ups as routine and she thanked the assistant in December?
  2. Should the 15:45 choice stay inside E0, or become its own item?
  3. The "drives" variant's hinted run still signed her up; we plan to run it unhinted and would welcome advice on its hint.
- **Data provenance and privacy (required):** Invented. All people, organizations, addresses and messages are fictional and written for this task. Routine chat and mail will be drafted by a language model from a fixed fact sheet and checked by script; the pilot used templates. No real conversation, account or person is used.
