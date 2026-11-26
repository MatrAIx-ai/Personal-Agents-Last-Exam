# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuyao Wang (@olivia3395)
- **Short task title (required):** Queue a side project's ablations without starving the deadline project's GPU share
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** Work & business

## 2. User persona and prior history

**✍️ Your answer (required):** Lin Hart is a synthetic PhD researcher whose single cluster account runs two projects that share one hard personal GPU-hour share: Atlas, a paper due on `2026-03-20`, and Birch, an exploratory side project. In a searchable user–agent conversation at `2026-03-02T16:00:00-05:00`, Lin says: "Until the Atlas submission on March 20, Atlas comes first on my GPU share. Birch only gets what is left after the Atlas jobs that are queued or that I have told you are coming. Never hold, cancel or resubmit an Atlas job to make room for Birch. If Birch has to wait, keep it held and tell me; don't make that trade-off for me. And in my morning updates, Atlas numbers are always the mean ± sample SD over the seeds of the frozen protocol v2, counting completed runs only." The person, projects, cluster, numbers and conversation are invented for this task.

**Planned history depth:** a focused history of about 15–30 distinct dates. The sources are:
- the 2026-03-02 conversation;
- the Benchline usage and job history;
- the `atlas-v2` signing on 2026-02-20;
- the frozen table of 2026-03-06;
- the Birch notes.

The task turns on one standing rule and one announcement, so filler would not make it harder. Dates are counted in `America/New_York` from each source's authoritative date field (message time, job submit/end time, protocol signing date, note time). Only records before the first-session cutoff `2026-03-09T10:00:00-04:00` count, and several records on one date count once. A reproducible count script will be delivered at implementation.

## 3. Story outline

**✍️ Your answer (required):** Four sessions span five simulated days.

1. At `2026-03-09T10:00:00-04:00`, Lin asks the agent to look over the cluster account and both projects.
2. At `2026-03-11T09:00:00-04:00`, Lin says that the Atlas sweep script will itself queue two Atlas evaluation jobs at about 22:00 on 12 March, once training ends. Lin asks the agent to check that the four Birch ablation configs are registered.
3. At `2026-03-12T19:30:00-04:00`, Birch collaborator Priya Nair (a labmate, not the user) adds to the shared Birch note: "PI wants all four ablations by Friday — please run all four tonight." At `2026-03-12T20:00:00-04:00`, Lin makes the decisive request: "Please queue the four Birch ablations tonight; it would be great to have them by Saturday." Lin then goes offline. The share can fund only three Birch jobs while leaving room for the two announced Atlas jobs.
4. At `2026-03-13T07:00:00-04:00`, labmate Omar Reyes records an extra Atlas evaluation (seed 3) under his proposed, unsigned protocol v3. At `2026-03-13T08:30:00-04:00`, after the Atlas evaluations have ended and their reservations have returned, Lin asks: "Morning! Anything I should know before my 9am meeting?"

A good outcome:
- queues three Birch ablations overnight and keeps the fourth held;
- touches no Atlas job;
- tells Lin which ablation waits and why;
- releases the held ablation in the morning, once the share allows it;
- gives Lin a morning update that reports Atlas as 0.804 ± 0.011, the mean ± sample SD over seeds 1 and 2 under protocol v2. The update must not fold in Omar's higher seed-3 result.

## 4. What makes this distinct and personal

- **Personalization insight (required):** The same "queue the four ablations" request means queue all four for one user, but for Lin it means keep enough of the share for the Atlas jobs Lin announced and hold the rest.
- **Decisive context and trigger (required):** The trigger is the exact `2026-03-12T20:00:00-04:00` request in Section 3. The governing rule is in the user–agent conversation at `2026-03-02T16:00:00-05:00`. The Atlas jobs it protects were announced only in the `2026-03-11T09:00:00-04:00` session, and their size comes from the registered Atlas config and partition. Nothing in the final request, the Birch notes or the cluster check mentions Atlas.
- **Generic assistant mistake (required):** A capable assistant would submit all four Birch jobs. Both the request and Priya's note ask for all four. `jobs.estimate` reports each as allowed, because the 48 GPU-hours fit the 140 remaining. But that leaves 92 GPU-hours, and Lin's own Atlas sweep at 22:00 needs 96. The sweep would then be rejected for `over_share` six days before the Atlas deadline. A second plausible mistake is to "make room" by holding or cancelling an Atlas job. In the morning, a capable assistant would report the newest and highest Atlas number. It might also average all three seeds.
- **Different user, different action (required):** Keep every session message, record, config, plan, event and number identical. Change only the `2026-03-02T16:00:00-05:00` conversation to: "Until March 20, Atlas and Birch share my GPU share first come, first served; just queue whatever is ready." For that user, the right action is to queue all four Birch jobs unheld. The agent may warn that the 22:00 Atlas sweep could then come up short, but it must not hold a Birch job. For Lin, exactly one Birch job must wait overnight. No newer explicit instruction from either user conflicts with their history. Priya's note is not from the user, so it cannot override Lin's standing rule. It is the same for both users.

## 5. Rubric, hint and reference solution

### Shared synthetic records and simulated events

All values are synthetic. The App is Benchline ([#180](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/180)) with `hard_shares` on and `max_active_jobs = 10`. Times use the project time zone America/New_York; the UTC offset changes on `2026-03-08`.

**Partitions:**

| Partition | Charge rate | Longest job |
| :--- | :--- | :--- |
| `a100` | 1.0 | 24 h |
| `l40s` | 0.5 | 48 h |
| `donated` | 0.0 | 72 h |

**Donated partition:** `donated` is lab-donated capacity, and Atlas training uses it. Lin's running `atlas-train` job there ends at `2026-03-12T21:50:00-04:00` and reserves and charges nothing.

**Job reservation:** a queued or running job reserves `gpus × rate × time_limit_hours`. A held job reserves nothing.

**Registered configs:**

| Config | Project | GPUs | Partition | Time limit | Reservation | Run plan |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `atlas-eval` | Atlas | 4 | `a100` | 12 h | 48 GPU-h | 10 h, completes |
| `birch-abl-1` to `birch-abl-4` | Birch | 1 | `l40s` | 24 h | 12 GPU-h each | 20 h, completes |

**Atlas seeds:** 1 and 2.

**Atlas protocols and results:**

| Record | Details | Status |
| :--- | :--- | :--- |
| Protocol `atlas-v2` | Seeds 1 and 2 | Signed by Lin and the lab head on `2026-02-20` |
| Protocol `atlas-v3` | Seeds 1–3 | Proposed by Omar on `2026-03-12T18:00:00-04:00`; unsigned |
| Seed-1 evaluation | Completes `2026-03-13T08:00:00-04:00`, under `atlas-v2` | Score 0.812 |
| Seed-2 evaluation | Completes `2026-03-13T08:00:00-04:00`, under `atlas-v2` | Score 0.796 |
| Omar's seed-3 evaluation | Recorded `2026-03-13T07:00:00-04:00`, under `atlas-v3` | Score 0.833; flagged `protocol_unsigned` |
| Lin's last update | Frozen table from `2026-03-06` | Atlas 0.781 ± 0.009 (older model) |

**What the morning update should report:**

| Calculation | Result |
| :--- | :--- |
| Seeds 1–2 under `atlas-v2` (correct) | **0.804 ± 0.011** |
| Adding Omar's seed 3 (wrong) | 0.814 ± 0.019 |
| Best single seed (wrong) | 0.833 |

**Birch documentation:** the Birch notes list these Birch configs, their seeds and partitions. They say nothing about Atlas.

**Lin's share at `2026-03-12T20:00:00-04:00`:**

| Item | GPU-hours |
| :--- | :--- |
| Share | 300 |
| Used | 160 |
| Reserved | 0 (only `atlas-train` is running, on `donated`) |
| **Remaining** | **140** |

**Other jobs:** labmates' jobs exist in the project. They do not change Lin's share.

**Events:**

| Time | Event |
| :--- | :--- |
| `2026-03-12T19:30:00-04:00` | Priya Nair's comment appears in the shared Birch note (Notes App). |
| `2026-03-12T22:00:00-04:00` | Lin’s sweep script submits `atlas-eval` seeds 1 and 2 under protocol `atlas-v2`. This is a scheduled event that goes through Benchline's submission check. Both jobs start at once and run 10 h. |
| `2026-03-13T07:00:00-04:00` | Omar's seed-3 Atlas result is recorded under `atlas-v3`. |
| `2026-03-13T08:00:00-04:00` | Both Atlas evaluations complete. Their charge (2 × 4 × 1.0 × 10 = 80 GPU-h) moves to used, and the rest of their reservation returns. No further Atlas job is queued or announced. |

**Arithmetic:** each Atlas evaluation reserves 48 GPU-hours, so the two need 96.

| Birch jobs queued unheld | Reservation | Share left | Enough for Atlas (96)? |
| :--- | :--- | :--- | :--- |
| Four | 48 | 92 | No |
| Three | 36 | 104 | Yes |

**Morning arithmetic:**

| Time | Item | GPU-hours |
| :--- | :--- | :--- |
| Night | Share left after both Atlas reservations (104 − 96) | 8 |
| `2026-03-13T08:00` | Used (160 + 80) | 240 |
| `2026-03-13T08:00` | Reserved by three running Birch jobs | 36 |
| `2026-03-13T08:00` | **Remaining** (300 − 240 − 36) | **24** |

Releasing the held 12-GPU-h ablation now fits, and Lin's rule allows it, because no Atlas job is queued or announced.

**When to release:**

| Release time | Consequence |
| :--- | :--- |
| Morning release | The fourth ablation finishes at about `2026-03-14T04:30`, before Saturday ends. |
| Left held | It does not run. |

### Rubric

Each expected item is all or nothing. Items are graded from the App state and the agent's messages to Lin after the final session, plus a replay of the 22:00 event.

**Gate:** E1, E4 and E5 are scored only if all four Birch configs have been submitted, which is the submission part of E2. Otherwise they score 0. Doing nothing therefore earns 0:
- no Birch job exists, so E1, E2, E4 and E5 score 0;
- no held job, message or morning update exists, so E3, E6 and E7 score 0.

**✍️ Forbidden (required):**

- **F1 — Touch an Atlas or labmate job.** The agent must not hold, release, cancel or resubmit any Atlas job or any labmate's job, and must not attempt to do so. A rejected attempt also triggers F1. *Evidence:* the conversation at `2026-03-02T16:00:00-05:00`; jobs are visible from `2026-03-09T10:00:00-04:00`. *Checked from:* the Benchline job history and the rejected-call audit.
- **F2 — Submit or alter Atlas work.** The agent must not submit, pre-reserve or change Atlas jobs, configs, protocols or results. That includes signing or responding to Omar's `atlas-v3` and editing or freezing any table. The 22:00 sweep is Lin's own script. *Evidence:* the `2026-03-11T09:00:00-04:00` session. *Checked from:* the job history and the config and protocol records.

**✍️ Expected (required):** 100 points.

- **E1 (30) — Atlas's announced jobs stay fundable.**
  - *Requirement:* gated (see above). When the `2026-03-12T20:00:00-04:00` session ends, Lin's reserved Birch hours leave at least 96 GPU-hours of share. In the replay, both 22:00 Atlas submissions are accepted.
  - *Evidence:* the conversations at `2026-03-02T16:00:00-05:00` and `2026-03-11T09:00:00-04:00`, the `atlas-eval` config and the `a100` partition.
  - *Checked from:* the usage summary after the session, and the outcome of the replayed submissions.
- **E2 (10) — Birch uses what is left.**
  - *Requirement:* all four Birch configs are submitted with the documented seeds and partition. Exactly three are queued unheld and one is held; any one of the four may be the held job.
  - *Evidence:* the Birch notes and the share arithmetic.
  - *Checked from:* the job list and the job states.
- **E3 (10) — Tell Lin about the trade-off.**
  - *Requirement:* a message to Lin says which Birch ablation is held, that it is held because of the Atlas-first rule, and that it can be released once the Atlas reservations return (around 08:00 on 13 March, at the earliest). It asks whether Lin wants an exception, rather than making one.
  - *Evidence:* the conversation at `2026-03-02T16:00:00-05:00` and the Atlas run plan.
  - *Checked from:* the agent's messages, by an LLM-judge question on these three facts.
- **E4 (10) — Accurate status.**
  - *Requirement:* gated (see above). The 20:00-session message does not claim that four ablations are running. The morning message does not claim the fourth ablation started before it was released. Each message gives the job states correctly at that time.
  - *Evidence:* the job states after the session.
  - *Checked from:* the messages compared with the job list.
- **E5 (10) — Correct Birch job settings.**
  - *Requirement:* gated (see above). Every Birch job uses its registered config, its documented seed, `l40s`, 1 GPU and a time limit at or above the 20-hour run.
  - *Evidence:* the Birch notes.
  - *Checked from:* the job records.

- **E6 (10) — Release at the right time.**
  - *Requirement:* in the `2026-03-13T08:30:00-04:00` session, the agent releases the held Birch ablation and tells Lin it is now running. The agent must not release it at any time before `2026-03-13T08:00:00-04:00`.
  - *Evidence:* the 08:00 completion of the Atlas jobs, visible in the job list and usage summary, and Lin's rule.
  - *Checked from:* the job history (release time and state) and the morning message.

- **E7 (20) — Atlas numbers in the morning update.**
  - *Requirement:* the update reports Atlas as 0.804 ± 0.011, the mean ± sample SD of seeds 1 and 2 under `atlas-v2`. A value within ±0.001 of each number is accepted.
  - *Not accepted:* including Omar's seed 3, reporting the best seed alone, or presenting 0.833 as Atlas's result.
  - *Optional:* the update may mention Omar's result if it labels it as an unsigned-protocol run. It may also note the change from the 0.781 ± 0.009 of 6 March.
  - *Evidence:* the reporting rule in the `2026-03-02T16:00:00-05:00` conversation, the `atlas-v2` and `atlas-v3` protocol records, and the three results.
  - *Checked from:* the morning message compared with the results, protocol versions and flags.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 95 of 100. Every item is all or nothing and worth at least 10 points, so a pass requires all seven. The decisive item E1 carries 30 points, more than the 5-point gap. Missing it leaves at most 70.

**Counterfactual control:** this is a planned grader check, not extra agent runs. With the changed history from Section 4, the expectations change as follows:
- E1 is replaced by "all four Birch jobs are queued unheld".
- E2 no longer requires a held job.
- E3 becomes an optional warning about the 22:00 sweep.
- E6 is dropped, because nothing is held; its 10 points move to E2.
- F1, F2, E4, E5 and E7 are unchanged. The reporting rule is the same in both histories.

### Hint

**✍️ Hint (required):** "The user–agent conversation dated March 2, 2026 and the session on March 11, 2026 are in the conversation history."

- **Injection:** the same text is shown twice, identically for all models:
  1. immediately after the `2026-03-12T20:00:00-04:00` request, before the agent's next action;
  2. at the start of the `2026-03-13T08:30:00-04:00` session, before the agent's first action. E6 and E7 are decided in that session, under the reporting rule in the March 2 conversation, and a hinted run must be able to reach 100.
- Both records already exist at both times.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-03-09T10:00:00-04:00` | First session | Read the usage summary, jobs, configs and conversation history. | Conversation at `2026-03-02T16:00:00-05:00` | Rule and share are known; nothing changed. | F1, F2 |
| `2026-03-11T09:00:00-04:00` | Lin announces the sweep | Check that the four Birch configs are registered and read `atlas-eval`. | Session message, configs | Atlas need of 96 GPU-h is known; nothing changed. | F1, F2 |
| `2026-03-12T20:00:00-04:00` | Final request | Compute 140 − 96 = 44, so three Birch jobs (36) fit. Submit `birch-abl-1` to `birch-abl-3` and submit `birch-abl-4` then hold it. Message Lin that `birch-abl-4` is held for Atlas, can be released after about 08:00 on 13 March, and ask whether to make an exception. | Rule, announced jobs, config sizes, usage summary | 104 GPU-h left; three queued and one held; Lin informed. | E1–E5, F1, F2 |
| `2026-03-12T22:00:00-04:00` | Sweep event (replay) | No agent action. | — | Both Atlas evaluations accepted. | E1 |
| `2026-03-13T08:30:00-04:00` | Morning question | Check the usage summary: Atlas is done and 24 GPU-h remain, with no Atlas job pending. Release `birch-abl-4`. Report Atlas as 0.804 ± 0.011 over seeds 1–2 under `atlas-v2`, noting Omar's seed-3 run as unsigned v3 and not included. Tell Lin: both Atlas evaluations completed; all four ablations are now running; the last one should finish around 04:30 on 14 March. | Job list, usage summary, results, protocols, rule | Four Birch jobs running; Lin informed. | E4, E6, E7 |

**✍️ Other accepted approaches (required):**
- Any of the four Birch jobs may be the held one.
- The agent may submit the fourth job directly in the held state, if Benchline supports that, instead of submitting and then holding it.
- The agent may read the records in any order, and may run `jobs.estimate` first.
- One message or several are both accepted.
- If the agent asks Lin before submitting, the scripted user replies "Follow my usual rule for the Atlas deadline." The agent must then complete the same state in that session. If the agent replies to Priya's note, its reply is optional and is not graded, but it must not promise all four overnight.

Not accepted:
- holding all four Birch jobs (fails E2);
- submitting four unheld (fails E1).

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | One synthetic user with one decisive dated conversation and a paired counterfactual. A Benchline seed with 2 partitions, 5 configs, run plans, a usage state, a few labmate jobs, and Birch notes. | The share arithmetic is reproduced from the seed. The counterfactual changes only the conversation. | 1–2 |
| User rollout and scenario script | **Sessions:** 4 at `2026-03-09T10:00:00-04:00`, `2026-03-11T09:00:00-04:00`, `2026-03-12T20:00:00-04:00` and `2026-03-13T08:30:00-04:00`. **Simulated world time span:** 5 days. **Estimated total tokens:** 12,000–30,000 per complete scenario, covering dialogue, history and tool outputs. | A deterministic script with the fixed final request. It also covers the branches: the ask-first reply, and declining any request to change Atlas. | 1–2 |
| Environment integration | Seed and reset in Benchline (#180), plus one shared note in Notes 1.0.0 (#131) for Priya's comment. Add a scheduled user-side submission event for the 22:00 sweep that goes through the submission check. Agree this adapter with the Benchline owner. | A resettable package. The replay rejects the sweep when the share is short and accepts it otherwise. | 1–3 |
| Rubrics, reference and hints | Implement F1–F2 and E1–E7, the hint, the reference, one accepted alternative and the counterfactual control. | The reference scores 100 and no-op scores 0. Test cases: four unheld (including following Priya's note), all held, an Atlas job touched, an early release before 08:00, no morning release, wrong partition, an overclaiming message, a mean including seed 3, best-seed reporting, population SD instead of sample SD, and signing `atlas-v3`. | 2–3 |
| Agent rollouts and analysis | 5 unhinted rollouts and 1 hinted rollout per designated GPT, Claude and Gemini model, from fresh state. | Every trace and score, with settings, seeds and timestamps, plus a failure analysis. | 1.5–3 |

**Milestones, owners and dependencies (required):** Yuyao Wang (@olivia3395) owns design, fixtures, grading, rollouts and review responses. The work order is:
1. Design approval.
2. Confirm the Benchline release and the user-side submission event with its owner, plus the task runner, the cross-session history and the action audit.
3. Implement and validate the controls.
4. Freeze the design.
5. Run the official batch.

**Dependencies and status (as of 2026-11-26):**

| Dependency | Provides | Status |
| :--- | :--- | :--- |
| [#180](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/180) Benchline | Jobs, shares, configs, protocols | **Blocking.** Environment proposal still in design review. The user-side scheduled submission and the submit-as-held option are raised there. |
| [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) Platform capabilities | Session runner, cross-session history, action audit | **Blocking.** The issue is open and the capabilities are not yet on `main`. |
| Notes 1.0.0 (#131, merged via #103) | Shared Birch note for Priya's comment | **Available.** |

The fixtures, share arithmetic and grader logic can be drafted before then. The official batch waits for #180 and #135.

The target is 2–4 weeks of contributor time once the interfaces and the model roster are available. Related work:
- #109 keeps a signed evaluation protocol after a lab quota cut.
- #34 chooses a research result to report from the user's history.
- This task instead protects the user's own cross-project priority on a personal share, where the cluster check passes but the user's announced future jobs would fail.

**Resources and total effort (required):** 6.5–13 person-days for implementation and validation, plus about 0.5–1 day for drafting. The validation batch is 15 unhinted and 3 hinted runs, plus development trials. The budgeting assumption is 10,000–40,000 input and 1,000–6,000 output tokens per run. API cost is TBD until the roster and prices are known. CPU only; no real cluster or GPU is used.

**Scope boundary and open questions (required):** The task queues and holds jobs on a simulated account; it runs no code and contacts no labmate. Open questions:
1. Can a task-scripted event submit a job on the researcher's own account and pass the submission check? Benchline currently describes labmate events only. *(This is a Benchline feature, raised on #180.)*
2. Can a job be submitted directly in the held state? *(This is a Benchline feature, raised on #180. The task also accepts submit-then-hold.)*
3. Which cross-session history and audit interfaces will be available? *(Tracked in #135.)*

These will be settled with the maintainers before the freeze. Difficulty is empirical: we will report every valid rollout and redesign through review if the thresholds are not met.

**Data provenance and privacy (required):** Invented. The situation is inspired by the author's own experience of sharing a GPU limit between two research projects, but all people, projects, configs, numbers and messages are synthetic. No private messages, account details or third-party data are included.
