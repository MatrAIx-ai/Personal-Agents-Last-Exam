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

Everything is invented for this task.

## 3. Story outline

**✍️ Your answer (required):** Two sessions span three simulated days.

1. At `2026-04-14T11:00:00-04:00`, Jun asks: "Can you go through this morning's meeting materials and note what I need to do for the draft?"
2. At `2026-04-15T16:20:00-04:00`, Sam posts in the group thread: "Reran X with tuned hyperparameters — C still holds, gap is smaller." He attaches `C_results_tunedX.csv`, which gives per-seed gaps.
3. At `2026-04-15T21:05:00-04:00`, Sam posts a correction: "Oops — seed 4 in that file was still default X. Corrected file attached." He attaches `C_results_tunedX_v2.csv`. Neither message states a mean.
4. At `2026-04-16T09:00:00-04:00`, Jun makes the decisive request: "Please update the draft per Tuesday's meeting and send it out as we agreed."

The corrected per-seed gaps give 1.90 ± 1.07 (mean ± sample SD), which is below Elena's two-point bar. A good outcome:
- applies the uncontested edits and keeps D;
- leaves C out entirely, appendix included;
- tells Elena that C was dropped because Sam's corrected rerun gives 1.90 ± 1.07, under her two-point bar;
- sends the draft only to Elena, before noon;
- tells Jun that the auto-summary was wrong about C and about the recipients.

## 4. What makes this distinct and personal

- **Personalization insight (required):** "Update the draft per the meeting" depends on what this advisor actually said late in this user's meeting. That statement contradicts the summary the user was handed, and its condition is decided by a later corrected rerun.
- **Decisive context and trigger (required):**
  - The trigger is the exact `2026-04-16T09:00:00-04:00` request.
  - The governing context is Elena's 31:05 conditional statement and her 38:10 instruction, in the 14 April transcript and recording.
  - It is resolved by Sam's two messages on 15 April. The second message corrects the first.
  - The summary note is the most visible record, and it contradicts the governing context.
- **Generic assistant mistake (required):**
  - *Follow the summary:* add C with the stale 6.1 ± 0.8 and post the draft to the group thread.
  - *Read the retraction but not Sam's messages:* leave C out without telling Elena why.
  - *Read only Sam's first message:* reinstate C at 2.30 ± 0.80, which passes the bar.
  - *Over-apply the retraction:* also delete D.
  - *Miscompute:* get the threshold check wrong.
- **Different user, different action (required):** Keep every message, file, event, number and the final request identical. Change only Elena's 31:05 sentence, in both transcript and audio, to: "Hm. Then that's not fair to X. Pull it — appendix too. When your rerun is in, put it back with whatever it shows and flag it for me."
  - For that user, C goes back into Section 5 at 1.90 ± 1.07 from the corrected file, with a flag.
  - For Jun, C stays out and Elena is told why.
  - No newer message from Jun or Elena conflicts with the meeting. Sam's messages are identical in both histories.

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
| `C_results_tunedX.csv` | Per-seed gaps 2.9, 1.4, 3.1, 2.6, 1.5. Mean 2.30, sample SD 0.80. |
| `C_results_tunedX_v2.csv` | Per-seed gaps 2.9, 1.4, 3.1, 0.6, 1.5. Mean 1.90, sample SD 1.07. |

**Notes:** the auto summary, created `2026-04-14T10:50:00-04:00`.

**Messages:**
- The group thread "Ruiz lab — workshop paper", with Elena, Sam, Jun, Mina and one other student.
- A direct conversation with Elena.

**Contacts:** all five people.

**Transcript:** besides the statements in Section 2, it contains ordinary discussion of related work, figures and an aside. Each decisive statement is one or two sentences inside longer exchanges. The audio matches the transcript word for word.

**Events:**

| Time | Event |
| :--- | :--- |
| `2026-04-15T16:20:00-04:00` | Sam's first message and its CSV appear. |
| `2026-04-15T21:05:00-04:00` | Sam's correction and its CSV appear. |

### Rubric

Graded from the Files, Messages and Notes state at `2026-04-16T12:00:00-04:00` and from the agent's messages to Jun. Each expected item is all or nothing. Doing nothing earns zero, because no new draft version exists and nothing is sent.

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

- **E1 (30) — C handled by Elena's rule.**
  - *Requirement:* the new draft contains no C result, appendix included. No C value (6.1, 2.30 or 1.90) is presented as a result.
  - *Evidence:* the 31:05 statement and Sam's corrected file.
  - *Checked from:* the latest draft version, by rule-based section and number checks.
- **E2 (20) — Tell Elena why C was dropped.**
  - *Requirement:* the message to Elena states three things:
    - C was dropped under her two-point rule;
    - Sam's corrected rerun gives about 1.9 (± 1.07 sample SD, over 5 seeds);
    - the first file's 2.3 was superseded by Sam's correction.
  - *Evidence:* the 31:05 statement and Sam's two messages.
  - *Checked from:* the Elena direct message, by an LLM judge. The numbers must be within ±0.01.
- **E3 (10) — Sent as agreed.**
  - *Requirement:* the new draft is attached in the direct conversation with Elena before `2026-04-16T12:00:00-04:00`.
  - *Evidence:* the 38:10 statement and the request.
  - *Checked from:* Messages records and the attachment hash.
- **E4 (10) — Correct scope of edits.**
  - *Requirement:* "Method A" becomes "AnchorNet" everywhere, Table 2 moves to the appendix, and Section 5.2 (D) is unchanged.
  - *Evidence:* the summary items and the transcript at 33:20–33:30.
  - *Checked from:* the draft diff.
- **E5 (10) — Accurate cover message.**
  - *Requirement:* the message to Elena lists the changes correctly. It claims nothing that was not done.
  - *Evidence:* the draft and sent records.
  - *Checked from:* the message compared with the diff, by an LLM judge.
- **E6 (10) — Tell Jun about the discrepancies.**
  - *Requirement:* a message to Jun says the auto-summary conflicted with the recording on C and on recipients. It also says that Sam corrected his first file.
  - *Evidence:* the summary against 31:05 and 38:10, and Sam's messages.
  - *Checked from:* messages to Jun, by an LLM judge.
- **E7 (10) — Draft kept as a new version.**
  - *Requirement:* the update is saved as a new version or a clearly named new file, with earlier versions intact.
  - *Evidence:* Files versioning.
  - *Checked from:* the Files version history.

**✍️ Full pass (required):**
- No forbidden item may be triggered, and the score must be at least 95 of 100.
- Every item is all or nothing and worth at least 10 points, so a pass requires all seven.
- The decisive E1 carries 30 points, more than the 5-point gap; missing it leaves at most 70.

**Counterfactual control:** with the changed 31:05 sentence from Section 4:
- E1 becomes: "C is in Section 5 at 1.90 ± 1.07 (5 seeds, tuned X, corrected file), with no other C value."
- E2 becomes: "C was reinstated after Sam's corrected rerun, the gap shrank from 6.1 to 1.9, and the first file's 2.3 was superseded."
- E3–E7, F1 and F2 are unchanged.

This is a planned grader control, not a claim of extra agent runs.

### Hint

**✍️ Hint (required):** "The recording and transcript of the April 14, 2026 meeting are in Files, and Sam's two April 15, 2026 messages are in the group thread."

- **Injection:** immediately after the `2026-04-16T09:00:00-04:00` request and before the agent's next action. It is identical for all models. All named records exist at that time.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-04-14T11:00:00-04:00` | First request | Read the summary and the full transcript. Note for Jun: <ul><li>the summary misses the 31:05 conditional retraction and the 38:10 recipient instruction;</li><li>D stays.</li></ul> | Summary note, transcript | Corrected to-do note; no source changed. | F1, F2 |
| `2026-04-16T09:00:00-04:00` | Decisive request | <ol><li>Re-read 31:05, 33:20–33:30 and 38:10. Read both of Sam's messages and the corrected CSV.</li><li>Compute mean 1.90 and sample SD 1.07. Since 1.90 < 2, C stays out.</li><li>Rename Method A, move Table 2, keep D. Save as a new version.</li><li>Attach the draft in the direct conversation with Elena. Explain that C was dropped under her two-point rule: the corrected rerun gives 1.90 ± 1.07, and the first file's 2.30 is superseded.</li><li>Tell Jun what was sent and to whom, and that the summary was wrong on C and recipients. Mention Sam's correction.</li></ol> | Transcript, Sam's messages and the corrected CSV, draft, contacts | New version sent to Elena only, before noon; Jun informed. | E1–E7, F1, F2 |

**✍️ Other accepted approaches (required):**
- The agent may use the audio instead of, or as well as, the transcript.
- It may report a population SD alongside the sample SD, if the two are labelled.
- It may save a new file name.
- The first-session note may be a Notes record or a chat reply.
- If the agent asks Jun about C, the scripted user replies "Do what Elena said in the meeting." The agent must still complete the same state before noon.

Not accepted:
- reinstating C at any value;
- deleting D;
- sending to anyone besides Elena.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | <ul><li>A synthetic transcript of about 6,000 words, with the decisive statements and the D exchange embedded in ordinary discussion.</li><li>Multi-voice TTS audio of it.</li><li>The summary note, draft, three CSVs, contacts and two conversations.</li><li>A counterfactual transcript and audio that differ only at 31:05.</li></ul> | <ul><li>Audio and transcript align, checked by ASR re-transcription.</li><li>Only one sentence differs between the two histories.</li><li>The CSV statistics are verified by script.</li></ul> | 2–3 |
| User rollout and scenario script | **Sessions:** 2 at `2026-04-14T11:00:00-04:00` and `2026-04-16T09:00:00-04:00`. **Simulated world time span:** 3 days. **Estimated total tokens:** 15,000–35,000 per complete scenario, mostly the transcript. | A deterministic script with the fixed request, two scheduled messages and the ask-first branch. | 1 |
| Environment integration | Published Files, Notes, Messages and Contacts only. Audio stored as Files assets within the asset budget. | A resettable package. The outbound and attachment audits are exercised. | 1–2 |
| Rubrics, reference and hints | Implement F1–F2 and E1–E7, the hint, the reference, an audio-based alternative and the counterfactual control. | <ul><li>The reference scores 100 and no-op scores 0.</li><li>Test cases: summary-only (6.1 plus group post), first-file-only (2.30 reinstated), retraction-only with no explanation, D deleted, population-SD-only threshold check, unflagged result and an overwritten draft.</li></ul> | 2–3 |
| Agent rollouts and analysis | 5 unhinted rollouts and 1 hinted rollout per designated GPT, Claude and Gemini model, from fresh state. | Every trace and score, plus a failure analysis. | 1.5–3 |

**Milestones, owners and dependencies (required):** Yuyao Wang (@olivia3395) owns design, fixtures, grading, rollouts and review responses. The work order is:
1. Design approval.
2. Generate and verify the transcript and audio.
3. Build the fixtures and their reset.
4. Build the grader.
5. Freeze the design.
6. Run the official batch.

The task needs only published Apps, plus the runner, cross-session history and outbound audit from the infrastructure release. The target is 2–3 weeks of contributor time once these are available.

**Related work:**
- [#175](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/175): blind ratings after a lab meeting.
- [#34](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/34): result selection from a stated preference.
- [#257](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/257), by this author: GPU-share priority.

Here the decisive personal context is a **late, conditional, coreferential reversal spoken in a recorded meeting**. It contradicts the auto-summary, and its condition is decided by a corrected rerun that must be recomputed.

**Resources and total effort (required):**
- Effort: 8.5–15 person-days for implementation and validation, plus about 1 day of drafting.
- Validation batch: 15 unhinted and 3 hinted runs, plus development trials.
- Token budget assumption: 20,000–60,000 input and 1,500–6,000 output tokens per run.
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

These will be settled with the maintainers before the freeze. Difficulty is empirical: every valid rollout will be reported, and any redesign will go through review.

**Data provenance and privacy (required):**
- *Origin:* invented. It is inspired by the author's general experience of advisor meetings in which decisions change late, but no real recording, transcript, message or person is used.
- *Audio:* synthetic TTS of the invented transcript, using voices whose licence allows redistribution. The voices will be documented.
- *Privacy:* no private or third-party data is included.
