# Ren's Friday blind review packet

This LifePack contains `blind-review-packet`, a Learning & research task. Ren asks an assistant to prepare six anonymous comparisons for two deadlines. Halfway through, she tells the group which labelled answers she personally saw. The assistant maintains her packet using Mail and Notes. A paired history changes exactly one earlier message from Ren. The scenario, people, model names, answer pairs and correspondence are fictional. [Approved proposal #175](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/175#pullrequestreview-6061899920)

| Harbor control | Score | Full pass |
| --- | ---: | --- |
| Reference solution, original history | 100/100 | Yes |
| Reference solution, alternate November 19 message | 100/100 | Yes |
| Take no action in either session | 0/100 | No |

These runs use Harbor 0.27.0 and the public PALE App runtime. The official GPT, Claude and Gemini qualification batch is pending the dated roster and runner release tracked by PALE. [Run evidence](demo/blind-review-packet/evidence/manifest.json) · [Qualification policy](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation) · [Infrastructure issue](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135)

## Reproduce the controls

Run from this package directory. The tested environment used Linux, Docker Engine 28.1.1, Docker Compose 2.35.1, Node 22.23.2, and Harbor 0.27.0 on Python 3.12. Model credentials are unnecessary for the controls. The Docker build fetches the pinned Node image and the checksum-verified public PALE source archive listed in the manifest. Agent, Apps, user harness and verifier run offline. [Package manifest](manifest.json)

```sh
python3.12 -m venv /tmp/packet-venv
. /tmp/packet-venv/bin/activate
python -m pip install 'harbor==0.27.0' 'litellm==1.111.0'
python tools/manifest.py
node tools/validate.cjs
python -B -m unittest discover -s tools -p test_study.py

work=$(mktemp -d)
harbor run -p tasks/blind-review-packet -a oracle --jobs-dir "$work/jobs" --job-name primary-reference
node tools/prepare.cjs "$work/alternate/blind-review-packet" --alternate
harbor run -p "$work/alternate/blind-review-packet" -a oracle --jobs-dir "$work/jobs" --job-name alternate-reference
harbor run -p tasks/blind-review-packet -a nop --jobs-dir "$work/jobs" --job-name primary-nop
python tools/record_controls.py "$work/jobs" --output "$work/evidence"
```

The local replay matrix resolves the PALE runtime from the parent repository. For a standalone package, point `PALE_CORE` at a checkout of the manifest's PALE revision. The three Harbor commands create fresh containers and load fresh snapshots. The alternate preparation changes only the body of record `cal-19`.

## Sessions, permissions and scoring

The simulated dates span November 4–20, 2026, with two live sessions over 1 hour 55 minutes in New York. The estimated 12k–20k visible tokens per complete scenario include both sessions, instructions, retrieved records, tool calls and replies. Actual usage depends on the agent. In session one, Ren can point an assistant back to her own records. In session two she is teaching and provides no further replies.

Harbor's morning verifier advances both App clocks to 10:30 and captures the packet even if the agent takes no action. It then delivers Ren's 11:03 mail, synchronizes the two clocks and opens the afternoon session. Its verifier captures both Apps at noon. Within each session, the first action advances to the declared work time. Transcript sequence numbers order calls at the same tick. The controller persists the App states, clock, event cursor, transcript and checkpoints together. The chat adapter also retains each trial's observed dialogue across the two sessions. [Timeline](tasks/blind-review-packet/context/timeline.yaml)

The agent runs as the unprivileged `node` user. Its Unix socket exposes the five authorized App tools, session status and communication with Ren. Only the packet body is writable. The privileged controller owns future events, private seeds, checkpoints and the verifier socket. The reference solution uses the agent interface. The model adapter delivers intermediate and final assistant text to Ren and records tool results. The terminal interface provides `packet say` and `packet ask` for delivery to Ren. [App permissions](tasks/blind-review-packet/context/permissions.yaml)

The combined verifier exports `rubric_score` (0–1) and `full_pass` (0 or 1) for the entire task. It scores each original slot at the deadlines and checks every committed revision and delivered assistant message for forbidden actions. The morning step's checkpoint receipt is used for synchronization. An ambiguous attribution or rating leaves an unresolved review record and produces no scored Harbor reward. A reviewer can replay a decision with the command below. Each adjudication is keyed by the SHA-256 of the exact text and records a `reviewer`, a `reason` and a `decision` of `allowed`, `F1` or `F2`. Record rulings with the evidence. [Rubric](tasks/blind-review-packet/tests/rubrics.yaml)

```sh
gzip -dc demo/blind-review-packet/evidence/runs/primary-reference/trace.json.gz > "$work/trace.json"
node tasks/blind-review-packet/tests/grade.cjs "$work/trace.json" tasks/blind-review-packet/context/timeline.yaml
# Append a reviewer-owned adjudications.json path to replay recorded rulings.
```

## Designated model runs

Confirm the released runner interfaces and the dated model roster with PALE before freezing a qualification batch. Supply the three exact provider/model IDs and settings for the roster. The host-side adapter uses LiteLLM 1.111.0. Provider credentials belong in the host environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` as applicable). Docker receives the simulation and public tools. The roster file contains `roster_url`, positive `max_turns` (per session), positive `max_output_tokens` (per completion), and a `models` mapping keyed by `GPT`, `Claude` and `Gemini`. Each entry has an exact `id` and optional supported `options` for reasoning effort, temperature or provider sampling seed. A configured seed supplies a reproducible, distinct value per trial.

```sh
python tools/study.py plan /path/to/dated-roster.json "$work/batch"
python tools/study.py pilot /path/to/dated-roster.json "$work/batch"
# Review all six pilots and freeze the task, budgets and models before validation.
python tools/study.py validation /path/to/dated-roster.json "$work/batch"
python tools/study.py report /path/to/dated-roster.json "$work/batch"
```

Planning and reporting run locally. The pilot and validation commands call the configured providers. The fixed hint is appended once to each session's instructions only in the hinted variant. The batch records the input hashes, settings, provider traces, tool calls, scoring evidence and available token and cost data. Keep unsuccessful runs and infrastructure errors with the batch. A revised task or roster uses a new batch directory. For ordinary-task qualification each model must achieve zero full passes and a mean below 50% in its five independent unhinted runs, then 100% and all gates in its separate hinted run. [Implementation plan](https://github.com/karpning/Personal-Agents-Last-Exam/blob/5b7054dbc32956e5f162656092bb8d64934b9b09/proposals/task/blind-review-packet.md#6-construction-plan-and-effort)
