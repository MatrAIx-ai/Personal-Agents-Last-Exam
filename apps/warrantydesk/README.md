# WarrantyDesk 0.1.0

Original synthetic replacement-coordination App. Maintainer: Hanson Tang (@hansontang). Implements the MCP-only scope approved in [PR #150](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/150) at `5dc0234c28627fcbbc0523af141c849da8941ee5`.

The account owner's private continuity journal is separate from manufacturer/courier records. It records user/IT-performed outcomes without credentials, codes, actual authentication or transmission to a manufacturer. Delivery, user checks, erasure, collection, manufacturer receipt, release request and posted hold release are different facts.

## Run and verify

Node.js 18+, built-in modules only, no install, credentials or live accounts:

```sh
cd apps/warrantydesk
node --test tests/business.test.cjs
node examples/run.cjs
```

From the public PALE checkout:

```sh
node runtime/build-contracts.cjs --check
node runtime/cli.cjs verify --app apps/warrantydesk --output .artifacts/warrantydesk-public.json
node apps/warrantydesk/tests/runtime.cjs
```

The standalone example completes normal original-device return, pre-dispatch withdrawal and shipped-replacement withdrawal in separate domain fixtures. The real workflow test uses public Core 1.6.0 / Core API 1.2.0 and independent Agent/Infra stdio clients. An outside checkout can set `PALE_RUNTIME_ROOT`; `WARRANTYDESK_REPORT` can select the workflow report path. App-only tests do not establish transport, locking or runtime identity enforcement.

## Agent operations

Every tool starts with `warrantydesk.`. Writes require the fresh Core `expected_version` and `request_id`. An uncertain exact retry uses the original argument object, including its original version; changed reuse conflicts. Account/run/role are supplied by the launcher, not by Agent arguments.

| Tools | Effect / result | Important failures |
| --- | --- | --- |
| `workspace.get`, `records.list`, `records.get` | Read bound-account identity, time and dated context | `not_found` |
| `case.get` | Read case plus offer, device custody/first erasure, manufacturer receipts and ordered financial postings | `not_found` |
| `requests.list`, `pickups.list`, `pickup.options` | Read private requested/performed facts, stored/effective pickup state and available slots | Invalid filters/references |
| `remedy.preview` | Read-only accept/withdraw quote for `case_id` and `action`; no authorization or persisted quote | `ineligible`, `return_already_started`, `pickup_locked` |
| `remedy.accept`, `remedy.withdraw` | Digest/version-bound order/authorization or explicit withdrawal branch | `quote_changed`, state and locked-pickup errors |
| `verification.request`, `verification.cancel` | Create/cancel a pending check bound to `case_id`, `device_serial` and `kind` | `wrong_serial`, `request_exists`, `request_not_pending` |
| `pickup.schedule`, `pickup.cancel`, `pickup.reschedule` | Book/cancel/change actual return of the active serial; reschedule is atomic | `slot_unavailable`, `pickup_exists`, `pickup_inactive`, `cancellation_closed` |
| `case.close` | Finalize an actually settled branch and retire pending coordination requests | `settlement_pending`, `missing_receipt` |

Core returns `{status, app_id, version, value}`. Preview returns `value.quote.digest`; accept/withdraw requires `quote_digest`. A business confirmation does not prove human consent or extend a personal spending cap. The fixed synthetic hold is an authorization, not a real bank debit.

## States and settlement branches

Cases begin open. Acceptance creates an active case, ordered replacement and authorized hold. Provider events separately record dispatch and delivery. Original/replacement serial identity never changes.

| Branch | Physical requirement | Release and terminal state |
| --- | --- | --- |
| Normal original return | Replacement actually delivered; original serial actually collected and received | Manufacturer receipt requests release; actual provider release allows `case.close` to mark closed |
| Withdrawal before dispatch | Accepted order is cancelled before any dispatch; no fake parcel/receipt is created | Cancellation requests release; actual provider release allows terminal withdrawn |
| Withdrawal after dispatch/delivery | Keep original device; await actual delivery if necessary; return the replacement serial | Actual replacement collection/receipt requests release; actual posting allows terminal withdrawn |

Withdrawal must occur before original-device handoff and before any still-active pickup's cancellation cutoff. A locked pickup cannot be bypassed by withdrawing. Pending original-case pickup/check work is cancelled with its generation retained. Completed user/IT facts are never rewritten. A missed old pickup no longer blocks a new active return obligation. Withdrawal cannot recall a collected parcel, change SKU or silently refund an authorization.

Hold stages are none, authorized, release pending and released. Immutable postings record authorization, release request and actual release exactly once. A request/acknowledgement, courier pickup or passage of time is not financial settlement. Each posting retains the originating call/event ID. Wrong-serial or wrong-mode receipts/postings leave the case and hold unchanged.

For a shipped withdrawal the original's receipt cannot settle the replacement obligation. For pre-dispatch withdrawal the sole no-parcel exception requires recorded cancellation and actual release with reason `cancelled_before_dispatch`. Normal closure also waits for replacement delivery if original receipt happens first.

## Pickup and performed-check behavior

Pickups are scheduled, cancelled or collected; an elapsed uncollected window is **effectively missed**. Reads show stored and effective state without mutation. Cutoffs are exclusive. Cancel/reschedule before the old cutoff preserves the old record; reschedule checks the new future slot first and atomically cancels the old generation plus books the new one. Failure leaves the old slot intact. A missed record can remain stored scheduled while a new attempt is booked. Only an actual provider event inside the booked window records collection.

Requests are pending, performed, refused or cancelled. Supported kinds are independent bank login, independent work login, work enrollment and erasure. The first three do not perform one another. A success that used the old device remains explicitly marked dependent; completed enrollment is not a successful independent login. Request acknowledgement is not performed work. Successful erasure is recorded only by the trusted user's performed reply and preserves the first actual erasure time across later repeated facts. The App does not infer private access, personal retention permission or automatically prevent all unsafe early erasures; those remain Task/user policy.

The journal stores typed booleans and source provenance, with no credential/code fields. Context text is trusted synthetic seed/Infra data, not a general promise to detect every secret in arbitrary dialogue. Provider facts and private checks share a user-owned coordination workspace; no operation sends this journal to a manufacturer, Mail or Chat.

## Events, generations and time

Only Infra can use the public `env.*` lifecycle operations, including host `env.advance_time`; the Agent connection neither lists nor accepts them. Declared incoming operations use `{event_id, at, operation, payload}`:

| Operation | Matching / effect |
| --- | --- |
| `record.add` | Append uniquely identified context from a seeded source |
| `replacement.dispatched` / `replacement.delivered` | Case plus expected replacement serial; manufacturer dispatch and assigned-courier delivery are separate |
| `verification.reply` | Exact case/serial/kind/request attempt plus requested user or IT source; append performed/refused result |
| `pickup.collected` | Exact case/return mode/serial/pickup attempt; correct courier, live booked window and available device |
| `return.received` | Same exact collected generation, correct serial and manufacturer; append actual receipt and request release |
| `hold.released` | Exact active mode/serial with actual matching receipt, or explicit pre-dispatch cancellation reason |

The complete payload schemas are in `schemas/events.schema.json`. Attempts monotonically derive from retained records. A cancelled/rescheduled/recreated object never inherits an old callback. Missing, inactive or wrong-generation targets fail; ambiguity rejects rather than broadcasting. Core handles exact event replay and conflicting event IDs. Rejected events leave accepted business state and clock unchanged, apart from ordinary denial audit.

`examples/actor-driver.cjs` uses only public Infra snapshots. It captures run/account/epoch and resolves a real pending target to a specific selector **before** applying a prepared callback. Later cancellation or reset makes that callback inactive; it is never re-bound to a newer request. A conditional step without an applicable target emits no completion event. The caller owns genuine actor decisions/results, event order and time. This is an adapter, not a scheduler, user simulator or authentication service.

Every current-time predicate uses `ctx.virtual_now`. Advancing the Core clock alone executes no business handler. Infra must process due events before advancing past them and choose explicit tie order. Delivery, collection, receipt and financial posting always require declared external facts. All actual records/history use explicit-offset logical timestamps; execution diagnostics/report dates are separate.

Each offer supplies normal and withdrawal return due dates. At/after a due date, an unreceived obligation is displayed overdue without changing financial postings. A later matching actual receipt retains immutable `returned_late` evidence. **V1 excludes automatic overdue capture/charges and refunds after capture.** It models a fixed synthetic authorization/release service, not the complete policy of a real manufacturer or bank. An overdue flag never fabricates a charge or releases funds; closure still requires actual provider settlement.

## History, ownership and reset

Three independent original account seeds are supplied: Eli, Maya and Ren, with different quoted hold amounts. The baseline has 12 original business objects, 2026 purchase/coverage context and 2027 coordination records, devices, an offer/case and two slots. Every case, serial, actor, offer, pickup generation, physical receipt and financial stage is validated. Duplicate IDs/selectors, foreign devices, incoherent custody/erasure, fabricated release and wrong-serial receipt histories reject. Business JSON is limited to 512 KiB; there are no assets.

`env.load_seed` validates new history, explicit account binding and logical time. Changing accounts requires that explicit trusted binding. Sessions preserve the private history, pending/performed replies, fulfilment, pickups, custody/erasure facts, actual receipts and hold postings. Reset restores this instance's latest loaded baseline/time, advances the epoch and invalidates prepared callbacks. It does not reset other Apps; export evidence before resetting/seed replacement clears lifecycle receipts.

## Provenance and limits

Original business behavior, text, names, serials, prices and provider rules are synthetic under MIT. Public packaging/launcher/contracts reuse the public reference templates; business modules import no other App or runtime internals. Apple express replacement informed only the broad workflow; these invented rules are not Apple's policies. Related #7 refund-only returns and #33 personal records are not dependencies.

V1 excludes live providers/authentication/banking, outgoing messaging, GUI, SKU changes, interception after collection, disputes, overdue capture/fees/refunds and general natural-language privacy assessment. No secrets or real accounts are used. Independent human realism/provenance review and implementation acceptance remain open. App tests do not establish Task model difficulty, production access control or accepted authorship credit.
