# Brindle delivery dataset, 2025 to 2026

This folder holds the delivery dataset of Brindle Card. It is the history of one cardholder account: Riley Hart (`brindle-riley`, owner `person-riley`) on the Brindle Reserve card at the fictional issuer Brindle Card. The account opened on 2 December 2024. The window of the dataset is 1 January 2025 to 31 December 2026.

**Every record is synthetic.** Brindle models no real issuer or website (open question 5 of the plan). The issuer, the cardholder, the merchants, the banks and the loyalty programs are made up, and the records hold no card number. No record is an observed fact.

**No real-data anchor.** Section 3 of `docs/submission-evidence.md` asks for real source data from around November 2026 as an anchor when a website's earlier data cannot be retrieved. That rule does not fit here. There is no real website to collect from, and real card statements are private personal data. So every record is synthetic, and the coverage report counts 0 real and 0 mixed rows.

The small fixtures stay as they are. `fixtures/minimal.json` and `examples/task-data/seed.json` are smoke and acceptance fixtures. They are not this dataset.

## Files

| File | What it is |
| --- | --- |
| `seed.json` | The seed, as compact JSON. It has the App's own seed schema, and `env.load_seed` loads it as it is. |
| `clock.json` | The time to load it with: `2026-12-31T23:00:00-05:00`. |
| `dataset.json` | Provenance in the `pale.dataset.v1` format: one source, `evaluation-generator`, of kind `synthetic`, named in `record_source_ids`. `contribution/dataset.json` declares the same source with the same generation, and the size and SHA-256 of `seed.json`, `clock.json` and `dataset.json`. Pass this file in the `bundle` of `env.load_seed`. |
| `manifest.json` | The generator version, the PRNG and its seed, the step counts, the file sizes and hashes, and every story: its ID, its template, its facts and the IDs of its records. |
| `coverage.json`, `coverage.md` | The date coverage report, made from `seed.json` by `dev/coverage.cjs`. |

## How it is made

`dev/generate-dataset.cjs` writes the first four files in two steps.

1. It builds a list of stories from the templates in `dev/evaluation-scenarios.cjs`, with a small PRNG (mulberry32, seed `20241202`). A story fixes all its parts together, with amounts, times and texts drawn inside the ranges of its own template. No part of a story is picked on its own.
2. It replays every step of every story in time order through the App's own hooks: `handleTool` for Riley's writes and `applyEvent` for the issuer and the merchants. Each step's input or event schema is checked, the seed rules run after each step, and the full seed schema is checked at each month start and at the end. So the App accepted every step, and the App made every payment, dispute, redemption and notification. The statement amounts and the points of each cycle are read from the App's data at that time.

A rerun gives the same bytes on Node 18 and Node 22. `--check` writes nothing. It fails when a committed file differs, when the `env.load_seed` request line is above 1.8 MiB (Core reads at most 2 MiB), when the replay takes more than 20 seconds, or when a story rule is broken.

The templates (31 in the manifest):

- **The account and its cycle.** Credit limit 9,000.00. A statement closes on the 27th at 23:59:59, is issued at 02:00 the next day and is due on the 22nd of the next month at 17:00. The issuer's minimum is 1 percent of the balance plus the interest and fees of the cycle, at least 35.00. Points are earned at 04:00 the day after each statement: 2 a dollar for dining and travel, 1 a dollar for the rest. Riley turns on email notices on 9 February 2025, so the first notifications have no email.
- **Everyday spending.** Groceries at two stores, mostly on the weekend; fuel every 6 to 9 days with a hold of 150.00; lunch and dinner at three places, held at the bill and posted with a tip of 15 to 22 percent; coffee, transit, rides, errands and online orders. Each merchant has fixed days, hours and an amount range.
- **Subscriptions** with a fixed day, price and time: Ironworks Gym, Streamlet TV (17.99 from July 2026), Reelhouse Plus (cancelled in February 2026), Cloudnest Storage and Kestrel Mobile.
- **Four trips** (July and December of each year): the flight bought weeks ahead, a hotel hold at check-in that is dropped at checkout and replaced by the final charge, and dining and transit at the destination. Before two trips Riley moves points to a partner: Skyway Miles for an award ticket (the card pays only its taxes and fees) and Larch Hotels Rewards for one hotel night.
- **Returns and refunds**: four full returns, three refunds of one item of an order, and a flight cancelled by the airline and refunded in full.
- **Eight disputes, one story each**, in every state: an order that never arrived (resolved for Riley), a dinner charged twice (the restaurant refunds the copy and Riley withdraws), a hotel that charged a night too many (resolved for Riley), a laptop sold as new (resolved for the merchant, credit reversed), a gym that refunded only part of a fee (the gym refunds the rest, closed as matched), a charge Riley did not recognize (withdrawn, then reversed), a plan that charged after it was cancelled (resolved for Riley), and an order of November 2026 that is still open at the clock.
- **Payments**: the opening statement paid by hand in January 2025, then autopay of the statement balance; a payment in full before the July 2025 trip, so that month's autopay reads `skipped`; a bank change in August 2025, where the closed account returns the autopay payment, the account reads `past_due`, a returned-payment fee of 29.00 posts the next day and Riley pays from the new bank; a payment scheduled twice by mistake and cancelled the same evening; and a car repair in April 2026, with autopay of the minimum for two cycles, two payments by hand and interest.
- **Interest and fees**: interest at 23:00 on the closing day after a statement that was not paid in full by its due time, at 24.24 percent a year (one twelfth of it on the unpaid amount). The interest model is simple: interest is charged once for each statement not paid in full by its due time, and none is charged after the carried balance is paid off, so there is no trailing interest. The annual fee of 550.00 on 2 December 2025 and 2 December 2026; the first year's fee was waived.
- **16 offers**, each with its terms, numbers, answer and payout fixed together, and two redemptions of points as statement credits.

`dev/check-evaluation.cjs` checks 14 story rules on the delivered seed and on each month-start seed: story, merchant, posting, refund, dispute, offer, fees, statement, interest, payments, points, times, names and notifications. `dev/check-fixture.cjs --evaluation` checks that every statement balance, recovery summary, points balance, payment state, offer condition and flag follows from the records.

## The opening month, the clock and late 2026

The account opened on 2 December 2024, so a seed of 1 January 2025 has an account that already exists. The history of December 2024 (the opening statement, its transactions, its points entry and two notifications) is in the seed as opening history. The coverage report excludes it with that reason.

The seed is read at `2026-12-31T23:00:00-05:00`, the last hour of the window, so every record of 2025 and 2026 is in the past. At the clock:

- the December 2026 statement (closing 27 December) has its autopay payment for 22 January 2027, still `scheduled`;
- two restaurant bills of 30 and 31 December are still `pending`;
- the dispute of the November 2026 order is `open` with its temporary credit;
- the three retention offers of 4 December 2026 are `available` until 8 January 2027;
- `fee_refund_open` is on: the annual fee of 2 December 2026 is refunded on closing until 1 January 2027.

A task that starts earlier should not load this seed. It should use a seed "as of" its start time:

```sh
node apps/brindle/dev/select-evaluation-seed.cjs --as-of 2026-06-01T00:00:00-04:00 --out /tmp/brindle-as-of.json
```

The script replays only the steps strictly before that time. So the seed holds no later record, and each record is in its state at that time. Then it scans every timestamp and date at any depth (history rows, notifications and their stored messages included) and refuses the seed when one is later. The only later values allowed are due times of a schedule: a statement's `due_at`, the `pay_on` and `posts_at` of a payment that has not posted (scheduled, or cancelled before its day), and an offer's `accept_by`, which its terms state. The script refuses a time without a UTC offset, a time before the account opened (`2024-12-02T10:30:00-05:00`) and a time after the clock. At the clock it gives `seed.json` byte for byte. Load the result with the same time as `virtual_now`.

## Coverage

The report counts only what happened, in `America/New_York`. Each family has one date field. A payment is split into its acts: the request, the posting of money and a return, each at its own time.

| Family | Date field |
| --- | --- |
| Transactions | `transactions[].transaction_at` |
| Statements | `statements[].closing_at` |
| Payment requests | `payments[].history[].at` of `payments.schedule`, `autopay.scheduled` and `payments.cancel` |
| Payment postings | `payments[].posts_at` of a payment that moved money (`posted`, or `returned` after it posted) |
| Payment returns | `payments[].returned_at` |
| Disputes | `disputes[].opened_at` |
| Offers | `offers[].issued_at` |
| Points entries | `points_entries[].at` |
| Notifications | `notifications[].at` |

A cancelled payment (`pay-0014`, planned for 27 October 2025), the skipped autopay payment (`pay-0007`, 22 July 2025) and the autopay payment still scheduled for 22 January 2027 (`pay-0031`) moved no money. They add no posting. Their planned day (`pay_on`) is listed apart in the report and never counted. Their request and cancel acts count on the days they happened. Excluded, with reasons: the opening history of December 2024 (before the window). Due times (statement due times and offer deadlines) are listed apart and never counted. A hotel hold that was later released counts on the day the hold was placed, because the hold did happen. Activity rows are not counted, because each repeats an act that a counted record already dates.

## Counts

- 1,500 App records: 25 statements (24 in the window and the opening one), 1,389 transactions, 31 payments, 8 disputes, 16 offers and 31 points entries. Also 103 notifications and 1,949 activity rows. The manifest has 1,220 stories, made by 1,813 steps (1,778 events and 35 writes).
- Transactions: 1,356 purchases (4 hotel holds dropped and 2 bills pending at the clock), 12 refunds, 7 temporary credits, 3 reversals, 5 credits (3 offer payouts and 2 redemptions), 3 fees (2 annual and 1 returned-payment fee) and 3 interest charges.
- 1,579 rows are counted, on **666 distinct dates** of the 730 days, from 1 January 2025 to 31 December 2026. The payment rows are 32 requests, 28 postings and 1 return. Every month has records. The longest span with no record is 2 days. 54 rows are excluded, each with its reason.
- Real: 0. Mixed: 0. Synthetic: all.
- `seed.json` is 1,324,198 bytes. The `env.load_seed` request line is about 1.27 MiB.

A card account has activity almost every day, so one account fills the window with no filler.

## Commands

From the repository root:

```sh
node apps/brindle/dev/generate-dataset.cjs --check
node apps/brindle/dev/coverage.cjs --check
node apps/brindle/dev/select-evaluation-seed.cjs --check
node apps/brindle/dev/check-fixture.cjs --evaluation
node apps/brindle/tests/evaluation.integration.cjs --runtime runtime --report .artifacts/brindle-evaluation.json
```

Without `--check`, the first two commands write the files again. `tests/evaluation.integration.cjs` starts a real App instance with the public runtime. It loads the seed with `env.load_seed`, reads it with the Agent's MCP read tools and compares the counts with `coverage.json`. It does the same for a seed as of 1 June 2026. Without the runtime it prints `SKIP` and exits 77. The load call is:

```json
{"expected_version": "<current>", "request_id": "evaluation-seed", "data": "<seed.json>", "binding": "<fixtures/binding.json>",
 "policies": "<fixtures/policies.json>", "bundle": {"dataset": "<dataset.json>", "catalog": "<contribution/assets.catalog.json>", "blobs": {}},
 "virtual_now": "2026-12-31T23:00:00-05:00"}
```

Then, for example, `brindle.statements.list` with `{"start": "2025-01-01", "end": "2026-12-31"}` returns the 24 statements of the window, and `brindle.transactions.list` with `{"start": "2026-03-01", "end": "2026-03-31"}` returns the transactions of March 2026. `transactions.list` has no pagination, so read month windows: the whole list is about 1,400 rows.
