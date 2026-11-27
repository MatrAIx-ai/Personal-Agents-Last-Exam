# Meeting Poll

A synthetic Doodle-inspired workplace scheduling environment for PALE. App 1.0.0, Core API 1.2.0, contribution contract 0.4.0; developed against public runtime 1.6.0. Independently branded, MIT licensed, with no Doodle account, scraping or external service dependency.

## Run

Use Node 18 or newer (verified with Node 22.16.0). From a public checkout:

```sh
node runtime/web/server.cjs --app meeting-poll --registry apps/meeting-poll/registry.json --run meeting-demo --profile sandbox
node runtime/cli.cjs verify --app apps/meeting-poll --output .artifacts/meeting-poll/common.json
```

The Web Host prints a loopback access link. The default `scenario` policy is read-only; `sandbox` permits all declared business tools. Existing runs preserve their policy. Use a new run or the Infra reset interface to select a different profile.

App-only checks, with no runtime or npm dependencies:

```sh
cd apps/meeting-poll
node --test tests/business.test.cjs
node examples/run.cjs
node scripts/contracts.cjs --check
node scripts/fixtures.cjs --check
```

Standalone MCP service: `node service.cjs --role agent --run meeting-demo --state-dir /tmp/meeting-state`. When outside a public checkout set `PALE_RUNTIME_ROOT` to the pinned public runtime directory and supply the registry described by the runtime guide.

## Workflows and authority

Create a private draft, edit it, publish to 2–12 named participants, submit/withdraw/change availability, confirm an active future slot, reopen with a new deadline, or cancel. There are 2–10 active slots of 15–120 minutes. Removing and replacing a slot creates a new ID; its old votes never become votes for the replacement. Reopening supersedes the prior meeting, preserving history. Cancellation removes active meeting status and is business-idempotent.

The trusted account owner in the loaded seed is the Agent's identity. They can organize some polls and participate in others in the same run. Other participants act through `env.apply_event`, with the same domain rules. Agent tools have no `actor_id`, role or run override. This is the public reference profile, not multi-user production authentication.

Participants only read their own response history and notifications; organizers see all replies for their own polls. Uninvited users and drafts owned by another person are unavailable. Names in `context` are limited to the owner and people in visible meetings. For new task directories, preload at least one relevant poll or define intended initial participants in visible history. Emails and unrelated binding entries are not exposed. Core applies task policies in addition to these domain checks.

## API and state

`tools.json` declares 13 tools: list, get, context, notifications; create, edit, publish, respond, withdraw, finalize, reopen, cancel, notification.read. Writes require Core's observed `expected_version` and retry-stable `request_id`. Core owns storage, locking, epochs/revisions, duplicate receipts, run isolation, seed/reset and snapshots. There is no second database or REST server. The public Web Host bridges its fixed Agent connection to those same tools.

Read results contain `effective_status`: an open poll past its deadline reads as closed and rejects votes immediately, without a scheduler. Reads do not mutate records. The Infra `meeting-poll.close_due` event persists closure and app-local notices; advancing the clock alone deliberately does not dispatch events. Task scripts own event schedules. `examples/scenario.json` demonstrates a participant changing availability. `meeting-poll.action` permits declared domain actions by the supplied bound person, but only on the Infra interface.

Internal notifications are created and delivered synchronously in the same Core business transaction. `delivered` means the app-local inbox record exists, never email delivery. There is no external delivery worker or outbox retry service. Core request/event deduplication prevents duplicate notification effects. Snapshot/reset includes this business state and Core receipts. Core supports snapshot export and reset/load; no separate `env.restore` operation is claimed.

Times are explicit offset-bearing ISO instants normalized to UTC for slots. Node's pinned ICU/tz data interprets IANA zones. Offset-bearing local inputs must match their IANA zone; nonexistent DST times fail, repeated times need an explicit offset. UTC inputs are already unambiguous. The GUI detects ambiguous local candidates and asks which occurrence. Deadlines must precede every active candidate and be in the future when creating/editing/reopening. Past slots cannot be confirmed.

## Fixtures and provenance

Eight deterministic fixture variants cover ordinary coordination, drafts, closed/finalized/cancelled polls, changed replies, cross-zone display and hidden polls. Each has four bound synthetic people, two polls and four slots. `fixtures/binding.json` and `policies.json` are reusable; a Task may replace all history with its own schema-valid seed. Only `minimal.json` is the default baseline. Data and UI text are original synthetic content, with no collected images or private data. Doodle's public help pages are interaction references. Reference screenshots are separate review evidence outside the runtime package.

Reused shared contracts, service launcher and the app-only schema validator originate from PALE under MIT; domain code, fixtures and GUI were developed with AI assistance. Human provenance/realism review remains distinct from automated checks.

## Limitations

No recurring meetings, public anonymous links, participant-list changes after publication, real Mail/Calendar integration, automatic scheduling, attachments or remote production authentication. The existing public Host has one fixed account per process. Model-agent trials, independent human reproduction and maintainer plan/implementation acceptance are separate from deterministic or browser automation evidence. See `VALIDATION.md` for actual evidence and gaps.

## Full-window evaluation dataset

See [evaluation data](evaluation/README.md) for the separately delivered 24 monthly partitions, 192 polls, provenance, UTC date-field mapping, reproducible monthly report and real MCP load/query/reset commands. Small smoke fixtures do not substitute for that dataset. The [delivery evidence index](../../docs/evidence/meeting-poll/README.md) links ordered browser screenshots, raw checks and model trials.
