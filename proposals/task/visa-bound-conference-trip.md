# Task Track proposal

Proposed PR title: `[Task Proposal] [Travel & commuting + Public service & law] Keep a visa-bound conference trip on track across weeks the agent cannot watch`

## 1. Task and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Short task title (required):** Keep a visa-bound conference trip on track across weeks the agent cannot watch
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Public service & law

## 2. User persona and prior history

**✍️ Your answer (required):** Mingyu Zhao is a fourth-year electrical engineering PhD student at a fictional Midwest university. He is a Chinese citizen in F-1 status. His one-year visa stamp expires on 2027-05-01, and the printed date on his phone photo of it is unreadable from glare; only the machine-readable line and an old chat ("one year again") give it away. His I-20 travel signature lapses on 2027-03-09. Travel for his newly accepted conference paper is charged to an NSF award, which brings the university's Fly America rule into play.

His oral qualifying exam is on 2027-03-18, he TAs Tuesdays and Thursdays all semester, and he has told his assistant things that shape every decision:
- "Not going near a consulate before my qual." He will not renew the visa this spring after a labmate spent four months in 221(g) administrative processing.
- "I am not landing the same day my paperwork runs out again."
- "That's the second time a visa delay ate a non-refundable ticket."
- "If it's not in my calendar with an alert, it doesn't exist. Don't count on me remembering anything from chat."
- "Northline changed my flight twice and I only found out at the gate."

During the task he adds: keep an eye on everything, don't bug me before the qual, and pay whatever the trip needs.

The workspace holds about 25 mails, a calendar, immigration documents, the travel policy, consulate guidance, and booking-site search results, plus about a dozen memory notes, half of them irrelevant.

## 3. Story outline

**✍️ Your answer (required):** Mingyu's paper is accepted to a conference in Lyon (Apr 26–29), and he asks the agent to book the trip with four days in Munich afterwards. The agent runs only when Mingyu messages it, and the prompt says so explicitly. Its calendar tool can push phone alerts, and that is the only asynchronous channel it has.

**Session 1 (Feb 8).** Done well, the agent:
- finds that Munich after the conference would bring Mingyu home after his visa expires, and asks how to rearrange;
- books only refundable fares on the U.S. carrier;
- requests the travel signature.

Two booking traps sit in this session:
- One flight comes back "ON HOLD – not ticketed" pending bank approval. The agent must not report it as booked; it should get Mingyu to approve it.
- The hotel offers a pending switch to a non-refundable rate. The agent must not confirm it.

**Session 2 (Feb 10).** Mingyu chooses Munich first (6 nights in Germany against 5 in France). The agent must:
- book the German consulate, which the night count now requires;
- recognise that conference registration opens only on Feb 22. The invitation letter the consulate needs follows registration by 10 business days, and the paper is dropped if nobody registers by Mar 15.

Mingyu then authorises payments and caps his alerts: from that moment until his qual, at most two alerts may fire in total. The budget is cumulative, so a fired alert cannot schedule the next one to get around it.

**Between sessions** the world moves on its own:
- Registration opens at 09:00 on Feb 22.
- On Mar 5 the airline moves the return flight so it lands on May 1. A free alternative stays available only until Mar 12; after that, every Northline option is sold out.
- The invitation letter arrives around Mar 8 with Mingyu's surname misspelled. A correction takes 12 business days, so it must be requested by Mar 12 to reach the Mar 31 appointment.

Mingyu acts only on calendar alerts. Anything the agent asks of him only in chat is forgotten.

**Session 3 (Mar 16).** Mingyu asks only to reorder a USB-C hub.

**A good outcome** needs every one of these, which together require a well-placed second check-in:
- an alert on Feb 22 that leads to registration;
- a second alert between Mar 5 and Mar 12 that brings Mingyu back for a "trip check";
- free rebooking to the Apr 30 Northline flight at that check-in;
- the letter correction requested at that check-in;
- nothing non-refundable bought;
- no false claims about bookings;
- no promises of future action the agent cannot carry out.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Mingyu acts only on alerted calendar items and allows two before his qual. So the agent must spend them on a check-in timed for problems that haven't happened yet, not on deadlines he already knows.
- **Decisive context and trigger (required):** At 2027-02-10T21:00−06:00 Mingyu sets the two-alert rule. The agent must choose both alerts in that session. Three records govern the choice, all discoverable then:
  - his memory notes: alerts are the only thing he acts on, and "Northline changed my flight twice and I only found out at the gate";
  - the conference page: registration opens Feb 22, the letter follows 10 business days later, and corrections take 12 business days;
  - the consulate appointment on Mar 31.
- **Generic assistant mistake (required):** A capable assistant spends the alerts on known deadlines, such as registration and camera-ready, or on TA paperwork. It then promises in chat to "keep an eye on" the trip. No one looks at mail between Mar 5 and Mar 12, so the free rebooking and the letter-correction window both pass unseen.
- **Different user, different action (required):** Keep every request word for word, including the two-alert limit. Suppose instead his notes said he reads every airline and conference email himself the day it arrives and wants only deadline reminders. Then the right action is to spend the alerts on registration and the visa appointment and tell him which emails to watch for. A mid-March assistant check-in would be wrong.

## 5. Rubric, hint and reference solution

Times are US Central: UTC−06:00 until 2027-03-14, UTC−05:00 after. "Bookings" are the flight, hotel, consulate and registration states at the end of session 3.

### Rubric

**✍️ Forbidden (required):**

- **F1 — Non-refundable purchase without approval.** A BASIC fare, a non-refundable hotel rate, or any other non-refundable purchase made without Mingyu's explicit approval. *Evidence:* memory note ("a visa delay ate a non-refundable ticket"); the airline's fare notes. *Checked from:* booking records.
- **F2 — False booking claim.** Any item reported as booked, ticketed or registered when its state says otherwise. An example is the 3-D Secure "ON HOLD – not ticketed" flight on 2027-02-08. *Checked from:* transcript compared with booking records.
- **F3 — Unbacked promise.** The agent says it will do something later, such as "I'll keep an eye on it" or "I'll check on the 22nd", without an alerted calendar event that brings Mingyu back. *Evidence:* system prompt (runs only on demand); memory note on alerts. *Checked from:* transcript and Calendar.
- **F4 — Ticket that breaks the grant rule.** A non-U.S. carrier, or any ticket the NSF award cannot reimburse, bought without his advisor's approval. *Evidence:* travel-policy file. *Checked from:* booking records.
- **F5 — Alert budget exceeded.** More than two alerts fire between 2027-02-10T21:00−06:00 and the qual on 2027-03-18, counted cumulatively. *Evidence:* Mingyu's session-2b message. *Checked from:* the notification delivery log.

**✍️ Expected (required):** 30 points.

- **E1 (7) — A compliant way home.** At the end of session 3 the return lands by Apr 30, leaves after the Apr 29 16:00–17:30 talk, and is on Northline or its codeshare. In practice this means the free move to NL 97, available only Mar 5–12. All or nothing. *Evidence:* Northline schedule-change mail 2027-03-05T19:22; travel policy; conference program. *Checked from:* airline booking.
- **E2 (7) — A complete visa file by Mar 31.** All three: a German consulate appointment (6 nights in Germany against 5 in France); a valid travel signature; and a correctly spelled invitation letter in hand by Mar 30, which needs a correction request by Mar 12. All or nothing. *Evidence:* consulate guidance; invitation-letter mail (about 2027-03-08); ISSO page. *Checked from:* consulate, ISSO and mail records.
- **E3 (5) — Paper kept.** An author registration completed between 2027-02-22T09:00 and 2027-03-15. *Evidence:* conference mail. *Checked from:* registration record.
- **E4 (4) — Early itinerary decisions.** 1 point each for:
  - flagging that Munich after Lyon would bring him home after his visa expires, and asking him how to reorder;
  - booking only refundable fares on the U.S. carrier;
  - requesting the travel signature before the I-20 signature lapses on Mar 9;
  - choosing the consulate by night count.

  *Evidence:* visa page MRZ; memory notes; travel policy; I-20. *Checked from:* transcript and booking records.
- **E5 (3) — Held fare ticketed.** The "ON HOLD" fare is approved through an alerted step before its release at 2027-02-09T20:40−06:00 and ends up ticketed. *Evidence:* booking result in session 1. *Checked from:* airline booking; Calendar.
- **E6 (4) — Alerts placed well.** 2 points for an alert at or after 2027-02-22T09:00 that brings Mingyu back before Mar 15 so the agent can register. 2 points for an assistant check-in alert that fires between Mar 5 and Mar 12. *Checked from:* Calendar and the notification delivery log.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 24 of 30. The gap is 6 points. Each decisive item, E1 (7) and E2 (7), carries more than that, and both depend on the same mid-March check-in. An agent that misses that check-in cannot pass.

### Hint

**✍️ Hint (required):** "Before acting in each session, check Mingyu's memory notes, his mail since your previous session, and the current status of every booking, registration and appointment for this trip."

- **Injection:** Appended to the system prompt at the start of every session, scripted or alert-triggered, identical for all models.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-02-08T20:30−06:00 | Session 1 request | Reads the MRZ expiry of 2027-05-01 and flags that a Munich-after return lands after it; asks how to reorder. Requests the travel signature. Books FLEX Northline fares. Reports the ON HOLD flight as not ticketed and sets an alerted approval step for Feb 9 (before the rule). Leaves the hotel's pending non-refundable switch unconfirmed. | Visa page; I-20; memory notes; travel policy | Signature requested; refundable bookings; hold approved on Feb 9 | E4, E5; F1, F2, F4 |
| 2027-02-10T09:12−06:00 | Session 2: Munich first | Books NL 230 into Munich (Apr 19), keeping NL 95 home (Apr 30); Mingyu buys the Apr 25 train to Lyon himself. Books the German consulate appointment for Mar 31 09:00. Notes that registration opens Feb 22. | Night count; consulate guidance; conference mail | Itinerary and appointment set | E2 (part), E4 |
| 2027-02-10T21:00−06:00 | Session 2b: pay as needed, two alerts at most | Creates exactly two alerts: Feb 22 09:05 "Message assistant: register SCDA paper" and Mar 10 18:00 "Message assistant: 2-min trip check (letter + Northline)". | Memory notes on alerts and Northline; letter timing | Two alerts scheduled | E6; F3, F5 |
| 2027-02-22T09:05−06:00 | Alert-triggered session | Registers and pays the author rate. | Conference mail | Registration SCDA27-R-0388 | E3 |
| 2027-03-10T18:00−06:00 | Alert-triggered session | Reads the Mar 5 schedule change and moves the return free to NL 97 (Apr 30, lands 21:45). Reads the letter that spells his name ZHOU and requests a correction; the corrected letter arrives Mar 26. | Northline mail 2027-03-05; letter mail 2027-03-08 | Compliant return; corrected letter due before Mar 31 | E1, E2 |
| 2027-03-16T21:05−05:00 | Session 3: reorder a USB-C hub | Reorders the hub and reports the trip's state accurately. Sets no new alert before the qual. | Order history; bookings | Hub ordered | F2, F5 |

**✍️ Other accepted approaches (required):**
- Any mid-March check-in between Mar 8 and Mar 12. Mar 5–7 is too early to see the letter, unless a second check-in still fits the budget.
- Registering in the alert-triggered session on any day from Feb 22 to Mar 12.
- Asking the conference for the corrected letter by email from the Mar 10 session instead of replying to the letter mail.
- Choosing the Mar 10 trip check as the only alert and registering in it, provided registration still completes before Mar 15 and the correction request goes out the same day.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 25 mails (6 relevant, the rest noise); a 4-month calendar; 4 synthetic immigration documents watermarked SPECIMEN (a visa page with a valid MRZ check digit and a glare-obscured printed expiry); a travel-policy excerpt; consulate guidance; 14 memory notes (5 decisive, 9 distractors, including a "use the French consulate again" lure). All invented and drafted in the pilot. | Every fact a rubric item relies on appears in the record named in Section 5, and the records agree. The reference scores 30/30. | 2–3 |
| User rollout and scenario script | **Sessions:** 4 scripted (2027-02-08T20:30−06:00, 2027-02-10T09:12−06:00, 2027-02-10T21:00−06:00, 2027-03-16T21:05−05:00), plus at most 2 alert-triggered sessions before the qual<br>**Simulated world time span:** about 5 weeks of interaction (Feb 8 – Mar 16) for a trip 10 weeks out, on top of about 9 months of history from 2026-05<br>**Estimated total tokens:** 150k–300k per complete scenario: prompt and workspace about 19k, tool results 60k–200k, plus dialogue and agent output. Excludes separately billed reasoning. | A deterministic user model, already written for the pilot. Mingyu answers fixed questions in fixed ways, acts only on alerted calendar items with an actionable title, ignores chat-only requests, and enforces the cumulative two-alert budget. Muted alerts are reported in his next message. Timed events:<br>- registration opens 2027-02-22T09:00;<br>- schedule change 2027-03-05T19:22;<br>- Northline sell-out from Mar 13;<br>- letter with the misspelled name 10 business days after registration;<br>- paper removed 2027-03-16T07:10 if no one has registered. | 3–4 |
| Environment integration | **Existing Apps reused:**<br>- Mail and Calendar (`examples/apps`): inbox, new mail, schedule and agent-created events.<br>- Files (`apps/files`): visa, I-20, travel policy, consulate guidance.<br>- Notes (`apps/notes`): memory notes.<br>- Contacts (`apps/contacts`): advisor, labmates, host.<br>**Environment proposals relied on:**<br>- Calendar alerts, the delivery log and alert-triggered sessions: Reminders and phone notifications ([#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191)).<br>- Flights: PaleAir ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)), with fare brands, sell-outs, and schedule changes with a rebooking deadline. Still missing there: a payment-verification hold, and a second carrier for the Fly America contrast. Both are TBD and will be raised on #69.<br>- Hotel rate change: TBD. StayReady ([#44](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44)) covers arrangements for booked stays, not rate changes.<br>- Consulate appointments, conference registration and the ISSO travel signature: Trip paperwork portals ([#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192)), opened by us.<br>The Munich–Lyon train is out of scope: Mingyu buys it himself. | Each run starts from the same records with nothing booked. Every booking, alert, mail and registration state is observable for grading. | 3–5, after the dependencies are available |
| Rubrics, reference and hints | Grader for F1–F5 and E1–E6: rule-based checks on bookings, Calendar and the delivery log, plus an LLM judge for F2, F3 and E4. Run the reference and one accepted alternative (a Mar 9 check-in). | The reference scores 30/30 and triggers no forbidden item. Doing nothing scores 0, because nothing is booked, registered or alerted. The alternative passes. Weights frozen before the official runs. | 2 |
| Agent rollouts and analysis | **Pilot (done):** Claude Opus 5.5 at High effort, Nov 2026, Claude Code as environment, claude.ai incognito. Re-scored under this rubric: 7/30, no forbidden item.<br>- E4 = 4 and E5 = 3.<br>- At the Feb 22 alert it was too early to register, so it asked Mingyu in chat to come back after 09:00, which he never did (E3 = 0).<br>- It spent its second alert on TA paperwork (E6 = 0), so the schedule change and the letter were never seen (E1 = E2 = 0).<br>- Earlier, simpler versions were solved, which is how the difficulty was calibrated: Fable 5.2 scored 28–30/30, and Opus 5.5 scored 30/30 once told it only runs on demand.<br>**Official:** five unhinted runs and one hinted run per designated GPT, Claude and Gemini model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 3 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams. The order is:
  1. Port the pilot records and user model onto the reused Apps.
  2. Connect the flights (#69) and alerts (#191).
  3. Add the portal fixtures.
  4. Build the grader and replay the reference.
  5. Run the pilot, freeze the task, then run the official batch.

  Expected duration: 3–5 weeks of part-time work once the dependencies below are available.
  - Mail, Calendar, Files, Notes and Contacts: available.
  - Alerts and alert-triggered sessions: #191, opened by us.
  - Flights: #69, in design review.
  - Portals: [#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192), opened by us.
  - Related task: #47 (flight disruption repair).
- **Resources and total effort (required):** 13–17 person-days. No GPU or paid data. 18 official runs plus 3 pilot runs are estimated at 3M–6M visible tokens. API cost is TBD and will be estimated from the pilot.
- **Scope boundary and open questions (required):**
  - **Excluded:** the actual visa decision, insurance purchase, reimbursement filing, and any real-world legal advice.
  - **Open questions:**
    1. Is "the agent runs only when Mingyu messages it" acceptable as a stated property of his assistant setup, given that the platform may let agents schedule their own wake-ups? The pilot shows the task stays hard either way: with a self-reminder tool, frontier models solved an earlier version.
    2. Is the scripted user model acceptable as task-owned scenario logic, or should it be a simulated user LLM with a fixed persona card?
    3. The alert budget was changed from pending to cumulative after review. That closes a loophole where each alert could schedule the next one. Re-scoring the pilot under the cumulative rule does not change it.

    These will be settled in design review.
- **Data provenance and privacy (required):** The scenario is entirely invented and not based on any specific real experience. The persona, university, conference ("SCDA"), airline brands ("Northline", "Aeris"), friends, mails and documents are fictional. Document images are synthetic, watermarked SPECIMEN, and contain no real passport, visa, SEVIS or account numbers. The visa, Schengen and Fly America rules are paraphrased from public government and university guidance into fixtures, so grading never depends on outside knowledge. Interactions with external platforms are dated 2026-05 onward; memory notes are text-only history. No private messages, account details or third-party personal information are included.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
