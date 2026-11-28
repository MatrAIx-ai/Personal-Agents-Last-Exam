# Tidepool Audio

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. Tidepool Audio is a fictional podcast and music service used by one family. A personal agent can line up the right episodes, keep shared playlists suitable for a child, free storage before a trip and change the plan within the plan manager's authority. Listening happens on phones, earbuds, a car and a shared kitchen speaker; each session is recorded under the account signed in on that device.

- **Proposal:** [Environment proposal #216](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/216) (`proposals/environment/tidepool-audio.md`), plan approved by @Chenngzz at `575bb90fec3e44be6a7f46ce66fe6a7577a1029f`.
- **Domain:** Media & entertainment.
- **Interface:** Agent MCP and Infra MCP through the public runtime. MCP only: no GUI and no reviewer console.
- **Dependencies:** Node.js 18+ and the public runtime 1.6.0 (Core API 1.2.0) at reference revision `a4bce02`. No other Apps (`dependencies.required_apps` is empty), packages, network access or credentials. No media: `capabilities.resources` is `false`.

## Model

| Record | Owner | Notes |
| --- | --- | --- |
| `artists`, `albums`, `tracks` | catalog | A track has `explicit` and an optional `clean_version_id`: a non-explicit track with the same title, artist and album. `availability` is `available` or `removed`. |
| `shows`, `episodes` | catalog | An episode has `duration_s`, an `end_of_content_s` marker, chapters, notes, size and `published_at`. |
| `plans` | catalog | `individual` (1 member, $10.99), `duo` (2, $14.99), `family` (6, $17.99) a month. Prices are integer cents. |
| `family`, `members`, `invitations` | family account | Exactly one active `manager`. Members are `active` or `removed`; invitations are `open`, `accepted` or `declined`. Each member has an explicit filter. |
| `devices` | family account | Signed in to one member's account. `storage_cap_bytes` is the Tidepool download limit (0 for earbuds and the speaker). `last_checkin_at` drives the 30-day offline check. |
| `sessions` | family account | Member, device, item, start and end positions, speed, start reason (`user`, `autoplay`, `queue`, `voice`), end reason, optional unverified `speaker_hint`. |
| `progress`, `plays` | family account | Episode progress per member: `unplayed`, `in_progress` (with position) or `played`, with `set_by` (`session` or `agent`) and, for agent changes, the replaced value. Track play counts per member. |
| `follows`, `upnext` | family account | Per-show auto-download of the newest *n* episodes and auto-delete *d* days after played. Up Next is an ordered episode list with its own `list_version`. |
| `downloads` | family account | Reserved bytes, `requested_at`, `completes_at` (one simulated minute later), optional `auto_delete_at`, and `removed_at` / `removed_reason` once removed. |
| `library`, `playlists` | family account | Saved tracks and albums. Playlists have an owner, name, visibility (`private`, `shared`, `collaborative`), collaborators, a `track_version`, tracks that record who added them, and an `origin` (`seed` or `agent`, set by `playlists.create`). |
| `billing` | family account | Billing `anchor`, plan `timeline` (start, upgrades, scheduled downgrade), proration `adjustments`, and `payments` (paid or declined results). |
| `notifications`, `activity`, `next_seq` | family account | In-app notices; one activity row per committed write or applied event; the counter for IDs the App creates. |

**One instance per signed-in member.** The family's records are account state. Each App instance holds one bound account, `account_id` plus `owner_person_id`, checked against the run's `binding.json`. A different member's account, such as "Sam's account", is a separate instance loaded with the same family seed and that member's account. `fixtures/binding.json` lists all four members' Tidepool accounts.

Family state does not sync between instances. Each instance holds its own copy of the family (plan, members, filters, playlists), and one member's writes are not visible in another member's instance. Check a write in the instance that made it. Infra applies each event to the instances that should observe it. An event that targets a record the agent created, such as "Road trip", goes only to the instance where the agent created it. `examples/mcp-walkthrough.cjs` runs Priya, Sam and Kai as three instances.

## Agent tools

All 33 tools are named `tidepool.<name>`: 16 reads and 17 writes. Every write requires Core's `expected_version` and a `request_id`.

**`id` names a family member, or for `members.invite` a person.** On member-scoped tools, `id` is the member whose records the call reads or changes. On the manager tools `filters.update` and `members.remove` it is the target member. On `plan.confirm_change` and `plan.revoke_change` it is the manager's own member ID. For `members.invite` it is the invitee's `person_id` from the binding, so a `policies.json` `ids` list for that tool holds person IDs while every other tool's holds member IDs. Other objects use named arguments (`episode_id`, `playlist_id`, `show_id`). Field changes go in `patch`.

| Tool | Effect | Purpose |
| --- | --- | --- |
| `tidepool.catalog.search` | read | Prefix search over titles, artists, albums, shows and publishers. For a filtered member, explicit tracks are marked `filtered` and each one's clean version follows it. |
| `tidepool.catalog.get_item` | read | One track, album, artist, show or episode. Removed items stay readable. |
| `tidepool.shows.get_episodes` | read | A show's episodes, newest first, with the caller's progress. |
| `tidepool.family.get` | read | Members, open invitations, slots, the plan now and any scheduled change, and billing derived from the clock. Download counts appear on the caller's own row; the plan manager sees every member's counts and `if_removed` impact. |
| `tidepool.members.list` | read | Members (`is_you` marks the caller) and all invitations. |
| `tidepool.devices.list` | read | `id`'s devices with storage and the offline-check due time. |
| `tidepool.history.list` | read | `id`'s sessions, newest first, with device, start reason, speed, positions and `speaker_hint`. |
| `tidepool.progress.get` | read | `id`'s progress for given episodes, a show, or all recorded progress. |
| `tidepool.follows.list` | read | `id`'s follows with auto-download and auto-delete settings. |
| `tidepool.upnext.get` | read | `id`'s Up Next with `list_version`, remaining time per entry, download status and total remaining time at 1×. Remaining time is from the saved position for an in-progress episode; any other entry counts its full duration, including a played one, which plays again from the start. |
| `tidepool.downloads.list` | read | `id`'s downloads with status derived from the clock, plus per-device storage. |
| `tidepool.library.list` | read | `id`'s saved tracks and albums. |
| `tidepool.playlists.list` | read | Playlists `id` can see, with `your_role`. |
| `tidepool.playlists.get` | read | One visible playlist. Explicit tracks are marked `skipped_for_you` when `id`'s filter is on. |
| `tidepool.notifications.list` | read | `id`'s notices, newest first. |
| `tidepool.plan.preview_change` | read | Quote a plan change by the same rules confirm applies (see Billing). |
| `tidepool.progress.set` | write | Set an episode `unplayed`, `in_progress` (with `position_s`) or `played`. Records `set_by: agent` and the replaced value; adds no session. |
| `tidepool.follows.add` / `.remove` | write | Follow (with optional settings) or unfollow a show. A new follow's auto-delete also applies to downloads of episodes already played. Settings that differ from an existing follow return `invalid_arguments`. Unfollowing keeps downloads and cancels pending auto-deletes. |
| `tidepool.follows.update_settings` | write | `patch: {auto_download_count, auto_delete_days}`. Reschedules pending auto-deletes for that show. |
| `tidepool.upnext.set` | write | Replace the whole queue; `expected_list_version` must match (`list_version_mismatch` otherwise). |
| `tidepool.downloads.add` / `.remove` | write | Reserve and download a track, album or episode to one of `id`'s devices; remove or cancel one, returning the bytes freed. |
| `tidepool.library.save` / `.unsave` | write | Save or unsave a track or album. |
| `tidepool.playlists.create` | write | Create a playlist owned by `id`, with visibility, collaborators and starting tracks. |
| `tidepool.playlists.update_tracks` | write | Owner or collaborator: ordered `add` / `remove` / `move` operations, with optional `expected_track_version` (`list_version_mismatch` otherwise). |
| `tidepool.playlists.update_settings` | write | Owner only: `patch: {name, description, visibility, collaborators}`. |
| `tidepool.members.invite` | write | Manager only: invite a person from the binding. |
| `tidepool.members.remove` | write | Manager only: remove member `id`. Returns the counts `family.get` showed under `if_removed`: downloads removed and bytes freed, collaborative playlists they lose edit access to, and their own shared or collaborative playlists that leave the family view. |
| `tidepool.filters.update` | write | Manager only: `patch: {explicit_filter}` for member `id`. |
| `tidepool.plan.confirm_change` | write | Manager only (`id` = the manager): apply an upgrade at once, schedule a downgrade for period end, or keep the plan in effect (revoking any scheduled change). |
| `tidepool.plan.revoke_change` | write | Manager only (`id` = the manager): cancel the scheduled change. |

- Reads never change business data. They compute on a settled copy (see State and time).
- **App errors:** the proposal's `not_found`, `unavailable`, `forbidden`, `invalid_position`, `storage_full`, `too_many_members`, `already_member`, `already_invited`, `no_pending_change` and `payment_due`, plus:
  - `list_version_mismatch`: a stale Up Next or playlist list version;
  - `invalid_arguments`, thrown by the App for: a blank playlist name, a track already in the playlist, the owner listed as collaborator, follow settings that differ from an existing follow, or choosing the plan in effect (or a downgrade already scheduled) with nothing to revoke.

  A failed call leaves data and version unchanged.
- **Core errors:** `invalid_arguments` (schema), `permission_denied`, `stale_version` (Core's `expected_version` only) and `idempotency_conflict`. An identical retry returns the stored receipt with `duplicate: true`.
- **Policies:** the package `scenario` policy allows reads only. `examples/task-data/policies.json` grants all 33 tools; `examples/policies/narrow-members.json` shows per-member narrowing.
- **Admin tools:** the Agent connection cannot list or call `env.*`; Core returns `permission_denied`.

## Incoming events

Infra applies seven event types. Each applied event appends one activity row with `actor: "event"`. An unknown or inactive member, an unknown device or item, or an inconsistent payload fails the whole event with `invalid_event`, and nothing changes.

| Event | Effect |
| --- | --- |
| `listening.record` | Appends the session (`ended_at` = the event's `at`) and updates only that member's progress or play count. An episode is played when `end_position_s` ≥ its `end_of_content_s`. Rejected if the device is signed in to another member, a position is past the item, the session covers more audio than its duration allows, or the item (or an episode's show) is removed. |
| `episode.publish` | Adds the episode. For each active follower with auto-download on, it queues the episode on each of their auto-download devices. Older auto-downloads of that show outside the newest *n* are released (`auto_download_limit`). A device without room records `storage_full` in the notice and changes nothing. |
| `catalog.update` | `availability: "removed"` removes an item; its downloads end (`item_removed`), and for a show, its episodes' downloads too. `explicit` changes a track's, episode's or show's flag. A clean version cannot become explicit, and an explicit track that names a clean version cannot be un-flagged (`invalid_event`). An episode of a removed show keeps its own availability but cannot be queued, saved, downloaded or played. |
| `playlist.edit` | Finds the playlist by `playlist_id` (seeded playlists only, `origin: "seed"`; an agent-created ID returns `target_not_found`) or by `playlist_ref: {owner_member_id, name}`; the name match ignores case and surrounding spaces. Applies `add` / `remove` / `move` in order, adds one version, records the author on added tracks, and notifies the owner when someone else edits. |
| `device.checkin` | Sets the device's `last_checkin_at`, renewing offline eligibility for 30 days. It does not lift a payment hold. |
| `billing.payment_result` | Records `paid` or `declined` for an invoice whose period has started. A decline notifies the manager. |
| `family.invite_response` | Matches the invitee's one open invitation by `invitee_person_id`. `accepted` makes them an active member with ID `mem-<person suffix>` (for example `mem-ana`); `declined` clears the invitation and frees its slot. |

**Event lookup failures** (`playlist.edit`, `family.invite_response`) use the codes the approved revision defines:
- `target_not_found`: no playlist or open invitation matches.
- `ambiguous_target`: more than one of the owner's playlists has that name.
- `not_collaborator`: the author is not the owner, nor a collaborator on a collaborative playlist, at that moment.

In each case `env.apply_event` returns `applied: false` with the code as `status`, and Core's audit has a `deny` row with that `reason`. No receipt is stored, so `env.event_status` returns `receipt: null`. The task can retry with the same `event_id`, a fresh `expected_version` and an `at` no earlier than the clock. The walkthrough does exactly this for "Road trip".

`examples/scenario.json` is the proposal's `listening.record` example, verbatim. As a management call on the Infra connection, with the version from a fresh `env.snapshot` (the walkthrough report records the exact call it made):

```json
{
  "method": "tools/call",
  "params": {
    "name": "env.apply_event",
    "arguments": {
      "expected_version": {"epoch": 2, "revision": 0},
      "event": {
        "event_id": "kitchen-fieldnotes-113",
        "at": "2026-11-24T19:42:00-08:00",
        "operation": "listening.record",
        "payload": {
          "session_id": "ls-2207", "member_id": "mem-priya", "device_id": "dev-kitchen-speaker",
          "item_type": "episode", "item_id": "ep-fieldnotes-113",
          "started_at": "2026-11-24T19:05:00-08:00", "start_reason": "voice", "speed": 1.0,
          "start_position_s": 0, "end_position_s": 2210, "end_reason": "completed"
        }
      }
    }
  }
}
```

The other two approved examples are `examples/events/roadtrip-noor-add-1.json` and `examples/events/invite-ana-accept.json`, both verbatim. `examples/events/` also holds one valid example for each remaining event type.

## State and time

- `ctx.virtual_now` is "now". Agent reads and writes do not advance it. Infra moves it with an event (to its `at`) or with `env.advance_time`.
- **Time-based states are stored as due times and derived on every read and check.** Tidepool has no timer or clock event, and `env.advance_time` writes no activity row.

| State | Stored | Derived |
| --- | --- | --- |
| Download completion | `completes_at` (one simulated minute after acceptance) | `queued` before it, `downloaded` from then on |
| 30-day offline check | device `last_checkin_at` | From `last_checkin_at` + 30 days the device's downloads read `needs_check` (`offline_check_overdue`) |
| Auto-delete | download `auto_delete_at`: *d* days after the episode was played or downloaded, whichever is later. A shortened window that has already passed falls due now. | `removed` (`auto_delete`) from then on; its bytes are free |
| Payment grace | the invoice's first `declined` result | `payment_due` until paid; from decline + 7 days every download reads `needs_check` (`payment_grace_expired`) |
| Billing period and scheduled change | `billing.anchor` and the plan `timeline` | Period, invoices and the plan in effect (see Billing) |

- **Settle.** Auto-delete is the one derived state whose inputs a later write can change (progress, follow settings). Every write and event therefore first records deletions already due (`removed_at = auto_delete_at`). The derived view is the same before and after. No activity row is written for it, and space freed by time alone is usable by the next write.
- **Activity rows.** `seq`, `at`, `actor` (`agent` or `event`), `action` (tool name or event operation), object, member, `replaced`, `request_id` or `event_id`, and `later_history_removed` (see the clock cutoff below; seeded rows may omit it). There is one row per committed write or applied event, and none for a replay, a rejected call or time passing.
- **Evaluator join.** `request_id` joins an activity row to Core's receipt `request:<id>` and the audit row's `input.request_id`. `event_id` joins it to receipt `event:<id>` and the audit `trace.event_id`. The receipts and audit carry the version.
- **Reset.** `reset_scope` is `app_instance`. Reset restores the loaded catalog, family, history and clock of that instance only. The walkthrough snapshots before reset.
- **Seed checks.** `validateSeed` never compares record dates with the run clock, so the fixture registers under a 2026-01-01 registry clock.
- **Clock cutoff.** Tools and events see the data as of `ctx.virtual_now` (`src/visible.cjs`). A record exists in Tidepool from the moment it happened (table below). Before then it is `not_found` by ID and absent from lists, counts, search and "newest" lookups. State a record gained after the clock reads as it was before that change, when the stored data determines it. Nothing is stored for this: when `env.advance_time` or an event moves the clock, later records appear and no record changes. A seed that runs past the clock, such as the evaluation dataset, can therefore load at any point in its window.
  - A write or event on a record dated after the clock fails and changes nothing. Tools return `not_found`. Events return `invalid_event`, or `target_not_found` for a `playlist.edit` or `family.invite_response` lookup.
  - Writes and events run on the view, and each record they change replaces its stored form. That includes a stored record dated later with the same key: the same member and episode, show, library item or Up Next list, the same device and item for an active download, or the same person for an open invitation. Untouched records keep their stored form, so later records still appear on time.
  - **Fallback.** Sometimes keeping the later family records would leave the family inconsistent with the change, for example a device over its cap or more members than the plan allows. Then Tidepool stores the family as it reads at the clock, plus the change, and drops the later family records, because they described a future without the change; later albums, tracks and episodes stay. Derived values are stored as shown, so a device keeps the check-in derived from its latest session (below).
  - **Removed later history is reported.** Whenever a write or event removes or replaces a stored record dated after the clock, in either of the two cases above, its activity row's `later_history_removed` holds each of those records as it was stored, by record family (`sessions`, `downloads`, `billing.payments`, ...), and its receipt's `later_history_removed` counts them by family. Both are `null` otherwise, and the diagnostics log gets the same counts. An event that replaces a later record does the same in its activity row (tested). The receipt carries only counts because it goes to the Agent: the records can belong to other members and describe what had not happened yet at the clock. Example (tested): with the full dataset loaded at 2026-04-01, the ninth album download to Priya's phone no longer fits beside her later downloads. Its receipt counts 143 sessions, 33 downloads, 4 playlists, 8 payments and the rest of the later family records, its activity row holds them (also over real MCP: `examples/dataset-demo.cjs`, last stage), and Priya's history at the dataset clock is short by exactly the 85 reported sessions.
  - **For Task authors.** A full-dataset load at an earlier clock is meant for reading history. If the Agent will write, start at or after the dataset clock, or load only the records up to the Task's clock and stage later ones as scenario events ([submission evidence, section 4](../../docs/submission-evidence.md#4-task-history-depth)). Otherwise an Agent write can drop later records, as reported above.
  - IDs the App creates skip the IDs of hidden records. An `episode.publish` or `listening.record` that reuses one is `invalid_event`.
  - Events count visible records: playlist positions, the newest *n* episodes for auto-download, and the followers who get a notice. An event or write that changes a playlist replaces the whole record, so entries the seed adds to it later are dropped.
  - Before the bound member's `joined_at`, every tool returns `not_found`. Before the plan manager's `joined_at`, family events (all but `episode.publish` and `catalog.update`) return `invalid_event`.
  - An episode seeded after the clock appears at its `published_at` without an event, so followers get no notice or auto-download for it. A task that needs those effects publishes the episode with `episode.publish`.

| Record | Field | Class | Before the clock reaches it |
| --- | --- | --- | --- |
| `episodes` | `published_at` | happened | Hidden. Episodes have no other dated state; `availability` and `explicit` changes are not dated and read as stored. |
| `albums` | `released` (a date) | happened | Hidden with its tracks until the start of that day in the family's calendar offset (the billing anchor's: -08:00 for the Raman-Ellis family, -05:00 for Leila). The offset is fixed, so in summer a Pacific release appears at 01:00 PDT. A hidden album or track is `not_found` and absent from search, artist pages, library, playlists and downloads. |
| `members` | `joined_at` / `removed_at` | happened | Hidden / reads `active`. |
| `invitations` | `invited_at` / `responded_at` | happened | Hidden / reads `open`. |
| `billing.timeline` | `set_at` | happened | Hidden (the first entry, the account start, always stays). |
| `billing.timeline` | `from` | scheduled | A visible entry whose `from` is later is the scheduled change. |
| `billing.adjustments`, `billing.payments` | `created_at`, `at` | happened | Hidden, so invoices read `pending` or `upcoming` and `payment_due` follows the visible results. |
| `devices` | `registered_at` | happened | Hidden. |
| `devices` | `last_checkin_at` | happened (latest only) | Only the latest check-in is stored. Before it, the device reads as checked in at the end of its latest visible session (a device checks in when it plays), or at `registered_at` if it has played nothing. Downloads read `needs_check` only when that time is more than 30 days old. |
| `sessions` | `ended_at` | happened | Hidden until it ends (a session is recorded when it ends). `started_at` is part of the record. |
| `progress` | `updated_at`, `played_at` | happened | Recomputed from the latest visible session (none: unplayed). |
| `plays` | `last_played_at` | happened | The count less the later sessions, with the latest visible session's end (none: no play). |
| `follows` | `followed_at` | happened | Hidden. Settings changes are not dated. |
| `upnext` | `updated_at` | happened | Hidden: the member has an empty list at version 1. |
| `downloads` | `requested_at` / `removed_at` | happened | Hidden / reads not removed. |
| `downloads` | `completes_at` | scheduled | `queued` before it, `downloaded` from it. |
| `downloads` | `auto_delete_at` | scheduled | Shown once the member's visible progress on the episode is `played`; `removed` from it. |
| `library` | `saved_at` | happened | Hidden. |
| `playlists` | `created_at`, track `added_at` | happened | Hidden. `updated_at` reads the latest visible change. `track_version`, name, visibility and collaborators are not dated and read as stored. |
| `notifications` | `created_at` | happened | Hidden. |
| `family`, `billing` | `created_at`, `anchor` | descriptive | The account start and the billing calendar's origin. |
| `activity` | `at` | App-written | No tool reads it, so it is not filtered; new rows follow the stored ones. |
- **Times in results.** Derived times keep the UTC offset of the timestamp they come from (period boundaries keep the anchor's; auto-delete times their base's). The exception is `devices.list` `offline_check_due_at`, shown in the current clock's offset. Priya's check-in was in PDT, but her due time reads `2026-11-30T19:00:00-08:00`.

### Billing

| Question | Rule |
| --- | --- |
| What produces the next period? | Nothing is stored. Periods are calendar months from `billing.anchor`, derived from `virtual_now` on every read and write. Invoice IDs are predictable: `inv-` plus the period's start date (`inv-2026-12-03`). |
| Plan and status between period end and the payment event | The plan is whatever the timeline has in effect at that instant, so a downgrade scheduled for period end is already in effect. The status stays `active`, and the new period's invoice reads `pending` until `billing.payment_result` arrives. |
| Amount due for a period | The monthly price of the plan in effect at the period's start, plus any proration adjustments assigned to that invoice. A downgrade that took effect at that start bills the smaller plan. |
| Immediate upgrade | Applies at once, refused with `payment_due` while a payment is due, and clears any scheduled downgrade. The prorated difference `round((new − old) × remaining / period length)` for the rest of the current period is added to the next invoice. |
| Downgrade | Scheduled for the end of the current period. Refused with `too_many_members` if active members plus open invitations exceed the new limit. No credit is given. While it is pending, invitations count against the smaller limit. `plan.revoke_change` cancels it before it takes effect, and so does choosing the plan in effect with `plan.confirm_change` ("keep Family"). Afterwards, or with none scheduled, `plan.revoke_change` returns `no_pending_change`. |
| `plan.preview_change` | Classifies the change, applies it to a copy of billing and reads the next invoice from that copy. `plan.confirm_change` applies the same classification to the real data, so at the same clock the quote equals the charge (tested). It returns `allowed: false` with `blocked_by` (`too_many_members`, `payment_due`, `same_plan` or `already_scheduled`) instead of an error. Confirming in those cases fails with that code, or with `invalid_arguments` for `same_plan` and `already_scheduled`. |
| A declined charge | `payment_due` with a 7-day grace period from the first decline. Upgrades are refused at any point while a payment is due. After the grace period, new downloads (and auto-downloads) return `payment_due` and existing ones read `needs_check`. A `paid` result restores them. |

## Fixtures

All names, text and prices are original and fictional (see `contribution/dataset.json`). History runs from 2026-01-03, when the family plan started, to 2026-11-24. A task can load the seed at any clock; tools show the records dated by then (see the clock cutoff under State and time). It can also supply its own history in the same schema.

- **`fixtures/minimal.json`** (326 KB): the Raman-Ellis family at Tuesday, Nov. 24, 2026, 19:00 Pacific (`fixtures/clock.json`).
  - People: Priya (plan manager), her partner Sam, Noor (teen) and Kai (child, explicit filter on).
  - Six devices: Priya's phone, earbuds and the kitchen speaker signed in to her account, Sam's phone and the family car, and Noor's phone.
  - Catalog: 10 artists, 15 albums and 120 tracks. 12 explicit tracks have clean versions; 3 explicit tracks have none.
  - Podcasts: 8 shows, 150 episodes, plus `ep-fieldnotes-115` by event. `ep-lanternledger-003` is removed.
  - History: 198 sessions, 120 progress entries, 40 downloads, 5 playlists and 11 monthly payments.
  - Priya's phone has a 1 GB Tidepool storage cap. It last checked in on Oct. 31 at 20:00 PDT, and no download on it was requested after that (the fixture test checks this).
  - `contribution/dataset.json` counts 506 records.
  - "Field Notes" and "Harbor Hours" are fixed by the approved proposal. "Field Notes" shares its title with real podcasts; this package uses no content from any of them.
- **`examples/task-data/`**: the second family, Leila Haddad (`tidepool-leila`), on the Individual plan with the Nov. 15 invoice declined on Nov. 20 (grace until Nov. 27, 09:00 Eastern). It ships its own `dataset.json` (315 records), binding, write-granting policies and a `paid` event; see its README. To sign in as another member of the main family, load `fixtures/minimal.json` with `account_id` and `owner_person_id` set to that member's (for example `tidepool-sam` / `person-sam`). The binding already lists all four accounts and the record count is unchanged.

| Request | Data a task can use |
| --- | --- |
| Commute on earbuds | Priya stopped `ep-fieldnotes-112` at 31:10 on her earbuds on Nov. 22 (10:50 left). The kitchen speaker plays 113 (scenario, 19:42) and 114 (`kitchen-fieldnotes-114`, 20:25, `speaker_hint: "Sam"`) under her account. `ep-harborhours-088` (52 min) was published that morning. Her Harbor Hours follow has auto-download off. Her phone has about 300 MB free (297.6 MB). Sam is 600 s into 113 on his own phone. `train-fieldnotes-112-end` has her finish 112 on the train next morning, which schedules its download for auto-delete two days later. |
| A clean road-trip playlist | **The playlist name the event uses is "Road trip"**: `roadtrip-noor-add-1` names `{owner_member_id: "mem-priya", name: "Road trip"}`. Sam's shared "Road trip ideas" (`pl-road-trip-ideas`) holds three clean tracks, two explicit tracks with clean versions and one explicit track with none. Noor's addition `tr-saltline-07` is explicit with a clean version `tr-saltline-07c`. `pl-family-car` is a seeded collaborative playlist; `family-car-noor-add` adds an explicit track to it. |
| Before a flight | Priya's phone holds 15 played episodes of Overtime Almanac and Static & Signal, which she no longer follows (635 MB). Her Up Next (5 episodes, 254 MB) and her two saved albums (77 MB) do not fit in her 297.6 MB until those are removed: the queue and the first album fit, the second album returns `storage_full`. The phone last checked in Oct. 31, 20:00 PDT, so its downloads need a check from Monday, Nov. 30, 19:00 PST, during a trip that starts Friday, Nov. 27. The family uses 4 of 6 Family slots; Duo allows 2. |

Expected answers for a real task belong in that task's evaluator, not in this package.

## Evaluation dataset, 2025-01-01 to 2026-12-31

`data/evaluation/` is the delivered evaluation data for the coverage window in [submission evidence, section 3](../../docs/submission-evidence.md#3-environment-dataset-coverage). The fixtures above stay small smoke data. This dataset was added after the plan was approved, when that section was published; it is recorded as added scope in the validation report.

- **`seed.json`** (version 1.0.0, 0.43 MB, one record per line): the Raman-Ellis family, loadable for any of the four member accounts with `binding.json`. `policies.json` (reads only), `clock.json` and `dataset.json` sit beside it; `dataset.json` records the sources, the record count (826, counted as for the fixture) and, under the generated source's `generation.parameters.outputs`, the seed's size and sha256. It validates against `schemas/dataset.schema.json`, so a task can pass it to `env.load_seed` as the bundle's `dataset` unchanged; the dataset demo does.
- **2025.** Priya opens her account on the Individual plan on Jan. 3, 2025 and streams on her old phone (`dev-priya-oldphone`, no Tidepool downloads):
  - Harbor Hours on the commute and Kettle Theory while cooking;
  - Overtime Almanac at lunch and Static & Signal on Sunday evenings;
  - albums on Saturday mornings, including each new album she likes on its release weekend.
  She takes two weeks off in August. Twelve $10.99 invoices are paid; the July charge is declined and paid two days later, with its notice.
  There is no family history before 2026: follows, downloads, library saves, playlists and the other members start with the January 2026 upgrade. A Task that needs family records from 2025 must supply them.
- **2026.** The fixture, verbatim: the Family upgrade at the Jan. 3 renewal, when Sam, Noor and Kai join, and the family's history to Nov. 24.
- **Episodes.** Every show keeps its fixture cadence and weekday from Jan. 2025 (Lantern Ledger and Bedtime Bramble start in 2026, Overtime Almanac and Static & Signal break from October to January) and continues to Dec. 28, 2026. Field Notes stops at 114, because the shipped example `examples/events/fieldnotes-115-publish.json` publishes 115 on Nov. 28 and must still apply to the dataset unchanged.
- **Fixture records.** Three fixture records change, so that the 2025 story holds; everything else is copied verbatim (tested):
  - `family.created_at` and Priya's `joined_at` move to 2025-01-03.
  - `billing` gains an Individual start on 2025-01-03 before the fixture's Family entry, which becomes an `upgrade` at the Jan. 3, 2026 renewal.
  The billing calendar and every 2026 invoice are unchanged. The seeded upgrade carries no proration, matching the fixture's paid $17.99 February invoice. `plan.confirm_change` at exactly 00:00 on Jan. 3 would add 700 cents to that invoice, because it prorates the whole new period; one minute earlier it adds 0. At the dataset clock the family, Up Next, downloads, library, playlists, follows and 2026 history read as in the fixture for Priya and Sam (tested). Priya's account also lists the old phone, and her history and notices run back to 2025.
- **Clock.** The dataset clock is the fixture clock, 19:00 Pacific on Nov. 24, 2026, where the family's history ends. Episodes dated later appear as the run clock reaches them (see the clock cutoff), so they are never pre-session history. Before Jan. 3, 2026 only Priya's account has a membership; Sam's, Noor's and Kai's return `not_found`.
- **Provenance.** Every record is synthetic: 512 counted records copied from the authored fixture, 2 fixture records changed as above, and 337 written by `dev/build-dataset.cjs` from templates and a fixed random seed. Shows, artists, albums and tracks are the fixture's, and guests and narrators are invented personal names. The approved design uses an invented service and catalogue, so there is no real November 2026 source to anchor to, and nothing was collected from real services.
- **Coverage**, counted in America/Los_Angeles on each record's own date field (`published_at`, album `released`, `started_at`, payment `at`, `requested_at`, `saved_at` and the rest; see the report):
  - 454 distinct dates in all 24 months, 444 of them on or before the dataset clock. The seven albums released in 2022-2024 are excluded as earlier than the window.
  - The longest stretch without a record is 8 days (Dec. 12-19, 2026). Family records fall on 282 dates, with a 16-day gap for the August 2025 vacation.
  - No two episodes share their title and notes, and no pair shares 80% or more of its word 5-grams.

```sh
node dev/build-dataset.cjs          # rebuild data/evaluation/ (byte-identical on rerun)
node dev/coverage-report.cjs        # coverage by source and month, provenance, gaps, content checks
node dev/coverage-report.cjs --json
node examples/dataset-demo.cjs      # load it over real MCP, query it at three clocks, then run the early-write repro
```

## Commands

From this directory:

```sh
npm test              # App-only business tests (no runtime needed)
npm run example       # App-only run of the approved listening.record example
npm run walkthrough   # Real MCP evidence report (JSON on stdout); needs the public runtime
npm run dataset:demo  # Real MCP load and query of the evaluation dataset (JSON on stdout)
npm run build:contracts && npm run build:fixtures   # maintainers: regenerate tools, schemas, fixtures and counts
npm run build:dataset && npm run dataset:coverage   # maintainers: rebuild the evaluation dataset and report its coverage
```

From the repository root:

```sh
npm run app:verify -- --app apps/tidepool --output .artifacts/tidepool.json
```

`npm run walkthrough` finds the runtime the same way `service.cjs` does: by walking up to the checkout, or through `PALE_RUNTIME_ROOT`.

## Proposal checks and evidence

"Test" names refer to `tests/business.test.cjs`, run App-only. "Walkthrough" refers to checks in `examples/mcp-walkthrough.cjs`, which runs through the public runtime with separate Agent and Infra connections. The walkthrough report includes:
- a reference reply per request, checked against what that account saw;
- a trace of every call (run, account, connection, `request_id` / `event_id`, status, duplicate, version);
- the snapshot taken before reset;
- the exact `env.apply_event` call.

These replies are reference evidence for the data and tools, not model-agent trials.

| Proposal row | Evidence |
| --- | --- |
| **W1** (T01–T02): Kai's search marks explicit tracks filtered and returns clean versions; an unknown ID is `not_found`; a removed episode cannot be queued (`unavailable`) | Tests *T01*, *T02*. Walkthrough: "Kai's search marks explicit tracks filtered", "…returns each filtered track's clean version next to it", "An unknown catalog ID returns not_found", "Queueing a removed episode returns unavailable and changes nothing". |
| **W2** (T03–T04): a `listening.record` to the end marks the episode played for that member only; `progress.set` back to 31:10 records `set_by: agent` and the replaced value; a position beyond the duration is `invalid_position` with state unchanged | Tests *T03*, *T04*. Walkthrough: "Kitchen-speaker listening.record changes only Priya's progress on 113", "Sam's own account still reads 113 in progress at 600 s", "A listening.record to the end of 112 commits" (`examples/events/train-fieldnotes-112-end.json`, trip instance), "progress.set back to 31:10 records set_by agent and the replaced value", "progress.set adds no session …", "A position beyond the duration returns invalid_position and changes nothing", "An unknown episode returns not_found and changes nothing". |
| **W3** (T05–T07): `upnext.set` returns version 2; downloads reserve space, read queued before their completion time and downloaded at it, and turn `needs_check` after 30 days; `storage_full`; a stale Up Next version is rejected | Tests *T05*, *T06*, *T07*, *T07b*, *T07c*, *T07d*, *T07e*. Walkthrough: "upnext.set commits list version 2", "A stale Up Next list version is rejected", "Both downloads are queued with space reserved", "Download completion: …", "The second album before any removal returns storage_full and changes nothing", "30-day offline check: …"; Sam's follows and library checks ("Sam follows Kettle Theory", "Sam sets auto-delete …", "Sam unfollows Overtime Almanac and keeps its download", "Sam saves an album", "Sam unsaves a track"). |
| **W4** (T08–T09): a collaborative playlist accepts Noor's `playlist.edit` as author; Kai's account skips its explicit track; a collaborator changing visibility is `forbidden` | Tests *T08*, *T09*. Walkthrough: "Kai's account skips the explicit track Noor added; it stays in the playlist", "A collaborator changing visibility returns forbidden", "Sam, as owner, renames his shared playlist". |
| **W4 agent-created playlist** (T10): "Road trip" created by the agent; the `playlist_ref` event adds Noor's track with one new version, her authorship and a notice for Priya; `target_not_found`, `ambiguous_target` and `not_collaborator` change nothing, return `applied: false`, leave a `deny` audit row and no receipt | Test *T10*. Walkthrough: "playlist.edit before "Road trip" exists: …", "The same event_id retried after the playlist exists commits", "Noor's track lands at position 4 …", "Two of Priya's playlists named "road trip": …", "Noor editing Priya's private playlist: …". |
| **W5** (T11–T13): an upgrade applies at once; a downgrade is scheduled and can be revoked; Ana's invitation is accepted or declined by event; `too_many_members` for Family → Duo with four members; Sam's account changing Kai's filter is `forbidden`; `already_invited`; a response without an open invitation is `target_not_found` | Tests *T11*, *T11b*, *T12*, *T13*. Walkthrough: "Sam's account changing Kai's filter returns forbidden", "Ana declines by event", "Ana accepts by event (approved example)", "Family -> Duo is refused on confirm", "plan.confirm_change naming another member returns forbidden", and the Leila billing checks, including "Choosing the plan in effect keeps it and revokes the scheduled downgrade". |
| **W5 billing examples** (review item 3) | Main family: Noor and Kai are removed, then Family → Duo is scheduled for Dec. 3. After `env.advance_time` to Dec. 3, 09:00 with no event, `family.get` shows Duo, period Dec. 3–Jan. 3, `inv-2026-12-03` `pending` at 1499 and status `active`. A decline puts the account in `payment_due` with grace to Dec. 10, 09:00; downloads read `needs_check` from then until a `paid` result (test *T11*). Leila: after paying, an Individual → Duo upgrade at Nov. 28, 10:05 is quoted and charged 221 cents of proration (16 d 13 h 55 m of a 30-day period × 400 cents). The next invoice is 1720, or 1320 once a downgrade back to Individual is scheduled. After Dec. 15 she is on Individual and `inv-2026-12-15` is 1320 `pending` (test *T11b*; walkthrough "Upgrade applies at once; the charge equals the quote …", "After period end the downgrade is in effect …"). |
| **T14** Core contracts: no second effect for a repeated `request_id`; `idempotency_conflict` for changed input; `permission_denied` for Infra operations; every event with its rejections; reset restores seed and clock; one activity row per committed write or event | Test *T14* plus the per-event rejection checks in T02–T12. Walkthrough: "An identical retry of upnext.set is a duplicate", "Reusing the request ID … is an idempotency conflict", "Resending byte-identical env.apply_event arguments is a duplicate …", "Reusing an event ID with different content …", "A stale expected_version is rejected", "Agent cannot inject events", "Reset restores …", "<instance>: one activity row per committed write", "…joins a Core receipt by request_id or event_id"; public verifier. |
| Example request 1: commute | Walkthrough `reference_replies.commute`: Up Next starts with 112 at 31:10, then Harbor Hours 88. Both are downloaded before morning. The queue runs 62:50 at 1×, past 40 minutes, and the kitchen played state is left unchanged. |
| Example request 2: road trip | Walkthrough `reference_replies.road_trip`: the playlist is owned by Priya with three collaborators; two clean swaps, one track left out; Noor's explicit addition replaced by its clean version in place; Kai's filter unchanged. |
| Example request 3: before a flight | Walkthrough `reference_replies.before_flight`: 15 played downloads of unfollowed shows removed; the queue and both albums downloaded; the phone must be online by Nov. 30, during the trip; the plan stays Family; unused slots carry no separate charge. |
| Quality check: every session points to an existing member, device and item and fits the item's duration; downloads fit each device's cap; clean versions match title and artist | `validateSeed` (`src/model.cjs`); test *seed validation rejects …*. |
| Quality check: recompute progress from sessions; fixtures under 1 MiB; authorship recorded; zero external assets | Test *fixtures: scale, consistency …*; `contribution/dataset.json`; empty `contribution/assets.catalog.json`. |
| Quality check: run with only Tidepool and Core | The verifier and walkthrough registries contain only `tidepool`. |
| Validation and reset workstream: the three requests on the public runtime against two member accounts; pinned versions, commands and traces; reset restores the baseline; a member cannot change Kai's filter; a too-full downgrade is refused; a collaborator's edit reaches an agent-created playlist with its author; an invitation is accepted or declined by event | The walkthrough runs Priya's, Sam's and Kai's accounts as separate instances and prints `runtime`, `node`, `package_sha256` and the full `trace`. Checks: "Reset restores the loaded family, history and catalog", "Reset restores the loaded clock", "Resetting Priya's instance leaves Sam's instance as it was", "Sam's account changing Kai's filter returns forbidden", "Family -> Duo is refused on confirm", "Noor's track lands at position 4 …", "Ana declines by event", "Ana accepts by event (approved example)". Commands are listed under Commands. |
| Review close check: `env.advance_time` past a download's completion, the 30-day check, an auto-delete window, the grace period and a period end, with no event | Walkthrough `timeOnly` steps "Download completion", "Auto-delete window", "30-day offline check", "Billing period end", "Payment grace period end", "Period end with a downgrade". Each checks `env.advance_time` committed, business data and activity rows unchanged, only an `env.advance_time` audit row, and `family.get` counts equal to `downloads.list`. Tests *T06*, *T07b*, *T11*. |
| Review close check: a kitchen-speaker `listening.record` updates only Priya's progress | Test *T03*; walkthrough snapshot diff, plus Sam's own account. |
| Review close check: `members.remove` counts match `family.get` beforehand | Test *T13* (Sam and Noor; each has one collaboration ended and one shared playlist hidden). Walkthrough: "members.remove returns the counts family.get showed beforehand (all six fields)", "Noor's removal ends 2 collaborations and hides her shared playlist from the family", "Her shared playlist has left Priya's view". |
| Clock cutoff and evaluation dataset (added after plan approval, #260) | Tests *a seed loaded before its latest record shows only what existed at the clock* (Leila's task data at Oct. 1), *a write before a seeded later record with the same key replaces it …*, *a write that the later family records cannot coexist with drops them …*, *before the account exists every tool returns not_found …*, *events count only visible records …*, *at a mid-2026 clock a device that played recently …*, and the three *evaluation dataset* tests (counts and sha256, fixture records kept, nothing used before its album's release, fixture facts at the dataset clock, nothing later visible at four clocks). `examples/dataset-demo.cjs` loads the dataset over real MCP and queries it at three clocks; `dev/coverage-report.cjs` recomputes the coverage. The three later-history tests (*a write at an early clock that drops later family records …*, *every kind of early-clock collision …*, *an event at an early clock that replaces a later record …*) and the dataset demo's last stage cover the report of removed later history. |

## Review items resolved

The first approval review left four items. Item 1 was resolved in the approved revision and is implemented as written (see Incoming events). Items 2–4 were left for implementation.

**Item 2: caller identity and per-member narrowing.**
- **Who is calling.** Core's context carries the run's whole binding but no per-instance account. The caller therefore comes from the seed's `account_id` and `owner_person_id`, which only Infra loads (`env.load_seed`). `validateSeed` checks that pair against a `tidepool` account in `binding.json` and requires that `owner_person_id` to map to exactly one active member; that member is "you". Nothing in a tool argument can change it. "Sam's account" is a separate run, or instance, loaded with `tidepool-sam` / `person-sam`. Family state does not sync between instances, so a write is checked in the instance that made it. The optional `speaker_hint` is stored and shown but never used for authority.
- **Narrowing shape.** Every member-scoped tool takes the member as `id`, and changes go in `patch` (`filters.update`, `follows.update_settings`, `playlists.update_settings`). Core's policy `constraints` therefore apply directly: `ids` narrows which members, and `fields` narrows which keys of `patch`.
- **App rules on top.** Owned-record tools (progress, follows, Up Next, downloads, library, playlists, history, notifications, devices) return `forbidden` unless `id` is the caller, so family membership gives no access to another member's records. Manager tools (`members.invite`, `members.remove`, `filters.update`, `plan.confirm_change`, `plan.revoke_change`) return `forbidden` for anyone but the plan manager. `plan.preview_change` is a read open to every member. The plan tools take the manager's own member ID as `id`, so Core's `ids` constraint applies to them too. A task narrows further with `policies.json`. `examples/policies/narrow-members.json` limits `filters.update` to `ids: ["mem-kai"]`, `fields: ["explicit_filter"]`, and `members.remove` and `plan.confirm_change` to no one; Core then returns `permission_denied` and audits the denial with the `id`. For `members.invite`, `ids` lists person IDs.
- **Evidence.** "Sam's account changing Kai's filter returns `forbidden`" is test *T13* and the walkthrough check of the same name. The policy denials are the walkthrough's "Policy narrowing: …" checks.

**Item 3: billing between period end and the payment event.** See the Billing table under State and time:
- the next period is derived on read from `virtual_now`, never created by an event;
- the plan read in between is the timeline's plan at that instant, the status is `active`, and the invoice is `pending`;
- the amount due is the plan at the period's start plus proration;
- an immediate upgrade adds its prorated difference to the next invoice;
- `plan.preview_change` and `plan.confirm_change` share one classification, and the quote is read from a trial copy.

The W5 billing row above gives a worked example of each.

**Item 4: prefixes.** All 33 tools are `tidepool.<name>`. `dev/build-contracts.cjs` adds the prefix, and the runtime's registration check enforces it. The acceptance mapping, tests, policies and walkthrough use the prefixed names.

**Answers the review gave, followed:**
- A filtered member's explicit track stays in the playlist and is skipped for that member (`skipped_for_you`).
- `speaker_hint` is stored but not trusted.
- Fixtures are MIT.
- The suggestion to cover history from 2026-01-01 is followed. Sessions, progress, follows, device registrations and billing periods start in January 2026. The evaluation dataset adds Priya's 2025 on the Individual plan (see Evaluation dataset).

## Additions beyond the approved text

These are implementation choices the proposal leaves open. They are listed so they are not read as drift.

1. **The `id` argument.** `id` is the member argument on member-scoped tools (review item 2). The plan tools require `id` to be the manager's own member ID, and any other member returns `forbidden`. `members.invite` takes the invitee's `person_id` as `id`, so its `ids` constraint lists person IDs.
2. **App-level list versions.** `upnext.set` requires `expected_list_version`, and `playlists.update_tracks` accepts an optional `expected_track_version`. Both are separate from Core's `expected_version`. A mismatch returns the App code `list_version_mismatch` with the list's current version in the message. `stale_version` stays Core's, for `expected_version` only.
3. **Playlist operations.** Operations name tracks by `track_id`, and a playlist holds each track once. Adding a track already present returns `invalid_arguments`, as do a blank name and the owner listed as collaborator. An `add` position past the end appends, because an event author cannot know the length of a playlist the agent created. `move` needs a position within the list (`invalid_position`). Event `playlist_id` lookups accept seeded playlists only (`origin: "seed"`), as approved; agent-created ones are reached by `playlist_ref`.
4. **Auto-download "newest *n*".** On publish, older auto-downloads of that show on the same device that fall outside the newest *n* episodes are released (`auto_download_limit`). Manual downloads are never released.
5. **Who `payment_due` blocks.** Upgrades are refused at any point while a payment is due. After the grace period, new downloads and auto-downloads are refused too. Downgrades, revokes and everything else stay available (the narrowest reading).
6. **Accepted invitations.** An accepted invitation creates member `mem-<person suffix>`, which is predictable for task authors; a previously removed member is reactivated instead. `members.invite` for a person not in the binding returns `not_found`.
7. **Member removal and `family.get`.** A removed member's downloads are removed (`member_removed`), and their collaborator places on others' playlists end; tracks they added stay. Their own shared and collaborative playlists leave the family view. The impact (`if_removed` and the `members.remove` result) counts collaborations only on collaborative playlists of active owners, and lists the hidden playlists as `owned_playlists_hidden` / `owned_playlist_ids`. `family.get` shows the caller's own download counts. Only the plan manager sees every member's counts and the `if_removed` impact.
8. **Played progress, albums and auto-delete.** Played progress is stored at position 0. A fresh download of an already-played episode gets the full auto-delete window from the download time. A new follow's auto-delete applies to already-played downloads, as a settings change does. An album download is one download covering all its tracks. Devices with no Tidepool storage (earbuds, the speaker) return `unavailable` for downloads.
9. **Keeping the current plan.** `plan.preview_change` reports blocks as `allowed: false` with `blocked_by`. Confirming the plan already in effect revokes a scheduled change (`revoked_change`), so "keep Family" really keeps it. With nothing scheduled, that confirmation fails with `invalid_arguments`, as does repeating a downgrade already scheduled; neither writes an activity row.
10. **Example data.** `examples/events/` holds one example per remaining event type plus `train-fieldnotes-112-end`, `kitchen-fieldnotes-114` carries a `speaker_hint`, and `examples/policies/narrow-members.json` shows per-member narrowing. Kai has no devices of his own: he listens on the kitchen speaker and in the car, under his parents' accounts.
11. **Clock cutoff and evaluation dataset** (added after plan approval, #260). Tools and events see only records dated at or before the clock (see State and time), and `data/evaluation/` delivers the 2025-2026 dataset. Before this change a seed loaded before its latest record showed its later records. Tool schemas and error codes are unchanged.

## Package map

| Path | Contents |
| --- | --- |
| `app.json`, `package.json`, `service.cjs`, `plugin.cjs` | Manifest, commands, provided launcher, hook exports |
| `tools.json` | The 33 Agent tools with input/output schemas |
| `src/model.cjs` | `validateSeed` and the session, episode and track checks shared with events |
| `src/catalog.cjs` | Catalog lookups, item views and search |
| `src/account.cjs` | Caller identity, member authority, derived download state, `settle`, activity rows and notices |
| `src/billing.cjs` | Periods, invoices, payment-due state, slots, and the shared preview/confirm rules |
| `src/rules.cjs` | Transitions shared by tools and events (playlist operations, collaborators, download reservation) |
| `src/visible.cjs` | Clock cutoff: the data as of the run clock, and the record-by-record merge of writes and events |
| `src/operations.cjs` | Agent tool handlers |
| `src/events.cjs` | The seven event handlers |
| `src/domain-utils.cjs`, `src/diagnostics.cjs` | Shared helpers (errors, time arithmetic) and the optional ID-only diagnostics adapter |
| `schemas/` | Seed, event and state schemas plus the shared dataset/catalog contracts |
| `contribution/` | Contribution declaration, dataset provenance, empty asset catalog |
| `fixtures/` | Minimal seed (Priya), binding with all four family accounts, policies, clock |
| `data/evaluation/` | The 2025-2026 evaluation dataset: seed, binding, policies, clock and its own `dataset.json` |
| `examples/` | App-only example, the approved event, event examples, a narrowing policy, task data for Leila, real-MCP walkthrough, real-MCP dataset demo |
| `tests/` | Business tests, App-only harness, verifier cases, schema validator |
| `dev/` | Maintainer scripts. They regenerate the schemas, `tools.json`, fixtures, task data and dataset counts byte for byte (`npm run build:contracts`, `npm run build:fixtures`), build the evaluation dataset (`npm run build:dataset`) and report its coverage (`npm run dataset:coverage`). The verifier does not run them; the business tests check the dataset's counts and hash. |

## Limitations

- Metadata, listening records and account controls only: no audio playback, artwork or other media. Resources are not used.
- One signed-in family member per App instance. Each member's account is a separate instance loaded with the same family seed; family state does not sync between instances, one member's writes are not visible in another member's instance, and Infra applies each event to the instances that should observe it.
- Billing is a fixed monthly calendar from the billing anchor with integer-cent prices; there are no taxes, refunds, payment methods or currency conversion.
- No recommendations, generated mixes, audiobooks, lyrics, live audio, podcast hosting or paid podcast subscriptions.
- Search matches the start of words (case- and accent-insensitive); there is no ranking or stemming.
- MCP only: no GUI and no reviewer console.
