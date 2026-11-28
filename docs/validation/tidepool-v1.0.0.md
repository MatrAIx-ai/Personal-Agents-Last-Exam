# Tidepool Audio 1.0.0: implementation and verification

Owner: @byshail. App `tidepool` 1.0.0 under `apps/tidepool/`; public runtime 1.6.0, Core API 1.2.0, no App dependencies.

- **Plan.** It implements the plan in [PR #216](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/216), `proposals/environment/tidepool-audio.md` at `575bb90fec3e44be6a7f46ce66fe6a7577a1029f`. The assigned Track reviewer approved it for implementation on 2026-11-24 with `/approve-plan` for that commit at 07:05:26Z; the bot recorded the approval after a repeated command at 21:56:00Z.
- **Proposal file.** Unchanged since that commit (blob `307acdf79525bccc546e772a7481c11c9301cfaa`).
- **Package.** At commit `7fc8f06`. This report is updated in the next commit, which changes only `docs/validation/`. The first submission was `e4096de` (package `4149b6c`). The second, `da7f538` (package `feec7df`), added the clock cutoff and the [evaluation dataset](#evaluation-dataset-and-clock-cutoff-added-after-plan-approval-260) required since #260. This one (packages `cf8982b` and `7fc8f06`) answers the implementation review of 2026-11-28 ([below](#review-of-2026-11-28)).

This document records implementation evidence; it claims no acceptance.

Checked on 2026-11-28 (UTC) on macOS 27.2.1 (Darwin arm64) with Node v22.23.2 and v18.20.8. All data is synthetic. The runs used temporary directories and local stdio MCP, with no network, credentials or model API. Versions, the package hash and every count below are in [tidepool/index.json](tidepool/index.json), next to the raw reports.

**Automated outcome: passed.** Independent reproduction, official CI on the implementation commit and human review are still to come.

## Evidence

| Evidence | Result | What was exercised |
| :--- | :--- | :--- |
| App-only business tests, package alone | 33 passed, on both Node versions | A copy of `apps/tidepool/` with nothing beside it, run with only `PATH` and `LANG` set. The tests call the real business functions through an App-only harness that mirrors Core's handling of events and of `env.advance_time`: the clock moves to the event's time before validation, and a failed event rolls back. Every result is checked against `tools.json`, and every refused call or event is checked to leave business data identical. |
| Event example and generated files | Passed, on both | `examples/run.cjs` from the package alone. `dev/build-fixtures.cjs`, `dev/build-contracts.cjs` and `dev/build-dataset.cjs`, run in a copy, leave every committed file byte-identical: fixtures, example events, policies, task data, dataset counts, schemas and `tools.json`. |
| Public App verifier | 50 checks passed, on both ([node22](tidepool/public-runtime.node22.json), [node18](tidepool/public-runtime.node18.json)) | An isolated package copy, then real MCP. Agent discovery shows no Infra tools. It covers published input and output of the 16 tools the default `scenario` profile lists, the Agent denied all seven Infra operations, history loading and rejection, the declared event with retry and conflict, reset, a separate run and a restarted process. |
| CI job, reproduced | `tidepool: PASS`, on both | `node runtime/ci/verify-submissions.cjs . <out> a4bce02…`, the command of the `public-runtime` job. It selected `tidepool` only (`full: false`). |
| Real-MCP walkthrough | 158 checks passed, 304 calls traced, on both ([node22](tidepool/mcp-walkthrough.node22.json), [node18](tidepool/mcp-walkthrough.node18.json)) | What the verifier does not exercise for this App, across six loaded instances plus a default-policy one. Every call is joined to run, account, connection and request or event ID. See the list below this table. |
| Evaluation dataset over real MCP | 95 checks passed, on both ([node22](tidepool/dataset-demo.node22.json), [node18](tidepool/dataset-demo.node18.json)) | `examples/dataset-demo.cjs` loads `data/evaluation/seed.json` with its own `dataset.json` as the bundle dataset in one `env.load_seed` request (434,421 bytes), queries it at early, dataset and end-of-2026 clocks with `env.advance_time`, and checks that nothing dated after the clock is visible and no record changes. A last stage reloads it at 2026-04-01 with the task policy and runs the #216 review's nine album downloads through Core, checking the ninth receipt's counts, its activity row in `env.snapshot` and an identical retry |
| Dataset coverage | 454 distinct dates in 24 of 24 months ([coverage.json](tidepool/coverage.json)) | `dev/coverage-report.cjs --json` over the delivered file; details below |
| Repository suite | 22/22 stages passed, on both ([node22](tidepool/reference-suite.node22.json), [node18](tidepool/reference-suite.node18.json)) | The unchanged public suite (`npm test`) with this package present. |
| Independent base validator | Passed, 50 checks ([report](tidepool/base-runtime.json)) | An unmodified export of `main` at `a4bce023953061483c41de5a287ba5e43f4a5648`, the PR's base, validated the candidate checkout with its own `runtime/ci/verify-submissions.cjs`. It selected `tidepool` only. |
| Package identity | `57461ea7db8eab955d640a84cb74a95e9f6863b8ed69949dd8bc20adf9c71202` | The same package hash appears in the two verifier reports, the base validator report, the two walkthrough reports and the two dataset reports. Git tree `1473c6bd84052d8510a0a2b59c436bb5cf256814`. |
| Human review | Pending | Realism of the catalog, listening history and billing, including the generated dataset; that artists, shows, people and prices are fictional. |

The walkthrough's instances:

| Instance | What it covers |
| --- | --- |
| Priya | The main family's manager |
| Sam, Kai | The same family seed bound to their own accounts |
| Narrow | A task policy that narrows by member |
| Trip | A fresh instance for example request 3 |
| Leila | The second family's task data, loaded directly with its own dataset |

Across them the walkthrough exercises:
- all 33 tools and the seven event types;
- the three approved event examples;
- the three example requests, answered from what each account saw;
- replays, `idempotency_conflict` and `stale_version`;
- event lookup failures, each with `applied: false`, a `deny` audit row and no receipt;
- six clock steps with no event;
- one activity row per committed write or event, joined to Core receipts;
- reset of data and clock per instance.

## Reproduce

From the candidate checkout, with Node 18 or 22 and nothing to install:

```sh
cd apps/tidepool && npm test && npm run example && cd ../..
npm run app:verify -- --app apps/tidepool --output .artifacts/tidepool.json
node runtime/ci/verify-submissions.cjs . .artifacts/submissions a4bce023953061483c41de5a287ba5e43f4a5648
node apps/tidepool/examples/mcp-walkthrough.cjs > .artifacts/tidepool-walkthrough.json
node apps/tidepool/examples/dataset-demo.cjs > .artifacts/tidepool-dataset-demo.json
node apps/tidepool/dev/coverage-report.cjs
npm test
```

- **Package alone:** copy `apps/tidepool/` to an empty directory and run `npm test` and `npm run example` there.
- **Generated files:** run `npm run build:fixtures`, `npm run build:contracts` and `npm run build:dataset` in a copy and compare it with the original.
- **Independent check:** run this from a separate export of the base revision:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports a4bce023953061483c41de5a287ba5e43f4a5648
```

The base export was not modified and nothing in it came from the candidate.

## Workflow evidence

Each row reads: starting state → action → observed result, then a control that must leave state unchanged.
- "B" numbers are the business tests in `apps/tidepool/tests/business.test.cjs`, in run order.
- "W" numbers are the walkthrough checks in the reports above.
- The fixture is the Raman-Ellis family at Tuesday, Nov. 24, 2026, 19:00 Pacific: Priya (plan manager), Sam, Noor (teen) and Kai (child, explicit filter on).
- The task data is Leila Haddad's one-member account with a declined November payment.

| Workflow | Starting state → action → observed result | Failure or control | Where |
| :--- | :--- | :--- | :--- |
| Commute on earbuds (request 1) | Priya stopped Field Notes 112 at 31:10 on her earbuds. Infra applies the approved kitchen-speaker `listening.record` (113, 19:42) and a second one (114), both under her account → her history shows both kitchen sessions. The agent puts 112 at 31:10 and then the new 52-minute Harbor Hours episode at the front of Up Next (list version 2), and downloads both to her phone, which has about 300 MB free and Harbor Hours auto-download off → both are queued with bytes reserved and read downloaded at their completion time. The reply says the queue runs 62:50 at 1×, past 40 minutes. | The kitchen sessions' played state is left as it was. Sam's stored progress on 113 is untouched, his own account still reads 600 s, and his history has no kitchen session. | B5, B7, B8; W6–W12, W17–W38 |
| A clean road-trip playlist (request 2) | Sam's shared "Road trip ideas" holds two explicit tracks with clean versions and one without. The agent creates the collaborative "Road trip", owned by Priya with Sam, Noor and Kai as collaborators, using the clean versions and leaving the third track out. The approved `playlist.edit` (`playlist_ref` `{mem-priya, "Road trip"}`, author Noor) then adds `tr-saltline-07` at position 4 with Noor as author, one new version and a notice for Priya. The agent swaps in its clean version in place; Kai's filter is unchanged. | Before the playlist exists, the same event fails `target_not_found` with `applied: false`, a `deny` audit row, no receipt, and data and clock unchanged; it commits later under the same `event_id`. Two "road trip" playlists give `ambiguous_target`. Noor on Priya's private playlist gives `not_collaborator`. An agent-created playlist named by `playlist_id` gives `target_not_found`. | B16; W41–W59 |
| Before a flight (request 3) | Priya's phone holds 15 played downloads of two shows she unfollowed. Her Up Next fits, but the second saved album returns `storage_full`. The agent removes the played downloads and downloads the queue and both albums. The reply gives the phone's offline check, Monday, Nov. 30, 7:00 PM Pacific, which falls during the trip. It also says the plan stays Family: the two unused slots carry no charge, and Duo allows 2 of 4 members. | `storage_full` leaves data unchanged. After 30 days without a check-in, with no event, every phone download reads `needs_check` and `family.get` counts them. | B8, B9; W113–W123 |
| W1 Catalog | Kai's search marks explicit tracks `filtered` and places each one's clean version right after it. `catalog.get_item` returns an episode's chapters, end marker and the caller's position. | An unknown ID: `not_found`. A removed episode cannot be queued (`unavailable`). An episode of a removed show cannot be queued or played. | B3, B4; W21–W22, W97–W98, W112 |
| W2 Listening and progress | A session to the end of 112 marks it played for Priya → `progress.set` back to 31:10 records `set_by: agent` and the replaced value, and adds no session. | A position beyond the duration: `invalid_position`. An unknown episode: `not_found`. A session on a device signed in to another member, past the item's length or longer than its time allows: `invalid_event`. All leave state unchanged. | B5, B6; W106–W111 |
| W3 Follows, Up Next and downloads | Up Next is replaced as a whole list (version 2). A download completes one simulated minute after acceptance. A download played on the train is auto-deleted two days later by time alone. Follow, settings and unfollow writes commit. On publish, auto-download keeps the newest *n* and records `storage_full` in the follower's notice. | A stale list version: `list_version_mismatch`. Exceeding the cap: `storage_full`. Cancelling a queued download releases its bytes. Unfollowing keeps downloads. | B7–B13; W24–W36, W39–W40, W69–W73, W88–W92 |
| W4 Playlists | Noor's `playlist.edit` on the seeded collaborative "Family car songs" records her as author → Kai's account keeps the explicit track and marks it skipped for him. The owner renames a shared playlist. | A collaborator changing visibility: `forbidden`. A removed collaborator's earlier additions stay. | B14, B15; W15–W16, W93, W99–W100 |
| W5 Family plan and controls | Priya invites Ana; a declined response frees the slot; Ana is invited again and the approved acceptance event makes her active. Family → Duo is refused for five members. `members.remove` for Noor returns the six-field impact `family.get` showed beforehand: two collaborations ended and her shared playlist hidden from the family. | `already_invited`, `already_member`, and `target_not_found` for a response with no open invitation. `no_pending_change` with nothing scheduled. Sam's account changing Kai's filter: `forbidden`. A plan call naming another member: `forbidden`. A task policy narrowing by member: `permission_denied`, audited with the `id`. | B19, B20; W60–W68, W74–W82, W86–W87, W101–W105 |
| W5 Billing (task data) | Leila's payment is due within its grace period → an upgrade is refused → the grace period ends by time and downloads read `needs_check` → the `paid` event restores them. An upgrade to Duo adds 221 cents of proration to the next invoice, equal to the quote. A downgrade back to Individual is scheduled, revoked, and kept-then-revoked by choosing the plan in effect. After period end, by time, she is on Individual and the invoice is 1320 cents, pending. | New downloads wait for payment. Revoking twice: `no_pending_change`. Choosing the plan in effect with nothing scheduled is refused. | B17, B18; W132–W151 |
| Time alone (the review's close check) | Six `env.advance_time` steps with no event: download completion, auto-delete, the 30-day check, billing period end, grace end, and period end with a downgrade. Each commits, business data and activity rows stay byte-identical, Core audits only the clock change, and `family.get` agrees with `downloads.list`. | The billing period end moves to Dec. 3 with the invoice pending and the account active; no record is created. | B8, B10, B17, B18; W32–W36, W69–W73, W119–W128, W134–W137, W147–W151 |
| Core contracts and records | A byte-identical `env.apply_event` resend and an identical `upnext.set` retry are duplicates with no new version. Each of four instances has one activity row per committed write and per applied event, each joined to a Core receipt. | Changed event or request content: `idempotency_conflict`. An old version: `stale_version`. The default policy exposes the 16 reads only and denies writes. The Agent cannot inject events or advance the clock. | B21; W1–W5, W13–W14, W25–W27, W83–W85, W94–W96, W129–W131, W152–W154; verifier |
| Seeds, reset and instances | The fixture recomputes progress from its sessions. Clean versions match their title and artist, files are under 1 MiB, and no download reaches Priya's phone after its last check-in. The task data loads directly with its own `dataset.json`. Reset restores the loaded family, history, catalog and clock of that instance only. | Inconsistent seeds are refused (`invalid_seed`). The fixture also validates under a January clock, because seed dates are never compared with the run clock. Resetting Priya's instance leaves Sam's as it was. | B1, B2; W132, W155–W158 |

## Evaluation dataset and clock cutoff (added after plan approval, #260)

The plan was approved on 2026-11-24; #260 published the Environment data rule on 2026-11-25. This scope was added after the plan was approved, for that rule (`docs/submission-evidence.md`, sections 3 and 4) and the reviewer's clock-gap finding on a sibling App. Error codes and events are unchanged; the 2026-11-28 revision added `later_history_removed` to every write tool's output and as an optional activity-row field ([below](#review-of-2026-11-28)).

**Clock cutoff** (`src/visible.cjs`):
- Reads, writes and events see the data as of `ctx.virtual_now`. A record exists from the time it happened: an episode from `published_at`, an album and its tracks from the start of the release day (in the billing anchor's offset), a session from `ended_at`, a download from `requested_at`, a payment from `at`, a member from `joined_at`, and so on.
- State a record gained later reads as it was before:
  - a later removal or response is undone;
  - progress and play counts come from the visible sessions;
  - a device's later check-in reads as the end of its latest visible session, or its registration.
- Scheduled fields stay visible: `completes_at`, `auto_delete_at`, timeline `from`.
- A write or event on a later record fails (`not_found`; `invalid_event` or `target_not_found` for events) and changes nothing.
- Changed records replace their stored form, including a later stored record with the same key.
- If later family records cannot coexist with a change (validation fails), the family is stored as it reads at the clock plus the change; later albums, tracks and episodes are kept.
- Every later record that a change drops or replaces, in either case above, is reported: the change's activity row holds it as stored (`later_history_removed`, by family), and the write's receipt counts it per family; both are `null` otherwise (B31–B33, [below](#review-of-2026-11-28)).
- Before the bound member's `joined_at`, every tool returns `not_found`.
- The README carries the field table.

**Dataset** (`data/evaluation/`, version 1.0.0):
- `seed.json`: sha256 `88a0c16c916f7c557c6bc109b2363078c662c4647a0a82e193f3555e234f22e8`, 434,728 bytes (428,654 compact), 826 records as counted by `plugin.records`.
- `dataset.json` validates against `schemas/dataset.schema.json` (tested) and records the seed's bytes and sha256 under the generated source's `generation.parameters.outputs['seed.json']`. The demo loads the seed with this file as the bundle's `dataset`.
- Window 2025-01-01 to 2026-12-31, America/Los_Angeles; dataset clock 2026-11-24T19:00:00-08:00 (the fixture clock).
- Contents: Priya's 2025 on the Individual plan (123 sessions on her old phone, 12 invoices, one declined and paid); the fixture's 2026, verbatim; and each show's episodes on the fixture cadence from January 2025 to December 28, 2026.
- Three fixture records change for the 2025 story, and the test lists them: `family.created_at`, Priya's `joined_at`, and `billing` anchor and timeline.
- All records are synthetic: 512 authored, 2 changed and 337 generated by `dev/build-dataset.cjs` with seed 20250103. No real source exists for the invented catalogue.

**Coverage** (`node apps/tidepool/dev/coverage-report.cjs`):
- 858 dated records: 851 counted, 7 excluded (albums released 2022-2024, before the window).
- 454 distinct dates in 24 of 24 months, 444 on or before the dataset clock; the sources include 8 in-window album releases.
- Longest gap 8 days (2026-12-12 to 2026-12-19).
- Family records fall on 282 dates; their longest gap before the clock is 16 days (August 2025 vacation).
- 0 identical episode texts; 0 pairs at word 5-gram Jaccard ≥ 0.8.

| Command | Node 22.23.2 | Node 18.20.8 |
| --- | --- | --- |
| `npm test` (apps/tidepool) | 33 tests, 33 pass | 33 tests, 33 pass |
| `node runtime/cli.cjs verify --app apps/tidepool` | passed, 50 checks | passed, 50 checks |
| `npm run walkthrough` (apps/tidepool) | passed, 158 checks (same checks and reference replies as the v1.0.0 evidence) | passed, 158 checks (same) |
| `node apps/tidepool/examples/dataset-demo.cjs` | 95 checks; one `env.load_seed` of 434,421 bytes, with `data/evaluation/dataset.json` as the bundle's `dataset` | 95 checks |
| `node apps/tidepool/dev/build-dataset.cjs` twice | byte-identical output | — |

All reports carry package sha256 `57461ea7db8eab955d640a84cb74a95e9f6863b8ed69949dd8bc20adf9c71202`.

New tests in `tests/business.test.cjs`:
- *a seed loaded before its latest record shows only what existed at the clock* (Leila's task data on Oct. 1, 2026, then advanced to Nov. 24 with no data change; and on Feb. 1, 2026, before an album's release);
- *at a mid-2026 clock a device that played recently reads as checked in then and keeps its downloads*;
- *a write before a seeded later record with the same key replaces it; other later records stay*;
- *a write that the later family records cannot coexist with drops them and keeps later episodes*;
- *before the account exists every tool returns not_found and family events are refused; catalog events apply*;
- *events count only visible records: playlist positions, newest-n auto-downloads and seeded later IDs*;
- *the evaluation dataset matches its dataset.json and keeps every fixture record except the three its 2025 story extends*;
- *at the dataset clock the fixture facts read the same for Priya and Sam*;
- *the evaluation dataset loads at any clock in its window and shows nothing dated later* (2025-03-15, 2025-12-31, the dataset clock, 2026-12-31);
- B31 *a write at an early clock that drops later family records reports each one in its receipt and activity row*;
- B32 *every kind of early-clock collision reports the later record it replaced, and a plain write reports nothing*;
- B33 *an event at an early clock that replaces a later record keeps it in the event's activity row*.

**Added scope against the approval baseline:** the dataset and its three scripts; `later_history_removed` in every write receipt (counts) and as an optional activity-row field (the stored records), from the 2026-11-28 revision; the clock cutoff in `src/visible.cjs`, including the rule that stores the family as it reads at the clock when a write conflicts with later family records; and a larger package: 1,692,561 bytes of tracked files under `apps/tidepool/`, up from 1,118,899. The approval review asked to cover seed history from 2026-01-01 where possible; the dataset now covers 2025 as well.

### Review of 2026-11-28

The implementation review of `da7f538` asked for two must-fixes. Packages `cf8982b` and `7fc8f06` and this commit answer them; the approved proposal file is unchanged.

- **Must fix 1: the cutoff fallback removed later records without reporting them.** `commit()` in `src/visible.cjs` now compares the stored data with the data it stores, after the merge-or-fallback decision. Every stored record that the clock view hid or showed in an earlier state, and that is no longer stored as it was, is reported. That covers the fallback and the two same-key paths: a later record replaced by the change, and a later active download or open invitation with the same key. The change's activity row holds those records as stored, by family, in `later_history_removed`; the write's receipt counts them per family; both are `null` otherwise. The receipt holds counts rather than IDs because it goes to the Agent, and the dropped records include other members' sessions and payments dated after the clock.
  - B31 is the review's repro: the full dataset at 2026-04-01 and albums added to Priya's phone. The ninth (`alb-copperleaf-1`) returns `later_history_removed: {devices: 6, sessions: 143, progress: 87, plays: 28, follows: 3, upnext: 2, downloads: 33, library: 8, playlists: 4, notifications: 14, billing.payments: 8}`, and its activity row holds those 336 records. Sessions go from 321 to 178, and Priya's history at the dataset clock is 157, which is 242 less the 85 reported sessions dated by then. The eight earlier downloads report `null`.
  - B32 covers the same-key paths (progress, a follow and Up Next replaced at the clock) and a plain write that reports `null`.
  - B33 covers an event: a `listening.record` at 2026-04-01 that finishes an episode whose progress the seed records on Apr. 2 keeps that progress row in the event's activity row.
  - All three check the report against an independent before/after diff, in which a record counts as later when it records a time after the clock.
  - The dataset demo's last stage runs the repro through Core with the task policy: a `committed` receipt with the counts above, the activity row in `env.snapshot` holding exactly those records as the seed stored them, and an identical retry returning the stored receipt marked duplicate.
  - The README describes the report and tells Task authors to start at or after the dataset clock, or stage later records as scenario events, when the Agent writes.
- **Must fix 2: PR description.** Updated to the validation stage, with the progress boxes checked and a link to this report at the submitted commit.
- **Should fix 3.** The README's dataset section states that there is no family history before 2026 and that a Task needing 2025 family records must supply them.
- **Should fix 4 and 5.** The reports stay under `docs/validation/` unless maintainers prefer PR attachments. The templated episode notes are left for the human realism review.

## Plan and implementation

Everything in the plan's first version is implemented:
- the 33 operations it lists, all named `tidepool.<name>` (16 reads, 17 writes);
- the seven events, with the lookup rules of the approved revision;
- the state and lifecycle rules, with time-based states stored as due times and derived from the clock;
- the main family's fixture and a second family's task data;
- evidence for the three example requests.

The README has the operation list, the rules, the data a task can use for each request, and a proposal-row-to-evidence table.

The plan's three open questions were answered in review and are implemented that way:
- an explicit track stays in a playlist and is skipped for a filtered member;
- `speaker_hint` is stored but never used for authorization;
- fixtures are MIT.

The suggestion to cover history from 2026-01-01 is followed.

**Approval-review items resolved:**

- **Item 1, events that point at records the Agent creates.** Resolved in the approved revision and implemented as written:
  - `playlist.edit` finds a playlist by `playlist_ref: {owner_member_id, name}`, ignoring case and surrounding spaces, or a seeded one by `playlist_id`.
  - `family.invite_response` finds the invitee's one open invitation by `invitee_person_id`.
  - Lookup failures return `target_not_found`, `ambiguous_target` or `not_collaborator`, with nothing changed and no receipt, so the same `event_id` can be retried.
- **Item 2, caller identity and per-member narrowing.**
  - The caller comes from the seed's `account_id` and `owner_person_id`, which only Infra loads. `validateSeed` checks the pair against `binding.json` and maps it to exactly one active member. "Sam's account" is a separate instance.
  - Every member-scoped tool takes the member as `id`, and changes go in `patch`, so Core's policy `ids` and `fields` constraints apply directly.
  - On top of that, the App returns `forbidden` for another member's records and for non-managers on manager tools.
  - The plan tools take the manager's own `id`. `members.invite` takes a person ID, so `ids` lists for it hold person IDs.
- **Item 3, billing between period end and the payment event.**
  - Periods are calendar months from the billing anchor, derived from the clock; nothing is stored when a period starts.
  - In between, the plan is the one in effect at that instant, the status stays `active`, and the new invoice reads `pending`.
  - An upgrade applies at once and adds its prorated difference to the next invoice.
  - `plan.preview_change` and `plan.confirm_change` share one classification, and the quote is read from a trial copy.
  - The README gives worked examples.
- **Item 4, prefixes.** All 33 tools are `tidepool.<name>`.

**Where the implementation adds to the plan's wording:**

- **List versions.** `upnext.set` requires `expected_list_version`, and `playlists.update_tracks` takes an optional `expected_track_version`. A mismatch returns the App code `list_version_mismatch`; `stale_version` stays Core's.
- **App use of `invalid_arguments`.** The App returns it for:
  - a blank playlist name;
  - a track already in the playlist;
  - the owner listed as collaborator;
  - follow settings that differ from an existing follow;
  - choosing the plan in effect, or a downgrade already scheduled, with nothing to revoke.
- **Playlist operations.** They name tracks by ID. An `add` past the end appends, because an event author cannot know the length of a playlist the agent created.
- **Auto-download "newest *n*".** It releases older auto-downloads of the show on that device.
- **Auto-delete window.** It counts from the later of when the episode was played and when it was downloaded. A new follow's auto-delete applies to downloads already played.
- **Who `payment_due` blocks.** Upgrades at any time while a payment is due; new downloads only after the grace period.
- **Accepted invitations.** They create a predictable member ID, such as `mem-ana`.
- **Member removal.** It also hides the member's own shared playlists from the family and counts them in the impact. `family.get` shows other members' download counts to the manager only.
- **Choosing the plan in effect** with `plan.confirm_change` revokes a scheduled change.
- **Offline check display.** The offline-check due time is shown in the current clock's offset.
- **Reference replies.** The walkthrough's replies are evidence for the data and tools, not model trials. Hand-written wording is filled in from tool results, and checks compare each reply's facts with what the account read.

## Package boundary

- **Imports.** The package imports only Node built-ins and its own files. `service.cjs` is the provided launcher and the only file that loads the runtime.
- **Diagnostics.** The optional diagnostics adapter carries IDs and counts only and swallows its own errors, so it cannot change business results. It has no dedicated test.
- **Copies and discovery.** `tests/schema-validator.cjs` is a copy of the public validator. The walkthrough finds the runtime by walking up to the checkout, or through `PALE_RUNTIME_ROOT`.
- **Scope.** Only `apps/tidepool/` and this report are added; no registry or runtime file is changed.

## Data and licence

- **`data/evaluation/`**: the 2025-2026 evaluation dataset described above, rebuilt by `dev/build-dataset.cjs`. The fixtures below are unchanged.
- **`fixtures/minimal.json`** (326 KB): a catalog of 10 artists, 15 albums, 120 tracks (12 explicit tracks with clean versions), 8 shows and 150 episodes, and a four-member family with six devices. History runs from January 2026: 198 sessions, progress, follows, downloads, playlists and eleven monthly payments. It counts 506 records.
- **`examples/task-data/`**: the second family's seed (174 KB, 315 records), binding, policies, dataset and a payment event.
- **Events and policies:** `examples/events/` holds an example of each event type, and `examples/policies/` holds a narrowing policy.
- **Generation:** `dev/build-fixtures.cjs` rebuilds all of them. Sessions are expanded from hand-written routines by fixed arithmetic, with no randomness.
- **Provenance:** all text is original and fictional; nothing was crawled, copied, translated or adapted, and provenance is in `contribution/dataset.json`. There are no media assets.
- **Licence:** code and fixtures are under the repository's MIT License.
- **AI assistance:** the code, fixtures and this report were prepared with AI assistance (Claude); the author reviews them and is accountable for them.

In `tidepool/reference-suite.node*.json`, report paths inside stage commands were rewritten from a local temporary directory to `.artifacts/`. No other report was edited.

## Not claimed, and what remains

- No agent trials: model-agent runs are deferred for v1.
- No GUI or reviewer console: MCP is the declared interface, as approved.
- No production deployment.
- Family state does not sync across App instances. Each member's account is a separate instance with its own copy of the family, and a write is visible only in the instance that made it.
- Open items:
  - The reviewer asked that example request 2 give the playlist name the event uses. The package uses "Road trip" (README Fixtures table and the `playlist.edit` example). This will be confirmed in the PR rather than by amending the approved proposal, which would need another design review.
  - The App name Tidepool Audio matches a real pro-audio shop, and the show name Field Notes matches real podcasts. Both names are fixed by the approved proposal, and the package uses no content from either.
- Remaining:
  - independent maintainer reproduction and acceptance;
  - official PR CI on the implementation commit (`public-runtime (18)`, `public-runtime (22)`, `base-runtime-compatibility`), which awaits maintainer approval of the fork's workflow run;
  - human review of realism (including the generated dataset) and of the invented artists, shows, people and names.
