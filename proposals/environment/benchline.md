# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Learning & research] Benchline shared lab compute, job queue, results and evaluation protocols`

I checked this proposal against the public runtime on `main` (release 1.6.0, Core API 1.2.0, commit `61b6371`). The project, people, datasets and results are synthetic, and no affiliation is claimed.

## 1. App and domains

- **Authors / GitHub handles (required):** Shubhashis Roy Dipta (@dipta007)
- **Reference app or website / URL (required):** Benchline, an independently branded synthetic lab compute and experiment-results workspace. Workflow references: Slurm's job submission and job states (https://slurm.schedmd.com/sbatch.html, https://slurm.schedmd.com/job_state_codes.html), Slurm's resource limits for a shared account (https://slurm.schedmd.com/resource_limits.html) and MLflow Tracking for runs, parameters and metrics (https://mlflow.org/docs/latest/ml/tracking/). No data, text, branding or icons are reused.
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** Benchline is a resettable lab compute and results workspace, seen from one researcher's account. The lab shares one GPU-hour allocation. A result counts only under the evaluation protocol that the lab signed. So the cluster can accept a job that is still wrong for this person's labmates, deadline or paper, and a task can check whether the agent noticed. The account sees the whole lab's jobs and results. It holds the researcher's own jobs, result notes, protocol proposals and results tables.

Scope of one App instance:

- It holds one researcher account in one project on one cluster. In this text, "the researcher" is the account holder.
- Labmates, the lab head and the cluster are not accounts. What they do arrives as task-supplied events.
- The cluster is not simulated: Benchline runs no code and has no scheduler. What a job does is task data, held in run plans.
- The project has a time zone, partitions (each with a charge rate and a longest job time) and one allocation period with its GPU-hours. A person can have a share of the allocation. The period does not close by itself, and usage does not reset.
- A config is a registered experiment setup that never changes: parameters, dataset version, evaluation split and an opaque code reference.
- A protocol version holds the dataset version, the evaluation split, the metrics, the seeds to run, and who signed it and when. A protocol line is the series of its versions.
- The policy is four values: `hard_shares` (a share is a hard limit), `max_active_jobs` (how many jobs one person may have queued, held or running), `required_signers` (the IDs of the people who must sign a protocol version) and `signoff_window_days` (how long a proposed version waits).

Four workflows are complete in the first version.

1. **W1 Allocation, queue, results and notifications (read only).**
   - The agent reads the project with its policy and people, and the usage summary. The summary shows the allocation period, the allocation, and what is used, reserved, remaining and overdrawn, for the project and for each share.
   - The agent reads configs and lists jobs. `jobs.list` takes a window of submission time, and it can filter by owner, state, config or protocol. It sorts by submission time only. `jobs.get` returns one job with its history and its result.
   - The agent reads results, protocol versions with their sign-offs, tables, notifications and preferences. A frozen table returns its manifest and the same rows as CSV text.
   - `results.compare` takes two or more results and returns `comparable` and every field in which their protocol versions differ.
   - `jobs.estimate` runs the submission check without writing. It returns `allowed`, the GPU-hours the job would reserve, what the project and the share would have left, and the flags the job would carry.
2. **W2 Running jobs.**
   - The agent submits a job for a registered config and seed, on a partition, with a number of GPUs and a time limit. The job can name a protocol version.
   - The agent can hold a queued job, release a held job, and cancel a job that is queued, held or running. A cancelled job leaves no result.
   - A job is not edited: the agent cancels it and submits again.
   - The agent can set the preferences: the time zone of notification text, `email_notices`, and `job_end_notices` (a notification is written when the researcher's job ends).
3. **W3 Evaluation protocols and sign-off.**
   - The agent proposes a new version of a protocol line: a changed dataset version, evaluation split, metric list or seed list, with a rationale.
   - The agent signs or declines a version that a labmate proposed (`protocols.respond`).
   - A proposal is not edited: the agent withdraws it while it is `proposed` and proposes again. A withdrawal changes no other version.
4. **W4 Reporting results.**
   - A result is the metric values of a completed job. With `results.update` the agent tags it, adds a note, excludes it with a reason, or brings it back, and nothing is deleted.
   - The agent creates a results table under one protocol version, sets its named rows while it is a draft, and freezes it.
   - A frozen table is never edited: a correction is a new version, started with `tables.revise`.

The table lists the 23 App errors. A call that returns an error changes nothing. When more than one error fits a call, Benchline returns the one that comes first in this table, read row by row and from left to right.

| Error | Returned when |
| :--- | :--- |
| `not_found` | An ID is unknown, including a config, partition or protocol version that a job names. |
| `not_yours` | The agent calls `jobs.hold`, `jobs.release` or `jobs.cancel` on a labmate's job, `protocols.withdraw` on a labmate's proposal, or `results.update` on a labmate's result. |
| `not_a_signer` | The agent calls `protocols.respond`, and the researcher is not a required signer. |
| `invalid_state` | The object is not in the state that the operation needs: `queued` for `jobs.hold`; `held` for `jobs.release`; `queued`, `held` or `running` for `jobs.cancel`; `proposed` for `protocols.respond` and `protocols.withdraw`; a draft for `tables.update`, `tables.freeze` and `tables.discard`; the latest frozen version of a table with no draft for `tables.revise`. |
| `invalid_window` | A window ends before it starts. |
| `invalid_timezone` | The time zone in `preferences.update` is unknown. |
| `time_limit_too_long`, `protocol_mismatch`, `too_many_active`, `over_allocation`, `over_share` | A step of the submission check fails. The rule below gives each step with its error. |
| `already_proposed` | The protocol line already has a `proposed` version. |
| `no_change` | The new version is identical to the signed version of the line. |
| `already_answered` | The researcher has already answered this version. |
| `not_completed` | `results.update` or a table row names a job that has no result yet. |
| `reason_required` | `results.update` excludes a result without a reason. |
| `mixed_protocols` | A table row cites a result run under another protocol version, or under none. |
| `duplicate_result` | A table cites one result twice. |
| `empty_table`, `protocol_not_signed`, `incomplete_seeds`, `cites_excluded`, `cites_invalidated` | `tables.freeze` fails for one of these reasons, in this order: the table has no rows; its protocol version was never signed; a row does not have exactly one result for each seed of the protocol, all from one config; a cited result is excluded; a cited result is invalidated. |

The table lists each object's states and what moves them.

| Object | States | What moves it |
| :--- | :--- | :--- |
| Job | `queued`, `running`, `completed`, `failed`, `timed_out`, `held`, `cancelled`, `interrupted` | `jobs.submit` makes the researcher's job `queued`. `job.recorded` adds a labmate's job in the state that its recorded times give at the current time. The clock makes a queued job `running` at its start, and `completed`, `failed` or `timed_out` at its end. `jobs.hold` makes a queued job `held`. `allocation.changed` can also hold it, with the reason `allocation`. `jobs.release` makes a held job `queued`. `jobs.cancel` makes a queued, held or running job `cancelled`. `job.interrupted` makes a queued or running job `interrupted`. |
| Result | `candidate`, `excluded` | A result is `candidate` when its job reads `completed`. `results.update` moves it to `excluded`, with a reason, and back. `result.invalidated` marks it as invalidated and keeps its disposition. |
| Protocol version | `proposed`, `signed`, `superseded`, `declined`, `withdrawn`, `expired` | `protocols.propose` or `protocol.proposed` makes it `proposed`. The last required signature (`protocols.respond` or `protocol.answered`) makes it `signed`, and the earlier signed version of the line `superseded`. A decline by a required signer makes it `declined`. `protocols.withdraw` or `protocol.withdrawn` makes it `withdrawn`. The clock makes it `expired` at its `respond_by`. |
| Table version | `draft`, `frozen`, `superseded`, `discarded` | `tables.create` makes a draft. So does `tables.revise`, from the latest frozen version of a table with no draft, and the draft starts with its rows. `tables.freeze` makes the draft `frozen`, and the version that it revises `superseded`. `tables.discard` makes a draft `discarded`, and no frozen version changes. |

Rules:

- **Time.**
  - Benchline has no timers, no scheduler and no clock event. Infra moves `virtual_now` with an event or with Core's `env.advance_time`, which runs no App code.
  - So every time-based state is stored as a due time and computed from `ctx.virtual_now` each time it is read or checked: a job's `running` and end state, `expired`, and the release of a notification.
  - Writes and events use the same computation, and nothing is rewritten when a due time passes. So a job that has ended cannot be cancelled, and an expired version cannot be signed.
  - Every read returns the current virtual time as `now`, with the UTC offset of the project's time zone.
- **Run plans.**
  - A run plan is for a config, and optionally for one seed and one partition. It says how many minutes a job waits and runs, and whether it completes (with which metric values) or fails (with which error text).
  - Run plans are world data. They come from the seed or from `plan.set`, they stay in App state, and no Agent operation returns them.
  - When a job is submitted or released, Benchline copies the most specific matching plan into it. If two plans are equally specific, the one that names the seed wins. It stores the start (that moment plus the wait) and the end (the start plus the run time). If the time limit is shorter than the run time, the end is the start plus the time limit, and the job ends `timed_out`.
  - A job shows its start only once it has started, and its end and result only once it has ended.
  - A job with no matching plan has no start. It stays `queued` until `plan.set` gives it a plan or the job is cancelled.
- **Charging.**
  - A queued or running job reserves `gpus × rate × time_limit_hours`, in GPU-hours. A held job reserves nothing.
  - A running job keeps its full reservation, and nothing counts as used yet. When it ends, is cancelled or is interrupted, its charge moves to used and the rest of the reservation returns. The charge is `gpus × rate × hours run`.
  - `remaining` is the allocation minus what is used and reserved, and never below zero. Anything beyond is `overdrawn_hours`. The same sums are kept for each person against `share_hours`.
  - A partition with rate 0 charges nothing. A labmate's recorded job is counted in the same way, from the time of its event.
- **The submission check.** `jobs.estimate`, `jobs.submit` and `jobs.release` use one check, in this order:
  - the config and the partition exist (`not_found`);
  - the time limit is within the longest job time of the partition (`time_limit_too_long`);
  - a named protocol version covers the job: the config has its dataset version and evaluation split, and the seed is in its seed list (`protocol_mismatch`);
  - the researcher has fewer than `max_active_jobs` jobs queued, held or running, and `jobs.release` does not count the job itself (`too_many_active`);
  - the reservation fits what the project has left (`over_allocation`);
  - where `hard_shares` is on, the reservation fits what the researcher's share has left (`over_share`).

  A write returns the first error. `jobs.estimate` returns `not_found` as an error, and it lists every other step that fails in its result. The check ignores the state of the protocol version, so a job may run under a version that is not signed.
- **Other people's acts.**
  - Labmates, the lab head and the cluster are not held to the limits of that check: the job count, the allocation and the shares. Benchline rejects their events only for the reasons listed in section 3, so a project can be overdrawn.
  - When `allocation.changed` leaves the project overdrawn, the handler holds the researcher's queued jobs one by one, the last submitted first. It stops when the project is no longer overdrawn or no such job is left. Running jobs go on.
  - A later increase releases nothing: a held job stays held until the agent releases it. A lower share holds nothing, and it limits only later submissions and releases.
- **Flags.** Flags are computed when read and never stored.
  - On a job of the researcher: `over_share` (a queued or running job that takes the researcher's used and reserved hours past a soft share, counted in order of submission) and `unfunded` (held with the reason `allocation`).
  - On a job or a result: `protocol_unsigned` (its protocol version is `proposed`, `declined`, `withdrawn` or `expired`) and `protocol_superseded`. A result can also read `invalidated`.
  - On a table: `empty_table`, `incomplete_seeds`, `cites_excluded`, `cites_invalidated`, `protocol_unsigned` and `protocol_superseded`. On a draft, the first five are exactly what would stop a freeze. `protocol_unsigned` stops it with the error `protocol_not_signed`, and the other four have the same name as their error.
- **Results and protocol versions.**
  - A result belongs to the protocol version that its job named at submission, or to none, and this never changes. Results are comparable only when they name the same protocol version.
  - A proposer who is a required signer has signed by proposing. If no other signature is missing, the version is `signed` at once.
  - A version that is still `proposed` at its `respond_by` (its proposal time plus `signoff_window_days`) is `expired`. It counts as `proposed` only before that moment, for every rule and for the validation of the seed and of events. So a line can take a new proposal once the old one has expired.
- **Tables.**
  - A table can be frozen under a `signed` or `superseded` protocol version, because every required signer agreed to both.
  - A frozen table is a manifest. For each row it holds the config, seeds and result IDs. For each metric it holds the count, the mean and the sample standard deviation, rounded to four decimals. It also holds the protocol version, the freeze time and a content hash.
  - A later invalidation, exclusion or new protocol version only adds a flag to a frozen table.
- **Notifications.**
  - Benchline writes notifications for what other people and the cluster do, and the event table in section 3 says which event writes which one. It writes none for the researcher's own writes, and none for a change that time alone causes.
  - The one exception is the end of the researcher's own job (`job.ended`), written only while `job_end_notices` is on. The submission, the release or the `plan.set` that sets the end of the job also writes this notification, with the end as its release time. A cancellation, a hold or an interruption removes it.
  - `job_end_notices` and `email_notices` are read once, when the notification is written. A later change does not touch a pending notification.
  - No notification is listed before its release time.

Illustrative uses, not Task Track submissions:

- The allocation is cut in the middle of the period while three of the researcher's jobs wait for a deadline. The agent must keep the jobs that the lab head asked for first, and it must not move to a cheaper protocol that nobody signed. Task #109 meets this problem and plans three task-owned fixtures for it: a signed protocol ledger, a quota job fixture and an artifact vault with frozen manifests.
- A labmate proposes a protocol version that makes every job cheaper, and the app lets the researcher sign it. But the researcher's own earlier rule, kept outside Benchline, says that the test subjects stay unseen.
- A summary must be updated from new runs without mixing results from two protocol versions. Task #34 meets this problem with a task-owned workspace of run manifests and results.

No Task proposal depends on Benchline, and both tasks can keep their own fixtures.

**Boundaries and overlap.** I checked the proposal list on 2026-11-22. No Environment proposal covers a shared compute allocation, a job queue, experiment results or sign-off on an evaluation protocol.

- #148 (SubmissionDesk) is the nearest. It approves the exact content of a paper's release bundle. Benchline stops one step earlier, at the frozen results table. A task that uses both can put a table's ID and content hash into a SubmissionDesk bundle.
- In the same domain, #4 (Research Library: references and notes), #51 (Language Study Workspace), #67 (University Course Registration), #70 (Milepost: practice and mastery), #160 (Second Draft: writing revision) and #161 (Tutorwell: tutoring) do not run or record experiments.
- #88 (Forkyard) hosts code. Benchline keeps only an opaque `code_ref` string and reads no repository.
- Files 1.0.0 and Notes 1.0.0 (#131, accepted) hold documents and notes. Benchline holds no documents, and a report that cites a table lives in those Apps.
- #33 (Personal Records) manages personal documents.
- A labmate's chat stays in Messages. A proposal, an answer and an exclusion carry only their own short note.

## 3. Potential app connections

- **Internal personal apps (required):** Benchline uses Mail only, and Mail is optional and send-only. All four workflows complete with Benchline alone.
  - When `email_notices` is on, each notification also carries a plain-text message. The message is for the existing receive declaration of Mail 1.3.0 in `examples/apps/mail`: channel `channel.email`, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, receiver operation `mail.receive_notification`. I reviewed it at `main` commit `61b6371` ([wire schema](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b6371/examples/apps/mail/schemas/router-message.schema.json)).
  - Benchline declares the matching `messaging.publishes` entry and builds no inbox.
  - Calendar 1.3.0 has no messaging receiver, and Benchline never reads or writes it. Messages 1.0.0 has a `channel.chat` receiver, but Benchline sends no chat messages.
  - Benchline does not use Contacts, Files, Notes or Tasks 1.0.0 (the shared packages at `61b6371`).
- **Other apps and websites (required):** None: no external website, cluster, scheduler or experiment-tracking service is called at run time.
  - A task that also uses Messages, Files or Notes seeds consistent data in each. There is no App-to-App channel.

### Integration details

- **Operations and access (required):** Benchline has 29 Agent-facing MCP operations over stdio, on the Agent connection of the public host (`node runtime/cli.cjs serve --app apps/benchline --role agent`). They are registered in `tools.json` as `benchline.<name>`.
  - Read (15): `project.get`, `usage.summary`, `configs.list`, `configs.get`, `jobs.list`, `jobs.get`, `jobs.estimate`, `results.list`, `results.compare`, `protocols.list`, `protocols.get`, `tables.list`, `tables.get`, `notifications.list`, `preferences.get`.
  - Write (14): `jobs.submit`, `jobs.hold`, `jobs.release`, `jobs.cancel`, `results.update`, `protocols.propose`, `protocols.respond`, `protocols.withdraw`, `tables.create`, `tables.update`, `tables.freeze`, `tables.revise`, `tables.discard`, `preferences.update`.
  - Every write takes Core's `request_id` and `expected_version`, and it returns the object's `id` with the committed version. Every read returns `now`.
  - The target object is always the argument `id`, and a time window is always `start` and `end`. The reference host's audit projection at `61b6371` keeps these three inputs. So its rows show the object and the window of these calls, reads included.
  - Where an operation creates an object, `id` is the object it is about: the config for `jobs.submit` and `jobs.estimate`, the protocol line for `protocols.propose`, the protocol version for `tables.create`, and the frozen version for `tables.revise`.
  - `results.compare` takes a list, `ids`, which the projection does not keep. Its objects are read from the Agent execution trace.
  - The Agent acts as the bound account holder set by Infra, never through an argument. A task can restrict the allowed tools with `policies.json`.
  - The 23 App errors are listed in section 2. Core adds `invalid_arguments`, `permission_denied`, `stale_version` and `idempotency_conflict`. The input schemas set `minItems`, so Core returns `invalid_arguments` for an empty seed list, a row with no results, or a comparison of fewer than two results. Core checks the input schema before the App runs, so `invalid_arguments` comes before the App errors of section 2.
  - Infra-only operations: `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and the host's clock operation `env.advance_time`. They are not listed on the Agent connection, and Core returns `permission_denied` if the Agent calls them.
  - The first version has no GUI, no reviewer console and no console for the lab head.
- **State and lifecycle (required):** State is separate per run and App instance, and one instance holds one account (`isolation_keys: run_id, app_id`).
  - A task loads its own seed and starting time with `env.load_seed`. The seed has project records: the allocation period, partitions, policy, people and shares, the history of allocation changes, configs, protocol versions with their sign-offs, the lab's jobs with their history, and run plans. It has account records: preferences, result tags, notes and dispositions, table versions, notifications and activity rows.
  - So a task can start from any history. The seed is history: facts from other people arrive only through events.
  - `validateSeed` rejects a seed with `invalid_seed` for any of these:
    - duplicate IDs, a reference to an object that does not exist, a timestamp without a UTC offset, or an account that the binding does not declare;
    - a job that ends before it starts or runs longer than its time limit, or a job whose seed or config its protocol version does not cover;
    - an empty `required_signers` list, or two versions on one line that are both proposed and not yet expired;
    - two draft versions of one table, or a frozen table whose manifest does not match the results it cites.
  - Writes follow Core: an exact repeat of a committed `request_id` or `event_id` returns the stored receipt marked `duplicate`, so a repeated request submits no second job. The same ID with different input returns `idempotency_conflict`. A stale `expected_version` returns `stale_version`. Core appends a denial audit row for a failed call.
  - A read never changes business data.
  - Reset is Core's: it restores the loaded seed and the time loaded with it, for this App instance only (`reset_scope: app_instance`). Messages already delivered to Mail stay there.
  - Evaluator records come from three places, and they join on `request_id`, `event_id` and version.
    - App state in `env.snapshot` has activity rows with sequence, virtual time, actor `agent` or `event`, action, object ID and the `request_id` or `event_id` behind them. There is one row for every committed Agent write, every applied event and each effect of a write or an event. The snapshot also has the history of each job, protocol version, table version and notification.
    - Core audit rows carry virtual time and the projected `id`, `start` and `end`. There is one row for every allowed business call that is not a replay, every denied call, and every `env.advance_time` that is not a replay.
    - The supplied Agent execution trace has the full arguments and results.
  - Counting rules:
    - A replay appears only in the trace, with `duplicate: true`, and it counts as a retry of the original.
    - A rejected attempt writes no activity row, so it is counted from the denial rows and the trace.
    - A time-driven change writes no row, so it is read from the stored due times and the clock.
    - Take the snapshot before a reset, because reset clears the audit.
- **Events and notifications (required):** Benchline has nine events. They arrive through `env.apply_event`, in Core's envelope. An event is handled at its own time, which is `ctx.virtual_now` inside the handler.
  - Core rejects an event dated before the App's current time, and it validates the data after every event with the seed rules.
  - Benchline also rejects the events below, with `invalid_event` and state unchanged:
    - a duplicate job, config or protocol ID;
    - an unknown person, partition, config or protocol version;
    - an event that names the account holder as owner, proposer or signer, or that withdraws the account holder's version;
    - a recorded job that ends before it starts, runs longer than its time limit, or names a protocol version that does not cover its config and seed;
    - an interruption of a job that is not queued or running at the event's time, so an interruption that arrives after a job ended is rejected;
    - a second proposed version on one line;
    - an answer from a person who is not a required signer or has already answered;
    - an answer or a withdrawal for a version that is not `proposed` at the event's time, so an answer that arrives after `respond_by` is rejected;
    - an invalidation of a job that has no result.

  | Event | Example (`at` carries the UTC offset) | Effect |
  | :--- | :--- | :--- |
  | `benchline.allocation.changed` | `{"event_id":"ev-bl-201","at":"2026-12-03T09:15:00-05:00","operation":"benchline.allocation.changed","payload":{"allocation_hours":120,"shares":[{"person_id":"person-nadia","share_hours":45}],"changed_by":"person-okafor","reason":"The department moved hours to the shared pool."}}` | The allocation, the named shares, or both are replaced, with a history row. The researcher's queued jobs that no longer fit are held (section 2), each with a history row. One `allocation.changed` notification is written if the allocation or the researcher's share changed. |
  | `benchline.job.recorded` | `{"event_id":"ev-bl-210","at":"2026-12-02T08:00:00-05:00","operation":"benchline.job.recorded","payload":{"job_id":"job-0131","owner_person_id":"person-mei","config_id":"cfg-vit-s16-v2","seed":0,"partition_id":"gpu-h","gpus":4,"time_limit_hours":12,"starts_at":"2026-12-02T08:20:00-05:00","ends_at":"2026-12-02T19:05:00-05:00","end_kind":"completed","protocol_id":"proto-subj-v2","metrics":{"accuracy":0.698}}}` | A labmate's job is added as a fact, with its own times and outcome, and with the time of the event as its submission time. No notification is written. |
  | `benchline.job.interrupted` | `{"event_id":"ev-bl-215","at":"2026-12-04T02:40:00-05:00","operation":"benchline.job.interrupted","payload":{"job_id":"job-0140","reason":"Node gpu-h-07 failed."}}` | The queued or running job becomes `interrupted` and leaves no result. If it is the researcher's job, one `job.interrupted` notification is written. |
  | `benchline.plan.set` | `{"event_id":"ev-bl-220","at":"2026-12-03T09:20:00-05:00","operation":"benchline.plan.set","payload":{"config_id":"cfg-mae-b16-v3","seed":1,"queue_wait_minutes":240,"run_minutes":600,"outcome":"completed","metrics":{"accuracy":0.709}}}` | The run plan for that config (and seed or partition, where named) is added or replaced, for jobs submitted or released from the event's time on. A queued job of the researcher that had no plan gets its start (the event's time plus the wait), its end and its `job.ended` notification. No other notification is written. |
  | `benchline.config.registered` | `{"event_id":"ev-bl-225","at":"2026-12-02T16:00:00-05:00","operation":"benchline.config.registered","payload":{"config_id":"cfg-mae-b16-v4","family":"mae-b16","version":4,"params":{"lr":0.0003,"epochs":80},"dataset_version":"eeg-subjects-2026.2","eval_split":"test-subjects","code_ref":"a41c9e2","registered_by":"person-nadia"}}` | A new config is added, and later jobs can name it. No notification is written. |
  | `benchline.protocol.proposed` | `{"event_id":"ev-bl-230","at":"2026-12-03T11:00:00-05:00","operation":"benchline.protocol.proposed","payload":{"protocol_id":"proto-subj-v3","line":"subject-eval","dataset_version":"eeg-subjects-2026.2","eval_split":"test-trials","metrics":[{"name":"accuracy","direction":"higher"}],"seeds":[0,1,2],"proposed_by":"person-tomas","rationale":"A trial-level split needs a third of the compute."}}` | A labmate's version is added with its `respond_by`, under the proposal rules of section 2. One `protocol.proposed` notification is written if the researcher is a required signer. |
  | `benchline.protocol.answered` | `{"event_id":"ev-bl-231","at":"2026-12-04T10:00:00-05:00","operation":"benchline.protocol.answered","payload":{"protocol_id":"proto-subj-v4","person_id":"person-okafor","answer":"sign","note":"Fine with five seeds."}}` | A required signer signs or declines, and a sign-off row is added. One `protocol.updated` notification is written if the researcher proposed the version or is a required signer. |
  | `benchline.protocol.withdrawn` | `{"event_id":"ev-bl-232","at":"2026-12-04T12:00:00-05:00","operation":"benchline.protocol.withdrawn","payload":{"protocol_id":"proto-subj-v5","note":"Withdrawn after the lab meeting."}}` | A labmate withdraws their own `proposed` version. One `protocol.updated` notification is written if the researcher is a required signer. |
  | `benchline.result.invalidated` | `{"event_id":"ev-bl-240","at":"2026-12-06T14:30:00-05:00","operation":"benchline.result.invalidated","payload":{"job_id":"job-0102","invalidated_by":"person-mei","reason":"Seed 1 read a cached split from the old dataset version."}}` | The result is marked invalidated, with who, when and why, and no table changes. One `result.invalidated` notification is written if the result is the researcher's, or if a table of the researcher's cites it. |

  - Benchline has six notification types, each written once per occurrence: `allocation.changed`, `job.ended`, `job.interrupted`, `protocol.proposed`, `protocol.updated`, `result.invalidated`.
  - Benchline publishes `channel.email` only, and it receives no messages.
  - The App writes the notification. When `email_notices` is on at that moment, it stores the full wire message with it, dated at its release time. Mail does not store this time; its `received_at` is Mail's own clock at delivery.
  - An Infra-run sender in the package sends the messages. It is an outbound adapter that Infra runs with its own Infra and publisher connections, and Infra runs one sender for the whole run. It reads notifications through `env.snapshot` and calls `router.publish`, the call that Mail's `src/publisher.cjs` uses. A delivery needs a Mail account bound in the run and an Infra grant for `channel.email`. Without them, the router rejects it before dispatch.
  - Infra chooses when to run the sender, and it waits for each result before it moves the clock.
  - The sender publishes each notification that has a stored wire message, once, and only when the snapshot's `virtual_now` has reached its release time. It publishes the stored text. It never sends a notification that was in the loaded seed: it notes the seed's notification IDs when it starts.
  - A notification can be removed only before its release time, because only a job that has not ended can be cancelled, held or interrupted. So the sender never sends a removed notification.
  - The message `id` and the `request_id` are the notification ID. So publishing the same notification again is an identical retry: the router returns the first receipt, marked `duplicate`, and Mail keeps one inbox record.
  - The sender does not write back into Benchline, so no cross-App transaction is assumed. A delivery rejected before dispatch creates no Mail record. If the receiver rejects the message, or its answer is unknown, the router halts the run for inspection. None of these rolls back Benchline.
  - The message below is an example notification as a full wire message. I validated it against Mail's `urn:pale:email-message:2` schema at `61b6371` with `runtime/contracts/schema-validator.cjs`: it passes, and two broken variants fail. This is a schema check, not a completed integration test. `{"specversion":"1.0","id":"ntf-0042","source":"urn:pale:app:benchline:account:benchline-nadia","type":"org.pale.mail.notification.v1","time":"2026-12-03T09:15:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-nadia"},"source_object":{"app_id":"benchline","account_id":"benchline-nadia","object_type":"allocation","object_id":"alloc-2026-12"},"content":{"title":"Your lab's December allocation is now 120 GPU-hours","body":{"format":"text/plain","text":"Prof. Okafor's project allocation for 1 to 31 December changed from 400 to 120 GPU-hours. Reason given: the department moved hours to the shared pool. Two of your queued jobs no longer fit and are on hold. Open Benchline to see your jobs and what is left."},"asset_ids":[]},"subscription_ref":"benchline-nadia:allocation-changes","extensions":[]}}`
- **Shared data and dependencies (required):** Partitions, people, configs, protocol versions, jobs, table versions and notifications have stable IDs, and a result has the ID of its job. Benchline is the source of truth for its own records and keeps no copy of another App's records.
  - The account's `account_id` and `owner_person_id` are the shared values of the run's `binding.json`. So the person has one ID in Benchline and Mail, and notifications address the recipient by `person_ref`.
  - Labmates and the lab head are named by `person_id`. Benchline stores only a display name, a role label and a share for each.
  - Missing data is explicit. A job that has not started has `starts_at: null`. A job that has not ended has `ends_at: null` and no result. A person without a share has `share_hours: null`, and only the project's allocation applies. A job submitted under no protocol has `protocol_id: null`, and its result cannot enter a table.
  - All records are JSON. There are no images, audio, video or attachments (`capabilities.resources: false`, 0 of the profile's 64 assets).
  - Benchline needs the public Core/Messaging runtime 1.6.0 (Core API 1.2.0) at `main` commit `61b6371`, and `dependencies.required_apps` is empty.
  - The package runs on its own: a copy that holds only `apps/benchline/` and the pinned runtime starts the App, and it imports nothing outside its own folder.
  - Dates use IANA time zones through Node's built-in `Intl`, so no package is installed.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `apps/benchline/` per the App contribution guide: 29 operations, the states and rules of section 2, and the activity log. It reuses the reference package layout, the generated shared schemas, the launcher and the reference test-harness pattern. | Every transition and rule in section 2 works, and a failed call or event leaves state unchanged. | 4 to 5 |
| Data and image collection | Not applicable: nothing is crawled or copied, and the public workflow references are recorded. | Provenance is recorded in `contribution/dataset.json`. | 0.25 |
| Synthetic data and assets | The fixtures are authored JSON, with no generator at run time: 1 fictional project with 3 partitions (two GPU rates and one free CPU partition), one allocation period and 2 earlier allocation changes; 6 people (the account holder, the lab head and 4 labmates) with shares; 12 configs in 4 families; 3 protocol lines with 7 versions that cover every state; 60 jobs (24 the account holder's) that cover every state and end kind; 34 results (3 excluded, 2 invalidated); 4 table versions, one in each state; 30 run plans; 14 notifications. | The seed passes validation. A consistency script checks that job times, reservations and charges agree, that usage sums match the summary, that protocol states fit their sign-offs, that frozen manifests match their results, and that only the intended flags are present. The fixtures contain no real people, labs, datasets, models or results. | 1 to 1.5 |
| App integrations | The optional Mail notifications need the wire-message builder, the `messaging.publishes` declaration and the Infra-run sender script. | Example messages pass Mail's wire schema. A released notification appears as a received message in the bound Mail account with a committed receipt, and a `job.ended` notification appears only after the clock has passed the end of the job. Without a grant the delivery is rejected and Mail has no record. | 0.5 to 0.75 |
| Validation and reset | The validation has five parts: the local business tests T01 to T21; the public verifier (`npm run app:verify -- --app apps/benchline`); a package real-MCP script for the clock, replay and reset checks that the verifier does not exercise; one Benchline to Mail flow; and the repository `npm test`, which must stay green. | After implementation, the PR gives the exact App, runtime and Mail versions, the commands, reproducible reports and a workflow-to-test mapping. It also lists the remaining manual review: the realism of the allocation, partition and policy values, and the notification wording. | 2 to 2.5 |

**Acceptance plan.** Each row gives a main path (initial state → action or event → expected result) and controls. A control that returns an error must leave state unchanged. These are planned tests, not implementation results.

| Workflow | Main path | Control | Tests |
| :--- | :--- | :--- | :--- |
| W1 Allocation, queue, results and notifications | With a December allocation of 400 GPU-hours, 212 used and 60 reserved, `usage.summary` reads 128 remaining. The researcher has 36 used and 60 reserved, so 54 are left of the share of 150.<br>`jobs.estimate` for 2 GPUs and 12 hours on `gpu-h` (rate 2.0) returns `allowed: true`, 48 GPU-hours reserved, 80 left for the project and 6 for the share.<br>The same job for 24 hours reserves 96 and, with soft shares, returns `allowed: true` with the flag `over_share`.<br>`results.compare` on one result under `proto-subj-v2` and one under `proto-subj-v1` returns `comparable: false` and names `eval_split`. | 4 GPUs for 24 hours on `gpu-h` reserves 192 → `allowed: false` with `over_allocation`.<br>The business data in `env.snapshot` is byte-identical after every read.<br>No read returns a wait, a run time or an outcome that is not yet due. | T01 to T05: reads |
| W2 Running jobs | `jobs.submit` at 09:00 for `cfg-mae-b16-v3`, seed 2, 2 GPUs and 12 hours on `gpu-h` under `proto-subj-v2` → `queued`, 48 reserved.<br>Its run plan waits 30 minutes and runs 600. After `env.advance_time` to 09:30 it reads `running`. At 19:30 it reads `completed` with its result, 40 charged and 8 returned.<br>`allocation.changed` to 120 while 212 are used and the researcher's two queued jobs reserve 60 → both read `held` with the reason `allocation`, and the summary reads 0 remaining and 92 overdrawn.<br>`jobs.release` on one of them → `over_allocation`. | A 30-hour limit on `gpu-h`, whose longest is 24 → `time_limit_too_long`.<br>Seed 7 under a protocol whose seeds are 0, 1 and 2 → `protocol_mismatch`.<br>A fourth job when `max_active_jobs` is 3 → `too_many_active`.<br>A 2-GPU job on `gpu-h` whose plan runs 15 hours under a 12-hour limit reads `timed_out` at 12 hours, with 48 charged and no result. | T06 to T10: jobs, the clock and world events |
| W3 Evaluation protocols and sign-off | A labmate's `proto-subj-v3` arrives (`protocol.proposed`) with a trial-level split → `proposed`, and the researcher is asked to sign.<br>`protocols.respond` with `decline` → `declined`, and `proto-subj-v2` is still `signed`.<br>With `signoff_window_days` at 5, `protocols.propose` on the same line with seeds 0 to 4 → `proto-subj-v4`, `proposed`, with the researcher's signature recorded and `respond_by` five days later.<br>`protocol.answered` with `sign` from the lab head → `signed`, and `proto-subj-v2` reads `superseded`. | A proposal identical to the signed version → `no_change`.<br>A version still `proposed` at its `respond_by` reads `expired` after `env.advance_time`, with no App event, and a later answer is rejected (`invalid_event`). | T11 to T13: protocols and sign-off |
| W4 Reporting results | `tables.create` "Main results" under `proto-subj-v2` → draft version 1.<br>`tables.update` with two rows of three results each (seeds 0, 1 and 2).<br>`tables.freeze` → `frozen`. The manifest row for accuracy values 0.712, 0.705 and 0.719 reads count 3, mean 0.7120 and standard deviation 0.0070.<br>`result.invalidated` on one cited result → the frozen table is unchanged and reads the flag `cites_invalidated`.<br>`tables.revise` → draft version 2. `tables.update` puts the result of a rerun of that seed in place of the invalidated one. `tables.freeze` → version 2 `frozen` and version 1 `superseded`. | A row that cites a result under `proto-subj-v1` → `mixed_protocols`.<br>A freeze with only seeds 0 and 1 in a row → `incomplete_seeds`. | T14 to T17: results and tables |
| All: events, the clock and Core contracts | After `env.advance_time` and no App event, a job reads `running` or ended. A notification whose release time has passed appears in `notifications.list`, and the sender publishes it once. Business data is unchanged.<br>Reset restores the loaded seed and time. | Each invalid event listed in section 3 → `invalid_event`.<br>A repeated `request_id` returns the stored receipt and submits no second job.<br>Changed input → `idempotency_conflict`, and a stale version → `stale_version`.<br>The Agent calling `env.apply_event`, `env.reset` or `env.advance_time` → `permission_denied`. | T18 and T19: invalid events and notifications. T20 and T21: the clock with the sender, Core contracts, seed validation and reset |

Every App error of section 2 has at least one test in T01 to T21.

- **Milestones, owners and dependencies (required):** The author owns every milestone, and nothing blocks the first version.
  - M0: design review in this PR.
  - M1 (days 1 to 4 after plan approval): package skeleton, schemas, seed validation and W1, with T01 to T05.
  - M2 (days 5 to 9): W2, W3 and W4, the nine events, notifications and the activity log, with T06 to T19.
  - M3 (days 10 to 12): fixtures, the consistency script, the sender and the Mail flow, the public verifier and the real-MCP script, with T20 and T21.
  - M4 (days 13 to 14): README, workflow-to-test mapping and evidence, then `/submit-implementation` inside the 14-day first-version deadline.
  - Related: [#109](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/109), [#34](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/34), [#148](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/148), [#4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4), [#88](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/88), [#131](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/131).
- **Resources and total effort (required):** The total is 7.75 to 10 person-days. The work needs Node.js 18+ and nothing else: no GPU, no paid data, no model or API cost and no external service.
- **Scope boundary and open questions (required):** The first version is MCP-only and follows the platform clock.
  - Not in the first version: files, logs, checkpoints, artifacts and resuming a stopped job; interactive sessions; job arrays, job dependencies and sweeps; priorities, fair-share scores and an inventory of nodes; plots and comments on results; comparing results across protocol versions with any correction; several projects or several accounts in one instance; the lab head's side of the app; push, SMS and chat channels; a GUI or CUA interface.
  - Open question 1: should the Agent be able to register a config? The plan: no, because Benchline cannot give an outcome to a config that no task planned.
  - Open question 2: should a held job keep its reservation? The plan: no, so that holding a job gives the hours back to the lab.
  - Open question 3: should a frozen table that cites an invalidated result change state by itself? The plan: no, because it reads a flag, and the correction is a new version.
  - Open question 4: should a share be a hard limit by default? The plan: it is a policy value per project, and it is soft in the fixtures.
- **License and external dependencies (required):** The code is under the repository's MIT License, and the synthetic fixtures are offered under the same terms. Nothing is hosted, and everything is redistributed in the package. The references are public pages, used only for the shape of the workflows. No documentation text, logos, icons or brand names are copied.
