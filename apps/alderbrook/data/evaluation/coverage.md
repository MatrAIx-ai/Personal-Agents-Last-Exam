# Alderbrook evaluation data: coverage

Written by `node apps/alderbrook/dev/coverage.cjs` from the files in this folder. Do not edit it by hand. The full numbers are in `coverage.json`.

- Scope: Environment evaluation dataset of the Alderbrook App: every delivered account seed in data/evaluation/, as env.load_seed loads it. This is not a Task history report.
- Provenance: all 36 account seeds are synthetic. Real records: 0. Mixed: 0.
- Time zone: `America/New_York`. Window: 2025-01-01 to 2026-12-31. Seed clock: `2027-01-01T00:00:00-05:00`.
- Rule: Each lifecycle step counts on its calendar day in America/New_York. A step counts when its day is inside the window and its time is before the seed clock. Several steps on one day count once.
- Totals: 36 accounts, 181 policy terms, 72 claims, 894 lifecycle steps. 838 steps count. 56 are excluded, and 0 scheduled items are listed apart.
- Distinct dates: **362** of 730 days in the window (322 weekdays, 40 weekend days). Earliest 2025-01-02, latest 2026-12-30.
- Hash check against `manifest.json`: every seed and binding matches.

## Date field of each lifecycle step

| Step | Records | Date field | Steps counted | Distinct dates | Earliest | Latest |
| --- | --- | --- | ---: | ---: | --- | --- |
| claim_filed | `claims[]` | `filed_at` | 66 | 61 | 2025-01-12 | 2026-12-25 |
| evidence_added | `claims[].evidence[]` | `added_at` | 216 | 105 | 2025-01-12 | 2026-12-29 |
| request_issued | `claims[].requests[]` | `issued_at` | 62 | 55 | 2025-01-02 | 2026-12-28 |
| request_answered | `claims[].requests[].asks[].answer` | `answered_at` | 109 | 55 | 2025-01-04 | 2026-12-29 |
| estimate_submitted | `claims[].estimates[]` | `submitted_at` | 72 | 68 | 2025-01-03 | 2026-12-30 |
| determination_issued | `claims[].determinations[]` | `issued_at` | 68 | 66 | 2025-01-08 | 2026-12-28 |
| dispute_opened | `claims[].disputes[]` | `opened_at` | 7 | 7 | 2025-03-08 | 2026-07-19 |
| dispute_decided | `claims[].disputes[]` | `decided_at` | 7 | 7 | 2025-03-12 | 2026-07-23 |
| offer_issued | `claims[].offers[]` | `issued_at` | 10 | 10 | 2025-02-05 | 2026-05-21 |
| offer_answered | `claims[].offers[]` | `answered_at` | 9 | 9 | 2025-02-08 | 2026-05-22 |
| rental_started | `claims[].rentals[]` | `start_at` | 13 | 13 | 2025-01-13 | 2026-11-04 |
| rental_ended | `claims[].rentals[]` | `end_at` | 13 | 13 | 2025-02-05 | 2026-12-07 |
| payment_issued | `claims[].payments[]` | `issued_at` | 85 | 81 | 2025-01-10 | 2026-12-30 |
| repair_completed | `claims[]` | `repair_completed_at` | 37 | 37 | 2025-01-17 | 2026-12-07 |
| claim_closed | `claims[]` | `closed_at` | 62 | 61 | 2025-01-08 | 2026-12-16 |
| claim_withdrawn | `claims[]` | `withdrawn_at` | 2 | 2 | 2026-07-20 | 2026-07-31 |

Not counted: `policies[].term.start, policies[].term.end` (Policy effective and expiration dates are context, not claim activity); `claims[].loss_at` (The time of the loss. The claim counts on its filing day); `claims[].evidence[].dated` (When a photo or receipt was made. The evidence counts on the day it was added to the claim); `claims[].estimates[].lines[].decisions[].decided_at` (A line decision is part of its determination or its dispute decision, and it has the same time. That step already counts); `notifications[].at` (The App writes one notification for each insurer event, at the time of that event. So it repeats a counted date); `activity[].at, claims[].history[].at` (The App log of every write and event. It also holds writes that keep no dated record of their own (payee.set, claims.update, preferences.update). Their dates are left out, so the count is lower than the log. See context.activity_only_dates); `requests[].due_at, offers[].respond_by` (Deadlines. When one is after the seed clock it is listed under scheduled).

## Monthly coverage

Steps per month by group, in America/New_York. One source: the synthetic generator.

| Month | Distinct dates | Steps | Filed | Evidence | Requests | Estimates | Decisions | Disputes | Offers | Rentals | Payments | Repairs done | Closed or withdrawn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2025-01 | 16 | 32 | 2 | 5 | 8 | 4 | 3 | 0 | 0 | 2 | 3 | 2 | 3 |
| 2025-02 | 15 | 37 | 2 | 12 | 7 | 2 | 1 | 0 | 4 | 2 | 5 | 1 | 1 |
| 2025-03 | 17 | 31 | 2 | 7 | 6 | 3 | 3 | 2 | 0 | 1 | 3 | 1 | 3 |
| 2025-04 | 10 | 19 | 3 | 4 | 2 | 1 | 2 | 0 | 0 | 1 | 2 | 2 | 2 |
| 2025-05 | 20 | 67 | 5 | 25 | 14 | 6 | 5 | 2 | 0 | 2 | 6 | 0 | 2 |
| 2025-06 | 18 | 39 | 2 | 6 | 8 | 4 | 5 | 0 | 0 | 1 | 5 | 3 | 5 |
| 2025-07 | 20 | 58 | 4 | 16 | 10 | 6 | 6 | 4 | 0 | 1 | 7 | 1 | 3 |
| 2025-08 | 10 | 19 | 1 | 3 | 4 | 1 | 1 | 0 | 0 | 0 | 2 | 3 | 4 |
| 2025-09 | 18 | 41 | 3 | 13 | 8 | 4 | 4 | 0 | 4 | 0 | 3 | 0 | 2 |
| 2025-10 | 9 | 16 | 1 | 5 | 4 | 0 | 0 | 0 | 0 | 1 | 1 | 2 | 2 |
| 2025-11 | 11 | 21 | 3 | 7 | 3 | 3 | 3 | 0 | 0 | 0 | 2 | 0 | 0 |
| 2025-12 | 22 | 50 | 2 | 9 | 8 | 5 | 4 | 0 | 4 | 3 | 7 | 4 | 4 |
| 2026-01 | 14 | 32 | 3 | 12 | 6 | 2 | 2 | 1 | 0 | 0 | 3 | 1 | 2 |
| 2026-02 | 15 | 30 | 3 | 6 | 7 | 3 | 2 | 1 | 0 | 0 | 2 | 2 | 4 |
| 2026-03 | 16 | 34 | 3 | 8 | 9 | 1 | 2 | 0 | 3 | 1 | 3 | 2 | 2 |
| 2026-04 | 20 | 53 | 4 | 9 | 11 | 7 | 6 | 2 | 2 | 2 | 6 | 2 | 2 |
| 2026-05 | 17 | 44 | 3 | 11 | 9 | 3 | 3 | 0 | 2 | 2 | 4 | 2 | 5 |
| 2026-06 | 17 | 41 | 4 | 11 | 9 | 2 | 2 | 0 | 0 | 3 | 4 | 2 | 4 |
| 2026-07 | 13 | 26 | 3 | 9 | 4 | 1 | 1 | 2 | 0 | 0 | 2 | 0 | 4 |
| 2026-08 | 8 | 11 | 0 | 1 | 2 | 2 | 2 | 0 | 0 | 0 | 2 | 1 | 1 |
| 2026-09 | 7 | 10 | 1 | 3 | 2 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 |
| 2026-10 | 19 | 44 | 5 | 13 | 9 | 5 | 5 | 0 | 0 | 1 | 4 | 1 | 1 |
| 2026-11 | 17 | 36 | 2 | 6 | 6 | 3 | 3 | 0 | 0 | 2 | 5 | 4 | 5 |
| 2026-12 | 13 | 47 | 5 | 15 | 15 | 3 | 2 | 0 | 0 | 1 | 3 | 1 | 2 |

## Gaps

- Months with no activity: none.
- Days with no activity: 368, in 155 runs. 186 of them are weekends or holidays, when the insurer does not work.
- Longest runs with no activity: 2025-08-15 to 2025-08-25 (11 days), 2026-08-21 to 2026-08-30 (10 days), 2026-09-05 to 2026-09-14 (10 days), 2026-03-14 to 2026-03-22 (9 days), 2026-09-25 to 2026-10-02 (8 days), 2025-04-17 to 2025-04-23 (7 days), 2025-10-21 to 2025-10-26 (6 days), 2025-11-01 to 2025-11-06 (6 days), 2026-06-16 to 2026-06-21 (6 days), 2026-08-11 to 2026-08-16 (6 days).

## Exclusions and scheduled items

- Excluded steps: 56. 56: Before the coverage window: the claim started in late 2024.
- Scheduled items after the seed clock: 0. Deadlines after the seed clock: the due time of an open request and the answer time of an open offer. They are future items, not past activity.

## Accounts

| Account | Policy terms | Claims | Claim states | Steps counted | Distinct dates | Earliest | Latest |
| --- | ---: | ---: | --- | ---: | ---: | --- | --- |
| alderbrook-underhill | 8 | 2 | closed:paid 2 | 29 | 19 | 2026-01-18 | 2026-11-05 |
| alderbrook-ingram | 6 | 2 | closed:paid 2 | 13 | 9 | 2025-01-12 | 2025-02-12 |
| alderbrook-galloway | 6 | 1 | closed:denied 1 | 11 | 6 | 2025-09-01 | 2025-09-18 |
| alderbrook-sandoval | 3 | 2 | closed:paid 1, withdrawn 1 | 15 | 9 | 2026-03-05 | 2026-07-20 |
| alderbrook-quintero | 3 | 2 | closed:paid 1, open 1 | 22 | 15 | 2025-07-06 | 2026-12-30 |
| alderbrook-okonkwo | 7 | 1 | closed:paid 1 | 16 | 10 | 2025-11-16 | 2025-12-24 |
| alderbrook-lindgren | 3 | 1 | closed:paid 1 | 21 | 14 | 2025-01-17 | 2025-03-07 |
| alderbrook-moreau | 3 | 2 | closed:paid 2 | 16 | 10 | 2025-01-08 | 2026-02-13 |
| alderbrook-yamamoto | 3 | 3 | closed:paid 3 | 48 | 30 | 2025-02-04 | 2025-12-22 |
| alderbrook-kerrigan | 3 | 3 | closed:paid 2, open 1 | 32 | 18 | 2025-05-17 | 2026-12-29 |
| alderbrook-pellegrino | 6 | 2 | closed:paid 2 | 26 | 15 | 2025-04-27 | 2025-10-20 |
| alderbrook-esposito | 6 | 1 | closed:denied 1 | 7 | 5 | 2026-02-01 | 2026-02-17 |
| alderbrook-lombardi | 7 | 1 | closed:paid 1 | 13 | 11 | 2025-07-07 | 2025-08-13 |
| alderbrook-delgado | 3 | 1 | closed:paid 1 | 7 | 5 | 2026-04-30 | 2026-05-12 |
| alderbrook-kowalczyk | 6 | 2 | closed:paid 1, closed:denied 1 | 33 | 19 | 2025-12-10 | 2026-06-02 |
| alderbrook-ostrowski | 3 | 1 | closed:paid 1 | 7 | 6 | 2026-02-26 | 2026-03-09 |
| alderbrook-novak | 7 | 2 | closed:paid 2 | 11 | 8 | 2026-04-01 | 2026-05-01 |
| alderbrook-haddad | 7 | 2 | closed:paid 2 | 30 | 18 | 2026-01-31 | 2026-09-04 |
| alderbrook-castellano | 4 | 1 | closed:paid 1 | 17 | 10 | 2025-03-09 | 2025-04-11 |
| alderbrook-vasquez | 6 | 3 | closed:paid 2, closed:denied 1 | 41 | 24 | 2025-02-22 | 2026-11-24 |
| alderbrook-fairbanks | 4 | 2 | closed:paid 2 | 20 | 17 | 2025-01-02 | 2026-05-04 |
| alderbrook-gallagher | 7 | 3 | closed:paid 1, closed:denied 1, withdrawn 1 | 26 | 16 | 2025-05-16 | 2026-07-31 |
| alderbrook-zielinski | 6 | 2 | closed:denied 1, closed:paid 1 | 22 | 13 | 2025-04-27 | 2026-08-04 |
| alderbrook-rasmussen | 3 | 2 | closed:paid 2 | 31 | 18 | 2026-06-02 | 2026-12-16 |
| alderbrook-oyelaran | 6 | 4 | closed:paid 3, closed:denied 1 | 46 | 27 | 2025-07-10 | 2026-11-06 |
| alderbrook-jablonski | 3 | 2 | closed:paid 2 | 21 | 16 | 2025-01-03 | 2025-06-23 |
| alderbrook-prescott | 4 | 1 | closed:paid 1 | 11 | 7 | 2025-12-15 | 2026-01-06 |
| alderbrook-nakashima | 8 | 3 | closed:paid 2, closed:no_response 1 | 29 | 21 | 2025-11-27 | 2026-11-18 |
| alderbrook-bergstrom | 3 | 4 | closed:paid 3, open 1 | 51 | 31 | 2025-05-29 | 2026-12-29 |
| alderbrook-abernathy | 6 | 4 | closed:paid 4 | 62 | 43 | 2025-05-03 | 2026-05-19 |
| alderbrook-iverson | 6 | 2 | closed:paid 1, open 1 | 16 | 10 | 2025-11-30 | 2026-12-30 |
| alderbrook-donnelly | 3 | 3 | closed:paid 3 | 27 | 19 | 2026-05-14 | 2026-11-25 |
| alderbrook-brightwater | 7 | 1 | closed:paid 1 | 16 | 10 | 2025-04-26 | 2025-06-05 |
| alderbrook-whitfield | 6 | 1 | closed:no_response 1 | 4 | 4 | 2026-11-18 | 2026-12-14 |
| alderbrook-hollis | 3 | 2 | closed:paid 1, open 1 | 25 | 15 | 2026-05-08 | 2026-12-30 |
| alderbrook-thibodeau | 6 | 1 | closed:paid 1 | 16 | 11 | 2026-03-30 | 2026-05-06 |

## Context that is not counted

| Field | Records | In window | Distinct dates in window | Earliest | Latest |
| --- | ---: | ---: | ---: | --- | --- |
| `loss_at` | 72 | 66 | 63 | 2024-11-16 | 2026-12-24 |
| `evidence_dated` | 235 | 196 | 115 | 2019-01-14 | 2026-12-29 |
| `notifications` | 419 | 394 | 281 | 2024-11-18 | 2026-12-30 |
| `activity` | 845 | 793 | 366 | 2024-11-17 | 2026-12-30 |
| `activity_only_dates` |  |  |  |  |  |

Policy terms: 181 records. Their dates are context only.

Dates in the window that only the activity log has: 4 (payee.set). They are not counted.

`coverage.json` lists, for each counted date, the IDs of the records behind it as `account/claim/step/record`.
