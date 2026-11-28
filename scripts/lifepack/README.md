# LifePack to Harbor: the `harbor-steps` adapter

[LifePack](../../docs/lifepack-task-format.md) writes a task's sessions and events in `context/timeline.yaml`. Harbor does not read that file: on its own it would run only the first session. This adapter reads a LifePack task and writes a Harbor directory with one step per session.

```text
LifePack task (committed, reviewed)
        |  to-harbor.cjs
        v
Harbor multi-step directory (build product, not committed)
        |  harbor run
        v
run records  -->  demo/<task-id>/evidence/ in the package
```

Status: version 0.2, tried on one task ([`lifepacks/offer-start-date`](../../lifepacks/offer-start-date/README.md)) with Harbor 0.27.0: the reference solution, a do-nothing agent, the isolation probe, and Gemini CLI with `gemini-4-carbon`. The field names below are a proposal. LifePack 1.0 does not define them.

## Commands

Run from the repository root. Node.js 18 or newer, no packages to install.

```sh
# Build. The output directory must be new, or a previous build together with --force.
node scripts/lifepack/to-harbor.cjs <package>/tasks/<task-id> --out .artifacts/lifepack/<task-id>
node scripts/lifepack/to-harbor.cjs <package>/tasks/<task-id> --out .artifacts/lifepack/<task-id>.hinted --hinted
node scripts/lifepack/to-harbor.cjs <package>/tasks/<task-id> --out .artifacts/lifepack/<task-id>.probe --probe

# Check the build without Docker
node scripts/lifepack/local-run.cjs .artifacts/lifepack/<task-id> --agent oracle     # reference solution
node scripts/lifepack/local-run.cjs .artifacts/lifepack/<task-id> --agent nop        # do nothing
node scripts/lifepack/local-run.cjs .artifacts/lifepack/<task-id> --check            # every path in solution/variants.json, plus do nothing

# Run with Harbor
harbor run -p .artifacts/lifepack/<task-id> -a oracle
harbor run -p .artifacts/lifepack/<task-id> -a <agent> -m <model>
harbor run -p .artifacts/lifepack/<task-id>.probe -a oracle      # isolation probe; read steps/<session>/agent/oracle.txt

# Refresh or check the file hashes in a package manifest
node scripts/lifepack/manifest.cjs <package> [--check]
```

`local-run.cjs` follows Harbor's order (image build step, then for each step: copy `workdir/`, run `setup.sh`, run the agent, take the snapshot, run the verifier) with plain processes under one account. It checks the task files. It is not evidence of a Harbor run and it has no isolation.

## What the adapter reads

| LifePack file | Used for |
| :--- | :--- |
| `task.toml` | Copied, with the generated settings added (see below). The source file must not contain them. |
| `instruction.md` | The user's first message. |
| `context/timeline.yaml` | Sessions, events and their order. |
| `context/permissions.yaml` | `system_instructions`, the text every session starts with. The `apps` list is checked against the workspace. |
| `context/user/script.json` | Opening messages of later sessions and the reply rules. |
| `context/user/persona.json` | The user's name, for the "… writes:" line. |
| `environment/` | Copied, except `workspace/`. The `Dockerfile` must install Node.js and `sudo`, copy `pale/` and `pale-task/`, and run `install.sh`. |
| `environment/workspace/meta.json` | The list of Apps and the starting time. |
| `environment/workspace/<app>/` | `seed.json`, `binding.json`, `policies.json`, and for file contents `catalog.json`, `dataset.json` and `assets/`. Packed into one `env.load_seed` payload per App. |
| `solution/` | Copied into every step. `solve.sh` is called with the session ID. |
| `tests/` | Copied, except `hints.md`. `rubrics.yaml` is converted to `rubrics.json`, because the image has no YAML reader. |

`context/user/goals.json`, the rest of `permissions.yaml` and `demo/` are not read. They describe the task for people and for a later user simulator.

Settings the adapter adds to `task.toml`:

| Setting | Value | Why |
| :--- | :--- | :--- |
| `multi_step_reward_strategy` | `"final"` | The score of the task is the verifier result after the last session. |
| `[[steps]]` | one per session | |
| `[[environment.mcp_servers]]` | `pale-mcp <app>` for each App, and `pale-mcp chat` | The agent's only connections. |
| `[agent] user` | `"agent"` | The agent does not run as root. |
| `[verifier] environment_mode` | `"separate"` | The tests and the rubric never enter the agent's container. |
| `[[verifier.collect]]` and `artifacts` | snapshot command, run as root | Hands the state after each session to the verifier. |

### `context/timeline.yaml` (`pale.timeline/0.1`)

```yaml
schema: pale.timeline/0.1
timezone: America/Los_Angeles
start: 2026-11-16T09:00:00-08:00      # the records are loaded at this time
sessions:
  - id: s1                             # becomes the Harbor step name
    at: 2026-11-16T09:00:00-08:00
    opened_by: user                    # the only value this adapter runs
    opening: instruction.md            # a file in the task folder, or script:<message id>
  - id: s2
    at: 2026-11-19T09:00:00-08:00
    opened_by: user
    opening: script:s2-open
events:
  - id: elena-2026-11-18
    at: 2026-11-18T10:30:00-08:00
    app: mail
    payload: events/elena-2026-11-18.json   # under context/; the argument of env.apply_event
end: 2026-11-20T17:00:00-08:00
```

An event is delivered before the first session whose time is at or after the event's time. Events with the same time keep the order of the file. Every time needs a UTC offset.

### `context/user/script.json` (`pale.user-script/0.1`)

```json
{
  "messages": [{ "id": "s2-open", "session": "s2", "kind": "opening", "text": "Morning. Anything I should look at today?" }],
  "replies": [{ "id": "s2-go-ahead", "session": "s2", "match": { "question": true }, "text": "Yes, go ahead.", "max_uses": 1 }]
}
```

A reply rule is tried each time the assistant calls `chat.send` in that session. `match` supports `question` (the message contains a question mark) and `pattern` (a regular expression, case-insensitive). The first rule that matches and has uses left answers. When none matches, the user does not reply.

The YAML files are read by a small strict reader (`yaml.cjs`): indented mappings and lists, one-line values, quoted strings, `[a, b]` lists and comments. Multi-line text blocks, anchors and tags are errors.

## What a build contains

```text
task.toml                              source settings plus the generated ones
environment/Dockerfile                 from the package
environment/pale/                      runtime/, apps/, examples/apps/ and the registry from this checkout
environment/pale-task/                 install.sh, door and the scripts from image/
environment/pale-task/private/         seed/<app>.json, task.json, apps.txt, steps/<position>-<sha256>
tests/                                 verifier, rules.json, rubrics.json (no hint)
steps/<session>/instruction.md         system instructions, current time, the user's message
steps/<session>/workdir/               setup.sh and .pale-step.json (events and reply rules for this session)
steps/<session>/solution/              solve.sh wrapper and the package's solution files (or probe.sh with --probe)
lifepack-build.json                    what was built, from which revision
```

Each build has new random values in its step data, so two builds of the same task are not interchangeable: an image accepts only the step data of its own build.

## Isolation

`install.sh` runs once in the image build and sets up two accounts.

| Account | Role | Can reach |
| :--- | :--- | :--- |
| `pale` | Service account. Owns the App state in `/var/pale/state` (mode 700) and can read `pale-task/private/`. | Everything of the Apps. |
| `agent` | The evaluated agent, its command-line tool and its shell (`[agent] user`). | Its working directory `/workspace`, the public code, and the door. |
| `root` | Harbor's collect step and the verifier. | Everything. Not available to the agent. |

The agent's account has one `sudo` rule: it may run `/opt/pale-task/door` as `pale`, and nothing else. The door has two commands.

- `door mcp NAME` starts the agent connection (`--role agent`) of one App of this task, or the user chat. `pale-mcp NAME` is the short form that `task.toml` declares. There is no way through it to pick the Infra role, another state directory or another program, and `sudo` clears the caller's environment.
- `door session` opens the next session from step data on standard input. `pale-session` is the short form that each step's `setup.sh` calls. Harbor runs `setup.sh` as the agent's account, so the door checks the data before it applies anything: the SHA-256 of the data must belong to this build, the session must be the next one, and each session opens once. An agent cannot open a session early, repeat one, or deliver events of its own.

A session's step data (its events and reply rules) is not in the container before that session starts. The image holds only its SHA-256.

One run, step by step:

1. Harbor copies `workdir/` into `/workspace` and runs `setup.sh` as `agent`. It calls `pale-session`, which delivers the due events, moves every App to the session time, checks that all clocks agree, and records the user's opening message in the chat. Then `setup.sh` deletes itself and the step data.
2. The agent works through its MCP connections. Each one is a `pale-mcp` process that runs as `pale`.
3. Harbor's collect step runs `pale-task.cjs snapshot /var/pale/collect/state.json` as root. The folder is closed to the agent.
4. Harbor starts the verifier's own container from the same image, places the snapshot at the same path and `tests/` at `/tests`, and runs `tests/test.sh`. The verifier scores the snapshot and writes `reward.json`, `outcome.json` and `state.json`. It does not touch the Apps.

### The probe

`--probe` builds a variant in which each step runs [`probe.sh`](probe.sh) in place of the reference solution, as the agent's account. It looks for task files, tries to read the App state and the snapshot, tries the management commands and other `sudo` uses, tries to misuse the door, and confirms that the intended connections still work. Each line is `PASS` (closed) or `FAIL` (open). It changes no records, so the run scores zero. The result to read is `steps/<session>/agent/oracle.txt`.

## Checked on a real run

Harbor's documentation leaves these open. On Harbor 0.27.0 with Docker:

| Question | Observed |
| :--- | :--- |
| Are a later step's files in the container during an earlier step? | No. |
| Where does `setup.sh` run, and as whom? | In the agent's container, in the working directory, as the account in `[agent] user` (root when it is not set). |
| Does Harbor keep the output of `setup.sh`? | No. A failure shows only the exit code, so the generated `setup.sh` writes the reason to `/logs/agent/setup-error.txt`. |
| With the verifier in its own container, where do collected files appear? | At the same path they had in the agent's container. They are also kept in `steps/<name>/artifacts/` of the trial folder. |
| Are per-step verifier files kept? | Yes, under `steps/<name>/verifier/`. |
| Do extra keys in `reward.json` work? | Yes. Every numeric key is reported as its own metric. |
| Does a real agent connect to the generated stdio MCP servers? | Gemini CLI does: eight servers, each through `pale-mcp`. Other agents are untried. |
| How is a model that Harbor does not know named? | Without a provider prefix (`-m gemini-4-carbon`). With `google/` in front, Harbor passed the whole string on and the API answered 404. |

One build problem is worth knowing. Docker's build cache compares a file's size and modification time. Two builds of the same task that are made in the same second and then copied with whole-second timestamps (for example through `tar`) can share one stale file. The first isolated run failed this way: the image held another build's check values. The adapter now stores those values as file names, so the paths differ between builds.

## Limits

- **The boundary is between accounts, not between containers.** The agent and the Apps share one container and one kernel. The boundary holds as long as the agent cannot become root or `pale`. A second container for the Apps would be stronger, and the runtime speaks MCP over stdio only, so that needs a bridge.
- **The image must fit `install.sh`.** It needs Node.js, `sudo`, `useradd` and `runuser`, and a base image whose default user is root. It has been tried on `node:22-bookworm-slim` only.
- **A process the agent leaves running keeps the agent's access.** It can still use the agent connections between sessions. It cannot read the state, the snapshot or the tests.
- **The agent can reach the internet** unless the task turns it off in `task.toml`.
- **Sessions must be opened by a user message.** Sessions opened by an event or a wake-up, events during a session and events that depend on agent actions are reported as errors.
- **Reply rules are simple matches** on the assistant's chat message. A rule that needs judgement (for example "the assistant asked about the held items") needs a pattern written for it, or a user simulator.
- **Fresh conversation per session.** Harbor can resume an agent's own session between steps (`--resume-trajectory`), but support differs by agent, so the adapter does not rely on it.
- **One agent tried.** Only Gemini CLI has been run. Whether other agents accept a non-root account and the `pale-mcp` connections is untested.
