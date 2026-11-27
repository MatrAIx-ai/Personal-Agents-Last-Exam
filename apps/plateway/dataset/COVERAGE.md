# Plateway delivery dataset: coverage

Environment dataset coverage of the Plateway delivery dataset plateway-delivery-2025-2026, whole window. Not a Task history report: a Task reports its own selection after its first-session cutoff (dataset/as-of.cjs).

- Dataset: `plateway-delivery-2025-2026`; window 2025-01-01 to 2026-12-31 inclusive; time zone `America/New_York`; reference clock (the fixture clock) `2026-11-18T12:00:00-05:00`.
- Reproduce: `node dataset/generate.cjs --check`, then `node dataset/coverage.cjs --check` from `apps/plateway`. This file and `COVERAGE.json` are written by `dataset/coverage.cjs`.
- Counting: Every timestamp is ISO 8601 with its offset; each is converted to its calendar date in America/New_York before counting. No record is date-only. A date counts once however many records or sources fall on it. Records outside the window and invalid dates would be excluded and listed; there are none.
- Smoke fixture and delivery dataset: `fixtures/minimal.json` and this dataset share the account and the catalog (equal at the fixture clock, checked by `tests/t26-dataset.test.cjs`) but have independent order histories. The fixture serves the business tests, the examples and the proposal's example events; the dataset serves evaluation, and Tasks select their history from it with `dataset/as-of.cjs`. The IDs overlap but name different orders: the fixture's `o-1` … `o-12` (and its `ol-`, `rf-` and `n-` IDs) are not the dataset's, and the proposal's example events name fixture IDs.

## Sources

| File | Role | Kind | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| `dataset/base.json` | Seed at the window start 2025-01-01T00:00:00-05:00: the account, addresses, cards, zones, restaurants and menu with the earlier prices; no orders. | synthetic | 39676 | `20d0119760fa7d41849b10910400e4479ceb27e696621ceb96733e96c73b0b27` |
| `dataset/replay.json` | Every committed step in time order: the account holder's tool calls and Infra events, each with its time. | synthetic | 228211 | `6a0957551237af6f8f193a4bf0bad609001ab5bc94b6bbfb2c99536e5640036b` |
| `dataset/full.json` | Seed at 2027-01-01T00:00:00-05:00, the state after every step: all records of the window. | synthetic | 852812 | `cdd8187429c0c66a28439cfea989ef5a62c122f6611c62c33c88942423a78139` |

Method: `dataset/lib.cjs` (`ab857d307a0ff982…`), `dataset/feedback.cjs` (`ab9a45d2137e80d0…`), `dataset/generate.cjs` (`50a2e4bde6cfc172…`), `dataset/as-of.cjs` (`eca3fa6c9aba8696…`), `dataset/coverage.cjs` (`f4da83c178bdf491…`); full hashes in `COVERAGE.json`.

## Record kinds, IDs and date fields

| Kind | Source | Records at | Stable ID | Date field | Records | Distinct dates | Earliest | Latest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| order | `dataset/full.json` | `orders[]` | `orders[].id` | placed_at | 198 | 190 | 2025-01-01 | 2026-12-31 |
| order_line | `dataset/full.json` | `orders[].lines[]` | `orders[].lines[].id` | placed_at of the parent order | 536 | 190 | 2025-01-01 | 2026-12-31 |
| refund | `dataset/full.json` | `orders[].refunds[]` | `orders[].refunds[].id` | at | 34 | 32 | 2025-01-01 | 2026-12-26 |
| rating | `dataset/full.json` | `orders[].rating` | `<order id>/rating` | rating.at | 73 | 70 | 2025-01-26 | 2026-12-24 |
| line_report | `dataset/full.json` | `orders[].lines[].report` | `<line id>/report` | report.at | 8 | 8 | 2025-01-12 | 2026-12-11 |
| notice | `dataset/full.json` | `notices[]` | `notices[].id` | at | 613 | 198 | 2025-01-01 | 2026-12-31 |
| replay_step | `dataset/replay.json` | `steps[]` | `steps[].id` | at | 1518 | 248 | 2025-01-01 | 2026-12-31 |

Excluded from date counts:

- restaurants[] and dishes[] in dataset/full.json (42): Catalog records describe the menu as it stands and carry no occurrence date; their dated changes are the replay steps menu_item.price_changed, menu_item.availability_changed and restaurant.status_changed.
- holder, zones[], addresses[] and cards[] in dataset/full.json (10): Account rows with no occurrence date.
- dataset/base.json (0): Holds only the account and catalog at the window start; no dated records.
- Invalid dates: 0; records outside the window: 0.

## Totals

- Dated records in `dataset/full.json`: 1462 (198 orders, 536 order lines, 34 refunds, 73 ratings, 8 line reports, 613 notices). App records (`plugin.records`: restaurants, dishes and orders): 240.
- Replay steps in `dataset/replay.json`: 1518.
- Coverage figure: **227** distinct dates. Counted over the records loaded into the App (dataset/full.json), which Agents and Infra read back. The global count over both sources adds 21 days on which the replay log holds only 26 cart edits and 27 menu or restaurant events; those days have no App record. Per source: `dataset/full.json` 227, `dataset/replay.json` 248; global deduplicated count over both sources: 248.
- Earliest date 2025-01-01, latest date 2026-12-31. Months without orders: none.

## Real and synthetic

- Real 0, synthetic 1462, mixed 0. Every record and step is synthetic, written by the App while dataset/generate.cjs replayed it; none was collected or observed.

| Partition | From | To | Records | Replay steps |
| --- | --- | --- | --- | --- |
| synthetic, dated before the reference clock | 2025-01-01T00:00:00-05:00 | 2026-11-18T12:00:00-05:00 | 1353 | 1394 |
| synthetic, dated at or after the reference clock: generated, never observed | 2026-11-18T12:00:00-05:00 | 2027-01-01T00:00:00-05:00 | 109 | 124 |

## Monthly coverage

| Month | Orders | Lines | Refunds | Ratings | Reports | Notices | Records | Replay steps | Distinct dates (records) | Distinct dates (with replay log) | After reference clock | Real | Synthetic |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-01 | 12 | 35 | 4 | 1 | 1 | 38 | 91 | 85 | 13 | 13 | 0 | 0 | 91 |
| 2025-02 | 7 | 20 | 3 | 2 | 1 | 22 | 55 | 58 | 7 | 8 | 0 | 0 | 55 |
| 2025-03 | 9 | 22 | 0 | 4 | 0 | 28 | 63 | 70 | 10 | 10 | 0 | 0 | 63 |
| 2025-04 | 7 | 18 | 3 | 2 | 0 | 21 | 51 | 51 | 8 | 9 | 0 | 0 | 51 |
| 2025-05 | 8 | 23 | 1 | 3 | 0 | 24 | 59 | 56 | 12 | 12 | 0 | 0 | 59 |
| 2025-06 | 9 | 20 | 0 | 4 | 0 | 27 | 60 | 61 | 10 | 10 | 0 | 0 | 60 |
| 2025-07 | 4 | 13 | 1 | 1 | 0 | 11 | 30 | 30 | 5 | 5 | 0 | 0 | 30 |
| 2025-08 | 8 | 19 | 1 | 3 | 0 | 23 | 54 | 54 | 10 | 11 | 0 | 0 | 54 |
| 2025-09 | 6 | 16 | 4 | 3 | 2 | 20 | 51 | 57 | 6 | 8 | 0 | 0 | 51 |
| 2025-10 | 9 | 24 | 1 | 4 | 0 | 29 | 67 | 83 | 13 | 15 | 0 | 0 | 67 |
| 2025-11 | 7 | 19 | 3 | 2 | 1 | 21 | 53 | 47 | 8 | 8 | 0 | 0 | 53 |
| 2025-12 | 11 | 27 | 1 | 4 | 0 | 34 | 77 | 78 | 13 | 14 | 0 | 0 | 77 |
| 2026-01 | 13 | 41 | 2 | 6 | 0 | 39 | 101 | 100 | 12 | 13 | 0 | 0 | 101 |
| 2026-02 | 10 | 28 | 3 | 5 | 0 | 30 | 76 | 78 | 12 | 13 | 0 | 0 | 76 |
| 2026-03 | 10 | 24 | 1 | 6 | 1 | 32 | 74 | 77 | 11 | 13 | 0 | 0 | 74 |
| 2026-04 | 6 | 17 | 0 | 1 | 0 | 20 | 44 | 44 | 6 | 6 | 0 | 0 | 44 |
| 2026-05 | 9 | 22 | 2 | 2 | 1 | 27 | 63 | 63 | 10 | 10 | 0 | 0 | 63 |
| 2026-06 | 4 | 12 | 1 | 0 | 0 | 13 | 30 | 38 | 4 | 8 | 0 | 0 | 30 |
| 2026-07 | 5 | 13 | 1 | 1 | 0 | 15 | 35 | 34 | 5 | 5 | 0 | 0 | 35 |
| 2026-08 | 5 | 13 | 0 | 4 | 0 | 16 | 38 | 38 | 6 | 6 | 0 | 0 | 38 |
| 2026-09 | 8 | 27 | 0 | 5 | 0 | 25 | 65 | 67 | 12 | 13 | 0 | 0 | 65 |
| 2026-10 | 10 | 32 | 0 | 3 | 0 | 32 | 77 | 78 | 13 | 13 | 0 | 0 | 77 |
| 2026-11 | 10 | 23 | 0 | 4 | 0 | 31 | 68 | 79 | 11 | 13 | 29 | 0 | 68 |
| 2026-12 | 11 | 28 | 2 | 3 | 1 | 35 | 80 | 92 | 10 | 12 | 80 | 0 | 80 |

Per-date counts are in `COVERAGE.json` (`dates`).

## Gaps

- No real-data anchor (2026-11; stated gap, pending maintainer agreement): DoorDash is only the workflow reference. The approved proposal (proposals/environment/plateway-delivery.md, line 96: "N/A: no crawling or copied menus") excludes collecting its data, and Plateway's restaurants, menus, couriers and account are invented, so there is no real source to collect around November 2026; the whole window is synthetic.
- No Mail history (stated gap): The 613 notices are in the App's own notice log only; the dataset holds no Mail history for them. Mail is optional, and the Mail sender treats notices present in a loaded seed as history.
- 2025-02-08 to 2025-02-15 (8 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2025-06-25 to 2025-07-01 (7 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2025-07-03 to 2025-07-10 (8 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2025-07-13 to 2025-07-21 (9 days without any App record): The account holder is away from 2025-07-12 to 2025-07-20, so the generator plans no orders.
- 2025-08-28 to 2025-09-05 (9 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2025-09-08 to 2025-09-16 (9 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2025-09-25 to 2025-10-03 (9 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2025-10-11 to 2025-10-17 (7 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2025-11-25 to 2025-12-01 (7 days without any App record): Includes Thanksgiving, when the generator plans no orders; otherwise ordinary variation between orders.
- 2026-01-03 to 2026-01-09 (7 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2026-06-01 to 2026-06-08 (8 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2026-06-10 to 2026-06-16 (7 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2026-07-02 to 2026-07-10 (9 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2026-07-14 to 2026-07-23 (10 days without any App record): No order is planned in these days; ordinary variation between orders.
- 2026-08-04 to 2026-08-19 (16 days without any App record): The account holder is away from 2026-08-08 to 2026-08-16, so the generator plans no orders.

## Representative records

| Example | Order | Placed | Restaurant | Address | Mode | Status | Lines | Total | Refunds | Rating |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first order of the window | o-1 | 2025-01-01T18:35:00-05:00 | Masa Verde | a-1 | asap | cancelled (account_holder) | 1 × Veggie Quesadilla; 1 × Carnitas Tacos (Salsa roja, Cotija); 1 × Chicken Burrito; 1 × Chips and Guacamole — For Alex; 1 × Elote | $70.83 | rf-1 cancelled $70.83 | — |
| last order of the window | o-198 | 2026-12-31T18:04:00-05:00 | Lantern Noodle House | a-1 | asap | delivered | 1 × Beef Noodle Soup; 1 × Pork and Chive Dumplings (Pan-fried); 1 × Garlic Bok Choy | $49.02 | — | — |
| first order after the reference clock | o-184 | 2026-11-18T12:42:00-05:00 | Saffron Lane | a-2 | asap | delivered | 1 × Lamb Biryani; 1 × Garlic Naan | $33.13 | — | 3 stars: Fine, but the sides were cold. |
| office lunch with a line for a colleague | o-6 | 2025-01-13T11:42:00-05:00 | Masa Verde | a-2 | asap | delivered | 1 × Chicken Burrito; 1 × Carnitas Tacos (Salsa verde) — For Priya | $35.69 | — | — |
| scheduled dinner released at its time | o-22 | 2025-03-09T13:55:00-04:00 | Lantern Noodle House | a-1 | scheduled | delivered | 3 × Dan Dan Noodles (Mild); 1 × Pork and Chive Dumplings (Pan-fried); 1 × Kung Pao Chicken (White rice) — For Alex | $82.16 | — | 2 stars: Arrived lukewarm and a bit soggy. |
| breakfast scheduled the evening before | o-9 | 2025-01-22T20:58:00-05:00 | Hearth & Crumb | a-1 | scheduled | delivered | 1 × Breakfast Sandwich (Smoked salmon); 1 × Almond Croissant — For Sam | $22.88 | — | — |
| delayed order | o-2 | 2025-01-03T20:04:00-05:00 | Masa Verde | a-1 | asap | delivered | 1 × Chicken Burrito (Sour cream); 1 × Carnitas Tacos (Salsa verde); 2 × Elote [removed: unavailable]; 1 × Chips and Guacamole — For Alex | $65.17 | rf-2 line_unavailable $12.85 | — |
| line removed as unavailable while preparing | o-29 | 2025-04-02T12:37:00-04:00 | Saffron Lane | a-2 | asap | delivered | 1 × Lamb Biryani; 1 × Vegetable Samosas [removed: unavailable] | $36.69 | rf-8 line_unavailable $8.10 | — |
| reported line refunded | o-5 | 2025-01-12T00:01:00-05:00 | Lantern Noodle House | a-1 | asap | delivered | 1 × Kung Pao Chicken (White rice) [reported wrong] | $24.93 | rf-3 line_reported $16.15 | — |
| rejected by the restaurant | o-30 | 2025-04-05T08:49:00-04:00 | Hearth & Crumb | a-1 | asap | cancelled (rejected) | 1 × Almond Croissant; 1 × Granola Yogurt Bowl — For Alex | $21.43 | rf-9 cancelled $21.43 | — |
| not accepted within 20 minutes | o-40 | 2025-05-14T12:38:00-04:00 | Saffron Lane | a-2 | asap | cancelled (not_accepted) | 1 × Butter Chicken (Mild); 1 × Vegetable Samosas | $34.79 | rf-11 cancelled $34.79 | — |
| cancelled by the account holder before preparation | o-17 | 2025-02-18T20:04:00-05:00 | Lantern Noodle House | a-1 | asap | cancelled (account_holder) | 1 × Pork and Chive Dumplings (Steamed); 1 × Kung Pao Chicken (White rice) — For Sam; 1 × Scallion Pancake; 2 × Garlic Bok Choy | $66.81 | rf-7 cancelled $66.81 | — |
| cancelled by the account holder while preparing | o-14 | 2025-02-07T00:03:00-05:00 | Lantern Noodle House | a-1 | asap | cancelled (account_holder) | 1 × Kung Pao Chicken (White rice); 1 × Garlic Bok Choy | $36.68 | rf-5 cancelled $7.99 | — |

Timelines and notices of these orders are in `COVERAGE.json` (`representative`).

## Loading and query demonstration

Real Core 1.6.0 over MCP stdio: Infra loads each selection with env.load_seed (data, virtual_now and provenance bundle) and reads env.snapshot; the Agent reads plateway.account.get, plateway.orders.list, plateway.orders.get for every listed order, plateway.cart.get and plateway.menu_items.get; the first staged event, if any, is applied with env.apply_event.

| As of | Seed ID | env.load_seed | Agent clock | Steps applied / withheld | Orders selected / listed | Same IDs | Latest listed order | Listed from the as-of instant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-05-14T12:58:00.001-04:00 | `plateway-delivery-asof-20250514T165800.001Z-9585ceeb25b4` | ready, 82 objects, bundle `plateway-delivery-asof-20250514T165800.001Z-9585ceeb25b4`, automated checks pass | 2025-05-14T12:58:00.001-04:00 | 298 / 1220 | 40 / 40 | yes | 2025-05-14T12:38:00-04:00 | 0 |
| 2026-01-01T00:00:00-05:00 | `plateway-delivery-asof-20260101T050000.000Z-617c3f384b75` | ready, 139 objects, bundle `plateway-delivery-asof-20260101T050000.000Z-617c3f384b75`, automated checks pass | 2026-01-01T00:00:00-05:00 | 730 / 788 | 97 / 97 | yes | 2025-12-31T12:39:00-05:00 | 0 |
| 2026-11-18T12:00:00-05:00 | `plateway-delivery-asof-20261118T170000.000Z-3beda1f5b45e` | ready, 225 objects, bundle `plateway-delivery-asof-20261118T170000.000Z-3beda1f5b45e`, automated checks pass | 2026-11-18T12:00:00-05:00 | 1394 / 124 | 183 / 183 | yes | 2026-11-14T19:28:00-05:00 | 0 |
| 2026-12-15T00:00:00-05:00 | `plateway-delivery-asof-20261215T050000.000Z-7eaec23df5dc` | ready, 233 objects, bundle `plateway-delivery-asof-20261215T050000.000Z-7eaec23df5dc`, automated checks pass | 2026-12-15T00:00:00-05:00 | 1466 / 52 | 191 / 191 | yes | 2026-12-12T17:43:00-05:00 | 0 |
| 2027-01-01T00:00:00-05:00 | `plateway-delivery-asof-20270101T050000.000Z-0ed0fc9166db` | ready, 240 objects, bundle `plateway-delivery-asof-20270101T050000.000Z-0ed0fc9166db`, automated checks pass | 2027-01-01T00:00:00-05:00 | 1518 / 0 | 198 / 198 | yes | 2026-12-31T18:04:00-05:00 | 0 |

| As of | Lines | Refunds | Ratings | Reports | Notices | Monthly read-back equals the selection | Timers committed | Open orders (same as Core reads) | Cart lines | mi-13 price | Staged events | First staged event applied |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-05-14T12:58:00.001-04:00 | 110 | 11 | 10 | 2 | 124 | yes | 1 | none (yes) | 0 | $15.95 | 31 | restaurant.status_changed at 2025-08-05T10:00:00-04:00: committed; then r-3 paused |
| 2026-01-01T00:00:00-05:00 | 256 | 22 | 33 | 5 | 298 | yes | 0 | none (yes) | 0 | $15.95 | 22 | menu_item.price_changed at 2026-01-05T06:00:00-05:00: committed; then mi-31 $16.95, available |
| 2026-11-18T12:00:00-05:00 | 498 | 32 | 68 | 7 | 565 | yes | 0 | none (yes) | 0 | $16.50 | 5 | menu_item.availability_changed at 2026-11-27T16:00:00-05:00: committed; then mi-12 $8.95, available |
| 2026-12-15T00:00:00-05:00 | 517 | 33 | 71 | 8 | 592 | yes | 0 | none (yes) | 0 | $16.95 | 2 | restaurant.status_changed at 2026-12-24T15:00:00-05:00: committed; then r-4 paused |
| 2027-01-01T00:00:00-05:00 | 536 | 34 | 73 | 8 | 613 | yes | 0 | none (yes) | 0 | $16.95 | 0 | — |

Lines, refunds, ratings and reports are read back with plateway.orders.get, notices with env.snapshot. The first row cuts one millisecond after an acceptance limit passed with no later step yet: the selection commits that timer, as the App's next write would, so its order is cancelled in the seed and in Core's reads alike and is not an open order. At 2027-01-01T00:00:00-05:00 the whole window is loaded; its monthly read-back (`loading.instants[].monthly_read_back` in `COVERAGE.json`) equals the monthly table above, which `dataset/coverage.cjs` checks.
