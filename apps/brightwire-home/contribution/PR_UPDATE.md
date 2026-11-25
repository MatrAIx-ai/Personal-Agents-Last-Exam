# Proposed pull request update

This file is the suggested replacement for the description of PR 86. It is not posted by itself. The proposal file is unchanged.

## Track and stage

**Track (required): select one.**

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Implementation

## Design

**Design file (required for Environment or Task):** [`proposals/environment/brightwire-home-devices.md`](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/brightwire-home-devices/proposals/environment/brightwire-home-devices.md)

The approved plan is the baseline. The file blob is still `cfddc0d8f33af729322817b56620876474509d9d`.

## Summary and dependencies

**Summary (required):** Brightwire Home v1 is a resettable household: lights, blinds, thermostats, switches, a lock with guest codes, a garage door, cameras, a speaker and sensors, plus scenes, routines, modes, confirmations, alerts and energy. All 35 Agent tools are named `brightwire-home.*`. Time-derived statuses are computed from `ctx.virtual_now`. Due routines and relocks commit on the next write or event. `apps/brightwire-home/evaluator/export.cjs` joins history to the last matching Core allow row, including connection and client name. Task 73 answers live in `apps/brightwire-home/examples/task-73-grade.cjs`. `apps/brightwire-home/src/publisher.cjs` sends owner notices to Mail and reconciles the stopped attempt from Mail's receipt.

**Dependencies / questions (optional):** Public runtime 1.6.0 and Mail 1.3.0. Verified against upstream `main` `a4bce023953061483c41de5a287ba5e43f4a5648`. First consumer is task #73, which should load `apps/brightwire-home/fixtures/task-73.json`. Hearth (#31) and Home Repair Slots (#5) are shared id strings only. Calendar is read by the agent with Calendar's own tools.

The [proposal list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/proposal-list.md) automatically reads this PR and its completed proposal file. Include one proposal file, preserve the template's headings and field labels, and keep your answers current. Do not edit the generated list.

## Progress and evidence

- [x] Proposal ready for design review
- [x] Plan approved by maintainer
- [ ] Implementation complete
- [x] Validation evidence attached

Automated checks below passed on this tree. Human review of the synthetic media and production deployment checks remain separate, as the public verifier still lists them.

**Evidence:**

```sh
node --test apps/brightwire-home/tests/business.test.cjs
node apps/brightwire-home/examples/run.cjs
node --test apps/brightwire-home/tests/runtime.test.cjs
node --test apps/brightwire-home/tests/mail-integration.test.cjs
npm run app:verify -- --app apps/brightwire-home
npm test
```

Validation evidence for this tree is in [https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/brightwire-home-devices/apps/brightwire-home/contribution/evidence.md](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/brightwire-home-devices/apps/brightwire-home/contribution/evidence.md). The package hash is the `package_sha256` value printed by `npm run app:verify -- --app apps/brightwire-home`.

The candidate suite and the App validator are reported separately.

Observed on 2026-11-25 UTC, runtime 1.6.0, Core API 1.2.0, app 1.0.0, against upstream main `a4bce023953061483c41de5a287ba5e43f4a5648`.

Candidate suite (`npm test`):

- Node v22.23.4: 24/24 stages passed.
- Node v18.20.8 (`npx -p node@18`): 24/24 stages passed.
- Node v24.22.3 (`npx -p node@24`): 24/24 stages passed.

App validator (`npm run app:verify -- --app apps/brightwire-home`): 49 checks passed on Node v22.23.4, Node v18.20.8 and Node v24.22.3.

App tests on Node v22.23.4, Node v18.20.8 and Node v24.22.3: 65 passed, 0 failed (`tests/business.test.cjs` 49, `tests/images.test.cjs` 2, `tests/mail-integration.test.cjs` 3, `tests/runtime.test.cjs` 11). The business page check is `node apps/brightwire-home/tests/web-gui.cjs` and is separate from those four files. It writes screenshots to a temporary directory unless `--update-screenshots` is passed.

- Example: `{"app":"brightwire-home","contact":"open","alerts":0,"committed_through":"2026-11-17T12:05:00-06:00"}`.
- Runtime tests: 11 passed. Replay, stale version, reset, catch-up rollback, a task 73 load with the package bundle, `env.load_seed` rejecting `snap-made-up`, a camera read of a snapshot the bundle marks missing, an MCP join of two clients, the task 73 hallway brightness receipt, a clock advance that reuses the living-room request id and stays `env.advance_time`, and an approved confirmation joined to its Infra event.
- Mail integration: 3 passed. A confirmation request and a camera share each produce one Mail message. A second publish of the same request id returns `duplicate: true`. A publisher with no grant returns `recipient_not_authorized`, leaves the granted inbox the same length, and stores no Brightwire message on the denied run. A dropped acknowledgement is reconciled from the stopped attempt. A real `env.snapshot` supplies the run id, and a lost acknowledgement confirms with one publish. A receiver rejection after Mail accepts the dispatch stays unresolved, with one publish.

## Implementation progress

Package `apps/brightwire-home/`:

- `plugin.cjs`, `src/house.cjs`, `src/time.cjs`, `src/model.cjs`, `src/publisher.cjs`, `src/domain-utils.cjs`, `src/diagnostics.cjs`
- `tools.json` (35 tools), `schemas/seed.schema.json`, `schemas/state.schema.json`, `schemas/events.schema.json` (10 events)
- `fixtures/minimal.json`, `fixtures/task-73.json`, `fixtures/household-b.json`, `fixtures/household-c.json`, bindings, `clock.json`, `policies.json`
- `evaluator/export.cjs`, `examples/task-73-grade.cjs`, `gui/src/view.js`, 9 icons, 3 floor plans, 6 snapshots
- `tests/business.test.cjs`, `tests/runtime.test.cjs`, `tests/mail-integration.test.cjs`, `tests/images.test.cjs`, `examples/run.cjs`
- `README.md` with the task-author notes. `rt-front-0700` is disabled in the task 73 fixture.

Files outside the App, with the reason each one stays:

- `apps.registry.json`: registers the Brightwire package so the runtime can load it.
- `runtime/tests/clock.test.cjs`: the clock test counts Apps in `apps.registry.json`.
- `runtime/tests/run.cjs`: `npm test` runs the Brightwire verifier plus the runtime, Mail and image tests.
- `runtime/registrations/brightwire-home.json`: lets `brightwire-home.devices.get` read the household snapshot, so a camera read can see that the committed bundle marks it missing.

`runtime/core` matches upstream `a4bce023953061483c41de5a287ba5e43f4a5648`. `docs/personal-apps.md`, `docs/runtime-time.md`, `examples/workflows/session-time/README.md`, `runtime/README.md` and `runtime/web/README.md` match that revision as well.

## How the implementation suggestion was handled

Every Agent tool is prefixed with `brightwire-home.`. The proposal file was not edited to rename tools. `runtime/sdk/sync.cjs` filled `contribution/contribution.json` from `tools.json`. Infra operations stay the six baseline admin tools. `env.advance_time` remains host-discovered.

## Integration pointers

- Task #73: load `fixtures/task-73.json` with `fixtures/binding-task-73.json`, the package bundle, `virtual_now` `2026-11-17T19:42:00-06:00`, and the sandbox policy. `rt-front-0700` is disabled in that fixture. Grade with `examples/task-73-grade.cjs` from a snapshot taken before `env.reset`. Protected ids are `lock-front`, `garage-main`, `switch-water-heater`. The nursery blind is `blind-nursery`. The nursery camera starts with privacy on, so a share returns `unsupported_command`.
- #71, #72, #74, #75, #85 and #168 do not mention Brightwire in their diffs. #85 (Kinthread) is the Messages-side place for group roles. A Brightwire alert through Messages would be authored as the household owner, so that alert is left out of v1.
- #31 and #5: optional `hearth_appliance_id` and booking windows that a task turns into codes. No runtime call to either App.

## Known limits

- One household per account. Devices are already paired in the seed.
- Schedules use the fixture UTC offset. The timezone name is a label. Daylight-saving transitions are not applied.
- Sunrise and sunset need a `sun_table` row. When the row is missing, the first commit whose cursor has passed noon on that date records one miss with reason `no_sun_time`. A later commit on the same date does not record a second miss.
- Recurring code schedules are not checked for overlap. Window codes on the same lock are.
- `schedule.process_due` with nothing due still advances `committed_through` when the clock has moved, so the same window is not scanned again. It adds no device change and no firing in that case.
- An obstructed garage keeps its last open or closed position. `close` throws `obstructed`. `open` is still accepted. A jammed lock stores `lock: "jammed"` until `fault.clear`.
- Resolving a confirmation by `device_id`, `routine_id`, `scene_id` or `mode` uses the oldest confirmation that still reads pending. Pass `confirmation_id` when two are open.
- `code_created` is queued when the code is stored, including while approval is pending. The notice does not contain the digits.
- Deleted routines can be read. Mutations throw `routine_not_found`.
- Sensor events and faults use actor kind `manual`, with actor id `sensor` or `fault`.
- The shared registry clock is later than the package clock. A task on 2026-11-17 must set `virtual_now` in `env.load_seed`.
- `records()` returns one household summary, so bundles should keep `expected_counts.records` at 1.
- In-process `execute` audit rows omit `input.request_id`. The MCP server adds it, along with `connection_id` and `client_name`. The helper keeps `request_id` on the activity either way.
- Assistant mode carry is the list `assistant_carried_modes`. A member mode change or an owner routine clears the whole list.
- A scheduled routine that is still inside its catch-up window records its device changes at the commit time, in `fired_at`. An auto-relock that was already due is stored at its due time. Device actions that the relock triggers are stored at that same due time. A relock whose unlock was replaced by a later unlock is skipped.
- Mail reconciliation uses an Infra Mail client. `env.event_status` and `env.snapshot` are not Agent tools.
- `env.reset` clears the previous audit and then records the reset itself.
- The business page is `node runtime/web/server.cjs --registry apps.registry.json --app brightwire-home`. It uses the Agent tools for device commands, scenes, routines, modes, guest codes, camera share and confirmation cancel. `gui/src/view.js` remains the reviewer renderer.
- Family chat is not sent.

## Comment draft

@Jasonya The follow-up is on `environment-proposal/brightwire-home-devices`. `runtime/core` matches upstream again. Snapshot ids are checked against the package catalog, and a bundle that drops a listed snapshot does not commit. The business page is `node runtime/web/server.cjs --registry apps.registry.json --app brightwire-home`. `npm run app:verify -- --app apps/brightwire-home` passed 49 checks. `npm test` passed 24/24 on Node 22.23.4, Node 18.20.8 and Node 24.22.3. The proposal file is unchanged (`cfddc0d8f33af729322817b56620876474509d9d`). The validation record is [https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/brightwire-home-devices/apps/brightwire-home/contribution/evidence.md](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/brightwire-home-devices/apps/brightwire-home/contribution/evidence.md).
