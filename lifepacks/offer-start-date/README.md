# offer-start-date (LifePack example)

A first worked example of a multi-session task in [LifePack 1.0](../../docs/lifepack-task-format.md), run with Harbor through the `harbor-steps` adapter in [`scripts/lifepack/`](../../scripts/lifepack/README.md).

**Status: format example, not a validated task.** The package runs end to end with Harbor: the reference solution scores 20 of 20, a do-nothing agent scores 0, and the agent is kept away from the App state and the tests. One model has been run, Gemini CLI with `gemini-4-carbon`, and it scored 20 of 20 in every run. With its reduced record set this version is too easy to be a benchmark task. See [Known limits](#known-limits).

## Task catalog

| Task | Proposal | Domains | Sessions | Simulated time |
| :--- | :--- | :--- | :--- | :--- |
| [`offer-start-date`](tasks/offer-start-date/) | [PR #177](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/177) by JeremyJC67, plan approved | Public service & law; Work & business | 2 | History from May 2, 2026. Sessions on November 16 and November 19, 2026. The task ends on November 20, 2026 at 17:00 (America/Los_Angeles). |

Kai Deng asks the assistant to give a recruiter a start date. The right date depends on a retention award, a notice rule, an attorney's changing date and Kai's wish for three working days off. Between the sessions the attorney moves her date, and the assistant must correct the start date without being asked.

Tokens for one full run, measured with Gemini CLI and `gemini-4-carbon`: about 1.14 million input tokens (0.53 million of them cached) and 67 thousand output tokens, in about 23 minutes. The proposal estimated 40k–100k. Each request carries the tool lists of eight MCP servers.

## What is in the package

```text
README.md
manifest.json                         package identity, dependencies and file hashes
authoring/build-workspace.cjs         writes the App records and tests/rules.json from one source
tasks/offer-start-date/
  task.toml                           Harbor settings (no sessions, no App connections)
  instruction.md                      Kai's first message
  context/timeline.yaml               sessions and events
  context/events/                     the email that arrives between the sessions
  context/permissions.yaml            starting authority and the text every session starts with
  context/user/                       persona, goals and the user script
  environment/Dockerfile              base image, sudo, and the adapter's install.sh
  environment/workspace/              records for Mail, Calendar, Notes, Files, Messages, Tasks, Contacts
  solution/                           reference solution, one session per call, and verifier-check paths
  tests/                              rubric, hint, rules and the verifier (scores a state snapshot)
demo/offer-start-date/evidence/       run records
```

Two choices that LifePack asks a package to state:

- **Environment definition:** a `Dockerfile` on `node:22-bookworm-slim`, pinned by digest. It installs `sudo` and runs the adapter's `install.sh`, which creates the accounts that keep the agent away from the App state.
- **Scoring code:** `tests/test_outcomes.cjs` (Node.js) instead of `test_outcomes.py`, because the runtime and Apps are Node.js and the image has no Python. `tests/test.sh` calls it.

## Run it

Tested with Node.js 22 and 26, Harbor 0.27.0, Docker 25.0.14 on Linux x86_64. Model run: Gemini CLI 0.71.1 with `gemini-4-carbon`. The run records in [`demo/offer-start-date/evidence/`](demo/offer-start-date/evidence/failure-analysis.md) were made at repository revision `6933c43`. The reference, do-nothing and probe runs were repeated at `25d5597` with the same results.

```sh
# 1. Build the Harbor directory (a build product; .artifacts/ is ignored by Git)
node scripts/lifepack/to-harbor.cjs lifepacks/offer-start-date/tasks/offer-start-date --out .artifacts/lifepack/offer-start-date

# 2. Check the task files without Docker: reference, five other scripted paths and do-nothing
node scripts/lifepack/local-run.cjs .artifacts/lifepack/offer-start-date --check

# 3. Run with Harbor (needs Docker)
harbor run -p .artifacts/lifepack/offer-start-date -a oracle     # reference solution: 20 of 20
harbor run -p .artifacts/lifepack/offer-start-date -a nop        # do nothing: 0 of 20
harbor run -p .artifacts/lifepack/offer-start-date -a <agent> -m <model>
GEMINI_API_KEY=... harbor run -p .artifacts/lifepack/offer-start-date -a gemini-cli -m gemini-4-carbon   # the model run in the evidence

# 4. Hinted run: a second build with the hint from tests/hints.md in every session's opening text
node scripts/lifepack/to-harbor.cjs lifepacks/offer-start-date/tasks/offer-start-date --out .artifacts/lifepack/offer-start-date.hinted --hinted

# 5. Isolation probe: a third build that tries, as the agent's account, to reach what the agent must not reach
node scripts/lifepack/to-harbor.cjs lifepacks/offer-start-date/tasks/offer-start-date --out .artifacts/lifepack/offer-start-date.probe --probe
harbor run -p .artifacts/lifepack/offer-start-date.probe -a oracle   # read steps/<session>/agent/oracle.txt in the trial folder
```

- **Reset:** every Harbor trial starts a new container from the built image, which holds the starting records. Nothing carries over between trials.
- **Score:** Harbor reads `reward.json`. `reward` is the normalized rubric score (0 to 1) and `pass` is the full-task result (1 or 0). `outcome.json` next to it holds each item's points and evidence, and `state.json` holds every App's final state. All three are in `steps/<session>/verifier/` of the trial folder. The task's score is the one after `s2`.
- **Credentials:** none for the reference and do-nothing runs. A model run needs the key Harbor expects for the chosen agent, for example `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`. The verifier needs no key.
- **Network:** the image build downloads the base image and three Debian packages. The Apps and the verifier use no network. Harbor's default lets the agent reach the internet.
- **Execution mode:** one Harbor step per session and a fresh conversation in each session. The agent runs as the account `agent`, not as root. The verifier runs in a container of its own and scores a state snapshot that Harbor takes after each session.

After changing a record, run `node lifepacks/offer-start-date/authoring/build-workspace.cjs`, then `node scripts/lifepack/manifest.cjs lifepacks/offer-start-date` to refresh the file hashes.

## Choices this example makes

These are defaults for discussion. Each one would apply to every task that uses the adapter.

| Question | Choice here |
| :--- | :--- |
| Where are sessions written? | Only in `context/timeline.yaml`. The adapter turns each session into a Harbor step. |
| How does a session start? | With one text: the system instructions from `permissions.yaml`, the current simulated time, then the user's message. The text is the same for every model and uses no harness-specific system prompt. |
| Does the conversation carry over? | No. Each session is a new conversation. What the assistant needs later must be in the Apps or in the chat history. |
| How do events between sessions arrive? | The step's `setup.sh` delivers them with `env.apply_event` and moves all seven Apps to the session time before the agent starts. |
| How does the assistant talk to the user? | Through a `chat.send` tool. The verifier reads the chat log, so scoring does not depend on a harness's own log format. `chat.history` returns the whole chat, including earlier sessions. |
| How does the user answer inside a session? | `chat.send` returns the scripted reply when a rule in `context/user/script.json` matches. Here Kai answers "Yes, go ahead." once, to a question in session 2. |
| How is a hinted run made? | A second build with the hint added after the system instructions in every session. The hint file is never copied into the container. |
| What is the task's score? | The verifier result after the last session (`multi_step_reward_strategy = "final"`). The verifier also runs after earlier sessions, but those results are not counted. |
| How is the agent kept away from the App state? | With Unix accounts in one container. The state belongs to the account `pale`. The agent runs as `agent` and has one `sudo` rule, for a door that starts only the agent connection of an App. See [Isolation](../../scripts/lifepack/README.md#isolation). |
| Where does the verifier run? | In its own container. The tests and the rubric never enter the agent's container. After each session Harbor takes the snapshot as root and hands it to the verifier. |

## Known limits

- **Too easy as it stands.** `gemini-4-carbon` scored 20 of 20 in 3 of 3 unhinted runs. The package holds 26 records against about 80 planned in the proposal. They hold every fact the rubric depends on and little else, and one note lists all seven of Kai's rules. The planned distractors and the spread of the rules over more sources are still to be added.
- **One model, no hinted run.** The validation policy asks for more models and for a hinted run. Only Gemini CLI has been tried as an agent.
- **Isolation is between accounts in one container.** The agent cannot read the App state, the snapshot or the tests, and the probe finds nothing open. The Apps and the agent still share a container and a kernel. See [Limits](../../scripts/lifepack/README.md#limits) in the adapter's README.
- **E5 uses keywords.** The proposal plans a fixed LLM-judge checklist for E5. This version checks keywords so that it runs without a judge model.
- **Rule checks are simple.** E1 and E2 look for date mentions in emails to Dana. An email that names February 1 only to rule it out fails E2. The rules need calibration against real model output.
- **What the adapter cannot run:** sessions opened by an event or a wake-up, events during a session, and events that depend on what the agent did. It reports these as errors.
