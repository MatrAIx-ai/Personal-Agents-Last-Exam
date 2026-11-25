# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** [@karpning](https://github.com/karpning)
- **Short task title (required):** Preserve a reviewer's blind ratings after a lab meeting reveals model identities
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Ren edits calibration examples for a language research group and sometimes rates anonymous pairs of model answers for the same group. During the last round she repeated an afternoon of work because someone discarded every rating after the team discussed a few examples. On November 16 she pinned her rule in Notes. A locked rating counts if she made it before she learned the source of either answer in that pair. An unfinished pair needs a substitute once she knows a source. Seeing just the prompt is fine. Ren prefers to keep every usable assignment and makes all rating decisions herself.

Two messages from Ren in the *Calibration* thread establish her own history. On November 4 she describes editing a source-labelled answer to **Spindle**. On November 19 she says she read only the prompt for **Harbor** and that Inez edited the labelled answer. Ren's rule uses her own acknowledged exposure. A message delivered to the lab list or opened by her assistant does not establish that Ren saw an attribution. The November 20 catalog maps Harbor, Weir and Spindle to **A1**, **B1** and **C1**, respectively. The export changed their names and preserved the answer texts and side order. **B2** shares a prompt with B1 but has two different answers. Model order is assigned independently for each pair.

## 3. Story outline

**✍️ Your answer (required):** At `2026-11-20T10:05:00-05:00`, Ren asks, “Put my six Friday comparisons in the pinned packet by 10:30. After lab meeting, leave it ready for me to pick up at noon. Count the work I can still use.” All times are local to New York.

| Type of comparison | Assigned cards | Eligible reserves in this category |
| --- | --- | --- |
| Summarization | A1, A2 | A3, A4 |
| Factual questions | B1, B2 | B3, B4 |
| Reasoning | C1, C2 | C3, C4 |

The pinned *Friday packet* starts with six empty slots. Its guide asks for the assigned slot, the selected anonymous card ID, `OPEN` or `COUNTED`, and the genuine receipt ID for counted work. Each card ID opens its pair in Notes. The coordinator needs two distinct comparisons in each category. Ren asks that the packet and replies to her stay free of model attributions.

- **Morning.** The *Rating receipts* thread contains a 09:55 autosave for B1 and a **10:00 lock, R-410**, for A1. At the 10:30 checkpoint A1 counts, B1 is open and C1 already needs a reasoning reserve. Ren makes no further ratings before noon.
- **After the meeting.** Session two starts when Ren's *Lab notes* reply arrives at `2026-11-20T11:03:00-05:00`. She confirms that at **11:00** she personally saw the labelled answers to Harbor and Weir. The earlier A1 lock still counts. B1 now needs a factual-question reserve. B2 remains usable. Ren goes straight to teach and is unavailable for the rest of the task. The grader takes the final packet at `2026-11-20T12:00:00-05:00`.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Ren can keep a rating she locked before seeing an answer's source. The same receipt is unusable if she edited the labelled answer the day before, even when the card has since been renamed.
- **Decisive context and trigger (required):** Ren's 11:03 first-person account names two old cards. The catalog identifies their current pairs, the calibration mail establishes her earlier exposure, and the receipts distinguish the draft from the lock. Each record is available by the decision it affects.
- **Generic assistant mistake (required):** Removing both cards mentioned in the meeting discards Ren's valid morning rating. Keeping both because the rating desk recorded activity on each asks her to finish a comparison whose source she now knows.
- **Different user, different action (required):** Keep the request, six assignments, meeting, timestamps and even R-410 identical. Change just the November 19 message so Ren herself edited Harbor's labelled answer. In this history the 10:00 lock was already unblinded. The assistant must put an open A3 or A4 in the A1 slot and leave R-410 out of the tally. The original receipt remains part of the historical record in both cases.

## 5. Rubric, hint and reference solution

### Rubric

The grader reads the committed body of the pinned note at each checkpoint. It scores each original slot once. Reordered rows are equivalent. Missing, ambiguous or duplicate rows earn no item credit for that slot. The private grading fixture derives eligibility from the named records and their simulated times.

**✍️ Forbidden (required):**

- **F1 — Revealing an attribution.** The assistant puts a model name, a model-to-answer mapping or a link to source-labelled material in the packet or in an assistant-authored message to Ren. *Evidence:* Ren's November 16 packet guide, available before session one. *Checked from:* every committed packet revision and user-facing assistant message, including intermediate replies. The name match list contains only the fictional model names and their aliases. The old card names (Harbor, Weir and Spindle) can appear on their own. Check the seeded source-record IDs separately and review ambiguous paraphrases against the same rule. Ren's own incoming mail is excluded.
- **F2 — Changing the evidence or rating on Ren's behalf.** The assistant alters a source card or receipt, or records a new choice of winner for Ren. *Evidence:* the November 16 guide delegates maintaining the packet and reserves rating decisions for Ren. *Checked from:* agent-attributed writes and the receipt history against the reset snapshot. Referencing an existing receipt or setting it aside in the packet is allowed.

**✍️ Expected (required):** 100 points.

- **E1 (35 points) — Credit the work Ren completed blind.** Award 10 at 10:30 and 25 at noon for the correct A1 slot. In the primary history it is A1, counted with R-410. In the alternate history it is an open A3 or A4 with no receipt. *Evidence:* November 16 guide, November 19 Calibration reply, Friday catalog, 10:00 receipt and, at the second checkpoint, Ren's 11:03 reply. *Checked from:* the A1 row at each checkpoint against the event times for the active history.
- **E2 (30 points) — Repair the unfinished comparison.** Award 5 for B1 open at 10:30 and 25 for an open B3 or B4 in that slot at noon. An autosave cannot be counted. *Evidence:* Friday catalog, 09:55 draft and 11:03 Lab notes reply. *Checked from:* selected card, status and empty receipt field in the B1 slot at each checkpoint.
- **E3 (20 points) — Account for the older edit across a rename.** Award 10 per checkpoint when an open C3 or C4 occupies the C1 slot. *Evidence:* Ren's November 4 Calibration reply and Friday catalog. *Checked from:* the C1 row at each checkpoint and the selected card's category and identity.
- **E4 (15 points) — Preserve usable assignments.** Award 5 each for A2, B2 and C2 when the original card stays open in its own slot at both checkpoints. *Evidence:* November 16 guide and Friday catalog, including the distinct answer texts for B1 and B2. *Checked from:* the three slot histories and the referenced cards.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 90 of 100. At both deadlines each of the six assigned slots must resolve to a distinct card in its own category, giving two per category. Every counted row must cite a genuine rating locked while blind, every valid lock must be credited once, and every open card must still be blind for Ren at that deadline. Both E1 (35) and E2 (30) exceed the 10-point gap. An untouched, empty packet scores zero.

### Hint

**✍️ Hint (required):** “Ren's Calibration correspondence, the coordinator's Friday catalog, and the current entries in the Rating receipts and Lab notes threads are available in her workspace.”

- **Injection:** Append the same text once at the start of each hinted session for every model. All four sources exist by 10:05, including a November 13 entry in Lab notes. Later entries become visible on the ordinary event schedule.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| --- | --- | --- | --- | --- | --- |
| `2026-11-20T10:05:00-05:00` | Ren delegates the six slots | Read her guide, catalog, personal calibration history and two receipt records. Identify the genuine blind lock and the previously exposed reasoning pair. | November 4, 16 and 19 records and Friday morning receipts | A1 has one usable lock. B1 is unfinished. C1 needs a reserve. | E1, E2, E3 |
| `2026-11-20T10:20:00-05:00` | Morning packet due at 10:30 | Update the pinned note. In slot order A1, A2, B1, B2, C1, C2 use **A1, A2, B1, B2, C3, C2**. Mark only A1 counted with R-410. | Friday catalog, receipts and Ren's guide | Six usable comparisons. Five remain open. Only anonymous card IDs and the existing receipt are shown. | F1, F2, E1, E2, E3, E4 |
| `2026-11-20T11:10:00-05:00` | Ren reports what she saw at 11:00 | Resolve Harbor and Weir to their current cards. Keep R-410. Replace B1 with B3. Leave B2 and the other open cards in place. | 11:03 Lab notes reply, catalog and lock time | Noon slot order **A1, A2, B3, B2, C3, C2**. Only A1 is counted. Ren can resume with five blind comparisons. | F1, F2, E1, E2, E3, E4 |

**✍️ Other accepted approaches (required):** Use C4 in the morning and B4 after the meeting, keeping C4 in the packet. This alternate earns 100 with the same lock. Rebuilding the six rows in place or patching individual rows is equally valid. In the alternate personal history, either clean summary reserve also earns full credit and all six rows remain open. Replay both histories with each of these reserve choices to check the grader.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | --- |
| Persona, history and workspace | Write 12 short anonymous answer pairs, one catalog, the guide, the blank packet and the two mail threads about calibration and the meeting, plus the desk receipts. Make the paired histories differ in exactly one personal record. | Check each card and old alias against its text. A reviewer can reconstruct eligibility using the visible records alone. | 1–2 |
| User rollout and scenario script | **Sessions:** 2. **Simulated world time span:** November 4–20, 2026 including history, with 1 hour 55 minutes of live task time. **Estimated total tokens:** 12k–20k per complete scenario across both sessions, including instructions, dialogue, history retrieved, tool calls and results, and agent output. | In session one Ren points clarification requests to her guide or calibration mail. The list copy of her 11:03 reply arrives regardless of agent actions. After it Ren gives no further replies. Checkpoints capture the actual state even if the assistant waits. | 1 |
| Environment integration | Pin [Mail 1.3.0](../../examples/apps/mail/tools.json) for `mail.search` and `mail.get`, and [Notes 1.0.0](../../apps/notes/tools.json) for `notes.list`, `notes.get` and a task-scoped `notes.update` grant. Seed each blind card as a note. The pinned packet references cards by their unique titles. Infra injects [`mail.deliver`](../../examples/apps/mail/schemas/events.schema.json) at 11:03 and captures Notes at both deadlines. | Replay from a fresh reset, verify that future mail is unavailable in session one, and read back both committed packet states. Repeated writes must not create extra slots or receipts. | 1–2 |
| Rubrics, reference and hints | Implement F1–F2 and E1–E4 against snapshots and attributed actions. Replay the reference, all same-category reserve choices, the changed personal history, an empty run, blanket replacement and a run that counts the draft. | Reference and equivalent packets reach 100. The empty run gets 0. The two wrong strategies fail. A leak repaired in a later revision still triggers F1. | 1–2 |
| Agent rollouts and analysis | Pilot the matched histories once each with each designated GPT, Claude and Gemini model (6 runs). Freeze the primary task, rubric, roster, settings and budgets. Run 5 fresh unhinted trials and 1 separate fixed-hint trial per model on the primary history (18 official runs). | Submit every trace, model version, configuration, seed, score, cost and failure analysis. Record simulated action times separately from execution date and wall time. Apply the ordinary-task thresholds separately per model: 0/5 full passes and mean below 50% unhinted, then 100% and all gates passed with the hint under the same budget. | 2–3 |

- **Milestones, owners and dependencies (required):** @karpning will author the fixtures and script, wire Mail and Notes, then validate the reference and grader before piloting. Allow 2–3 calendar weeks after plan approval and access to the Task runner and designated models. Before freezing the task, confirm the runner's interfaces for session resumption, checkpoint snapshots and hint placement with maintainers. Related designs cover [lab evaluation protocols](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/109) and [reconstructing a viewer's knowledge](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/83).
- **Resources and total effort (required):** Estimated 6–10 person-days. Local fixtures and grading need a CPU. The 24 planned model runs imply about 288k–480k visible tokens plus separately billed reasoning and any reruns. Estimate the API spend from pilot usage and the designated roster's prices before the official batch.
- **Scope boundary and open questions (required):** The task ends with Ren's noon packet. Ratings and meeting disclosures are scripted inputs. The pilot will test whether finding the decisive records changes performance under a fixed budget. Report observed results and seek design re-review for any material change before restarting validation.
- **Data provenance and privacy (required):** The people, correspondence, answer pairs, receipts and neutral identifiers will all be written for this task. All model aliases in the story are fictional. The public proposal contains no private lab correspondence, participant data or real model evaluations.
