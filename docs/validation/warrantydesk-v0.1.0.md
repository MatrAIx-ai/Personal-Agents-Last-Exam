# WarrantyDesk v0.1.0 delivery evidence

Maintainer: Hanson Tang (@hansontang). Environment PR #150; scope approved by Chenngzz in [the plan approval command](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/150#issuecomment-7117730836) at `5dc0234c28627fcbbc0523af141c849da8941ee5`. Proposal blob `0c47dd7bd01093bfe61d3f2807bc06a36382ea6a` is preserved unchanged. The candidate includes no Core/runtime/validator source changes.

## Reproduce the delivered App

Public runtime 1.6.0 / Core API 1.2.0; recorded on Windows, Node v18.17.1. No credentials, real accounts or paid model runs are used.

```sh
node --test apps/warrantydesk/tests/business.test.cjs
node apps/warrantydesk/examples/run.cjs
node runtime/build-contracts.cjs --check
node runtime/cli.cjs verify --app apps/warrantydesk --output .artifacts/warrantydesk-public.json
node apps/warrantydesk/tests/runtime.cjs
```

For independent verification, invoke an unchanged public baseline checkout's `runtime/cli.cjs verify --app <absolute candidate App path> --output <report>`. Local reproduction used the separately preserved pristine `.bootstrap/base-check/runtime/cli.cjs` checkout. Runtime source is unchanged between `61b637164e4abddf81536bb48935cdb688a69ff1` and main `a4bce023953061483c41de5a287ba5e43f4a5648`; the candidate's validator is not substituted for that base.

| Executed check | Result | Report |
| --- | --- | --- |
| Standalone business tests | 48/48 passed | Public verifier's embedded business-stage output |
| Standalone branch example | Normal original return and both withdrawal branches complete | Public verifier's embedded example-stage output |
| Public App verifier | 50/50 passed | [public-runtime.json](warrantydesk/public-runtime.json) |
| App-specific real Agent/Infra MCP workflows | 145/145 passed | [mcp-workflows.json](warrantydesk/mcp-workflows.json) |
| Unchanged independent base-runtime verifier | 50/50 passed | [base-runtime.json](warrantydesk/base-runtime.json) |

All three reports identify exact package SHA256 `f875affe5e5dd90938a263a8bd238151a116ab791726441bf5067e64ec58da39`. They record real execution dates separately from simulated scenario timestamps. Public standalone verification runs the copied App without a runtime sibling or installed dependencies; workflow verification uses real public Core, persisted state and separate stdio clients.

## Approved scope to delivered behavior

| Deliverable | Implementation / observed evidence | Failure/control coverage |
| --- | --- | --- |
| Quoted advance replacement | 16 typed MCP tools; read-only quote and digest/version-checked acceptance; immutable authorization posting | Ineligible remedy, changed quote, duplicate acceptance; two actual writers produce one authorization and one stale rejection |
| Dispatch versus actual delivery | Separate source-bound events and custody history | Delivery without dispatch, wrong replacement serial/source; an undelivered device cannot supply a performed local check |
| Private performed user/IT journal | Exact case/serial/kind/generation; requested participant; typed boolean results only | A request, copied icons and IT completion do not imply an independent login; wrong actors, cancelled generations and undeclared secret-bearing fields reject |
| Performed erasure and historical retention evidence | Successful user erasure reply records first actual wipe time, while all later facts remain | Request alone does not erase; repeated wipes retain the first time; the App does not automatically save a Task's unsafe early erasure |
| Pickup cancel/reschedule | Cancelled original record plus new generation; atomic replacement only after new slot validation | Failed reschedule retains the old booking; exact cancellation cutoff, capacity, wrong serial and old callback cannot collect a new generation |
| Normal original return | Original actually collected, manufacturer receipt recorded, release requested, actual release posted, then case closed | Collection is not receipt; receipt is not financial posting; wrong serial/mode/source preserves case and hold; premature closure fails |
| Withdrawal before dispatch | Cancelled order and pending pickup/checks; no fictitious parcel receipt; actual release and terminal withdrawn | Dispatch after cancellation fails; closure before release fails; caller cannot bypass a locked pickup |
| Withdrawal after dispatch/delivery | Original retained; replacement delivered and actually returned under a separate mode/serial obligation | Old original-return pickup/replies are retired; only the replacement's actual receipt can request settlement |
| Virtual-time deadline behavior | Derived overdue/missed views from Core clock, preserving raw business history | Advancing an idle App creates no charge, release or actual collection; late receipt retains explicit historical lateness |
| Matching dynamic run-created objects | Public snapshot-based prepare/apply actor adapter; retained attempts; bound run/account/epoch | No order/request means no fabricated external completion; cancellation/reschedule and reset invalidate an old prepared callback rather than retarget it |
| Seed/reset and independent account state | Three original seeds; explicit binding/time/history loading; loaded Maya fixture resets correctly | Wrong ownership, duplicate IDs/selectors, incoherent custody/erasure and fabricated financial history reject; separate run retains its own baseline |

See the App README for all operations, transition rules and excluded paths. Public Core owns schemas, identity/policy, persistence, locks, versions, retries and event receipts. App business functions import only Node built-ins and their own modules. A local domain harness is not used as evidence of MCP identity enforcement.

## Boundaries and remaining validation

This is a user-owned coordination workspace, not a manufacturer system with access to bank/employer authentication. User/IT facts stay in a separate source-tagged private journal. There is no outbound message delivery, live bank/provider, real credential handling, GUI, SKU changes, interception after collection, dispute resolution, automatic overdue capture/fees or refunds after capture. Those limitations match the approved bounded first version.

The hold/release service is synthetic. Preview/confirmation does not prove human consent or grant a spending limit. Personal continuity and retention boundaries remain Task/user rules judged from the actual history. The public actor adapter supplies no user simulator or global scheduler; real actor decisions and event order belong to a scenario caller. Reset is local to the App instance and restores its latest loaded baseline; export evidence before clearing lifecycle receipts.

Human fixture realism/provenance review, independent implementation acceptance and merge remain open. The repository-wide reference suite was not rerun locally for this App-only change; required Linux CI will run against the uploaded head. No Task model rollout, difficulty qualification, accepted contribution or authorship eligibility is claimed.

## Upstream lifecycle automation status at delivery

The human scope approval above exists, but upstream lifecycle workflow run [45307955787](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/actions/runs/45307955787) failed at `GET /repos/MatrAIx-ai/Personal-Agents-Last-Exam/issues/comments/7119490328` with HTTP 403. A separate lifecycle run on #149 also failed at its comment read. The workflow's own 113 tests passed before that API error. The current contribution connection also received HTTP 403 when attempting to rerun the failed upstream job; no permission or merge gate was changed.

Implementation and evidence are delivered for review despite that separate automation issue. The current-head submission command is posted in the PR. Maintainers need to restore/reconcile lifecycle automation and, if necessary, confirm the unchanged proposal on the current implementation head. This document does not impersonate a bot approval/submission record or establish acceptance.
