# SpaceBook implementation evidence

SpaceBook v1 implements the scope approved on PR #289 at proposal commit `958b33ff436cc52f148ff0a0ad1522113dbcd988`. The reviewer additionally confirmed the synthetic-only dataset and requested a real end-to-end replay/replacement case; that case is covered below. Implementation acceptance and final maintainer merge remain outstanding.

Business implementation commit: `81561319a262e3d2008e2e642e7f2f63da797c59`. The business, MCP, dataset and final model-trial reports identify this tested package SHA-256:

`7518e3467fc950bcadf5f046c1b2dc96ace892e864e56c23ebbdea48ac34ba28`

The first clean-checkout CI run exposed an untracked empty `assets/` directory. Packaging fix `d995d97b417be8f25f35dcb1df062c5fca3c4a64` adds only `assets/README.md`; all executable code, schemas, fixtures and tests are byte-identical. The final distributable package hash is `5613867d1d9af2d3ed250559c4d27e81eacfd94720b11166161c29e439540f92`. [Exact packaging change](reports/packaging-fix.json), [clean-checkout verifier](reports/clean-checkout.json), [final base verifier](reports/base-validator-final.json), [final Node 18 verifier](reports/node18-final.json) and [clean-checkout browser rerun](reports/clean-browser/browser.json) verify the corrected distribution. Earlier reports retain their original hashes; no model trial was rerun merely for the directory README. [Manifest](reports/manifest.json) records the base revision, versions and model usage. The untouched baseline runtime was extracted with `git archive 25d5597 runtime`; no runtime or shared reference-App changes are part of this implementation. Local reproduction used Node 22.16.0, public runtime 1.6.0 / Core API 1.2.0, Playwright 1.56.1 and its Chromium 141 browser. Node 18 compatibility was checked separately. Run commands from [VALIDATION.md](../../../apps/spacebook/VALIDATION.md); no model credential is needed for deterministic tests.

## Results

| Requirement | Result | Evidence |
| --- | --- | --- |
| Business transitions and historical cutoff | Passed, 18 tests (17 business + 1 history) | [Raw TAP](reports/business.log) |
| Official public verifier | Passed, 40 checks | [Final clean-checkout report](reports/clean-checkout.json); [original report](reports/common.json) |
| Untouched base-runtime verifier | Passed, 40 checks | [Final base report](reports/base-validator-final.json) |
| Node 18 compatibility | Passed, 40 checks | [Final Node 18 report](reports/node18-final.json) |
| Real MCP business/state/concurrency | Passed, 35 checks | [Trace and assertions](reports/integration.json) |
| Historical dataset loading and retrieval | Passed, 14 checks | [Full dataset and eight scenario loads](reports/dataset.json) |
| Actual browser flows | Passed, 15 checks | [Browser report with ordered screenshots and persisted versions](reports/browser.json) |
| Reference outcome controls | Passed, 8 controls | [Output](reports/reference-controls.log) |
| Existing public regression suite | Passed, 22/22 stages | [Raw output](reports/reference-runtime.log); command `node runtime/tests/run.cjs`, the repository's `npm test` entry |
| Generated contracts and datasets | Passed | `node apps/spacebook/scripts/contracts.cjs --check`; `node apps/spacebook/scripts/dataset.cjs --check` |
| Final model-agent usability batch | Passed, 4/4 | [Batch](reports/agent-smoke.json), traces [0](reports/smoke-0.json), [1](reports/smoke-1.json), [2](reports/smoke-2.json), [3](reports/smoke-3.json) |
| Cross-App delivery / remote deployment | Not applicable | Explicitly outside approved v1 scope |
| Independent human realism/provenance/workflow review | Pending | Automated evidence does not replace maintainer judgment |

## Reviewer-requested chain

The integration test starts actual Agent and Infra MCP processes against a disposable package and records real calls/results. It:

1. Holds and confirms Cedar plus Camera One; saves the exact confirmation request and stored receipt.
2. Injects a future Cedar outage; verifies the current booking is disrupted and Camera One is released too.
3. Replays the original confirmation request. The returned original receipt (apart from the transport's `duplicate` marker), stored receipt, data and version remain unchanged. A fresh booking read still says disrupted.
4. Attempts an unavailable replacement. The rejected write preserves all business data, including the already released allocation. Core denial audit entries are not mistaken for business mutations.
5. Replaces the booking with Willow plus Camera One in one transaction, preserving backward/forward links and superseding the old booking.
6. Restarts the Agent process and reads persisted state: exactly one active linked booking remains, with no abandoned active holds.

Additional checks cover an ordinary confirmed booking's failed replacement, competing clients, event replay, request-ID conflicts, stale writes, hidden Infra tools, run isolation and reset. A separate business test explains an owned conflicting hold and verifies that explicitly releasing it allows direct atomic replacement; there is no silent hold consumption.

## GUI comparison and ordered demonstration

Reference screenshots are public Envoy help-documentation captures; [source metadata](reference/sources.json) records exact URLs, capture timestamps, browser and original image locations. They are review artifacts only, outside the runtime package, and retain their providers' rights. No real customer data was collected. SpaceBook uses its own layout and synthetic records.

| Workflow | Reference / intentional difference | Implemented sequence |
| --- | --- | --- |
| Inspect room availability | [Envoy room availability](reference/booking-product-1.png) | [Search](reports/01-search.png) → [resource detail](reports/02-resource.png) |
| Prepare and confirm | [Envoy room/time form](reference/booking-product-2.png); SpaceBook adds an explicit temporary room/equipment hold | [Hold form](reports/03-hold-form.png) → [hold review](reports/04-hold-review.png) → [confirmed booking](reports/05-confirmed.png) |
| Change after outage | Atomic bundles, disruption and replacement links are original SpaceBook rules, not claimed Envoy parity | [Stale form after external change](reports/06-stale.png) → [disrupted booking](reports/07-disrupted.png) → [unavailable replacement](reports/08-unavailable.png) → [valid linked replacement](reports/09-replaced.png) |
| Cancel and inspect notices | Local notices are original App business records; no email or push delivery | [Cancelled result](reports/10-cancelled.png) → [activity and notices](reports/11-notices.png) |
| Expiry and responsive layout | Virtual-time hold expiry is an original simulation rule | [Expired hold](reports/12-expired.png), [mobile view](reports/13-mobile.png) |

[Browser source](../../../apps/spacebook/tests/browser.cjs) performs the actual controls, checks saved state and captures these steps. It also exercises lost-acknowledgement retry, explicit release, read flags, independent MCP updates, browser reload and text-only rendering. The report pins viewport, browser, run state and versions. A capture of a page alone is not counted as a functional check.

## Data coverage and provenance

[Evaluation data](../../../apps/spacebook/datasets/evaluation.json) contains 480 hold lifecycles and 482 booking records; replacement creates an additional linked booking, while expired/released holds create none. [Coverage report](../../../apps/spacebook/datasets/coverage.json) derives 466 distinct activity dates across all 24 months of 2025–2026, in `America/Los_Angeles`. Monthly volume, owners, room/equipment use, meeting duration and outcomes vary deterministically. Weekends and unbooked dates are documented gaps; no daily filler is inserted.

Records are entirely synthetic. Envoy documentation anchors interaction design only, never observed booking data. Source/generator hashes, authoritative date fields and monthly counts are included. The eight small fixtures are separate from full-window data. The real loading test supplies the correct record-count metadata, queries owned histories through Agent MCP, verifies that other owners are hidden and checks reset. The full-window loading demo runs at January 1, 2027; the separate history-selection helper omits future and in-progress lifecycles before a task cutoff instead of leaking later outcomes.

## Model trials and retained failures

The final batch uses `gpt-4.1-mini-2025-04-14` and `gpt-4.1-2025-04-14`, temperature 0, no parallel tool calls, up to 16 rounds and 1,200 completion tokens per round. Each model receives ordinary booking and outage-replacement scenarios with fresh state. Only business tools and user context are exposed; grading, snapshots, Infra operations and setup events stay outside model messages. The adapter follows the [official Chat Completions function-tool contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

All four final runs completed suitable bookings; recovery runs created linked replacements. This is a small interface-usability check, not Task difficulty qualification or a general reliability claim. Token usage and conservative reservation totals are in the manifest; reservations are not invoices or current-price claims. Credentials are excluded from all artifacts.

- [Attempt 1](reports/agent-attempt-1/agent-smoke.json): 1/4 passed. Two recovery runs interpreted `video=true` as a complete-bundle requirement, overlooking compatible cameras. Another run mixed converted UTC with a local offset and stopped after the error. Added precise filter/timestamp field descriptions and an opening-hours error showing the interpreted local time.
- [Attempt 2](reports/agent-attempt-2/agent-smoke.json): 2/4 passed. Ordinary booking succeeded. One recovery run still stopped at built-in-video filtering; the other held a replacement bundle first and then collided with its own hold. Added a search-result explanation of individual-resource filtering and an owned-hold conflict diagnostic; replacement's documented direct-allocation behavior remained unchanged.
- Final batch: 4/4 passed after those interface changes. Entire earlier batches and transcripts remain available; final results are not assembled by selecting successes across batches.

Early local harness execution under the restricted process environment produced empty child outputs and a failed MCP launch; it was rerun with actual child-process execution enabled. The initial browser launch lacked its default-cache executable; final runs used the already installed matching browser distribution. These environment setup issues are not counted as agent reasoning failures. The first remote public-runtime/base jobs failed because Git omitted the empty asset directory; the tracked README fix was checked against an actual `git archive` export, and the complete browser flow was rerun from that export. Visual inspection also corrected missing content padding before final browser captures.

## Handoff

The approved proposal remains unchanged. Implementation, tests, local GUI, data generation and evidence are delivered in PR #289. The dedicated SpaceBook workflow reruns business, data, MCP and browser checks without model credentials; existing repository workflows provide public-runtime and base-compatibility checks. Maintainer implementation acceptance and merge are still required. Any substantive scope expansion must receive design review.
