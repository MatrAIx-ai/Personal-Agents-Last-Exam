# TransitWallet v0.1.0 delivery evidence

Maintainer: Hanson Tang (@hansontang). Environment PR #149, approved proposal `9029d78740afad423db6a1bc379c254ce2fe6e0c`; proposal blob `8f208c19f6577dd2df16b3a9a82f0728d445e2c3` remains unchanged. Implementation uses public runtime 1.6.0 / Core API 1.2.0. No runtime or validator source changes are included.

## Reproduction and recorded results

Recorded on Windows, Node v18.17.1. These are executed App checks, not Task model evaluations.

```sh
node --test apps/transitwallet/tests/business.test.cjs
node apps/transitwallet/examples/run.cjs
node runtime/build-contracts.cjs --check
node runtime/cli.cjs verify --app apps/transitwallet --output .artifacts/transitwallet-public.json
node apps/transitwallet/tests/runtime.cjs
```

For independent base-runtime verification, use an unchanged public checkout at the approved baseline (runtime source is unchanged between `61b637164e4abddf81536bb48935cdb688a69ff1` and main `a4bce023953061483c41de5a287ba5e43f4a5648`) and invoke its `runtime/cli.cjs verify --app <absolute candidate App directory> --output <report>`. The submitted package is copied by that verifier, rather than substituting a candidate validator. The local reproduction used the separately preserved pristine `.bootstrap/base-check/runtime/cli.cjs` checkout.

| Executed check | Result | Evidence |
| --- | --- | --- |
| Standalone business tests | 40/40 passed | Public verifier's embedded business stage output |
| Standalone complete-trip example | Passed; two completed journeys, net 3600 cents | Public verifier's embedded event-example output |
| Public App verifier | 52/52 passed | [public-runtime.json](transitwallet/public-runtime.json) |
| App-specific real MCP workflow | 93/93 passed | [mcp-workflows.json](transitwallet/mcp-workflows.json) |
| Unchanged independent base-runtime verifier | 52/52 passed | [base-runtime.json](transitwallet/base-runtime.json) |

All three reports identify package SHA256 `344cb4fe76d839422996b15dfa43a46e69b1d94347da4bd91fdb01b059432263`. Reports record actual execution dates separately from scenario time. App-only checks run after copying the exact package without a sibling runtime or installed dependencies; real MCP checks use separate Agent/Infra processes. Source hashes and commands are reproducible, not a production deployment certification.

## Approved deliverables mapped to implementation and tests

| Approved behavior | Delivered interface / evidence | Positive and failure coverage |
| --- | --- | --- |
| Free holds and paid confirmations | 18 typed Agent tools in `apps/transitwallet/tools.json`; business `booking.*` | Free hold, paid debit; close-at-boundary, exhausted capacity, duplicate booking, expired hold, insufficient funds |
| Refund/cancel and modification | Read-only quote, digest/version-bound writes, explicit non-atomic cancel-and-rebook | Full/partial/zero refund; old ledger prefix retained; cutoff refusal; later rebooking failure preserves earlier cancellation; cancellation retires old assistance/designation |
| Performed measurement and assistance | Separate pending requests, source-bound external replies and immutable equipment snapshots | Requested is not performed; wrong source, missing request, stale/cancelled generations, incorrect snapshot, refusal without silent ticket refund |
| Actual journey outcomes | Provider departure and separate arrival phases, stored physical snapshot/failure reasons | Successful complete journey; narrow vehicle, changed equipment, service outage, unready user, premature arrival and wrong departure time |
| Runtime-created record matching | Public snapshot-based prepare/apply adapter in `examples/actor-driver.cjs` | Capture exact returned generation; cancel/recreate cannot retarget; no pending action emits no reply; reset invalidates prepared scope |
| Deadline and capacity behavior | Pure predicates on Core-supplied virtual time | Idle `env.advance_time` expires hold/releases effective capacity without mutating raw history; writes enforce the same exclusive cutoffs |
| Real role, retry and concurrency boundary | Unchanged Core supplies MCP/persistence/versions/locking | Agent denied all seven management operations; exact original retry deduplicates; changed reuse conflicts; two real writers yield one commit and one stale rejection |
| Task-specific history, accounts and reset | Three account seeds and typed seed/model checks | Explicit binding required for account change; loaded Sam history persists across operations and reset; separate run retains its own original data |
| Dataset and package independence | 15 original business objects in baseline seed, three owner/equipment variants, empty asset catalog and provenance | Duplicate IDs/selectors, foreign ownership, inconsistent financial/physical history rejected; independent base verifier accepts the same package hash |

All operations return Core's committed/read receipt and version. Business history records ordered operation/object/source correlations; financial entries retain original call IDs; reply/departure/arrival records retain source event IDs. A successful request acknowledgement does not stand for physical work or travel. A failed physical boarding is a committed business outcome, not an infrastructure fault counted as model difficulty.

## Scope and remaining review

The App is MCP-only and has no required cross-App service. The reservation wallet is not Hopline's fare card. No live transit/payment, group booking, atomic ticket exchange, transferred assistance, GUI, outgoing messages or automatic post-travel compensation is implemented. Preview/confirm does not establish human consent or enforce every personal spending/retention rule. The Task owns actual actor behavior and scenario scheduling; the App supplies a public adapter, not a hidden simulator or global scheduler.

Reset is local to the App instance and restores the latest loaded seed/time; export evidence before discarding receipts. The code/package/data are original synthetic work or documented public packaging/contract reuse; no credentials or private accounts are used.

The full repository-wide reference suite was not rerun for this App-only change. Required CI results will be linked on this exact PR head after upload. Human fixture realism/provenance review, independent maintainer acceptance and merge remain open. No official model rollout, task qualification, accepted contribution or authorship eligibility is claimed by these automated results.
