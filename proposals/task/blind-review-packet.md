# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** [@karpning](https://github.com/karpning)
- **Short task title (required):** Preserve a reviewer's blind ratings after a lab meeting reveals model identities
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Ren edits calibration examples for a language research group, rates anonymous answer pairs and records audio for the North Gallery with Lila. At the gallery the reader speaks the source credit before reading the answer. Ren’s September 22 conversation with Lila identifies the takes Ren read herself. The recording script preserves the answer texts under gallery titles. The same texts appear under anonymous card IDs in the lab. Hearing a question alone leaves the answer blind.

In July, Ren signed the director’s rule for deciding whether a candidate system can replace the incumbent. On October 9 she delegated her Friday review preparation to the assistant, including Fridays when she has a museum errand. Her November 16 packet guide reserves every choice of winner for Ren. The assistant can organize her work, book a private desk and deliver the director’s decision.

## 3. Story outline

**✍️ Your answer (required):** At `2026-11-20T10:05:00-05:00`, Ren asks, “I'm between buildings. Could you tell Lila which entrance to use for the audio-kit drop and how to get buzzed in? Facilities sent the details.” Lila is driving over. Today’s Facilities mail gives the Willow Lane side entrance and the blue bell. The recurring Friday task in Tasks and Ren’s October mail also call for a working packet by 10:30. All times are local to New York.

- **Before the meeting.** There are six original comparisons, two each for summarization (A1/A2), factual questions (B1/B2) and reasoning (C1/C2). Each category also has two reserve cards. The pinned packet needs one distinct card per slot, marked `OPEN` or `COUNTED`, with the genuine receipt for each counted card. Previously exposed, unfinished originals need clean reserves. Ren has private desk appointments at 10:27 and 10:29. Each can hold one card. An exposed, already signed or reserve card consumes its appointment. Ren makes and signs each private choice herself. The desk returns a receipt for each eligible booking she completes.
- **After the meeting.** Session two opens at `2026-11-20T11:03:00-05:00` with Ren’s noon handoff request and her *Lab notes* reply. She confirms that at 11:00 she saw source-labelled answers for all six originals. The reserves are still blind. At noon she needs the working packet. The director needs a private appendix on the six original nominations and one instruction dispatched through the release desk. Replacing a card keeps Ren’s working queue usable. A reserve supplies no vote for the director’s original sample.

## 4. What makes this distinct and personal

- **Personalization insight (required):** A gallery recording can spoil a ballot months before the lab uses it. Which credited answers Ren personally read determines how to spend her two private appointments and whether the director can authorize a switch.
- **Decisive context and trigger (required):** Ren’s September account in Messages names her credited takes. The script in Files identifies the corresponding answers, and the card texts in Notes identify the anonymous pairs. The desk receipts distinguish a signed choice from an autosave. All are available before the appointments. The 11:03 disclosure then closes the chance to recover another independent original vote.
- **Generic assistant mistake (required):** An assistant can correctly direct Lila to the building yet miss the standing assignment until Ren asks for her packet after the meeting. It can still report the honest range of 2–6 wins and choose `HOLD`. By then it has lost two votes that Ren could have cast blind.
- **Different user, different action (required):** Keep the requests, cards, receipts and meeting identical. Change only Ren’s September account of her own takes. In both histories she voiced *Bottle pickup* (A1) and heard just the *North Pier* question. In the primary history she also voiced *Marker correction* (B2), so book B1 and C1. In the alternate she voiced *Tray sequence* (C1), so book B1 and B2. The B1 autosave alone supplies no signed vote. With the correct bookings the primary history supports `SWITCH` and the alternate supports `HOLD`.

## 5. Rubric, hint and reference solution

### Rubric

The grader reads the working packet immediately before the first desk appointment and again at noon. It checks deliveries to Lila at 10:30, the desk’s signed returns, the private appendix and the saved release instruction. It derives the eligible votes and the correct decision from the history and the appointments that actually ran.

**✍️ Forbidden (required):**

- **F1 — Disclose an answer attribution to Ren.** A fictional model name or alias, or an explicit mapping from the candidate or incumbent to an answer side, breaks the blind handoff. Old card names such as Harbor and Weir can appear on their own. *Evidence:* Ren’s November 16 guide and the private side key. *Checked from:* every committed working-packet revision and every direct assistant message to Ren, including earlier versions later corrected.

**✍️ Expected (required):** 100 points.

- **E1 (10 points) — Get Lila to the entrance.** Award 5 for sending Lila the Willow Lane entrance and 5 for giving her the blue-bell instruction with that entrance. *Evidence:* the 09:59 Facilities notice and Lila’s 10:01 message. *Checked from:* sent email or direct messages to Lila by 10:30.
- **E2 (45 points) — Secure Ren’s independent votes.** In each history two unsigned originals remain eligible. Each genuine new desk receipt earns 22.5 points. Choosing an ineligible card uses up one slot. *Evidence:* the October duty, the November 18 desk notice, Ren’s personal recording history, the card texts and prior receipts. *Checked from:* the confirmed appointments and the desk’s signed returns before disclosure.
- **E3 (20 points) — Keep two usable working packets.** Award 10 per checkpoint, equally across the six rows. A blind lock needs its original card and receipt. A still-blind unsigned original stays open. An exposed original without a blind lock needs a distinct, unused same-category reserve with an empty receipt field. *Evidence:* the November 16 guide, catalog, recording history, desk receipts and, at noon, Ren’s 11:03 reply. *Checked from:* both packet snapshots, slot uniqueness, exposure and receipt timing.
- **E4 (5 points) — Register the qualifying original receipts.** Full credit requires exactly the independent signed receipt IDs for the six nominations. Partial credit is proportional to the size of the overlap divided by the size of the union of reported and eligible IDs. *Evidence:* the July brief, nomination list and desk returns. *Checked from:* the receipts admitted in the director’s saved appendix.
- **E5 (10 points) — Bound the candidate’s wins on the original six.** Award 4 for each correct endpoint and 2 for naming the fixed sample. If `k` originals have eligible votes and `w` of those favor the candidate, the interval is `w` through `w + 6 − k`. *Evidence:* the July brief, November nominations, private side key and signed returns. *Checked from:* the sample and bounds in the appendix against the votes actually recovered.
- **E6 (10 points) — Recommend and dispatch the supported instruction.** Award 5 for the correct recommendation in the appendix and 5 for saving exactly one matching instruction at the release desk. Use `SWITCH` if the lower bound is at least four, `STAY` if the upper bound is below four, and `HOLD` otherwise. *Evidence:* the July brief and release-desk form. *Checked from:* the committed appendix and the selected option in the saved release note.

**✍️ Full pass (required):** A full pass requires at least 100 of 100 points and all seven gates. Six gates check entrance delivery, both attainable independent votes, correct working packets at both checkpoints, the exact receipt register, the supported range on the original six, and a correct recommendation with matching dispatch. A forbidden disclosure under F1 fails the seventh gate. A late packet repair earns noon credit while the morning snapshot retains its original score.

### Hint

**✍️ Hint (required):** “Ren’s Friday coverage task, the desk’s November 18 notice, her packet guide and the desk receipts are in her workspace. Her July brief is in Mail, her September conversation with Lila is in Messages, and the North Gallery recording script is in Files.”

- **Injection:** Append this exact text once to the opening instruction of each hinted session for every designated model. All named records exist before the first session. The November 26 pilot used a longer hint that also described actions. The formal batch will evaluate the source-only wording above.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| --- | --- | --- | --- | --- | --- |
| `2026-11-20T10:05:00-05:00` | Ren requests the kit drop instructions. | Read today’s Facilities notice and send Lila the Willow Lane and blue-bell details. Find the Friday duty. | Facilities mail, Lila’s message, recurring task | Lila has both directions before the unloading window closes. | E1 |
| `2026-11-20T10:20:00-05:00` | Prepare the morning packet and reserve two appointments. | Match Ren’s credited takes to the cards. In primary slot order A1, A2, B1, B2, C1, C2, enter A3, A2, B1, B3, C1, C2. Count only A2 with R-392 and C2 with R-403. Book B1 and C1 by anonymous ID. | September conversation, script, guide, catalog, desk notice and receipts | A1’s R-410 follows prior exposure and B1’s autosave D-409 is unsigned. The pre-appointment packet contains six usable rows. | F1, E2, E3 |
| `2026-11-20T10:27:00-05:00` and `2026-11-20T10:29:00-05:00` | The desk honors the booked order. | Leave the private choices to Ren. | Confirmed shortlist and desk events | Ren signs B1 (R-452) and C1 (R-454). The desk records both before the reveal. | F1, E2 |
| `2026-11-20T11:03:00-05:00` to `2026-11-20T12:00:00-05:00` | The meeting ends and Ren requests the noon handoff. | Count B1 and C1 with their new receipts, retain A2 and C2, and keep clean reserves in the other two slots. Enter R-392, R-403, R-452 and R-454 in the private appendix, calculate 4–6 candidate wins, recommend `SWITCH` and save that selection. | Ren’s disclosure, original nomination list, July brief, private side key and desk returns | Ren has a blind working packet. The release desk has dispatched the instruction supported by four independent candidate wins. | F1, E3, E4, E5, E6 |

**✍️ Other accepted approaches (required):** Either clean reserve in a category can fill an exposed slot, subject to uniqueness. Email and direct message both work for the entrance. The desk accepts neutral IDs given directly to Ren, a booking line in the packet, or one or two unambiguous `OPEN` originals in their own slots when there is no explicit booking. In the alternate history, B1 and B2 return R-452 and R-453. Together with R-392 and R-403 these establish three candidate wins, one incumbent win and two unresolved originals. The 3–5 interval calls for `HOLD`.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | --- |
| Persona, history and workspace | Use the focused gallery and review history from July 12 to November 20, 2026, including 12 anonymous card notes. The five Apps cover 21 distinct local dates before the first session. | Deduplicate Mail receipt dates and Messages, Files, Notes and Tasks creation dates in `America/New_York`, using the 10:05 first-session cutoff. The relevant history links Ren’s personal recordings to these six nominations. | 1–2 |
| User rollout and scenario script | **Sessions:** 2. **Simulated world time span:** July–November history and 1 hour 55 minutes of live work. **Estimated total tokens:** about 135k–760k provider-reported tokens per completed two-session pilot, including repeated input context, tool records and model output. | Preserve both appointment events, delayed meeting disclosure and checkpoint states across sessions. Ren can clarify bookings in the morning and is teaching after the meeting. | 1 |
| Environment integration | Pin Mail 1.3.0 and Notes, Messages, Files and Tasks 1.0.0. Mail delivers signed desk returns, Files supplies the recording script, and Notes holds the editable packet, appendix and release. | Package the task in LifePack format. Replay a clean reset, retrieve the recording text, verify the sent entrance directions, and trace each new receipt and saved handoff across both sessions. | 1–2 |
| Rubrics, reference and hints | Replay both matched histories and accepted alternatives. Exercise missed appointments, wrong bookings, a late packet repair, disclosure to Ren, and an uncommitted dispatch. Freeze the rubric and the exact hint in Section 5. | The reference scores 100 in both histories and doing nothing scores 0. The local prototype includes 21 workflow checks and 62 booking checks. Deliver their results with the grader. | 1–2 |
| Agent rollouts and analysis | After design approval and publication of the dated roster, freeze the primary task, grader, hint, model IDs, settings and budget. Run **one independent unhinted trial and one separate fixed-hint trial per designated GPT, Claude and Gemini model** from fresh state on the primary history, six valid runs in total. The paired histories are reference and grader controls. | Report the observed full-pass count and mean for each model. Qualification requires `0/n` full passes and a mean strictly below 50% unhinted (`n = 1` planned), then 100% and all seven gates with the fixed hint under the same budget. Include every attempt, trace and score, versions, seeds where available, costs and failure analysis. Identify infrastructure interruptions separately. Record simulated timestamps and real execution dates and durations. | 2–3 |

- **Milestones, owners and dependencies (required):** @karpning will package the approved scenario, replay the reference and alternatives, and validate the designated models. The exact model IDs are pending the first infrastructure release. Aim to submit the first complete implementation and evidence within 14 days of that release, as requested in the [original review](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/175#pullrequestreview-6061899920).
- **Resources and total effort (required):** Estimate 6–10 person-days including prototype construction. One CPU can run the environment and grader. Budget 64 turns and 900 seconds per session, with up to 8,192 output tokens per completion, equally for both conditions. Use roster pricing and the measured input/output split to budget API charges once the model IDs are published.
- **Scope boundary and open questions (required):** The task ends with Ren’s noon packet and the director’s recorded instruction. A later independent follow-up is outside the scenario. The three model IDs reported on November 26 each scored 45/100 unhinted (0/1 full passes) and 100/100 with the exploratory hint (7/7 gates). The formal validation uses the approved hint and dated roster. [Pilot results](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/175#issuecomment-7198670732) · [Validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation)
- **Data provenance and privacy (required):** Ren, Lila, the correspondence, recordings, answer texts, model aliases and desk receipts are fictional fixtures authored for this task. The director’s key and the blind packet have separate audiences inside the simulation.
