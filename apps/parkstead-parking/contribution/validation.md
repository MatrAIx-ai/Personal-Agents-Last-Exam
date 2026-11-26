# Parkstead validation matrix

Approved proposal: `proposals/environment/parkstead-parking.md` at
`91a25289f046bcba690bef5973ae600bdd07d5aa` (proposal blob
`8c3d96882a038cb23f12a0c0ed0fd04c47394af9`). Reviewer: `Chenngzz`.
The approved proposal file is unchanged by this implementation.

| Gate / workflow | Evidence | Boundary |
| --- | --- | --- |
| Search/compare and quote/reserve | `npm test`, `npm run example`, real `app:verify` read/event stages | App test is business logic; `app:verify` is MCP/lifecycle/persistence evidence. |
| Modify/cancel, stale writes, atomic inventory | Business tests cover bound modification quote, cancellation preview confirmation, capacity and unchanged failure state; browser test exercises modification and stale global version. | Parallel process scheduling remains Core/runtime evidence. |
| Facility closure, replacement/refund, reopen | Business tests and `examples/scenario.json`; replacement quote binds record/facility/rate versions and expiry. | Task/Infra owns event scheduling. |
| Time | Business tests derive started/completed without mutation and preserve unresolved disruption refund after end; `app:verify` applies event-supplied time. | No global scheduler or Agent wake-up is claimed. |
| Authority, reset, separate runs and persistence | `app:verify` checks Agent denial of every management operation, load/reset/epoch, separate runs and restart persistence. | Local stdio is not production OAuth. |
| GUI/API boundary | `npm run test:web` and `npm run test:web:browser`; browser report and screenshot under `.artifacts/web/`. | Root `test:web:browser` enumerates the seven earlier Apps; Parkstead is covered by its App-specific browser command. |
| Optional Mail | `npm run example:mail` verifies sender record, real Mail record, Messaging receipt, duplicate, grant denial and lost-ack reconciliation with synchronized virtual clocks. | No atomic outbox or automatic retry. |
| Assets/provenance | `app:verify`, `npm run generate:check`, six PNGs and generated catalog hashes; 652 KiB total. | Maintainer visual/realism review remains required. |
| Runtime regression | Root `npm test`, `npm run test:web`, contract checks. | Node 18/22 and independently selected base-runtime compatibility require CI. |

Reviewer implementation clarifications are resolved as follows:

1. All six illustrations are PNG; no SVG is present, and decoded bytes remain under 1 MiB.
2. Started/completed are computed at read time from virtual time. An unresolved
   `action_required` record stays action-required after start/end and retains the
   full-refund path.
3. Replacement resolution requires an expiring quote bound to the reservation,
   facility and rate versions. A higher replacement writes a charge adjustment,
   a lower one writes a refund, and equal cost writes a zero `no_change` adjustment.
   A matching reopen event before resolution restores the original reservation.

Cancellation uses a read-only preview followed by confirmation of exact fee/refund
amounts. Fixture history begins in 2026. Closure replay does not mark/refund twice,
and accepted replacement/cancellation releases original inventory through the
reservation lifecycle used by the occupancy calculation.
