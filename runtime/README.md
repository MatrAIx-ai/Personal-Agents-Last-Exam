# Public App runtime

This package exposes the local reference Core and Infra-owned Messaging module so contributors can reproduce integration checks. Runtime release 1.5.0 supports Mail/Calendar 1.3.0, Core API 1.2.0 and contribution revision 0.4.0. Existing business tool schemas and the text Email wire contract are retained; attachment tools, a separate attachment channel and Calendar ICS import are additive.

Requires Node.js 18+; no external packages or private credentials. From the repository root:

```sh
npm test
npm run app:verify -- --app examples/apps/mail --output .artifacts/mail.json
npm run app:verify -- --app examples/apps/calendar --output .artifacts/calendar.json
npm run example:delivery-to-mail
npm run example:mail-to-mail
npm run example:attachments
```

`npm test` writes a per-stage summary and logs to `.artifacts/`, which is ignored. `PALE_REPORT_DIR` can choose another report directory. State is temporary for verification; normal service launches use the selected state directory. Business tests also run from each App alone.

## Layout

- `core/`: package/schema validation; separate Agent and Infra MCP tools; policies; seed/history loading; per-App persistence, locks, versions, retries, events, resources and optional step logs.
- `messaging/`: publisher/receiver contract discovery, recipient binding, authorization, delivery, receipts, deduplication and time correlation. Maintained by Infra, usable publicly.
- `contracts/`: shared schema sources and declaration checks. This is a supported JSON Schema subset; unsupported keywords fail closed.
- `cli.cjs`, `prepare.cjs`, `launch.cjs`, `client.cjs`: public verification/launch entrypoints and real stdio MCP client.
- `tests/`: reference checks and deliberately small test fixtures. Fixtures are not automatically full contributed Apps.
- `ci/`: submission verification also runnable from a maintainer-selected base revision.

## Launch an App

A host opens independent stdio connections; it does not give an Agent the management connection.

```sh
# Start the management MCP connection first; this initializes the run.
node runtime/cli.cjs serve --app examples/apps/mail --role infra --run demo --state-dir .state
# A separate process/connection for the Agent, using the same run and state directory.
node runtime/cli.cjs serve --app examples/apps/mail --role agent --run demo --state-dir .state
```

These commands are MCP servers waiting for JSON-RPC on stdin, not a human-facing shell. Use the verifier or workflow examples to drive them automatically. Standard MCP `initialize`, `notifications/initialized`, `tools/list` and `tools/call` apply.

`service.cjs` in each App now locates the public runtime in its checkout and starts directly. An App outside the checkout can set `PALE_RUNTIME_ROOT` to the public `runtime/` directory. Advanced assemblies may supply a trusted `--registry` and optional `--assembly`. `verify` / `serve` accept repeated `--with PATH` for declared App dependencies.

## State and authority

Infra operations are `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status` and `env.validate_bundle`. They are neither listed nor callable on the Agent connection. Tasks supply actual account/history/event content; the App validates domain data; Core commits it. Version and request/event IDs control stale and repeated writes.

Core persists under `<state-dir>/<run>/<app>.json`. Separate instance state roots allow multiple instances of one App, as shown by Mail-to-Mail. Only Infra uses complete snapshots. App code runs with the host process's permissions: this is not containment of malicious plugins. Review code before execution and use disposable environments without production credentials.

## Diagnostics and time

The registry's `initial_time` initializes the reference run. App-only launchers use optional `fixtures/clock.json`; absent configuration uses the Unix epoch. Infra can supply a task-specific `virtual_now` to `env.load_seed`, and reset restores that loaded clock baseline. This does not schedule cross-App events. App-specific data migrations belong to the optional `plugin.migrateState` hook.

The App returns `{ data, result }`; Core commits and wraps the same business response. Optional `ctx.log` is injected, never imported by business code. Diagnostic JSONL files are separate from business state and Agent observations; errors in the best-effort sink do not change business outcomes. Reset retains diagnostics; removing the run directory removes them. Central retention, collection and remote queries are deployment responsibilities.

Core event receipts/audit and Messaging receipts preserve optional producer time and record their own processing times. Reset/seed replacement retains the existing audit-clearing behavior; export evidence before discarding a run. See [Messaging](messaging/README.md).

## Known limits

These limits belong to [`local-reference-v1`](profiles/local-reference.json), not every future environment. See the [extension plan](../docs/environment-architecture.md). Resource registrations live in `runtime/registrations/` and require Infra review; authors do not change Core permission code for each new App.

- Local MCP stdio and trusted launch configuration; no remote OAuth, HTTP MCP, HTTPS ingress or production token validation.
- Messaging currently uses trusted Infra receiver connections. Production deployment needs restricted delivery credentials and shared identity/access enforcement.
- No reliable outbox, durable retry queue, crash resume or cross-App atomic transaction. Unknown receipt outcomes halt for inspection.
- Per-App virtual clocks, not a global scheduler or reminder-triggered Agent sessions.
- Mail supports the original text channel plus a separately authorized attachment channel. A custom receiver/channel is also covered by a test fixture.
- Local media includes PDF, UTF-8 text, ICS, PNG/JPEG, MP3/WAV, MP4 and JSON; 64 assets / 1 MiB decoded bytes per App bundle. Parent-resource access mappings remain platform-controlled.
- Mail/Calendar GUI files are reviewer renderers requiring a host. This package's automated tests do not claim a complete Agent CUA UI or a new public web deployment.
- Human workflow realism, media quality, provenance and official platform acceptance remain separate reviews.

Public source does not expose a deployed service or grant access to official runs. Do not publish generated state, private records, keys or production configuration.
