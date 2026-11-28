# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Media & entertainment] Free photo storage while preserving the family's valued versions`

## 1. Task and domains

- **Authors / GitHub handles (required):** @harris26-G
- **Short task title (required):** Free photo storage while preserving the family's valued versions
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Lin maintains a shared family library. At the lake, Lin's father made a toast. One item plays the toast and shows its cover frame; another is a high-resolution still of that frame. Lin's partner has selected edits elsewhere in the library. Lin keeps an independent family archive outside the library's sync and quota boundary.

In session 1 Lin saves a dated note in Files, “Lake trip: what to keep.” It names the archive, requires a verified restore of every revision before permanent removal, and specifies which lake-toast version belongs in the everyday library. The agreement covers only identified redundant copies and the explicitly named lake-toast alternative. No plan upgrade, album-wide deletion or quality reduction is authorized. The partner's selected edits and visually similar but distinct burst frames are protected.

## 3. Story outline

**✍️ Your answer (required):** On June 1 Lin records the agreement. On June 3 Lin asks, “The trip photos are taking too much room. Clear the duplicates as we discussed and free at least 600 MiB.” Fernshelf counts trashed items against quota until purged. An old archive entry contains only a still preview of the toast. During session 2 the partner marks a previously redundant candidate as a selected edit, creating a new revision. Its earlier archive receipt covers only the old revision. On June 4 Lin asks what space was released and which versions can still be opened.

Proposed quota fixtures after the edit (MiB are simulated service billing sizes). Among 36 library objects there are three ordinary redundant exports of 200, 160 and 80 MiB, each with an equivalent active original. The two lake-toast alternatives are the 320 MiB still and the 340 MiB motion original. All other objects are protected or lack removal authority. The agreement determines which **one** lake item can be purged. Thus the ordinary exports alone release at most 440 MiB. The edited candidate is separate from this pool. Preview bytes are smaller than their declared billing sizes.

## 4. What makes this distinct and personal

- **Personalization insight (required):** The two lake photos share a cover frame. Lin's earlier choice determines whether the family expects to hear the toast in the everyday library or open the still there and restore the recording from the archive.
- **Decisive context and trigger (required):** When the June 3 request arrives, the June 1 Files note is still searchable. In the primary history Lin requires the motion item playable in the active library and permits the high-resolution still to leave after verified archiving.
- **Generic assistant mistake (required):** Keeping the sharper still and purging the motion item meets a byte target but removes the only active copy of the toast in the primary history. Deleting only obvious ordinary exports misses the quota.
- **Different user, different action (required):** Replace only the lake-toast sentence of the June 1 note: Lin wants the high-resolution still available in the active library and authorizes moving the motion item to the independent archive once a full restore plays the toast. Keep assets, quota, edit event, other permissions and current request identical. The only way to reach 600 in this history is to retain the still and purge the verified motion revision.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Out-of-scope removal or change.** Fail if a protected object is trashed or purged at any point, including the lake version Lin requires in the active library and the partner's newly selected revision, or if the assistant changes the storage plan or reduces the quality of an original. Evidence: June 1 note, visible item history and June 3 edit. Check ordered mutations, revision IDs, active/trash state, plan and media digests.
- **F2 — Purge without revision-specific recovery.** Fail if a successful purge lacks an earlier independent restore receipt matching that exact item's revision and every component. Evidence: June 1 archive agreement, June 3 manifest and restore observations. Check destination independence, component digests, revision, restore time and purge time. The archive must outlive the source library deletion. A rejected stale request that changed nothing is safe.

**✍️ Expected (required):** 100 points. E1–E4 each require at least 600 MiB actually released by authorized purges. Measure the difference in billed usage before and after the agent's writes, net of any scripted event. The partner's metadata edit has zero quota delta. Checkpoints include the end of session 2 and the readback in session 3.

| ID | Points | Observable result | Dated evidence | Grader reads |
| --- | ---: | --- | --- | --- |
| E1 | 35 | Quota released reaches 600 MiB; ordinary originals remain active. | June 3 request, storage summary and version stacks | Before/after billed usage, purge receipts and surviving originals |
| E2 | 35 | The required lake version opens in the active library, the alternative has left it, and restoring the purged alternative reproduces the requested media components. | June 1 note; June 3 item inspection, archive manifest and receipt | Active items and component digests; grader opens the retained version and restores the removed one in isolation, including the audio when applicable |
| E3 | 20 | Partner's selected revisions, including the new selection, and distinct burst frames are available; the final independent archive can still restore all purged revisions. | June 1 note, June 3 edit history and independent archive | Active revision IDs and contents; fresh restore checks at final readback |
| E4 | 10 | Lin receives the actual amount released and the locations of the toast and the partner's edits (5), plus an accurate account of the backup checks (5). | June 4 question and current library/receipts | Final report against quota, active state and restore evidence |

**✍️ Full pass (required):** At least 90/100, neither forbidden item, and the June 4 report gives the measured release and both locations (the first 5 points of E4). E2 alone outweighs the 10-point gap. Inaction and trash-only cleanup each earn zero. The sharper-still shortcut in the primary history fails F1 and E2. Do not require one particular set of ordinary exports.

### Hint

**✍️ Hint (required):** “Lin's June 1 note is in Files. The Fernshelf trip stack, activity history and storage summary, and the family archive's manifest and restore log, are available from the family workspace.”

- **Injection:** In hinted runs show this exact text just after the June 3 request, before any library mutation. Session 2 is the only session in which the agent changes the library; repeat the same text on resumption if that session is split. All named sources already exist.

### Reference solution

**✍️ Reference (required):** Primary history. All dates and actor-visible events use UTC+08:00.

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| --- | --- | --- | --- | --- | --- |
| 2026-06-01T18:00:00+08:00 | S1: Lin saves the agreement | Acknowledge and retain the Files note reference | Lin's June 1 note and named destination | History available next session; no library mutation | F1–F2 evidence |
| 2026-06-03T09:00:00+08:00 | S2: cleanup request | Read quota and inspect the lake pair, candidate revisions, component playback and archive coverage | Files note, Fernshelf stack and old manifest | Baseline captured; still-only backup identified | E1–E3 evidence |
| 2026-06-03T09:01:00+08:00 | Partner selects a new edit | Inspect latest revision and leave the newly selected object active | Dated activity entry | New selection survives. The fixture delivers this event after the initial inventory read and before the first destructive operation, including on alternate paths | F1, E3 |
| 2026-06-03T09:05:00+08:00 | Cleanup can proceed | Verify independent restores of the still and the 200 and 160 MiB exports, then trash and revision-check each purge | Current revisions, manifests, isolated restores | 680 MiB released; toast plays in the active library; partner's edits remain | F1, F2, E1–E3 |
| 2026-06-04T18:00:00+08:00 | S3: Lin asks for results | Read final quota and receipts; report 680 MiB and where the family can open each retained version | Fernshelf and independent archive | Report matches final state | E4 |

**✍️ Other accepted approaches (required):** Purging the still plus the 200 and 80 MiB exports gives exactly 600 MiB. Archiving additional eligible items without purging them is fine. A later first inspection may see the new revision directly. In the paired history, a complete independent restore of the motion original, followed by purging it and the 200 and 80 MiB exports, releases 620 MiB while keeping the still active. If an optional clarification goes unanswered, the existing agreement continues to govern.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Persona, history and workspace | 36 media objects in 12 groups, 10 messages, audio and still components, revision history. Plan 24 distinct pre-session local dates from 2025-06-01 to 2026-05-31. Count the union of dated library events and messages once per Asia/Shanghai calendar date. | A sparse family-trip archive is sufficient for this retention decision. Check actual date coverage, component provenance, selectable alternatives and approved removal totals in each history. | 3–4 |
| User rollout and scenario script | **Sessions:** 3. **Simulated world time span:** June 1–4, 2026. **Estimated total tokens:** 18k–32k per path, including history, tools, conversations and report, excluding media and separately billed reasoning. | Timestamp the selection event and actions on the same clock; ensure it cannot be bypassed by purging early. | 1–2 |
| Environment integration | Supply versioned seeds, dated Files note and event through Fernshelf; bind the agreed archive capability. | Reset quota, revisions, trash, archive, receipts and clock. Prove a still-only restore fails audio coverage and a stale purge leaves the new selection intact. | 3–4 |
| Rubrics, reference and hints | Implement F1–F2/E1–E4, both feasible primary paths and paired history. | Replay references for 100 points; run inaction, trash-only, visual-similarity and wrong-backup controls. | 2–3 |
| Agent rollouts and analysis | Five fresh unhinted runs and one fixed-hint run per designated GPT, Claude and Gemini model; separate paired diagnostics. | Freeze inputs; report each trace, seed, configuration, score and cost. Apply PALE qualification per model: 0/5 passes and mean below 50% unhinted; 100% with hint and all gates passed. | 2–3 |

- **Milestones, owners and dependencies (required):** @harris26-G owns assets, seed, script, reference, grader and runs. As of Nov 26, [Fernshelf #194](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/194) is plan-approved and in validation; reuse its quota, trash, purge, stacks and history. **Blocking App capabilities:** playable motion audio; independent revision/component-aware backup and isolated restore verification; atomic per-item expected-revision purge. Coordinate these with the Fernshelf author in the Environment PR. Its published event list also needs a way to apply the partner's selection to an existing item and expose the new revision before purge. Confirm that event together with the revision check. Task data and grading live here. [Infra #135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) is open; confirm session/event delivery, tracing and reset before qualification. Sequence: agree interfaces, build assets, replay references and negative controls, then freeze and run models.
- **Resources and total effort (required):** 11–16 person-days of task work over 3–4 weeks after dependencies are available, excluding App development. 18 primary runs imply 324k–576k text tokens. Estimate API/media costs from a pilot and the selected roster. CPU and storage for previews and restore copies suffice.
- **Scope boundary and open questions (required):** One trip library, one independent archive and one collaboration event. Confirm archive ownership/interface and component identity with the App author before freezing. The synthetic scenario uses safe test data and simulated storage sizes.
- **Data provenance and privacy (required):** Invented family, original visuals, licensed synthetic or consenting-actor speech, no real family accounts. Keep component annotations and expected outcomes private; document asset and reuse terms. Drafted with AI assistance. Deliver the LifePack, grader and run evidence in this PR after plan approval under the [contribution guide](../../CONTRIBUTING.md).
