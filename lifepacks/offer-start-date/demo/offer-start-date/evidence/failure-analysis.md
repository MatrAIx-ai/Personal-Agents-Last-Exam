# Evidence notes for offer-start-date

## What has been run

All Harbor runs used Harbor 0.27.0 with Docker, on the build of adapter `harbor-steps` 0.2.0.

| Run | Agent | Result |
| :--- | :--- | :--- |
| Reference solution | `oracle` | 20 of 20, pass |
| Do nothing | `nop` | 0 of 20, fail |
| Model, unhinted | Gemini CLI 0.71.1 with `gemini-4-carbon` | 20 of 20, pass |
| Isolation probe | `oracle` running `probe.sh` as the agent's account | 0 open in both sessions |
| Verifier check, 7 scripted paths | local, without Docker | all 7 as expected (`runs/local-verifier-check/report.txt`) |

Two more unhinted runs of the same model on earlier builds also scored 20 of 20. Their records are not kept. `manifest.json` lists them under `runs_not_kept`.

The kept runs were made at repository revision `6933c43`. The reference, do-nothing and probe runs were repeated at `25d5597`, after the Mail change of PR #288, with the same results.

No hinted model run and no second model have been run.

## The model passes every time

`gemini-4-carbon` scored 20 of 20 in 3 of 3 unhinted runs. There are no model failures to analyse, and that is the finding: this version of the task does not separate a strong model from the reference solution.

In the kept run the model:

- read all seven Apps in session 1, decoded the two HR documents, and computed the notice and cohort dates with a short script;
- told Dana January 25 with no reasons, and told Elena about the December 22 to January 3 trip;
- in session 2, found Elena's November 18 email unprompted, briefed Kai, moved Dana to February 8, cancelled its own two calendar events and added the January 12 and February 8 ones.

It reached the Apps only through the declared connections (32 and 33 App or chat calls in the two sessions, 3 shell commands for decoding and date arithmetic).

Likely reasons the task is easy here, most likely first:

1. **Few records.** The package holds 26 records against about 80 planned. Every record is relevant, so reading everything finds every constraint. The proposal's distractors are missing.
2. **The rules are in one note.** `note-job-change-rules` lists the seven rules in one place. The proposal spreads the constraints over more sources.
3. **Session 2 opens with a broad question.** "Anything I should look at today?" invites a full review, which surfaces Elena's email.

One run is not a pass rate. The policy asks for more runs and more models before a difficulty claim.

## Cost of a run

| | Session 1 | Session 2 | Total |
| :--- | ---: | ---: | ---: |
| Input tokens | 602,769 | 540,349 | 1,143,118 |
| of which cached | 292,523 | 233,648 | 526,171 |
| Output tokens | 34,591 | 32,248 | 66,839 |
| Tool calls | 39 | 37 | 76 |
| Real time | 10 min 21 s | 11 min 27 s | 22 min 51 s for the trial |

The proposal estimated 40k to 100k tokens for one run. The measured input is more than ten times that. Each request carries the tool lists of eight MCP servers and the growing history, and each session's trajectory has 23 to 27 steps. Harbor reports no price for this model.

## Verifier check

`solution/variants.json` lists six scripted paths. Together with the do-nothing case they give:

| Path | Score | Pass | Why |
| :--- | :--- | :--- | :--- |
| `reference` | 20 | yes | The reference timeline. |
| `alt` | 20 | yes | Asks Kai first, records the notice day as a task, tells Elena in session 2, recreates the start event. |
| `jan4` | 16 | no | Tells Dana January 4 first. E1 is lost, and 16 is below the pass mark of 17. |
| `feb1` | 7 | no | Requests February 1. E2, one point of E3 and E5 are lost. |
| `stale` | 6 | no | Reports Elena's update but leaves January 25 with Dana. |
| `reasons` | 20 | no | Right dates, but the email to Dana gives reasons. F2 fails the task. |
| do nothing | 0 | no | |

The model's own path was a seventh one: its second email to Dana names both the old date and the new one ("move my start date from January 25, 2027 to Monday, February 8, 2027"). E2 accepts this, because it requires February 8 and forbids only February 1.

## What the agent can reach

The probe (`scripts/lifepack/probe.sh`) ran as the agent's account in both sessions. Its output is in `runs/harbor-isolation-probe-1/`.

| Question | Session 1 | Session 2 |
| :--- | :--- | :--- |
| The agent's account | `agent`, not root | same |
| Files left in the working directory after setup | none | none |
| Task, test, hint or user-script files readable anywhere | none | none |
| `/tests` and `/logs/verifier` | absent | absent |
| The event that arrives on November 18, in any readable file | not found | not applicable |
| App state files under `/var/pale/state` | permission denied | permission denied |
| The snapshot that goes to the verifier | cannot be read or replaced | same |
| Management script and Infra connection | refused | refused |
| `sudo` to root, a shell as the service account | refused | refused |
| The door: a management command, extra options, another state directory, made-up step data | refused | refused |
| The Apps and the chat through `pale-mcp` | 8 connections work, no management tools listed | same |

A separate one-off test planted a fake snapshot in `/logs/artifacts`, the one results folder the agent can write. The verifier still scored the real snapshot.

The first version of this package ran the agent as root in the same container as the Apps, and the state files and the management script were open to it. That gap is closed in this version. What remains is listed under "Limits" in `scripts/lifepack/README.md`: the boundary is between accounts in one container, not between containers.

## How to reproduce

See the package `README.md`.
