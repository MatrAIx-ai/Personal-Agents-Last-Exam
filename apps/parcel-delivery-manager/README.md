# Parcel Delivery Manager

Recipient-facing parcel management for a fictional carrier, built as a PALE App package (version 0.1.0, Core API 1.2.0, public runtime 1.6.0). It covers changing home delivery, redirecting to a pickup point, authorizing another collector, and recovering from failed deliveries or expiring pickups. Approved design: [proposals/environment/parcel-delivery-management.md](../../proposals/environment/parcel-delivery-management.md) (PR MatrAIx-ai/Personal-Agents-Last-Exam#101).

> **Status: skeleton under construction.** Contracts, fixtures, record invariants and read operations are in place. Previews, submissions, cancellations, grants, the remaining carrier events and the Web App are the next implementation steps; those tools currently return `not_implemented`.

## Run locally

Node.js 18+; no package install, account or remote service. From this folder:

```sh
npm test            # App-only business tests
npm run example     # applies examples/scenario.json to the fixture
npm run check:schemas
```

From the repository root, run the public verifier with real Agent/Infra MCP connections:

```sh
npm run app:verify -- --app apps/parcel-delivery-manager --output .artifacts/parcel-delivery-manager.json
```

## Contracts

`scripts/build-schemas.cjs` is the single source for `tools.json`, `schemas/seed.schema.json` and `schemas/events.schema.json`; edit it and run `npm run build:schemas`. The other files in `schemas/` are copies of public runtime contracts maintained by `runtime/build-contracts.cjs`.

- **Acting person.** Each run has one Infra-selected account (`account_id`, `owner_person_id`). The seed holds the carrier ledger for the scenario; tools filter it by the acting person. Recipients see their parcels; a delegate sees only the collection details of parcels they are currently authorized for. Unknown and unauthorized parcels both return `not_found`.
- **Physical state** (`in_transit`, `out_for_delivery`, `attempt_failed`, `at_pickup`, `delivered`, `collected`, `returning`, `returned`) changes only through trusted Infra events. Agent tools change requests and authorizations, never physical progress.
- **Time.** Business logic uses `ctx.virtual_now`; events use their `at`. Validity is `now < expires_at`. Reads never write state, so a deadline that has passed by the clock is reported as passed but only the trusted `parcel.deadline_reached` event changes the parcel.

## Limitations

One synthetic carrier with domestic parcels and fixture-verified addresses. No live carrier or merchant, identity-document checks, payments, routing optimization or cross-App messaging. Data is synthetic; public carrier help pages were used only as workflow references.
