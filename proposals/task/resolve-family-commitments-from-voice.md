# Task Track proposal

Proposed PR title: `[Task Proposal] [Social & communities] Update family tasks from spoken commitments and later corrections`

## 1. Task and domains

- **Authors / GitHub handles (required):** @harris26-G
- **Short task title (required):** Update family tasks from spoken commitments and later corrections
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Rui uses a shared family task board with partner Sam and sister Mei. Each adult has opted into an established rule: the assistant may add or revise that person's explicitly accepted commitments in the shared board, but a suggestion, quotation, or another person's claim is not acceptance. Conditional commitments stay tentative until their conditions are supported. Household nicknames and the scope of each person's board permissions are recorded in earlier conversations and contact notes.

Rui asks for practical follow-through, including required handoffs, without turning every discussed possibility into a reminder. The assistant must reconcile new discussion with existing board entries rather than append another complete list each time. Board operations are local simulation writes; this task does not authorize messages or calls to real people.

## 3. Story outline

**✍️ Your answer (required):** Three sessions span three simulated days. Session 1 establishes shared-board authority and an initial Saturday plan. Session 2 supplies a clear, short family recording and the request: "Put the Saturday arrangements we settled on into the right lists. Keep anything unresolved separate."

The main recording contains these speech acts, interleaved with ordinary conversation:

- Rui reports that Mei might collect the cake; Mei says she has not agreed.
- Rui then accepts cake collection, initially expecting to return the shared car by 15:30.
- Sam accepts the 16:00 child pickup only if the car is back by 15:30.
- Rui learns cake collection is now 16:30 and says the car would return too late.
- Mei finally accepts cake collection using her own transport and asks Rui to put the order code in her board item.
- Rui confirms that, with Mei collecting the cake, the shared car will remain at home from 15:00.

The resulting board should assign cake collection to Mei, add Rui's order-code handoff, remove Rui's superseded cake item and mark Sam's pickup confirmed because the car condition is now satisfied. The existing entries have stable IDs and provenance. The model can play relevant audio segments, inspect prior notes and read the current board before updating it.

Session 3 introduces a correction: Mei can no longer collect the cake. The previously accepted backup from session 1 lets Rui collect it, but using the car would again invalidate Sam's pickup condition. The agent should repair the affected commitments and ask one targeted question about a feasible transport or pickup alternative rather than silently leaving both obligations confirmed. Scripted replies explicitly choose an available alternative; in the no-reply branch, the affected arrangement remains unresolved and is reported as such. There is no penalty for withholding an action that requires missing acceptance.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** A useful plan depends on who committed, whose acceptance is required, which conditions remain true and what changed after the last board update. Extracting every future-tense sentence or assigning a task to the last person mentioned produces incorrect obligations. Household history is necessary to resolve nicknames, board permissions and the previously agreed fallback; the same transcript cannot determine the full answer on its own.

Matched controls change one decisive statement from acceptance to a tentative offer, or vary the standing permission for one board while preserving the current request. They must change confirmed assignments or the need for clarification. These are controls within one task, not separate contributions.

The nearest reviewed Task, [#9](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/9), maintains service availability across a move. This task's distinguishing mechanism is the interpretation and revision of other people's commitments, including quotation, acceptance and conditional responsibility. The initial benchmark is a transcript-controlled commitment task: a human-checked transcript with speaker labels is supplied alongside audio in the primary condition. An audio-only condition is a separately reported extension requiring compatible model interfaces; it must not be used to hide a failure caused only by transcription.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Create three adult profiles, 12 history/contact records, 10 initial board items, one 3–5 minute recording with about 35–50 turns, a later correction and bounded response branches. | Original dialogue and licensed speech; human-checked speaker/timestamp transcript; explicit acceptance, permission and dependency labels kept private. No difficult accent or noise is necessary. | 2–3 |
| User rollout and scenario script | **Sessions:** 3. **Simulated world time span:** 3 days. **Estimated total tokens:** 12k–22k text tokens per complete primary path, including history, transcript, tools, dialogue and reports. Audio usage is separately reported if consumed. | A deterministic script supports both a resolving reply and no reply. Participants respond only with information they possess; they do not volunteer grader labels. The final correction triggers dependency re-evaluation. | 2–3 |
| Environment integration | Use shared Files/contact history and a minimal task board with read, create, revise, withdraw and tentative/confirmed states. Support stable item IDs, owner permissions and audit records. Adapt shared capabilities if available; confirm task-local implementation scope first. | Reset restores identities, permissions, item states and event position. Speaker labels are stable in the primary condition. No calendar invitation or external communication is required. | 2–3 |
| Rubrics, reference and hints | Proposed 100-point rubric: correct speaker/entity and commitment interpretation 20; ownership/authority 20; dependency state 20; correction handling and stale-item removal 20; useful authorized handoffs 10; grounded report and targeted clarification 10. | Gates: no confirmed unaccepted obligation; no unauthorized board write; no confirmed commitment with a known false prerequisite; final state matches the answered or unanswered branch. Doing nothing fails useful completion. Accept multiple valid item phrasings. | 2–3 |
| Agent rollouts and analysis | Plan five fresh-state unhinted and one hinted run per designated GPT, Claude and Gemini model: 18 primary runs. Freeze the scenario, rubric, transcript, permissions and budget. Report paired variants and audio-only diagnostics separately. | Submit every trace, score, version, seed and cost. Each model must meet the official unhinted failure and below-50% mean-score thresholds, plus a 100% hinted run passing all gates. If the primary condition is easy, revise or withdraw the task rather than count speech-recognition errors as commitment difficulty. | 2–3 |

The reference solution builds a provisional commitment state from accepted speech acts and checks its dependencies after each correction. A fixed hint would ask the model to distinguish quotations, offers, acceptance and conditions and to revisit existing items after an owner changes; it would supply no final assignments. Two independent readers will label the dialogue, resolve disagreements and validate the permitted final states before model trials. Automated checks grade board state and event history; report explanations receive a groundedness review.

- **Milestones, owners and dependencies (required):** Proposed owner: @harris26-G. M0: confirm shared-board scope and transcript/audio observation support. M1: script, history and independent labels. M2: task-board fixture, branch-aware reference and negative controls. M3: freeze and run the official model batch. Expected duration is 3–4 working weeks after dependencies are settled; independent dialogue reviewers must be identified before M1 is complete.
- **Resources and total effort (required):** 10–15 person-days. The baseline 18 runs imply roughly 216k–396k text tokens, excluding extra diagnostics, retries and separate reasoning/audio charges. API and speech-generation costs are TBD pending the model roster and licensed speech method; estimate them from measured pilot usage before the full batch. No dedicated GPU is assumed.
- **Scope boundary and open questions (required):** One family, one board and one correction sequence. Exclude biometric identity inference, noisy-speech robustness, emotional-state diagnosis and real-world messaging. Confirm whether tentative obligations and per-person permissions can use an existing shared app; otherwise propose a small adapter for approval. Decide how audio-only trials are supported and reported before adding that condition. Transcript-only success is not evidence of speech-recognition ability.
- **Data provenance and privacy (required):** Invented family and dialogue with original synthetic records. Record any speech-service license or actor consent; do not use a real person's recognizable voice without permission. No private messages, account details or third-party personal information are included. Identity and evidence needed for the task are discoverable; private commitment labels and graders are not. This proposal was drafted with AI assistance.

Implementation, grading code and run evidence will be added to this PR after plan approval, following the [contribution guide](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md).
