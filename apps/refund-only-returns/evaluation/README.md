# Refund-only Returns evaluation history v2.1

This original synthetic private-shopper history is separate from the unchanged January smoke fixtures. A variable shopping calendar has quiet and busy months, no purchases in April 2025 or April 2026, and year-end gift and late-summer supply peaks. The fictional catalog uses uneven repeat purchasing, seasonal assortments, prices and limited-return items. The [episode ledger](timeline.json) stores uneven order-to-submission and submission-to-resolution delays. The evaluation storefront has one 30-day policy window, inclusive at the deadline, and clearly marked excluded items. Three orders include a second request after an earlier cancellation. Old requests end in either cancellation or dispatch; abandoned draft previews are not part of the shopper history. No real merchant, personal data or media was used.

[Coverage](coverage.json) shows 56 orders, 25 submitted requests and 81 distinct UTC activity dates from January 1, 2025 through December 31, 2026, with activity in all 24 months. An order-free month can still have a request from a prior purchase. Counts use the order's `ordered_at` and the request's `created_at` once; later transitions in the episode ledger are not added to that count. Xiao Cui (@2018cx) is responsible for human provenance and licence review. The fictional account does not require real private purchase records.

```sh
node evaluation/recount.cjs            # verify delivered bytes and print monthly coverage
node evaluation/recount.cjs --generate # regenerate committed seed, ledger, metadata and report
node evaluation/recount.cjs --until 2026-11-20T09:00:00Z > /tmp/returns-profile.json
node tests/core.cjs                    # verify early and full profiles through public Core MCP
```

The full-window profile uses [seed.json](seed.json), [dataset.json](dataset.json) and clock `2026-12-31T23:59:59Z`. For an earlier Task, the emitted profile contains `data`, `dataset` and `virtual_now`. Get the current version and bundle using **Infra** `env.snapshot`; send a unique `request_id`, its `version` as `expected_version`, the profile's `data` and `virtual_now`, and `bundle: {...snapshot.resources.bundle, dataset: profile.dataset}` to Infra `env.load_seed`. Do not replace the policies or catalog, and do not use the smoke dataset counts for this profile. The profile does not provide the original future ledger to the Agent: it removes future orders and submissions, and leaves a past submission at `confirmed` until its resolution actually occurs. A future return deadline on a past order is legitimate. The ledger materializes an as-of seed; it does not inject an undeclared future transition into a running scenario. The supplied Core test exercises the reviewed November Task start, as well as an earlier cut immediately before terminal resolution and a cut at the same resolution instant.

### Recommended Task starts (UTC)

| Initial clock | Eligible order examples | Existing cancellable request |
| --- | --- | --- |
| `2026-09-07T09:00:00Z` | #20041, #20042 | `history-request-43` on #20043 |
| `2026-11-20T09:00:00Z` | #20047, #20048, #20049 | None at this instant |
| `2026-12-11T09:00:00Z` | #20050, #20052 | `history-request-53` on #20053 |

Use a clock with an eligible order for preparation or confirmation and one with a confirmed request for cancellation. For read-only scenarios a quiet clock is intentional; the full-history end clock is primarily for coverage verification, not for assigning arbitrary write targets.
