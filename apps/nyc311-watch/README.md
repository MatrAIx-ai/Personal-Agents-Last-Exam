# NYC 311 Watch

PALE Environment Track, [approved design](../../proposals/environment/nyc311-watch.md).
Implementation owner: Xiao Cui (@2018cx). A standalone, non-city sandbox
for street-condition lookup, private watches and local reminders. No city
account, filing, routing, email, SMS or live dependency.

## Run and verify

Use Node 18+ and the shared public runtime 1.6.0 / Core API 1.2.0.
From the repository root:

```sh
npm run app:verify -- --app apps/nyc311-watch --output /tmp/nyc311-verify.json
npm --prefix apps/nyc311-watch run test:core
npm ci
npm --prefix apps/nyc311-watch run test:browser
```

Use a system Chromium with `CHROMIUM_PATH` or install Playwright Chromium.
The browser test starts the real public Web Host and prints its evidence
directory. Screenshots are generated outside the App. Agent tools are
discoverable through `node apps/nyc311-watch/service.cjs --role agent`
(with the same staged registry/state/run as Infra for a shared session).
Use `--role infra` only on an independent trusted client. Local business tests
and the event example run without the shared runtime.

## Observation and event contract

Creation makes only local ID, creation time, borough and category visible.
An explicit seed observation timestamp with a known status and agency is the
first evidence of these fields. The capture timestamp establishes when the
official exported current state was observed, not when that state started.
An agency's recorded close timestamp is retained in provenance, but is not a
snapshot and is not promoted to current status. Before the first observation,
status is `unknown`, and agency, administrative code and update time are null.
Task authors must schedule status/agency events at or after an explicit
observation and use its visible previous value. A task needing an earlier
transition should supply a clearly synthetic earlier observation explicitly.
Advancing the clock can expose a later observation without creating a reminder.
Scenario events include administrative changes, agency changes and status
changes. Observations run before events at the same instant; otherwise effects
are replayed in virtual-time order. A field that an event does not change stays
unchanged. Source records and synthetic events are not merged into a claimed
official timeline. Closed means agency closure, not proof of physical repair.

Agent writes require an expected Core version and request ID. A watch is
independent of case history, binds to the resident account, and has its own
revision. Activity is written once per watch/event pair. Removing a watch
does not erase past reminders. Clock, application state and receipts live
only in Core. A discarded browser preview does not write. Core exposes
management only on the Infra connection and rejects stale requests atomically.

## Data

`fixtures/minimal.json` is only a smoke seed. Use `data/evaluation-v1.json`
with `data/dataset.json` and the empty asset catalog for evaluation. The
evaluation script in `tests/core.cjs` demonstrates a real load, date/status
queries before and after observations, and reset. `data/capture-v1.json`
records the pinned query per month, capture time, source-response hashes,
normalized seed hash and monthly counts. The raw response and lookup
keys are not included. See [data notes](data/README.md) for generation, reuse
conditions and source/synthetic separation.

## GUI and evidence

See [GUI](gui/README.md) and [validation index](VALIDATION.md).
