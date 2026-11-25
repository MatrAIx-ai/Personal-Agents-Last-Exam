# Task Track proposal

**PR title:** `[Task Proposal] [Social & communities] Rotate family call times based on who actually accommodated`

## 1. Task and domains

- **Authors / GitHub handles (required):** Yurun Chen (@YurunChen)
- **Short task title (required):** Rotate family call times based on who actually accommodated
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** None

### Domain names

See the [shared domain list](../../README.md#environment-domains).

## 2. User persona and prior history

**✍️ Your answer (required):** Emma in Seattle and her brother Felix in Berlin take turns picking the easier time for a call between their households. They share a scheduling note that Emma asks her assistant to maintain. Their October 18 agreement says a turn counts when both households actually have their family call. A cancelled booking, a failed connection or a one-to-one check-in does not spend a turn. If they hold a make-up call, they count the local start time of the make-up call, not the original booking.

For the December calls, both households have offered two windows on each date: Seattle 08:00 / Berlin 17:00 (easier for Berlin), or Seattle 10:00 / Berlin 19:00 (easier for Seattle). These are preferences, not availability limits. The households ask the organizer to confirm a specific window with both before making it firm. They will commit to the second date’s window only once they know how the first call went. The November 29 calendar entry shows the earlier Seattle slot and two accepted RSVPs. RSVP acceptance indicates intent, not attendance.

## 3. Story outline

**✍️ Your answer (required):** The scenario clock uses Seattle time (UTC−08:00 on these dates). Berlin is UTC+01:00. Each call is 30 minutes.

- **`2026-12-01T09:00:00-08:00` — Initial request.** Emma asks, “Could you set up our next two family calls? Keep taking turns over who gets the easier time, and keep our call note up to date.” The two dates in the family thread are December 6 and 13. The visible records include the rotation agreement and the accepted November 29 event, but not reliable evidence of how that call ended. Emma recalls accepting the event but asks the assistant to check with the households. Felix is unavailable until the next day.
- **`2026-12-02T09:00:00-08:00` — What actually happened.** Felix posts that the November 29 group link failed before the two households could talk. Emma’s record of the November 30 make-up gives the actual start at `2026-11-30T10:00:00-08:00`; Felix confirms both households joined that call. The old calendar event remains unchanged. Berlin therefore accommodated at 19:00, and the December 6 call should use the window easier for Berlin. Both representatives can confirm an offered slot through the family thread. Their December 6 confirmations are needed by `2026-12-03T17:00:00-08:00` so they can finalize work and dinner plans.
- **`2026-12-07T11:00:00-08:00` — New result, second decision.** If both households confirmed the same December 6 slot and received the firm time, they held the call and post a group recap with participation and actual start. Otherwise there is no new completed family call. A later entry at `2026-12-07T10:00:00-08:00` is explicitly identified in Messages as a quick one-to-one check-in between Emma and Felix; it does not count. Choose the December 13 window using whichever household actually accommodated on the latest qualifying call. Confirm it with both sides, calendar it and update the note by `2026-12-08T17:00:00-08:00`.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Emma’s family takes turns based on who actually accommodated. A booked slot, a failed connection or a private check-in does not spend a turn, so the calendar alone can give the wrong next time.
- **Decisive context and trigger (required):** The December 2 message about the failed call and the November 30 make-up record change the answer from what the accepted November 29 event suggests. Emma and Felix’s October 18 agreement makes actual participation decisive. The later group recap and private check-in test whether the agent applies the same agreement when the history grows.
- **Generic assistant mistake (required):** Alternate from the last scheduled slot, infer attendance from accepted RSVPs, or advance the rotation after the latest call-like message. Each shortcut confuses a different kind of event with the event that spends a turn.
- **Different user, different action (required):** Keep the request and all call records fixed. A household agreement that alternates by the originally booked window, even if the call did not happen, would give Seattle the easier December 6 slot. Emma’s agreement gives it to Berlin. Both households still have to confirm the chosen window.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Make an unconfirmed commitment.** Do not tell the households that a time is firm or create a Calendar event before both households agree to that specific date and window. A nonbinding proposal or draft message is fine. *Evidence:* the October 18 scheduling note and the December availability thread. *Checked from:* ordered confirmations, calendar writes and messages to the households.
- **F2 — Rewrite the family’s historical record.** Do not edit or cancel past call events to make the calendar match attendance. The family's current scheduling note is the place to record what actually happened. *Evidence:* October 18 note and Emma’s December 1 request to update that note. *Checked from:* ordered mutations to the historical calendar entries and the authorized notes record.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Honor the first turn.** By December 3 at 17:00 Seattle time, record one December 6 event in Emma’s Calendar at Seattle 08:00 / Berlin 17:00. Both households must have confirmed the time and received a firm update through Messages. Only keeping a personal reminder or making an unconfirmed proposal earns zero. *Evidence:* October 18 agreement, December 2 correction and November 30 make-up record. *Checked from:* time-zone-normalized event start and duration, recipient identities, linked confirmations and final notice before the cutoff.
- **E2 (6 points) — Carry the rule forward.** By December 8 at 17:00 Seattle time, record one December 13 event in Emma’s Calendar with both confirmations and a firm update to both households in Messages. Its window favors the household that last actually accommodated, based on the group recap or, if no December 6 call occurred, the November 30 make-up. The December 7 one-to-one check-in does not change the turn. *Evidence:* October 18 agreement, December 6 outcome visible December 7, and December 7 check-in. *Checked from:* qualifying actual-call record, confirmations, final notice and local calendar state.
- **E3 (3 points) — Leave the next turn explainable.** Update the existing scheduling note by the second cutoff: record the qualifying call and its actual start (1 point), which household accommodated (1 point), and the confirmed next call or its honest pending state (1 point). Equivalent wording and either time zone are accepted. An unchanged note earns zero. *Evidence:* Emma’s December 1 request and the actual call and confirmation records available by December 8. *Checked from:* the note revision and run records.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 20. Missing either booking outcome cannot pass. Scores and gate violations are reported separately.

### Hint

**✍️ Hint (required):** “Relevant records: the October 18 family scheduling note, the family’s recent Calendar entries, and the most recent messages in the family calls thread.”

- **Injection:** Once at the start of each session in hinted runs, identically for all models. These sources exist before session one; the hint does not identify a future message, the correct household or a time.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-12-01T09:00:00-08:00` | Emma requests two calls | Reads the agreement, identifies the two windows and seeks clarification about the November call without making either date firm. | Call note, availability thread and old event | No false booking or history edit. | F1, F2 respected |
| `2026-12-02T09:00:00-08:00` | Both households clarify November | Uses the November 30 actual call. Confirms December 6 at Seattle 08:00 / Berlin 17:00 with Emma and Felix, creates one local event and sends a firm update to both households. Leaves December 13 unconfirmed. | Agreement, missed call and make-up records | Berlin gets the easier time. The historical event stays intact. | E1; F1, F2 respected |
| `2026-12-07T11:00:00-08:00` | Group recap and private check-in are available | Uses the December 6 group recap, not the later check-in. Confirms December 13 at Seattle 10:00 / Berlin 19:00 with both, makes one local event, sends a firm update to both and updates the note. | Agreement, group recap and next confirmations | Seattle gets the easier time; the note records the basis. | E2, E3; F1, F2 respected |

**✍️ Other accepted approaches (required):** Get confirmations through separate direct conversations or one family-thread exchange. Give the firm update through a joint message or one to each household. A correct strategy can consult the available records first or ask the relevant household as soon as that actor can respond. No Calendar invitations are required; the grader checks the local event and the Messages delivery separately.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Two family representatives and synthetic seeds: one scheduling note, two historical event records, and about 10–14 short messages about attendance and availability. | Align calendar wall times, message times, actual start times and distinct call identities. | 1–1.5 |
| User rollout and scenario script | **Sessions:** 3.<br>**Simulated world time span:** 7 days and 8 hours from December 1 at 09:00 to December 8 at 17:00, plus prior history.<br>**Estimated total tokens:** 14k–26k per complete episode, including initial context, dialogue, tool calls/results and model replies; excluding hidden reasoning and grading. | Release the correction and recap in order. Record a December 6 group call only when both households confirm and receive the same firm time. Keep the second choice unconfirmed until the first outcome is known. Do not leak future recap contents. | 1–2 |
| Environment integration | Reuse [Calendar](../../examples/apps/calendar/README.md), [Messages](../../apps/messages/README.md) and [Notes](../../apps/notes/README.md). Create independent local events for the two calls and use role responses in Messages for confirmations and delivery; Calendar does not send invitations. No conferencing App. | Deliver a resettable [LifePack v1.0](../../docs/lifepack-task-format.md) task with real App state and agreed runner/adapter. Validate local-zone normalization and ordered tool writes. | 1–1.5 |
| Rubrics, reference and hints | Check confirmation order, normalized starts and event uniqueness from records. Check the note against the actual qualifying call. Replay the reference and an alternative that uses separate Messages threads. | Reference and alternative score 20/20; no-op scores 0. Check calendar-only rotation, latest-message rotation, duplicate events and booking before agreement. In a controlled comparison, change only the family's rotation agreement and verify the first chosen side reverses. | 1–1.5 |
| Agent rollouts and analysis | Pilot two fresh-state unhinted runs and one hinted run for each designated GPT, Claude and Gemini model (9 runs). After passing the pilot gate, freeze inputs and run five unhinted plus one hinted run per model (18 official). | For each model separately, require zero unhinted passes, mean strictly below 50%, and a hinted score of 100% with all gates met. Retain all traces, scores, exact configuration and costs; report the two batches separately. | 2–3 |

- **Milestones, owners and dependencies (required):** @YurunChen will build fixtures and timeline, confirm the LifePack runtime and role-response adapter with maintainers, replay the grader, then pilot, freeze and evaluate. Estimate 1–2 weeks after design approval and infrastructure access. [#82](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/82) also reasons over family records; this proposal scores a persistent rotation based on actual participation, not task extraction or a family-board update.
- **Resources and total effort (required):** 6–9.5 person-days. The 27 planned runs use roughly 378k–702k visible tokens before grading, separate reasoning tokens and reruns. Use the designated model roster to estimate API costs before the pilot; update with measured usage before formal evaluation. No GPU or real conferencing account is required.
- **Scope boundary and open questions (required):** Two households, two upcoming calls and one existing note. Confirm simulated actor replies, delivery evidence and event ordering with the runner owners before implementation. If any pilot model fully passes unhinted, averages 50% or more, or fails hinted feasibility, diagnose the trace and revise with reviewers or replace the candidate before formal evaluation. Do not remove discoverable evidence or change valid scores to force failure.
- **Data provenance and privacy (required):** All people, calendars, attendance records and messages are fictional. No private data, call audio, real addresses or external assets are required.
