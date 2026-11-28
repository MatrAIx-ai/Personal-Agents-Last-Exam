# Mendwell delivery dataset: coverage

Environment dataset coverage of the Mendwell delivery dataset mendwell-delivery-2025-2026, whole window. Not a Task history report: a Task reports its own selection after its first-session cutoff (dataset/as-of.cjs).

- Dataset: `mendwell-delivery-2025-2026`; window 2025-01-01 to 2026-12-31 inclusive; time zone `America/New_York`; reference clock (the fixture clock) `2026-11-18T12:00:00-05:00`.
- Reproduce: `node dataset/generate.cjs --check`, then `node dataset/coverage.cjs --check` from `apps/mendwell-pharmacy`. This file and `COVERAGE.json` are written by `dataset/coverage.cjs`.
- Counting: Every timestamp is ISO 8601 with its offset; each is converted to its calendar date in America/New_York before counting. Date-only fields (a prescription's written_on, a claim's eligible_on) are not occurrence dates and are not counted. A date counts once however many records or sources fall on it. A required occurrence date (received_at, requested_at, created_at or at) that is missing or not a valid ISO 8601 instant with the offset in force, and a record outside the window, is excluded from the count and listed by ID; closed_at and revoked_at are required only of closed fills and revoked grants. There are none.
- Smoke fixture and delivery dataset: `fixtures/minimal.json` and this dataset share the household and the catalog (equal at the fixture clock, store stock included, checked by `tests/t32-dataset.test.cjs`) but have independent histories. The fixture serves the business tests, the examples and the proposal's example events; the dataset serves evaluation, and Tasks select their history from it with `dataset/as-of.cjs`. Their IDs overlap but name different records: the dataset uses the App's own runtime series (`rx-1`, `f-1`, `cl-1`, `g-1`, `n-1`, …), while the fixture keeps its history in the `h` series and its task-timeline notices in the `t` series; the fixture's `f-15`, `rx-9`, `g-3` and the other IDs named by the proposal's example events are not the dataset's.

## Sources

| File | Role | Kind | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| `dataset/base.json` | Seed at the window start 2025-01-01T00:00:00-05:00: the household, prescribers, drugs with their 24 facts paraphrased from the cited DailyMed labels, plans, cash prices, stores (stock before the restocks) and cards; no records. | mixed | 26878 | `1ae30ba0d64def8e42034bf9ba1a9e48ded71419c9609df7357e9619c3f1228f` |
| `dataset/replay.json` | Every committed step in time order: the household members' tool calls and Infra events, each with its time. | synthetic | 83411 | `17aca07e9c7de687680b8e25680c3b1d0c814bffe50cd9a9f1130178711580a3` |
| `dataset/full.json` | Seed at 2027-01-01T00:00:00-05:00, the state after every step with the timers due before that instant committed: all records of the window, with the same catalog and label facts. | mixed | 601844 | `44195d3f52a3a823bda918f73b16a6651c301beafbe8d0dc63b4e4eb734e7f10` |

Method: `dataset/lib.cjs` (`06b0c19b2be313f4…`), `dataset/notes.cjs` (`2581724f8e7efbdc…`), `dataset/generate.cjs` (`d4526cb28a57173b…`), `dataset/as-of.cjs` (`656db113f8d5cedd…`), `dataset/coverage.cjs` (`74433dd25cb5aa1c…`); full hashes in `COVERAGE.json`.

## Record kinds, IDs and date fields

| Kind | Source | Found at | Stable ID | Date field | Dated entries | Distinct dates | Earliest | Latest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prescription | `dataset/full.json` | `prescriptions` | `rx_id` | received_at | 37 | 22 | 2025-01-08 | 2026-12-30 |
| fill | `dataset/full.json` | `fills` | `fill_id` | requested_at | 158 | 134 | 2025-01-09 | 2026-12-30 |
| fill_closing | `dataset/full.json` | `fills` | `<fill id>/closed` | closed_at (collected, returned to stock or cancelled) | 158 | 110 | 2025-01-10 | 2026-12-31 |
| pharmacist_note | `dataset/full.json` | `fills[].notes` | `<fill id>/note-<n>` | at (a hold placed or released) | 19 | 10 | 2025-04-22 | 2026-10-04 |
| refusal | `dataset/full.json` | `fills[].refusals` | `refusal_id` | at | 11 | 11 | 2025-04-22 | 2026-10-23 |
| claim | `dataset/full.json` | `claims` | `claim_id` | at | 175 | 135 | 2025-01-09 | 2026-12-30 |
| plan_request | `dataset/full.json` | `plan_requests` | `plan_request_id` | created_at | 15 | 15 | 2025-01-10 | 2026-12-23 |
| renewal | `dataset/full.json` | `renewals` | `renewal_id` | created_at | 9 | 9 | 2026-01-07 | 2026-12-31 |
| authorization | `dataset/full.json` | `authorizations` | `authorization_id` | at | 16 | 15 | 2025-01-15 | 2026-12-03 |
| charge | `dataset/full.json` | `charges` | `charge_id` | at | 143 | 103 | 2025-01-10 | 2026-12-31 |
| grant | `dataset/full.json` | `grants` | `grant_id` | created_at | 10 | 9 | 2025-01-01 | 2026-12-31 |
| grant_revocation | `dataset/full.json` | `grants` | `<grant id>/revoked` | revoked_at | 2 | 2 | 2025-11-03 | 2026-11-30 |
| notice | `dataset/full.json` | `notices` | `notice_id` | at | 472 | 150 | 2025-01-09 | 2026-12-30 |
| replay_step | `dataset/replay.json` | `steps` | `steps[].id` | at | 476 | 249 | 2025-01-01 | 2026-12-31 |

Excluded from date counts:

- people[], prescribers[], drugs[], plans[], stores[] and cards[] in dataset/full.json (28): Household and catalog rows with no occurrence date; their dated changes are replay steps (store.restocked) and records (grants). Store stock is the only catalog field that changes in the window.
- cash_prices in dataset/full.json (12): Price table per drug, no occurrence date.
- dataset/base.json (0): Holds only the household and catalog at the window start; no dated records.
- approvals (0): A confirmation (user.confirmed) is applied with the prepayment or grant change it confirms and is not kept, because seeds carry no approvals; the confirmed step itself is in dataset/replay.json.
- Invalid or missing occurrence dates: 0; records outside the window: 0.

## Totals

- Dated entries in `dataset/full.json`: 1225 (one per record's occurrence date, plus the closing of each closed fill, each pharmacist note and the revocation of each revoked grant, which are dated changes of a record rather than records of their own), of which 1225 have a valid occurrence date in the window (37 prescriptions, 158 fills, 158 fill closings, 19 pharmacist notes, 11 refusals, 175 claims, 15 plan requests, 9 renewals, 16 authorizations, 143 charges, 10 grants, 2 grant revocations, 472 notices). App records (`plugin.records`: people, prescribers, drugs, plans, stores, cards, prescriptions, fills and grants): 233.
- Replay steps in `dataset/replay.json`: 476.
- Coverage figure: **260** distinct dates. Counted over the records loaded into the App (dataset/full.json), which Agents and Infra read back. The global count over both sources adds 2 days on which the replay log holds steps but no App record is dated. Per source: `dataset/full.json` 260, `dataset/replay.json` 249; global deduplicated count over both sources: 262.
- Earliest date 2025-01-01, latest date 2026-12-31. Months without a requested fill: none.

## Real and synthetic

- Files: `dataset/base.json` and `dataset/full.json` are mixed (synthetic household, catalog and records with the reused label facts in the drug catalog); `dataset/replay.json` is synthetic.
- Dated entries: real 0, synthetic 1225, mixed 0. Every dated record and step is synthetic, written by the App while dataset/generate.cjs replayed it; none was collected or observed, including those dated at or after the reference clock.
- Label facts (24, reused; 24 counted as real data in use): The drug facts are short paraphrases of public DailyMed labels, read on 2026-11-23 and cited by section in contribution/dataset.json. They sit in the drug catalog, carry no occurrence date and are not counted as dated records. A label's facts count as real data in use only when the dataset holds a prescription of that drug, because rx.get returns them with that prescription (shown by the loading demonstration); the table lists the prescriptions and fills per label.

| Label source | Drug | Facts | Read on | Prescriptions | Fills | First fill | Last fill | Counted as real |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `label-d-atorvastatin-40` | atorvastatin calcium (`d-atorvastatin-40`) | 2 | 2026-11-23 | 3 | 25 | 2025-01-09 | 2026-12-04 | yes |
| `label-d-donepezil-5` | donepezil hydrochloride (`d-donepezil-5`) | 2 | 2026-11-23 | 2 | 10 | 2025-01-09 | 2026-12-21 | yes |
| `label-d-warfarin-5` | warfarin sodium (`d-warfarin-5`) | 2 | 2026-11-23 | 3 | 26 | 2025-01-09 | 2026-12-28 | yes |
| `label-d-lisinopril-10` | lisinopril (`d-lisinopril-10`) | 2 | 2026-11-23 | 2 | 8 | 2025-01-21 | 2026-10-07 | yes |
| `label-d-levothyroxine-50` | levothyroxine sodium (`d-levothyroxine-50`) | 2 | 2026-11-23 | 3 | 9 | 2025-01-22 | 2026-10-10 | yes |
| `label-d-sertraline-50` | sertraline hydrochloride (`d-sertraline-50`) | 2 | 2026-11-23 | 2 | 9 | 2025-01-22 | 2026-10-09 | yes |
| `label-d-omeprazole-20` | omeprazole (`d-omeprazole-20`) | 2 | 2026-11-23 | 2 | 8 | 2025-01-21 | 2026-10-06 | yes |
| `label-d-metformin-500` | metformin hydrochloride (`d-metformin-500`) | 2 | 2026-11-23 | 2 | 10 | 2025-01-21 | 2026-10-01 | yes |
| `label-d-amlodipine-5` | amlodipine besylate (`d-amlodipine-5`) | 2 | 2026-11-23 | 3 | 10 | 2025-01-09 | 2026-12-25 | yes |
| `label-d-albuterol-90` | albuterol sulfate (`d-albuterol-90`) | 2 | 2026-11-23 | 3 | 9 | 2025-01-14 | 2026-10-23 | yes |
| `label-d-amoxicillin-250-5` | amoxicillin (`d-amoxicillin-250-5`) | 2 | 2026-11-23 | 9 | 9 | 2025-02-18 | 2026-12-08 | yes |
| `label-d-montelukast-4` | montelukast sodium (`d-montelukast-4`) | 2 | 2026-11-23 | 3 | 25 | 2025-01-13 | 2026-12-30 | yes |

| Partition | From | To | Dated entries | Replay steps |
| --- | --- | --- | --- | --- |
| synthetic, dated before the reference clock | 2025-01-01T00:00:00-05:00 | 2026-11-18T12:00:00-05:00 | 1152 | 440 |
| synthetic, dated at or after the reference clock: generated, never observed | 2026-11-18T12:00:00-05:00 | 2027-01-01T00:00:00-05:00 | 73 | 36 |

## Monthly coverage

| Month | Prescriptions | Fills | Closings | Claims | Plan requests | Renewals | Prepayments | Charges | Refusals | Pharmacist notes | Grants | Notices | Dated entries | Replay steps | Distinct dates (entries) | Distinct dates (with replay log) | After reference clock | Real | Synthetic |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-01 | 11 | 11 | 11 | 12 | 1 | 0 | 2 | 10 | 0 | 0 | 2 | 21 | 81 | 43 | 11 | 11 | 0 | 0 | 81 |
| 2025-02 | 1 | 4 | 4 | 4 | 0 | 0 | 1 | 4 | 0 | 0 | 0 | 8 | 26 | 10 | 6 | 6 | 0 | 0 | 26 |
| 2025-03 | 0 | 4 | 3 | 4 | 1 | 0 | 0 | 3 | 0 | 0 | 1 | 7 | 23 | 9 | 6 | 6 | 0 | 0 | 23 |
| 2025-04 | 0 | 10 | 11 | 11 | 0 | 0 | 1 | 10 | 1 | 2 | 0 | 34 | 80 | 28 | 15 | 15 | 0 | 0 | 80 |
| 2025-05 | 1 | 4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 10 | 27 | 9 | 6 | 6 | 0 | 0 | 27 |
| 2025-06 | 0 | 5 | 3 | 6 | 0 | 0 | 0 | 3 | 0 | 2 | 1 | 16 | 36 | 13 | 9 | 9 | 0 | 0 | 36 |
| 2025-07 | 0 | 9 | 11 | 11 | 2 | 0 | 0 | 10 | 0 | 0 | 0 | 25 | 68 | 25 | 11 | 11 | 0 | 0 | 68 |
| 2025-08 | 0 | 4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 9 | 25 | 8 | 5 | 5 | 0 | 0 | 25 |
| 2025-09 | 1 | 8 | 6 | 7 | 1 | 0 | 0 | 6 | 1 | 2 | 0 | 16 | 48 | 19 | 11 | 11 | 0 | 0 | 48 |
| 2025-10 | 0 | 7 | 9 | 9 | 0 | 0 | 1 | 8 | 2 | 0 | 0 | 22 | 58 | 21 | 11 | 11 | 0 | 0 | 58 |
| 2025-11 | 1 | 4 | 4 | 4 | 1 | 0 | 0 | 4 | 1 | 2 | 2 | 15 | 38 | 19 | 8 | 8 | 0 | 0 | 38 |
| 2025-12 | 1 | 7 | 5 | 8 | 2 | 0 | 0 | 5 | 1 | 2 | 0 | 16 | 47 | 20 | 11 | 12 | 0 | 0 | 47 |
| 2026-01 | 12 | 12 | 14 | 10 | 0 | 2 | 1 | 11 | 0 | 1 | 1 | 31 | 95 | 43 | 17 | 17 | 0 | 0 | 95 |
| 2026-02 | 0 | 3 | 2 | 3 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 7 | 17 | 5 | 4 | 4 | 0 | 0 | 17 |
| 2026-03 | 1 | 9 | 9 | 12 | 1 | 0 | 1 | 7 | 0 | 2 | 1 | 39 | 82 | 27 | 11 | 11 | 0 | 0 | 82 |
| 2026-04 | 0 | 7 | 8 | 7 | 0 | 0 | 2 | 7 | 1 | 2 | 1 | 18 | 53 | 22 | 12 | 12 | 0 | 0 | 53 |
| 2026-05 | 0 | 5 | 4 | 4 | 0 | 0 | 1 | 4 | 1 | 0 | 0 | 13 | 32 | 11 | 10 | 10 | 0 | 0 | 32 |
| 2026-06 | 0 | 7 | 6 | 13 | 2 | 0 | 0 | 5 | 0 | 0 | 0 | 33 | 66 | 20 | 14 | 14 | 0 | 0 | 66 |
| 2026-07 | 0 | 7 | 9 | 7 | 0 | 0 | 2 | 7 | 0 | 0 | 0 | 17 | 49 | 19 | 15 | 15 | 0 | 0 | 49 |
| 2026-08 | 0 | 4 | 4 | 5 | 1 | 0 | 1 | 4 | 0 | 0 | 0 | 14 | 33 | 12 | 11 | 12 | 0 | 0 | 33 |
| 2026-09 | 1 | 7 | 7 | 9 | 1 | 0 | 0 | 6 | 0 | 2 | 0 | 29 | 62 | 20 | 16 | 16 | 0 | 0 | 62 |
| 2026-10 | 2 | 10 | 9 | 9 | 0 | 2 | 2 | 8 | 3 | 2 | 0 | 41 | 88 | 32 | 18 | 18 | 0 | 0 | 88 |
| 2026-11 | 0 | 3 | 3 | 4 | 0 | 0 | 0 | 3 | 0 | 0 | 1 | 9 | 23 | 7 | 5 | 5 | 5 | 0 | 23 |
| 2026-12 | 5 | 7 | 8 | 8 | 2 | 5 | 1 | 8 | 0 | 0 | 2 | 22 | 68 | 34 | 17 | 17 | 68 | 0 | 68 |

Grants counts grants given and revoked. Per-date counts are in `COVERAGE.json` (`dates`).

## Household calendar and simplifications

- Trips (no counter visits by the travellers; early refills before them): 2025-07-12 to 2025-07-20 (family summer trip); 2025-10-04 to 2025-10-12 (Elena visits her sister); 2026-05-23 to 2026-06-01 (family trip); 2026-12-19 to 2026-12-28 (holiday travel).
- 8 prescriptions whose last refill was collected in the 45 days before the yearly visit are not renewed: the prescriber writes the replacement at that visit (rx-1 by rx-17, 8 days after the last refill; rx-2 by rx-18, 29 days after the last refill; rx-4 by rx-20, 6 days after the last refill; rx-7 by rx-22, 1 days after the last refill; rx-8 by rx-23, 1 days after the last refill; rx-9 by rx-24, 4 days after the last refill; rx-10 by rx-25, 3 days after the last refill; rx-11 by rx-26, 3 days after the last refill). For a prescription used up or expired at any other time a renewal is requested, within two days of the last refill when it is used up (6 approved, 1 denied, 1 withdrawn, 1 pending renewal requests).
- Supply method: A documented lost supply (a plan request noted "Replacement for a lost supply") empties all supply on hand at the moment the household asks for the replacement, the lost-supply fill's requested_at; supply restarts with the next pickup. Every other pickup adds its days of supply to whatever is left (supply carries over).
- Supply gaps: 2 (p-4 d-atorvastatin-40 3.08 days from 2026-08-09T09:49:00-04:00 to 2026-08-12T11:40:00-04:00, after the lost supply pr-12 until the replacement f-131 was collected; p-4 d-warfarin-5 4.03 days from 2025-11-07T11:24:00-05:00 to 2025-11-11T12:14:00-05:00, after the lost supply pr-6 until the replacement f-70 was collected); no other maintenance regimen runs out between pickups or before 2026-12-31.
- Supply on hand when a refill is requested: 0 to 39 days, 7 at the median (130 maintenance requests; a documented lost supply counts as nothing on hand); 9 of 175 claims are rejected as too soon.
- Every donepezil fill goes through its own prior authorization (13 requests for 10 fills): in this App an approved request waives the rule for its own fill only, a simplification of real drug plans, where an approval usually covers a period of time.
- Elena's fills at Maple Avenue (`st-1`) while she stays with the household: 2025-06-16 to 2025-08-31; the household's fills at Harbor Street (`st-2`): 2025-10-01 to 2026-02-28.

## Gaps

- No real pharmacy records (2026-11 anchor; stated gap, pending maintainer agreement): There is no real pharmacy record to collect: prescriptions, fills, claims and payments are a real patient's protected health information, the reference product shows them only inside a signed-in account, and the approved proposal (PR #63, https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/c7ddf519b029cebe1c93c5bed50edb889cf34deb/proposals/environment/mendwell-pharmacy.md at the approved revision) excludes real patient data (line 12) and data collection (line 102: "N/A: no crawling or copied content; record public workflow references"). The only real source data are the DailyMed label facts read on 2026-11-23, which are reference content in the catalog, not pharmacy activity; every dated record of the window is synthetic.
- No Mail history (stated gap): The 472 notices are in the App's own notice log only; the dataset holds no Mail history for them. Mail is optional, and the Mail sender treats notices present in a loaded seed as history.
- 2025-01-24 to 2025-02-03 (11 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-02-19 to 2025-03-02 (12 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-03-13 to 2025-03-30 (18 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-04-25 to 2025-05-02 (8 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-05-13 to 2025-06-01 (20 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-06-15 to 2025-06-21 (7 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-07-10 to 2025-07-20 (11 days without any App record): Overlaps the family summer trip (2025-07-12 to 2025-07-20, Sam, Alex, Mia), when the travellers make no counter visits; otherwise no refill falls due.
- 2025-07-23 to 2025-07-31 (9 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-08-08 to 2025-08-30 (23 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-09-11 to 2025-09-22 (12 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-10-16 to 2025-10-29 (14 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-11-12 to 2025-11-30 (19 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2025-12-10 to 2025-12-25 (16 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2026-02-05 to 2026-02-26 (22 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2026-03-10 to 2026-03-16 (7 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2026-04-17 to 2026-04-26 (10 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2026-05-13 to 2026-05-27 (15 days without any App record): Overlaps the family trip (2026-05-23 to 2026-06-01, Sam, Alex, Mia), when the travellers make no counter visits; otherwise no refill falls due.
- 2026-06-07 to 2026-06-13 (7 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2026-07-15 to 2026-07-25 (11 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2026-08-13 to 2026-09-01 (20 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2026-11-04 to 2026-11-28 (25 days without any App record): No refill falls due and no prescription, renewal or grant change happens in these days; the household's supplies last 30 or 90 days.
- 2026-12-10 to 2026-12-20 (11 days without any App record): Overlaps the holiday travel (2026-12-19 to 2026-12-28, Sam, Alex, Mia), when the travellers make no counter visits; otherwise no refill falls due.

## Representative records

| Example | Fill | Patient | Drug | Store | Requested | Outcome | Claims | Plan requests | Payment | Refusals | Pharmacist notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first fill of the window | f-1 | p-4 Elena Ortiz | donepezil hydrochloride 5 mg × 90 | st-3 | 2025-01-09T09:52:00-05:00 | collected | cl-1 rejected prior_auth_required; cl-5 paid $15.00 | pr-1 prior_auth_required approved: Prior authorization form sent by the prescriber | counter $15.00 by p-4 on card-1 | — | — |
| last fill of the window | f-158 | p-3 Mia Rivera | montelukast sodium 4 mg × 30 | st-1 | 2026-12-30T19:34:00-05:00 | collected | cl-175 paid $10.00 | — | counter $10.00 by p-2 on card-3 | — | — |
| first fill after the reference clock | f-151 | p-4 Elena Ortiz | warfarin sodium 5 mg × 30 | st-3 | 2026-11-29T11:22:00-05:00 | collected | cl-167 paid $4.00 | — | counter $4.00 by p-4 on card-1 | — | — |
| routine refill paid at the counter | f-12 | p-4 Elena Ortiz | atorvastatin calcium 40 mg × 30 | st-3 | 2025-02-04T09:12:00-05:00 | collected | cl-13 paid $12.00 | — | counter $12.00 by p-4 on card-1 | — | — |
| collected with nothing due | f-9 | p-2 Alex Rivera | metformin hydrochloride 500 mg × 180 | st-1 | 2025-01-21T19:50:00-05:00 | collected | cl-10 paid $0.00 | — | — | — | — |
| prepaid online, captured at pickup | f-5 | p-3 Mia Rivera | montelukast sodium 4 mg × 30 | st-1 | 2025-01-13T20:15:00-05:00 | collected | cl-6 paid $10.00 | — | capture $10.00 by p-2 on card-4 | — | — |
| drug the plan does not cover, paid at the cash price | f-8 | p-1 Sam Rivera | omeprazole 20 mg × 90 | st-1 | 2025-01-21T19:01:00-05:00 | collected | cl-9 rejected not_covered | — | counter $65.00 (cash price) by p-2 on card-4 | — | — |
| prior authorization denied, then approved | f-38 | p-4 Elena Ortiz | donepezil hydrochloride 5 mg × 90 | st-1 | 2025-06-30T11:03:00-04:00 | collected | cl-41 rejected prior_auth_required; cl-47 paid $15.00 | pr-3 prior_auth_required denied: Prior authorization form sent by the prescriber; pr-4 prior_auth_required approved: Chart notes sent by the prescriber | counter $15.00 by p-2 on card-4 | — | — |
| prior authorization withdrawn and sent again | f-75 | p-4 Elena Ortiz | donepezil hydrochloride 5 mg × 90 | st-3 | 2025-12-26T09:12:00-05:00 | collected | cl-81 rejected prior_auth_required; cl-84 paid $15.00 | pr-7 prior_auth_required withdrawn: Prior authorization form sent by the prescriber; pr-8 prior_auth_required approved: Corrected prior authorization form sent by the prescriber | counter $15.00 by p-4 on card-1 | 2025-12-31T14:39:00-05:00 on_hold (p-4) | 2025-12-31T14:00:00-05:00 Pharmacist double-checking the filled bottle against the label; 2025-12-31T16:43:00-05:00 Label check completed |
| lost supply | f-70 | p-4 Elena Ortiz | warfarin sodium 5 mg × 30 | st-3 | 2025-11-07T11:24:00-05:00 | collected | cl-76 rejected refill_too_soon (eligible 2025-11-25) | pr-6 refill_too_soon denied: Replacement for a lost supply | counter $18.00 (cash price) by p-4 on card-1 | — | — |
| quantity above the plan limit, changed | f-35 | p-4 Elena Ortiz | warfarin sodium 5 mg × 30 | st-3 | 2025-06-03T10:40:00-04:00 | collected | cl-37 rejected quantity_limit; cl-38 paid $4.00 | — | counter $4.00 by p-4 on card-1 | — | — |
| waited for stock, moved to another store | f-20 | p-4 Elena Ortiz | atorvastatin calcium 40 mg × 30 | st-3 | 2025-04-02T09:15:00-04:00 | collected | cl-21 paid $12.00 | — | counter $12.00 by p-4 on card-1 | — | — |
| waited for stock until a restock | f-6 | p-3 Mia Rivera | albuterol sulfate 108 mcg (90 mcg base) per actuation × 1 | st-1 | 2025-01-14T20:52:00-05:00 | collected | cl-7 paid $25.00 | — | capture $25.00 by p-2 on card-4 | — | — |
| held during review | f-34 | p-4 Elena Ortiz | atorvastatin calcium 40 mg × 30 | st-3 | 2025-06-02T09:22:00-04:00 | collected | cl-36 paid $12.00 | — | counter $12.00 by p-4 on card-1 | — | 2025-06-02T09:42:00-04:00 Pharmacist confirming the dose with the prescriber's office; 2025-06-02T13:27:00-04:00 The prescriber's office confirmed the dose |
| held while ready, refused at the counter while held | f-29 | p-3 Mia Rivera | albuterol sulfate 108 mcg (90 mcg base) per actuation × 1 | st-1 | 2025-04-21T21:08:00-04:00 | collected | cl-31 paid $25.00 | — | counter $25.00 by p-2 on card-4 | 2025-04-22T12:18:00-04:00 on_hold (p-2) | 2025-04-22T11:23:00-04:00 Counseling note added: speak with the pharmacist at pickup; 2025-04-22T13:54:00-04:00 Counseling note reviewed by the pharmacist |
| declined card at the counter | f-101 | p-1 Sam Rivera | sertraline hydrochloride 50 mg × 90 | st-1 | 2026-03-30T19:49:00-04:00 | collected | cl-109 paid $8.00 | — | counter $8.00 by p-2 on card-4 | 2026-04-02T17:54:00-04:00 payment_failed (p-2) | — |
| expired card at the counter | f-141 | p-3 Mia Rivera | montelukast sodium 4 mg × 30 | st-1 | 2026-10-03T19:01:00-04:00 | collected | cl-157 paid $10.00 | — | counter $10.00 by p-2 on card-3 | 2026-10-04T14:00:00-04:00 on_hold (p-2); 2026-10-05T18:07:00-04:00 payment_failed (p-2) | 2026-10-04T13:09:00-04:00 Counseling note added: speak with the pharmacist at pickup; 2026-10-04T15:54:00-04:00 Counseling note reviewed by the pharmacist |
| arrived after closing | f-53 | p-3 Mia Rivera | montelukast sodium 4 mg × 30 | st-1 | 2025-09-06T20:46:00-04:00 | collected | cl-58 paid $10.00 | — | counter $10.00 by p-2 on card-4 | 2025-09-08T21:30:00-04:00 store_closed (p-2) | — |
| arrived before the fill was ready | f-60 | p-3 Mia Rivera | montelukast sodium 4 mg × 30 | st-2 | 2025-10-08T19:14:00-04:00 | collected | cl-66 paid $10.00 | — | counter $10.00 by p-2 on card-4 | 2025-10-08T19:45:00-04:00 not_ready (p-2) | — |
| collector not authorized after a revocation | f-68 | p-3 Mia Rivera | amoxicillin 250 mg/5 mL × 150 | st-2 | 2025-11-03T10:00:00-05:00 | collected | cl-74 paid $5.00 | — | counter $5.00 by p-2 on card-4 | 2025-11-03T15:40:00-05:00 collector_not_authorized (p-4) | — |
| returned to stock after the pickup warning | f-95 | p-4 Elena Ortiz | amlodipine besylate 5 mg × 90 | st-3 | 2026-03-09T09:54:00-04:00 | returned_to_stock | cl-100 rejected refill_too_soon (eligible 2026-03-17); cl-102 paid $3.00 | — | — | — | — |
| prepaid, then cancelled when ready | f-97 | p-1 Sam Rivera | sertraline hydrochloride 50 mg × 90 | st-1 | 2026-03-17T20:27:00-04:00 | cancelled (agent, from ready) | cl-103 rejected refill_too_soon (eligible 2026-03-27); cl-104 paid $8.00 | — | prepayment voided $8.00 | — | — |
| cancelled when its prescription expired while on the pharmacist's hold "Waiting for the prescriber to confirm the quantity" | f-86 | p-3 Mia Rivera | albuterol sulfate 108 mcg (90 mcg base) per actuation × 1 | st-1 | 2026-01-12T19:40:00-05:00 | cancelled (rx_expired, from requested) |  | — | — | — | 2026-01-12T20:05:00-05:00 Waiting for the prescriber to confirm the quantity |

Timelines and notices of these fills are in `COVERAGE.json` (`representative`).

## Loading and query demonstration

Real Core 1.6.0 over MCP stdio: Infra loads each selection with env.load_seed (data, virtual_now and provenance bundle) and reads env.snapshot; the Agent, bound as the account holder p-2, reads mendwell-pharmacy.household.list, fills.list, fills.get for every listed fill, rx.list, rx.get and stores.list; the first staged event, if any, is applied with env.apply_event.

| As of | Seed ID | env.load_seed | Core clock | Steps applied / withheld | Timers committed | Fills in selection / listed by the Agent | Listed as the grants allow | Fill states equal the App reads | Latest request |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-01-01T00:00:00-05:00 | `mendwell-delivery-asof-20260101T050000.000Z-5f8252f98e82` | ready, 126 objects, bundle `mendwell-delivery-asof-20260101T050000.000Z-5f8252f98e82`, automated checks pass | 2026-01-01T00:00:00-05:00 | 224 / 252 | 0 | 77 / 41 | yes | yes | 2025-12-31T10:11:00-05:00 |
| 2026-03-27T00:00:00.001-04:00 | `mendwell-delivery-asof-20260327T040000.001Z-da95da619604` | ready, 161 objects, bundle `mendwell-delivery-asof-20260327T040000.001Z-da95da619604`, automated checks pass | 2026-03-27T00:00:00.001-04:00 | 286 / 190 | 3 | 97 / 55 | yes | yes | 2026-03-17T20:27:00-04:00 |
| 2026-11-18T12:00:00-05:00 | `mendwell-delivery-asof-20261118T170000.000Z-bb642a6019d9` | ready, 218 objects, bundle `mendwell-delivery-asof-20261118T170000.000Z-bb642a6019d9`, automated checks pass | 2026-11-18T12:00:00-05:00 | 440 / 36 | 0 | 150 / 84 | yes | yes | 2026-11-02T09:56:00-05:00 |
| 2026-12-15T00:00:00-05:00 | `mendwell-delivery-asof-20261215T050000.000Z-27a1bdadffba` | ready, 227 objects, bundle `mendwell-delivery-asof-20261215T050000.000Z-27a1bdadffba`, automated checks pass | 2026-12-15T00:00:00-05:00 | 460 / 16 | 0 | 154 / 87 | yes | yes | 2026-12-08T09:45:00-05:00 |
| 2027-01-01T00:00:00-05:00 | `mendwell-delivery-asof-20270101T050000.000Z-e391cc6fd932` | ready, 233 objects, bundle `mendwell-delivery-asof-20270101T050000.000Z-e391cc6fd932`, automated checks pass | 2027-01-01T00:00:00-05:00 | 476 / 0 | 0 | 158 / 88 | yes | yes | 2026-12-30T19:34:00-05:00 |

| As of | Claims | Plan requests | Charges | Refusals | Grants | Notices | Monthly read-back equals the selection | Open fills (Agent sees the same) | Drug facts on rx.get | Atorvastatin stock | Staged events | First staged event applied |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-01-01T00:00:00-05:00 | 84 | 8 | 71 | 6 | 5 | 199 | yes | f-75 ready, f-77 ready (yes) | 2 facts of amoxicillin (rx-16, DailyMed, U.S. National Library of Medicine) | st-1 in stock, st-2 out of stock, st-3 in stock | 20 | grant.changed at 2026-01-01T10:00:00-05:00: committed; then grant g-6 active |
| 2026-03-27T00:00:00.001-04:00 | 104 | 8 | 88 | 6 | 7 | 258 | yes | f-97 ready (yes) | 2 facts of amoxicillin (rx-29, DailyMed, U.S. National Library of Medicine) | st-1 in stock, st-2 out of stock, st-3 in stock | 6 | rx.received at 2026-09-09T09:40:00-04:00: committed; then prescription rx-30 stored |
| 2026-11-18T12:00:00-05:00 | 166 | 13 | 135 | 11 | 8 | 448 | yes | none (yes) | 2 facts of albuterol sulfate (rx-32, DailyMed, U.S. National Library of Medicine) | st-1 in stock, st-2 out of stock, st-3 in stock | 4 | rx.received at 2026-12-04T14:48:00-05:00: committed; then prescription rx-33 stored |
| 2026-12-15T00:00:00-05:00 | 170 | 13 | 139 | 11 | 9 | 462 | yes | none (yes) | 2 facts of amoxicillin (rx-35, DailyMed, U.S. National Library of Medicine) | st-1 in stock, st-2 in stock, st-3 in stock | 1 | grant.changed at 2026-12-31T10:00:00-05:00: committed; then grant g-10 active |
| 2027-01-01T00:00:00-05:00 | 175 | 15 | 143 | 11 | 10 | 472 | yes | none (yes) | 2 facts of amoxicillin (rx-35, DailyMed, U.S. National Library of Medicine) | st-1 in stock, st-2 in stock, st-3 in stock | 0 | — |

Record counts are read back from env.snapshot; the Agent sees the fills of the patients the account holder may see at that instant (own, a guardian's, and those shared with a view or refill grant), each through fills.get. The row at 2026-03-27T00:00:00.001-04:00 cuts one millisecond after a fill's return deadline passed with no later step yet: the selection commits that return to stock (with its claim reversal and notices) at its due time, as the App's next write would, so the seed and Core's reads agree. rx.get shows the cited label facts with the most recently received prescription the account holder may see. At 2027-01-01T00:00:00-05:00 the whole window is loaded; its monthly read-back (`loading.instants[].monthly_read_back` in `COVERAGE.json`) equals the monthly table above, which `dataset/coverage.cjs` checks.
