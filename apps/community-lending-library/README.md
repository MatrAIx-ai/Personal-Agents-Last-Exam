# Community Lending Library v1

Implementation and ongoing maintenance: Xiao Cui (@2018cx). The App follows
[PALE #50](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/50) at
approved proposal revision `8dc6998b3520e093e17f73aa4263dedd36be8b98`.
It has no dependency other than Node 18+ and PALE’s official public runtime
1.6.0 / Core API 1.2.0, baseline `61b637164e4abddf81536bb48935cdb688a69ff1`.
No network services, fees, physical handovers, external messages or mirrors
of proprietary myTurn code/assets.

## Verify

From this App directory, set `PALE_RUNTIME_ROOT` to the matching public runtime:

```sh
node --test tests/business.test.cjs
node "$PALE_RUNTIME_ROOT/cli.cjs" verify --app "$PWD" --output /tmp/lending-verify.json
node tests/core.cjs
node tests/host.cjs
```

For a local browser run, put this App at `apps/community-lending-library` in
a disposable checkout of the public runtime. From its root run:

```sh
printf '%s\n' '{"schema_version":1,"initial_time":"2026-12-10T09:00:00+08:00","apps":[{"app_id":"community-lending-library","version":"0.1.0","path":"apps/community-lending-library"}]}' > lending-local.registry.json
node runtime/web/server.cjs --app community-lending-library --registry lending-local.registry.json --profile sandbox --run lending-demo --state-dir /tmp/lending-demo-state
```

Open the URL printed by the host. Catalog, Item, Holds and queue, Current loans,
and Activity and receipts share the fixed Agent MCP state. The `scenario`
profile is read only; `sandbox` enables the business writes. Tools use the
`community-lending-library.` prefix:

| View / purpose | Reads | Writes |
| --- | --- | --- |
| Catalog / item | `search_items`, `get_item` | `confirm_hold`, `join_queue` |
| Holds and queue | `list_holds` | `cancel_hold`, `leave_queue`, `request_checkout` |
| Loans / renew | `list_loans`, `preview_renewal` | `confirm_renewal`, `request_return` |
| Activity and receipts | `list_activity` | `cancel_request` |

All writes require a fresh Core `expected_version` and stable `request_id`.
The same payload and ID replay the original committed receipt instead of a
duplicate transition. Discarding an unconfirmed UI preview does not invoke a
write. No alternative item is selected implicitly. Queue views expose count
and the viewer’s position, never another borrower’s identity.

## Task-controlled fixtures, clock and receipts

Infra invokes `env.load_seed` with a matching member/account binding, seeded
data, and explicit `virtual_now` corresponding to the seed’s
`materialized_at`. Task authors may supply custom fictional members,
bindings, dated loans/holds and attempt histories under the checked schema.
The default demo has eight ordinary item types, twelve copies, four members,
and dated state from December 2026. M1 has hold H1 on C4; seeded attempt 1 was
cancelled, so the next checkout for M1 / C4 is attempt 2.

Only Infra invokes `env.apply_event`, `env.advance_time`, `env.snapshot` or
`env.reset`. Events use the latest snapshot version **outside** the event
object. Desk outcomes match the exact
`{operation,member_id,copy_id,attempt,outcome}` payload. An unmatched, terminal
or ineligible outcome never reroutes to another attempt. Desk rejection ends
the matching still-eligible pending attempt without changing custody. The
activity entry preserves the generated attempt ID and applied event ID. A
return changes custody and promotes the queue only when accepted. Same-time
ordering follows the caller’s accepted event sequence and version.

Clock advancement changes no business data. Reads project from `virtual_now`
without committing data; the next successful write/event persists the same
projection. A hold expires exactly at its 24-hour boundary; any promoted hold
starts at that historical boundary, not the later observation time. FIFO means
earliest eligible member, with stable copy ID order. Open overdue loans stay
open and block new checkout/renewal without fines. Renewing adds exactly three
days once, strictly before due and with no other member waiting. Reset restores
the loaded App baseline and clock, clearing Core receipts; the external task
runner controls its own event cursor. No scheduler, cross-App reset or live
desk integration is assumed.

Original App code and synthetic fixtures use MIT as specified in the proposal.
Compatibility envelopes/schemas derived from upstream PALE retain its MIT
notice in `UPSTREAM-MIT-NOTICE`. Human dataset quality review, independent
maintainer reproduction, and final validation/acceptance are not implied by
these local checks.

The six suggested fixture variants are exported by `fixtures/scenarios.cjs`:
happy cycle, FIFO expiry, renewal race, exact desk replay, overdue/maintenance,
and read-only observer. Use `build(name)` to obtain trusted Infra seed data,
binding, policies, clock and profile; do not publish these to the Agent.
The overdue variant intentionally starts its clock after several elapsed days
so it can exercise the derived-state projection before any write.

See [validation evidence](VALIDATION.md) for the checked cases and limits.

## Full-window evaluation data

Load the original fictional evaluation seed with the documented coverage and
commands in [data/README.md](data/README.md). It is separate from the six smoke
presets and covers January 2025 through December 2026. Member-facing views
show item names, friendly copy labels and library-local dates; queue-history
member IDs and renewal event timestamps remain available only through Infra.

[GUI evidence and myTurn reference mapping](evidence/README.md) identify
the scoped differences: no login, fixed one-day holds and simulated desk
outcomes rather than live reservations or handovers.
