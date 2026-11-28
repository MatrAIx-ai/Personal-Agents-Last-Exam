# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Media & entertainment] Resume a shared series from each viewer's actual progress without spoilers`

## 1. Task and domains

- **Authors / GitHub handles (required):** @harris26-G
- **Short task title (required):** Resume a shared series from each viewer's actual progress without spoilers
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Alex watches *The Last Crossing* with partner Jo and mother Yun. They sometimes watch separately or offline. Their July 1 agreement, saved in the household series thread, asks for a brief reminder based on what everyone attending has seen. The assistant may prepare one shared queue entry. The family starts playback themselves and keeps individual progress and settings separate.

The household also follows a second series. Yun's “finished it” in that series' thread has nothing to do with *The Last Crossing*. Lanternbox records what played on an account, including unattended sessions. The original episode transcripts and the season synopsis are available in Files. The synopsis gives away the ending.

## 3. Story outline

**✍️ Your answer (required):** Four sessions run from July 1 to July 10. In session 1 the family saves its agreement. They subsequently watch part of episode 5 together. Jo finishes episode 6 and Alex finishes episode 8 separately. An unattended stream reaches episode 7 on the shared account. Yun later describes her own progress in the target-series thread.

In session 2 Alex asks, “The three of us are continuing tonight. Give us a quick reminder and get the next bit ready.” The group needs a useful recap and a paused shared queue at the first point everyone can watch together. In session 3, Yun gives a new update and the same three ask to prepare their next viewing. In session 4, only Alex and Jo attend. Across sessions the agent may change the shared queue. The series, profile histories, autoplay settings and household messages remain independently readable.

## 4. What makes this distinct and personal

- **Personalization insight (required):** The account played ahead while nobody was watching. Yun's own note determines both where her family can resume and which part of the mystery they can mention in front of her.
- **Decisive context and trigger (required):** At the July 4 request, the July 1 agreement and Yun's July 3 message are visible in the target-series thread. The catalog and episode transcripts identify the matching scene.
- **Generic assistant mistake (required):** Queueing from the furthest account record skips unseen scenes. Even an accurate season summary can spoil the contents of an envelope Yun has only seen unopened.
- **Different user, different action (required):** Change only the text of Yun's July 3 message. Primary: “I stopped at the station clock, 18 minutes into episode five.” Paired: “I finished all of episode five on my offline copy.” Sender, timestamp, thread, attendance in every session, requests, playback logs, story and all later updates are identical. The July 4 queue moves from episode 5 at 18:00 to episode 6 at 00:00, and the recap may now say what was in the envelope. The July 10 change in attendees occurs in both histories.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Reveal a later fact.** Fail on a disclosure or unambiguous implication of a fact first revealed beyond the least advanced attendee's witnessed point, including in a recap, title, queue note or explanation visible to the family. Evidence: July 1 agreement, dated household and playback records, original episode text. Check all agent-created audience-visible output against a private, branch- and session-specific reveal map. Opening a synopsis privately is allowed.
- **F2 — Start playback or change a personal profile.** Fail on any agent-initiated playback or mutation to a personal profile, including personal progress, viewing history and autoplay settings, even if subsequently reversed. Evidence: July 1 household agreement. Check the ordered Lanternbox event log, actor and profile snapshots against scripted events.

**✍️ Expected (required):** 100 points. Score each row at the close of its session. A correct queue is one persistent shared entry for the target series, at the specified episode and offset, still unstarted. Where it is already correct, leaving it in place earns the same credit. The initial shared queue is empty. No points accrue for unchanged individual profiles alone.

| ID | Points | Observable result | Evidence and grader check |
| --- | ---: | --- | --- |
| E1 | 35 | S2 shared queue reads back as episode 5 at 1,080 seconds (primary) or episode 6 at zero (paired). | July 3 Yun message and July 4 request. Read shared queue scope, series ID, episode ID, offset and playback state. |
| E2 | 25 | S2 delivers a brief, useful recap with an earlier thread of the mystery and a recent development the whole group has seen. | July 4 request and Files transcripts. Give 10 for one accurate earlier plot point and 15 for one distinct development in the latest shared segment. Accept equivalent facts or paraphrases from the frozen scene map. |
| E3 | 15 | S3 has the episode 6 queue at zero (10) and gives a recap containing a relevant episode 5 development from after minute 18 (5). | July 7 Yun update and group request. Read queue state and recap by session end. |
| E4 | 25 | S4 has the episode 7 queue at zero (15) and gives a recap containing a relevant episode 6 development (10). | July 10 request, July 2 attributed viewing, episode text. Read queue state and recap by session end. |

For example, the spare station key goes missing in episode 4. In episode 5 an unopened red envelope is found at 17:40. Its contents, a ferry ticket, first appear at 24:00. The ticket's double punch first appears in episode 6 at 15:00. At the primary July 4 boundary, “The spare key is missing, and they've just found a red envelope” earns both recap components. Naming the ferry ticket then triggers F1. In the paired history, the ticket is eligible as the latest development. The double punch becomes eligible for the July 10 pair. The final identity reveal remains forbidden in all three recaps. Two readers will independently label first appearances, useful equivalent facts and implications, then reconcile disagreements before evaluation.

**✍️ Full pass (required):** At least 90/100 with neither F1 nor F2. In each of S2–S4 the shared queue must read back at that session's required position, and the assistant must deliver at least one credited recap fact in that session. Missing the decisive S2 queue loses 35 points, more than the 10-point pass margin. An entirely passive agent earns zero. Correct queues with empty recaps earn at most 60.

### Hint

**✍️ Hint (required):** “The household has a July 1 agreement and Yun's July 3 message in its series thread. Lanternbox has viewing history for this household. Files has the episode transcripts.”

- **Injection:** Show the identical text immediately after the request in S2, S3 and S4, before the assistant's first response or action in that session, in every hinted run. Each named record already exists at all three injections.

### Reference solution

**✍️ Reference (required):** Primary history. All times use UTC+08:00. The catalog exposes a seekable scene boundary at exactly 1,080 seconds in episode 5. All listed contents are proposed original fixtures.

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| --- | --- | --- | --- | --- | --- |
| 2026-07-01T19:00:00+08:00 | S1 family agreement | Acknowledge the agreement in its series thread | Alex's instructions | Agreement persists, queue empty | F1–F2 evidence |
| 2026-07-01T20:18:00+08:00 | Joint viewing stops at station clock | No agent action | Attributed shared session | Group has seen episode 5 through 18:00 | E1–E2 evidence |
| 2026-07-02T18:00:00+08:00 and 2026-07-02T20:00:00+08:00 | Jo finishes episode 6, Alex finishes episode 8 | No agent action | Separate attributed Lanternbox events and Jo's dated thread entry confirming she finished six and left the TV running | Their progress can be recovered individually | E1, E4 evidence |
| 2026-07-02T22:00:00+08:00 and 2026-07-03T09:00:00+08:00 | Unattended shared stream reaches episode 7, then Yun posts “finished it” about the other series | No agent action | The living-room playback row under Jo's profile and the decoy thread | Episode 7 is visible on the shared profile and the decoy message is attributable | E1–E2 evidence |
| 2026-07-03T19:00:00+08:00 | Yun posts in the target-series thread | No agent action | Yun's dated message | Primary and paired seeds differ only in this message's text | E1–E2 evidence |
| 2026-07-04T19:00:00+08:00 | S2 all three request a reminder and preparation | Mention the missing key and unopened envelope. Prepare episode 5 at 18:00 in the shared queue | Thread, attributed views, episode text | Queue readback at 1,080 seconds, unstarted, personal profiles intact | F1–F2, E1–E2 |
| 2026-07-06T22:00:00+08:00 | The living-room TV again runs unattended on episode 7 under Jo's profile | No agent action | Jo's series-thread note records that no one was watching | A separate viewing will sync the next day | E3–E4 evidence |
| 2026-07-07T18:55:00+08:00 and 2026-07-07T18:58:00+08:00 | Yun confirms “I've seen all of five now”; the July 6 viewing syncs | No agent action | Target-series thread and playback event with explicit duration and original start time | July 6 viewing and July 7 record time are distinct; the log adds no witnessed progress | E3 evidence |
| 2026-07-07T19:00:00+08:00 | S3 all three request recap and preparation | Mention that the envelope held a ferry ticket; prepare episode 6 at zero | Yun's update and episode text | Queue unstarted; profiles intact | F1–F2, E3 |
| 2026-07-10T19:00:00+08:00 | S4 Alex and Jo request recap and preparation for just the two of them | Mention the double punch and prepare episode 7 at zero | Current attendance, attributed July 2 completions and episode text | Queue unstarted; profiles intact | F1–F2, E4 |

**✍️ Other accepted approaches (required):** Give the recap after preparing the queue, using another accurate pair of earlier and recent facts. Replay this alternative for full credit. In the paired history S2 can mention the missing key and the ferry ticket. S3 may leave its already-correct episode 6 entry in place. Separately pilot a genuinely unresolved case with neither a reliable personal report nor a witnessed stopping point. A focused question and an unstarted, unchanged queue pending an answer are appropriate there. Report this diagnostic separately from the two resolved histories.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Persona, history and workspace | Original eight-episode mystery, about 24 transcript scenes, 30 candidate propositions, one decoy series, three profiles, about 18 messages and 20 playback events. Seed catalog, transcripts and synopsis in Files and records in their respective Apps. Plan 21 distinct local pre-session dates between 2025-07-01 and 2026-06-30. | Count the union of selected household and playback dates once per Asia/Shanghai date before S1. This intermittent viewing pattern supplies episode-specific evidence. Report actual coverage and verify speaker, title and reveal boundaries. | 3–4 |
| User rollout and scenario script | **Sessions:** 4. **Simulated world time span:** July 1–10, 2026. **Estimated total tokens:** 22k–40k per scenario across dialogue, prior history, queried text and tools. | Freeze messages, actor, request, attendees and time in each session. Compare normalized seed manifests for exactly one changed message body. | 1–2 |
| Environment integration | Use Lanternbox history, progress and settings. Seed Files and message history. Request shared queue support in Lanternbox. | Reset all data and clock. Read queue after preparation and at next-session entry. Compare profile snapshots, playback events and settings before/after; attach interface evidence at implementation. | 2–3 |
| Rubrics, reference and hints | Build F1–F2/E1–E4, reference, alternate replay and reveal labels. | Verify 100 for both resolved references and accepted order, zero for no-op, failure for empty recaps, spoiler in title, wrong offset, playback or a profile write. | 3–4 |
| Agent rollouts and analysis | Five fresh unhinted and one fixed-hint run per designated GPT, Claude and Gemini model. Compare against furthest-account and minimum-counter baselines. | Keep traces, criterion scores, real run dates, durations and costs. Report paired diagnostic separately. Qualification per designated model: 0/5 passes and mean below 50% unhinted; 100% hinted with all gates passed. | 2–3 |

- **Milestones, owners and dependencies (required):** @harris26-G owns task data, rollout, rubrics, reference and evidence. [Lanternbox #215](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/215) is plan-approved and in validation as of Nov 26. Reuse its profile positions, distinct playback history and autoplay settings. The blocking App request is a household-scoped queue for a series, episode and offset that persists without starting playback or writing personal progress. Coordinate it in the Environment PR. [Infra #135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) is open. Confirm multi-session delivery, reset and tracing, then replay references and negative controls before model qualification.
- **Resources and total effort (required):** 11–16 task person-days, approximately 3–4 working weeks once interfaces and reviewers are available. Excludes Lanternbox development. Estimated 396k–720k text tokens for 18 primary runs, excluding retries, diagnostics and separately billed reasoning. Cost TBD after pilot usage and model selection. CPU-only, original text fixtures.
- **Scope boundary and open questions (required):** One target series and a decoy. Freeze episode IDs, offset units and visible queue fields with Lanternbox, then validate non-playing persistence. Keep semantic spoiler labels private and adjudicate ambiguous paraphrases before evaluation.
- **Data provenance and privacy (required):** All people, messages, viewing events and scripts are invented. No real account data or television scripts are used. Drafted with AI assistance. Deliver the LifePack, grader and author-run evidence in this PR after plan approval under the [contribution guide](../../CONTRIBUTING.md).
