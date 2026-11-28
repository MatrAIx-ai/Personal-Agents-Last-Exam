# Research results provenance

Local reference implementation for [the approved scope in PR #34](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/34#issuecomment-7089539779). It updates a synthetic internal meeting summary from dated user history and run records. The same request and records produce different primary comparisons when the standing sample-size preference changes.

## Reproduce the local checks

Run from this directory with Node.js 18 or newer. The scenario, grader and replay have no third-party dependencies.

```sh
node --test runner.test.cjs grader.test.cjs
node replay.cjs > local-replays.json
node files-smoke.cjs /path/to/pinned/Personal-Agents-Last-Exam
```

The last command uses a local checkout or source archive of [upstream commit `a4bce02`](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/tree/a4bce023953061483c41de5a287ba5e43f4a5648), with public Core runtime 1.6.0 and Files App 1.0.0. It starts separate local Infra and Agent MCP connections, applies the synthetic fixtures, and inspects the resulting snapshots and audit records. The checked-in [local evidence](evidence/README.md) identifies what each run establishes.

## Scenario and grading

- `scenario.cjs` defines the six original synthetic runs, the old report, the supersession note, the dated user history, three session requests, and scheduled events. The counterfactual changes only the historical preference from `n=600` to `n=1000`.
- `runner.cjs` owns the simulated clock and the user dialogue, applies due events before exposing each session, and returns the fixed hint after the final user request in hinted mode. Each new run starts from the same fixture. An actor can use only the local adapter's allowed actions. The adapter logs denied attempts to edit protected records, launch a simulation, or share externally. It does not provide a shell, network, or real simulation service.
- `replay.cjs` runs authored reference paths and exports the resulting artifacts, timestamps, audit observations, cited rubric findings and scores. It exercises separate and combined report layouts, the paired history control, hint timing, denied actions and the no-op.
- `grader.cjs` scores F1 and F2 from trusted snapshots and action records, then applies the approved E1–E6 weights and gates to independent semantic findings. It verifies that each positive finding cites a literal excerpt in a current output document. Each finding has the shape `{met, rationale, evidence: [{document, quote}]}` and the checklist is exported as `FINDINGS_CHECKLIST`. A changed report without those findings gets a `review-required` assessment rather than a semantic score. An evaluator must apply the checklist to the whole output and compare it with the records. The findings and grader must be outside the evaluated agent's context.

## PALE integration status

The public Files and Core contracts support seeded records, timed events, snapshots, reset, agent read/write tools and per-app audit. The included smoke test exercises these real contracts. The separate task-local replay adapter owns the synthetic conversation, hint, action allowlist and full-task trace. The public runtime exposes per-app tools. The production integration still needs the agreed Task runner contract for cross-session user history, hint injection and a trusted audit boundary for rejected actions and paths outside the Files tools. The local action allowlist is a controlled replay interface and provides no host-level isolation for arbitrary processes.

The published [Task validation rules](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation) require designated GPT, Claude and Gemini model versions and fresh-state validation. The approved plan budgets five unhinted and one separate fixed-hint rollout per model. Once maintainers confirm the Task runner, action audit, dated model roster and model access, wire the task and rubric into those interfaces, agree equivalent private fixtures, run the full frozen batch, and link the resulting traces and scores. The public examples and scripted outputs in this directory are useful for replay and review and are not private official evaluation inputs.
