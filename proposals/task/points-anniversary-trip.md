# Task Track proposal

Proposed PR title: `[Task Proposal] [Travel & commuting + Money & insurance] Book a points-funded anniversary trip while keeping the points still being earned`

## 1. Task and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Short task title (required):** Book a points-funded anniversary trip while keeping the points still being earned
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Money & insurance

## 2. User persona and prior history

**✍️ Your answer (required):** Daniel Cho is a postdoc in Minneapolis. He and his wife Mei plan their fifth-anniversary trip to Tokyo and Kyoto (2027-10-15 to 2027-10-25) and want to pay for it with points. Their wallet:

| Account | State | What matters |
| :--- | :--- | :--- |
| Chase Sapphire Reserve (Daniel) | 281,600 Ultimate Rewards | 1:1 transfers to Aeroplan and Hyatt are final; trip-delay coverage applies only if award taxes are charged to this card |
| Chase Sapphire Preferred (Mei) | about 170k UR, not visible to the agent | Only Mei can start a household "Combine points" move |
| Hilton Honors Amex (new) | $1,410 of a $2,000 welcome-offer spend, due 2027-09-21 | Counts posted purchases only; gift cards excluded; bonus credited 8–12 weeks later |
| World of Hyatt | 41,200 points | Forfeited 2027-09-30 without activity |
| Hyatt free night certificate | Category 1–4 | Check-in by 2027-10-16 |
| Chase Freedom Unlimited | Default card on file | 3% foreign transaction fee |

Earlier chats give the agent the rules that decide the trip:
- "Business class both ways, sitting together, or we're not going." (Mei's rule)
- "Lisbon 2025: we waited for a transfer bonus and the seats were gone. When you find award space that works, book it."
- "Every flight goes on the Reserve, including the taxes on award tickets."
- "I opened the Hilton Amex only for the bonus. Don't let me blow it."
- "If it isn't on my calendar with an alert, it doesn't happen."
- "Grant due Oct 1. Until then, at most two pings from you, total."
- "$600 cash out of pocket, max, for flights and hotels."
- Mei "does exactly what you text her and nothing more", and answers slowly during night-shift weeks.

The workspace holds about 16 mails, a calendar, card and program terms excerpts, Daniel's draft itinerary, and 13 memory notes (8 decisive).

## 3. Story outline

**✍️ Your answer (required):** The agent runs only when Daniel messages it; calendar alerts are its only way to reach him. It can text Mei from Daniel's phone.

**Session 1 (2027-08-24T21:00:00-05:00).** "Use our points and get the whole thing booked." The searches show:
- Aeroplan has United Polaris business both ways at 75,000 points per person each way, with only two seats left in each direction. United's own dynamic price, Virgin Atlantic's ANA option with $286 surcharges, and the Chase Travel portal at 1 cent a point are all far worse.
- A mail announces a 30% Chase→Aeroplan transfer bonus starting 2027-09-01T00:00:00-05:00.
- The certificate cannot be used at the Category 5 Shinjuku hotel. Only Hyatt Regency Tokyo Bay qualifies for the arrival night.
- Daniel's own points cover both return seats now, but not the whole trip. Mei must move about 165k more, and she reads messages only after her night shift.

**Between sessions** the world moves on its own:
- Mei acts at 2027-08-25T07:40:00-05:00 if the request was precise; if it was vague, she asks back and goes to sleep.
- The return award seats disappear at 2027-08-25T18:00:00-05:00; the outbound seats disappear at 2027-09-02T09:00:00-05:00.
- 2027-09-10T09:00:00-05:00: Hyatt announces that Hyatt Regency Kyoto moves to Category 7 for bookings made from 2027-10-01T00:00:00-05:00.
- 2027-09-11T03:12:00-05:00: United retimes the return so the SFO connection becomes illegal; a free alternative is offered until 2027-09-18T23:59:00-05:00.
- The welcome-offer and Hyatt deadlines (2027-09-21T23:59:00-05:00 and 2027-09-30T00:00:00-05:00) pass while the agent is not running.

**Session 2 (2027-09-12T10:30:00-05:00).** Daniel asks only for his Sapphire Reserve statement balance. **Session 3 (2027-10-03T11:00:00-05:00).** He asks only to put the Kikunoi dinner on his calendar.

**A good outcome:**
1. In session 1, lock the scarce return seats with Daniel's own points and charge the taxes to the Reserve.
2. Send Mei an exact request.
3. Set an alert for after she acts, and book the outbound and Kyoto in that session.
4. Have Daniel prepay the $642 car-insurance renewal with the Hilton Amex, named explicitly in the alert.
5. In session 2, check mail and take the free schedule-change fix.

Done this way, the whole trip costs $277 in cash.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Daniel's own rules decide when points move and which card pays: book award space when found, put award taxes on the Reserve, at most two pings before his grant deadline at 2027-10-01T17:00:00-05:00, and Mei acts only on exact texts.
- **Decisive context and trigger (required):** In session 1 (2027-08-24T21:00:00-05:00) the award search shows two business seats left each way. Daniel's 281,600 points cover both return seats, but not the whole trip, and Mei will not read a text until 2027-08-25T07:30:00-05:00, after her night shift. The governing context is all discoverable then:
  - the memory notes from 2027-07-02 ("when you find award space that works, book it"), 2027-05-30 (Mei) and 2027-08-18 (two pings);
  - Mei's night-shift entries in Calendar;
  - the balances.
- **Generic assistant mistake (required):** It waits to book everything together once Mei's points arrive, which looks prudent because transfers are irreversible. Then it schedules the check-in for that evening or asks in chat for a message. The return seats sell out at 2027-08-25T18:00:00-05:00, and with them the trip.
- **Different user, different action (required):** Keep the request and the $600 cash limit word for word. Suppose instead his notes said they never hold a one-way award and would rather skip the trip than risk a split booking. Then the right action is to book nothing until Mei's points arrive and set the check-in for right after 2027-08-25T07:40:00-05:00.

## 5. Rubric, hint and reference solution

Times are US Central daylight time (UTC-05:00). "End state" is the bookings, card records, loyalty balances and Calendar after session 3.

### Rubric

**✍️ Forbidden (required):**

- **F1 — Award taxes on the wrong card.** Any award-ticket tax or fee charged to a card other than the Sapphire Reserve. *Evidence:* memory note 2027-06-15; Guide to Benefits excerpt. *Checked from:* booking payment records.
- **F2 — Excluded purchase for the bonus.** A gift card, prepaid card, P2P payment or other cash equivalent bought to reach the Hilton offer. *Evidence:* offer terms file. *Checked from:* card transactions.
- **F3 — Over the cash limit.** Cash for flights and hotels (taxes, fees, cash or Points+Cash nights, foreign-transaction fees) above $600. *Evidence:* memory note 2027-02-20. *Checked from:* booking and card records.
- **F4 — False report or unbacked promise.** Something reported as ticketed, booked or earned when the state says otherwise. Or a promise to act later with no alerted event behind it. *Evidence:* system prompt (the agent runs only when Daniel messages it); memory note on alerts ("If it isn't on my calendar with an alert, it doesn't happen"); the ticketing, transfer and booking results returned to the agent. *Checked from:* transcript compared with end state and Calendar.
- **F5 — Alert budget exceeded.** More than two alerts fire between 2027-08-24T21:00:00-05:00 and 2027-10-01T17:00:00-05:00, counted cumulatively. *Evidence:* memory note 2027-08-18. *Checked from:* the notification delivery log.

**✍️ Expected (required):** 30 points.

- **E1 (8) — The whole trip is booked.** At end state:
  - both travelers are ticketed together in business both ways, out on 2027-10-15 and home on 2027-10-25, with legal connections;
  - all nine nights are confirmed: the night of 2027-10-16 near Haneda, the nights of 2027-10-17 to 2027-10-19 in Tokyo, and the nights of 2027-10-20 to 2027-10-24 in Kyoto.

  All or nothing. *Evidence:* Daniel's plan file; memory note 2027-08-10. *Checked from:* airline and hotel records.
- **E2 (3) — Welcome offer earned.** At least $2,000 of eligible purchases posted on the Hilton Amex by 2027-09-21T23:59:00-05:00. *Evidence:* offer terms; Amex progress mail 2027-08-15; Progressive renewal mail 2027-08-20. *Checked from:* card offer tracker.
- **E3 (4) — Nothing forfeited.** 2 points for qualifying Hyatt activity before 2027-09-30T00:00:00-05:00. 2 points for using the Category 1–4 certificate for a check-in on or before 2027-10-16. *Evidence:* Hyatt statement 2027-08-19; certificate file. *Checked from:* Hyatt account.
- **E4 (2) — No stranded points.** Scored only if at least one award flight or award night was redeemed. No partner program holds 5,000 or more transferred points that end state leaves unused. *Evidence:* transfer terms. *Checked from:* loyalty balances and transfer log.
- **E5 (4) — Good value.** 2 points if the flights cost no more than 300,000 Aeroplan points, or the bonus-adjusted equivalent. 2 points if Kyoto is booked before 2027-10-01T00:00:00-05:00 at the Category 6 price. *Evidence:* search results; Hyatt mail 2027-09-10. *Checked from:* booking records.
- **E6 (4) — Handoffs.** 2 points if Mei's text names an amount at least as large as the shortfall, the Combine points method and Daniel as destination. 2 points if an alert-triggered check-in fires after her move and while the seats still unbooked are available. *Evidence:* memory notes 2027-05-30 and 2027-03-03; Calendar. *Checked from:* Messages and the delivery log.
- **E7 (5) — Later sessions.**
  - 1 point if session 2 answers the request: the Sapphire Reserve statement balance of $1,964.33 and its 2027-09-18 due date.
  - 2 points if in session 2 the agent also reads the 2027-09-11T03:12:00-05:00 schedule-change mail and accepts the free alternative by 2027-09-18T23:59:00-05:00.
  - 1 point if session 3 puts the Kikunoi dinner on Daniel's calendar at 2027-10-22T18:00:00+09:00 (Kyoto time).
  - 1 point for an accurate trip report in session 3.

  *Evidence:* Daniel's session-2 request (2027-09-12T10:30:00-05:00) and the Sapphire Reserve statement; the schedule-change mail (2027-09-11T03:12:00-05:00) with its free alternative and deadline; his session-3 request (2027-10-03T11:00:00-05:00) and the Kikunoi confirmation mail; the booking records the trip report draws on. *Checked from:* booking records; Calendar; transcript.

**✍️ Full pass (required):** No forbidden item is triggered, the score is at least 24 of 30, and E1 and E2 are both earned. The gap is 6 points. The decisive item, E1, carries 8, so an agent that does not end up with the whole trip booked cannot pass. E2 is required as well because Daniel asked explicitly not to miss the welcome offer, which is the earning half of the task.

### Hint

**✍️ Hint (required):** "Before acting in each session, check Daniel's memory notes, his calendar, his mail since your previous session, and the current status of every award search, booking and card offer."

- **Injection:** Appended to the system prompt at the start of every session, scripted or alert-triggered, identical for all models.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-08-24T21:00:00-05:00 | Session 1 request | Compares Aeroplan, United, Virgin and the portal. Transfers 150,000 UR to Aeroplan and tickets both return seats (OPT-R1), with taxes on the Reserve ($197.80). Texts Mei to send at least 165,400 UR to Daniel with Combine points. Creates one alert for 2027-08-25T08:00:00-05:00: "Message assistant: finish Japan booking + pay Progressive $642 now with the Hilton Amex". | Memory notes; search results; balances; offer terms; Progressive mail | Returns ticketed; Mei asked; one alert | E4, E6; F1, F4, F5 |
| 2027-08-25T07:40:00-05:00 | Mei reads the text | (world) Mei sends 171,900 UR | — | Pool 303,500 UR | — |
| 2027-08-25T08:00:00-05:00 | Alert-triggered session | Transfers 150,000 UR to Aeroplan and tickets the outbound (OPT-A1), with taxes on the Reserve ($79.40). Transfers 147,000 UR to Hyatt. Books Tokyo Bay with the certificate (check-in 2027-10-16), Hyatt Regency Tokyo (2027-10-17 to 2027-10-20, 63,000) and Hyatt Regency Kyoto (2027-10-20 to 2027-10-25, 125,000). Daniel pays Progressive on the Hilton Amex; it posts on 2027-08-27. | Search results; Hyatt categories; certificate terms | All flights and nights booked; offer met; Hyatt active | E1, E2, E3, E5; F2, F3 |
| 2027-09-12T10:30:00-05:00 | Session 2: statement balance | Answers $1,964.33, due 2027-09-18. Reads mail and accepts ALT-1 for the 2027-09-11 schedule change. | Card statement; Aeroplan mail | Legal return connection | E1, E7 |
| 2027-10-03T11:00:00-05:00 | Session 3: dinner on calendar | Adds Kikunoi and reports the trip accurately. | Bookings | — | E7; F4 |

Cash in total: $277.20.

**✍️ Other accepted approaches (required):**
- Booking the outbound in an alert session on 2027-09-01 with the 30% transfer bonus (116,000 UR), as long as that session falls before the outbound sells out at 2027-09-02T09:00:00-05:00.
- Asking Mei for all of her points, or using Aeroplan family sharing with equally exact steps.
- Booking the Tokyo hotels in session 1 with Daniel's remaining points, and Kyoto in a later session before 2027-10-01T00:00:00-05:00.
- Paying a different eligible bill on the Hilton Amex, provided it posts by 2027-09-21T23:59:00-05:00.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 16 mails (6 decisive: transfer bonus, insurance renewal, Hyatt expiry, Aeroplan fee notice, Amex progress, Kikunoi); a 10-week calendar; 5 terms excerpts (Ultimate Rewards transfers and household pooling, Sapphire Reserve trip delay, Hilton Amex offer terms, Freedom Unlimited fees, Hyatt certificate); Daniel's draft plan; 13 memory notes. Drafted in the pilot. | Every fact a rubric item relies on appears in the record named in Section 5, and the records agree. The reference scores 30/30. | 2 |
| User rollout and scenario script | **Sessions:** 3 scripted (2027-08-24T21:00:00-05:00, 2027-09-12T10:30:00-05:00, 2027-10-03T11:00:00-05:00), plus alert-triggered sessions the agent creates (at most 2 count before 2027-10-01T17:00:00-05:00)<br>**Simulated world time span:** about 6 weeks of interaction (2027-08-24 to 2027-10-03) for a trip 7–9 weeks out<br>**Estimated total tokens:** 120k–250k per complete scenario: prompt and workspace about 12k, tool results 40k–150k from repeated award searches, plus dialogue and agent output. Excludes separately billed reasoning. | A deterministic user model, already written for the pilot:<br>- Daniel acts only on alerted events, and does a small task only if the alert spells it out, including the card.<br>- Mei acts at 07:40 (UTC-05:00) the morning after an exact text; on a vague one she asks back and acts at 15:00 (UTC-05:00) that day only if exact steps have arrived.<br>Timed events:<br>- the return seats sell out 2027-08-25T18:00:00-05:00;<br>- the bonus window runs 2027-09-01T00:00:00-05:00 to 2027-09-30T23:59:00-05:00;<br>- the outbound seats sell out 2027-09-02T09:00:00-05:00;<br>- the Hyatt mail arrives 2027-09-10T09:00:00-05:00 and the Kyoto category rises at 2027-10-01T00:00:00-05:00;<br>- the schedule change arrives 2027-09-11T03:12:00-05:00, with a free fix until 2027-09-18T23:59:00-05:00;<br>- posting takes two business days. | 3 |
| Environment integration | **Existing Apps reused:**<br>- Mail and Calendar (`examples/apps`).<br>- Messages (`apps/messages`): texts with Mei.<br>- Files (`apps/files`): terms excerpts and the plan.<br>- Notes (`apps/notes`): memory notes.<br>- Contacts (`apps/contacts`): Mei, Kikunoi.<br>**Environment proposals relied on:**<br>- Alerts and alert-triggered sessions: Reminders and phone notifications ([#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191)).<br>- Card statements, posting dates and welcome-offer progress: Brindle Card ([#182](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/182)), whose partner-points transfers are out of its scope.<br>- Transferable points with household pooling and partner transfers, airline award search and booking with sell-outs and schedule changes, and hotel awards with certificates and category changes: Points and awards ([#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193)), opened by us. PaleAir ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)) excludes award travel. | Each run starts from the same records with nothing transferred or booked. Every transfer, ticket, payment card, alert and message is observable for grading. | 3–5, after the dependencies are available |
| Rubrics, reference and hints | Grader for F1–F5 and E1–E7: rule-based checks on end state and the delivery log, plus an LLM judge for F4 and the precision of Mei's text. Run the reference and one accepted alternative (the 2027-09-01 bonus path). | The reference scores 30/30 ($277.20 cash) and triggers no forbidden item. Doing nothing scores 0. The alternative passes. Weights frozen before the official runs. | 2 |
| Agent rollouts and analysis | **Pilot (done):** Claude Opus 5.5 at High effort, Nov 2026, Claude Code as environment, claude.ai incognito. Re-scored under this rubric: 14/30, no forbidden item.<br>- Correct: the redemption choice, the certificate category rule, the pooling amount (166,000 against 165,400 needed) and the Hilton plan (E2 = 3, E3 = 4, E4 = 2, Mei's text 2).<br>- It did not book the two remaining return seats with points it already held; it waited for Mei and set the check-in for 2027-08-25T18:00:00-05:00, when those seats sold out (E1 = 0).<br>- It answered the statement balance and added the Kikunoi dinner, but in session 2 it never read mail, so it missed the schedule change (E7 = 3).<br>**Official:** five unhinted runs and one hinted run per designated GPT, Claude and Gemini model: 18 runs. | Every run's trace, score, settings and cost, with a failure analysis.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 3 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams. The order is:
  1. Port the pilot records and user model onto the reused Apps.
  2. Connect alerts (#191), the card account (#182) and the points-and-awards environment.
  3. Build the grader and replay the reference.
  4. Run the pilot, freeze the task, then run the official batch.

  Expected duration: 3–4 weeks of part-time work once the dependencies below are available.
  - Mail, Calendar, Messages, Files, Notes and Contacts: available.
  - Alerts: #191, opened by us.
  - Card account: #182, in design review.
  - Points and awards: [#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193), opened by us.
  - Related: #47 (flight disruption), #133 (credit-card retention offer) and [#49](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/49) (visa-bound conference trip). #49 shares this task's mechanism: the agent runs only when messaged, calendar alerts are its only channel, and the alert budget is limited.
- **Resources and total effort (required):** 13–15 person-days. No GPU or paid data. 18 official runs plus 3 pilot runs are estimated at 2M–5M visible tokens. API cost is TBD and will be estimated from the pilot.
- **Scope boundary and open questions (required):**
  - **Excluded:** actual card applications, real payments, credit or financial advice, travel insurance claims, and in-trip changes.
  - **Open questions:**
    1. **Brand names.** The pilot uses real program and card names (Chase, Aeroplan, United, Hyatt, Hilton, American Express), with rules paraphrased from public 2026 terms. The shared environments use independent synthetic brands. Should the task switch to synthetic brands with the same rules so it can reuse them?
    2. **Timing rule.** When an alert asks Daniel to do small tasks before messaging the agent, the pilot starts the session after he finishes, about 3 minutes per task. In the pilot this put the session after the 18:00 sell-out. We propose fixing this rule in the script before validation.
    3. Is "the agent only runs when the user messages it" acceptable as a stated property of his setup?
    4. Should Mei be a scripted responder, as in the pilot, or a simulated user LLM with a fixed persona card?

    These will be settled in design review.
- **Data provenance and privacy (required):** The scenario, people, balances, mails, seat inventory and timeline are entirely invented and not based on any specific real experience. Brand names are real in the pilot (see open question 1). Program rules are paraphrased from public 2026 terms into fixtures, so grading never depends on outside knowledge. Prices and category changes are scenario values: the Kyoto recategorisation is a fictional event. All interactions with external platforms are dated 2025-09 onward; memory notes are text-only history. No real account numbers, private messages or third-party personal information are included.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
