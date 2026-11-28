# CutRoom delivery evidence

v1 for PR #239. Approved scope: `proposals/environment/cutroom.md` @ `ad21e67`. Policy revision: `docs/submission-evidence.md` at upstream `6933c43`.

Run everything from the PALE checkout root (Node.js 18 or later, public runtime 1.6.0, Core API 1.2.0):

```sh
npm --prefix apps/cutroom test                        # business + dataset tests
node --test apps/cutroom/tests/mcp.test.cjs           # stdio MCP, image access, real dataset load
npm run app:verify -- --app apps/cutroom --output .artifacts/cutroom.json
node apps/cutroom/scripts/coverage.cjs                # recount dataset coverage
```

## Review items from the plan approval

| Item | How it is handled | Tests |
| --- | --- | --- |
| 1. A scheduled release once its time arrives | A read derives the release from `ctx.virtual_now` and writes nothing. Clearance is checked again at the scheduled instant: if it fails, the project stays `private` and `release_blockers` gives the reason. An event at exactly that instant counts. A revocation after release adds an audit blocker and leaves the project `public`. | `business.test.cjs`: "release derives at the scheduled instant…", "revocation before or exactly at release…"; `mcp.test.cjs` (both cases over MCP) |
| 2. What `license.revoke` means | Music: `revoked` produces `invalid_license`. Guest release: `withdrawn` produces `missing_guest_release`, and `signed` re-signs it and clears the blocker. Any other status, or music that is not assigned to the project, is rejected as `invalid_event`. | `business.test.cjs`: "guest withdrawal and re-sign…"; `history.test.cjs`: "later revocations and withdrawals…" |
| 3. Registering image access | Thumbnails and keyframes belong to their `project`. The mapping `project` → `cutroom.projects.get` is in `runtime/registrations/cutroom.json`, a separate commit for maintainer review. Access does not depend on release visibility. | `mcp.test.cjs`: resource read and hash, cross-run denial, scoped `projects.get` hiding images |
| Suggestion: override as its own tool | `cutroom.projects.override_release`. The scenario policy leaves it out. It records the actor, time, intended transition and blockers. | `mcp.test.cjs` (`permission_denied`), `business.test.cjs` |

## Implementation review items (review of `06360bd`)

| Item | How it is handled | Tests |
| --- | --- | --- |
| 1. Failure-path tests named in the plan | Every event type is tested with unknown or mismatched targets: unknown project, unknown resource, another project's track or guest, a wrong status, an unknown or foreign cut, a duplicate note ID, another cut's or project's thumbnail, a keyframe as an A/B candidate, and an undeclared operation. Each returns `invalid_event`, and data and clock stay unchanged. Over stdio MCP, the tests also cover: a stale `expected_version` on a tool write and on an event (`stale_version`); a reused `request_id` with other arguments; an identical event replay (`duplicate`) and a changed one under the same `event_id` (`idempotency_conflict`). After each, data, clock and version are checked to be unchanged. | `business.test.cjs`: "every event type rejects unknown or mismatched targets…"; `mcp.test.cjs`: "stale writes, conflicting replays, unknown targets and early-clock loads…" |
| 2. An earlier clock exposed later history | `validateSeed` rejects data (`invalid_seed`) when a stored past fact is dated after `ctx.virtual_now`. Schedules and license expiries may point forward. Core runs it on `env.load_seed`, events and writes. The history dataset records `load_clock` in `dataset.json`: default `2026-11-19T18:00:00Z`, minimum `2026-11-17T20:00:00Z` (its latest past fact). Loading it at `2025-06-01` now returns `invalid_seed` with version unchanged. | `business.test.cjs`: "a seed whose history is dated after the clock is rejected…" (one case per fact type); `history.test.cjs`: "the history dataset cannot be loaded at a clock earlier than its minimum"; `mcp.test.cjs` (early load refused, load at the minimum accepted) |
| 3. The thumbnail example had two correct answers | `thumb-c` now has its own visible defect: the title is clipped at the right edge. In every project exactly one candidate is acceptable. The other two carry one of three defects (badge covers the title, right-edge clip, unreadable contrast), and both the acceptable letter and the defect positions vary: ep14 B, ep15 A, ep16 C, ep17 B, ep18 A, ep19 C. Defects are placed from the measured pixel width of the rendered title. | `review/visual-checks.md` (answer key, verified visually at full size and at 168 px) |
| 4. Dataset realism | See "Evaluation dataset" below: authored episode plan, distinct topic-tied notes, varied cadence, planned exceptions, and A/B history on real thumbnails across the window. | `history.test.cjs`: "history is varied…", "A/B history spans the window…"; `mcp.test.cjs` (history load with 48 images, A/B thumbnail read and hash) |
| 6. (should) Images | One scene per topic. Keyframes are frames with a burned-in review timecode and no duration badge, each showing a timecoded note's moment. The catalog `alt_text` describes each image without giving away the answer. | `review/visual-checks.md` |
| 7. (should) Image access depends on a host file | Stated in the README. `mcp.test.cjs` fails with a message naming `runtime/registrations/cutroom.json`. | `mcp.test.cjs` |

The acceptance checks named in the review are covered. `max_bpm` 115 returns the 115 BPM track and 114 does not. A license is still valid at exactly `expires_at`. `clearance_blocked` leaves state and version unchanged. The image cue sheet is in `review/visual-checks.md`, and agents cannot read it over MCP.

## Evidence index

| Workflow / requirement | Scope | Reference screenshots | Implemented sequence | Business and MCP tests | Dependency result | Date report | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Release check | Required | N/A: MCP-only, `ui: "none"` | N/A | business, mcp | N/A: no App dependencies | `coverage.md` | Passed locally |
| 2 Thumbnail choice | Required | N/A | N/A | business, mcp (PNG `resources/read`) | N/A | — | Passed locally; human visual sign-off pending |
| 3 Music replacement | Required | N/A | N/A | business (BPM and expiry boundaries) | N/A | — | Passed locally |
| Scheduled release and revocation | Required (item 1, 2) | N/A | N/A | business, history, mcp | N/A | — | Passed locally |
| Image access registration | Required (item 3) | N/A | N/A | mcp | Core `resource-access` | — | Waiting on maintainer review of the registration file |
| Evaluation dataset 2025-01-01 to 2026-12-31 | Required by policy `6933c43` | N/A | N/A | history, mcp (`env.load_seed`) | N/A | [`coverage.md`](coverage.md), [`coverage.json`](coverage.json) | Passed locally; realism review pending |

There is no GUI, Messaging or cross-App connection in the approved scope. So no reference screenshots or dependency demonstrations apply.

## Evaluation dataset

- `datasets/history/` holds `seed.json`, `dataset.json`, `assets.catalog.json` and `binding.json`. The seed has 51 projects and 39 library items in the normal seed schema. It contains the 6 evaluation fixture projects, plus 45 history episodes from the authored plan `scripts/history-episodes.json`. The plan has 48 slots, 3 of them skipped. The catalog has 48 images: the 24 package PNGs plus 24 A/B thumbnails in `datasets/history/assets/`.
- To load it, call `env.load_seed` with the arguments from `scripts/history-bundle.cjs` `loadSeedArgs()`. Blobs are read from each catalog entry's `storage.path`. The last test in `mcp.test.cjs` shows this.
- Realism: 292 review notes over one to three cuts per episode, every note text distinct and tied to that episode's content and a timecode. 51 distinct descriptions. Releases fall on 21+ days of the month at 20+ times of day. The plan includes 3 skipped slots, 5 delayed releases (the reason is in the description), 2 unlisted sponsor previews, 1 release pulled with an open follow-up note, and A/B results on 12 released projects from 2025-01 to 2026-11. `history.test.cjs` checks these properties.
- Coverage: 354 distinct dates, every month of the window, 0 records outside the window, time zone `America/Los_Angeles`. December 2026 holds only fields that point forward from the clock (`2026-11-19T18:00Z`): a scheduled release and license expiries. No note, signing or release after the clock is stored as a past fact.
- Provenance: everything is synthetic. CutRoom models one creator's private production workspace, so it has no public website history to collect, and there is no real anchor data. `scripts/build-history.cjs` (seed 239) regenerates the files byte for byte, and `history.test.cjs` checks that the committed report matches the committed seed's hash.
- Change from the approved plan: the plan started history on or after 2026-01-01. The later policy asks for 2025-01-01 to 2026-12-31. This is added delivery work: the proposal file is unchanged, and the small fixture `fixtures/minimal.json` stays the default seed.

## Incomplete or open

- Independent human visual and provenance review of the 48 PNGs (24 package, 24 history) and of the dataset's realism (`dataset.json` `review.status: pending`).
- Maintainer review of `runtime/registrations/cutroom.json`.
- CI `public-runtime (18)`, `public-runtime (22)` and `base-runtime-compatibility` run on the PR. Locally only Node.js 23 was used.
- Out of scope by design: video encoding, streaming, real uploads, GUI.
