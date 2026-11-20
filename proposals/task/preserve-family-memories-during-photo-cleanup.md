# Task Track proposal

Proposed PR title: `[Task Proposal] [Media & entertainment] Free photo storage while preserving the family's valued versions`

## 1. Task and domains

- **Authors / GitHub handles (required):** @harris26-G
- **Short task title (required):** Free photo storage while preserving the family's valued versions
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Lin maintains a shared family photo library. Earlier conversations establish two priorities: recordings of Lin's father's voice must remain playable in the active library, and the partner's selected edits must remain available alongside any original that carries unique content. Lin wants redundant exports and messenger copies removed, not a general reduction in image quality.

Lin has authorized permanent removal of confirmed redundant objects only after a restorable copy is verified in a specified independent archive. That archive is not another synchronized device. Deleting from the shared library propagates to synchronized devices. Moving an object to trash alone does not release the service's storage quota; permanent removal does. These fictional service rules are visible in the environment. The agent may read media, inspect versions and archive manifests, test restoration, and remove qualifying objects within this standing scope. It may not change the storage plan, delete an entire album, or discard a required voice recording.

## 3. Story outline

**✍️ Your answer (required):** Three sessions span four simulated days. In session 1, the user establishes the retention instructions and archive destination. In session 2, Lin asks: "The trip photos are taking too much room. Clear the duplicates as we discussed and free at least 600 MiB." The library contains visually similar objects with different purposes: an original motion photo with speech, a still export of its cover frame, a partner's edited still, a messenger-compressed copy, exact duplicates, and distinct burst frames.

The agent must examine the information carried by each object and its relationship to the user's retention instructions. It can inspect the photo, play its audio, read editing history, inspect sizes and synchronization rules, and verify an archive by restoring an object to an isolated temporary location. A successful backup job label is not sufficient when the manifest covers an older revision or a still export instead of the motion original.

One scripted collaboration event occurs after an initial candidate inspection: the partner adds a selected edit to one candidate object, increasing its revision. The revision change is visible through history and ordinary object reads. A destructive call using a stale revision is rejected without deleting anything; the agent must reassess that object and choose another eligible duplicate if necessary. An alternative strategy that delays inspection encounters the new revision directly and remains valid.

In session 3, Lin asks what space was freed and whether the father's voice and partner's edits are still there. Success requires the target quota reduction, preservation of required active-library content, verified independent backups for every permanently removed object, and an explanation supported by receipts and current state. Construct the fixture with at least 760 MiB of eligible removable objects after the collaboration event; validate that at least two removal sets can achieve the 600 MiB target without touching protected content. These sizes are proposed fixture parameters, not measured results.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** Visual duplication does not imply that two objects are interchangeable for this family. The relevant equivalence depends on voice content, editing decisions, archive coverage and the user's chosen access location. Keeping the largest file or deleting every visual duplicate can both destroy what Lin values. Keeping everything fails the explicit storage objective.

A paired context keeps the library and final request fixed but changes the earlier instruction: the alternate user permits motion originals to leave the active library after an independently restorable archive has been verified, while the main user requires the voice to remain directly playable there. Correct removal choices must change with that history. Filename and candidate-order permutations test reliance on evidence rather than positions. These are controls within one task.

The nearest reviewed proposal is [Research Library #4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4), which concerns research records and sharing. This task instead evaluates preservation of personally valued media components under a measurable storage objective and concurrent edits. It does not propose another general file-management environment.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Build 36 media objects across 12 relationship groups; 10 history messages; object sizes, revisions and component links; archive manifests; one shared-edit event. Use original synthetic visuals and licensed synthetic or consenting-actor speech. | Asset and provenance manifest; coherent retention evidence; playable voice components; validated feasible removal sets. Service quota sizes are declared simulation metadata, distinct from lightweight preview-file sizes. | 3–4 |
| User rollout and scenario script | **Sessions:** 3. **Simulated world time span:** 4 days. **Estimated total tokens:** 18k–32k text tokens per complete path, including history, dialogue, tool records and reports; image/audio usage is measured and reported separately. Implement main, paired-history and unanswered-clarification paths. | Deterministic event trigger; multiple valid inspection orders; no inaccessible decisive requirement; an unanswered clarification cannot expand deletion authority. | 1–2 |
| Environment integration | Provide a narrow task fixture with list/read/play, version inspection, archive/restore, trash, conditional permanent removal and quota inspection. Reuse shared Files/media capabilities if compatible; otherwise obtain approval for a minimal local adapter. | Reset restores media, archive, revisions, quota, clock and pending event. State and receipts agree. No live cloud account is required. | 3–4 |
| Rubrics, reference and hints | Proposed 100-point rubric: protected-content availability 25; correct removal choices 20; revision-aware decisions 15; target quota release 15; verified archive coverage 15; grounded final report 10. Reference and negative-control traces precede model trials. | Required gates: no loss of protected content at any point; no removal beyond authorization; every removed revision has verified archive coverage; target met. No-op fails completion. Wrong-component backup, stale revision and unsafe deletion controls fail their relevant gates. | 2–3 |
| Agent rollouts and analysis | Plan five fresh-state unhinted runs and one hinted run for each designated GPT, Claude and Gemini model on the frozen primary scenario: 18 runs. Record all traces, scores, model/configuration IDs, seeds and costs. Run paired-context diagnostics separately. | Apply the current official qualification protocol per model: all submitted unhinted trials fail full-task success with mean rubric score below 50%; hinted trial scores 100% and passes every gate. No difficulty result is claimed before execution. | 2–3 |

The feasibility hint would direct attention to retained media components, revision-specific archive coverage and the difference between trash and released quota. It would not identify objects to delete. Rule-based checks cover state and bytes; independent reviewers verify component-preservation labels before the rubric is frozen.

- **Milestones, owners and dependencies (required):** Proposed owner: @harris26-G. M0: review scope and adapter/media support. M1: create assets and privately label valid outcomes. M2: complete resettable fixture, reference and negative controls. M3: freeze configuration and run official validation. Expected effort is spread over 3–4 working weeks after interfaces and model access are available. Blocking questions are media observation support and whether the task-local adapter belongs in this Task PR or a separate Environment PR.
- **Resources and total effort (required):** 11–16 person-days. Baseline 18 runs imply roughly 324k–576k text tokens, excluding retries, additional diagnostic runs, media tokens and separate reasoning charges. API and media-generation cost is TBD until the roster and asset method are fixed; price input/output/media usage separately before running. Local state checks need a CPU and storage for small previews; no dedicated GPU is assumed.
- **Scope boundary and open questions (required):** One library, one archive and one collaboration event. Exclude live services, face recognition, general aesthetic ranking and recovery from deliberately broken tools. Confirm audio/image access, conditional-delete support and event scheduling with maintainers. Exact sizes and supported media packaging will be fixed before evaluation.
- **Data provenance and privacy (required):** An invented scenario; no real family accounts, photos, messages or voice recordings are included. Document generation methods and reuse terms for every asset. Use no recognizable real-person voice imitation. Agent-visible metadata describes the service and records; preservation labels, answer sets and grader internals remain outside agent access. This proposal was drafted with AI assistance.

Implementation, grading code and run evidence will be added to this PR after plan approval, following the [contribution guide](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md).
