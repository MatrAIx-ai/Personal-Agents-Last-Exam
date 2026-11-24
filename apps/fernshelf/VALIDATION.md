# Fernshelf 1.0.0 validation

Checked on 23 November 2026 (America/Los_Angeles) against base `main` commit `a4bce02`. Environment: Node.js v22.23.1 (Linux), public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0, Mail 1.3.0. Scope: the approved Environment proposal [`proposals/environment/fernshelf.md`](../../proposals/environment/fernshelf.md). The package checks also passed on Node.js v18.20.8 and v20.19.6. All data is synthetic. No network, credentials or model API were used.

**Automated outcome: passed. Human workflow, media and provenance review: pending.** No acceptance is claimed.

## Commands and results

| Evidence | Command | Result |
| --- | --- | --- |
| App-only business tests | `cd apps/fernshelf && npm test` | 38 tests, 38 passed, 0 failed (about 6 s) |
| Walkthrough | `npm run example` | Iris joins an album made in the run through `album_match` and saves a photo through its link. Dana's request is honoured for Reunion 2026 only (Omar's photo `not_removable`). The result lists Kofi's earlier view and save. A later re-share returns one `removal_honored` warning |
| Generated contracts | `npm run contracts:check` | `tools.json` and the seed, events and state schemas match `scripts/build-contracts.cjs` |
| Reference fixture | `node scripts/build-reference-fixture.cjs --check` | `fixtures/reference.json`, `assets/*.png`, the catalogue and the dataset counts match the builder |
| Fixture consistency | `npm run fixtures:check` | `minimal.json` and `reference.json`: no problems; 48 image files, 581,315 bytes; every place is an invented name without coordinates |
| Package real MCP | `node apps/fernshelf/scripts/real-mcp.cjs` | 60 checks passed |
| Fernshelf → Mail | `node apps/fernshelf/scripts/mail-flow.cjs` | 25 checks passed (Mail 1.3.0, real router and receiver) |
| Public verifier | `npm run app:verify -- --app apps/fernshelf --output .artifacts/fernshelf.json` | passed: 44 checks; the `business` and `event-example` stages passed from an isolated package copy |
| CI selection | `node runtime/ci/select-apps.cjs . a4bce02` | `full: true`, because the change adds `runtime/registrations/fernshelf.json`; all 8 Apps are selected |
| CI submission validator | `node runtime/ci/verify-submissions.cjs . .artifacts/submissions a4bce02` | all 8 Apps PASS, `fernshelf: PASS` |
| Base-revision validator | `git archive a4bce02 runtime package.json`, then `node <base>/runtime/ci/verify-submissions.cjs . <out> a4bce02` | all 8 Apps PASS. This run has no `fernshelf.json` registration, so it is also the fallback case |
| Shared contracts | `npm run contracts:check` (repository) | passed |
| Repository suite | `npm test` | 22/22 stages passed |
| Node 18 and 20 | the same package commands with `~/.nvm/versions/node/v18.20.8/bin` and `v20.19.6/bin` | 38/38 tests, example, contracts, fixture builder and consistency, real MCP 60/60, Mail flow 25/25 on each |
| Isolated package | a copy of `apps/fernshelf` alone: `npm test`, `npm run example`; then `scripts/real-mcp.cjs --runtime DIR` and `scripts/mail-flow.cjs --runtime DIR --mail DIR` | 38/38; example passed; 60/60; 25/25. Without `--runtime` the scripts stop with a message naming the option |

Captured outputs are kept with the review notes for this submission, outside the repository.

## Workflow-to-test mapping

Test files are in `tests/`, and `business.test.cjs` loads them all. In the tables below:

- "ref" means `tests/fixtures.test.cjs`, the acceptance rows on the reference fixture.
- "MCP" means `scripts/real-mcp.cjs`.
- "Mail" means `scripts/mail-flow.cjs`.

### Acceptance plan

| Workflow | Main path and control | Evidence |
| --- | --- | --- |
| W1 main | Search for `pl-dana` in November 2026: 7 rows, two of them covers with `stack_size` 3. `items.get` on `it-2611-0942` lists three versions with the edit as cover. Storage: 13.95 of 15 GB used, 0.41 GB in the trash, `duplicate_bytes` as the rule gives (computed independently in the test). `items.read` returns the PNG whose SHA-256 is in the catalogue. `exposure.get` on `it-2611-0931` lists Reunion 2026 with 4 joined members, `ln-0012`, and one view and one save by Kofi | ref W1; MCP "items.read returns the stored PNG", "exposure.get lists Reunion 2026" |
| W1 controls | `not_found`, `no_file` (video), `invalid_window`, `gone` (past retention), `in_trash`; every read leaves business data byte-identical (harness on every read; MCP with audit +1) | ref W1; w1 T01–T05; MCP "Read leaves business data byte-identical" |
| W2 main | `albums.create`, then `albums.update` with 12 `add_ids`: the album lists them in order. Adding `pl-omar` makes the item findable by that label. `make_cover` on the original changes the stack's search row | ref W2; w2 T06, T07 |
| W2 controls | `in_trash`, `already_in_album`, `limit_exceeded` (51), `not_stacked`, `confirm_required` (shared album, and a private album with an active link); version unchanged in each | ref W2; w2 T06, T07 |
| W3 main | Invite Dana: `invited`. A join makes her visible on every item of the album. Omar's contribution is saved with source `saved_from_share`. A 7-day link records a view and a save, is revoked, and the view and save stay listed. On an album made in the run: a join by `album_match` `contains_item_ids` puts Dana in the new album, and the activity row names it. A view through `{"type":"link","album_match":{"person_id":…}}` with `"all"` is recorded on the link the Agent created | ref W3; w3 T08–T10; MCP "member.changed by album_match" |
| W3 controls | `already_invited`, `not_member`, `invalid_window`, a view of a revoked link (`invalid_event`), a match that finds no album (`invalid_event`), a link read as `expired` after the clock moves, `over_quota` | ref W3; w3 T08–T10 |
| W4 main | Dana's request (examples/scenario.json) is `pending` and changes no album. `honor`: `it-2611-0931` and `it-2611-0934` leave Reunion 2026 and no other album. `ct-omar-0007` is `not_removable`. The result lists Kofi's earlier view and save, and each item has a `removal_history` row. A later `albums.update` into Family 2026 is accepted with one warning for Dana | ref W4; w4 T11, T12; example |
| W4 controls | Honouring twice: `invalid_state`. Scope `everywhere` clears every album with members or an active link and leaves Best of 2026 (shared with no one) alone. A withdrawal after the answer: `invalid_event`. A pending request (`rr-0005`): no warning | ref W4; w4 T11, T12 |
| W5 main | Trash the 8 duplicates: they leave every album view and `exposure.get`, and `used_bytes` is unchanged. Restore one: it is back in its two albums. After the clock passes `purge_at` the other seven read `purged`, `used_bytes` drops by their bytes, and `items.read` answers `gone`. A purge with `confirm` frees bytes at once. From the fixture with 1.05 GB free: a 1.2 GB video waits (`backed_up: false`, used unchanged, pending 1.2 GB, one `full` notification). It is searchable and not exposed. It stays waiting after a 0.3 GB purge, and `backup.resumed` then backs it up (+1.2 GB) | ref W5; w5 T13 |
| W5 controls | `gone` on restore, `confirm_required`, `not_backed_up`, `backup.resumed` while it still does not fit, `invalid_state`, `not_yours` with none of the batch changed, trashing a cover promotes the newest remaining version | ref W5; w5 T13; w2 T06 |

### Local business tests T01–T15

| Test | Where |
| --- | --- |
| T01–T05 | `tests/w1-library.test.cjs` (one test each); T04 with bytes in ref W1 |
| T06–T07 | `tests/w2-organising.test.cjs` (T06 has two tests: fields and covers) |
| T08–T10 | `tests/w3-sharing.test.cjs` (T08 has two tests: members, and `album_match` with by-person, by-items, by-title, newest-wins, no-match and replay) |
| T11–T12 | `tests/w4-removals.test.cjs` (T11 has two tests) |
| T13 | `tests/w5-storage.test.cjs` (three tests: trash and purge, items not backed up, the 80% threshold) |
| T14 | `tests/cross.test.cjs`; MCP "advance_time commits and changes no business data", "storage.summary drops", "items.read of such an item is gone", "The next commit stores the purge" |
| T15 | `tests/cross.test.cjs` (19 invalid events, notifications and activity rows, wire messages, 24 seed-validation refusals); MCP for the Core side: replay, `idempotency_conflict`, `stale_version`, Agent `permission_denied` on all 7 `env.*` operations, a backdated event, reset restoring seed, files and time, a separate run |

Other package tests: generated contracts and tool shapes, optional diagnostics, builder match and consistency (`package.test.cjs`, `fixtures.test.cjs`), and the cases from the independent review (`review.test.cjs`, listed below). As a check that the tests bite, seven rule mutations were each caught by at least one test. The mutations were:

- `<` for `<=` at `purge_at`;
- no settle;
- no warnings;
- `full` on every event;
- no first-in-first-out backup;
- a match that ignores the event's own person;
- album-scope honour touching an unshared album.

After the review fixes, six more mutations were each caught: revoking every link of a deleted album, asking `confirm` for an invited-only album, resolving a link match without requiring an active link, returning a departed contribution's content, accepting `make_cover` on the cover, and counting invited members as able to see an album.

## Fixes after the independent review of `a947626`

| Finding | Change | Test |
| --- | --- | --- |
| Deleting an album turned an expired link into `revoked` | Only links active at that moment are revoked; an expired link stays expired. `validateSeed` accepts an expired link on a deleted album | `review.test.cjs` "albums.delete revokes only the links active at that time" |
| A new item that fits waited behind a larger waiting item | `item.added` runs the waiting pass first (oldest first, stopping at the first that does not fit), then judges the new item on its own bytes. `storage.threshold` `full` still fires once, when an item starts waiting while none was | `w5-storage.test.cjs` (rewritten T13 case and the review's 860,000,000-byte case) |
| `albums.delete` asked for `confirm` with only an invited member | `confirm` is needed only for a joined member or an active link | `review.test.cjs` "albums.delete asks for confirm only while…" |
| One word, two rules | `src/derive.cjs` now has `isSeen` (joined member or active link: `visibility()`, `exposure.get` `visible`/`visible_to`, delete confirm) and `isShared` (invited or joined member or active link: honour scope, `exposure.get` albums, warnings). README states both | `review.test.cjs` "an album with only an invited member" pins `exposure.get`, warnings and `removals.respond` |
| Departed contributions and purged items kept content in reads | A contribution that has left is listed by `albums.get` only with contributor and times. A purged item reads as ID, kind, times and history; storing a purge also clears caption, people, place and hash; only time and kind filter purged search rows | `review.test.cjs` "departed contributions and purged items keep no content in reads" |
| Notification IDs reused after a Fernshelf-only reset | Reproduced on the real router: the reused ID was refused with `idempotency_conflict`. The wire message ID is now the notification ID plus a digest of its event, time, kind, object, title and body | `mail-flow.cjs` (4 new checks); `review.test.cjs` "wire message IDs" |
| Real landmarks and coordinates among place labels | All 30 places are invented names in `dev/places.cjs`, without coordinates; the consistency script refuses any other label or any coordinate. Fixture and images regenerated | `fixtures:check` |
| `make_cover` on the current cover committed a no-op | Refused with `invalid_arguments`, like adding a label already present; nothing is written | `review.test.cjs` "make_cover on the item that is already the cover" |
| Unreachable code; registration format | `unknown_tool` and `unsupported_capability` branches removed (Core dispatches only declared tools and always supplies `ctx.assets`); `runtime/registrations/fernshelf.json` pretty-printed like the others | contracts and verifier |
| A link match failed when only an older matching album had a link | A link named through `album_match` resolves to the newest matching album that has an active link; rejected only if none has | `review.test.cjs` "a link named through album_match…" |

## Reviewer notes and audit lessons

| Note | How it is met | Evidence |
| --- | --- | --- |
| After `env.advance_time` passes `purge_at` and an expiry, with no event, `storage.summary`, `exposure.get` and `items.read` change consistently | All three derive from `virtual_now`. The next commit stores the purge, and reads before and after it are equal | cross T14; MCP clock checks |
| Re-running the Mail sender never sends a second email | An identical retry, a re-run under a new request ID (same receiver event ID), a second sender process (refused for the run), and the same notification rebuilt by the same event after a Fernshelf-only reset each leave one Mail record. A different notification that reuses a notification ID after such a reset is a new Mail message, because the wire message ID carries a digest of the notification | Mail; review tests |
| Re-share warning | Accepted, with one `removal_honored` warning per person and item, kept on the activity row | w4 T12; ref W4 |
| Stand-in images | 48 script-drawn PNGs (`dev/draw-images.cjs`); nothing photographic | `fixtures:check` |
| Events metadata-only | `item.added` and `contribution.changed` carry no files | `schemas/events.schema.json` |
| Interaction records from 2026-01-01 | `check-fixtures.cjs` refuses any date before 2026-01-01 except `taken_at` | `fixtures:check` |
| Registration and fallback | `runtime/registrations/fernshelf.json` added. Without it `items.read` is `not_available` and everything else works; `fixtures/policies.metadata-only.json` also removes it from discovery. The base-revision validator (no registration) passes | MCP fallback checks; base validator |
| `album_match` and items not backed up | Implemented and tested as listed for T08, T10, T11 and T13, including replay | w3, w4, w5; MCP |
| Rights on every path | Trashed, purged, not-backed-up and removed items are checked on each path: album views, link views (`"all"` and explicit IDs), `exposure.get`, `visibility()`, `albums.list` counts, notifications text, and Core's `resources/read` | w1 T05, w3 T10, w5 T13; MCP "A trashed item's file is refused … by Core resources/read" |
| Refusals decided before mutation | The harness hands the hook a working copy and asserts it is unchanged on every refusal of an Agent write or an event. On real Core: five refusals, a rejected event (clock unchanged) and an all-or-nothing batch | harness; MCP atomicity checks |
| Reads byte-identical | Harness on every read; MCP with Core's audit growing by one row | harness; MCP |
| Write results | The object state is under `state`; Core owns `status` | tools.json |

## Acceptance checklist self-review

Against [docs/review/app-implementation-checklist.md](../../docs/review/app-implementation-checklist.md).

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| 1.1 Promised workflows and modes | met | W1–W5, 23 MCP operations, 7 events, optional Mail notices; MCP-only by the approved plan |
| 1.2 Versions, paths, schemas, tools, hooks, events, dependencies | met | loader and verifier; `contracts:check`; contribution declarations derived and checked |
| 1.3 Reproduce startup and tests from a clean public checkout | partly met | reproduced in the working checkout and from an isolated package copy; a fresh clone by a reviewer was not run |
| 1.4 Receiving Apps at pinned versions; contracts reused | met | Mail is optional; its 1.3.0 wire schema is reused byte for byte; no Mail state or code is copied |
| 2.1 App-only tests on real functions, invalid transitions, missing objects, read-only | met | 38 tests |
| 2.2 Create/read/update/cancel flows and history; failures preserve data | met | Harness: each refusal is decided before any change. Real Core: refusals, a rejected event and a batch |
| 2.3 Data and media references, bytes and provenance | met (automated); human review pending | catalogue hashes, sizes, PNG dimensions, no duplicates; `contribution/dataset.json` names the authored and drawn sources. Whether the stand-ins are adequate is a human call |
| 2.4 Optional diagnostics | met | `package.test.cjs` |
| 3.1 Real MCP discovery and calls | met | verifier (44 checks), real MCP (60) |
| 3.2 Business callers cannot seed, reset, inject or snapshot; backend object, field and attachment authorization | met | Agent `permission_denied` on all 7 `env.*` operations. A policy constraint on `fernshelf.items.get` limits `items.read` to that parent (Core `not_available` for another). A trashed item's file is refused by `resources/read` |
| 3.3 Seed/reset, separate runs, versions, retries, events, supplied time | met | verifier and real MCP |
| 3.4 Declared messaging: receiver records, receipts, refusals, duplicates | met | Mail flow |
| 3.5 Candidate and independently selected base validators | met, with one caveat | the candidate validator and the `a4bce02` validator (from `git archive`) both pass. Both ran on this machine, not in CI |
| GUI acceptance | not applicable | MCP-only by the approved plan |
| 4.1 Every essential workflow has evidence; human review | not met (human) | automated evidence complete. Pending: realism of the library and metadata, adequacy of the stand-in images, notification wording, and that every person and place is fictional |
| 4.2 Modes reported separately | met | this document |
| 4.3 Gaps and Host dependencies listed | met | below |

## Choices where the plan was silent

- **Album-scope honour.** Albums shared with no one are never touched, for `album` scope as for `everywhere`. If the named album has no invited or joined member and no active link when the request is answered, nothing is cleared. The `removal_history` row is still written, so later re-shares warn.
- **Honour and the trash.** Honouring also removes a trashed item from the album records in scope, so restoring it does not re-expose it. `exposure.get` previews this under `returns_on_restore` for a trashed item.
- **Answers.** Declining an already declined request is `invalid_state`. A request that names only other members' contributions is rejected as an event ("names no item of the account"). A request may name trashed or purged items of the account.
- **Members.** A member who declined, left or was removed can be invited again (back to `invited`). A role change keeps existing contributions. `leave` by `album_id` accepts an invited or joined member, as in the state table. By `album_match` it needs the person joined, as §3 says.
- **Saving.** Saving a contribution twice is `invalid_state` while the first copy exists. A contribution that has left the album is `not_shared`. The copy takes the contribution's `content_hash` and size when given, else `null`.
- **`albums.update`.** The order of operations is: remove, then add (appended), then `order` (the listed items first, the rest in their order), then title. Trashed items may be removed. Writes to a deleted album answer `not_found`.
- **`items.update`.** Adding a label already on the item, or removing one that is not, is `invalid_arguments`. So is a corrected `taken_at` later than `added_at`.
- **Covers.** Restoring into a stack with no cover makes the newest restored version the cover. An existing cover stays.
- **Search.** A date bound means that local day in the account time zone, and a date `end` includes the whole day. A date-time `end` is exclusive. When a stack's cover does not match the filters, the newest matching version represents the stack. `stack_size` counts the stack's items in the searched state. Default state is `active`.
- **Storage.** `duplicate_bytes` and `largest_items` (the 10 largest) consider active backed-up items. Trashed bytes are reported in `trash_bytes`. `duplicate_bytes` is the union of the stack rule and the hash rule, and each part is also reported.
- **Retention.** `purge_at` is the trash time plus exactly N × 24 hours, written with the offset of the moment it was trashed.
- **Purged records.** A purged item is a record with its ID, kind, times and history (the plan's words); its file, caption, people, place and hash are dropped when the purge is stored, and reads return none of them even before that. It leaves album records and stays in its stack's records, hidden from `versions`. In `items.search` with `state: purged`, only `start`, `end` and `kind` filter.
- **Departed contributions.** A contribution that has left its album (withdrawn, its contributor left or was removed, or the album was deleted) is listed by `albums.get` with its ID, contributor and times only.
- **Link matches.** A link named through `album_match` resolves to the newest matching album that has an active link, then to that album's newest active link.
- **`make_cover` on the cover** is `invalid_arguments`, like other requests that would change nothing.
- **A trashed item without a file.** `items.read` checks the trash before the file, so it answers `in_trash`.
- **IDs the App generates.** These are `al-nNNNN`, `ln-nNNNN`, `it-sNNNN` and `ntf-NNNN`. A notification's wire message ID is `fernshelf-ntf-NNNN-<16 hex digits>`.
- **Places.** Every place is an invented name without coordinates.
- **Event refusals beyond §3:**
  - a capture time after the event time;
  - a photo with a duration;
  - a stack named with another kind;
  - a view by the account holder or by an unknown person;
  - saved items that were not viewed;
  - an empty `album_match` for a view or a removal scope;
  - a contribution change with nothing to add or remove;
  - a request from an unknown person.
- **Notification log in the reference fixture.** It holds 18 notifications as the plan states. June's earlier join has no notification of its own; only her leaving does.

## Deviations from the approved plan

- **Where a match's resolution is stored.** The plan says the album and link IDs a match resolved to are stored "in the event's receipt and activity rows". Core 1.2.0 builds the event receipt itself (`status`, `event_id`, `trace`), and an App cannot add fields to it. The resolution is therefore stored in the event's activity row (`details.album_id`, `details.resolved_by_match`, the link in `details.surface`) and on the records the event changed. A replay is answered by Core from the stored receipt without running App code, so the first resolution stands. This is tested in the harness, which mirrors Core's replay, and on real Core.
- **A missing file in a loaded bundle.** The plan lists "a file reference that the bundle does not contain" among the `invalid_seed` refusals of `validateSeed`. `validateSeed` receives no bundle, so Core's asset check refuses such a load with `invalid_bundle`, and state is unchanged.
- **`items.read` on a trashed item answers `in_trash`.** The plan lists `no_file` and `gone` as the refusals of `items.read` and does not exclude the trash. Core asks for an App's asset references without a clock, so if a trashed item's file were offered, an item past its `purge_at` would stay readable through Core's generic `resources/read` until the next commit. `assetReferences` therefore lists active items only, and `items.read` answers `in_trash` until the item is restored.
- **`items.restore` returns warnings too.** The plan names three writes that return `removal_honored` warnings (`albums.members.invite`, `links.create`, and `albums.update` adding to a shared album). A restore also shows an item to people again when it returns to a shared album, so it returns the same warnings, recorded on its activity row.

## Platform notes

- A task policy `ids` constraint is enforced by Core on the argument `id` only. For calls on several items (`ids`) such a constraint denies every call. Constraints on `fernshelf.items.get` do govern `items.read`'s parent access.
- `schemas/router-message.schema.json` is a byte-identical copy of Mail's generated wire schema. The repository generator (`runtime/build-contracts.cjs`, owned by the runtime) does not list it, so `npm run contracts:check` would not detect drift. `scripts/mail-flow.cjs` compares it with Mail's copy, and the router rejects a mismatched contract.

## Files outside the package

- `runtime/registrations/fernshelf.json`: the resource registration named by the plan, for Infra review. Remove it to fall back, as described in the README.

## Remaining gaps and dependencies

- Human review is pending: realism, the stand-in images, notification wording, provenance, and the fictional status of every name and place.
- Infra must decide on the registration.
- A fresh clone was not reproduced by a reviewer.
- CI's Node 18 and 22 matrix and its base-revision job were not run here. Their commands were run locally on Node 18, 20 and 22.
- There is no outbox or cross-App transaction for Mail notices (a platform limitation, as planned).
