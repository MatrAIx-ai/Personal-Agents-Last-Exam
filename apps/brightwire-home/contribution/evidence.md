# Brightwire Home v1 evidence

Commands were run from the repository root on 2026-11-25. Public runtime 1.6.0, Core API 1.2.0, Brightwire Home 1.0.0. Mail used by the integration tests is the packaged Mail 1.3.0. The commit SHA and `package_sha256` for this tree are recorded at the end of this file. `app:verify` prints the hash of the tree that includes this report. The proposal file `proposals/environment/brightwire-home-devices.md` is unchanged. Its blob is `cfddc0d8f33af729322817b56620876474509d9d`.

`runtime/core` matches upstream main `a4bce023953061483c41de5a287ba5e43f4a5648`. Snapshot ids are checked in `src/model.cjs` against this package's `contribution/assets.catalog.json`. Each id in `available_snapshots` must be a ready `ui.snapshot`. A room icon is not accepted. The six snapshots name `bw-household-morales`. `assetReferences` requires each of those ids when that household is loaded, so `env.apply_event` cannot commit a bundle that drops one. A camera read reports `asset_missing` when the committed descriptor is missing. Households (b) and (c) list the same six ids.

## App verification

```sh
npm run app:verify -- --app apps/brightwire-home
```

On Node v22.23.4 the command exited 0. The report is for app `brightwire-home` version `1.0.0`, runtime `1.6.0`, Core API `1.2.0`. All 49 checks passed: manifest, business, event example, Agent discovery, published tool schemas, Infra lifecycle, the host clock denial for the Agent, the MCP read, history load, event commit, duplicate event, reset and the unchanged package check.

The same command on Node v18.20.8 exited 0. All 49 checks passed for the same app, runtime and Core versions. The same command on Node v24.22.3 exited 0. All 49 checks passed.

## Repository suite

```sh
npm test
```

`npm test` is `node runtime/tests/run.cjs`. Node v22.23.4, Node v18.20.8 and Node v24.22.3 each passed 24/24 stages. The stages include `brightwire-home` and `brightwire-home-runtime`. Node 18 and Node 24 were the `node` binaries from `npx -p node@18` and `npx -p node@24`.

## App tests

```sh
node --test apps/brightwire-home/tests/business.test.cjs apps/brightwire-home/tests/images.test.cjs apps/brightwire-home/tests/mail-integration.test.cjs apps/brightwire-home/tests/runtime.test.cjs
node apps/brightwire-home/examples/run.cjs
```

Node v22.23.4: 65 passed, 0 failed (`tests/business.test.cjs` 49, `tests/images.test.cjs` 2, `tests/mail-integration.test.cjs` 3, `tests/runtime.test.cjs` 11). Node v18.20.8 and Node v24.22.3: the same 65 passed, 0 failed, through the `brightwire-home` and `brightwire-home-runtime` stages of `npm test`. The copied-package business stage reports 49 tests. `tests/web-gui.cjs` is the business-page check and is not one of those four files. It writes screenshots to a temporary directory unless `--update-screenshots` is passed.

`node apps/brightwire-home/examples/run.cjs` printed:

```json
{"app":"brightwire-home","contact":"open","alerts":0,"committed_through":"2026-11-17T12:05:00-06:00"}
```

The runtime file includes the MCP sequence from the task 73 seed: `turn_off` on `light-living` at 19:42, Infra `env.advance_time` to 19:43 with that same request id, a further advance to 19:44, and hallway brightness 20. Audit seq 3 stays `env.advance_time`. `fresh_device_commands` has the two light commands.

## Unchanged base validator

The pull request job `base-runtime-compatibility` runs the base revision's `runtime/ci/verify-submissions.cjs` against this tree. The local equivalent, with upstream main `a4bce023953061483c41de5a287ba5e43f4a5648` as the trusted base:

```sh
base=$(mktemp -d)
git archive a4bce023953061483c41de5a287ba5e43f4a5648 | tar -x -C "$base"
node "$base/runtime/ci/verify-submissions.cjs" . /tmp/bw-base-evidence a4bce023953061483c41de5a287ba5e43f4a5648
```

Exit 0 on Node v22.23.4. Selection was full because `apps.registry.json` differs from that base. All eight Apps passed: brightwire-home, calendar, contacts, files, mail, messages, notes, tasks.

## Proposal commitments and tests

| Commitment | Where it is checked |
| :--- | :--- |
| Statuses that follow from time are computed from `ctx.virtual_now`. Reads leave stored data unchanged. | `auto-relock is visible on read at the exact minute and stored on the next write`; `a relock with no later write is visible from the start clock`; `access codes mask digits, reject bad windows, and stop at the window end`; `lock confirmation, expiry, approval and the carried night mode` |
| Due relocks and routines commit on the next write or event, in due-time order. A relock whose unlock was replaced is skipped. A routine past its catch-up is a miss. | `scheduled routines fire on the catch-up boundary and miss one second later`; `a later routine unlock keeps the door open until the new relock`; `an 801 day jump fires the routine due at the destination`; `a noon cursor and an earlier cursor each record one missing sun time` |
| `env.advance_time` changes no Brightwire data. The next write can commit what fell due. | `advance_time does not fire routines, and the next write can` |
| The evidence helper joins history to the Core allow row, reads a committed agent command from the request receipt when the receipt names the same tool, and keeps each row's own tool and actor. A shared request id on an Infra clock row stays `env.advance_time`. | `evidence joins the later allow row and keeps each client name`; `the task 73 reference path exports hallway brightness from the snapshot receipt`; `a clock advance that reuses a request id stays a clock advance`; `an approved confirmation joins the infra event and keeps the assistant actor` |
| Core example rows for lights, thermostat, routines, codes, confirmations, camera share, the owner 07:00 routine, night mode and the 19:42 miss. The handyman code is created for 19 November and the use events assert that `code_id`. | `core example rows from the approved proposal` |
| Garage obstruction, close while obstructed, and close after the fault is cleared. | `faults, manual changes and sensor alerts` |
| Energy for the closed water-heater week, an empty range before history, and a partial open interval. | `energy totals the closed water-heater week and reports no data before history` |
| `sensor.change` | `a device-state routine runs after a sensor change` |
| `device.manual_change` | `faults, manual changes and sensor alerts` |
| `member.presence` | `faults, manual changes and sensor alerts` |
| `mode.changed` | `lock confirmation, expiry, approval and the carried night mode` |
| `lock.code_used` | `access codes mask digits, reject bad windows, and stop at the window end` |
| `confirmation.resolved` | `an approved confirmation joins the infra event and keeps the assistant actor`; `approving a code window another code already holds records confirmation_failed` |
| `fault.inject` | `faults, manual changes and sensor alerts`; `a confirm-scope command is checked before a confirmation is stored` |
| `fault.clear` | `faults, manual changes and sensor alerts` |
| `schedule.process_due` | `process due with nothing pending only moves the cursor` |
| `notice.delivery_result` | `a committed notice cannot later be marked rejected` |
| Mail publisher: one message per notice, a missing grant stops, a lost acknowledgement confirms from the stopped attempt, and a real snapshot supplies the run id. | `a committed Brightwire notice is delivered to Mail once, and a missing grant stops`; `a Mail receiver rejection after dispatch stays unresolved and is not published again`; `a real snapshot supplies the run id and a lost acknowledgement still confirms` |
| 35 Agent tools named `brightwire-home.*`. | App validator published input/output checks; `listed reads, routine edits, and an owner routine mode change` |
| Households (a), (b) and (c), and reset of this household. | `fixture files are present for the documented households`; `household C leaves the porch switch on and keeps a recurring code`; `reset restores the loaded business data and the baseline clock` |
| Task 73 grading from net change, set-and-revert, camera sessions and fresh device commands. `rt-front-0700` is disabled in that fixture. | `task 73 evidence ignores seeded history and flags a fresh camera share`; `task 73 grades calls by actor and ignores the disabled morning routine`; `task 73 flags every routine and scene change and keeps call arguments` |
| Seeded history starts on 2025-01-01. `committed_through` stays on or after 2026-01-01. Task 73 still commits through `2026-11-17T19:42:00-06:00` with hallway brightness 100 and `rt-front-0700` disabled. | `fixture history starts on 2025-01-01 and the task cursor is on or after 2026-01-01`; `task 73 grades calls by actor and ignores the disabled morning routine` |
| A confirm-scope command, share, scene or routine checks the command, its arguments and whether the device can run it before a confirmation is stored. An approval that then fails is committed, the confirmation is approved, and the activity row is `confirmation_failed`. A code-window approval that overlaps another code does the same. | `a confirm-scope command is checked before a confirmation is stored`; `a saved scene or routine rejects an out-of-range action before confirmation`; `a camera share addressed to @ is rejected before a confirmation is stored`; `approving a code window another code already holds records confirmation_failed` |
| `available_snapshots` names a ready `ui.snapshot` in this package's catalog. A room icon is rejected. A replacement bundle that drops a listed snapshot does not commit. A camera read reports `asset_missing` when the bundle marks that snapshot missing. | `every shipped snapshot id is ready in the catalog`; `load_seed rejects a snapshot id that is not in the catalog`; `a camera read reports a snapshot the bundle marks missing` |
| Household (b) has 9 devices. Household (c) created its recurring code on 2025-01-06 and recorded uses in 2025 and in 2026. | `fixture history starts on 2025-01-01 and the task cursor is on or after 2026-01-01`; `household C leaves the porch switch on and keeps a recurring code` |
| A missing Mail grant leaves the granted inbox unchanged and stores no Brightwire message on the denied run. | `a committed Brightwire notice is delivered to Mail once, and a missing grant stops` |
| Camera snapshots are redrawn by `scripts/raster.cjs` and `scripts/materialize.cjs`. Labels use 16 pixel blocks. The redraw compares SHA-256 with the committed JPEG and does not skip. | `snapshot images redraw to the committed bytes`; `committed snapshots match the asset catalog and omit an encoder version` |
| The business page lists devices by room and by type and calls the Agent tools. Home shows mode and guest-code controls, and the guest code uses the household lock. A browser write is visible to MCP on the same run, a reload keeps it, an MCP write shows up after Refresh, a lock unlock shows `confirmation_required` while the lock stays locked, a failed refresh does not repeat the unlock, Run now shows `confirmation_required` and its id, a camera share can be stopped, and `env.reset` is refused. | `tests/web-gui.cjs`, recorded below |

## Review follow-up on 2026-11-25

Fixture activity in `minimal.json`, `task-73.json`, `household-b.json` and `household-c.json` begins on 2025-01-01. The added days are synthetic on and off records, every 14 days, and they replay to the same device state the dense window already ended on. Household (b) lists 9 devices: the living and hall lights, the thermostat, the front lock, the front contact, the hall motion, the kitchen leak, the hall smoke and the living temperature sensor. Household (c) code `code-weekday` was created on 2025-01-06 and has unlocked uses in 2025 and in 2026. The default bundle has 6 snapshots. The Brightwire package directory is 2,860,100 bytes, of which the fixtures are 2,069,187 bytes and the snapshot files are 16,861 bytes. The package stays above 2 MB because the fixture history from 2025-01-01 is already that large, and the JSON stays pretty-printed.

`devices.command`, `camera.share.start`, `scenes.run` and `routines.run_now` reject an unknown command, an out-of-range argument and an offline device while the class scope is `confirm`, and they leave `confirmations` unchanged. A saved scene or routine with brightness 140 is rejected before a confirmation is stored. A camera share addressed to `@` is rejected the same way. `executeStored` catches a coded failure, writes `confirmation_failed`, and lets the approval event commit. Approving a code window that another code already holds leaves the first code unchanged, leaves the confirmation approved, and records one `confirmation_failed` row.

`env.load_seed` with `snap-made-up` or `icon-living` added to `available_snapshots` returns `invalid_seed` through `createRuntime`. `env.apply_event` with a bundle that removes `snap-nursery` returns `invalid_bundle` and leaves the previous bundle in place. `env.apply_event` with a bundle that keeps `snap-nursery` and marks it missing commits, and `devices.get` then reports `snapshot_status` `asset_missing`. An approved guest-code extension that would leave more scheduled codes than `max_active_codes` allows records `confirmation_failed` with summary `code_limit_reached` and leaves the old schedule in place. A direct update on that path returns `code_limit_reached` as well. Two device reads with no request id still pair in order. When only reader B's execution is supplied, and the audit rows name different connection ids and client names, B's target stays on B and A's target stays empty.

The business page was checked with `NODE_PATH` pointing at a local Playwright install, which is not a repository dependency:

```sh
node runtime/web/server.cjs --registry apps.registry.json --app brightwire-home --run bw-gui --profile sandbox
node apps/brightwire-home/tests/web-gui.cjs
```

On Node v22.23.4 and Chromium 131.0.6778.33 the script exited 0. Screenshots were written to a temporary directory, so the committed `contribution/gui-rooms.png` and `contribution/gui-confirmation.png` stayed as the last recorded views. The browser set the living lamp to brightness 37, and an MCP read of the same run returned 37. A reload still showed 37. An MCP write of brightness 55 showed up after Refresh. Run now on `rt-front-0700` showed `confirmation_required` and `cf-1`. Home changed the mode to away, and the guest-code form submitted `lock-front`. The same Home checks on household B submitted `lock-mom-front`, with MCP readback for the mode and the code. Unlock showed `confirmation_required` and the front lock stayed locked. The next device list was dropped, and a second Unlock sent no new command: the run still had one new confirmation and one new notice. Household C shared the porch camera and Stop ended session `cs-1`. `env.reset` returned 403. `GET /management` returned 404. Scene and routine controls were listed.

These files outside the App remain, each for the reason on that line:

- `apps.registry.json`: registers the Brightwire package so the runtime can load it.
- `runtime/tests/clock.test.cjs`: the clock test counts Apps in `apps.registry.json`.
- `runtime/tests/run.cjs`: `npm test` runs the Brightwire verifier plus the runtime, Mail and image tests.
- `runtime/registrations/brightwire-home.json`: lets `brightwire-home.devices.get` read the household snapshot, so a camera read can see that the committed bundle marks it missing.

`runtime/core` matches upstream `a4bce023953061483c41de5a287ba5e43f4a5648`. `docs/personal-apps.md`, `docs/runtime-time.md`, `examples/workflows/session-time/README.md`, `runtime/README.md` and `runtime/web/README.md` match that revision as well. The proposal file is the approved plan and was not edited in this follow-up.

## Commit and package hash

Implementation commit `31dc5b6775c0c65bf8e85ad784521cac6db6c8a8`.

`package_sha256` `9b3da08888ad6f88353468b1fab6e9c2bef210695b8b9156ce240d1a5cd8ffe9`.

That hash is the `package_sha256` from `npm run app:verify -- --app apps/brightwire-home` on that commit, on Node v18.20.8, v22.23.4 and v24.22.3. This paragraph was added after that commit, so a later verify of the commit that contains this paragraph prints a new hash. Cite the hash printed for the commit you review. The evidence URL for the implementation commit is `https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/31dc5b6775c0c65bf8e85ad784521cac6db6c8a8/apps/brightwire-home/contribution/evidence.md`.
