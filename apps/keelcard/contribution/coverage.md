# Keelcard dataset coverage

Counting zone `America/New_York`. Window `2025-01-01` through `2026-12-31`, inclusive. A row counts when its calendar date in that zone falls inside the window. A timestamp that does not parse is listed under exclusions as `invalid_date`. A parsed date outside the window is listed as `out_of_window`. This run has no invalid dates.

Activity dates come from these fields:

- `authorizations[].decided_at` for an approved authorization
- `authorizations[].captured_at` for a capture
- `declines[].decided_at` for a decline
- `change_requests[].created_at` for a change request

Statements are scheduled windows. Their `issued_at` and period bounds stay out of the activity-date set. The December `ledger.settle_due` event is the same kind of scheduled close. Its timestamp is `2027-01-01`, so the report lists it as out of window and does not count it as a 2026 date.

## Reproduce

From the repository root:

```sh
node apps/keelcard/examples/coverage-report.cjs
node apps/keelcard/examples/coverage-report.cjs --json
node apps/keelcard/examples/coverage-report.cjs --load
```

From inside `apps/keelcard`:

```sh
node examples/coverage-report.cjs
```

`--json` prints the same counts as a machine-readable object. `--load` loads fixture (a) and fixture (b) through the public Core runtime at each seed's `initial_clock`, then calls `keelcard.transactions.list`, `keelcard.declines.list` and `keelcard.statements.list`. It then applies `examples/events/freelancer-2026-12.json` to fixture (b) with `env.advance_time` and `env.apply_event`, and prints the counts again. When the public runtime is not beside the package, the script prints one line and skips the load.

## Files

| Source | File | sha256 | Bytes |
| --- | --- | --- | ---: |
| (a) household | `fixtures/minimal.json` | `d9eeb281a49e632fa726f5a06c9c5147c8ba6924c42acfd88dd5b420073c6bc4` | 105677 |
| (b) freelancer seed | `fixtures/freelancer.json` | `3d1da17b817af4a9a2a9c2805ee7634080f83a07d42604d87ee90df8bbcb0615` | 641137 |
| (c) delegate | `fixtures/delegate.json` | `e62294e4f0eb2be1c2bab4fae0f620cfc1173ab192b74c1b8547546e9132eca1` | 2457 |
| (b) December staged events | `examples/events/freelancer-2026-12.json` | `ec21b972670d1f4b73ff5f1966d89682f4c0d005e5fea8b6e66374e16bd0c56e` | 23452 |

Exclusions: fixtures (a), (b) and (c) have none. The December file excludes `b-settle-2027-01` (`2027-01-01T00:05:00-05:00`, `out_of_window`).

## Summary

| Source | Approved | Declined | Statements | Distinct dates (ET) | Range |
| --- | ---: | ---: | ---: | ---: | --- |
| (a) household | 62 | 1 | 14 | 62 | 2025-09-20 to 2026-11-14 |
| (a) card-4417 weekly ledger | 61 | 1 | | 61 | Saturdays 2025-09-20 to 2026-11-14 |
| (b) freelancer seed | 508 | 37 | 22 | 397 | 2025-01-01 to 2026-11-11 |
| (b) December staged events | 23 | 1 | +2 after settle | 18 | 2026-12-01 to 2026-12-28 |
| (c) delegate | 0 | 0 | 0 | 1 | 2026-11-18 |
| All seeds, deduplicated | | | | 424 | 2025-01-01 to 2026-11-18 |
| All seeds plus December | | | | 442 | 24 of 24 months |

The December file holds 48 events: 24 `authorization.request`, 23 `authorization.capture`, and 1 `ledger.settle_due`. These are staged scenario events. Apply them after `env.advance_time`. They are never pre-session history. The approved, declined and date figures in that row are the scheduled file. The two extra statements are what the committed settle writes.

## Fixture (a) by month

card-4417 is the weekly grocery ledger: 61 approved captures and 1 decline, all on Saturdays. The decline is 2026-10-17, a Saturday that already has a capture, so the card still has 61 distinct dates. card-8821 adds one capture on Sunday 2026-04-12 ($212.40). That is why April in the household table has 5 dates and the card-4417 table has 4. Every other active month is the weekly card alone. Months omitted below are zero.

card-4417:

| Month | Requests | Approved | Captured | Declined | Dates |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025-09 | 2 | 2 | 2 | 0 | 2 |
| 2025-10 | 4 | 4 | 4 | 0 | 4 |
| 2025-11 | 5 | 5 | 5 | 0 | 5 |
| 2025-12 | 4 | 4 | 4 | 0 | 4 |
| 2026-01 | 5 | 5 | 5 | 0 | 5 |
| 2026-02 | 4 | 4 | 4 | 0 | 4 |
| 2026-03 | 4 | 4 | 4 | 0 | 4 |
| 2026-04 | 4 | 4 | 4 | 0 | 4 |
| 2026-05 | 5 | 5 | 5 | 0 | 5 |
| 2026-06 | 4 | 4 | 4 | 0 | 4 |
| 2026-07 | 4 | 4 | 4 | 0 | 4 |
| 2026-08 | 5 | 5 | 5 | 0 | 5 |
| 2026-09 | 4 | 4 | 4 | 0 | 4 |
| 2026-10 | 6 | 5 | 5 | 1 | 5 |
| 2026-11 | 2 | 2 | 2 | 0 | 2 |

Household total, both cards:

| Month | Requests | Approved | Captured | Declined | Dates |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025-09 | 2 | 2 | 2 | 0 | 2 |
| 2025-10 | 4 | 4 | 4 | 0 | 4 |
| 2025-11 | 5 | 5 | 5 | 0 | 5 |
| 2025-12 | 4 | 4 | 4 | 0 | 4 |
| 2026-01 | 5 | 5 | 5 | 0 | 5 |
| 2026-02 | 4 | 4 | 4 | 0 | 4 |
| 2026-03 | 4 | 4 | 4 | 0 | 4 |
| 2026-04 | 5 | 5 | 5 | 0 | 5 |
| 2026-05 | 5 | 5 | 5 | 0 | 5 |
| 2026-06 | 4 | 4 | 4 | 0 | 4 |
| 2026-07 | 4 | 4 | 4 | 0 | 4 |
| 2026-08 | 5 | 5 | 5 | 0 | 5 |
| 2026-09 | 4 | 4 | 4 | 0 | 4 |
| 2026-10 | 6 | 5 | 5 | 1 | 5 |
| 2026-11 | 2 | 2 | 2 | 0 | 2 |

## Fixture (b) by month

The seed runs from 2025-01 through the clock month, 2026-11. Each merchant buys in about two of every five months, on a day from 1 to 28 and an hour from 08:00 to 19:59 ET. Telecom requests are declines (`category_blocked`). March 2026 has 25 requests because the closed trial card adds one $1.00 capture on 2026-03-04. November stops at 2026-11-11 because later generated timestamps are at or after the clock `2026-11-18T17:00:00.000Z`.

| Month | Requests | Approved | Captured | Declined | Dates |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025-01 | 24 | 22 | 22 | 2 | 17 |
| 2025-02 | 24 | 23 | 23 | 1 | 17 |
| 2025-03 | 24 | 22 | 22 | 2 | 18 |
| 2025-04 | 24 | 23 | 23 | 1 | 18 |
| 2025-05 | 24 | 22 | 22 | 2 | 18 |
| 2025-06 | 24 | 22 | 22 | 2 | 17 |
| 2025-07 | 24 | 23 | 23 | 1 | 17 |
| 2025-08 | 24 | 22 | 22 | 2 | 18 |
| 2025-09 | 24 | 23 | 23 | 1 | 18 |
| 2025-10 | 24 | 22 | 22 | 2 | 18 |
| 2025-11 | 24 | 22 | 22 | 2 | 17 |
| 2025-12 | 24 | 23 | 23 | 1 | 17 |
| 2026-01 | 24 | 22 | 22 | 2 | 18 |
| 2026-02 | 24 | 23 | 23 | 1 | 18 |
| 2026-03 | 25 | 23 | 23 | 2 | 18 |
| 2026-04 | 24 | 22 | 22 | 2 | 17 |
| 2026-05 | 24 | 23 | 23 | 1 | 17 |
| 2026-06 | 24 | 22 | 22 | 2 | 18 |
| 2026-07 | 24 | 23 | 23 | 1 | 18 |
| 2026-08 | 24 | 22 | 22 | 2 | 18 |
| 2026-09 | 24 | 22 | 22 | 2 | 17 |
| 2026-10 | 24 | 23 | 23 | 1 | 17 |
| 2026-11 | 16 | 14 | 14 | 2 | 11 |
| 2026-12 | 0 | 0 | 0 | 0 | 0 |

## December 2026 staged events

One `authorization.request` per active merchant for month index 23, using the same day, hour, minute and amount rule as the seed. An `authorization.capture` follows two hours later for every request whose category is not telecom. The file ends with `ledger.settle_due` at `2027-01-01T00:05:00-05:00`. The 24 requests occupy 18 ET dates because some dates have two merchants. All 23 captures fall on the same ET date as their request. The counts in this section are the scheduled file. `--load` reports what Core committed.

| Month | Requests | Approved | Captured | Declined | Dates |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-12 | 24 | 23 | 23 | 1 | 18 |

Every other month in the window is zero for this file.

## Statement windows

Household statements stay on the household clock. Fixture (a), `stmt-2025-09` through `stmt-2026-10`, has `issued_at` `2026-11-18T17:00:00.000Z` on all 14 rows.

Freelancer seed statements are issued at the first instant of the following month in `America/New_York`. For those 22 rows, `issued_at` and `effective_at` are the same instant.

| Statement | issued_at | effective_at |
| --- | --- | --- |
| stmt-2025-01 | 2025-02-01T05:00:00.000Z | 2025-02-01T05:00:00.000Z |
| stmt-2025-02 | 2025-03-01T05:00:00.000Z | 2025-03-01T05:00:00.000Z |
| stmt-2025-03 | 2025-04-01T04:00:00.000Z | 2025-04-01T04:00:00.000Z |
| stmt-2025-04 | 2025-05-01T04:00:00.000Z | 2025-05-01T04:00:00.000Z |
| stmt-2025-05 | 2025-06-01T04:00:00.000Z | 2025-06-01T04:00:00.000Z |
| stmt-2025-06 | 2025-07-01T04:00:00.000Z | 2025-07-01T04:00:00.000Z |
| stmt-2025-07 | 2025-08-01T04:00:00.000Z | 2025-08-01T04:00:00.000Z |
| stmt-2025-08 | 2025-09-01T04:00:00.000Z | 2025-09-01T04:00:00.000Z |
| stmt-2025-09 | 2025-10-01T04:00:00.000Z | 2025-10-01T04:00:00.000Z |
| stmt-2025-10 | 2025-11-01T04:00:00.000Z | 2025-11-01T04:00:00.000Z |
| stmt-2025-11 | 2025-12-01T05:00:00.000Z | 2025-12-01T05:00:00.000Z |
| stmt-2025-12 | 2026-01-01T05:00:00.000Z | 2026-01-01T05:00:00.000Z |
| stmt-2026-01 | 2026-02-01T05:00:00.000Z | 2026-02-01T05:00:00.000Z |
| stmt-2026-02 | 2026-03-01T05:00:00.000Z | 2026-03-01T05:00:00.000Z |
| stmt-2026-03 | 2026-04-01T04:00:00.000Z | 2026-04-01T04:00:00.000Z |
| stmt-2026-04 | 2026-05-01T04:00:00.000Z | 2026-05-01T04:00:00.000Z |
| stmt-2026-05 | 2026-06-01T04:00:00.000Z | 2026-06-01T04:00:00.000Z |
| stmt-2026-06 | 2026-07-01T04:00:00.000Z | 2026-07-01T04:00:00.000Z |
| stmt-2026-07 | 2026-08-01T04:00:00.000Z | 2026-08-01T04:00:00.000Z |
| stmt-2026-08 | 2026-09-01T04:00:00.000Z | 2026-09-01T04:00:00.000Z |
| stmt-2026-09 | 2026-10-01T04:00:00.000Z | 2026-10-01T04:00:00.000Z |
| stmt-2026-10 | 2026-11-01T04:00:00.000Z | 2026-11-01T04:00:00.000Z |

The seed stops at `stmt-2026-10`. Applying the December file and its settle writes `stmt-2026-11` and `stmt-2026-12`. Fixture (c) has no statements.

## Deduplicated dates

Seeds alone: 424 distinct dates, 2025-01-01 to 2026-11-18, 23 of 24 months. The empty month is 2026-12.

Seeds plus the December events: 442 distinct dates, 2025-01-01 to 2026-12-28, 24 of 24 months.

| Month | Dates | Month | Dates |
| --- | ---: | --- | ---: |
| 2025-01 | 17 | 2026-01 | 21 |
| 2025-02 | 17 | 2026-02 | 19 |
| 2025-03 | 18 | 2026-03 | 19 |
| 2025-04 | 18 | 2026-04 | 20 |
| 2025-05 | 18 | 2026-05 | 19 |
| 2025-06 | 17 | 2026-06 | 20 |
| 2025-07 | 17 | 2026-07 | 20 |
| 2025-08 | 18 | 2026-08 | 20 |
| 2025-09 | 18 | 2026-09 | 19 |
| 2025-10 | 20 | 2026-10 | 19 |
| 2025-11 | 19 | 2026-11 | 13 |
| 2025-12 | 18 | 2026-12 | 18 |

## Remaining gaps

Fixture (a) activity starts on 2025-09-20. Fixture (b) covers the earlier months of the window. The freelancer seed has no December 2026 activity. That month is the staged event file. Household statements stay on the household clock. Freelancer seed statements are issued at the first instant of the following month.

## Provenance

Every record is synthetic. Fixture (a) is generated by `examples/generate-fixture.cjs`. Fixtures (b) and (c), and the December event file, are generated by `examples/generate-scale.cjs`. Merchant names in fixture (b) are a fixed invented list in that generator. There is no real anchor partition, because real card data cannot be collected for this App.

## Representative rows

Card numbers are omitted.

| Source | Row |
| --- | --- |
| (a) | `auth-w01`, decided `2025-09-20T12:12:00.000Z`, FreshCart, 4200 cents, approved |
| (b) | `auth-b-01-202501`, decided `2025-01-01T13:00:00.000Z`, Larkfield Grocer, 1100 cents, approved |
| (c) | `cr-owner-1`, created `2026-11-18T13:00:00.000Z`, `per_transaction` from 5000 to 8000 cents, `pending_owner` |

A December sample request is `b-dec-req-24` at `2026-12-01T19:40:00.000Z`, Vellum Keys, 2434 cents.

## Load query

`--load` on this tree:

| Stage | transactions.list | declines.list | statements | Last statement ids |
| --- | ---: | ---: | ---: | --- |
| (a) at its clock | 62 | 1 | 14 | stmt-2026-08, stmt-2026-09, stmt-2026-10 |
| (b) at its clock | 508 | 37 | 22 | stmt-2026-08, stmt-2026-09, stmt-2026-10 |
| (b) after December | 531 | 38 | 24 | stmt-2026-10, stmt-2026-11, stmt-2026-12 |

The first household transaction is `auth-w01`, FreshCart, 4200 cents, `2025-09-20T12:12:00.000Z`. The first freelancer transaction is `auth-b-01-202501`, Larkfield Grocer, 1100 cents, `2025-01-01T13:00:00.000Z`.

December apply results, from committed receipts: 24 `authorization.request` committed, 23 `authorization.capture` committed, 1 `ledger.settle_due` committed. Approved delta 23, decline delta 1, statement delta 2. The clock after the settle is `2027-01-01T00:05:00-05:00`.

Provenance on the snapshot after load:

| Stage | dataset_id | source_id | kind | records | tool |
| --- | --- | --- | --- | ---: | --- |
| (a) | keelcard-minimal | authored | synthetic | 2 | `apps/keelcard/examples/generate-fixture.cjs` |
| (b) | keelcard-minimal | freelancer | synthetic | 6 | `apps/keelcard/examples/generate-scale.cjs` |
| (b) after December | keelcard-minimal | freelancer | synthetic | 6 | `apps/keelcard/examples/generate-scale.cjs` |

Approvals, captures and declines in `--load` are counted from distinct transactions. Captures use `captured_at`. Those deltas have to match the scheduled December file. Duplicate receipts are reported on their own. Each list read has to return `status: ok` and its array. After the staged events the account has to contain `stmt-2026-11` and `stmt-2026-12`. That close comes from the December partition's `settle_at` in `contribution/dataset.json`, together with the seed's last statement. A missing settle, a missing statement, a rejected capture, a duplicate receipt, a reused authorization payload or a denied read exits unsuccessfully and names the gap in `problems`. The loaded bundle description is the selected source description.

A file that drops only `b-settle-2027-01` fails that check:

```sh
node -e '
const { loadQueries } = require("./apps/keelcard/examples/coverage-report.cjs");
const events = require("./apps/keelcard/examples/events/freelancer-2026-12.json").filter(event => event.event_id !== "b-settle-2027-01");
const result = loadQueries({ events, runId: "missing-settle" });
if (result.ok !== false) process.exit(1);
console.log(result.stages.b_after_december.problems.join("\n"));
'
```
