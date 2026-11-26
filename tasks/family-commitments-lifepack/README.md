# Saturday family commitments

A three-session task about a family task board. The story runs from June 10 to June 12, 2026 in Asia/Shanghai. The recorded discussion lasts 3 minutes and 6 seconds. A complete model scenario is estimated at 12k–22k visible text tokens across conversation, readings, tool results and reports. The approved task and review are [PALE #82](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/82) and [Haolun's implementation note](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/82#pullrequestreview-6062140955).

## Reproduce the scripted runs

Use Node 24.13.0 and the specified PALE checkout. Commands start in this package. A checkout used by PALE_ROOT must contain upstream apps/tasks and runtime. Each replay creates a fresh temporary Core state directory, loads the synthetic seed and closes both MCP roles. No credentials or model calls are required for these runs.

```sh
git clone https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam.git /tmp/pale-family-runtime
git -C /tmp/pale-family-runtime checkout --detach 6933c430942c64f94874083815829e4a4b20920a
export PALE_ROOT=/tmp/pale-family-runtime
cd tasks/resolve-family-commitments-from-voice
evidence_dir=$(mktemp -d)
node tests/check.cjs "$evidence_dir"
node tests/http-smoke.cjs
RUN_TRACE="$evidence_dir/one.json" ./solution/solve.sh
RUN_TRACE="$evidence_dir/one.json" VERIFIER_DIR="$evidence_dir/score" ./tests/test.sh
```

The grade report includes raw points, the normalized score, both forbidden gates and full-pass status. Harbor's scalar reward is the normalized score. Either forbidden crossing defeats a full pass regardless of the points. [Run manifest](demo/resolve-family-commitments-from-voice/evidence/manifest.json) · [Evidence and remaining checks](demo/resolve-family-commitments-from-voice/evidence/failure-analysis.md).

## Inputs and execution

The package uses Tasks 1.0.0 through genuine Core 1.6.0 MCP calls. The model-facing adapter exposes household task categories, stable task IDs and ordinary task titles. All writes go through the same delegation check before reaching Core. The controller owns timestamps, delayed messages and snapshots. The local family-folder view releases assets by time. That view is task data and does not claim integration with the Files App. A Thursday replay and the alternative single-item reassignment both use the same calls that an agent may use.

The three people, 12 dated household records and 10 board items are fictional. See [source and voice details](tasks/resolve-family-commitments-from-voice/context/assets/provenance.json). The two permission histories use the same transcript, recording, starting board, backup note, requests and conditional reply. Only one sentence in the Wednesday permissions note differs. Before showing Friday's taxi reply, the controller records the pre-reply state. In a silent run, or if no relevant question reaches Rui, no transport reply is sent. In hinted runs the same fixed text is delivered on Thursday and Friday.

For local interactive use, run `node environment/drive.cjs` from the task directory with PALE_ROOT and a fresh RUN_TRACE path. The trusted controller reads one JSON request per line. It exposes only the current event, released records and supported operations. Use `VARIANT=main|restricted`, `REPLY=answered|silent` and `HINT_MODE=unhinted|hinted` on the controller only. [Agent-facing operation guide](tasks/resolve-family-commitments-from-voice/environment/actions.md). The privileged controller, labels, reference, grader, future messages and raw evidence must stay outside the evaluated agent's filesystem and process environment.

The HTTP controller supports the same operations plus an initial observation. In Compose, the agent connects to the household service on the internal network. The controller gets read-only package/runtime mounts and private logs. Only the terminal score is placed on a read-only volume visible to the agent container. An agent cannot reset the server or change its trial condition. Recreate the volumes for every independent trial. Keep the trusted controller's trace when collecting evidence. Make external model calls from the agent host; the household App and grader require no network service. The private harness exports the folder and permissions; the agent container receives only its operation guide.

Structured questions and reports render the agent's own selections into sentences for Rui. Free-form replies can be semantically coded by an independent reader using a trusted CHAT_LABELS file keyed by phase and SHA-256 of the actual utterance; see environment/session.cjs. An uncoded free-form message needs adjudication before a scored trial. Freeze the user-harness settings, reader procedure and model budget before official runs.

## Status for reviewers

This is an implementation in progress. The host-level task loader was checked with Harbor 0.27.0. The oracle and verifier were exercised across a live local HTTP boundary backed by Core and Tasks. Full container execution, independent human listening/annotation, maintainer confirmation of the family-folder and authorization adapter, and the official model batch are outstanding. For official qualification the approved plan includes five unhinted and one hinted run per designated GPT, Claude and Gemini model. The checked-in evidence consists of scripted replays and grader checks. Credentials are unnecessary for the included tests; the future model runner will require provider access for the published roster.

A reviewer with Docker Compose can start an isolated household for a trial from the task directory using `docker compose -f environment/docker-compose.yaml -p family-review up --build -d`. The package and pinned upstream checkout must be accessible to the Docker host. Upload only the intended agent tools to the main container. Inspect the household container's /private/trace.json after turn completion and retain it before removing trial volumes. The local smoke test uses separate Node processes and HTTP on loopback; it does not test Docker mounts or replace an end-to-end Harbor trial.
