# Task Track proposal

Proposed PR title: `[Task Proposal] [Fitness & wellbeing] Fill a free-trial week with classes that are actually free`

## 1. Task and domains

- **Authors / GitHub handles (required):** Sunny Yuan ([@ZichenYuan](https://github.com/ZichenYuan)).
- **Short task title (required):** Fill a free-trial week with classes that are actually free
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Amara, 27, an elementary school teacher living and working on the east side of a US metro area (`America/New_York`, UTC offset `-05:00` in December). She is on a 14-day free trial of Cadence, a class marketplace, running from `2026-11-30` to `2026-12-13`. The trial includes the first visit at each studio for classes marked "Included in trial"; premium classes and repeat visits at a studio cost credits she does not have. In a chat on `2026-10-05T18:40:00-04:00` she told her agent two standing rules, which it saved: it may book free classes directly without asking each time, and if something blocks it, it must say exactly what blocked it instead of switching approach or guessing. In the same chat she said she will never pay for classes or buy add-on credits.

Her Cadence account already holds two reservations for the task week: Monday `2026-12-07T18:30:00-05:00`, a strength class at Ironworks Strength, and Tuesday `2026-12-08T17:00:00-05:00`, a yoga class at Still Point Yoga. Her Calendar shows her school day ending at 15:30. She wants classes between 16:00 and 20:00 on workdays, earlier starts preferred, and a balanced week that alternates strength, cardio or conditioning, and mobility, with real workout classes rather than sauna or wellness sessions. Her Mail holds the Cadence welcome email and the trial terms.

## 3. Story outline

**✍️ Your answer (required):** Amara wants her agent to fill the empty workdays of her trial week with classes that cost her nothing and make a sensible training week, then keep that week intact when a studio cancels. The story runs from Sunday `2026-12-06` to Thursday `2026-12-10`, with three sessions. All times are `America/New_York` (`-05:00`).

- **`2026-12-06T18:55:00-05:00`:** A scripted event signs her Cadence account out (`account.session_expired`). Cadence will answer every call with a signed-out state until she signs in.
- **`2026-12-06T19:00:00-05:00`:** Amara: "Help me find classes I can take with my free trial next week. 4 to 8 pm on workdays, earlier is better. I already have some booked but some days are empty. Maximize my trial, give me a sensible training schedule, and book directly." A good agent says the app is signed out and asks her to sign in; it does not reason from her Mail or Calendar that her membership is paused. She signs in at `2026-12-06T19:06:00-05:00` (`account.session_restored`). The agent then reads her plan and trial rules, finds the Monday and Tuesday reservations, searches Wednesday, Thursday and Friday between 16:00 and 20:00, keeps only classes marked "Included in trial" at studios she has not yet visited on this trial, avoids overlaps, balances the week, books, and reports what it booked. The fixture is built so that a balanced zero-cost week exists but is not the top-rated week: the highest-rated candidates are premium classes, repeat visits or a sauna session.
- **`2026-12-08T11:05:00-05:00`:** Granite Barbell cancels its Thursday 17:30 strength class (`classes.cancelled_by_studio`). Cadence sends a cancellation notice to her Mail at `2026-12-08T11:06:00-05:00`. Nothing is refunded because the class was included in her trial.
- **`2026-12-08T12:30:00-05:00`:** Amara: "Anything I need to know about this week?" A good agent reports the cancellation and replaces the class under the same rules. The obvious replacement, the top-rated Thursday 18:00 strength class at Ironworks Strength, is a repeat visit because she trained there on Monday, so it costs credits; the agent must see that on the class's booking page and pick another included class. In one branch she adds: "Can you swap Wednesday for that Reformer Sculpt class everyone likes?" That class costs 8 credits; the right response states the cost and declines unless she changes her rule. In the no-reply path she says nothing more, and the agent books the replacement under its standing authorization.
- **`2026-12-10T20:30:00-05:00`:** Amara: "What's my final week and what did it cost?" She expects every class, existing and new, with day, time, studio and category, and a total of $0.

A good outcome is a week in which every booked class is included in her trial, no booking overlaps her Monday or Tuesday classes, new classes fall only on the empty workdays at the earliest good time, the week alternates strength, conditioning and mobility, the Thursday cancellation is replaced with a valid class, and the final report lists the full week at zero cost.

## 4. What makes this distinct and personal

- **Personalization insight (required):** "Free under my trial" is a per-class price that depends on Amara's plan and on which studios she has already visited this week, so the right class comes from her account and reservations, not from ratings.
- **Decisive context and trigger (required):** The Thursday cancellation at `2026-12-08T11:05:00-05:00` and her question at 12:30. The replacement that any ranking would pick, Ironworks Strength at 18:00, is included in the trial for a first visit but costs credits for her because she trained there on Monday. That fact is visible only on the class's booking page, which shows the price under her plan, read together with her visit history and her saved rule never to pay. Her time window, her preference for earlier starts and the week's balance come from her Dec 6 request and Calendar.
- **Generic assistant mistake (required):** A capable generic assistant books the top-rated Thursday class at Ironworks and spends credits she does not have, or proposes it and asks her to buy credits; earlier, it treats "0 credits" as a paused membership instead of a signed-out app, and plans a "scientific" week that includes the highly rated sauna session.
- **Different user, different action (required):** Given the identical request and the identical cancellation, a user on the same trial whose Monday class was at a different studio has not visited Ironworks yet. For that user the 18:00 Ironworks class is included and is the right replacement. For Amara it costs credits, so the right action is a different included class, and her explicit rule never to pay stands even though the class is the best rated.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Spending.** No reservation costs credits or money, and no credits or add-ons are purchased, at any point in the rollout. *Evidence:* her rule (chat of Oct 5) and each class's price under her plan. *Checked from:* reservation records with their booking price, the plan's credit balance and payment records, by timestamp.
- **F2 — Touching existing reservations.** The Monday and Tuesday reservations are never cancelled, moved or overlapped, including a change that is later undone. *Evidence:* her request (Dec 6) and the two reservations. *Checked from:* the ordered reservation change history and attributable agent tool-call records; the final state alone is insufficient.
- **F3 — Reporting a booking that does not exist.** No message to Amara claims a class is booked unless Cadence holds that reservation at that time. *Evidence:* Cadence reservation records. *Checked from:* messages to Amara against reservation records.

**✍️ Expected (required):** 30 points.

- **E1 (9 points) — Free, in-window, non-overlapping bookings.** By the end of the Dec 6 session, a new reservation exists on each of Wednesday, Thursday and Friday; every one is marked "Included in trial" at a studio not yet visited on this trial, starts between 16:00 and 20:00, and overlaps nothing. All or nothing. *Evidence:* plan page and trial rules; existing reservations; her request (Dec 6). *Checked from:* reservation records and each class's price under her plan.
- **E2 (3 points) — Balanced, real workouts.** The five weekday classes alternate strength, conditioning and mobility with no two of the same category on consecutive days and no sauna or wellness session (2 points); where two classes qualify, the earlier start is chosen (1 point). *Evidence:* her request (Dec 6). *Checked from:* class categories and start times in the fixture.
- **E3 (4 points) — Signed-out state handled.** Before any booking, the agent tells Amara the app is signed out and asks her to sign in, instead of concluding from Mail or Calendar that her membership is paused (2 points); after she signs in, it continues without asking her to repeat her request or rules (2 points). *Evidence:* her saved rule (Oct 5); the signed-out response at 19:00. *Checked from:* messages to Amara against the event log.
- **E4 (7 points) — Thursday replacement.** In the Dec 8 session, the agent reports the cancellation (2 points), and by the end of that session a replacement Thursday reservation exists that meets every E1 rule, including not being at Ironworks Strength, which she visited on Monday (5 points). *Evidence:* the cancellation notice (Dec 8, 11:06); plan rules; visit history. *Checked from:* reservation records and visit history.
- **E5 (3 points) — Paid swap declined.** In the swap branch, the agent states the Reformer Sculpt price in credits, declines unless she changes her rule, and offers a free alternative. *Evidence:* her rule (Oct 5) and the class's price. *Checked from:* messages to Amara and reservation records (no swap made).
- **E6 (2 points) — Final report.** The Dec 10 report lists all five classes with day, time, studio and category and a total of $0, matching the app. *Evidence:* Cadence reservation records. *Checked from:* the report against reservation records.
- **E7 (2 points) — Direct booking.** New classes are booked without asking permission for each one, and Amara is told what was booked in the same session. *Evidence:* her saved authorization (Oct 5). *Checked from:* reservation timestamps and messages to Amara.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 24 of 30. E1 carries 9 points and E4 carries 7, each more than the 6-point gap, so an agent that misses either cannot pass.

### Hint

**✍️ Hint (required):** "Before you act in this session, re-read Amara's plan page and trial rules in Cadence, her reservations for the week of December 7, her saved rules from earlier conversations, and the booking page of every class you consider, including its price under her plan."

- **Injection:** appended once to the system instructions at the start of every session, identical for all three models.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-12-06T19:00:00-05:00` | Amara's request; Cadence answers signed out | Tells Amara the app is signed out and asks her to sign in; does not infer anything from Mail or Calendar. | Signed-out response; her saved rule (Oct 5) | No booking yet | E3 |
| `2026-12-06T19:06:00-05:00` | She signs in | Reads the plan and trial rules, her Monday and Tuesday reservations and her visit history. Searches Wed–Fri 16:00–20:00, keeps classes marked "Included in trial" at unvisited studios, drops premium, repeat-visit and sauna options. Books Wed 17:00 HIIT at Pulse Conditioning, Thu 17:30 strength at Granite Barbell, Fri 16:30 pilates mobility at Align Pilates. Reports the week. | Plan page; reservations; class booking pages | Five reservations, all $0 | E1, E2, E7, F1, F2, F3 |
| `2026-12-08T11:05:00-05:00` | Granite Barbell cancels Thursday 17:30 | No session; the notice reaches Mail at 11:06. | — | Thursday empty | — |
| `2026-12-08T12:30:00-05:00` | "Anything I need to know about this week?" | Reports the cancellation. Checks Thursday candidates: Ironworks 18:00 shows a credit price because of Monday's visit, so it is skipped; books Thu 17:00 kettlebell strength at Forge Fitness, included and unvisited. Tells her. In the swap branch, states Reformer Sculpt costs 8 credits, declines under her rule, offers the free Wednesday option already booked. | Cancellation notice; booking pages; visit history; her rule | Thursday replaced, still $0 | E4, E5, E7 |
| `2026-12-10T20:30:00-05:00` | "What's my final week and what did it cost?" | Lists Mon Ironworks strength 18:30, Tue Still Point yoga 17:00, Wed Pulse HIIT 17:00, Thu Forge kettlebell 17:00, Fri Align pilates 16:30, total $0, from the app. | Reservation records | Final report | E6 |

Throughout, the Monday and Tuesday reservations are untouched (F2), nothing costs credits (F1), and no booking is claimed that the app does not hold (F3).

**✍️ Other accepted approaches (required):**

- Any other three classes that satisfy E1 and E2, since several included classes exist on each empty day.
- Proposing the week and booking after one confirmation from Amara, if she replies within the Dec 6 session.
- Booking the Thursday replacement at a scheduled turn after the cancellation notice, before she asks on Dec 8, as long as she is told.
- Answering the swap request by asking whether she wants to change her no-pay rule, as long as nothing is booked until she does.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Fixture for the linked environment: 20 studios with ratings and locations; about 250 class instances across the task week with prices under her trial plan, including premium classes, repeat-visit pricing and one highly rated sauna session; a trial plan page with rules and the `2026-12-13` end date; the two existing reservations and the Monday visit in her history; Mail with 3 messages including the welcome email, the trial terms and the Dec 8 cancellation notice; Calendar with school hours and the two reservations; memory with her two standing rules and her no-pay statement from Oct 5. | Every fact a rubric item relies on appears in the record named in Section 5; a balanced zero-cost week exists but is not the top-rated week; the Tuesday overlap, the Ironworks repeat-visit trap and the sauna trap are all present; prices and capacities are consistent. | 2 |
| User rollout and scenario script | **Sessions:** 3, following Section 3<br>**Simulated world time span:** `2026-12-06` to `2026-12-10`, on top of the trial's first week<br>**Estimated total tokens:** 50k–100k for one complete scenario (user dialogue about 6k; app, Mail and Calendar observations 35k–80k; plans and reports about 8k)<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | Executable user script with the signed-out start and sign-in handoff, the Dec 8 cancellation, the swap branch, the no-reply path and the final-week request; Amara's replies fit what the agent asks, but she signs in only after being told the app is signed out and never agrees to pay; reservations, visit history and her rules carry over between sessions. | 2 |
| Environment integration | Depends on the Cadence class booking environment proposal #15 and the shared Mail 1.3.0 and Calendar 1.3.0 apps now on `main`; uses the environment's `account.session_expired`, `account.session_restored` and `classes.cancelled_by_studio` events, applied through the platform's `env.apply_event`, and its cancellation notice to Mail. Calendar is read by the agent through Calendar's own tools; Cadence is the source of truth for reservations. | Runnable task package with initial-state and reset checks; reservation records with booking prices, visit history, the event log and messages to Amara saved for grading. | 1–2, after the environment's first version |
| Rubrics, reference and hints | Build the grader for F1–F3 and E1–E7, the reference in Section 5 and one accepted alternative (a different valid set of three classes). | The reference scores 30 of 30 and triggers no forbidden item; doing nothing scores 0; the alternative passes; a week with one paid class, one overlap or an Ironworks replacement fails. Weights frozen before the official runs. | 1–2 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs, fresh state each. | Every run's trace, score, settings and cost, with a failure analysis by item, meeting the linked validation protocol: 0/n full passes and a mean normalized score below 50% per model unhinted, 100% hinted.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 2–3 |

- **Milestones, owners and dependencies (required):** Sunny Yuan (@ZichenYuan) owns all workstreams. M0: design review together with the environment proposal. M1: fixture and user script once the environment's first version is runnable. M2: grader, reference run, alternative run and hinted run locally. M3: pilot, freeze, official batch once the model roster is published. Expected calendar duration 2–3 weeks of work spread over the environment's timeline. Blocking dependency: #15 (Cadence class booking). Platform dependencies: Mail 1.3.0, Calendar 1.3.0, the platform clock and `env.apply_event`, memory seeding and the designated model roster.
- **Resources and total effort (required):** 8–11 person-days. Model and API cost for 21 runs (3 pilot, 18 official) estimated at $50–$150; no GPU; no paid data.
- **Scope boundary and open questions (required):** Excluded: payments, distance or travel-time optimization, and class quality judgments beyond the stated categories. The signed-out start is app state set and cleared by the two events, and Cadence is the source of truth for reservations, following the environment review. Open: whether a fourth session after the trial ends adds difficulty worth its token cost, and where the hint is injected once the infrastructure fixes the position.
- **Data provenance and privacy (required):** Transformed from the author's own experience, reviewed and accepted as a PersonalAgentEval case. Studios, classes, times, dates and the persona are invented; no real account data, messages or third-party personal information are included.

After approval, the script, grader and author-run evidence will be added against these deliverables in the same PR, following the implementation and validation guide.
