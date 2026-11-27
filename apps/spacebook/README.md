# SpaceBook

A synthetic single-office room and equipment reservation App. Original code and records use MIT; shared PALE contracts, launcher and schema-validator patterns retain the repository's MIT provenance. Envoy is a workflow reference only. No external service or account is required.

## Run

Use Node 18+ (reproduction: Node 22.16.0) and the public runtime 1.6.0 / Core API 1.2.0.

```sh
node runtime/web/server.cjs --app spacebook --registry apps/spacebook/registry.json --run spacebook-demo --profile sandbox
node --test apps/spacebook/tests/business.test.cjs
node runtime/cli.cjs verify --app apps/spacebook --output .artifacts/spacebook/common.json
```

Open the access link printed by the Host. The scenario profile permits reads; sandbox enables declared writes. Infra owns the run clock, seed loading, reset and external events. The five-minute hold uses virtual time, not the browser clock. GUI and MCP share authoritative state.

Each booking is one room plus up to two compatible equipment units. A bundle is allocated atomically. Replacement validates first and commits once; failure preserves the previous allocation. Future outages invalidate holds and disrupt bookings, releasing entire bundles. Unblocking does not reinstate bookings. A replayed write returns its historical receipt; read the booking again to learn its current status.

Only the bound employee can read or change their bookings and notices. Other employees' activity appears as anonymous busy intervals. No mail, Calendar integration, standalone loans, payments, recurrence, check-in, in-progress outage handling or production remote authentication is included.

Implementation evidence is tracked separately from runtime fixture assets. Human scope, provenance and usability acceptance remains required.

## Tests and evidence

See [VALIDATION.md](VALIDATION.md) for every reproduction command and the [review evidence index](../../docs/evidence/spacebook/README.md) for reports, GUI sequences and retained failures. `src/domain.cjs` owns business transitions; `src/model.cjs` validates records and allocation invariants. `scripts/contracts.cjs` generates App-owned tool/schema declarations. Shared schema copies and the App-only validator come from the public MIT-licensed PALE reference.

## Synthetic evaluation data

`datasets/evaluation.json` is a wholly synthetic fictional-office dataset spanning January 2025–December 2026: 480 hold lifecycles, including expiry/release, confirmed reservations, cancellations, disruption and replacement. Replacement creates a second linked booking, so booking count is not lifecycle count. The deterministic generator varies monthly volume, employees, rooms, equipment, meeting duration and outcome. `datasets/coverage.json` reports represented activity dates in `America/Los_Angeles`, hashes and gaps; weekends and unbooked days are not filled with fake activity. The eight small fixtures under `fixtures/scenarios/` are separate from this dataset.

```sh
node apps/spacebook/scripts/dataset.cjs --check
node apps/spacebook/tests/dataset.cjs
node apps/spacebook/scripts/select-history.cjs 2026-01-01T08:00:00Z /tmp/spacebook-history.json
```

The full evaluation dataset is loaded at `2027-01-01T08:00:00Z` in the loading demonstration. Do not load its future records as pre-session history. The selection script keeps complete lifecycles whose history and interval end precede the supplied cutoff; it omits in-progress chains rather than fabricating a past version. Task authors can then add their own scenario records/events. Load through Infra `env.load_seed` with the selected `virtual_now`, observed version, account binding and a dataset bundle whose expected record count matches the selected data; `tests/dataset.cjs` demonstrates that exact procedure. `env.reset` restores that loaded baseline, not necessarily the package's minimal fixture.

All people, resource names, booking titles and records are synthetic. Public Envoy documentation supplies interaction references only. Product screenshots are attributed review artifacts outside the runtime package and are not MIT-licensed App assets. Approval of the synthetic-only approach is recorded by the reviewer on PR #289.
