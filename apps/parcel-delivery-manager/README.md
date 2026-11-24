# Parcel Delivery Manager

Recipient-facing parcel management for a fictional carrier, built as a PALE App package (version 0.1.0, Core API 1.2.0, public runtime 1.6.0). It covers changing home delivery, redirecting to a pickup point, authorizing another collector, and recovering from failed deliveries or expiring pickups. Approved design: [proposals/environment/parcel-delivery-management.md](../../proposals/environment/parcel-delivery-management.md) (PR MatrAIx-ai/Personal-Agents-Last-Exam#101).

> **Status: in progress.** W1 (change home delivery) and W2 (redirect to a pickup point) are implemented and tested. W3 (authorize another collector), W4 (pickup and failed-delivery deadlines, returns) and the Web App are next; `grant.*` tools, the `pickup` / `failure_action` deadlines and `parcel.return_completed` currently return `not_implemented`.

## Run locally

Node.js 18+; no package install, account or remote service. From this folder:

```sh
npm test               # App-only business tests (no runtime needed)
npm run example        # applies examples/scenario.json to the fixture
npm run check:schemas  # generated contracts match scripts/build-schemas.cjs
```

From the repository root, with real Agent and Infra MCP processes on the public runtime:

```sh
npm run app:verify -- --app apps/parcel-delivery-manager --output .artifacts/parcel-delivery-manager.json
node apps/parcel-delivery-manager/tests/mcp/workflows.cjs .artifacts/parcel-mcp-workflows.json
```

`tests/mcp/workflows.cjs` is the only script that needs the runtime (repository checkout or `PALE_RUNTIME_ROOT`). It covers permissions, retries, stale versions, clock-only advances, reset and concurrent handoffs.

## Workflows

| Workflow | Agent tools | Trusted events | Tests |
| --- | --- | --- | --- |
| W1 Change home delivery | `options.get`, `change.preview`, `change.submit`, `change.cancel`, `changes.list` | `change_resolved`, `transit_update`, `delivery_failed`, `delivered`, `deadline_reached` (`hold_end`) | `tests/w1-home-delivery.test.cjs` |
| W2 Redirect to a pickup point | the W1 tools plus `points.list`, `pass.get` | `pickup_ready`, `point_status`, `carrier_relocated`, `collected` | `tests/w2-pickup.test.cjs` |
| W3 Authorize another collector | `collectors.list`, `grants.list`; `grant.*` not implemented yet | `collected` | pending |
| W4 Recover from failure or expiry | W1/W2 tools after a failed delivery or closure | deadlines and returns not implemented yet | pending |

A change is always preview, then submit with the returned `confirmation`, then a carrier decision event. A submitted request is `pending` and changes nothing; only an `applied` decision replaces the delivery plan and increments `plan.revision`. Arrival at a pickup point (`pickup_ready`) starts a new pickup epoch, sets its deadline once and issues the recipient's pass. Leaving a pickup arrangement ends its readiness and passes.

## Contracts

`scripts/build-schemas.cjs` is the single source for `tools.json`, `schemas/seed.schema.json` and `schemas/events.schema.json`; edit it and run `npm run build:schemas`. The other files in `schemas/` are copies of public runtime contracts maintained by `runtime/build-contracts.cjs`.

- **Acting person.** Each run has one Infra-selected account (`account_id`, `owner_person_id`). The seed holds the carrier ledger for the scenario; tools filter it by the acting person. Recipients see their parcels; a delegate sees only the collection details of parcels they are currently authorized for. Unknown and unauthorized parcels both return `not_found`.
- **Physical state** (`in_transit`, `out_for_delivery`, `attempt_failed`, `at_pickup`, `delivered`, `collected`, `returning`, `returned`) changes only through trusted Infra events. Agent tools change requests and authorizations, never physical progress.
- **Time.** Business logic uses `ctx.virtual_now`; events use their `at`. Validity is `now < expires_at`, so an action exactly at a deadline fails. Service days (`delivery_date`, `hold_until`) are calendar days in `carrier.time_zone`; pickup hours use each point's own zone.
- **Deadline passed, event not yet applied.** Infra can advance the clock without running any handler (`env.advance_time`). In that window the parcel's status and records stay as they are and reads report the deadline as passed. Passes stop being valid and governed requests fail with `deadline_passed` or `cutoff_passed`. Only the trusted `parcel.deadline_reached` event changes the parcel.
- **Object permissions.** Tools that act on one object take it as `id` (a parcel, or the change/grant for `change.cancel` / `grant.revoke`), so a Task policy can limit a tool to specific objects with Core's standard `ids` constraint.
- **Error codes.** Business refusals use specific codes, for example `change_pending`, `cutoff_passed`, `deadline_passed`, `not_permitted`, `restricted_destination`, `point_closed`, `stale_confirmation` and `too_late`. A refused call or event changes nothing.

## Limitations

One synthetic carrier with domestic parcels and fixture-verified addresses. No live carrier or merchant, identity-document checks, payments, routing optimization or cross-App messaging. Data is synthetic; public carrier help pages were used only as workflow references.
