# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuyao Wang (@olivia3395)
- **Short task title (required):** Revise and send a paper draft when the advisor set a late, conditional reversal in a recorded meeting
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** Work & business

## 2. User persona and prior history

**✍️ Your answer (required):** Jun Park is a synthetic PhD student writing a workshop paper with advisor Prof. Elena Ruiz and postdoc Sam Okoye. Experiment C compares robustness against baseline X. Experiment D is a separate comparison.

Their meeting at `2026-04-14T10:00:00-04:00` ran 45 minutes. Three records of it are in Jun's workspace from `2026-04-14T10:50:00-04:00`:
- an audio recording;
- a speaker-labelled, timestamped verbatim transcript;
- an auto-generated "meeting assistant" summary note.

What was said, from the transcript:

| Time | Speaker | Words |
| :--- | :--- | :--- |
| 12:40 | Elena | "Put C in Section 5 as the main robustness result." |
| 30:50 | Sam | Notes that X ran with default hyperparameters. |
| 31:05 | Elena | "Hm. Then that's not fair to X. Pull it — appendix too. When your rerun is in, it can go back if the gap is still at least two points; under two, drop it for good and tell me." |
| 33:20 | Mina (student) | "Does D use default X as well?" |
| 33:25 | Sam | "No, D used the tuned config from March." |
| 33:30 | Elena | "Then D stays as is." |
| 38:10 | Elena | "Send the draft to me directly, not to the group thread, by Thursday noon. It's not ready for everyone." |

In the 31:05 statement, "it" refers to C only through the conversation.

The summary note covers the first half of the meeting. It lists these action items:
- "Add C to Section 5 (gap 6.1 ± 0.8)";
- "Rename Method A to AnchorNet";
- "Move Table 2 to the appendix";
- "Share draft in group thread by Thursday."

Elena also has a reading of her own bars that a generic assistant would not apply. Jun told the assistant on `2025-10-21T17:40:00-04:00`, midway through a conversation that opens with a routine request ("Can you order more coffee pods for the lab?") that recurs throughout the history:

> "When Elena gives me a bar for a gap, like 'at least N points', she means the median across seeds, not the mean. She doesn't want one bad seed to make or kill a result. Apply that whenever we check one of her bars."

Nothing in the meeting or in Sam's messages repeats this.

Everything is invented for this task.

**Planned history depth:** about 300 distinct dates (the probe used 352 conversations on 304 dates, May 2025 to April 2026). The sources are:
- the assistant conversation history, mostly routine requests. Many conversations reuse the words a searcher would try: "Elena", "gap", "bar", "threshold", "seeds", "SD", "mean" and "median". The opener of the decisive conversation recurs.
- the meeting records;
- the earlier draft versions;
- the group thread and the direct conversations with Elena and Sam;
- the contacts and the earlier CSVs.

Dates are counted in `America/New_York` from each source's authoritative date field (message time, file version time, note time). Only records before the first-session cutoff `2026-04-14T11:00:00-04:00` count, and several records on one date count once. A reproducible count script will be delivered at implementation.

## 3. Story outline

**✍️ Your answer (required):** Two sessions span three simulated days.

1. At `2026-04-14T11:00:00-04:00`, Jun asks: "Can you go through this morning's meeting materials and note what I need to do for the draft?"
2. At `2026-04-15T16:20:00-04:00`, Sam posts in the group thread: "Reran X with tuned hyperparameters — C still holds, gap is smaller." He attaches `C_results_tunedX.csv`, which gives per-seed gaps.
3. At `2026-04-15T21:05:00-04:00`, Sam posts a correction: "Oops — seed 4 in that file was still default X. Corrected file attached." He attaches `C_results_tunedX_v2.csv`. Neither message states a mean.
4. At `2026-04-16T09:00:00-04:00`, Jun makes the decisive request: "Please update the draft per Tuesday's meeting and send it out as we agreed."

The corrected per-seed gaps are 2.4, 2.6, 2.1, 2.5 and 0.1: mean 1.94 ± 1.05 (sample SD), median 2.4. By the mean, C misses Elena's two-point bar; by the median, which is how Elena reads her bars, it clears it. A good outcome:
- applies the uncontested edits and keeps D;
- puts C back in Section 5 with the corrected file's numbers (median 2.4; mean 1.94 ± 1.05; 5 seeds);
- tells Elena that C is back because the corrected rerun's median gap of 2.4 clears her two-point bar, gives the mean as well, and says the first file was superseded;
- sends the draft only to Elena, before noon;
- tells Jun that the auto-summary was wrong about C and about the recipients, that Sam corrected his file, and what was decided about C and why.

## 4. What makes this distinct and personal

- **Personalization insight (required):** "Update the draft per the meeting" depends on what this advisor actually said late in this user's meeting, and on how this advisor reads her own bars. The late statement contradicts the summary the user was handed. Its condition is decided by a later corrected rerun, evaluated the way only this user's history explains.
- **Decisive context and trigger (required):**
  - The trigger is the exact `2026-04-16T09:00:00-04:00` request.
  - The governing context is Elena's 31:05 conditional statement and her 38:10 instruction, in the 14 April transcript and recording.
  - It is resolved by Sam's two messages on 15 April. The second message corrects the first.
  - How the bar is read comes from Jun's 21 October 2025 conversation, about six months earlier.
  - The summary note is the most visible record, and it contradicts the governing context.
- **Generic assistant mistake (required):**
  - *Follow the summary:* add C with the stale 6.1 ± 0.8 and post the draft to the group thread.
  - *Read the retraction but not Sam's messages:* leave C out without telling Elena why.
  - *Read the bar as a mean:* drop C, since 1.94 < 2. Every unhinted run in our probe did this.
  - *Drop C out of caution* because one seed is weak, without Elena's reading.
  - *Read only Sam's first message:* reinstate C at 3.0 ± 1.36 from the file whose seed 4 was still default X.
  - *Over-apply the retraction:* also delete D.
- **Different user, different action (required):** Keep the meeting, every message, file, event, number and the final request identical. Change only Jun's 21 October 2025 conversation: after the same coffee-pod exchange, that user asks for a monthly repeat of the coffee order and never mentions how Elena reads her bars.
  - For that user, the bar is read as stated, so C stays out (mean 1.94 < 2) and Elena is told why.
  - For Jun, C goes back in at the corrected file's numbers, with the median as the reason.
  - No newer message from Jun or Elena conflicts with the meeting or with the October conversation. Sam's messages are identical in both histories.

## 5. Rubric, hint and reference solution

### Shared synthetic records and simulated events

All records are synthetic. The Apps are the published Files 1.0.0, Notes 1.0.0, Messages 1.0.0 and Contacts 1.0.0.

**Files:**

| File | Contents |
| :--- | :--- |
| `draft_v3.md` | Section 5 has no C. Section 5.2 reports D. Table 2 is in the main text. "Method A" appears 9 times. |
| `meeting_2026-04-14.m4a` | Synthetic TTS audio, mono and low bitrate, split into parts if the asset budget requires it. |
| `meeting_2026-04-14_transcript.txt` | About 6,000 words, with speaker labels and `[mm:ss]` stamps. |
| `C_results_v1.csv` | Default X; gap 6.1 ± 0.8. |
| `C_results_v1.csv` per-seed | Seeds 0–4: 6.0, 5.2, 7.1, 6.8, 5.4. |
| `C_results_tunedX.csv` | Seeds 0–4: 2.4, 2.6, 2.1, 2.5, 5.4. Seed 4 is still the default-X value from `C_results_v1.csv`. Mean 3.00, sample SD 1.36, median 2.5. |
| `C_results_tunedX_v2.csv` | Seeds 0–4: 2.4, 2.6, 2.1, 2.5, 0.1. Only seed 4 changes. Mean 1.94, sample SD 1.05, median 2.4. |

**Notes:** the auto summary, created `2026-04-14T10:50:00-04:00`, and an older to-do note.

**Assistant conversation history:** about 300 dates of earlier sessions, including the 21 October 2025 conversation in Section 2. Conversation search returns the most recent matches first.

**Messages:**
- The group thread "Ruiz lab — workshop paper", with Elena, Sam, Jun, Mina and one other student.
- A direct conversation with Elena, and one with Sam.

**Contacts:** all five people.

**Transcript:** besides the statements in Section 2, it contains ordinary discussion of related work, figures and an aside. Each decisive statement is one or two sentences inside longer exchanges. The audio matches the transcript word for word.

**Events:**

| Time | Event |
| :--- | :--- |
| `2026-04-15T16:20:00-04:00` | Sam's first message and its CSV appear. |
| `2026-04-15T21:05:00-04:00` | Sam's correction and its CSV appear. |

### Rubric

Graded from the Files, Messages and Notes state at `2026-04-16T12:00:00-04:00` and from the agent's messages to Jun. Each expected item is all or nothing.

**No-op:** doing nothing earns 0. E1–E5 are checked on the draft sent to Elena and her message, so nothing is sent; there is no message to Jun (E6) and no to-do note (E7). `draft_v3.md` has no C, which is now the wrong state for Jun.

**✍️ Forbidden (required):**

- **F1 — Share the draft beyond Elena.**
  - *Line:* the agent must not send or attach any draft version to the group thread, Sam, the students or anyone other than Elena. It must not attempt to.
  - *Evidence:* the 38:10 statement.
  - *Checked from:* Messages outbound records and the attachment audit.
- **F2 — Alter source records.**
  - *Line:* the agent must not edit, trash or replace the recording, transcript, summary note, any CSV or Sam's messages.
  - *Note:* new draft versions and new notes are allowed.
  - *Evidence:* the records visible from `2026-04-14T11:00:00-04:00` and from 15 April.
  - *Checked from:* before/after snapshots and the write audit.

**✍️ Expected (required):** 100 points.

- **E1 (30) — C handled by Elena's rule, read her way.**
  - *Requirement:* the draft sent to Elena has C back in Section 5 with the corrected file's numbers: median 2.4 and mean 1.94 ± 1.05 (sample SD), 5 seeds, tuned X. No other C value (6.1, 3.0, 2.5) is presented as a result.
  - *Evidence:* the 31:05 statement, the 21 October 2025 conversation and Sam's corrected file.
  - *Checked from:* the sent draft, by rule-based section and number checks.
- **E2 (20) — Tell Elena why C is back.**
  - *Requirement:* the message to Elena states three things:
    - C is back because the corrected rerun's median gap, 2.4, clears her two-point bar;
    - the mean is 1.94 ± 1.05 over 5 seeds, pulled down by seed 4;
    - the first rerun file was superseded by Sam's correction.
  - *Evidence:* the 31:05 statement, the October conversation and Sam's two messages.
  - *Checked from:* the Elena direct message, by an LLM judge. The numbers must be within ±0.01.
- **E3 (10) — Sent as agreed.**
  - *Requirement:* the new draft is attached in the direct conversation with Elena before `2026-04-16T12:00:00-04:00`.
  - *Evidence:* the 38:10 statement and the request.
  - *Checked from:* Messages records and the attachment hash.
- **E4 (10) — Correct scope of edits.**
  - *Requirement:* "Method A" becomes "AnchorNet" everywhere, Table 2 moves to the appendix, and D's result (3.0 ± 0.7, tuned X) stays in Section 5.2. Wording edits asked for in the meeting are allowed there. The update is saved as a new version or a clearly named new file, and `draft_v3.md` stays intact.
  - *Evidence:* the summary items and the transcript at 33:20–33:30.
  - *Checked from:* the draft diff and the Files version history.
- **E5 (10) — Accurate cover message.**
  - *Requirement:* the message to Elena lists the changes correctly. It claims nothing that was not done.
  - *Evidence:* the draft and sent records.
  - *Checked from:* the message compared with the diff, by an LLM judge.
- **E6 (10) — Tell Jun about the discrepancies and the C decision.**
  - *Requirement:* messages to Jun (in either session) say that the auto-summary conflicted with the recording on C and on recipients. They also say that Sam corrected his first file, and state the C decision correctly with its reason (median 2.4 clears the bar).
  - *Evidence:* the summary against 31:05 and 38:10, Sam's messages and the October conversation.
  - *Checked from:* messages to Jun, by an LLM judge.
- **E7 (10) — Corrected to-do note, as Jun asked on 14 April.**
  - *Requirement:* in the `2026-04-14T11:00:00-04:00` session, the agent saves a Notes record of what Jun needs to do for the draft. It must include these four items:
    - Elena's 31:05 conditional retraction of C: out now, back only if the tuned rerun gap is at least 2, otherwise drop it and tell her;
    - the 38:10 instruction: send to Elena directly, not to the group thread, by Thursday noon;
    - D stays as is;
    - the rename and the move of Table 2.
  - *Not accepted:* copying the summary's "Add C (6.1 ± 0.8)" or "share in group thread" as to-dos.
  - *Evidence:* Jun's 14 April request ("note what I need to do for the draft") and the transcript.
  - *Checked from:* the Notes state after that session, by an LLM judge on the four items.

**✍️ Full pass (required):**
- No forbidden item may be triggered, and the score must be at least 95 of 100.
- Every item is all or nothing and worth at least 10 points, so a pass requires all seven.
- E1, E2 and E6 depend on Elena's reading of the bar. A run that misses it, whether by the mean, by caution or from the first file, loses all three and scores at most 40.

**Counterfactual control:** with the changed 21 October 2025 conversation from Section 4:
- E1 becomes: "The sent draft contains no C result, appendix included."
- E2 becomes: "C was dropped under her two-point rule; the corrected rerun gives a mean of 1.94 ± 1.05 over 5 seeds; the first file was superseded."
- E6's last clause becomes "C was dropped because the mean, 1.94, is under 2".
- E3–E5, E7, F1 and F2 are unchanged.

This is a planned grader control, not a claim of extra agent runs.

### Hint

**✍️ Hint (required):** "The recording and transcript of the April 14, 2026 meeting are in Files, Sam's two April 15, 2026 messages are in the group thread, and what Jun told you about how Elena's bars for a gap are read is in your conversation history from October 21, 2025."

- **Injection:** immediately after the `2026-04-16T09:00:00-04:00` request and before the agent's next action. It is identical for all models. All named records exist at that time.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-04-14T11:00:00-04:00` | First request | Read the summary and the full transcript. Note for Jun: <ul><li>the summary misses the 31:05 conditional retraction and the 38:10 recipient instruction;</li><li>D stays.</li></ul> | Summary note, transcript | Corrected to-do note saved in Notes; no source changed. | E7, F1, F2 |
| `2026-04-16T09:00:00-04:00` | Decisive request | <ol><li>Re-read 31:05, 33:20–33:30 and 38:10. Read both of Sam's messages and the corrected CSV. Search the history for how Elena's bars are read and find the 21 October 2025 conversation.</li><li>Compute median 2.4, mean 1.94 and sample SD 1.05. Since the median clears 2, C goes back in.</li><li>Rename Method A, move Table 2, keep D, and add C to Section 5 with the corrected numbers. Save as a new version.</li><li>Attach the draft in the direct conversation with Elena. Explain that C is back because the median gap, 2.4, clears her bar; give the mean, and say the first file is superseded.</li><li>Tell Jun what was sent and to whom, that the summary was wrong on C and recipients, Sam's correction, and the C decision with its reason.</li></ol> | Transcript, October conversation, Sam's messages and the corrected CSV, draft, contacts | New version sent to Elena only, before noon; Jun informed. | E1–E6, F1, F2 |

**✍️ Other accepted approaches (required):**
- The agent may use the audio instead of, or as well as, the transcript.
- It may report a population SD alongside the sample SD, if the two are labelled, and may list the per-seed gaps.
- It may flag seed 4 to Elena, as long as C is in the draft.
- It may save a new file name.
- The first-session note may be a Notes record or a chat reply.
- If the agent asks Jun about C, the scripted user replies "Do what Elena said in the meeting." The agent must still complete the same state before noon.

Not accepted:
- leaving C out, or reinstating it with any number from the first two files;
- deleting D;
- sending to anyone besides Elena.

### Difficulty evidence from a local pre-implementation probe

**Setup.** Before implementation, we ran the design in a mock harness:
- **Tools:** a small command-line stand-in for Files (with versions), Notes, Messages, Contacts and the assistant conversation history, holding the records, events and grader checks above. The audio is listed but not readable as text, so runs worked from the transcript.
- **Agents:** each session ran as a fresh Claude Code agent that could use only this CLI. The 16 April session saw the 14 April one only through the history and the Notes it left.
- **Scoring:** by script for the draft checks, F1 and F2, and by hand for the message items.
- **Models:** only Claude models were run. The official batch will cover the designated GPT, Claude and Gemini models.

The design under review was too easy, so we revised it twice:

| Round | Change | Opus 5.5 unhinted | Sonnet 5.5 unhinted |
| :--- | :--- | :--- | :--- |
| 1 | Design under review (bar read as stated, focused history) | 2/2 passed | 2/2 passed |
| 2 | Elena's reading of the bar ("mean minus one SD") hidden in about 300 dates of history | 0/3, but one run left C out only from caution, which would have scored about 80 | 0/2 |
| 3 (this proposal) | Reading changed to the median, so caution and the mean both give the wrong action; counterfactual moved to the October conversation | **0/5** | **0/3** |

**Round 1.** Every run read the whole transcript on 14 April and found the 31:05 condition and the 38:10 recipient instruction. On 16 April every run computed the corrected mean and sent the draft to Elena only.

**Round 3 results.**
- **Hinted Opus 5.5:** passed both sessions. It found the 21 October conversation and put C back at the corrected numbers (median 2.4, mean 1.94 ± 1.05), explaining the reason to Elena and Jun. Everything else matched the reference.
- **Unhinted runs:** none searched the history for how Elena reads her bars. All eight dropped C because the mean, 1.94, is under 2. Their other edits, the recipient and the to-do note were correct.
- **Unhinted scores:** losing E1, E2 and E6 leaves at most 40, so the mean is below 50% for both models.

**Fixture fixes from the probe.**
- In the reviewed CSVs, the value that changed was in the fourth row (seed 3), while Sam's message says seed 4. Runs noticed the mismatch, so the change now sits on seed 4.
- The first rerun file's seed 4 now equals the default-X value from `C_results_v1.csv`, as Sam's message implies.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | <ul><li>A synthetic transcript of about 6,000 words, with the decisive statements and the D exchange embedded in ordinary discussion.</li><li>Multi-voice TTS audio of it.</li><li>The summary note, draft, three CSVs, contacts and three conversations.</li><li>About 300 dates of assistant history from templates, with keyword noise and a recurring opener, and the 21 October 2025 conversation.</li><li>A counterfactual history that differs only in that conversation.</li></ul> | <ul><li>Audio and transcript align, checked by ASR re-transcription.</li><li>Only the October conversation differs between the two histories.</li><li>The date count is reproduced by script.</li><li>The CSV statistics are verified by script.</li></ul> | 2–3 |
| User rollout and scenario script | **Sessions:** 2 at `2026-04-14T11:00:00-04:00` and `2026-04-16T09:00:00-04:00`. **Simulated world time span:** 3 days. **Estimated total tokens:** 40,000–90,000 per complete scenario, mostly the transcript and history searches. | A deterministic script with the fixed request, two scheduled messages and the ask-first branch. | 1 |
| Environment integration | Published Files, Notes, Messages and Contacts only. Audio stored as Files assets within the asset budget. | A resettable package. The outbound and attachment audits are exercised. | 1–2 |
| Rubrics, reference and hints | Implement F1–F2 and E1–E7, the hint, the reference, an audio-based alternative and the counterfactual control. | <ul><li>The reference scores 100 and no-op scores 0.</li><li>Test cases: summary-only (6.1 plus group post), first-file-only (3.0 reinstated), mean-based drop (1.94 < 2), caution-based drop, reinstated without the median reason, D deleted, an overwritten draft, a no-op, and a to-do note copied from the summary.</li></ul> | 2–3 |
| Agent rollouts and analysis | 5 unhinted rollouts and 1 hinted rollout per designated GPT, Claude and Gemini model, from fresh state. | Every trace and score, plus a failure analysis. | 1.5–3 |

**Milestones, owners and dependencies (required):** Yuyao Wang (@olivia3395) owns design, fixtures, grading, rollouts and review responses. The work order is:
1. Design approval.
2. Generate and verify the transcript and audio.
3. Build the fixtures and their reset.
4. Build the grader.
5. Freeze the design.
6. Run the official batch.

The task needs only published Apps, plus three platform capabilities: the session runner, cross-session history and the outbound/attachment audit.

**Dependency:** [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), Platform capabilities that Task proposals depend on.
- **Status: blocking.** As of 2026-11-27 the issue is open and these capabilities are not yet on `main`.
- The fixtures (transcript, TTS audio, CSVs), the statistics script and the grader can be built before then. The official batch waits for #135.

The target is 2–3 weeks of contributor time once these are available.

**Related work:**
- [#175](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/175): blind ratings after a lab meeting.
- [#34](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/34): result selection from a stated preference.
- [#257](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/257), by this author: GPU-share priority.

Here the decisive personal context is a **late, conditional, coreferential reversal spoken in a recorded meeting**. It contradicts the auto-summary, and its condition is decided by a corrected rerun that must be recomputed.

**Resources and total effort (required):**
- Effort: 8.5–15 person-days for implementation and validation, plus about 1 day of drafting.
- Validation batch: 15 unhinted and 3 hinted runs, plus development trials.
- Token budget assumption: 40,000–120,000 input and 2,000–8,000 output tokens per run (the probe's sessions used about 50,000–75,000 tokens each).
- Costs: TTS and ASR costs are small and will be recorded. API cost is TBD until the roster and prices are known.
- Compute: CPU only.

**Scope boundary and open questions (required):** Excluded:
- PDF compilation (the draft is Markdown);
- email;
- judging the science.

Open questions:
1. Will the harness expose audio to models that accept it? The transcript is always available, so no model needs audio.
2. Should the audio be split into parts for the asset budget?
3. Are rejected outbound attempts audited?
4. Can conversation search in the platform return the most recent matches first, as the probe assumed?

These will be settled with the maintainers before the freeze. Difficulty is empirical: every valid rollout will be reported, and any redesign will go through review.

**Data provenance and privacy (required):**
- *Origin:* invented. It is inspired by the author's general experience of advisor meetings in which decisions change late, but no real recording, transcript, message or person is used.
- *Audio:* synthetic TTS of the invented transcript, using voices whose licence allows redistribution. The voices will be documented.
- *Privacy:* no private or third-party data is included.
