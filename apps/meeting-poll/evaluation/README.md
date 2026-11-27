# Evaluation data: 2025–2026

This is the delivered evaluation dataset, distinct from `fixtures/` smoke baselines. All 192 polls and their related records are original synthetic content under MIT. There is no observed Doodle account data or real November anchor. This access gap and the synthetic-only approach were explicit in the approved proposal at `452314ca5bc7e73132496362cf7c2ab19b540e11`.

## Reproduce and load

From the repository root, with Node 22.16.0:

```sh
node apps/meeting-poll/scripts/evaluation.cjs          # deterministic regeneration
node apps/meeting-poll/scripts/evaluation.cjs --check  # verify files, manifest and report
node apps/meeting-poll/tests/evaluation.cjs            # real public MCP load/query/reset
```

Each `YYYY-MM.json` contains `data`, a trusted `binding`, and the snapshot `virtual_now`. An Infra caller reads `env.snapshot` for the current version, then calls `env.load_seed` with that version and the three fields. Agent callers use `meeting-poll.list`, `get` and `notifications`. The test shows exact executable calls, checks every poll's authorized projection, compares the Infra-loaded data to its file, mutates a notification and resets to the imported baseline. The resulting `evaluation-load.json` includes hashes, returned versions, per-poll query outcomes and reset results. Loading one month replaces the current baseline; it does not silently merge months. Tasks select appropriate partitions/history and supply their own account policy. Do not expose events after a Task's first session as prior history.

## Provenance and realism

The fixed PRNG seed is `1792026`. `manifest.json` version 2 records generator, quality-calculator and partition SHA-256 hashes. Records are generated using actual domain transitions; eight meeting purposes cover roadmap, onboarding, accessibility, incident follow-up, research, budgeting, release and partner coordination. Participants, organizer visibility, responses, durations and display zones vary. Variants retain drafts, withdrawals, replacement candidates, cancelled meetings and superseded confirmations. Month-scoped poll/notice IDs remain unique across the corpus; nested records use poll ID plus child ID or array sequence index. These are coherent synthetic histories, not observations or production traffic statistics. Human review of realism remains pending.

### Revision after v1 review

Meeting purposes are shuffled separately from lifecycle outcomes. Organizers and 2–4 attendees are selected independently from the trusted four-person directory; candidate count (2–4), duration (30/45/60/90 minutes), time of day, location and display zone vary. Creation dates vary within each month. The seed remains fixed, so changing no input produces byte-identical partitions and reports. The corpus remains 24 months and 192 polls; dates are an observed result, not a target to maximize.

Published polls collect replies 1–4 days later, in timestamp order with different hours/minutes. Some invitees never respond; withdrawals remain withdrawn instead of always being immediately replaced. Other polls remain unresolved, are cancelled for a concrete project reason, or are confirmed. In rescheduling histories, confirmation is followed two days later by a named attendee's specific conflict. The organizer reopens the poll, removes the previously confirmed time, adds a different time, receives fresh replies the following day, and reconfirms on another day. The old meeting stays superseded. Each independent poll is generated through domain operations before partitions are merged in timestamp order, preventing unrelated overlapping histories from forcing the clock backwards.

[Quality report](quality.json) measures the delivered records: organizer/participant distributions, monthly purpose order and outcome mix, response delays, persistent missing/withdrawn replies, multi-day responses and actual changed arrangements. Regression tests reject compressed/repetitive histories and deliberately corrupted conflict/timestamp controls. Counts distinguish stored `open` records from their effective `closed` state at the month-end snapshot; unanswered expired polls are intentionally retained. These checks support human realism review but cannot replace it.

Public Doodle help pages are workflow references only. Dated captures and source metadata are in `docs/evidence/meeting-poll/references/` at repository root. They do not supply private poll records. Generation uses no network and no model.

## Coverage calculation

`coverage.json` is computed from the delivered partition files. The counting zone is IANA `Etc/UTC`; offsets are normalized before extracting a date. Date-only values, if introduced, use this zone. Authoritative fields are:

| Record type | Date field | Stable report identity |
| --- | --- | --- |
| Poll | `created_at` | Month-prefixed poll ID |
| Candidate | `start` | Poll ID / slot ID |
| Response | `at` | Poll ID / responses / array index |
| Activity | `at` | Poll ID / history / array index |
| Meeting revision | `at` (decision date) | Poll ID / meetings / meeting ID |
| Notification | `at` | Month-prefixed notice ID |

`deadline`, slot `end` and `updated_at` are timeline checks, not additional coverage records. A candidate start is a proposed occurrence, not proof that a meeting took place. The report separates these record types and deduplicates calendar dates globally. Generation/export/file timestamps never count. Missing/invalid or out-of-window dates appear in `excluded`; the delivery test rejects unresolved exclusions. Monthly counts show real (zero) and synthetic portions; the complete date breakdown and gap list are retained. Neither a 300-date minimum nor activity on every day is claimed as necessary. Private records count in the Environment corpus, but Agent queries deliberately expose only authorized projections.
