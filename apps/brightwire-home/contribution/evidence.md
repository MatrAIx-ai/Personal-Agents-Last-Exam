# Brightwire Home v1 evidence

Commands were run from the repository root. Public runtime 1.6.0, Core API 1.2.0, Brightwire Home 1.0.0. Mail used by the integration tests is the packaged Mail 1.3.0. The package hash is omitted here because this file is inside the package, so `app:verify` prints the hash of the tree that includes this report. The proposal file `proposals/environment/brightwire-home-devices.md` is unchanged. Its blob is `cfddc0d8f33af729322817b56620876474509d9d`. `runtime/core` matches upstream main `a4bce023953061483c41de5a287ba5e43f4a5648`: `git diff a4bce023953061483c41de5a287ba5e43f4a5648 -- runtime/core` is empty.

## App verification

```sh
npm run app:verify -- --app apps/brightwire-home
```

On Node v22.23.4 the command exited 0. The report is for app `brightwire-home` version `1.0.0`, runtime `1.6.0`, Core API `1.2.0`. Manifest, business, event example, Agent discovery, published tool schemas, Infra lifecycle, the host clock denial for the Agent, the MCP read, history load, event commit, duplicate event, reset and the unchanged package check all passed.

The same command on Node v18.20.8 exited 0. All 49 checks passed for the same app, runtime and Core versions.

## Repository suite

```sh
npm test
```

`npm test` is `node runtime/tests/run.cjs`. Node v22.23.4: 24/24 stages passed. Node v18.20.8: 24/24 stages passed. The stages include `brightwire-home` and `brightwire-home-runtime`.

## App tests

```sh
node --test apps/brightwire-home/tests/business.test.cjs apps/brightwire-home/tests/images.test.cjs apps/brightwire-home/tests/mail-integration.test.cjs apps/brightwire-home/tests/runtime.test.cjs
node apps/brightwire-home/examples/run.cjs
```

Node v22.23.4: 58 passed, 0 failed (`tests/business.test.cjs` 44, `tests/images.test.cjs` 2, `tests/mail-integration.test.cjs` 3, `tests/runtime.test.cjs` 9). Node v18.20.8: the same 58 passed, 0 failed.

`node apps/brightwire-home/examples/run.cjs` printed:

```json
{"app":"brightwire-home","contact":"open","alerts":0,"committed_through":"2026-11-17T12:05:00-06:00"}
```

The runtime file includes the MCP sequence from the task 73 seed: `turn_off` on `light-living` at 19:42, Infra `env.advance_time` to 19:43 with that same request id, a further advance to 19:44, and hallway brightness 20. Audit seq 3 stays `env.advance_time`. `fresh_device_commands` has the two light commands.

## Unchanged base validator

The pull request job `base-runtime-compatibility` runs the base revision's `runtime/ci/verify-submissions.cjs` against this tree. The local equivalent, with upstream main `a4bce023953061483c41de5a287ba5e43f4a5648` as the trusted base:

```sh
git archive a4bce023953061483c41de5a287ba5e43f4a5648 | tar -x -C /tmp/trusted-base
node /tmp/trusted-base/runtime/ci/verify-submissions.cjs . /tmp/bw-base-evidence a4bce023953061483c41de5a287ba5e43f4a5648
```

Exit 0 on Node v22.23.4. Selection was full because `apps.registry.json` differs from that base. All eight Apps passed: brightwire-home, calendar, contacts, files, mail, messages, notes, tasks.

## Proposal commitments and tests

| Commitment | Where it is checked |
| :--- | :--- |
| Statuses that follow from time are computed from `ctx.virtual_now`. Reads leave stored data unchanged. | `auto-relock is visible on read at the exact minute and stored on the next write`; `a relock with no later write is visible from the start clock`; `access codes mask digits, reject bad windows, and stop at the window end`; `lock confirmation, expiry, approval and the carried night mode` |
| Due relocks and routines commit on the next write or event, in due-time order. A relock whose unlock was replaced is skipped. A routine past its catch-up is a miss. | `scheduled routines fire on the catch-up boundary and miss one second later`; `a later routine unlock keeps the door open until the new relock`; `an 801 day jump fires the routine due at the destination`; `a noon cursor and an earlier cursor each record one missing sun time` |
| `env.advance_time` changes no Brightwire data. The next write can commit what fell due. | `advance_time does not fire routines, and the next write can` |
| The evidence helper joins history to the Core allow row, reads a committed agent command from the request receipt when the receipt names the same tool, and keeps each row's own tool and actor. A shared request id on an Infra clock row stays `env.advance_time`. | `evidence joins the later allow row and keeps each client name`; `the task 73 reference path exports hallway brightness from the snapshot receipt`; `a clock advance that reuses a request id stays a clock advance`; `an approved confirmation joins the infra event and keeps the assistant actor` |
| Core example rows for lights, thermostat, garage, routines, codes, confirmations, camera share, energy, the owner 07:00 routine, night mode and the 19:42 miss. | `core example rows from the approved proposal` |
| The ten accepted events, including faults, manual changes, sensor alerts, codes and confirmations. | `faults, manual changes and sensor alerts`; `confirming a code can be cancelled, and a missing sun time is a miss`; `a device-state routine runs after a sensor change`; `an approved confirmation joins the infra event and keeps the assistant actor` |
| Mail publisher: one message per notice, a missing grant stops, a lost acknowledgement confirms from the stopped attempt, and a real snapshot supplies the run id. | `a committed Brightwire notice is delivered to Mail once, and a missing grant stops`; `a Mail receiver rejection after dispatch stays unresolved and is not published again`; `a real snapshot supplies the run id and a lost acknowledgement still confirms` |
| 35 Agent tools named `brightwire-home.*`. | App validator published input/output checks; `listed reads, routine edits, and an owner routine mode change` |
| Households (a), (b) and (c), and reset of this household. | `fixture files are present for the documented households`; `household C leaves the porch switch on and keeps a recurring code`; `reset restores the loaded business data and the baseline clock` |
| Task 73 grading from net change, set-and-revert, camera sessions and fresh device commands. `rt-front-0700` is disabled in that fixture. | `task 73 evidence ignores seeded history and flags a fresh camera share`; `task 73 grades calls by actor and ignores the disabled morning routine`; `task 73 flags every routine and scene change and keeps call arguments` |
