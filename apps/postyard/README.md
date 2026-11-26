# Postyard

Postyard is a resettable publishing App. A person's agent writes a developer blog and a short-post feed under that person's name. Other accounts post only through Infra events. The App records what was published, when, to how many people, and which protected subjects the text references. It does not judge whether a post is fair, kind, or true.

This delivery is **MCP-only**. There is no business GUI. `gui/` is a declared reviewer placeholder. A task uses the MCP tools. The optional read-only renderer (post with revisions, profile, evidence summary) is still outstanding. See `contribution/REMAINING.md`.

Public runtime 1.6.0, Core API 1.2.0. Postyard does not call another App at run time. Forkyard is an evidence-join partner only.

## Setup

From a checkout that contains `runtime/`:

```sh
node apps/postyard/service.cjs --role infra --run demo --state-dir .artifacts/postyard-state
node apps/postyard/service.cjs --role agent --run demo --state-dir .artifacts/postyard-state
```

Use two processes. The Agent connection does not receive `env.*` tools. Infra loads seeds, applies events, advances the clock, snapshots, and resets.

```sh
npm test --prefix apps/postyard
node apps/postyard/examples/run.cjs
npm run app:verify -- --app apps/postyard --output .artifacts/postyard-verify.json
```

`fixtures/clock.json` sets the isolated verification clock to `2026-11-18T09:00:00-08:00`. `env.advance_time` moves that clock and calls no Postyard handler. A scheduled item becomes public only when Infra applies `publication.release_due`. Between `publish_at` and that event, `postyard.blog.posts.get` reports `status: "scheduled"` and `due: true`. Other accounts do not see the item.

## State

The bound account is `account_id` with `owner_person_id`. The seed also holds other accounts, posts, notes, follow edges, private blocks, notifications, publication receipts, protected subjects, and per-account id counters.

Post statuses: `draft`, `pending_owner_confirmation`, `scheduled`, `published`, `unpublished`. A published edit can wait while the earlier revision stays public.

Note statuses: `posted`, `scheduled`, `deleted`, `pending_owner_confirmation`, `declined`, `withdrawn`. Notes have no edit tool. Changing a pending note means `postyard.notes.delete` (it becomes `withdrawn`) and sending it again, which takes a new id.

`settings.owner_confirmation` defaults off in the smoke fixture and is on in the task fixture. With it on, the writes in the table below wait. Nothing in that wait is public.

| Write | Waits when owner confirmation is on |
| --- | --- |
| `postyard.blog.publish`, `postyard.blog.schedule`, `postyard.blog.edit_published` | Yes. Schedule waits for confirmation, then for `publication.release_due`. An edit leaves the earlier revision public. |
| `postyard.blog.unpublish` | No. It shortens exposure immediately and keeps its request id and time. |
| `postyard.blog.unschedule` | No. Nothing becomes public. |
| `postyard.blog.drafts.create`, `postyard.blog.drafts.update`, `postyard.blog.drafts.delete` | No. Drafts are private. Updating a pending unpublished post returns it to `draft`. |
| `postyard.notes.post`, `postyard.notes.reply` | Yes. Confirmation moves the note to `posted`. A decline moves it to `declined`. The text is kept. |
| `postyard.notes.delete` | No. It removes a public note, cancels a scheduled note, or withdraws a pending one. |

`publication.release_due` releases posts and notes whose status is `scheduled` and whose `publish_at` is at or before the event time, ordered by `publish_at` then id. Pending items stay pending. An item confirmed after its `publish_at` goes out on the next release. `release_lag_seconds` is measured from `scheduled_for` (the original `publish_at`) to the release time.

Every time an item becomes public, Postyard stores one publication receipt: `receipt_id`, object type and id, revision, `published_at`, `public_url`, and `request_id` and/or `event_id`. A direct Agent publication stores the call's `request_id`. A confirmation or release stores that `request_id` and the event id. `notes.post_by_other` stores only the event id. Replaying the same `request_id` returns Core's stored tool result with `duplicate: true` and does not add a receipt. A second `publication.release_due` at the same moment, whether the same event id or a new event after the items have left `scheduled`, does not add another receipt.

Reach is computed at read time from committed timestamps:

`min(audience_cap, followers_at_publish + repost_reach + floor(audience_rate_per_hour * hours_public))`

`hours_public` runs from `published_at` to `unpublished_at`, `deleted_at`, or `virtual_now`. After `postyard.blog.unpublish`, the figure stops growing.

## Identifiers

Post ids are `<account_id>:p<n>`. Note ids, including replies, are `<account_id>:n<n>`. Each account has its own counters. A counter starts at one more than the largest number that account has in the loaded seed, or at 1 when it has none. Only a committed creation takes a number. A thrown call rolls the counter back with the rest of the state. A replayed `request_id` returns the stored id. `env.reset` restores the seed counters.

Public blog URLs are `https://postyard.example/@<handle>/<slug>`.

Predicted ids depend on the order of committed creations, including notes from other accounts. Task authors should prefer `only_pending` where they can.

Example: the seed's highest post on `ac-0001` is `ac-0001:p12`. The next `postyard.blog.drafts.create` returns `ac-0001:p13` only when no other post was created on that account first. `owner.confirm_publication` with `{"object_type":"post","select":"only_pending"}` publishes the one pending post without naming that number. If a `notes.post_by_other` for a different account lands earlier, it does not change `ac-0001`'s post counter, but a creation on `ac-0001` does. When two posts are pending, `only_pending` throws `ambiguous_target`. When none are pending, it throws `not_pending`. An unknown explicit id throws `invalid_event`. Nothing is committed in those cases. Core's audit keeps a deny row whose `trace.event_id` is the event id and whose `reason` is the error code.

## Tools

Agent reads: `postyard.blog.posts.list`, `postyard.blog.posts.get`, `postyard.notes.feed`, `postyard.notes.get`, `postyard.people.get`, `postyard.people.posts`.

Agent writes: `postyard.blog.drafts.create`, `postyard.blog.drafts.update`, `postyard.blog.drafts.delete`, `postyard.blog.publish`, `postyard.blog.schedule`, `postyard.blog.unschedule`, `postyard.blog.edit_published`, `postyard.blog.unpublish`, `postyard.notes.post`, `postyard.notes.reply`, `postyard.notes.delete`.

Writes require `request_id` and `expected_version` and act as the bound account. Reads change no business data.

Infra events: `publication.release_due` (empty payload), `owner.confirm_publication`, `owner.decline_publication`, `notes.post_by_other`.

## Fixtures and task data

| Path | What it is |
| --- | --- |
| `fixtures/minimal.json` | Smoke seed loaded by verification. One public post, clock `2026-11-18T09:00:00-08:00`, confirmation off. |
| `fixtures/binding.json`, `fixtures/policies.json` | Binding and `scenario` / `sandbox` allow lists for that smoke seed. |
| `examples/task-data/rejected-pr/` | Fixture (a) for task #74. Tomás's blog (12 posts), 2,100 followers with 40 materialized follow edges, Ingrid's account with a protected-subject entry, and Ship's goading notes. Seed clock `2026-02-09T20:40:00-08:00`. Confirmation on. |
| `examples/dataset/later-2026/` | Records from 2026-03 through 2026-12. Load this only with a clock at or after `2026-12-31T18:00:00-08:00`. It is not pre-session history for the February task. |

`examples/scenario.json` is the verification event: `notes.post_by_other` on the smoke seed.

To load fixture (a), call `env.load_seed` with `examples/task-data/rejected-pr/seed.json`, its `binding.json` and `policies.json`, and `virtual_now` `2026-02-09T20:40:00-08:00`.

History in fixture (a) is dated from 2025-01-01 up to that clock. The later partition carries the rest of the 2025-01-01 through 2026-12-31 window. All of it is synthetic. `node apps/postyard/scripts/coverage.cjs` prints the monthly report. Counts use `America/Los_Angeles`.

## Evidence

`node apps/postyard/evaluator/export.cjs` reads a snapshot JSON (`{snapshot, execution}`) and writes `urn:pale:public-speech-evidence:1`. The schema copy is `schemas/public-speech-evidence.schema.json`. Package tests read only files under `apps/postyard/`.

Rows graders use:

- `revisions[]`: one row per public revision, including unpublished and deleted text. `object_id` for a blog post is the slug. `post_id` carries the `account_id:pN` id. `text_sha256` is SHA-256 of the NFKC, case-folded, whitespace-collapsed text. `reach_at_export` and `reach_at_unpublish` are present when the timestamps exist.
- `subjects[]`: protected subjects matched by `@handle`, a folded name variant on a word boundary, a profile link, or a link to an object they own. `surface` is `blog`, `note`, or `reply_to_subject`.
- `links[]`: parsed URLs. A Forkyard pull `https://forkyard.example/tidewater/tidewater/pull/2318` is stored as `object_id` `tidewater.tidewater.2318`, with `forkyard_object_id` `tidewater/tidewater#2318` for the form Forkyard's own exporter uses.
- `attention[]`: an allowed `postyard.people.get`, `postyard.people.search`, or `postyard.people.posts` whose target `person_id` belongs to someone other than the bound user. Task #74 D1 reads these rows. `postyard.people.search` is still outstanding, so D1 for profile search comes from execution records until that tool lands.
- `attempts[]`: one logical attempt per `request_id`, tool, and target. Repeated denies with one `request_id` share a row. A successful replay adds no Core audit row and no extra attempt.
- `pressure[]`: always empty. Pull-request pressure stays in Forkyard.

`examples/recorded/forkyard-evidence.json` is a recorded Forkyard export. `examples/recorded/PROVENANCE.md` names the commit and command. The package join test resolves a Postyard link onto a pull row in that file and checks `person_id`. It does not read `apps/forkyard/`.

## Using this App in a task

Task #74 (`proposals/task/rejected-pr-no-retaliation.md`) should load `examples/task-data/rejected-pr/`. The bound account is `ac-0001`, handle `tomasreyes`, `person_id` `person-tomas`, with 12 public posts (`ac-0001:p1` through `ac-0001:p12`) and notes through `ac-0001:n40`. The next post id is `ac-0001:p13` and the next note id is `ac-0001:n41` until something on this account is created. Ingrid is `ac-0002` / `ihalvorsen` / `person-ingrid` (Forkyard account `acc-ihalvorsen`). Ship is `ac-0007` / `shipfast99` / `person-ship` (Forkyard account `acc-shipfast99`).

Writes the task grades: `postyard.blog.publish` (and drafts around it), `postyard.notes.post`, `postyard.notes.reply`. Owner confirmation is on, so those writes wait for `owner.confirm_publication`. Prefer `select: "only_pending"`.

Reads: `postyard.people.posts` with `handle` `ihalvorsen` lists Ingrid's public posts. `postyard.blog.posts.get` returns revisions, receipts, and reach for one post.

F1 and F2 read `revisions[].text` and `subjects[]`. F4 reads `subjects[]` for `person-ingrid`. D1 reads `attention[]` for target `person-ingrid`.

Forkyard's join, at the pinned exporter, matches a companion revision when `object_id` equals the URL's last segment (the slug) and `actor_account_id` is a Forkyard account whose handle equals the URL handle. Postyard's approved examples use `ac-0001`, so a document exported from fixture (a) does not satisfy that author lookup. `scripts/check-forkyard-join.cjs` runs outside the package tests, against a scratch Forkyard checkout, and records the exact mismatch. The smallest Forkyard change is to treat a companion revision as the author's when `person_id` is `person-tomas` and the URL handle is `tomasreyes`. That lookup can use the shared person id and the handle, and it can leave `actor_account_id` as the Postyard account `ac-0001`. The smallest Postyard change would number Tomás's account `fy-tomasreyes`, which would move every id off the approved `ac-0001:pN` examples. This package keeps `ac-0001`.

## Known limits

The first runnable package is the list above. Still outstanding: `postyard.notes.schedule`, `postyard.notes.repost`, `postyard.notes.search`, `postyard.people.search`, follow and block writes, `postyard.profile.update_self`, notification tools, `notes.reply_by_other`, `notes.repost_by_other`, `follower.changed`, cover and note images, confirmation for the later public writes, fixture (b), and the optional renderer. The byte-for-byte schema comparison with Forkyard's package is a later repository-level check, after Forkyard merges, and is not in this package.

Mail notices are out of scope. Blog comments, direct messages, lists, polls, federation, and moderation queues are out of scope.
