# Fernshelf

Fernshelf is a resettable personal photo library seen from one person's account. A photo can be visible in several places at once (shared albums and the links to them), and a copy someone has saved cannot be called back, so an action the App accepts can still be wrong for the account holder, the people in the picture or the family. Fernshelf records who could see what and when; it does not judge consent.

- App ID `fernshelf`, version 1.0.0, Core API 1.2.0, public runtime 1.6.0. MCP, plus a web page for the account holder served by the repository's shared Web Host ([`gui/`](gui/README.md)). The approved plan was MCP-only; the page was added after approval because the maintainers asked every Environment for one ([comment on #111](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/111#issuecomment-7123353250)).
- Approved plan: [`proposals/environment/fernshelf.md`](../../proposals/environment/fernshelf.md). Validation evidence: [VALIDATION.md](VALIDATION.md).
- Node.js 18 or later, built-ins only. Nothing to install.

## Workflows

| Workflow | Agent operations (`fernshelf.*`) |
| --- | --- |
| W1 Library, search and storage (read-only) | `account.get`, `items.search`, `items.get`, `items.read`, `albums.list`, `albums.get`, `storage.summary`, `exposure.get`, `notifications.list` |
| W2 Organising | `items.update` (caption, favourite, archived, corrected time, people labels, `make_cover`), `albums.create`, `albums.update` (title, `add_ids`, `remove_ids`, `order`), `albums.delete` |
| W3 Sharing | `albums.members.invite`, `albums.members.update`, `albums.save_item`, `links.create`, `links.revoke` |
| W4 Removal requests | `removals.list`, `exposure.get`, `removals.respond` (`honor` or `decline`) |
| W5 Storage, versions and trash | `items.trash`, `items.restore`, `items.purge` (`confirm: true`), with `items.get`, `storage.summary` and `items.update` `make_cover` |

There are 23 operations: 10 reads and 13 writes. Every write takes Core's `request_id` and `expected_version` (`{epoch, revision}`). It returns the object's `id` (or `ids` for calls on several items), its own state under `state` (Core sets `status` to `committed`) and, where the write shows items to someone, `warnings`. Calls on several items take 1 to 50 IDs and are all or nothing. The input schemas accept longer lists, so that the App can answer `limit_exceeded` itself.

Other people act only through seven Infra events (`env.apply_event`). In the following list, the first word is the event name and the rest is what it does:

- `item.added`: the device backs up a new item. Metadata only; waiting items go first.
- `backup.resumed`: the device syncs with no new item.
- `member.changed`: a member joins, declines or leaves.
- `contribution.changed`: a joined contributor adds or removes their own items.
- `share.viewed`: a view, with saves, of an active link or of a shared album by a joined member.
- `removal.requested` and `removal.withdrawn`: someone asks for items to be taken down, or withdraws that request.

Fernshelf has no clock event and no scheduler.

### Rules in brief

- **Time.** Every time-based state is a stored due time read against `ctx.virtual_now`. An item reads `purged` once its `purge_at` has passed. A link reads `expired` once its `expires_at` has passed. Bytes used leave out purged items. After Core's `env.advance_time` no App code runs, yet every read changes consistently. The next committed write or event stores the purge and drops the file reference; nothing a read returns changes when that happens.
- **Two definitions, kept apart** (both in `src/derive.cjs`):
  - **Seen** (`isSeen`, and the pure function `plugin.visibility(data, at)` for graders): an item is visible to a person when it is active and either sits in an album where that person is `joined`, or sits in an album that an `active` link shows, to anyone who holds the link. An invited member sees nothing until they join. This rule gives `exposure.get`'s `visible` and `visible_to`, and decides when `albums.delete` needs `confirm` (a joined member or an active link).
  - **Shared** (`isShared`): the album has an invited or joined member or an active link. This is the plan's scope for removal requests: `removals.respond` with `everywhere` clears these albums, `exposure.get` lists them (with invited members marked) as a preview of exactly what an honour would clear, and a write that adds or shows an item in such an album returns `removal_honored` warnings.
  - A trashed item is visible nowhere, but album records keep it, so a restore brings it back.
- **Removal requests.** `honor` with scope `album` clears the named items from that album. With scope `everywhere` it clears them from every album that has an invited or joined member or an active link. Links follow their album. Albums shared with no one, the library itself and other members' contributions (`not_removable`) are never touched. Each honoured item gets a `removal_history` row. Any later write that would show it to someone again is accepted and returns one `removal_honored` warning per person and item, which is also kept on the activity row. The writes that do this are `albums.update` adding to a shared album, `albums.members.invite`, `links.create` and `items.restore`. Recorded views and saves are never removed; they are listed by `exposure.get` and in the honour result (`already_seen`).
- **Storage.** `used_bytes` counts `declared_bytes` of backed-up items that are active or trashed. Items not yet backed up count only in `pending_bytes`. Members' contributions count only once saved. Only a purge frees bytes.
- **Items not yet backed up.** These are recorded by `item.added` when they do not fit under the quota. They are searchable and editable, have no file, and cannot be added to an album (`not_backed_up`), so they are never visible to anyone. They are backed up only inside an event. `item.added` and `backup.resumed` first take the waiting items, oldest first, and stop at the first that does not fit; `item.added` then judges the new item on its own bytes, so a new item that fits is backed up even while an older, larger one still waits.
- **Departed and purged records.** A member's contribution that has left the album (withdrawn, its contributor left or was removed, or the album was deleted) is listed by `albums.get` only with its contributor and times, and appears nowhere else. A purged item is a record with its ID, kind, times and history: reads return no caption, people, place, hash, size or file, and only `start`/`end` and `kind` filter it in `items.search`.
- **Notifications** are written only inside events, for what others and the device do: `album.activity`, `removal.requested`, `removal.withdrawn`, and `storage.threshold` (level `80` once per crossing; `full` when an item starts waiting while none was waiting). While the account's `email_notices` is on, each notification also stores a full Mail wire message.
- **Events name albums and links made during the run** by `album_match` (`person_id`, `contains_item_ids`, `title`), resolved at the event's time over albums that are not deleted, newest first. A link named through a match (`{"type":"link","album_match":…}`) resolves to the newest matching album that has an active link, and then to that album's newest active link. The resolved album and link IDs are written to the event's activity rows. A replay of the same `event_id` is answered by Core from its stored receipt and does not resolve the match again.

## Web page

```sh
node runtime/web/server.cjs --app fernshelf --registry apps/fernshelf/web.registry.json --run web-demo --profile sandbox
```

Run it from the repository root and open the access link it prints. `web.registry.json` is a one-App registry for this folder, so neither `runtime/` nor the repository's `apps.registry.json` changes. The page has Photos, Favourites, Albums (with each album's members, links and contributions), Sharing, Requests, Storage, Activity, Archive and Trash, and a photo panel that shows who can see the item. All 13 Agent writes are reachable from it. Images come only from `items.read` on the Agent connection. `--profile scenario` on a new run gives the read-only page. Infra operations (events, clock, seed, reset) have no browser route. Details, the list of what is deliberately not in the page, and measured timings are in [`gui/README.md`](gui/README.md).

`contribution/gui.json` declares the page in the same way as the other Apps with a page: the legacy reviewer-renderer profile (`gui/src/view.js`) plus the optional `pale.web` extension (`page`, `controller`, `status: implemented`).

## Data and fixtures

- All places are invented names (`dev/places.cjs`) without coordinates; no real street, venue, park or landmark is named.
- `fixtures/reference.json` is the package seed. It describes the fictional Maya Fenwick on a 15 GB plan at 13.95 GB used (0.41 GB of it in the trash) on 2026-11-20 09:00 (`fixtures/clock.json`). The library holds 420 items (380 photos, 40 videos as metadata), 12 people labels, 30 places, 26 stacks (10 edit, 8 burst, 8 duplicate), 6 exact-duplicate pairs and 12 albums. Four albums are shared now, with 9 current or past members and 14 contributions between them; two more albums were shared in 2025 (2 more members). There are 6 links (4 from 2026, 2 from 2025) with 16 views and 7 saves, 8 removal requests in every state, 20 items in the trash (4 of them past retention) and 8 records of photos purged since 2025. The fixture also carries 27 notifications and an activity log of 1,259 rows (about 654 KB of state).
- **History from 2025-01-01** ([maintainers' requirement](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/111#issuecomment-7122958570)). The account was opened on 2025-01-04, and the phone's first sync that morning backed up its older photos (capture times from 2024), one a second. After that the phone backed up each photo shortly after it was taken, so items arrive in every month of 2025 and 2026. Across both years the fixture records caption, favourite and archive edits and the cover picked in each stack, albums created and filled over time, 2025 links (one expired, one revoked), an invitation declined, a member who joined and later left, views and saves, removal requests honoured and declined, items trashed and restored, photos purged with `items.purge` or at the end of their retention, and the 80% storage notice, dated at the arrival that crossed the line (2026-06-09 15:29). What the account holder did falls between 07:00 and 23:00 in the account's time zone. No timestamp other than a capture time is before 2025-01-01.
- **The seeded activity log is the log the App writes.** `scripts/reference-history.cjs` writes, for each thing that happened, the rows the App writes for the same write or event: the same action names, object IDs and `details` keys, each event's row followed by its effect rows (`cause_seq`), and an `effect.notification.written` row with each notification. Every item arrives through its own `event.item.added` with `effect.item.backed_up` and, for a stack, `effect.stack.created` or `effect.stack.joined`; a join or leave has `effect.member.*` (and `effect.contributions.removed` for the contributions that leave with the member); a contribution has `effect.contributions.added`. That is 1,259 rows: 1,009 with actor `event` (the phone and other people) and 250 with actor `agent`.
- **Who `agent` is in seeded rows.** The plan gives an activity row one of two actors, `agent` for the account's own writes and `event` for applied events, and the seed schema allows only these two. The seeded rows for what the account holder did before the run (edits, albums, invitations, links, trash, purges, answers) therefore carry actor `agent`, like the Agent's writes. They differ in one field: every row the App writes during a run carries the `request_id` of the write or the `event_id` of the event, and every seeded row has both `null`. To count what the Agent did in a run, count rows with a `request_id`. (Item histories have a third actor, `seed`, and seeded history rows use it.) `notifications.list` without a window returns all 27 notifications, as its contract says; the web page lists the last 90 days and folds older notices under "Earlier".
- `scripts/build-reference-fixture.cjs` writes the fixture, `assets/`, `contribution/assets.catalog.json` and the counts and sources in `contribution/dataset.json` deterministically, from fixed seeds (20261122 for the library, 20250104 for the history in `scripts/reference-history.cjs`). The output is byte-identical on Node 18 and 22, and `--check` reports drift.
- `assets/` holds 48 PNG stand-ins (128×96, at most 13,139 bytes each, 564,150 bytes in all) drawn by `dev/draw-images.cjs` with `zlib`. They show flat scenes of colour fields and shapes with a stamped caption (the place and the capture date, wrapped onto two lines so neither is cut): no people, faces or photographs. Storage is counted from `declared_bytes`, not from these files.
- `fixtures/minimal.json` is a small hand-authored library that most business tests start from.
- `scripts/check-fixtures.cjs` applies the same rules to every record of both fixtures, whether written by hand or generated: references, `purge_at` against the retention, storage against the rule, honoured requests against the albums, dates (nothing other than `taken_at` before 2025-01-01 or before the account was opened, nothing after the clock except due times), the history as of each date (item histories in a valid order, member and contribution times, views only through a link active then or by a member joined then, of items the album showed then, answers after requests, honours only on what was shared then, storage never over the quota), image hashes, sizes and dimensions, each item's `removal_history` in time order (as the App appends it), wire messages and the reference counts above. For a fixture with an activity log (the reference) it also checks the log row by row against what the App writes: every row has an action, actor and `details` keys the App writes (the table in the script; `tests/log-shapes.test.cjs` checks that table against the rows the App wrote in the business tests, both ways); effects follow their event; seeded rows carry no request or event ID; every recorded change has its rows at its time (each arrival with its backup and stack effects, each member change and contribution with its effects, each cover choice); every album item entered the album after it was added and before anything showed it there; the account holder's rows fall in waking hours; and the notifications are exactly those the App writes for the events recorded (including the arrival that crossed 80%).
- A task loads its own library, people, albums, shares, history, clock and image files with `env.load_seed` through the same seed schema.

## Commands

From this folder (`apps/fernshelf`):

```sh
npm test                     # business tests (node --test tests/business.test.cjs)
npm run example              # walkthrough on the reference library (examples/run.cjs)
npm run contracts:check      # tools.json and seed/events/state schemas match scripts/build-contracts.cjs
npm run fixtures:check       # fixture consistency
node scripts/build-reference-fixture.cjs --check
npm run mcp                  # real MCP checks on the public runtime (scripts/real-mcp.cjs)
npm run mail-flow            # Fernshelf -> Mail on real processes (scripts/mail-flow.cjs)
npm run test:web             # the page on the real shared Web Host, no npm dependency (tests/web-smoke.cjs)
npm run test:browser         # clicks in Chromium (tests/web-browser.cjs); needs the repository's Playwright
```

From the repository root:

```sh
npm run app:verify -- --app apps/fernshelf --output .artifacts/fernshelf.json
node runtime/ci/verify-submissions.cjs . .artifacts/submissions <base-sha>
npm test
```

The business tests and the example need only this folder. `scripts/real-mcp.cjs`, `scripts/mail-flow.cjs` and the two web tests look upwards for a public checkout. From a copy of the package alone, pass `--runtime DIR` (and `--mail DIR` for the Mail flow).

## Resource registration and its fallback

`items.read` returns an item's image bytes through Core's `ctx.assets.read`, under the parent item. This needs the platform registration `runtime/registrations/fernshelf.json` (`{"app_id":"fernshelf","resource_access":{"item":"fernshelf.items.get"}}`), submitted with this package for Infra review. A task policy still decides access: for example, a constraint on `fernshelf.items.get` to some IDs limits whose bytes can be read.

If maintainers decline the registration, delete that one file. Every other operation is unchanged, and `items.read` is then refused by Core with `not_available`. To withhold the tool from discovery as well, load `fixtures/policies.metadata-only.json` (the same profiles without `fernshelf.items.read`) as the task policy. `scripts/real-mcp.cjs` checks both on a runtime copy without the registration.

A trashed item's file is not offered to Core (`assetReferences` lists active items only), because Core asks for those references without a clock. `items.read` answers `in_trash`, and Core's generic `resources/read` refuses, until the item is restored.

## Mail notices (optional)

Fernshelf declares one `messaging.publishes` entry: `channel.email` with Mail 1.3.0's wire schema `urn:pale:email-message:2`. The schema is copied byte for byte into `schemas/router-message.schema.json`. Fernshelf builds no inbox.

`src/publisher.cjs` is the Infra-run sender. Infra runs it with its own Fernshelf Infra connection and a Messaging publisher connection. It reads a notification's stored wire message through `env.snapshot` and calls `router.publish` with a request ID derived from the run epoch and the notification ID. It never writes back into Fernshelf.

The wire message ID is `fernshelf-<notification ID>-<digest>`, where the digest covers the notification's event, time, kind, object, title and body. Notification IDs restart after a Fernshelf-only reset, while the router and Mail deduplicate on the CloudEvents source and ID. With the digest, a different notification that reuses an ID is a new Mail message, and the same notification produced again by the same event after a reset is still delivered once.

`scripts/mail-flow.cjs` shows the following on real processes:

- the received Mail record and its committed receipt;
- an identical retry, and a re-run under a new request ID, each answered from the first receipt with one inbox record;
- a second sender process refused for the same run;
- after a Fernshelf-only reset, a different notification that reuses the delivered notification ID delivered as a new Mail message, and the identical notification rebuilt by the same event answered from the first receipt;
- no message while email notices are off;
- a rejected delivery without an Infra grant, which leaves no Mail record and Fernshelf unchanged.

## Files

| Path | Contents |
| --- | --- |
| `plugin.cjs` | Core hooks (`validateSeed`, `handleTool`, `applyEvent`, `records`, `objects`, `references`, `assetReferences`) and `visibility` |
| `src/derive.cjs` | Clock-derived states, the visibility rule, storage, warnings, `settle` |
| `src/reads.cjs`, `src/library.cjs`, `src/albums.cjs`, `src/removals.cjs`, `src/events.cjs` | W1 reads; item edits and trash; albums, members, saving and links; answering removal requests; the seven events |
| `src/model.cjs` | Seed validation, records, objects and media references |
| `src/notify.cjs`, `src/publisher.cjs` | Notifications with their wire messages; the Infra-run Mail sender |
| `schemas/` | Generated seed (definitions inlined), events and state schemas; copies of the shared platform schemas and of Mail's wire schema |
| `scripts/` | Contract and fixture builders, consistency checks, real-MCP and Mail-flow scripts |
| `tests/` | Business tests (`business.test.cjs` loads them all), App-only harness, verifier inputs (`cases.json`); `web-smoke.cjs` and `web-browser.cjs` for the page |
| `gui/` | `index.html`, `src/app.js` (the page's controller), `src/view.js` (reviewer renderer), `README.md` |
| `web.registry.json` | One-App registry used to start the shared Web Host for this package |
| `examples/` | `run.cjs` walkthrough and `scenario.json` (Dana's removal request) |

## Limitations

These follow the approved plan:

- The web page is the account holder's view only. There is no reviewer console or view for other people.
- One account per instance, and every album is the account holder's.
- There is no face recognition, visual search or pixel-level duplicate detection.
- The Agent cannot upload or edit pixels. Videos are metadata only.
- People labels, the plan, the quota and preferences are seed data.
- There are no payments.
- There is no outbox or cross-App transaction for Mail notices.

Deferred to a later version: partner sharing, albums owned by others, links to loose items, conversion to a smaller quality, memories, and creating or renaming people labels.
