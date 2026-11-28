# Larkfield delivery dataset: coverage

Environment dataset coverage of the Larkfield delivery dataset larkfield-delivery-2025-2026, whole window. Not a Task history report: a Task reports its own selection after its first-session cutoff (dataset/as-of.cjs).

- Dataset: `larkfield-delivery-2025-2026`; window 2025-01-01 to 2026-12-31 inclusive; time zone `America/New_York`; reference clock (the fixture clock) `2026-11-18T12:00:00-05:00`; generator seed 20250158.
- Reproduce: `node dataset/generate.cjs --check`, then `node dataset/coverage.cjs --check` from `apps/larkfield-health`. This file and `COVERAGE.json` are written by `dataset/coverage.cjs`.
- Counting: Every timestamp is ISO 8601 with its offset; each is converted to its calendar date in America/New_York before counting. Date-only fields (a claim line's service_date, a PA's valid_from and valid_until) are not occurrence dates and are not counted. A date counts once however many records or sources fall on it. A required occurrence date (received_at, opened_at, issued_at, submitted_at, filed_at, notice_at, created_at or at) that is missing or not a valid ISO 8601 instant with the offset in force, and a record outside the window, is excluded from the count and listed by ID; processed_at, answered_at, attested_at, decided_at, overdue_at, expired_at, withdrawn_at and revoked_at are required only of records in the status that sets them, and a window's closing notice only when one was sent. There are none.
- Smoke fixture and delivery dataset: `fixtures/minimal.json` and this dataset share the household, the plan, the providers and the services (equal at the fixture clock, checked by `tests/t32-dataset.test.cjs`) but have independent histories. The fixture serves the business tests, the examples and the proposal's example events; the dataset serves evaluation, and Tasks select their history from it with `dataset/as-of.cjs`. Their IDs overlap but name different records: the dataset uses the App's runtime series (`cl-1`, `pa-1`, `ap-1`, `gr-1`, `n-1`, …), while the fixture keeps its history in the `h` series and its task-timeline notices in the `t` series; the fixture's `cl-7`, `pa-4`, `gr-2` and the other IDs named by the proposal's example events are not the dataset's.

## Sources

| File | Role | Kind | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| `dataset/base.json` | Seed at the window start 2025-01-01T00:00:00-05:00: the household, the plan with its 2025 to 2027 benefit years, the six providers and fourteen services of the fixture, coverage unknown for every member and year, accumulators at zero; no records. | synthetic | 7855 | `d7deb1829271f8af7e4146242b8bfb001f371f87741d654df1c29c7a40da9b2d` |
| `dataset/replay.json` | Every committed step in time order: the household members' tool calls and Infra events, each with its time. | synthetic | 59522 | `bea1593e0d4d2a75aff56082f10f0e8cd0b9be51fc86a4e22d30304e2671e46c` |
| `dataset/full.json` | Seed at 2027-01-01T00:00:00-05:00, the state after every step with the timers due before that instant committed: all records of the window. | synthetic | 437729 | `83f79bcde0ef3d41cb5afb23dc82e97c7eea741fda7ce4886129f5089518e133` |

Method: `dataset/lib.cjs` (`7cf32455834f1d50…`), `dataset/notes.cjs` (`fcfc79aee5d2530f…`), `dataset/generate.cjs` (`b1e81569f9216337…`), `dataset/as-of.cjs` (`7346ec59012a0aa2…`), `dataset/coverage.cjs` (`3fdfe42edfa3d4ad…`), `plugin.cjs` (`19f2188d436be4cf…`), `src/adjudication.cjs` (`fca387a5ce4ad1b0…`), `src/appeals.cjs` (`848b8383edb5070d…`), `src/approvals.cjs` (`f97e90db88b7b7ca…`), `src/authority.cjs` (`d31c35f7bc9d68c9…`), `src/claims.cjs` (`dbeb6395fff53718…`), `src/confirm.cjs` (`620c505627b3d036…`), `src/coverage.cjs` (`7cdada8fba7a738c…`), `src/events.cjs` (`05205caf4022eb85…`), `src/grants.cjs` (`bdf26ceb7dedec11…`), `src/guards.cjs` (`3feefa7219f71a2c…`), `src/model.cjs` (`b093dd999d01fa8c…`), `src/notices.cjs` (`d792efaa6797347c…`), `src/operations.cjs` (`b631e577eb362888…`), `src/pa.cjs` (`f26a8cf18f26089a…`), `src/time.cjs` (`1dd606683b666e38…`), `src/timers.cjs` (`ee1a65510185f52e…`), `src/tokens.cjs` (`8324c1a58f2e4eca…`), `src/util.cjs` (`2b2dbaa0f5930fb6…`), `src/views.cjs` (`09e3d7c22d6adad1…`); full hashes in `COVERAGE.json`.

## Record kinds, IDs and date fields

| Kind | Source | Found at | Stable ID | Date field | Dated entries | Distinct dates | Earliest | Latest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claim | `dataset/full.json` | `claims` | `claim_id` | received_at | 97 | 92 | 2025-01-10 | 2026-12-30 |
| claim_processing | `dataset/full.json` | `claims` | `<claim id>/processed` | processed_at (processed claims) | 96 | 91 | 2025-01-21 | 2026-12-20 |
| info_request | `dataset/full.json` | `info_requests` | `info_request_id` | opened_at | 27 | 15 | 2025-01-13 | 2026-09-25 |
| info_answer | `dataset/full.json` | `info_requests` | `<request id>/answered` | answered_at (answered requests) | 25 | 13 | 2025-01-21 | 2026-09-27 |
| info_expiry | `dataset/full.json` | `info_requests` | `<request id>/expired` | expires_at (expired requests) | 2 | 1 | 2025-07-09 | 2025-07-09 |
| attestation | `dataset/full.json` | `coverage` | `<member id>:<plan year>` | attested_at (attested member-years) | 6 | 5 | 2025-01-21 | 2026-02-02 |
| eob | `dataset/full.json` | `eobs` | `eob_id` | issued_at | 98 | 93 | 2025-01-21 | 2026-12-20 |
| pa | `dataset/full.json` | `pas` | `pa_id` | submitted_at | 10 | 10 | 2025-05-21 | 2026-09-16 |
| pa_info_request | `dataset/full.json` | `pas[].info_requests` | `<pa id>/info-<n>` | at | 2 | 2 | 2026-03-11 | 2026-05-12 |
| pa_expedite | `dataset/full.json` | `pas[].expedite` | `<pa id>/expedite` | requested_at | 2 | 2 | 2025-05-21 | 2026-04-24 |
| pa_expedite_decision | `dataset/full.json` | `pas[].expedite` | `<pa id>/expedite-decided` | decided_at (decided expedites) | 2 | 2 | 2025-05-22 | 2026-04-24 |
| pa_decision | `dataset/full.json` | `pas` | `<pa id>/decided` | decided_at (approved or denied PAs, also after expiry) | 9 | 9 | 2025-05-28 | 2026-09-17 |
| pa_overdue | `dataset/full.json` | `pas` | `<pa id>/overdue` | overdue_at (overdue PAs) | 2 | 2 | 2026-03-13 | 2026-05-26 |
| pa_expiry | `dataset/full.json` | `pas` | `<pa id>/expired` | expired_at (expired PAs) | 8 | 8 | 2025-07-01 | 2026-10-23 |
| covered_submission | `dataset/full.json` | `pas[].covered_submissions` | `pa_id` | at | 2 | 2 | 2025-06-17 | 2026-06-23 |
| appeal | `dataset/full.json` | `appeals` | `appeal_id` | filed_at | 5 | 5 | 2025-07-08 | 2026-11-04 |
| appeal_statement | `dataset/full.json` | `appeals[].statements` | `<appeal id>/statement-<n>` | at | 7 | 7 | 2025-07-08 | 2026-11-21 |
| appeal_info_request | `dataset/full.json` | `appeals[].info_requests` | `<appeal id>/info-<n>` | at | 2 | 2 | 2025-07-21 | 2026-11-18 |
| appeal_decision | `dataset/full.json` | `appeals` | `<appeal id>/decided` | decided_at (upheld or overturned appeals) | 4 | 4 | 2025-08-07 | 2026-12-04 |
| appeal_withdrawal | `dataset/full.json` | `appeals` | `<appeal id>/withdrawn` | withdrawn_at (withdrawn appeals) | 1 | 1 | 2026-09-06 | 2026-09-06 |
| appeal_overdue | `dataset/full.json` | `appeals` | `<appeal id>/overdue` | overdue_at (overdue appeals) | 1 | 1 | 2025-09-10 | 2025-09-10 |
| appeal_window | `dataset/full.json` | `windows` | `<target type>:<target id>` | notice_at | 8 | 8 | 2025-07-04 | 2026-10-31 |
| window_closing_notice | `dataset/full.json` | `windows` | `<target type>:<target id>/closing` | closing.notice_at (closing notices sent) | 2 | 2 | 2026-01-28 | 2026-07-23 |
| grant | `dataset/full.json` | `grants` | `grant_id` | created_at | 3 | 3 | 2025-01-01 | 2026-04-27 |
| grant_revocation | `dataset/full.json` | `grants` | `<grant id>/revoked` | revoked_at (revoked grants) | 1 | 1 | 2025-09-07 | 2025-09-07 |
| notice | `dataset/full.json` | `notices` | `notice_id` | at | 322 | 125 | 2025-01-13 | 2026-12-20 |
| replay_step | `dataset/replay.json` | `steps` | `steps[].id` | at | 167 | 135 | 2025-01-01 | 2026-12-30 |

Excluded from date counts:

- members[], providers[], services[] and plan.years in dataset/full.json (26): Household, provider, service and benefit rows with no occurrence date; they are the fixture's and do not change in the window.
- accumulators[] in dataset/full.json (9): Running totals per member and plan year with no date; their changes are the EOB postings, which are dated.
- coverage[] rows still unknown (3): No attestation, so no date (the 2027 rows, and any member-year never answered).
- PA withdrawals (1): The App records a withdrawn PA's status without a time; the withdrawal is the pa.withdrawn step in dataset/replay.json, counted there.
- dataset/base.json (0): Holds only the household, plan and catalog at the window start; no dated records.
- approvals (0): A confirmation (user.confirmed) is applied with the grant change, attestation, answer, filing or withdrawal it confirms and is not kept, because seeds carry no approvals; the confirmed step itself is in dataset/replay.json.
- Invalid or missing occurrence dates: 0; records outside the window: 0.

## Totals

- Dated entries in `dataset/full.json`: 744 (one per record's occurrence date, plus the dated changes a record carries: a claim's processing, a request's answer or expiry, an attestation, a PA's information requests, expedite, decision, overdue time and expiry, an appeal's statements, information requests, decision, withdrawal and overdue time, a window's closing notice and a grant's revocation), of which 744 have a valid occurrence date in the window (97 claims, 96 claims processed, 27 information requests, 25 answers, 2 request expiries, 6 attestations, 98 EOBs, 10 PAs, 2 PA information requests, 2 expedite requests, 2 expedite decisions, 9 PA decisions, 2 overdue PA decisions, 8 PA expiries, 2 covered submissions, 5 appeals, 7 appeal statements, 2 appeal information requests, 4 appeal decisions, 1 appeal withdrawal, 1 overdue appeal decision, 8 appeal windows, 2 closing notices, 3 grants, 1 grant revocation, 322 notices). App records (`plugin.records`: members, providers, services, claims, PAs, appeals and grants): 138.
- Replay steps in `dataset/replay.json`: 167.
- Coverage figure: **219** distinct dates. Counted over the records loaded into the App (dataset/full.json), which Agents and Infra read back. The global count over both sources adds 1 day on which the replay log holds steps but no App record is dated. Per source: `dataset/full.json` 219, `dataset/replay.json` 135; global deduplicated count over both sources: 220.
- Earliest date 2025-01-01, latest date 2026-12-30. Months without a received claim: none.

## Real and synthetic

- Files: `dataset/base.json`, `dataset/replay.json` and `dataset/full.json` are synthetic throughout; nothing in them is mixed or reused.
- Dated entries: real 0, synthetic 744, mixed 0. Every dated record and step is synthetic, written by the App while dataset/generate.cjs replayed it; none was collected or observed, including those dated at or after the reference clock. The three files are synthetic throughout: the household, plan, providers and services are the fixture's invented catalog.
- Code sets: None. Services keep the fixture's plain descriptions; no procedure, diagnosis, drug or provider code set (CPT, HCPCS, ICD-10, NDC, NPI or similar) appears or is used.
- Real public fact: U.S. federal holidays of 2025 and 2026 as observed (5 U.S.C. 6103), plus December 24 (2025-01-01, 2025-01-20, 2025-02-17, 2025-05-26, 2025-06-19, 2025-07-04, 2025-09-01, 2025-10-13, 2025-11-11, 2025-11-27, 2025-12-24, 2025-12-25, 2026-01-01, 2026-01-19, 2026-02-16, 2026-05-25, 2026-06-19, 2026-07-03, 2026-09-07, 2026-10-12, 2026-11-11, 2026-11-26, 2026-12-24, 2026-12-25). Used for: The calendar of the providers' offices and the plan: visits, claim intake, PA submissions and plan decisions fall on weekdays outside these dates. Not stored in any record.
- Real public fact: America/New_York daylight-saving rules from the IANA time zone database, as Node.js applies them. Used for: The offset of every timestamp; the App's own time functions use the same rules.
- App policy: The deadline lengths (3-day review, 45-day request expiry, 15-day PA decision, 30- and 60-day appeal decisions, 72-hour expedite, 180-day appeal window) are the App's policy, modelled on U.S. employer-plan rules as the approved proposal states; they are business logic, not data, and the dataset only follows them.

| Partition | From | To | Dated entries | Replay steps |
| --- | --- | --- | --- | --- |
| synthetic, dated before the reference clock | 2025-01-01T00:00:00-05:00 | 2026-11-18T12:00:00-05:00 | 720 | 160 |
| synthetic, dated at or after the reference clock: generated, never observed | 2026-11-18T12:00:00-05:00 | 2027-01-01T00:00:00-05:00 | 24 | 7 |

## Monthly coverage

| Month | Claims | Processed | Requests | Answers | Expiries | Attestations | EOBs | PAs | PA steps | Appeals | Appeal steps | Windows | Grants | Notices | Dated entries | Replay steps | Distinct dates (entries) | Distinct dates (with replay log) | After reference clock | Real | Synthetic |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-01 | 4 | 3 | 5 | 3 | 0 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 1 | 16 | 37 | 7 | 8 | 8 | 0 | 0 | 37 |
| 2025-02 | 2 | 3 | 1 | 3 | 0 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 1 | 9 | 23 | 4 | 6 | 6 | 0 | 0 | 23 |
| 2025-03 | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 11 | 2 | 4 | 4 | 0 | 0 | 11 |
| 2025-04 | 3 | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 16 | 3 | 6 | 6 | 0 | 0 | 16 |
| 2025-05 | 2 | 1 | 2 | 0 | 0 | 0 | 1 | 1 | 3 | 0 | 0 | 0 | 0 | 12 | 22 | 6 | 4 | 4 | 0 | 0 | 22 |
| 2025-06 | 3 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 5 | 13 | 4 | 5 | 5 | 0 | 0 | 13 |
| 2025-07 | 4 | 6 | 0 | 0 | 2 | 0 | 6 | 0 | 1 | 2 | 4 | 2 | 0 | 27 | 54 | 8 | 12 | 12 | 0 | 0 | 54 |
| 2025-08 | 2 | 2 | 2 | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 1 | 1 | 0 | 13 | 25 | 5 | 5 | 5 | 0 | 0 | 25 |
| 2025-09 | 1 | 1 | 0 | 0 | 0 | 0 | 2 | 1 | 1 | 0 | 2 | 0 | 1 | 11 | 20 | 5 | 7 | 7 | 0 | 0 | 20 |
| 2025-10 | 5 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 20 | 5 | 8 | 8 | 0 | 0 | 20 |
| 2025-11 | 2 | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 15 | 2 | 5 | 5 | 0 | 0 | 15 |
| 2025-12 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 22 | 5 | 6 | 6 | 0 | 0 | 22 |
| 2026-01 | 6 | 2 | 6 | 4 | 0 | 1 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 23 | 45 | 9 | 10 | 10 | 0 | 0 | 45 |
| 2026-02 | 9 | 10 | 5 | 5 | 0 | 2 | 10 | 3 | 1 | 0 | 0 | 1 | 0 | 32 | 78 | 19 | 18 | 18 | 0 | 0 | 78 |
| 2026-03 | 6 | 9 | 1 | 3 | 0 | 0 | 9 | 1 | 6 | 0 | 0 | 0 | 0 | 23 | 58 | 14 | 17 | 18 | 0 | 0 | 58 |
| 2026-04 | 5 | 5 | 2 | 2 | 0 | 0 | 5 | 1 | 3 | 1 | 2 | 1 | 1 | 16 | 44 | 14 | 12 | 12 | 0 | 0 | 44 |
| 2026-05 | 7 | 7 | 2 | 2 | 0 | 0 | 7 | 1 | 4 | 0 | 0 | 0 | 0 | 21 | 51 | 12 | 17 | 17 | 0 | 0 | 51 |
| 2026-06 | 3 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 4 | 13 | 5 | 6 | 6 | 0 | 0 | 13 |
| 2026-07 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 1 | 0 | 0 | 1 | 0 | 9 | 23 | 4 | 9 | 9 | 0 | 0 | 23 |
| 2026-08 | 8 | 9 | 0 | 0 | 0 | 0 | 9 | 1 | 1 | 1 | 1 | 2 | 0 | 25 | 57 | 11 | 19 | 19 | 0 | 0 | 57 |
| 2026-09 | 6 | 5 | 1 | 1 | 0 | 0 | 5 | 1 | 2 | 0 | 1 | 0 | 0 | 14 | 36 | 10 | 14 | 14 | 0 | 0 | 36 |
| 2026-10 | 2 | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 1 | 0 | 0 | 1 | 0 | 7 | 17 | 2 | 6 | 6 | 0 | 0 | 17 |
| 2026-11 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 1 | 3 | 0 | 0 | 13 | 29 | 7 | 10 | 10 | 9 | 0 | 29 |
| 2026-12 | 3 | 2 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 6 | 15 | 4 | 5 | 5 | 15 | 0 | 15 |

PA steps counts information requests, expedites and their decisions, decisions, overdue times, expiries and covered submissions; appeal steps counts statements (the first is filed with the appeal), information requests, decisions, withdrawals and overdue times; windows counts appeal windows opened and closing notices sent; grants counts grants given and revoked. Per-date counts are in `COVERAGE.json` (`dates`).

## Household calendar, plan workload and measures

- Trips (no scheduled care for the travellers; an emergency is seen near the destination): 2025-07-12 to 2025-07-20 (family summer trip); 2025-12-27 to 2026-01-03 (winter visit to family near Cindervale); 2026-07-18 to 2026-07-26 (family summer trip near Cindervale).
- Plan decisions: each busy period has a heavy or light backlog by a seeded draw, and a decision planned in it slips past its due date with the period's chance (plan-year surge 2025-01-02 to 2025-03-15, heavy, 0.6; summer staffing 2025-06-15 to 2025-08-31, heavy, 0.6; holiday backlog 2025-11-20 to 2025-12-31, heavy, 0.6; plan-year surge 2026-01-02 to 2026-03-15, light, 0.1; summer staffing 2026-06-15 to 2026-08-31, heavy, 0.6; holiday backlog 2026-11-20 to 2026-12-31, heavy, 0.6; otherwise 0.03; for PA decisions 0.5 times these), and a decision that waits for requested documents comes some business days after they arrive, so a late provider or household reply can make it overdue. Overdue: PAs pa-6, pa-9; appeals ap-2.
- Grants: gr-1 act on m-1 to m-2 from 2025-01-01T13:00:00-05:00 until 2027-01-01T00:00:00-05:00, active (account holder); gr-2 view on m-2 to m-1 from 2025-02-18T22:16:00-05:00, revoked 2025-09-07T14:10:00-04:00 (event); gr-3 act on m-2 to m-1 from 2026-04-27T12:17:00-04:00 until 2026-06-26T00:00:00-04:00, active (event).
- Answers to information requests (Days from an information request's opening to its answer: (answered_at minus opened_at) in elapsed milliseconds divided by 86,400,000, over answered requests; requests that expired are counted separately and are not part of the distribution.): 25 answered, 1.8 to 42.8 days, 2.9 at the median; 2 expired unanswered.
- PA decisions (Days from a PA's submission to the plan's first decision on it: (the first decision minus submitted_at) in elapsed milliseconds divided by 86,400,000, where the first decision is a denied PA's denial_notice_at, which a later appeal does not change, and otherwise an approved PA's decided_at; a withdrawn PA has no decision.): 9 decided, 0.3 to 21.1 days, 6 at the median.
- Appeal decisions (Days from an appeal's filing to its decision: (decided_at minus filed_at) in elapsed milliseconds divided by 86,400,000, over decided appeals; withdrawn and open appeals are listed by status.): 4 decided, 2 to 67 days, 29.7 at the median; by status 1 upheld, 3 overturned, 1 withdrawn, 0 under_review, 0 info_requested.
- Out of pocket (Each member's deductible and out-of-pocket amounts per plan year are the App's accumulators in dataset/full.json, compared with that year's individual limits; family totals are the sums over the enrolled members.): m-1 2025 deductible $430.40 of $1250.00, out of pocket $630.40 of $3500.00; m-1 2026 deductible $428.04 of $1500.00, out of pocket $1004.04 of $4000.00; m-2 2025 deductible $247.64 of $1250.00, out of pocket $489.64 of $3500.00; m-2 2026 deductible $1500.00 of $1500.00, out of pocket $4000.00 of $4000.00 (maximum reached); m-3 2025 deductible $187.87 of $1250.00, out of pocket $941.87 of $3500.00; m-3 2026 deductible $450.27 of $1500.00, out of pocket $1254.27 of $4000.00.

| PA | Member | Service | Status | Submitted | Decided | Approved | Used | Steps | Appeals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pa-1 | m-3 | svc-physical-therapy | expired | 2025-05-21T10:00:00-04:00 | 2025-05-28T13:39:00-04:00 | 8 units, 2025-05-28 to 2025-07-01 | 8 | expedite denied (requested 2025-05-21T21:24:00-04:00); covered submission pa-2 4 units at 2025-06-17T08:22:00-04:00 | — |
| pa-3 | m-2 | svc-semaglutide-1 | expired | 2025-09-25T14:55:00-04:00 | 2025-09-26T10:35:00-04:00 | 6 units, 2025-09-28 to 2026-03-28 | 0 | — | — |
| pa-4 | m-3 | svc-physical-therapy | expired | 2026-02-11T13:54:00-05:00 | 2026-02-12T15:46:00-05:00 | 6 units, 2026-02-14 to 2026-03-13 | 6 | — | — |
| pa-5 | m-2 | svc-arthroscopy | withdrawn | 2026-02-20T09:19:00-05:00 | — | — | 0 | — | — |
| pa-6 | m-2 | svc-physical-therapy | expired (overdue 2026-03-13T23:59:00-04:00) | 2026-02-26T15:25:00-05:00 | 2026-03-16T12:04:00-04:00 | 12 units, 2026-03-16 to 2026-05-10 | 10 | — | — |
| pa-7 | m-2 | svc-semaglutide-1 | expired | 2026-03-09T12:14:00-04:00 | 2026-03-18T12:20:00-04:00 | 6 units, 2026-03-18 to 2026-09-15 | 0 | information requested 2026-03-11T10:38:00-04:00 | — |
| pa-8 | m-2 | svc-arthroscopy | expired | 2026-04-24T09:23:00-04:00 | 2026-04-27T11:15:00-04:00 | 1 units, 2026-04-27 to 2026-05-27 | 1 | expedite approved (requested 2026-04-24T12:54:00-04:00) | ap-3 overturned (expedited) |
| pa-9 | m-2 | svc-physical-therapy | expired (overdue 2026-05-26T23:59:00-04:00) | 2026-05-11T12:30:00-04:00 | 2026-06-01T15:25:00-04:00 | 12 units, 2026-06-01 to 2026-07-19 | 11 | information requested 2026-05-12T10:46:00-04:00; covered submission pa-10 4 units at 2026-06-23T08:58:00-04:00 | — |
| pa-11 | m-2 | svc-semaglutide-1 | approved | 2026-08-19T16:22:00-04:00 | 2026-08-25T15:15:00-04:00 | 6 units, 2026-08-26 to 2027-02-23 | 0 | — | — |
| pa-12 | m-1 | svc-physical-therapy | expired | 2026-09-16T12:37:00-04:00 | 2026-09-17T11:41:00-04:00 | 8 units, 2026-09-19 to 2026-10-23 | 5 | — | — |

| Appeal | Member | Target | Filed (by) | Due | Status | Decided or withdrawn | Statements | Information requests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ap-1 | m-2 | claim:cl-17 | 2025-07-08T22:05:00-04:00 (m-2) | 2025-09-06T23:59:00-04:00 | upheld | 2025-08-07T15:39:00-04:00 | 2 | 2025-07-21T12:21:00-04:00 The order from the doctor who requested the abdominal ultrasound |
| ap-2 | m-3 | claim:cl-13 | 2025-07-12T12:24:00-04:00 (m-2) | 2025-09-10T23:59:00-04:00 | overturned (overdue) | 2025-09-17T11:28:00-04:00 | 1 | — |
| ap-3 (expedited) | m-2 | pa:pa-8 | 2026-04-25T10:21:00-04:00 (m-2) | 2026-04-28T10:21:00-04:00 | overturned | 2026-04-27T11:15:00-04:00 | 1 | — |
| ap-4 | m-3 | claim:cl-75 | 2026-08-18T19:07:00-04:00 (m-1) | 2026-10-17T23:59:00-04:00 | withdrawn | 2026-09-06T17:07:00-04:00 | 1 | — |
| ap-5 | m-1 | claim:cl-90 | 2026-11-04T20:00:00-05:00 (m-1) | 2027-01-03T23:59:00-05:00 | overturned | 2026-12-04T11:35:00-05:00 | 2 | 2026-11-18T13:58:00-05:00 The therapy clinic's schedule showing the moved session |

## Gaps

- No real health-plan records (2026-11 anchor; stated gap, pending maintainer agreement): There is no real health-plan record to collect: claims, EOBs, prior authorizations and appeals are a real member's protected health information, the reference product shows them only inside a signed-in member account, and the approved proposal (PR #64, https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/c0f566a3c5be418cd0c971d58e4144cb8085d25a/proposals/environment/larkfield-health.md at the approved revision) describes a synthetic plan with the reference site as a workflow reference only (line 6), excludes data collection (line 103: "N/A: no crawling or copied content; record public workflow references") and calls for synthetic data with no real people, brands or member data (line 104). No real data anchors November 2026 or any other month; every dated record of the window is synthetic.
- No Mail history (stated gap): The 322 notices are in the App's own notice log only; the dataset holds no Mail history for them. Mail is optional, and the Mail sender treats notices present in a loaded seed as history.
- Authorizations never used (stated gap): Casey's semaglutide 1 mg weekly pen authorizations pa-3 (6 units, 2025-09-28 to 2026-03-28), pa-7 (6 units, 2026-03-18 to 2026-09-15) and pa-11 (6 units, 2026-08-26 to 2027-02-23) are approved and never used: each ends with 0 units used, and no claim line bills svc-semaglutide-1. The service is a pharmacy item and the catalogue has no pharmacy among its providers, so the authorization is never used in this App; each request follows a visit at Quarrowby Family Medicine, which bills the visit, not the medicine, and the dataset invents no pharmacy claims.
- 2025-01-02 to 2025-01-09 (8 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: no claim arrives before it in the window, the next on 2025-01-10, and 2 service dates inside it were billed after it.
- 2025-02-01 to 2025-02-12 (12 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-01-28, the next on 2025-02-13, and 1 service date inside it was billed after it.
- 2025-02-26 to 2025-03-13 (16 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-02-19, the next on 2025-03-14, and 1 service date inside it was billed after it.
- 2025-03-24 to 2025-04-03 (11 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-03-20, the next on 2025-04-04, and 2 service dates inside it were billed after it.
- 2025-04-14 to 2025-04-21 (8 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-04-10, the next on 2025-04-22, and 1 service date inside it was billed after it.
- 2025-04-26 to 2025-05-20 (25 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-04-22, the next on 2025-05-22, and 2 service dates inside it were billed after it.
- 2025-05-29 to 2025-06-15 (18 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-05-22, the next on 2025-06-16, and 5 service dates inside it were billed after it.
- 2025-06-21 to 2025-06-29 (9 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-06-17, the next on 2025-06-30, and 3 service dates inside it were billed after it.
- 2025-08-16 to 2025-09-06 (22 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-08-05, the next on 2025-09-24, and no visit falls inside it.
- 2025-10-07 to 2025-10-19 (13 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-10-03, the next on 2025-10-20, and 2 service dates inside it were billed after it.
- 2025-11-16 to 2025-12-01 (16 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-11-12, the next on 2025-12-02, and 2 service dates inside it were billed after it.
- 2025-12-20 to 2026-01-08 (20 days without any App record): Overlaps the winter visit to family near Cindervale (2025-12-27 to 2026-01-03), when the household has no scheduled care. No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2025-12-16, the next on 2026-01-09, and 3 service dates inside it were billed after it.
- 2026-01-18 to 2026-01-25 (8 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2026-01-14, the next on 2026-01-26, and 1 service date inside it was billed after it.
- 2026-03-21 to 2026-03-27 (7 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2026-03-17, the next on 2026-04-02, and 3 service dates inside it were billed after it.
- 2026-06-02 to 2026-06-22 (21 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2026-05-28, the next on 2026-06-23, and 6 service dates inside it were billed after it.
- 2026-10-12 to 2026-10-22 (11 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2026-10-08, the next on 2026-10-28, and 2 service dates inside it were billed after it.
- 2026-11-24 to 2026-12-03 (10 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2026-11-20, the next on 2026-12-04, and 1 service date inside it was billed after it.
- 2026-12-08 to 2026-12-16 (9 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2026-12-04, the next on 2026-12-17, and 1 service date inside it was billed after it.
- 2026-12-21 to 2026-12-29 (9 days without any App record): No claim arrives and no review, request, decision, notice or household action falls in these days: the last claim before it arrived on 2026-12-17, the next on 2026-12-30, and 1 service date inside it was billed after it.

## Representative records

| Example | Claim | Member | Provider | Received | Status | Requests | EOBs | Appeals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first claim of the window | cl-1 | m-2 Casey Hale | pv-1 Quarrowby Family Medicine | 2025-01-10T15:42:00-05:00 | processed | ir-1 other_coverage ln-1 answered none; ir-2 other_coverage ln-2 answered none | v1 2025-02-25T12:18:00-05:00: ln-1 office-visit 2025-01-06 paid $155.00, member $25.00 copay; ln-2 lab-panel 2025-01-06 paid $0.00, member $91.38 deductible $91.38 | — |
| last claim of the window | cl-97 | m-1 Jordan Hale | pv-1 Quarrowby Family Medicine | 2026-12-30T10:31:00-05:00 | received | — | — | — |
| first claim after the reference clock | cl-94 | m-1 Jordan Hale | pv-1 Quarrowby Family Medicine | 2026-11-20T10:47:00-05:00 | processed | — | v1 2026-11-23T23:59:00-05:00: ln-1 office-visit 2026-11-18 paid $155.00, member $25.00 copay | — |
| accident questions left to expire, appealed and overturned into EOB version 2 | cl-13 | m-3 Riley Hale | pv-2 Kestrel Valley Orthopedics | 2025-05-22T15:35:00-04:00 | processed | ir-7 accident ln-1 expired; ir-8 accident ln-2 expired | v1 2025-07-09T23:59:00-04:00: ln-1 specialist-visit 2025-05-19 denied missing_information; ln-2 xray 2025-05-19 denied missing_information / v2 2025-09-17T11:28:00-04:00: ln-1 specialist-visit 2025-05-19 paid $255.00, member $45.00 copay; ln-2 xray 2025-05-19 paid $0.00, member $119.63 deductible $119.63 | ap-2 overturned (filed 2025-07-12T12:24:00-04:00 by m-2) |
| work injury denied as another party's | cl-21 | m-1 Jordan Hale | pv-1 Quarrowby Family Medicine | 2025-08-04T14:02:00-04:00 | processed | ir-9 accident ln-1 answered work_related; ir-10 accident ln-2 answered work_related | v1 2025-08-15T21:39:00-04:00: ln-1 office-visit 2025-07-30 denied other_party_liable; ln-2 wound-repair 2025-07-30 denied other_party_liable | — |
| scheduled imaging out of network, denied and appealed | cl-17 | m-2 Casey Hale | pv-5 Quillmont Imaging Center | 2025-07-01T08:08:00-04:00 | processed | — | v1 2025-07-04T23:59:00-04:00: ln-1 ultrasound 2025-06-24 denied out_of_network | ap-1 upheld (filed 2025-07-08T22:05:00-04:00 by m-2) |
| emergency billed without the emergency flag, appeal withdrawn after the corrected claim | cl-75 | m-3 Riley Hale | pv-6 Cindervale Medical Center | 2026-08-07T12:29:00-04:00 | processed | — | v1 2026-08-10T23:59:00-04:00: ln-1 er-visit 2026-07-25 denied out_of_network | ap-4 withdrawn (filed 2026-08-18T19:07:00-04:00 by m-1) |
| therapy session after the authorization ended, appealed | cl-90 | m-1 Jordan Hale | pv-3 Fernhollow Physical Therapy | 2026-10-28T15:23:00-04:00 | processed | — | v1 2026-10-31T23:59:00-04:00: ln-1 physical-therapy 2026-10-14 paid $115.00, member $35.00 copay; ln-2 physical-therapy 2026-10-21 paid $115.00, member $35.00 copay; ln-3 physical-therapy 2026-10-26 denied prior_auth_missing / v2 2026-12-04T11:35:00-05:00: ln-1 physical-therapy 2026-10-14 paid $115.00, member $35.00 copay; ln-2 physical-therapy 2026-10-21 paid $115.00, member $35.00 copay; ln-3 physical-therapy 2026-10-26 paid $115.00, member $35.00 copay | ap-5 overturned (filed 2026-11-04T20:00:00-05:00 by m-1) |
| surgery | cl-66 | m-2 Casey Hale | pv-4 Wrenmoor Community Hospital | 2026-05-18T11:38:00-04:00 | processed | — | v1 2026-05-21T23:59:00-04:00: ln-1 arthroscopy 2026-05-01 paid $6400.00, member $1600.00 coinsurance $1600.00; ln-2 specialist-visit 2026-05-01 paid $250.00, member $50.00 copay | — |
| physical therapy session reaching Casey Hale's out-of-pocket maximum for 2026 | cl-68 | m-2 Casey Hale | pv-3 Fernhollow Physical Therapy | 2026-06-23T14:54:00-04:00 | processed | — | v1 2026-06-26T23:59:00-04:00: ln-1 physical-therapy 2026-06-08 paid $115.00, member $35.00 copay; ln-2 physical-therapy 2026-06-10 paid $115.00, member $35.00 copay; ln-3 physical-therapy 2026-06-15 paid $122.91, member $27.09 copay; ln-4 physical-therapy 2026-06-17 paid $150.00, member $0.00 | — |
| one claim posting to two plan years | cl-36 | m-3 Riley Hale | pv-6 Cindervale Medical Center | 2026-01-14T09:32:00-05:00 | processed | — | v1 2026-01-17T23:59:00-05:00: ln-1 er-visit 2025-12-31 paid $2000.00, member $200.00 copay; ln-2 lab-panel 2026-01-01 paid $0.00, member $91.38 deductible $91.38 | — |
| emergency at an out-of-network hospital, paid at in-network cost sharing | cl-82 | m-3 Riley Hale | pv-6 Cindervale Medical Center | 2026-08-28T13:25:00-04:00 | processed | — | v1 2026-08-31T23:59:00-04:00: ln-1 er-visit 2026-07-25 paid $1950.00, member $250.00 copay | — |
| other coverage answered as secondary | cl-35 | m-3 Riley Hale | pv-2 Kestrel Valley Orthopedics | 2026-01-09T09:59:00-05:00 | processed | ir-11 other_coverage ln-1 answered other_secondary; ir-12 accident ln-1 answered accident; ir-13 other_coverage ln-2 answered other_secondary; ir-14 accident ln-2 answered accident | v1 2026-01-15T22:09:00-05:00: ln-1 specialist-visit 2026-01-05 paid $250.00, member $50.00 copay; ln-2 xray 2026-01-05 paid $0.00, member $119.63 deductible $119.63 | — |
| accident questions answered as not an accident | cl-42 | m-2 Casey Hale | pv-2 Kestrel Valley Orthopedics | 2026-02-11T16:50:00-05:00 | processed | ir-19 accident ln-1 answered not_accident | v1 2026-02-19T12:20:00-05:00: ln-1 specialist-visit 2026-02-04 paid $250.00, member $50.00 copay | — |
| routine office visit paid with a copay | cl-4 | m-1 Jordan Hale | pv-1 Quarrowby Family Medicine | 2025-01-28T08:12:00-05:00 | processed | — | v1 2025-01-31T23:59:00-05:00: ln-1 office-visit 2025-01-21 paid $155.00, member $25.00 copay | — |
| nurse phone consultation priced below the copay | cl-19 | m-2 Casey Hale | pv-1 Quarrowby Family Medicine | 2025-07-11T09:34:00-04:00 | processed | — | v1 2025-07-14T23:59:00-04:00: ln-1 phone-consult 2025-07-03 paid $0.00, member $22.00 copay | — |
| lab work toward the deductible | cl-11 | m-1 Jordan Hale | pv-1 Quarrowby Family Medicine | 2025-04-22T09:46:00-04:00 | processed | — | v1 2025-04-25T23:59:00-04:00: ln-1 office-visit 2025-04-17 paid $155.00, member $25.00 copay; ln-2 lab-panel 2025-04-17 paid $0.00, member $91.38 deductible $91.38 | — |
| coinsurance after the deductible was met | cl-64 | m-2 Casey Hale | pv-2 Kestrel Valley Orthopedics | 2026-05-11T14:31:00-04:00 | processed | ir-25 accident ln-1 answered not_accident; ir-26 accident ln-2 answered not_accident | v1 2026-05-18T21:09:00-04:00: ln-1 specialist-visit 2026-04-30 paid $250.00, member $50.00 copay; ln-2 xray 2026-04-30 paid $95.70, member $23.93 coinsurance $23.93 | — |
| other-coverage questions answered on the first claim of a year | cl-2 | m-3 Riley Hale | pv-1 Quarrowby Family Medicine | 2025-01-16T08:31:00-05:00 | processed | ir-3 other_coverage ln-1 answered none | v1 2025-01-21T21:32:00-05:00: ln-1 office-visit 2025-01-09 paid $155.00, member $25.00 copay | — |
| accident questions answered as an accident | cl-44 | m-3 Riley Hale | pv-2 Kestrel Valley Orthopedics | 2026-02-13T12:09:00-05:00 | processed | ir-20 accident ln-1 answered accident; ir-21 accident ln-2 answered accident | v1 2026-03-31T20:13:00-04:00: ln-1 specialist-visit 2026-02-09 paid $250.00, member $50.00 copay; ln-2 xray 2026-02-09 paid $0.00, member $119.63 deductible $119.63 | — |

Notices of these claims are in `COVERAGE.json` (`representative`).

## Loading and query demonstration

Real Core 1.6.0 over MCP stdio: Infra loads each selection with env.load_seed (data, virtual_now and provenance bundle) and reads env.snapshot; the Agent, bound as the account holder m-1, reads larkfield-health.members.list, claims.list, claims.get for every listed claim, pa.list, appeals.list, grants.list and plan.get; the first staged event, if any, is applied with env.apply_event.

| As of | Seed ID | env.load_seed | Core clock | Steps applied / withheld | Timers committed | Claims in selection / listed by the Agent | Listed as the grants allow | Claim states equal the App reads | PAs / appeals / grants listed | Latest claim |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-07-09T23:59:00.001-04:00 | `larkfield-delivery-asof-20250710T035900.001Z-1a72fe8abcd9` | ready, 45 objects, bundle `larkfield-delivery-asof-20250710T035900.001Z-1a72fe8abcd9`, automated checks pass | 2025-07-09T23:59:00.001-04:00 | 29 / 138 | 2 | 18 / 18 | yes | yes | 1 / 1 / 2 | 2025-07-08T12:58:00-04:00 |
| 2026-01-01T00:00:00-05:00 | `larkfield-delivery-asof-20260101T050000.000Z-742f699bfdc0` | ready, 63 objects, bundle `larkfield-delivery-asof-20260101T050000.000Z-742f699bfdc0`, automated checks pass | 2026-01-01T00:00:00-05:00 | 56 / 111 | 3 | 34 / 24 | yes | yes | 1 / 1 / 1 | 2025-12-16T11:01:00-05:00 |
| 2026-11-18T12:00:00-05:00 | `larkfield-delivery-asof-20261118T170000.000Z-bb3befaaf9c2` | ready, 134 objects, bundle `larkfield-delivery-asof-20261118T170000.000Z-bb3befaaf9c2`, automated checks pass | 2026-11-18T12:00:00-05:00 | 160 / 7 | 1 | 93 / 57 | yes | yes | 3 / 3 / 1 | 2026-11-13T12:03:00-05:00 |
| 2026-12-15T00:00:00-05:00 | `larkfield-delivery-asof-20261215T050000.000Z-fa7490dfaa97` | ready, 136 objects, bundle `larkfield-delivery-asof-20261215T050000.000Z-fa7490dfaa97`, automated checks pass | 2026-12-15T00:00:00-05:00 | 165 / 2 | 1 | 95 / 58 | yes | yes | 3 / 3 / 1 | 2026-12-04T10:41:00-05:00 |
| 2027-01-01T00:00:00-05:00 | `larkfield-delivery-asof-20270101T050000.000Z-804b325bb2f3` | ready, 138 objects, bundle `larkfield-delivery-asof-20270101T050000.000Z-804b325bb2f3`, automated checks pass | 2027-01-01T00:00:00-05:00 | 167 / 0 | 0 | 97 / 59 | yes | yes | 3 / 3 / 1 | 2026-12-30T10:31:00-05:00 |

| As of | EOBs | Requests | Appeals | Notices | Monthly read-back equals the selection | Open items | Open claims, PAs and appeals the Agent sees (equal) | Staged events | First staged event applied |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-07-09T23:59:00.001-04:00 | 17 | 8 | 1 | 69 | yes | claim:cl-18 received, appeal:ap-1 under_review, claim:cl-13 appealable until 2026-01-05T23:59:00-05:00, grant:gr-1 act grant to m-2 in force until 2026-01-01T00:00:00-05:00, grant:gr-2 view grant to m-1 in force | appeal:ap-1, claim:cl-18 (yes) | 92 | claim.received at 2025-07-11T09:34:00-04:00: committed; then claim cl-19 received |
| 2026-01-01T00:00:00-05:00 | 35 | 10 | 2 | 129 | yes | claim:cl-21 appealable until 2026-02-11T23:59:00-05:00, grant:gr-1 act grant to m-2 in force until 2027-01-01T00:00:00-05:00 | none (yes) | 72 | claim.received at 2026-01-09T09:59:00-05:00: committed; then claim cl-35 received |
| 2026-11-18T12:00:00-05:00 | 94 | 27 | 5 | 312 | yes | appeal:ap-5 under_review, claim:cl-74 appealable until 2027-01-29T23:59:00-05:00, claim:cl-75 appealable until 2027-02-06T23:59:00-05:00, grant:gr-1 act grant to m-2 in force until 2027-01-01T00:00:00-05:00 | appeal:ap-5 (yes) | 5 | appeal.info_requested at 2026-11-18T13:58:00-05:00: committed; then appeal ap-5 info_requested |
| 2026-12-15T00:00:00-05:00 | 97 | 27 | 5 | 321 | yes | claim:cl-74 appealable until 2027-01-29T23:59:00-05:00, claim:cl-75 appealable until 2027-02-06T23:59:00-05:00, grant:gr-1 act grant to m-2 in force until 2027-01-01T00:00:00-05:00 | none (yes) | 2 | claim.received at 2026-12-17T12:39:00-05:00: committed; then claim cl-96 received |
| 2027-01-01T00:00:00-05:00 | 98 | 27 | 5 | 322 | yes | claim:cl-97 received, claim:cl-74 appealable until 2027-01-29T23:59:00-05:00, claim:cl-75 appealable until 2027-02-06T23:59:00-05:00 | claim:cl-97 (yes) | 0 | — |

Record counts are read back from env.snapshot; the Agent sees the claims of the members the account holder may see at that instant (his own, his minor child's as a guardian, and his spouse's while she has given him a view or act grant), each through claims.get. The row at 2025-07-09T23:59:00.001-04:00 cuts one millisecond after an accident question expired with no later step yet: the selection commits that expiry (with the EOB, the denial for missing information and their notices) at its due time, as the App's next write would, so the seed and Core's reads agree. At 2027-01-01T00:00:00-05:00 the whole window is loaded; its monthly read-back (`loading.instants[].monthly_read_back` in `COVERAGE.json`) equals the monthly table above, which `dataset/coverage.cjs` checks.
