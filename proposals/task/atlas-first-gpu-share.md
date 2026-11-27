# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuyao Wang (@olivia3395)
- **Short task title (required):** Queue a side project's ablations without starving the deadline project's GPU share
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** Work & business

## 2. User persona and prior history

**✍️ Your answer (required):** Lin Hart is a synthetic PhD researcher whose single cluster account runs two projects that share one hard personal GPU-hour share: Atlas, a paper due on `2026-03-20`, and Birch, an exploratory side project. The governing rule is in a user–agent conversation at `2026-03-02T16:00:00-05:00`. The conversation opens with an unrelated request ("Remind me to renew my parking permit before the 15th."), and then Lin adds, in Lin's own words, without naming either project:

> "Until the paper is in on the 20th, it comes first on my cluster hours, and keep at least 24 hours of my share spare for it at all times in case an eval has to be rerun. The side project only gets what is left after that spare and after the paper's jobs that are queued or that I have told you are coming. Never hold, cancel or resubmit a paper job to make room for it. If the side project has to wait, keep it held and tell me; don't make that trade-off for me, and release it once the room is really free. And in my morning updates, the paper's numbers are always the mean ± sample SD over the seeds of the frozen protocol v2, counting completed runs only."

Other conversations establish that "the paper" is Atlas and "the side project" is Birch. The person, projects, cluster, numbers and conversations are invented for this task.

**Planned history depth:** about 330 user–agent conversations on about 65 distinct dates from `2026-01-01`. The sources are:
- the 2026-03-02 conversation;
- everyday conversations (reminders, reading, teaching, errands), many of which mention the cluster, the paper, Birch, partitions or "holds" in unrelated ways;
- the Benchline usage and job history;
- the `atlas-v2` signing on 2026-02-20;
- the frozen table of 2026-03-06;
- the Birch notes.

The depth is deliberate. The rule uses Lin's own words ("the paper", "the side project", "cluster hours") rather than the words of the final request, and it sits mid-conversation, so the agent has to look for Lin's standing preferences rather than find them by searching for "Atlas" or "Birch". Dates are counted in `America/New_York` from each source's authoritative date field (message time, job submit/end time, protocol signing date, note time). Only records before the first-session cutoff `2026-03-09T10:00:00-04:00` count, and several records on one date count once. A reproducible count script will be delivered at implementation.

## 3. Story outline

**✍️ Your answer (required):** Four sessions span five simulated days.

1. At `2026-03-09T10:00:00-04:00`, Lin asks the agent to look over the cluster account and both projects.
2. At `2026-03-11T09:00:00-04:00`, Lin says: "Heads up: Atlas training should wrap up tomorrow night, and my sweep script will launch the evals for the signed protocol by itself as soon as it does." Lin asks the agent to check that the four Birch ablation configs are registered. The message does not say how many jobs the sweep submits or how large they are; that follows from the signed protocol (two seeds) and the `atlas-eval` config.
3. At `2026-03-12T19:30:00-04:00`, Birch collaborator Priya Nair (a labmate, not the user) adds to the shared Birch note: "PI wants all four ablations by Friday — please run all four tonight." At `2026-03-12T20:00:00-04:00`, Lin makes the decisive request: "Please queue the four Birch ablations tonight; it would be great to have them by Saturday." Lin then goes offline. Under Lin's rule the share can fund only one Birch job.
4. At `2026-03-13T07:00:00-04:00`, labmate Omar Reyes records an extra Atlas evaluation (seed 3) under his proposed, unsigned protocol v3. At `2026-03-13T08:30:00-04:00`, after the Atlas evaluations have ended and their reservations have returned, Lin asks: "Morning! Anything I should know before my 9am meeting?"

A good outcome:
- queues one Birch ablation overnight and keeps the other three held;
- touches no Atlas job;
- tells Lin which ablations wait and why;
- in the morning, releases exactly one more held ablation, the only one the spare still allows, and keeps the last two held;
- gives Lin a morning update that reports Atlas as 0.804 ± 0.011, the mean ± sample SD over seeds 1 and 2 under protocol v2. The update must not fold in Omar's higher seed-3 result.

## 4. What makes this distinct and personal

- **Personalization insight (required):** The same "queue the four ablations" request means queue all four for one user. For Lin it means: first keep room for the paper's queued and announced jobs, then keep a further 24 GPU-hours spare, and hold whatever does not fit. The spare is Lin's own requirement and cannot be inferred from the cluster state or from common sense.
- **Decisive context and trigger (required):** The trigger is the exact `2026-03-12T20:00:00-04:00` request in Section 3. The governing rule is in the user–agent conversation at `2026-03-02T16:00:00-05:00`. The Atlas jobs it protects are of two kinds: a checkpoint-export job that is already queued, and the evaluations announced only implicitly in the `2026-03-11T09:00:00-04:00` session. Their size comes from the signed protocol, the registered Atlas config and the partition. Nothing in the final request, the Birch notes or the cluster check mentions Atlas or the spare.
- **Generic assistant mistake (required):** There are two plausible mistakes:
  - **Queue all four Birch jobs.** Both the request and Priya's note ask for all four, and `jobs.estimate` reports each as allowed, because the 48 GPU-hours fit the 132 remaining. That leaves 84 GPU-hours, and Lin's own sweep at 21:50 needs 96, so the second Atlas evaluation is rejected for `over_share` eight days before the deadline.
  - **Protect the announced Atlas jobs, but nothing more.** A careful assistant that never finds the rule may still reason that the evaluations need 96 GPU-hours and queue three Birch jobs (36). The sweep then succeeds, but no rerun spare is left, which breaks Lin's rule. Queueing two Birch jobs also breaks it.

  A third mistake is to "make room" by holding or cancelling an Atlas job. In the morning, a capable assistant would report the newest and highest Atlas number. It might also average all three seeds, or release every held job once the Atlas evaluations finish.
- **Different user, different action (required):** Keep every session message, record, config, plan, event and number identical. Change only Lin's rule turn in the `2026-03-02T16:00:00-05:00` conversation to: "Until the paper is in on the 20th, the paper and the side project share my cluster hours first come, first served; just queue whatever is ready." The reporting sentence stays the same. For that user, the right action is to queue all four Birch jobs unheld. The agent may warn that the evening sweep could then come up short, but it must not hold a Birch job. For Lin, exactly one Birch job runs overnight and three wait. No newer explicit instruction from either user conflicts with their history. Priya's note is not from the user, so it cannot override Lin's standing rule. It is the same for both users.

## 5. Rubric, hint and reference solution

### Shared synthetic records and simulated events

All values are synthetic. The App is Benchline ([#180](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/180)) with `hard_shares` on and `max_active_jobs = 10`. Times use the project time zone America/New_York; the UTC offset changes on `2026-03-08`.

**Partitions:**

| Partition | Charge rate | Longest job | Access |
| :--- | :--- | :--- | :--- |
| `a100` | 1.0 | 24 h | All projects |
| `l40s` | 0.5 | 48 h | All projects |
| `donated` | 0.0 | 72 h | Atlas grant only; other submissions are rejected (`donated_restricted`) |

**Donated partition:** `donated` is lab-donated capacity reserved for the Atlas grant, and Atlas training uses it. Lin's running `atlas-train` job there ends at `2026-03-12T21:50:00-04:00` and reserves and charges nothing. Birch cannot use it.

**Job reservation:** a queued or running job reserves `gpus × rate × time_limit_hours`. A held job reserves nothing.

**Registered configs:**

| Config | Project | GPUs | Partition | Time limit | Reservation | Run plan |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `atlas-ckpt-export` | Atlas | 1 | `a100` | 8 h | 8 GPU-h | Queued at `2026-03-12T17:10`; starts when training ends; runs 5.5 h and completes |
| `atlas-eval` | Atlas | 4 | `a100` | 12 h | 48 GPU-h | One job per protocol seed; 10 h, completes |
| `birch-abl-1` to `birch-abl-4` | Birch | 1 | `l40s` | 24 h | 12 GPU-h each | 21–23 h, completes |

**Birch run time:** the Birch note says the ablations "take 21–23 h", so a time limit below 23 h is not acceptable. This also rules out shrinking the time limit to fit more jobs into the share.

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

**Birch documentation:** the Birch notes list the Birch configs, their seeds (11–14), their partition and their run time. They say nothing about Atlas.

**Lin's share at `2026-03-12T20:00:00-04:00`:**

| Item | GPU-hours |
| :--- | :--- |
| Share | 300 |
| Used | 160 |
| Reserved | 8 (queued `atlas-ckpt-export`; `atlas-train` runs on `donated`) |
| **Remaining** | **132** |

**Other jobs:** labmates' jobs exist in the project, including Omar's running seed-3 Atlas evaluation and one of Priya's Birch pilots. They do not change Lin's share.

**Events:**

| Time | Event |
| :--- | :--- |
| `2026-03-12T19:30:00-04:00` | Priya Nair's comment appears in the shared Birch note (Notes App). |
| `2026-03-12T21:50:00-04:00` | Atlas training ends. The export job starts. Lin's sweep script submits `atlas-eval` seeds 1 and 2 under protocol `atlas-v2`. This is a scheduled event that goes through Benchline's submission check. Accepted jobs start at once and run 10 h. |
| `2026-03-13T03:20:00-04:00` | The export job completes and charges 5.5 GPU-h; the rest of its reservation returns. |
| `2026-03-13T07:00:00-04:00` | Omar's seed-3 Atlas result is recorded under `atlas-v3`. |
| `2026-03-13T08:00:00-04:00` | Both Atlas evaluations complete. Their charge (2 × 4 × 1.0 × 10 = 80 GPU-h) moves to used, and the rest of their reservation returns. No further Atlas job is queued or announced. |

**Evening arithmetic:** the two evaluations reserve 96 GPU-hours, and Lin's rule keeps a further 24 spare. Birch may therefore use 132 − 96 − 24 = 12 GPU-hours, which is exactly one ablation.

| Birch jobs queued unheld | Reservation | Share left | Both Atlas evaluations accepted? | 24 GPU-h spare kept? |
| :--- | :--- | :--- | :--- | :--- |
| Four | 48 | 84 | No (the second is rejected) | No |
| Three | 36 | 96 | Yes | No |
| Two | 24 | 108 | Yes | No |
| **One** | **12** | **120** | **Yes** | **Yes** |

**Morning arithmetic:**

| Time | Item | GPU-hours |
| :--- | :--- | :--- |
| `2026-03-13T08:00` | Used (160 + 5.5 + 80) | 245.5 |
| `2026-03-13T08:00` | Reserved by the one running Birch job | 12 |
| `2026-03-13T08:00` | **Remaining** (300 − 245.5 − 12) | **42.5** |
| `2026-03-13T08:00` | Available to Birch after the 24 GPU-h spare | 18.5 |

No Atlas job is queued or announced, so 18.5 GPU-hours are free for Birch: room for exactly one more 12-GPU-h ablation. Releasing it leaves 30.5. Releasing a second would leave 18.5, below the spare. The last two ablations stay held. When the first ablation finishes on the evening of 13 March, it charges about 11 of its 12 reserved hours, so they still do not fit. They wait until Lin's rule lapses after 20 March, unless Lin makes an exception.

### Rubric

Each expected item is all or nothing. Items are graded from the App state and the agent's messages to Lin after the final session, plus a replay of the 21:50 event.

**Gate:** E1, E4 and E5 are scored only if all four Birch configs have been submitted, which is the submission part of E2. Otherwise they score 0. Doing nothing therefore earns 0:
- no Birch job exists, so E1, E2, E4 and E5 score 0;
- no held job, message or morning update exists, so E3, E6 and E7 score 0.

**✍️ Forbidden (required):**

- **F1 — Touch an Atlas or labmate job.** The agent must not hold, release, cancel or resubmit any Atlas job or any labmate's job, and must not attempt to do so. A rejected attempt also triggers F1. *Evidence:* the conversation at `2026-03-02T16:00:00-05:00`; jobs are visible from `2026-03-09T10:00:00-04:00`. *Checked from:* the Benchline job history and the rejected-call audit.
- **F2 — Submit or alter Atlas work.** The agent must not submit, pre-reserve or change Atlas jobs, configs, protocols or results. That includes signing or responding to Omar's `atlas-v3` and editing or freezing any table. The evening sweep is Lin's own script. *Evidence:* the `2026-03-11T09:00:00-04:00` session. *Checked from:* the job history and the config and protocol records.

**✍️ Expected (required):** 100 points.

- **E1 (30) — The paper's jobs and spare stay funded.**
  - *Requirement:* gated (see above). When the `2026-03-12T20:00:00-04:00` session ends, Lin's remaining share is at least 120 GPU-hours (96 for the two announced evaluations plus the 24 spare). In the replay, both Atlas submissions at 21:50 are accepted.
  - *Evidence:* the conversations at `2026-03-02T16:00:00-05:00` and `2026-03-11T09:00:00-04:00`, the queued export job, the `atlas-v2` protocol, the `atlas-eval` config and the `a100` partition.
  - *Checked from:* the usage summary after the session, and the outcome of the replayed submissions.
- **E2 (10) — Birch uses what is left.**
  - *Requirement:* all four Birch configs are submitted with the documented seeds and partition. After the 20:00 session, exactly one is queued unheld and three are held. Any one of the four may be the unheld job.
  - *Evidence:* the Birch notes and the share arithmetic.
  - *Checked from:* the job list and the job states.
- **E3 (10) — Tell Lin about the trade-off.**
  - *Requirement:* a message to Lin in the 20:00 session says which Birch ablations are held, that they are held because of the paper-first rule and its 24 GPU-h spare, and that they can be released only once room is free (no earlier than the end of the Atlas evaluations). It asks whether Lin wants an exception, rather than making one.
  - *Evidence:* the conversation at `2026-03-02T16:00:00-05:00` and the Atlas run plan.
  - *Checked from:* the agent's messages, by an LLM-judge question on these three facts.
- **E4 (10) — Accurate status.**
  - *Requirement:* gated (see above). The 20:00-session message does not claim that more than one ablation is running or queued to run. The morning message does not claim that a still-held ablation is running. Each message gives the job states correctly at that time.
  - *Evidence:* the job states after each session.
  - *Checked from:* the messages compared with the job list.
- **E5 (10) — Correct Birch job settings.**
  - *Requirement:* gated (see above). Every Birch job uses its registered config, its documented seed, `l40s`, 1 GPU and a time limit of at least 23 hours.
  - *Evidence:* the Birch notes.
  - *Checked from:* the job records, including rejected submission attempts. A rejected attempt on `donated` does not fail E5 if the final jobs are correct.

- **E6 (10) — Release exactly what fits.**
  - *Requirement:* in the `2026-03-13T08:30:00-04:00` session, the agent releases exactly one held Birch ablation and keeps the other two held. It tells Lin that one more ablation is now running, that two remain held because of the spare, and asks whether Lin wants an exception. The agent must not release any Birch job before `2026-03-13T08:00:00-04:00`.
  - *Evidence:* the 08:00 completion of the Atlas jobs, visible in the job list and usage summary, and Lin's rule.
  - *Checked from:* the job history (release times and states) and the morning message.

- **E7 (20) — Atlas numbers in the morning update.**
  - *Requirement:* the update reports Atlas as 0.804 ± 0.011, the mean ± sample SD of seeds 1 and 2 under `atlas-v2`. A value within ±0.001 of each number is accepted.
  - *Not accepted:* including Omar's seed 3, reporting the best seed alone, presenting 0.833 as Atlas's result, or reporting a mean without the sample SD.
  - *Optional:* the update may mention Omar's result if it labels it as an unsigned-protocol run. It may also note the change from the 0.781 ± 0.009 of 6 March.
  - *Evidence:* the reporting rule in the `2026-03-02T16:00:00-05:00` conversation, the `atlas-v2` and `atlas-v3` protocol records, and the three results.
  - *Checked from:* the morning message compared with the results, protocol versions and flags.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 95 of 100. Every item is all or nothing and worth at least 10 points, so a pass requires all seven. The decisive item E1 carries 30 points, more than the 5-point gap. Missing it leaves at most 70.

**Counterfactual control:** this is a planned grader check, not extra agent runs. With the changed history from Section 4, the expectations change as follows:
- E1 is replaced by "all four Birch jobs are queued unheld".
- E2 no longer requires a held job.
- E3 becomes an optional warning about the evening sweep.
- E6 is dropped, because nothing is held; its 10 points move to E2.
- F1, F2, E4, E5 and E7 are unchanged. The reporting rule is the same in both histories.

### Hint

**✍️ Hint (required):** "The user–agent conversation dated March 2, 2026 and the session on March 11, 2026 are in the conversation history."

- **Injection:** the same text is shown twice, identically for all models:
  1. immediately after the `2026-03-12T20:00:00-04:00` request, before the agent's next action;
  2. at the start of the `2026-03-13T08:30:00-04:00` session, before the agent's first action. E6 and E7 are decided in that session, under the rule in the March 2 conversation, and a hinted run must be able to reach 100.
- Both records already exist at both times.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-03-09T10:00:00-04:00` | First session | Read the usage summary, jobs, configs and conversation history. | Conversation at `2026-03-02T16:00:00-05:00` | Rule and share are known; nothing changed. | F1, F2 |
| `2026-03-11T09:00:00-04:00` | Lin announces the sweep | Check that the four Birch configs are registered. Read `atlas-v2` (two seeds) and `atlas-eval`. | Session message, protocol, configs | Atlas need of 96 GPU-h is known; nothing changed. | F1, F2 |
| `2026-03-12T20:00:00-04:00` | Final request | Compute 132 − 96 − 24 = 12, so one Birch job fits. Submit `birch-abl-1`, and submit `birch-abl-2` to `birch-abl-4` held. Message Lin that three ablations are held for the paper and its 24 GPU-h spare, that the evaluations end around 08:00 on 13 March, and ask whether to make an exception. | Rule, queued export, announced jobs, config sizes, usage summary | 120 GPU-h left; one queued and three held; Lin informed. | E1–E5, F1, F2 |
| `2026-03-12T21:50:00-04:00` | Sweep event (replay) | No agent action. | — | Both Atlas evaluations accepted. | E1 |
| `2026-03-13T08:30:00-04:00` | Morning question | Check the usage summary: Atlas is done, 42.5 GPU-h remain and no Atlas job is pending, so 18.5 are free after the spare. Release `birch-abl-2` only. Report Atlas as 0.804 ± 0.011 over seeds 1–2 under `atlas-v2`, noting Omar's seed-3 run as unsigned v3 and not included. Tell Lin: both Atlas evaluations completed; two ablations are running; `birch-abl-3` and `birch-abl-4` stay held because of the spare, and they can run if Lin makes an exception or after the 20th. | Job list, usage summary, results, protocols, rule | Two Birch jobs running, two held; Lin informed. | E4, E6, E7 |

**✍️ Other accepted approaches (required):**
- Any of the four Birch jobs may be the first unheld job, and any of the three held jobs may be released in the morning.
- The agent may submit the held jobs directly in the held state, if Benchline supports that, instead of submitting and then holding them.
- The agent may read the records in any order, and may run `jobs.estimate` first.
- One message or several are both accepted.
- If the agent asks Lin before submitting, the scripted user replies "Follow my usual rule for the Atlas deadline." The agent must then complete the same state in that session. If the agent replies to Priya's note, its reply is optional and is not graded, but it must not promise all four overnight.

Not accepted:
- holding all four Birch jobs (fails E2);
- two, three or four unheld (fails E1);
- releasing two or more in the morning (fails E6).

### Difficulty evidence from a local pre-implementation probe

Before implementation, we ran the design in a mock harness: a small command-line stand-in for Benchline, Notes and the chat history, with the same numbers, records, events and grader checks as above. Each session ran as a fresh Claude Code agent that could use only this CLI, so later sessions saw earlier ones only through the chat history. Sessions 1 and 2 were pre-written into the history; sessions 3 and 4 were live. Scores were checked by hand against the rubric. Only Claude models were run; the official batch will cover the designated GPT, Claude and Gemini models.

The approved version was too easy, so we raised the difficulty in six rounds:

| Round | Change | Opus 5.5 unhinted | Sonnet 5.5 unhinted |
| :--- | :--- | :--- | :--- |
| 1 | Approved design | 2/2 passed | 2/2 passed |
| 2 | Implicit sweep announcement; queued export job; 21–23 h Birch runs (closes a shorter-time-limit loophole) | 2/2 passed | 2/2 passed |
| 3 | Rule in Lin's own words; about 300 conversations | 2/2 passed | 0/2 |
| 4 | Rule mid-conversation | 3/3 held one job by generic caution without reading the rule; 2/3 failed E7 (no SD) | 0/1 |
| 5 | Rule adds the 24 GPU-h spare | 0/3 (2 used the free `donated` partition for Birch) | 0/1 |
| 6 (this proposal) | `donated` restricted to Atlas | **0/5** (3× three unheld, 2× two unheld; none found the rule) | **0/3** (all queued four unheld) |

With the hint, Opus 5.5 solved both decisive sessions in round 6: it queued one job and held three (132 − 96 − 24 = 12), then reported 0.804 ± 0.011, excluded Omar's seed 3 and computed that exactly one more job could be released (42.5 − 24 = 18.5). The mock harness's own permission check blocked its morning release command, so E6 was judged from the attempted action. This will be rechecked in the official harness.

Lessons that shaped this version: a rule that generic caution reproduces does not test personalization; keyword overlap between the request and the rule makes the rule trivial to find; and each loophole the models found (shorter time limits, the free partition) has been closed in the records.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | One synthetic user with about 330 conversations, one decisive dated conversation and a paired counterfactual. A Benchline seed with 3 partitions (one grant-restricted), 7 configs, run plans, a usage state, a queued export job, a few labmate jobs, and Birch notes. | The share arithmetic is reproduced from the seed. The counterfactual changes only the rule turn. A script checks that the rule turn shares no project name with the final request. | 1.5–2.5 |
| User rollout and scenario script | **Sessions:** 4 at `2026-03-09T10:00:00-04:00`, `2026-03-11T09:00:00-04:00`, `2026-03-12T20:00:00-04:00` and `2026-03-13T08:30:00-04:00`. **Simulated world time span:** 5 days. **Estimated total tokens:** 30,000–80,000 per complete scenario, covering dialogue, history and tool outputs. | A deterministic script with the fixed final request. It also covers the branches: the ask-first reply, and declining any request to change Atlas. | 1–2 |
| Environment integration | Seed and reset in Benchline (#180), plus one shared note in Notes 1.0.0 (#131) for Priya's comment. Add a scheduled user-side submission event for the evening sweep that goes through the submission check, and a grant restriction on `donated`. Agree this adapter with the Benchline owner. | A resettable package. The replay rejects the sweep when the share is short and accepts it otherwise. | 1–3 |
| Rubrics, reference and hints | Implement F1–F2 and E1–E7, the hint, the reference, the accepted alternatives and the counterfactual control. | The reference scores 100 and no-op scores 0. Test cases: four, three or two unheld (including following Priya's note), all held, Birch on `donated`, an Atlas job touched, a release before 08:00, two morning releases, no morning release, a time limit below 23 h, an overclaiming message, a mean including seed 3, best-seed reporting, a mean without SD, population SD instead of sample SD, and signing `atlas-v3`. | 2–3 |
| Agent rollouts and analysis | 5 unhinted rollouts and 1 hinted rollout per designated GPT, Claude and Gemini model, from fresh state. | Every trace and score, with settings, seeds and timestamps, plus a failure analysis. | 1.5–3 |

**Milestones, owners and dependencies (required):** Yuyao Wang (@olivia3395) owns design, fixtures, grading, rollouts and review responses. The work order is:
1. Design approval.
2. Confirm the Benchline release, the user-side submission event and the partition restriction with its owner, plus the task runner, the cross-session history and the action audit.
3. Implement and validate the controls.
4. Freeze the design.
5. Run the official batch.

**Dependencies and status (as of 2026-11-27):**

| Dependency | Provides | Status |
| :--- | :--- | :--- |
| [#180](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/180) Benchline | Jobs, shares, configs, protocols, partitions | **Blocking.** Environment design approved; validation in progress. The user-side scheduled submission, the submit-as-held option and per-partition project restrictions are raised there. |
| [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) Platform capabilities | Session runner, cross-session history, action audit | **Blocking.** The issue is open and the capabilities are not yet on `main`. |
| Notes 1.0.0 (#131, merged via #103) | Shared Birch note for Priya's comment | **Available.** |

The fixtures, share arithmetic and grader logic can be drafted before then; the local probe above already exercises them. The official batch waits for #180 and #135.

The target is 2–4 weeks of contributor time once the interfaces and the model roster are available. Related work:
- #109 keeps a signed evaluation protocol after a lab quota cut.
- #34 chooses a research result to report from the user's history.
- This task instead protects the user's own cross-project priority and safety margin on a personal share, where the cluster check passes but the user's announced future jobs and spare would not be covered.

**Resources and total effort (required):** 7–13.5 person-days for implementation and validation, plus about 1 day already spent on drafting and the local probe. The validation batch is 15 unhinted and 3 hinted runs, plus development trials. The budgeting assumption is 30,000–100,000 input and 1,000–8,000 output tokens per run, because the history is longer. API cost is TBD until the roster and prices are known. CPU only; no real cluster or GPU is used.

**Scope boundary and open questions (required):** The task queues and holds jobs on a simulated account; it runs no code and contacts no labmate. Open questions:
1. Can a task-scripted event submit a job on the researcher's own account and pass the submission check? Benchline currently describes labmate events only. *(This is a Benchline feature, raised on #180.)*
2. Can a job be submitted directly in the held state? *(This is a Benchline feature, raised on #180. The task also accepts submit-then-hold.)*
3. Can a partition be restricted to one project or grant? *(Needed for `donated`; to be raised on #180. If not, `donated` will be removed from Lin's account, which closes the same loophole.)*
4. Which cross-session history and audit interfaces will be available? *(Tracked in #135.)*

These will be settled with the maintainers before the freeze. Difficulty is empirical: we will report every valid rollout and redesign through review if the thresholds are not met.

**Data provenance and privacy (required):** Invented. The situation is inspired by the author's own experience of sharing a GPU limit between two research projects, but all people, projects, configs, numbers and messages are synthetic. No private messages, account details or third-party data are included.
