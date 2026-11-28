# Home Repair Slots: first runnable local version

This synthetic App follows [Environment PR #5](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/5)
and its approved design at `0aed3106731a56a44c110199ba66bbb085844750`.
Implementation lead/maintainer: Xiao Cui (@2018cx). The approved document is
unchanged. The maintainer-directed code prefix is `home-repair-slots.*` for
both business operations and the one incoming event.

Use Node 18+ and the public PALE reference runtime 1.6.0 / Core API 1.2.0.
The proposal API baseline was `61b637164e4abddf81536bb48935cdb688a69ff1`;
the candidate also targets the same APIs on upstream main
`25d559778696dff849bb88fcca03f325185f2599`. From this App directory:

```sh
export PALE_RUNTIME_ROOT=/absolute/path/to/public-pale/runtime
npm test
node "$PALE_RUNTIME_ROOT/cli.cjs" verify --app "$PWD" --output /tmp/home-repair-slots-verification.json
node tests/core.cjs
```

The app verifier stages its own temporary App and does not require an installed
library or live API. It runs business tests and the synthetic event example.
The independent App test script uses separate Agent and Infra MCP stdio
connections. Keep Infra inaccessible to the Agent. The scenario profile is a
read-only comparison policy; use sandbox for local business actions.

For interactive UI verification, put this App in a disposable copy of the
public upstream checkout as `apps/home-repair-slots`. From that runtime checkout:

```sh
printf '%s\n' '{"schema_version":1,"initial_time":"2027-01-12T09:00:00+08:00","apps":[{"app_id":"home-repair-slots","version":"0.1.0","path":"apps/home-repair-slots"}]}' > home-repair-local.registry.json
node runtime/web/server.cjs --app home-repair-slots --registry home-repair-local.registry.json --run repair-local --profile sandbox --state-dir /tmp/repair-local-state
```

Open the displayed loopback link. Slots show the supplied date window, currency
and all-inclusive ceiling. Select S1 to open an editable preview. Review and
explicitly confirm, or discard without creating a booking. Open B1 from
Bookings and use Change or cancel; an explicit second confirmation is required.
Reloading re-reads the App state. The browser uses precisely the same fixed
Agent business MCP connection; no action writes directly to fixture storage.

The synthetic initial clock is Jan 12, 2027 at 09:00 UTC+08:00. The 12–14 January
window with CNY 130.00 inclusive cap gives S1/S2/S4. S3 is too expensive, S6
is outside the requested dates, S7 is exactly at the start boundary, S8 is
past, and B1 already owns S5. R0 is a seeded open preview of S2 so that the
public verifier can exercise the event; selecting another eligible slot
supersedes it without holding the slot. B2–B4 are cancelled history.
To stage the deterministic race from a script, select S1 in Agent session 1,
apply `examples/scenario.json` via Infra, and confirm via session 2 on the
same run. The stale epoch/revision fails first; on the refreshed version,
the invalidated preview returns `slot_unavailable`. An identical successful
request retry returns its original receipt and cannot create a second booking.

The App owns one customer, one service and one synthetic run state. Reset
restores initial data/resources and the virtual clock in a new epoch. No
notification, payment, address/access data, provider contact, live account,
calendar, cross-App change, or external service is implemented. Agent/model
trials and independent final maintainer acceptance are not claimed.

All fixture names, estimates and booking data are original synthetic examples.
Taskrabbit is a public workflow reference only; no content or branding was
copied. The PALE template compatibility schemas and envelope structures retain
the upstream MIT notice in `UPSTREAM-MIT-NOTICE`. Original code and synthetic fixture data are released under the MIT license in
`LICENSE`. Human dataset quality review remains pending.

### Observed local Chromium reproduction

The actual desktop Chromium ran the public Web Host against an isolated
sandbox run. The date and all-inclusive price filter showed S1/S2/S4. The
browser discarded a preview without creating a booking. After an independent
Infra client took S1, the stale confirmation was rejected and Refresh showed
the invalidated preview. The browser then confirmed S2, rescheduled the same
B5 to S4 with S2 released, and cancelled B5 with S4 restored and a readable
cancelled record. An independent Infra snapshot confirmed B5 cancelled on S4
and S1 still unavailable. Two successful resets returned exact seed data and
revision zero in new epochs; both browser replays recreated R1, discarded it
and left identical synthetic business state. These are local browser results,
not GitHub CI or final acceptance.

### Implementation review regression

In a full PALE checkout, run these commands from this App directory with
`PALE_RUNTIME_ROOT` unset. The service discovers the enclosing public runtime;
the standalone package can instead point that environment variable at a
trusted runtime.

```sh
npm test
node examples/run.cjs
node tests/core.cjs
node ../../runtime/cli.cjs verify --app "$PWD" --output /tmp/home-repair-review.json
```

To replay browser checks, use the repository-pinned Playwright **1.56.1** from
the full checkout, or provide its installed module via
`PALE_PLAYWRIGHT_MODULE`. Provide an already installed, sandbox-capable
Chromium using `CHROMIUM_PATH`. No installation or public network is used
during the browser test. The [evidence index](evidence/README.md) describes
offline prerequisites and the Node 18/22 browser matrix. The App does not
ship a test browser or add a production dependency.

Four fictional cancelled bookings add paired confirmation/cancellation history
from 2025-01-01 through 2026-10-21 (UTC+08:00). The first task session is still
2027-01-12; historical slots are excluded from availability and do not change
the S1/S2/S4 scenario or the first generated booking ID B5.

Review regression on 2026-11-24: six business tests and the example passed;
the public verifier passed 37 checks and both local stages. The Core test
from the App directory passed without an environment override and started
an independent Infra session using the App launcher. The browser replay
passed on Chromium Headless Shell 156.0.8078.79 with its sandbox enabled,
Playwright 1.62.1, and Node 24.22.3, with no page JavaScript errors. The pinned
proposal baseline and upstream main have identical `runtime/` trees.

### Full-window evaluation delivery
The eight dated actions above describe the original small smoke fixture. A separate, versioned [evaluation package](evaluation/README.md) now delivers 68 synthetic booking actions on 44 distinct dates across all 24 months, with three separately bound households from 2025-01-01 to 2026-12-31. The package includes deterministic provenance, machine-readable monthly/source counts, and an independent Core load/query/reset test. The original smoke bytes and approved proposal are unchanged.

See the [evaluation and GUI evidence index](evidence/README.md) for links, commands, baseline mapping and separate browser versus MCP results.
