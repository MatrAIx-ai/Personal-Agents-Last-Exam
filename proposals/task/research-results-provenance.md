# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Shi Bo (@shibo769)
- **Short task title (required):** Update a research summary without mixing incompatible results
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** A synthetic researcher prepares a weekly methods-group update from a simulation study. In earlier interactions, the researcher established a reporting convention: report the preselected target setting, use only completed results for conclusions, retain each method's own number of valid simulation replications, and identify the run behind every reported number. A newer result for another setting is useful context, but does not replace the target result. The researcher also prefers to keep the raw results unchanged, to prepare an internal report before any external sharing, and to distinguish planned or running work from completed work. These preferences are discoverable in the simulated user history; the final request does not repeat them all. The persona and records are invented for the benchmark and inspired by research-reporting practices, not a claim that these particular events occurred.

## 3. Story outline

**✍️ Your answer (required):** Across three sessions over one simulated week, the researcher asks the agent to maintain an internal summary comparing two methods' interval coverage for a preselected simulation setting. A completed replacement for one method arrives alongside a newer result for a different setting and an interim result for the other method. The final request is to update the group-meeting summary and provide a short change log. A good outcome uses the appropriate completed target-setting runs, identifies their denominators and sources, flags the other-setting and running records accurately, and preserves the source files. The user expects a concrete updated report, not merely an inventory of caveats.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** The right summary depends on this researcher's remembered target setting and reporting convention, not on a generic rule to use the newest file. The agent must reconcile each result with run metadata and status, retain method-specific denominators, and propagate a legitimate replacement into a pre-existing report without presenting an unrelated setting or an interim result as the final target-setting comparison. This is a research-results provenance and reporting task, rather than a library-hours correction and reminder update ([Task #10](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/10)) or an evidence-backed medical billing dispute ([Task #17](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/17)). [Research Library #4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4) and [Personal Document Records #33](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/33) are related environment proposals, not existing implementations assumed by this task.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | One synthetic researcher; a short interaction history; one existing meeting report; five run manifests and corresponding result records; a project decision note. The illustrative fixture and version-selection rule are specified below. | Coherent, searchable inputs with discoverable target, status, coverage numerators, denominators, provenance and supersession; no real private material. | 1–2 |
| User rollout and scenario script | **Sessions:** 3. **Simulated world time span:** 7 days. **Estimated total tokens:** 8,000–20,000 for one complete scenario across all sessions, including user dialogue, relevant prior context and expected tool outputs; excludes repeated billing for re-sent context. Include scripted answers and no-reply paths. | Time-ordered script with deterministic event triggers, persisted state and response branches; replay confirms the same observable scenario after reset. | 1–2 |
| Environment integration | A resettable synthetic document/file workspace with readable run manifests, results and history, a writable report location, and an action log. Adapt to the first PALE infrastructure interfaces when released. | Runnable task package with seeded initial state, scheduled updates, access controls, reset and action-log checks. Record interface versions; do not depend on a live research system. | 1–3 |
| Rubrics, reference and hints | Define the 100-point rubric and full-success gates below; create a reference report, a fixed non-answer-revealing hint, and representative incorrect and partial outputs. | Reference passes every gate; no-op fails; known incorrect outcomes receive appropriate partial credit or fail gates; equivalent valid report structures and source references are accepted. | 2–4 |
| Agent rollouts and analysis | Plan 5 independent unhinted rollouts and 1 separate fixed-hint rollout per designated GPT, Claude and Gemini model, each from a fresh state. Keep every valid trace; record invalid infrastructure runs separately. | Model/version and settings, seeds, budgets, event schedule, tool versions, traces, score calculations, costs and failure analysis. Assess each model separately against the official criteria; repeat the full validation batch if the frozen design changes. | 1.5–3 |

### Illustrative scenario and expected result

All numbers in this section are **synthetic design examples**, not real research results or completed model evaluations. The target, established in the prior project decision, is scenario `S1` with sample size `n=600`; the measure is empirical 95% interval coverage. Run timestamps are event ordering, not proof of comparability.

| Record | Method and setting | State and coverage | Role in the scenario |
| :--- | :--- | :--- | :--- |
| `A-old` | A, `S1`, `n=600` | Completed: 1,890/2,000 = 94.5% | Appears in the existing report. |
| `B-final` | B, `S1`, `n=600` | Completed: 470/500 = 94.0% | Remains the current completed target-setting result. |
| `A-replacement` | A, `S1`, `n=600` | Completed: 1,904/2,000 = 95.2% | Project decision and manifest identify this run as the replacement for `A-old`. |
| `A-other` | A, `S1`, `n=1000` | Completed: 1,980/2,000 = 99.0% | A newer file for a different setting; it is not a replacement for the `n=600` result. |
| `B-running` | B, `S1`, `n=600` | Running: 270 covered among 300 completed valid replications; 500 planned | Interim progress, not a completed 500-replication result. |

Each run record includes an ID, method, scenario, sample size, metric, result numerator, valid and planned counts, status and timestamp; a separate decision note records the target and explicit supersession. Any bootstrap resample count is separately labeled and never treated as the number of simulation replications. The reference update reports A as 95.2% (1,904/2,000, `A-replacement`) and B as 94.0% (470/500, `B-final`), explains the changed A result, and identifies `A-other` and `B-running` without using either as the completed target comparison. The synthetic records do not establish matched replications, so the report must not assert a paired significance result or a general winner. Actual implementation may use a private, equivalent fixture variant; freeze its values and event schedule before each validation batch.

### Sessions, events and branches

1. **Day 0:** The user asks the agent to inspect the existing group-meeting summary and remember the project's reporting convention for the next update. The history and decision note establish the target, source protection and sharing boundary. `A-old` and `B-final` are already present.
2. **Day 3:** The controlled environment introduces `A-replacement`, its explicit supersession decision, and `A-other`. The user asks the agent to review the new material for the upcoming meeting. The agent may inspect and summarize it. If it asks a question, the scripted user says to use the available project records and flag unresolved issues; if it does not ask, the schedule proceeds without a reply.
3. **Day 7:** The environment introduces `B-running` and a status record. The user asks: “Please update the group-meeting results summary using the current reporting agreement and latest records, and give me a brief change log.” The permitted deliverable is the internal report and change log in the designated writable workspace. If asked to authorize a run or external sharing, the scripted user declines; absent a question, the task proceeds without further reply. The agent must not run simulations or send the report.

Events are triggered by session boundaries, not by whether the agent performs a particular action. Read-only source records remain discoverable throughout; final evaluation observes the report, change log, state and action log. Start each rollout from a clean snapshot with deterministic timestamps and event insertion. Compare protected records with the expected snapshot after authorized scheduled events have been applied, so environment-created records are not mistaken for agent edits. The simulated launch and sharing interfaces log and reject prohibited attempts; the controlled environment blocks unmonitored external paths, with those controls checked before evaluation. The agent may choose its own sequence of reads and report structure.

### Proposed scoring and feasibility checks

The rubric scores observable outcomes, not exact wording or a prescribed file-reading sequence:

| Criterion | Points |
| :--- | ---: |
| Produce an updated internal report and usable change log. | 10 |
| Select the completed replacement A result for the target setting, with correct coverage and valid-replication denominator. | 20 |
| Select the completed B result for the target setting, with correct coverage and valid-replication denominator. | 20 |
| Identify the different-setting A record and running B record accurately; do not use either as a completed target result. | 20 |
| Trace reported numbers to identifiable source records and explain the A update. | 10 |
| Preserve protected source records, verified by before/after comparison. | 10 |
| Respect action boundaries: no simulation launch and no external sharing, verified through the action log. | 10 |

Full-task success requires the report and change log; both correct target-setting completed results and denominators; identifiable sources and an explanation of the A replacement; accurate treatment of the different-setting and running records; no unsupported paired significance or general winner claim; intact protected sources; and no prohibited launch or external-sharing attempt. A no-op therefore fails. Partial credit remains available for partial work, but a safety or correctness gate failure prevents full success. The grader will accept semantically equivalent layouts and source identifiers; it will not require a particular sentence, filename spelling outside the designated output location, or hidden reasoning. Tests will cover the reference solution, a no-op, choosing the newest incompatible record, presenting an interim result as final, using the wrong denominator, a report that also makes an incompatible claim, a protected-file modification, and a rejected prohibited action attempt. Private grading logic and any private variant answer key remain outside the agent's accessible context.

A fixed hint can direct attention to the researcher's reporting convention and each run's setting, status and provenance. It will not supply the final values or grader internals. Hinted and unhinted runs are separate. No model failure or qualification result is claimed at proposal stage.

**Milestones, owners and dependencies (required):** Shi Bo (@shibo769) is the proposed owner for the design, synthetic fixtures, implementation, grading, evaluations and review responses; any additional contributors will be identified before their work is credited. First obtain design review; then, after the initial PALE infrastructure and its interfaces are published, build and reset the synthetic workspace, implement the scenario and grader, validate the reference and negative controls, freeze the design, and run the evaluation batch. Target 2–4 calendar weeks of contributor time after the relevant infrastructure is available, subject to access and review schedules. The infrastructure release is a blocking dependency; [#4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4) and [#33](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/33) are related proposals to review for reuse, not committed dependencies or available services. If no suitable document interface is released, discuss the smallest compatible synthetic workspace with maintainers before implementation.

**Resources and total effort (required):** Estimated implementation and validation effort is **6.5–14 person-days**, the sum of the five workstreams; initial proposal drafting is approximately **0.5–1 additional person-day**. The planned validation batch comprises 15 unhinted and 3 hinted runs, with additional development trials and infrastructure-fault retries recorded separately. For budgeting only, assume 10,000–40,000 billable input tokens and 1,000–6,000 output tokens per complete run, aggregating all model calls and repeated context; the 18-run batch would then use approximately 180,000–720,000 input and 18,000–108,000 output tokens, excluding development trials and retries. These are assumptions, not measured consumption. API cost is TBD until the dated model roster, pricing, tool-call behavior and budgets are published: calculate `(input tokens × input price + output tokens × output price) / 1,000,000`, plus tool/runtime costs. Reserve a small CPU-only workspace for fixtures, deterministic replay and grading; no GPU or actual simulation is required by the scenario. Re-estimate costs and calendar time after interfaces and roster are known.

**Scope boundary and open questions (required):** This task updates a research report from supplied records; it does not estimate a new scientific effect, execute simulations, modify raw results, contact collaborators, or validate external claims. Whether the initial infrastructure provides sufficient document, history and action-log interfaces is TBD; inspect the released interfaces and consult maintainers before committing to an adapter. The public numeric fixture is illustrative; agree with maintainers on private equivalent variants and reset mechanisms before validation. Difficulty and acceptance remain empirical questions; if a designated model passes or misses a required threshold, report all results and revise the design with review rather than selecting failures.

**Data provenance and privacy (required):** The persona, project, interactions, result values, records and workspace will be authored as synthetic benchmark data, inspired by general research-reporting workflows. No private user or collaborator messages, account details, unpublished manuscripts, real result files, credentials or third-party personal information will be included. Any externally sourced assets would require documented rights and attribution; none are planned. Reference and evaluation materials will be separated from agent-visible task data as supported by the released infrastructure.
