# Alderbrook evaluation data

This folder is the evaluation dataset of the Alderbrook App. It covers 2025-01-01 to 2026-12-31. The small seeds in `fixtures/` and `examples/task-data/` stay as smoke fixtures.

**Every record is synthetic.** The insurer, the people, the shops, the lenders, the vehicles and the policies are fictional. No record was observed or collected, so no part of this folder is real or mixed data. Records dated after the day they were generated are synthetic in the same way as the others.

There is no real-data anchor. The submission rule asks for real source data from around November 2026 when a website's earlier data cannot be retrieved. Alderbrook Mutual is a fictional insurer with no website, and real claim records belong to private policyholders and are not public. So there is no real source to collect, and every record here is synthetic.

## What is here

| File | What it holds |
| --- | --- |
| `accounts/<account_id>.seed.json` | One seed for `env.load_seed`: one policyholder account with its policy terms, claims, notifications and activity rows. It uses the App's seed schema unchanged. |
| `accounts/<account_id>.binding.json` | The people and accounts of that seed, for the `binding` of `env.load_seed`. |
| `manifest.json` | The generator version and seed, the seed clock, and the SHA-256, size and counts of every seed and binding. |
| `coverage.json`, `coverage.md` | The coverage report, written by `dev/coverage.cjs` from the seed files. |

36 accounts hold 72 claims: 30 collision, 25 comprehensive and 17 renters personal property claims. 56 are closed as paid, 7 as denied and 2 with no response, 2 are withdrawn, and 5 are still open at the seed clock. The stories of those 5 open claims go on after the clock: their 24 later steps are not in the seeds. A claim whose approved total is not more than the deductible closes as `denied`, because the App's closing outcomes are only `paid`, `denied` and `no_response`. Its written decision and its closing note both say that the total is under the deductible. 6 claims are total losses with settlement offers. The others follow the repair path, some with supplements, disputes, rentals and payments to a shop.

## Why 36 accounts

One App instance holds one policyholder, and a real household files about 0 to 2 claims a year. So one account cannot give a realistic two-year history on its own. The dataset is a book of 36 households that each have 1 to 4 claims, and every household has at least one claim with steps inside the window. That is about one claim per household per year, which fits households with two or three cars, teen drivers or a renters policy. Together their claims put lifecycle steps in every month of the window, with no filler records.

The claim lifecycle gives activity on **362 distinct dates** of the 730 days in the window, and every month has 7 to 22 active dates. The insurer works on office days only, so 186 of the 368 days with no activity are weekends or holidays.

The generator weights each scenario by month. Some scenarios can only happen in season: ice collisions from November to March, frozen pipes from December to February, and hail from April to September. Each scenario has only a few claims, so the delivered months show the weights only roughly. 5 of the 7 deer claims were filed from October to December, the 2 ice collisions and the 1 frozen pipe were filed in December or January, and the 1 hail claim was filed in May. `coverage.md` lists the monthly counts and every gap.

## How the data is made

Each claim is one scenario of `dev/evaluation-scenarios.cjs`, for example a rear-end collision at a light, a deer at dusk, a branch on the roof or a burst pipe. A scenario fixes the loss text, the loss time rule (for example overnight, at dusk or on a workday), the repair lines or items, the hidden damage that a supplement may add, the evidence, the reason the insurer may give for each line, and the dispute that answers each reason. Every part of a claim comes from inside its one scenario, and `manifest.json` names the scenario of every claim.

`dev/generate-evaluation-data.cjs` builds each claim as a story: policyholder writes (`claims.file`, `requests.respond`, `determinations.dispute`, `offers.accept`, `rental.start` and others) and insurer, shop and lender events (`request.issued`, `estimate.submitted`, `determination.issued`, `payment.issued` and others). It replays every step through the App's own hooks, at the step's own time, with the input schema and the seed rules checked after each step. So every record follows the App's rules, and IDs, amounts and states are what the App itself wrote.

- The random source is a small PRNG (mulberry32) with the fixed seed `20251231`. A rerun gives the same bytes on Node 18 and Node 22.
- Every seed is read at the clock `2027-01-01T00:00:00-05:00`, the end of the window. A story step at or after the clock is not in the seed.
- Each policy term is its own policy record, so its vehicle and address IDs end with the term (for example `veh-1-2503`). A totaled car is replaced from the next term on.
- Some claims started in late 2024. Their 2024 steps are in the seed but are not counted.
- `dev/check-fixture.cjs --evaluation` checks 18 story rules on every claim: lines, supplements, reasons, disputes, invoices and estimate sources fit the scenario, every part that the loss text names has a line, each item is approved or denied by its own proof, staff, policyholders and other drivers share no surnames, loss times fit words such as overnight, at dusk or at work, evidence dates and receipts fit the loss and the item ages, and no payment is below 25.00.

## Commands

From the repository root:

```sh
node apps/alderbrook/dev/generate-evaluation-data.cjs --check   # the files are what the fixed seed gives
node apps/alderbrook/dev/coverage.cjs --check                   # the report matches the seed files
node apps/alderbrook/dev/check-fixture.cjs --evaluation         # cross-record checks on every seed
node apps/alderbrook/tests/evaluation.integration.cjs --runtime runtime --report .artifacts/evaluation-load.json
```

Drop `--check` to write the files again. The last command loads every seed into a real App instance and reads it back through MCP (see below).

## Dates that count

The report counts each dated claim lifecycle step on its calendar day in `America/New_York`. A step counts when its day is in the window and its time is before the seed clock. Several steps on one day count once.

| Step | Date field |
| --- | --- |
| Claim filed, withdrawn, repair completed, claim closed | `claims[].filed_at`, `withdrawn_at`, `repair_completed_at`, `closed_at` |
| Evidence added | `claims[].evidence[].added_at` |
| Information request issued, ask answered | `claims[].requests[].issued_at`, `asks[].answer.answered_at` |
| Estimate submitted | `claims[].estimates[].submitted_at` |
| Determination issued | `claims[].determinations[].issued_at` |
| Dispute opened, dispute decided | `claims[].disputes[].opened_at`, `decided_at` |
| Offer issued, offer answered | `claims[].offers[].issued_at`, `answered_at` |
| Rental started, rental ended | `claims[].rentals[].start_at`, `end_at` |
| Payment issued | `claims[].payments[].issued_at` |

Not counted: policy effective and expiration dates (context only), the loss time, the date of a photo or receipt, line decision times (they repeat the time of their determination or dispute decision), notifications (they repeat the time of their event), and the activity log. The log also holds writes with no dated record of their own, such as `payee.set`, so it has 4 dates in the window that the count leaves out. `coverage.json` lists them, and it lists the record IDs behind every counted date. A request due time or an offer answer time after the seed clock is a scheduled item, and the report lists it apart from past activity. The current seeds have none.

## Load and query

A task loads one account with Infra's `env.load_seed`, and the Agent reads it with the read tools:

```js
const seed = require('./apps/alderbrook/data/evaluation/accounts/alderbrook-yamamoto.seed.json');
const binding = require('./apps/alderbrook/data/evaluation/accounts/alderbrook-yamamoto.binding.json');
await infra.call('env.load_seed', {expected_version, request_id: 'load-1', data: seed, binding, policies, virtual_now: '2027-01-01T00:00:00-05:00'});
await agent.call('alderbrook.claims.list', {start: '2025-03-01T00:00:00-05:00', end: '2025-03-31T23:59:59-04:00'});
await agent.call('alderbrook.claims.get', {id: 'clm-0002'});
```

`tests/evaluation.integration.cjs` does this for all 36 accounts. It checks that the snapshot holds each seed byte for byte, that `claims.get` gives the same lifecycle steps and dates as `coverage.json`, and that `claims.list` and `payments.list` with monthly windows give the monthly counts of the report. Its report also shows a few representative claims.

## A seed as of an earlier time

A task must not see later records as history. `dev/select-evaluation-seed.cjs` writes the seed of one account as of a given time. It replays only the steps before that time, so each record is in its state at that time, and policy terms that start later are left out:

```sh
node apps/alderbrook/dev/select-evaluation-seed.cjs --account alderbrook-yamamoto --as-of 2025-04-01T09:00:00-04:00 --out .artifacts/selected
```

Load the result with `virtual_now` equal to `--as-of`. At the seed clock the selected seed is the delivered seed byte for byte.
