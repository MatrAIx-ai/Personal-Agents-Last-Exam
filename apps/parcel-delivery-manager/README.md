# Parcel Delivery Manager

Recipient-facing parcel management for a fictional carrier, built as a PALE App package (version 0.1.0, Core API 1.2.0, public runtime 1.6.0). It covers changing home delivery, redirecting to a pickup point, authorizing another collector, and recovering from failed deliveries or expiring pickups. Approved design: [proposals/environment/parcel-delivery-management.md](../../proposals/environment/parcel-delivery-management.md) (PR MatrAIx-ai/Personal-Agents-Last-Exam#101).

> **Status: in progress.** The four workflows W1–W4 are implemented as Agent MCP tools and trusted events, with App-only tests and a real-MCP check. Still to do: the Web App on the shared Web Host, the full fixture catalog with eight seed scenarios, Agent trials and independent reproduction. `app.json` declares `ui: none` until the Web App is delivered.

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

`tests/mcp/workflows.cjs` is the only script that needs the runtime (repository checkout or `PALE_RUNTIME_ROOT`). It covers permissions, retries, stale versions, clock-only advances, separate runs for the collector and an unauthorized person, reset from a seed with a pending request and a live grant, returns, and two collectors racing for one parcel.

## Workflows

| Workflow | Agent tools | Trusted events | Tests |
| --- | --- | --- | --- |
| W1 Change home delivery | `options.get`, `change.preview`, `change.submit`, `change.cancel`, `changes.list` | `change_resolved`, `transit_update`, `delivered`, `deadline_reached` (`hold_end`) | `tests/w1-home-delivery.test.cjs` |
| W2 Redirect to a pickup point | the W1 tools plus `points.list`, `pass.get` | `pickup_ready`, `point_status`, `relocated`, `collected` | `tests/w2-pickup.test.cjs` |
| W3 Authorize another collector | `collectors.list`, `grant.preview`, `grant.create`, `grant.revoke`, `grants.list`, `pass.get` | `collected` | `tests/w3-delegation.test.cjs` |
| W4 Recover from failure or expiry | the W1–W3 tools after a failure or closure | `delivery_failed`, `point_status`, `deadline_reached` (`failure_action`, `pickup`), `return_completed` | `tests/w4-recovery.test.cjs` |

Tool names are prefixed with `parcel-delivery-manager.` and event operations with `carrier.`. `shipments.list`, `shipments.get` and `notices.list` serve every workflow.

- **Changes** are preview, then submit with the returned `confirmation`, then a carrier decision event. A submitted request is `pending` and changes nothing. Only an `applied` decision replaces the delivery plan and increments `plan.revision`. Each parcel has one effective plan and at most one pending request.
- **Pickup.** Arrival (`pickup_ready`) starts the next pickup epoch, sets its deadline once and issues the recipient's own pass. A repeated arrival cannot extend the deadline. Leaving a pickup arrangement (plan change, relocation, return or handoff) ends its readiness and every pass and authorization issued for it.
- **Authorizations** are also preview then create. Only the recipient can authorize, replace or revoke, and only a saved collector can be named. An authorization cannot outlast the pickup deadline or the policy maximum. The collector gets their own pass for that one parcel, sees only its pickup details, and cannot change the parcel or authorize anyone else.
- **Handoff** (`collected`) checks readiness, point, pickup epoch, opening hours, deadline, the holder's current pass and any authorization behind it. A failed check consumes nothing. The first valid handoff closes the parcel and invalidates every other pass.
- **Expiry.** `deadline_reached` for `pickup` or `failure_action` starts return processing: the pending request is closed with `return_started`, passes and authorizations end, and the parcel accepts no change and no event except `return_completed`.

## Contracts

`scripts/build-schemas.cjs` is the single source for `tools.json`, `schemas/seed.schema.json` and `schemas/events.schema.json`; edit it and run `npm run build:schemas`. The other files in `schemas/` are copies of public runtime contracts maintained by `runtime/build-contracts.cjs`.

- **Acting person.** Each run has one Infra-selected account (`account_id`, `owner_person_id`), validated against the trusted binding. The seed holds the carrier ledger for the scenario; tools filter it by the acting person. No tool argument can name another person or account. To check the recipient, a collector and an unauthorized person, Infra loads the same ledger into separate runs with the matching account; `fixtures/binding.json` lists three example accounts. Core requires an explicit binding when a load changes the account.
- **Access.** Recipients see their own parcels. A collector sees only the pickup details of a parcel while their authorization is current: no tracking number, sender, address, plan, timeline or other parcels. Unknown and unauthorized parcels both return `not_found`. Notices follow the same rule: they are readable only while their parcel is.
- **Physical state** (`in_transit`, `out_for_delivery`, `attempt_failed`, `at_pickup`, `delivered`, `collected`, `returning`, `returned`) changes only through trusted Infra events. Agent tools change requests and authorizations, never physical progress. An event that does not match the current plan revision, pickup epoch or status is rejected whole.
- **Time.** Business logic uses `ctx.virtual_now`; events use their `at`. Validity is `now < expires_at`, so an action exactly at a deadline fails. Service days (`delivery_date`, `hold_until`) are calendar days in `carrier.time_zone`; pickup hours use each point's own zone.
- **Deadline passed, event not yet applied.** Infra can advance the clock without running any handler (`env.advance_time`). In that window the parcel's status and records stay as they are and reads report the deadline as passed (`deadlines[].passed`, `valid_now`). Passes and authorizations stop working, and governed requests fail with `deadline_passed` or `cutoff_passed`. Only the trusted `carrier.deadline_reached` event changes the parcel, and it is rejected before its deadline.
- **Object permissions.** Tools that act on one object take it as `id` (a parcel, or the change/grant for `change.cancel` / `grant.revoke`), so a Task policy can limit a tool to specific objects with Core's standard `ids` constraint.
- **Error codes.** Business refusals use specific codes, for example `change_pending`, `cutoff_passed`, `deadline_passed`, `return_started`, `not_permitted`, `restricted_destination`, `point_closed`, `unknown_collector`, `expiry_out_of_range`, `already_authorized`, `grant_not_active`, `stale_confirmation` and `too_late`. A refused call or event changes nothing.
- **Seeds.** Parcels are the primary records (`records` / `objects`), so a Task can load history without a resource bundle. Loaded history must be coherent: for example a ready parcel carries its pickup record and the recipient's active pass, and an active authorization matches the current pickup and has one active pass. `validateSeed` rejects anything else.

## Limitations

One synthetic carrier with domestic parcels and fixture-verified addresses. No live carrier or merchant, identity-document checks, payments, routing optimization or cross-App messaging. A pass is a synthetic business record, not an authentication token. Data is synthetic; public carrier help pages were used only as workflow references.
