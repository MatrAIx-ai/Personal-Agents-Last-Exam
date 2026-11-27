# Parcel Delivery Manager

Recipient-facing parcel management for a fictional carrier, built as a PALE App package (version 0.1.0, Core API 1.2.0, public runtime 1.6.0). It covers changing home delivery, redirecting to a pickup point, authorizing another collector, and recovering from failed deliveries or expiring pickups. Approved design: [proposals/environment/parcel-delivery-management.md](../../proposals/environment/parcel-delivery-management.md) (PR MatrAIx-ai/Personal-Agents-Last-Exam#101).

> **Status: first runnable version (v1), under implementation review.** The four workflows W1–W4 are implemented as Agent MCP tools, trusted events and a business Web App on the shared Web Host, with the data catalog, App-only tests, a real-MCP check and browser acceptance. Evidence, the changes since the approved proposal and the remaining work are in [docs/validation.md](docs/validation.md); sources and licenses are in [PROVENANCE.md](PROVENANCE.md). This is not an accepted contribution until a maintainer accepts and merges it.

## Run locally

Node.js 18+; no package install, account or remote service. From this folder:

```sh
npm test               # App-only business tests (no runtime needed); includes corner cases and a short random walk
npm run example        # applies examples/scenario.json to the fixture
npm run check:schemas  # generated contracts match scripts/build-schemas.cjs
npm run check:fixtures # catalog files match scripts/build-fixtures.cjs
FUZZ_RUNS=30 FUZZ_STEPS=300 node --test tests/fuzz.test.cjs   # optional deeper random search, about five minutes
npm run test:mutation  # optional: changes the business code one place at a time and reports what the tests miss, about four minutes
```

From the repository root, with real Agent and Infra MCP processes on the public runtime:

```sh
npm run app:verify -- --app apps/parcel-delivery-manager --output .artifacts/parcel-delivery-manager.json
node apps/parcel-delivery-manager/tests/mcp/workflows.cjs .artifacts/parcel-mcp-workflows.json
```

`tests/mcp/workflows.cjs` needs the runtime (repository checkout or `PALE_RUNTIME_ROOT`). It covers permissions, retries, stale versions, clock-only advances, separate runs for the collector and an unauthorized person, reset from a seed with a pending request and a live grant, returns, repeated arrivals, collection exactly at the deadline, and two collectors racing for one parcel.

## Web App

The business page is served by the shared Web Host; this package supplies only `gui/index.html` and `gui/src/app.js`, declared with the `pale.web` extension in `contribution/gui.json`. From the repository root:

```sh
node runtime/web/server.cjs --app parcel-delivery-manager --registry apps/parcel-delivery-manager/web.registry.json --run web-demo --profile sandbox
node apps/parcel-delivery-manager/tests/web/acceptance.cjs .artifacts/parcel-web   # browser acceptance; needs Playwright
```

`web.registry.json` lists only this package, so the root `apps.registry.json` is unchanged. The page and MCP use the same App state. See [gui/README.md](gui/README.md) for the six views, behaviour and limits.

## Workflows

| Workflow | Agent tools | Trusted events | Tests |
| --- | --- | --- | --- |
| W1 Change home delivery | `options.get`, `addresses.list`, `change.preview`, `change.submit`, `change.cancel`, `changes.list` | `change_resolved`, `transit_update`, `delivered`, `deadline_reached` (`hold_end`) | `tests/w1-home-delivery.test.cjs` |
| W2 Redirect to a pickup point | the W1 tools plus `points.list`, `pass.get` | `pickup_ready`, `point_status`, `relocated`, `collected` | `tests/w2-pickup.test.cjs` |
| W3 Authorize another collector | `collectors.list`, `grant.preview`, `grant.create`, `grant.revoke`, `grants.list`, `pass.get` | `collected` | `tests/w3-delegation.test.cjs` |
| W4 Recover from failure or expiry | the W1–W3 tools after a failure or closure | `delivery_failed`, `point_status`, `deadline_reached` (`failure_action`, `pickup`), `return_completed` | `tests/w4-recovery.test.cjs` |

Tool names are prefixed with `parcel-delivery-manager.` and event operations with `carrier.`. `shipments.list`, `shipments.get` and `notices.list` serve every workflow. Every workflow is available both through MCP and in the Web App.

- **Changes** are preview, then submit with the returned `confirmation`, then a carrier decision event. A submitted request is `pending` and changes nothing. Only an `applied` decision replaces the delivery plan and increments `plan.revision`. Each parcel has one effective plan and at most one pending request.
- **Pickup.** Arrival (`pickup_ready`) starts the next pickup epoch, sets its deadline once and issues the recipient's own pass. A repeated arrival cannot extend the deadline. Leaving a pickup arrangement (plan change, relocation, return or handoff) ends its readiness and every pass and authorization issued for it.
- **Authorizations** are also preview then create. Only the recipient can authorize, replace or revoke, and only a saved collector can be named. An authorization cannot outlast the pickup deadline or the policy maximum. The collector gets their own pass for that one parcel, sees only its pickup details, and cannot change the parcel or authorize anyone else.
- **Handoff** (`collected`) checks readiness, point, pickup epoch, opening hours, deadline, the holder's current pass and any authorization behind it. A failed check consumes nothing. The first valid handoff closes the parcel and invalidates every other pass.
- **Expiry.** `deadline_reached` for `pickup` or `failure_action` starts return processing: the pending request is closed with `return_started`, passes and authorizations end, and the parcel accepts no change and no event except `return_completed`.

## Data catalog

`fixtures/minimal.json` is the package's default seed (3 parcels), used by the verifier and the tests. The catalog adds 24 parcels in eight seed scenarios under `fixtures/seeds/`. They share one directory: six identities (three recipients, two collectors, one unauthorized person), ten addresses of which nine are verified, six pickup points and six policy profiles. `fixtures/catalog.json` lists the directory and every parcel; `fixtures/seeds/index.json` lists the seeds, their clocks and who can be loaded for each.

| Seed | Recipient | Clock (UTC) | Workflows | Starting situation |
| --- | --- | --- | --- | --- |
| `01-normal-delivery` | Maya Chen | 2026-03-02 14:00 | W1 | One parcel on its way home with every change still open, one delivered in January after an applied date change, and another recipient's parcel in the same ledger. |
| `02-pending-changes` | Idris Bello | 2026-03-03 15:00 | W1, W2 | Two parcels each with a request the carrier has not decided, and a collected parcel whose history holds a rejected, a withdrawn and an applied request. |
| `03-restricted-changes` | Chloé Tremblay | 2026-03-03 16:00 | W1, W2 | Three parcels under restrictive profiles: signature (no address change or hold, counters only; one date change already applied), bulky (home delivery only; an address change the carrier declined) and recipient-only with its change cutoff already passed. |
| `04-redirect-readiness` | Maya Chen | 2026-03-03 15:00 | W2 | One parcel with an applied redirect that has not arrived yet, one ready at a counter and one sent straight to a step-free locker; each ready parcel has the recipient's pass. |
| `05-delegation` | Maya Chen | 2026-03-03 15:00 | W3 | A ready parcel with a current authorization for one collector after an earlier one was revoked, a signature parcel that cannot be delegated, and a February parcel collected by an authorized collector. |
| `06-failed-delivery` | Idris Bello | 2026-03-03 15:00 | W4 | Two failed deliveries waiting for the recipient, one with a day and a half left and a signature parcel with six hours left, plus a February failure that was recovered by redelivery. |
| `07-closure-relocation` | Chloé Tremblay | 2026-03-03 16:00 | W2, W3, W4 | A ready parcel, with an authorized collector, at a point that has closed with its deadline unchanged, and a parcel the carrier is moving to another point after its first pass was invalidated. |
| `08-expiry-return` | Maya Chen | 2026-03-04 12:00 | W2, W4 | A ready parcel with three hours left, one whose pickup deadline has passed by the clock with no deadline event applied yet, one being returned after expiry, and a January parcel returned after an unanswered failed delivery. |

| Profile | Name | Move date by up to | Address change | Hold | Pickup redirect | Delegation | Change cutoff | Pickup window | After a failed delivery |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pol-standard` | Standard residential | 5 d | yes | 7 d | counter, locker | 72 h | 12 h | 72 h | 48 h |
| `pol-signature` | Signature required | 3 d | no | no | counter | no | 24 h | 48 h | 24 h |
| `pol-express` | Express | 2 d | no | no | counter, locker | 24 h | 4 h | 24 h | 24 h |
| `pol-bulky` | Bulky item, home delivery only | 7 d | yes | 5 d | no | no | 24 h | 72 h | 72 h |
| `pol-compact` | Compact parcel, locker eligible | 5 d | yes | 7 d | locker | 120 h | 12 h | 120 h | 48 h |
| `pol-recipient-only` | Recipient only, fixed delivery | 2 d | no | no | no | no | 48 h | 48 h | 24 h |

**Load a seed.** List the seeds, or load one into a run through the Infra MCP connection:

```sh
node apps/parcel-delivery-manager/scripts/load-seed.cjs                                         # list seeds
node apps/parcel-delivery-manager/scripts/load-seed.cjs 05-delegation --run demo                # as the recipient
node apps/parcel-delivery-manager/scripts/load-seed.cjs 05-delegation --run demo-alex --actor person-alex   # same ledger, as a collector
```

Then start the Web App on that run, or drive it by MCP. A Task runner does the same with `env.load_seed`: the seed file as `data`, `fixtures/binding.json` as `binding` and the seed's `virtual_now`. Records carry no account, so the same ledger loads for another person by setting only `account_id` and `owner_person_id`.

**How the catalog is made.** `scripts/build-fixtures.cjs` is the single source. It holds the directory and, for each seed, a time-ordered script. Every history is produced by replaying this App's own operations and trusted events, so each stored request, pass, authorization and notice is a state the App can reach. `npm run build:fixtures` regenerates the files and the tests fail if they differ. There is no random input.

- **Dates.** Every record is dated on or after 2026-01-01 and nothing is recorded after its seed's clock. A Task can load its own history with its own dates.
- **Example schedules.** `fixtures/seeds/schedules/<seed>.json` holds a few well-formed events that apply, in order, to the untouched seed. They are templates. Events name the plan revision and pickup epoch, so a Task that changes a parcel writes its own events.
- **No tasks or answers.** A seed is only a starting situation. Preferences, goals, user history and grading belong to the Task.
- **Synthetic only.** People, addresses, senders and tracking numbers are invented; the addresses are not deliverable. There are no images or other media.

## Contracts

`scripts/build-schemas.cjs` is the single source for `tools.json`, `schemas/seed.schema.json` and `schemas/events.schema.json`; edit it and run `npm run build:schemas`. The other files in `schemas/` are copies of public runtime contracts maintained by `runtime/build-contracts.cjs`.

- **Acting person.** Each run has one Infra-selected account (`account_id`, `owner_person_id`), validated against the trusted binding. The seed holds the carrier ledger for the scenario; tools filter it by the acting person. No tool argument can name another person or account. To check the recipient, a collector and an unauthorized person, Infra loads the same ledger into separate runs with the matching account; `fixtures/binding.json` lists one account for each of the six catalog identities. Core requires an explicit binding when a load changes the account.
- **Access.** Recipients see their own parcels. A collector sees only the pickup details of a parcel while their authorization is current: no tracking number, sender, address, plan, timeline or other parcels. Unknown and unauthorized parcels both return `not_found`. Notices follow the same rule: they are readable only while their parcel is.
- **Physical state** (`in_transit`, `out_for_delivery`, `attempt_failed`, `at_pickup`, `delivered`, `collected`, `returning`, `returned`) changes only through trusted Infra events. Agent tools change requests and authorizations, never physical progress. An event that does not match the current plan revision, pickup epoch or status is rejected whole.
- **Time.** Business logic uses `ctx.virtual_now`; events use their `at`. Validity is `now < expires_at`, so an action exactly at a deadline fails. Service days (`delivery_date`, `hold_until`) are calendar days in `carrier.time_zone`; pickup hours use each point's own zone. An opening-hours entry may close at `24:00`, the end of the day, so a point can be open around the clock or past midnight (as two entries). Times may be written with `Z` or a UTC offset. If a run's clock is earlier than a parcel's last update, the parcel can be read but nothing can be requested for it (`invalid_time`).
- **Deadline passed, event not yet applied.** Infra can advance the clock without running any handler (`env.advance_time`). In that window the parcel's status and records stay as they are and reads report the deadline as passed (`deadlines[].passed`, `valid_now`). Passes and authorizations stop working, and governed requests fail with `deadline_passed` or `cutoff_passed`. Only the trusted `carrier.deadline_reached` event changes the parcel, and it is rejected before its deadline.
- **Object permissions.** Tools that act on one object take it as `id` (a parcel, or the change/grant for `change.cancel` / `grant.revoke`), so a Task policy can limit a tool to specific objects with Core's standard `ids` constraint.
- **Error codes.** Business refusals use specific codes, for example `change_pending`, `cutoff_passed`, `deadline_passed`, `return_started`, `not_permitted`, `restricted_destination`, `point_closed`, `unknown_collector`, `expiry_out_of_range`, `already_authorized`, `grant_not_active`, `stale_confirmation` and `too_late`. A refused call or event changes nothing. `options.get` offers a kind of change only when something can be chosen for it; otherwise it gives `no_available_date` or `no_eligible_destination`.
- **Seeds.** A seed is one carrier ledger plus the acting account. Parcels are the primary records (`records` / `objects`), so a Task can load history without a resource bundle. Loaded history must be coherent: for example a ready parcel carries its pickup record and the recipient's active pass, an active authorization matches the current pickup and has one active pass, tracking numbers are unique, and a pending request is based on the current plan and names a destination that exists. `validateSeed` rejects anything else; `tests/corner-cases.test.cjs` lists every rule. Names in the binding may be missing, empty or long; the App shows none or the first 120 characters.

## Limitations

One synthetic carrier with domestic parcels and fixture-verified addresses. No live carrier or merchant, identity-document checks, payments, routing optimization or cross-App messaging. A pass is a synthetic business record, not an authentication token. Data is synthetic; public carrier help pages were used only as workflow references.
