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

**Summary (required):** Brightwire Home v1 is a resettable household: lights, blinds, thermostats, switches, a lock with guest codes, a garage door, cameras, a speaker and sensors, plus scenes, routines, modes, confirmations, alerts and energy. All 35 Agent tools are named `brightwire-home.*`. Time-derived statuses are computed from `ctx.virtual_now`. Due routines and relocks commit on the next write or event. `apps/brightwire-home/evaluator/export.cjs` joins history to the last matching Core allow row, including connection and client name. Task 73 answers live in `apps/brightwire-home/examples/task-73-grade.cjs`. `apps/brightwire-home/src/publisher.cjs` sends owner notices to Mail and can reconcile a lost acknowledgement without sending again.

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

Observed on 2026-11-23 UTC, Node v22.23.4, runtime 1.6.0, Core API 1.2.0, app 1.0.0, against upstream main `a4bce023953061483c41de5a287ba5e43f4a5648`. Node 18 is the public-runtime CI version and was not installed in this checkout, so these commands ran on Node 22.

- App tests: 42 passed, 0 failed (`tests/business.test.cjs`, `tests/images.test.cjs`, `tests/mail-integration.test.cjs`, `tests/runtime.test.cjs`).
- Example: `{"app":"brightwire-home","contact":"open","alerts":0,"committed_through":"2026-11-17T12:05:00-06:00"}`.
- Runtime tests: 6 passed. Replay, stale version, reset, catch-up rollback, a task 73 load with the package bundle, and an MCP join of two clients.
- Mail integration: 1 passed. A confirmation request and a camera share each produce one Mail message. A second publish of the same request id returns `duplicate: true`. A publisher with no grant returns `recipient_not_authorized` with the lock still locked. A dropped acknowledgement is reconciled through Infra `env.event_status` without a second publish, and a notice that never committed stays unresolved.
- `app:verify` passed. The report is `.artifacts/brightwire-home.json`.
- `npm test`: 24/24 stages passed, including contracts, the clock contract for each registered App, the Brightwire verify stage, and `brightwire-home-runtime`.

## Implementation progress

Package `apps/brightwire-home/`:

- `plugin.cjs`, `src/house.cjs`, `src/time.cjs`, `src/model.cjs`, `src/publisher.cjs`, `src/domain-utils.cjs`, `src/diagnostics.cjs`
- `tools.json` (35 tools), `schemas/seed.schema.json`, `schemas/state.schema.json`, `schemas/events.schema.json` (10 events)
- `fixtures/minimal.json`, `fixtures/task-73.json`, `fixtures/household-b.json`, `fixtures/household-c.json`, bindings, `clock.json`, `policies.json`
- `evaluator/export.cjs`, `examples/task-73-grade.cjs`, `gui/src/view.js`, 9 icons, 3 floor plans, 6 snapshots
- `tests/business.test.cjs`, `tests/runtime.test.cjs`, `tests/mail-integration.test.cjs`, `tests/images.test.cjs`, `examples/run.cjs`
- `README.md` with the task-author notes. `rt-front-0700` is disabled in the task 73 fixture.

The clock test reads the size of `apps.registry.json` instead of a fixed package count. Brightwire has a reviewer renderer. The Apps that ship `gui/index.html` keep their business pages.

## How the implementation suggestion was handled

Every Agent tool is prefixed with `brightwire-home.`. The proposal file was not edited to rename tools. `runtime/sdk/sync.cjs` filled `contribution/contribution.json` from `tools.json`. Infra operations stay the six baseline admin tools. `env.advance_time` remains host-discovered.

## Integration pointers

- Task #73: load `fixtures/task-73.json` with `fixtures/binding-task-73.json`, the package bundle, `virtual_now` `2026-11-17T19:42:00-06:00`, and the sandbox policy. `rt-front-0700` is disabled in that fixture. Grade with `examples/task-73-grade.cjs` from a snapshot taken before `env.reset`. Protected ids are `lock-front`, `garage-main`, `switch-water-heater`. The nursery blind is `blind-nursery`. The nursery camera starts with privacy on, so a share returns `unsupported_command`.
- #71, #72, #74, #75, #85 and #168 do not mention Brightwire in their diffs. #85 (Kinthread) is the Messages-side place for group roles. A Brightwire alert through Messages would be authored as the household owner, so that alert is left out of v1.
- #31 and #5: optional `hearth_appliance_id` and booking windows that a task turns into codes. No runtime call to either App.

## Known limits

- One household per account. Devices are already paired in the seed.
- Schedules use the fixture UTC offset. The timezone name is a label. Daylight-saving transitions are not applied.
- Sunrise and sunset need a `sun_table` row. A missing row is a miss with reason `no_sun_time`.
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
- A caught-up routine records device changes at `fired_at`. Only the auto-relock row is stamped at its due time.
- Mail reconciliation uses an Infra Mail client. `env.event_status` and `env.snapshot` are not Agent tools.
- `env.reset` clears the previous audit and then records the reset itself.
- There is no business web page. `node runtime/web/server.cjs --app brightwire-home` has nothing to mount.
- Family chat is not sent.

## Comment draft

@Jasonya Brightwire Home v1 is on `environment-proposal/brightwire-home-devices`. It implements the approved plan: 35 `brightwire-home.*` tools, the 10 events, four household fixtures, the evidence helper, the task 73 grader, and the Mail publisher. `npm run app:verify -- --app apps/brightwire-home` passed, and `npm test` passed 24/24 against upstream main `a4bce023953061483c41de5a287ba5e43f4a5648`. The proposal file is unchanged (`cfddc0d8f33af729322817b56620876474509d9d`). Task 73 can load `apps/brightwire-home/fixtures/task-73.json`. The suggested PR text and the limits are in `apps/brightwire-home/contribution/PR_UPDATE.md`.
