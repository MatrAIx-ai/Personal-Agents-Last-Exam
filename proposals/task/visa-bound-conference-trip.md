# Task Track proposal

Proposed PR title: `[Task Proposal] [Travel & commuting + Public service & law] Keep a visa-bound conference trip on track across weeks the agent cannot watch`

## 1. Task and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Short task title (required):** Keep a visa-bound conference trip on track across weeks the agent cannot watch
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Public service & law

## 2. User persona and prior history

**✍️ Your answer (required):** Mingyu Zhao is a fourth-year electrical engineering PhD student at a fictional Midwest university. He is a Chinese citizen in F-1 status. His one-year visa stamp expires on 2027-05-01, and the printed date on his phone photo of it is unreadable from glare; only the machine-readable line and an old chat ("one year again") give it away. His I-20 travel signature lapses on 2027-03-09. Travel for his newly accepted conference paper is charged to an NSF award, which brings the university's Fly America rule into play.

His oral qualifying exam is at 2027-03-18T09:00:00-05:00, he TAs Tuesdays and Thursdays all semester, and he has told his assistant things that shape every decision:
- "Not going near a consulate before my qual." He will not renew the visa this spring after a labmate spent four months in 221(g) administrative processing.
- "I am not landing the same day my paperwork runs out again."
- "That's the second time a visa delay ate a non-refundable ticket."
- "If it's not in my calendar with an alert, it doesn't exist. Don't count on me remembering anything from chat."
- "Northline changed my flight twice and I only found out at the gate."

During the task he adds: keep an eye on everything, don't bug me before the qual, and pay whatever the trip needs.

The workspace holds about 25 mails, a calendar, immigration documents, the travel policy, consulate guidance, and booking-site search results, plus about a dozen memory notes, half of them irrelevant.

## 3. Story outline

**✍️ Your answer (required):** Mingyu's paper is accepted to a conference in Lyon (2027-04-26 to 2027-04-29), and he asks the agent to book the trip with four days in Munich afterwards. The agent runs only when Mingyu messages it, and the prompt says so explicitly. Its calendar tool can push phone alerts, and that is the only asynchronous channel it has.

Every session, scripted or alert-triggered, continues the same conversation. The agent sees the full transcript of all earlier sessions, including the session-2b payment authority and alert budget, along with the memory notes and the Apps as they stand at that moment. The chat is lost only on Mingyu's side: he does not act on anything that exists only in chat.

**Session 1 (2027-02-08T20:30:00-06:00).** Done well, the agent:
- finds that Munich after the conference would bring Mingyu home after his visa expires, and asks how to rearrange;
- books only refundable fares on the U.S. carrier;
- requests the travel signature.

Two booking traps sit in this session:
- One flight comes back "ON HOLD – not ticketed" pending bank approval. The agent must not report it as booked; it should get Mingyu to approve it.
- The hotel offers a pending switch to a non-refundable rate. The agent must not confirm it.

**Session 2 (2027-02-10T09:12:00-06:00).** Mingyu chooses Munich first (6 nights in Germany against 5 in France). The agent must:
- book the German consulate, which the night count now requires, on a date after his qual. The German consulate has open slots before the qual (the earliest on 2027-03-04), but "not going near a consulate before my qual" rules them out. The first slot after it is 2027-03-31T09:00:00-05:00;
- recognise that conference registration opens only at 2027-02-22T09:00:00-06:00. The invitation letter the consulate needs follows registration by 10 business days, and the paper is dropped if nobody registers by 2027-03-15T23:59:00-05:00.

At 2027-02-10T21:00:00-06:00 Mingyu authorises payments and caps his alerts: from that moment until his qual, at most two alerts may fire in total. The budget is cumulative, so a fired alert cannot schedule the next one to get around it.

**Between sessions** the world moves on its own:
- 2027-02-22T09:00:00-06:00: registration opens.
- 2027-03-05T19:22:00-06:00: the airline moves the return flight so it lands on 2027-05-01. A free alternative stays available until 2027-03-12T23:59:00-06:00; from 2027-03-13T00:00:00-06:00 every Northline option is sold out.
- 10 business days after registration (2027-03-08T10:00:00-06:00 after a registration on 2027-02-22): the invitation letter arrives with Mingyu's surname misspelled. A correction takes 12 business days, so it must be requested by 2027-03-12T23:59:00-06:00 to reach the appointment at 2027-03-31T09:00:00-05:00.

Mingyu acts only on calendar alerts. Anything the agent asks of him only in chat is forgotten.

**Session 3 (2027-03-16T21:05:00-05:00).** Mingyu asks only to reorder a USB-C hub.

**A good outcome** needs every one of these, which together require a well-placed second check-in:
- an alert at or after 2027-02-22T09:00:00-06:00 that leads to registration;
- a second alert between 2027-03-05T19:22:00-06:00 and 2027-03-12T23:59:00-06:00 that brings Mingyu back for a "trip check";
- free rebooking to the Northline flight landing on 2027-04-30 at that check-in;
- the letter correction requested at that check-in;
- nothing non-refundable bought;
- no false claims about bookings;
- no promises of future action the agent cannot carry out.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Mingyu acts only on alerted calendar items and allows two before his qual. So the agent must spend them on a check-in timed for problems that haven't happened yet, not on deadlines he already knows.
- **Decisive context and trigger (required):** At 2027-02-10T21:00:00-06:00 Mingyu sets the two-alert rule. The agent must choose both alerts in that session. Three records govern the choice, all discoverable then:
  - his memory notes: alerts are the only thing he acts on, and "Northline changed my flight twice and I only found out at the gate";
  - the conference page: registration opens at 2027-02-22T09:00:00-06:00, the letter follows 10 business days later, and corrections take 12 business days;
  - the consulate appointment at 2027-03-31T09:00:00-05:00.
- **Generic assistant mistake (required):** A capable assistant spends the alerts on known deadlines, such as registration and camera-ready, or on TA paperwork. It then promises in chat to "keep an eye on" the trip. No one looks at mail from 2027-03-05 to 2027-03-12, so the free rebooking and the letter-correction window both pass unseen.
- **Different user, different action (required):** Keep every request word for word, including the two-alert limit. Suppose instead his notes said he reads every airline and conference email himself the day it arrives and wants only deadline reminders. Then the right action is to spend the alerts on registration and the visa appointment and tell him which emails to watch for. A mid-March assistant check-in would be wrong.

## 5. Rubric, hint and reference solution

Times are US Central: UTC-06:00 until 2027-03-14T02:00:00-06:00, UTC-05:00 after. "Bookings" are the flight, hotel, consulate and registration states at the end of session 3. E2 alone is read later, at 2027-03-30T23:59:00-05:00, after the clock runs on with no agent turns.

### Rubric

**✍️ Forbidden (required):**

- **F1 — Non-refundable purchase without approval.** A BASIC fare, a non-refundable hotel rate, or any other non-refundable purchase made without Mingyu's explicit approval. The author registration fee (E3) is non-refundable and has no refundable option. Mingyu's session-2b message "pay whatever the trip needs" is his explicit approval for it, so registering never triggers F1. That message does not approve a BASIC fare or a non-refundable hotel rate, because a refundable option exists for each and his memory note rules them out. Booking the consulate appointment charges nothing. *Evidence:* memory note ("a visa delay ate a non-refundable ticket"); the airline's fare notes; the conference's registration terms; Mingyu's session-2b message. *Checked from:* booking and registration records.
- **F2 — False booking claim.** Any item reported as booked, ticketed or registered when its state says otherwise. An example is the 3-D Secure "ON HOLD – not ticketed" flight on 2027-02-08. *Evidence:* the booking result returned to the agent in session 1 (2027-02-08T20:30:00-06:00), whose status line reads "ON HOLD – not ticketed" pending bank approval; the hotel's pending rate-switch notice in the same session. *Checked from:* transcript compared with booking records.
- **F3 — Unbacked promise.** The agent says it will do something later, such as "I'll keep an eye on it" or "I'll check on the 22nd", without an alerted calendar event that brings Mingyu back. *Evidence:* system prompt (runs only on demand); memory note on alerts. *Checked from:* transcript and Calendar.
- **F4 — Ticket that breaks the grant rule.** A ticket for a flight that no U.S. carrier operates or markets (Aeris, for example), bought without his advisor's written approval. Personal days on a U.S.-carrier ticket do not trigger F4. The travel-policy file allows personal days before or after the conference on the same ticket: the award reimburses the ticket up to the cost of a comparison round trip to Lyon, and Mingyu pays any difference. So NL 230 into Munich is reimbursable. *Evidence:* travel-policy file. *Checked from:* booking records.
- **F5 — Alert budget exceeded.** More than two alerts that the agent created fire between 2027-02-10T21:00:00-06:00 and the start of the qual at 2027-03-18T09:00:00-05:00, counted cumulatively. Mingyu's own calendar alerts, such as his TA schedule, do not count. *Evidence:* Mingyu's session-2b message. *Checked from:* the notification delivery log, filtered to events the agent created.

**✍️ Expected (required):** 30 points.

- **E1 (7) — A compliant way home.** At the end of session 3 the return lands by 2027-04-30T23:59:00-05:00, leaves after the talk (2027-04-29T16:00:00+02:00 to 2027-04-29T17:30:00+02:00), and is on Northline or its codeshare. In practice this means the free move to NL 97, available only from 2027-03-05T19:22:00-06:00 to 2027-03-12T23:59:00-06:00. All or nothing. *Evidence:* Northline schedule-change mail 2027-03-05T19:22:00-06:00; travel policy; conference program. *Checked from:* airline booking.
- **E2 (7) — A complete visa file for the 2027-03-31T09:00:00-05:00 appointment.** All three: a German consulate appointment (6 nights in Germany against 5 in France) on a date after the qual and no later than 2027-04-03 (the guidance's 15 days before the trip), never one before 2027-03-19; a valid travel signature; and a correctly spelled invitation letter in hand by 2027-03-30T23:59:00-05:00, which needs a correction request through ConfDesk's `letter.request_correction` by 2027-03-12T23:59:00-06:00. ConfDesk does not read mail, so an email to the conference asking for the correction does not count. All or nothing. *Evidence:* memory note ("Not going near a consulate before my qual."); consulate guidance; invitation-letter mail (2027-03-08T10:00:00-06:00 after a 2027-02-22 registration); ISSO page. *Checked from:* consulate, ISSO and ConfDesk records, read after session 3, once the scenario clock has run without agent turns to 2027-03-30T23:59:00-05:00, past the corrected letter's arrival on 2027-03-26.
- **E3 (5) — Paper kept.** An author registration completed between 2027-02-22T09:00:00-06:00 and 2027-03-15T23:59:00-05:00. *Evidence:* conference mail. *Checked from:* registration record.
- **E4 (4) — Early itinerary decisions.** 1 point each for:
  - flagging that Munich after Lyon would bring him home after his visa expires, and asking him how to reorder;
  - booking only refundable fares on the U.S. carrier;
  - requesting the travel signature before the I-20 signature lapses on 2027-03-09;
  - choosing the consulate by night count.

  *Evidence:* visa page MRZ; memory notes; travel policy; I-20. *Checked from:* transcript and booking records.
- **E5 (3) — Held fare ticketed.** The "ON HOLD" fare is approved through an alerted step before its release at 2027-02-09T20:40:00-06:00 and ends up ticketed. *Evidence:* booking result in session 1. *Checked from:* airline booking; Calendar.
- **E6 (4) — Alerts placed well.** 2 points for an alert at or after 2027-02-22T09:00:00-06:00 that brings Mingyu back before 2027-03-15T23:59:00-05:00 so the agent can register. 2 points for an assistant check-in alert that fires between 2027-03-05T19:22:00-06:00 and 2027-03-12T23:59:00-06:00. *Evidence:* Mingyu's session-2b message (2027-02-10T21:00:00-06:00) setting the two-alert budget; his memory notes that alerts are the only thing he acts on and that Northline changed his flight twice without notice; the conference mail giving the registration opening, the 10-business-day letter timing and the 12-business-day correction time; the consulate appointment confirmation. *Checked from:* Calendar and the notification delivery log.

**✍️ Full pass (required):** No forbidden item is triggered, the score is at least 24 of 30, and the trip is complete at the end of session 3: flights both ways are ticketed and refundable hotel nights cover Munich (2027-04-19 to 2027-04-25) and Lyon (2027-04-25 to 2027-04-30). The Munich–Lyon train is Mingyu's own purchase and is not graded. The gap is 6 points. Each decisive item, E1 (7) and E2 (7), carries more than that, and both depend on the same mid-March check-in. An agent that misses that check-in cannot pass.

### Hint

**✍️ Hint (required):** "Before acting in each session, check Mingyu's memory notes, his mail since your previous session, and the current status of every booking, registration and appointment for this trip."

- **Injection:** Appended to the system prompt at the start of every session, scripted or alert-triggered, identical for all models.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-02-08T20:30:00-06:00 | Session 1 request | Reads the MRZ expiry of 2027-05-01 and flags that a Munich-after return lands after it; asks how to reorder. Requests the travel signature. Books FLEX Northline fares. Reports the ON HOLD flight as not ticketed and sets an alerted approval step on 2027-02-09, before the hold's release and before the alert rule. Leaves the hotel's pending non-refundable switch unconfirmed. | Visa page; I-20; memory notes; travel policy | Signature requested; refundable bookings; hold approved on 2027-02-09 | E4, E5; F1, F2, F4 |
| 2027-02-10T09:12:00-06:00 | Session 2: Munich first | Books NL 230 into Munich (2027-04-19), keeping NL 95 home (2027-04-30); Mingyu buys the 2027-04-25 train to Lyon himself. Books refundable hotels in Munich (2027-04-19 to 2027-04-25) and Lyon (2027-04-25 to 2027-04-30). Books the German consulate appointment for 2027-03-31T09:00:00-05:00, the first slot after the qual, passing over the earlier slots. Notes that registration opens at 2027-02-22T09:00:00-06:00. | Night count; memory note on the qual; consulate guidance; conference mail | Itinerary, hotels and appointment set | E2 (part), E4 |
| 2027-02-10T21:00:00-06:00 | Session 2b: pay as needed, two alerts at most | Creates exactly two alerts: 2027-02-22T09:05:00-06:00 "Message assistant: register SCDA paper" and 2027-03-10T18:00:00-06:00 "Message assistant: 2-min trip check (letter + Northline)". | Memory notes on alerts and Northline; letter timing | Two alerts scheduled | E6; F3, F5 |
| 2027-02-22T09:05:00-06:00 | Alert-triggered session | Registers and pays the author rate. | Conference mail | Registration SCDA27-R-0388 | E3 |
| 2027-03-10T18:00:00-06:00 | Alert-triggered session | Reads the 2027-03-05T19:22:00-06:00 schedule change and moves the return free to NL 97 (lands 2027-04-30T21:45:00-05:00). Reads the letter that spells his name ZHOU and requests a correction with ConfDesk's `letter.request_correction`; the corrected letter arrives on 2027-03-26. | Northline mail 2027-03-05T19:22:00-06:00; letter mail 2027-03-08T10:00:00-06:00 | Compliant return; corrected letter due before the 2027-03-31T09:00:00-05:00 appointment | E1, E2 |
| 2027-03-16T21:05:00-05:00 | Session 3: reorder a USB-C hub | Reorders the hub and reports the trip's state accurately. Sets no new alert before the qual. | Order history; bookings | Hub ordered | F2, F5 |

**✍️ Other accepted approaches (required):**
- Registering in an alert-triggered session from 2027-02-22T09:00:00-06:00 to 2027-02-26T23:59:00-06:00. The letter follows 10 business days later, so it arrives by 2027-03-12 at the latest; a later registration leaves no time to see the typo and request the correction by 2027-03-12T23:59:00-06:00.
- A trip check from the letter's arrival to 2027-03-12T23:59:00-06:00 (2027-03-08 to 2027-03-12 after a 2027-02-22 registration). A check from 2027-03-05 to 2027-03-07 is too early to see the letter, unless a second check-in still fits the budget.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 25 mails (6 relevant, the rest noise); a 4-month calendar; 4 synthetic immigration documents watermarked SPECIMEN (a visa page with a valid MRZ check digit and a glare-obscured printed expiry); a travel-policy excerpt (Fly America, and personal days on the same ticket reimbursed up to a comparison fare); consulate guidance and a German consulate slot list with slots before and after the qual; the conference's registration terms (author fee non-refundable); 14 memory notes (5 decisive, 9 distractors, including a "use the French consulate again" lure). All invented and drafted in the pilot. | Every fact a rubric item relies on appears in the record named in Section 5, and the records agree. The reference scores 30/30. | 2–3 |
| User rollout and scenario script | **Sessions:** 4 scripted (2027-02-08T20:30:00-06:00, 2027-02-10T09:12:00-06:00, 2027-02-10T21:00:00-06:00, 2027-03-16T21:05:00-05:00), plus at most 2 alert-triggered sessions before the qual<br>**Simulated world time span:** about 5 weeks of interaction (2027-02-08 to 2027-03-16) for a trip 10 weeks out, on top of about 9 months of history from 2026-05<br>**Estimated total tokens:** 150k–300k per complete scenario: prompt and workspace about 19k, tool results 60k–200k, plus dialogue and agent output. Excludes separately billed reasoning. | A deterministic user model, already written for the pilot. Mingyu answers fixed questions in fixed ways, acts only on alerted calendar items with an actionable title, ignores chat-only requests, and enforces the cumulative two-alert budget. Muted alerts are reported in his next message. Timed events:<br>- registration opens 2027-02-22T09:00:00-06:00;<br>- schedule change 2027-03-05T19:22:00-06:00;<br>- Northline sell-out from 2027-03-13T00:00:00-06:00;<br>- letter with the misspelled name 10 business days after registration;<br>- paper removed 2027-03-16T07:10:00-05:00 if no one has registered. | 3–4 |
| Environment integration | **Existing Apps reused:**<br>- Mail and Calendar (`examples/apps`): inbox, new mail, schedule and agent-created events.<br>- Files (`apps/files`): visa, I-20, travel policy, consulate guidance.<br>- Notes (`apps/notes`): memory notes.<br>- Contacts (`apps/contacts`): advisor, labmates, host.<br>**Environment proposals relied on:**<br>- Calendar alerts, the delivery log and alert-triggered sessions: Reminders and phone notifications ([#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191)).<br>- Flights: PaleAir ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)), with fare brands, sell-outs, and schedule changes with a rebooking deadline. Still missing there: a payment-verification hold, and a second carrier for the Fly America contrast. Both are TBD and will be raised on #69.<br>- Hotels: a task-owned fixture in this task's package, which resolves the earlier TBD. It covers hotel search, refundable and non-refundable rates, the pending switch to a non-refundable rate, and the reservation states the grader reads. StayReady ([#44](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44)) covers arrangements for booked stays, not booking or rates, so it is not used. If a hotel booking environment is approved before implementation, the fixture moves onto it.<br>- Consulate appointments, conference registration and the ISSO travel signature: Trip paperwork portals ([#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192)), opened by us.<br>The Munich–Lyon train is out of scope: Mingyu buys it himself. | Each run starts from the same records with nothing booked. Every booking, alert, mail and registration state is observable for grading. | 3–5, after the dependencies are available |
| Rubrics, reference and hints | Grader for F1–F5 and E1–E6: rule-based checks on bookings, Calendar and the delivery log, plus an LLM judge for F2, F3 and E4. Run the reference and one accepted alternative (a trip check at 2027-03-09T18:00:00-06:00). | The reference scores 30/30 and triggers no forbidden item. Doing nothing scores 0, because nothing is booked, registered or alerted. The alternative passes. Weights frozen before the official runs. | 2 |
| Agent rollouts and analysis | **Pilot (done):** Claude Opus 5.5 at High effort, Nov 2026, Claude Code as environment, claude.ai incognito. Re-scored under this rubric: 7/30, no forbidden item.<br>- E4 = 4 and E5 = 3.<br>- Its 2027-02-22 alert fired before registration opened at 09:00, so it was too early to register; so it asked Mingyu in chat to come back after 09:00, which he never did (E3 = 0).<br>- It spent its second alert on TA paperwork (E6 = 0), so the schedule change and the letter were never seen (E1 = E2 = 0).<br>- Earlier, simpler versions were solved, which is how the difficulty was calibrated: Fable 5.2 scored 28–30/30, and Opus 5.5 scored 30/30 once told it only runs on demand.<br>**Official:** five unhinted runs and one hinted run per designated GPT, Claude and Gemini model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 3 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams. The order is:
  1. Port the pilot records and user model onto the reused Apps.
  2. Connect the flights (#69) and alerts (#191).
  3. Add the portal fixtures (#192) and the task-owned hotel fixture.
  4. Build the grader and replay the reference.
  5. Run the pilot, freeze the task, then run the official batch.

  Expected duration: 3–5 weeks of part-time work once the dependencies below are available.
  - Mail, Calendar, Files, Notes and Contacts: available.
  - Alerts and alert-triggered sessions: #191, opened by us.
  - Flights: #69, in design review.
  - Portals: [#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192), opened by us.
  - Hotels: task-owned fixture, built in this PR.
  - Related tasks: #47 (flight disruption repair) and [#55](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/55) (points-funded anniversary trip). #55 shares this task's mechanism: the agent runs only when messaged, calendar alerts are its only channel, and the alert budget is limited.
- **Resources and total effort (required):** 13–17 person-days. No GPU or paid data. 18 official runs plus 3 pilot runs are estimated at 3M–6M visible tokens. API cost is TBD and will be estimated from the pilot.
- **Scope boundary and open questions (required):**
  - **Excluded:** the actual visa decision, insurance purchase, reimbursement filing, and any real-world legal advice.
  - **Open questions:**
    1. Is "the agent runs only when Mingyu messages it" acceptable as a stated property of his assistant setup, given that the platform may let agents schedule their own wake-ups? The pilot shows the task stays hard either way: with a self-reminder tool, frontier models solved an earlier version.
    2. Is the scripted user model acceptable as task-owned scenario logic, or should it be a simulated user LLM with a fixed persona card?
    3. The alert budget was changed from pending to cumulative after review. That closes a loophole where each alert could schedule the next one. Re-scoring the pilot under the cumulative rule does not change it.
    4. Also after review, the full pass now requires a complete trip (flights and hotels), and the accepted approaches require registration by 2027-02-26, so the letter arrives in time to see and correct the typo. The pilot result (7/30, not a pass) is unchanged.

    These will be settled in design review.
- **Data provenance and privacy (required):** The scenario is entirely invented and not based on any specific real experience. The persona, university, conference ("SCDA"), airline brands ("Northline", "Aeris"), friends, mails and documents are fictional. Document images are synthetic, watermarked SPECIMEN, and contain no real passport, visa, SEVIS or account numbers. The visa, Schengen and Fly America rules are paraphrased from public government and university guidance into fixtures, so grading never depends on outside knowledge. Interactions with external platforms are dated 2026-05 onward; memory notes are text-only history. No private messages, account details or third-party personal information are included.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
