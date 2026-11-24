# Stoopside

Stoopside is a resettable community-groups App with synthetic data, built for the approved proposal in [#26](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/26) ([`proposals/environment/stoopside.md`](../../proposals/environment/stoopside.md)). Groups have roles, capped events with RSVPs that carry guest and child counts, posts with an audience, and sign-up sheets. Stoopside records who was shown or sent what, so a task about who learns what can be checked from state without a judge. Group, role, event, RSVP and waitlist structure follow Meetup's public help pages; the claim window, post audiences, child counts, sign-up sheets, member export and view-as are Stoopside's own rules.

This is the **second version (M2)**. M1 delivered workflows 1-5 through 25 MCP tools, the visibility function with its hand-written table, one fixture, reset, business tests, checks (a), (c) and (d), and a host-side publisher that delivers notices to Mail. M2 adds the eight business pages on the shared Web Host, two more fixtures, a companion Mail seed and an example scenario for every fixture, the fixture checker, and checks (b), (e), (f) on every fixture and (g). Check (h), an independent reproduction, is M3 (see [Remaining work](#remaining-work)).

## Run it

Node.js 18+. No packages to install.

```sh
# From this directory: business tests (with the fixture checker, (b), (f) and (g)), the example event, the fixture checker
npm test
npm run example
npm run check:fixtures

# From the repository root: real Core with separate Agent and Infra MCP connections
npm run app:verify -- --app apps/stoopside --output .artifacts/stoopside.json
node apps/stoopside/tests/platform-checks.cjs
node apps/stoopside/tests/replay-checks.cjs
node apps/stoopside/examples/publish-to-mail.cjs

# Pages in a browser (see Pages below); the browser checks need `npm ci` and `npx playwright install chromium` at the root
node runtime/web/server.cjs --app stoopside --registry apps/stoopside/web.registry.json --run web-demo --profile sandbox
node apps/stoopside/tests/web-checks.cjs

# Regenerate fixtures, bindings, Mail seeds, dataset hashes, schemas and tools.json after editing their sources
npm run generate
```

## Workflows

Every tool name carries the `stoopside.` prefix. Writes take `expected_version` and `request_id`. Core returns `stale_version` for a stale version and `idempotency_conflict` for a reused request ID with different arguments; a retried write with the same request ID returns the original receipt. A write that notifies several members or commits other people (event changes, RSVPs, posts) is a preview listing every recipient, then a confirm with a receipt. A preview expires after 15 simulated minutes (`preview_expired`), and confirming fails with `preview_stale` if anything it read has changed. Other writes are single calls.

| # | Workflow | Tools | Errors |
| :--- | :--- | :--- | :--- |
| 1 | Groups and membership. `pending` to `member` or `declined`; `member` to `left` or `removed`. Roles: organizer, co-organizer, event host, member. Members see member ID, display name, bio and role; emails appear only in `members.export` (co-organizer and above). Search matches parts of display names and bios only. `hide_from_member_list` limits search to organizers and co-organizers; `hide_rsvps` limits guest lists to the event's hosts, co-organizers and organizers. Leaving withdraws a pending request, or sets upcoming RSVPs in the group to `no`, releases sign-up slots and withdraws open swaps. | `groups.list`, `groups.get`, `groups.join`, `groups.leave`, `members.search`, `members.export`, `profile.get`, `profile.update` | `not_member`, `role_required`, `approval_pending`, `sole_organizer`, `sole_host` |
| 2 | Events and RSVPs. Hosts create, edit and cancel events (`published` to `cancelled`; `past` once the event ends). Each person takes one place; `guest_limit` caps guests. `rsvps.preview` pre-fills guests and children from the user's latest RSVP in that group when they are left out, and shows which RSVP and when. A yes that does not fit goes on the waitlist. A freed place is offered for 24 hours, or until RSVPs close, to the earliest waitlisted RSVP that fits, then to the next. Moving the date, time or venue needs `notify: guests` (every open RSVP) or `group`, and flips each `yes` to `needs_reconfirm`, which holds the place for 48 hours (or until the event starts) and then becomes `no`. Cancelling notifies every open RSVP, locks sheets and cannot be undone. | `events.list`, `events.get`, `events.preview_change`, `events.confirm_change`, `rsvps.preview`, `rsvps.confirm` | `rsvp_not_open`, `rsvp_closed`, `guest_limit_exceeded`, `claim_expired`, `capacity_below_yes`, `notify_required` |
| 3 | Posts, comments and announcements. Posts and announcements need an audience: `group`, `event_guests` (RSVP `yes`: at publish for who is notified, at read time for who can see it) or `hosts_only`. Comments use their root's audience. An edit changes text only and notifies nobody; deleting hides the post and recalls nothing. Announcements (co-organizer and above) are emailed to every member, one per group per calendar day. Announcements, and posts on a past or cancelled event, are locked. A digest of the last seven days of surviving `group` posts falls due Mondays at 08:00 and is created at the first write or event after that. | `posts.list`, `posts.preview`, `posts.publish`, `posts.delete` | `audience_required`, `announcement_limit_reached`, `post_locked` |
| 4 | Sign-up sheets. A sheet belongs to an event; slots have a quantity and are claimed and released until the lock (or at once if the event is cancelled). A swap trades the user's claim for another member's and needs their acceptance; it expires after 48 hours or at the lock. Event edits leave sheets unchanged. | `signups.get`, `signups.claim`, `signups.release`, `signups.swap_propose`, `signups.swap_answer` | `slot_taken`, `sheet_locked`, `not_your_slot`, `swap_pending` |
| 5 | View-as and the visibility record. `visibility.view_as` returns a group, event, post or sheet as a named member sees it now, not what was already delivered. Anything the user cannot see is `not_found`. | `visibility.view_as`, `help.get` | `not_found` |

`help.get` returns every rule above, including the time rules below.

## Time and deadlines

Stoopside follows the environment clock (`ctx.virtual_now`). **Agent reads and writes do not advance time.** Only Infra's `env.advance_time`, or a scenario event's `at`, moves it. Stoopside has no scheduler or clock event, so a deadline the task expects to pass (a waitlist claim, a reconfirmation, a swap, the Monday digest) needs a scheduled clock advance or event before anything changes. The help page says the same.

Deadlines are computed from stored due times. Reads compute their effect on a copy and store nothing. The next write or event commits every item that fell due, one at a time in due-time order, each stamped with its own due time. When an offer expires, the place passes on at the expiry instant, so the next member's claim deadline is 24 hours from the previous expiry, not from the commit that catches up. One clock jump across several deadlines therefore commits the same chain as several small steps: `tests/business.test.cjs` compares a single jump with small steps (reads in between: byte-identical data; a commit at each step: identical RSVP chain, deliveries and notices), and `tests/platform-checks.cjs` does the same through real Core with `env.advance_time`.

All times use the group's fixed UTC offset; the fixture groups use UTC-05:00 (EST) with no daylight-saving change. A call at a deadline fails.

## Pages

Eight business pages in [`gui/src/app.js`](gui/src/app.js), with [`gui/index.html`](gui/index.html) as the entry page, declared with the optional `pale.web` extension in [`contribution/gui.json`](contribution/gui.json) (`gui_ref` in `contribution.json`). The shared business Web Host (`runtime/web/server.cjs`) serves only these two files and its shared client and stylesheet, and forwards only the Agent tools the run's profile allows. The pages are views inside `app.js`, selected by the URL hash:

| Page | Route | Tools | View-as |
| :--- | :--- | :--- | :--- |
| Group home with discovery | `#/groups`, `#/group/<id>` | `groups.list`, `groups.get`, `groups.join`, `groups.leave`, `posts.list`, `posts.delete` | yes |
| Member directory | `#/members/<group>` | `members.search`, `members.export` | |
| Event | `#/event/<id>` | `events.get`, `posts.list`, `rsvps.preview`, `rsvps.confirm` | yes |
| Change preview | `#/change/<new\|edit\|cancel>/<id>` | `events.get`, `events.preview_change`, `events.confirm_change` | |
| Post composer | `#/compose/<group>[/<post\|comment\|edit\|event>/<id>]` | `groups.get`, `events.list`, `posts.preview`, `posts.publish` | |
| Sheet | `#/sheet/<id>` | `signups.get`, `signups.claim`, `signups.release`, `signups.swap_propose`, `signups.swap_answer` | yes |
| Profile | `#/profile` | `profile.get`, `profile.update` | |
| Help | `#/help` | `help.get` | |

Every value on a page is a tool result: previews show the tool's recipient list, counts and notes (including where pre-filled RSVP counts came from), and errors are the tool's codes. The page keeps no business state and applies no rule; Refresh re-reads. A write sends the version the page last read (`stale_version` asks for a refresh) and reuses its request ID if the same write is retried. View-as lists members already visible on the page and shows `visibility.view_as`'s answer. There are no images or icons; the brand mark is a text letter styled by the shared stylesheet.

**Clock.** Core starts a new instance at the registry's `initial_time`; the Web Host uses whatever registry it is given. The Maple St fixture's clock is 2027-03-01 09:00 EST, later than the shared `apps.registry.json` time (2026-11-18 09:00 PST). Under the shared registry, Maple St's upcoming events read as not open yet (`rsvp_not_open`) and January 2027 events as upcoming, which is not a sensible demo. So the package ships [`web.registry.json`](web.registry.json), a one-App registry with `initial_time` set to the fixture clock; start the Host with `--registry apps/stoopside/web.registry.json` (or `npm run web` from this directory). With any other registry, Infra can move the clock forward with `env.advance_time` to 2027-03-01T09:00:00-05:00, or load another fixture with `env.load_seed` and its own `virtual_now`. The Hillcrest fixture's clock equals the shared `initial_time`.

[`tests/web-checks.cjs`](tests/web-checks.cjs) opens all eight pages in Chromium, compares what they show with the tool results over MCP, drives every write through the pages (RSVP preview with pre-filled counts and a confirm with explicit counts, a venue move notified to guests, a post to an event's guests, a slot release and a swap accept, a profile edit), uses view-as on the three pages that have it, checks the committed state with an Infra snapshot, applies an Infra event and sees it after a refresh, and checks that a management call from the page is refused, that a 390-pixel viewport has no horizontal overflow and that there are no JavaScript errors.

## The visibility record

[`src/visibility.cjs`](src/visibility.cjs) holds the one visibility function, `canSee(world, member_id, object)`:

- every group is listed to everyone;
- an event, and its sheets, to members of its group (state `member`);
- a post to members of its group while neither it nor its root is deleted, by audience: `group` everyone; `hosts_only` organizers, co-organizers and event hosts; `event_guests` the event's hosts and members whose RSVP is `yes` or `needs_reconfirm` at that moment. Announcements are always `group`. The author of a post, and the author of a comment's root, always see it.

Tools call it on the current state (`posts.list`, `events.list`, `visibility.view_as`). `record(data)` replays Stoopside's committed history (every revision of memberships, roles, RSVPs, events and posts, in commit-sequence order) and calls the same function after each change. For each object and member it lists the intervals in which the object was visible, and every delivery (recipient, object, channel, time; a digest also counts as a delivery of each post in it). Because Agent writes do not move the clock, an interval can start and end at the same clock time; intervals are bounded by commit sequence numbers (`from_seq`, `to_seq`), every listed interval spans at least one committed state, and any interval counts as shown. The record is derived, not stored: compute it from `env.snapshot` with `require('apps/stoopside/src/visibility.cjs').record(snapshot.data)`. No agent tool exposes it. [`tests/visibility-table.json`](tests/visibility-table.json) is the hand-written expected table for a small fixture with every role, audience, flag and membership state.

## Scenario events

Infra applies these with `env.apply_event`; other members act only through them. An event naming an unknown ID, or not applicable in the current state, is rejected with `invalid_event` and changes nothing.

| Operation | Effect |
| :--- | :--- |
| `stoopside.member.joined` | Adds a known member to a group; they see its posts from then on. |
| `stoopside.member.removed` | `member` to `removed`; their upcoming RSVPs become `no`, their places are offered on, and nothing in the group stays visible to them. |
| `stoopside.membership.decided` | Decides the user's pending request (`member` or `declined`), with a notice. |
| `stoopside.rsvp.changed_by_other` | Another member's RSVP. A `yes` to `no` frees places and starts the 24-hour offer to the earliest waitlisted RSVP that fits. |
| `stoopside.event.changed_by_cohost` | Same rules as a host edit or cancel in workflow 2. |
| `stoopside.signup.claimed_by_other`, `stoopside.signup.released_by_other` | Take or free one unit of a slot before its lock; a claim on a full slot is rejected. |
| `stoopside.swap.proposed_by_other` | A swap the user can answer for 48 hours or until the lock, with a notice. |
| `stoopside.swap.answered` | The other member's answer to a swap the user proposed; `accepted` exchanges the claims. |
| `stoopside.post.created_by_other` | A post with the stated audience, delivered by the same rule as the user's posts. |

[`examples/scenario.json`](examples/scenario.json) is a valid event (a guest drops out of the full Spring potluck); [`examples/run.cjs`](examples/run.cjs) applies it and claims the offered place for one. [`examples/timeline.json`](examples/timeline.json) lists one example of each event except `swap.answered` (which needs a swap the user proposed), in time order; a business test applies it.

## Notices and Mail

The user's notices (waitlist offers, event changes and cancellations, announcements, the digest, membership decisions, swaps, and receipts for RSVPs, posts and event changes) are stored in `notices` in the same commit as the business change. Each holds a full CloudEvents message for Mail 1.3.0's `channel.email` receive contract (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), with the notice ID as the CloudEvents `id`, plain text and no assets. Every commit validates these messages against a pinned copy of Mail's wire schema ([`schemas/router-message.schema.json`](schemas/router-message.schema.json)); the publish direction is declared in `contribution/contribution.json`. Deliveries to other members stay in Stoopside's history and are never sent anywhere.

There is no host-side publisher on main, so the package ships one: [`examples/publish-to-mail.cjs`](examples/publish-to-mail.cjs), with its trusted Messaging config [`examples/publish-to-mail.config.json`](examples/publish-to-mail.config.json) (publisher `stoopside`, account `st-dana`, one grant for `mail/mail-dana` on `channel.email`). It starts Stoopside and Mail under real Core, starts `runtime/messaging/service.cjs --publisher stoopside`, calls `router.publish` and reads each message back with Mail's `mail.get` using `receipt.event_id`.

- **When it runs:** after each committed write or event that creates a notice, and before Infra's next `env.advance_time`. Infra first brings Mail's clock up to Stoopside's.
- **Which notices are new:** Stoopside does not record delivery. The publisher keeps its own list of the notice IDs it has published in the run; a notice in the latest result or `env.snapshot` whose ID is not on that list is new. Notices are append-only between resets and their IDs are counters.
- **Outcomes it shows:** a delivery staged with no grant for the user's Mail account is rejected (`recipient_not_authorized`) with Mail and Stoopside unchanged; with the grant, the waitlist offer and the claim receipt are committed and read back through Mail, and the receipt agrees with the RSVP on ID, counts and times; publishing the same CloudEvents `id` again is deduplicated and Mail still holds one message for it.
- This script replaces the proposal's acceptance command `npm run app:verify -- --app apps/stoopside --with examples/apps/mail`, because `app:verify --with` loads Mail but does not start Messaging.

## Permissions

`fixtures/policies.json` has four profiles. `scenario` allows only reads and `sandbox` allows every tool, matching the reference Apps. `browse` leaves out `posts.publish`, `events.confirm_change`, `rsvps.confirm` and `members.export`; `full` allows them. Stoopside keeps no approval state; the task harness picks the profile.

## Data

Three fixtures, listed in [`fixtures/index.json`](fixtures/index.json). Each has a seed, a binding, a companion Mail seed (`fixtures/mail/<key>.json`, the user's Mail 1.3.0 mailbox) and an example scenario (`examples/scenarios/<key>.json`). Only `fixtures/minimal.json` is the manifest seed; load the others with Infra's `env.load_seed`, passing `data`, the fixture's `binding`, `virtual_now` (its clock) and a bundle whose dataset names the fixture as its record source (as `tests/replay-checks.cjs` does).

| Fixture | Seed | Groups | Members (aliased) | Events | Sheets | RSVPs | Posts | Mail threads | Scenario events | Clock | Offset |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| Maple St | `minimal.json` | 4 | 64 (17) | 37 | 6 | 317 | 123 | 17 | 16 | 2027-03-01 09:00 | UTC-05:00 |
| Riverside | `riverside.json` | 3 | 70 (19) | 32 | 7 | 255 | 67 | 18 | 16 | 2026-04-20 09:00 | UTC-06:00 |
| Hillcrest | `hillcrest.json` | 4 | 82 (21) | 39 | 7 | 318 | 125 | 19 | 17 | 2026-11-18 09:00 | UTC-08:00 |

History starts in January 2025 in every fixture and runs to its clock, so it covers early 2026 (reviewer suggestion). Every fixture has a group where the user's latest RSVP, the one `rsvps.preview` pre-fills, is over 11 months old with guests and children: Maple St's school parents (2026-03-07, guests 1, children 2), Riverside's soccer families (2025-05-08, guests 1, children 2) and Hillcrest's library friends (2025-11-28, guests 1, children 2). Each also has a full event with a waitlist, a pending swap to the user, `hosts_only` and `event_guests` posts, an announcement, removed and departed members, and a member the user knows by another name who is not on a planning event (Birdie/Wren, Gwen/Wendy, Delia, whose retirement send-off is planned without her).

A member is **aliased** when the first word of their display name and their everyday first name are not prefixes of each other ("Wren" for Birdie, "Hal" for Harold; "Tom" for Tomasz is not aliased). Every aliased member has an agent-visible name link: their email in the user's member export (groups where the user is co-organizer or organizer), a post the user can see that uses both names, or a Mail message in the companion seed that uses both names.

The Riverside and Hillcrest fixtures come from [`scripts/fixture-builder.cjs`](scripts/fixture-builder.cjs) with the hand-written specs in [`scripts/fixtures/`](scripts/fixtures/) (people, groups, events, sheets, swaps, key posts and Mail threads); past RSVPs, background members' join dates and monthly background posts come from a fixed-seed generator. The Maple St Mail threads are in `scripts/fixtures/maple-street-mail.cjs`. The scenarios are hand-written. [`contribution/dataset.json`](contribution/dataset.json) records each fixture as a source, with the SHA-256 of its seed, binding, Mail seed and scenario and its counts.

**Fixture checker.** [`scripts/check-fixtures.cjs`](scripts/check-fixtures.cjs) (`npm run check:fixtures`, also a business test) runs nine checks per fixture: shape (3-4 groups, 60-90 members with 20-35% aliased, 25-40 events, 6-10 sheets, 15-25 Mail threads, 12-20 scenario events); seed schema and `validateSeed`; unique IDs (per collection, across object types, slots, emails, person IDs, Mail messages, scenario events, commit sequence numbers); ordered dates (history from 2025-01-01 to the clock, clock and scenario events from 2026-01-01, revisions, threads, commit order and scenario events in time order, consistent event times); capacity arithmetic (places taken within capacity, guests within the limit, no waitlisted RSVP that would fit, sheet claims within quantity); emails matching the Mail seed (the mailbox address is the user's member email, every `@example.net` address is a member's email, every message is to or from the user); a name link for every aliased member; a stale default RSVP over 11 months old; and the scenario applying in order. A test breaks a copy of a fixture for each check and confirms the checker catches it.

### Maple St

[`fixtures/minimal.json`](fixtures/minimal.json) is one account (Dana Okafor, member `m-001`) on a fictional Maple St: four groups, 64 members (about a quarter with a display name unlike their everyday name, such as Wren Adeyemi, whom Dana calls Birdie), 37 events (30 past, 7 upcoming), 317 RSVPs, 123 posts and comments, 6 sign-up sheets and two swaps. History runs from 2025-01-06 to the clock, 2027-03-01 09:00 EST. A business test fails if any date in any fixture, binding, Mail seed or scenario is before 2025-01-01, or a clock or scenario event is before 2026-01-01. Dana's latest RSVP in the school parents' group is a year old (guests 1, children 2), which `rsvps.preview` pre-fills. Deliveries are recorded for posts from 2027-01-01 on; older notification history was not imported.

The fixture, [`fixtures/binding.json`](fixtures/binding.json) and the hashes in [`contribution/dataset.json`](contribution/dataset.json) come from [`scripts/generate-fixture.cjs`](scripts/generate-fixture.cjs): people, groups, upcoming events, sheets and the posts the checks rely on are written out by hand there; past RSVPs and monthly background posts come from a fixed-seed generator. [`scripts/build-schemas.cjs`](scripts/build-schemas.cjs) generates the seed and event schemas and `tools.json`. A business test fails if any generated file is out of date. No real group, person or post is used.

## Checks

| Check | Where | Status |
| :--- | :--- | :--- |
| Business rules and every named error, workflows 1-5 | `tests/business.test.cjs` | M1 |
| (a) Anchor runs: each reference passes every check; do-nothing fails exactly the checks that need a write; each wrong run fails its named check or returns its named error (group post after an empty everyday-name search, the same post deleted, pre-filled counts confirmed, late claim, host edit notified to `group`, unanswered swap, `view_as` trusted after a delivery) | `tests/business.test.cjs` with `tests/checks.cjs` | M1 |
| (b) Mutation: each anchor reference run with one step changed (15 mutations: 6 writes dropped, 2 audiences widened, 2 counts changed, 5 deadlines passed) fails at least its targeted check; every outcome, error and extra flip is recorded with an explanation in `tests/mutations.json` and recomputed by the test | `tests/mutation.test.cjs` | M2 |
| (c) Contracts: role-by-operation matrix | `tests/business.test.cjs` | M1 |
| (c) Contracts: retried and conflicting `request_id`, `stale_version`, consumed previews; the `browse` profile refusing the four gated tools with the state hash unchanged | `tests/platform-checks.cjs` | M1 |
| (d) Reset: 20 cycles after a write that leaves a notice restore the loaded state hash and visibility-record hash, with no outgoing notice left; Mail untouched | `tests/platform-checks.cjs` | M1 |
| (e) Replay through real Core over each fixture's full scenario: one clock jump, 5-hour `env.advance_time` steps with a read after each, and the same steps with a write after each, give byte-identical business data, deliveries, notices and visibility record | `tests/replay-checks.cjs` (and the M1 single-event comparison in `tests/business.test.cjs` and `tests/platform-checks.cjs`) | M2 |
| (f) Visibility table, hand-written before the function | `tests/business.test.cjs` | M1 |
| (f) Invariants on every fixture after its scenario: each `hosts_only` interval starts while the member holds a host role (or wrote the post); no interval opens or stays open for a removed member after the removal; the record's open intervals equal `canSee` now for every member and object | `tests/fixtures.test.cjs` | M2 |
| (g) Hidden values on every fixture, before, halfway through and after its scenario: every read tool over every reachable object, `view_as` for a spread of members, and the three previews; no output contains a pending event's text, names or IDs, a `person_id`, the everyday name of a member whose display name differs, or an email outside `members.export`. `src/` uses no random or wall-clock value, and IDs encode no role | `tests/fixtures.test.cjs` | M2 |
| Fixture checker on every fixture, and a broken copy for each check | `scripts/check-fixtures.cjs`, `tests/fixtures.test.cjs` | M2 |
| Companion Mail seeds load into Mail 1.3.0 and read back with `mail.get` | `tests/replay-checks.cjs` | M2 |
| Mail delivery: committed, rejected without a grant, retried | `examples/publish-to-mail.cjs` | M1 |
| Pages: all eight in Chromium against the tool results | `tests/web-checks.cjs` | M2 |
| Public verifier (MCP discovery, schemas, history load, event, reset, isolation, restart) | `npm run app:verify` | M1, rerun in M2 |
| (h) Independent reproduction by a second person | | M3 |

## Deviations and clarifications

These follow from the runtime or fill in details the proposal left open; none changes a workflow.

- Groups use a fixed UTC offset with no daylight-saving change, so times convert without a time-zone database.
- Visibility intervals are bounded by commit sequence numbers, because Agent writes do not move the clock; "any non-zero interval" means any interval that spans a committed state.
- `rsvps.preview` answers `claim_expired` for an expired offer unless `rejoin_waitlist` is set, so a late claim gets its named error instead of a quiet re-waitlist.
- Extra error codes beyond the proposal's list: `notify_required` (a move without a notify choice), `preview_consumed`, `invalid_state`, `invalid_arguments` and `not_found`.
- `notify: guests` and cancellations reach every open RSVP (`yes`, `needs_reconfirm`, `offered`, `waitlist`). The `event_guests` audience also includes the event's hosts.
- Posts and comments notify their audience in the app (`in_app` deliveries, no Mail notice); announcements, event changes, offers, swaps and the digest go by email. The digest is created only for weeks that have posts.
- `guest_limit` caps guests; children are not capped but take places.
- The acceptance command for Mail is `examples/publish-to-mail.cjs` (see above), not `app:verify --with`.
- `examples/timeline.json` (9 events, one per operation except `swap.answered`) stays as the M1 example; each fixture's 12-20 event scenario is in `examples/scenarios/`. `swap.answered` is not in them because it needs a swap the user proposed during the run; a business test covers it.
- The companion Mail seed exists for every fixture, not only one.
- **Registry entry in its own commit.** The repository's `apps.registry.json` gets a Stoopside entry in a separate final commit that changes nothing else. With it, the repository suite's `clock-contract` stage fails: `runtime/tests/clock.test.cjs` asserts that the registry has exactly seven Apps, and a submission may not change runtime tests. Without that commit every stage passes. Either way the Web Host demo uses `web.registry.json` (see Pages), because the shared `initial_time` is earlier than the Maple St clock.
- (e) also runs a third mode, small steps with a write after each step, so due items are committed at each step rather than at the next event; it gives the same hashes.

## Remaining work

- Check (h): a clean-checkout reproduction by a second person who did not implement the flows, named before M3.
- The repository registry entry passes the full suite only once the runtime's clock test no longer pins seven Apps (see Deviations).
- A human read of every member and event row in the two new fixtures (`dataset.json` review status is `pending`).

## Dependencies

Public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. `required_apps` is empty: the package runs with only its own files and the runtime. Mail 1.3.0 is an optional publish target, reached only through Messaging; Calendar 1.3.0 is not used. Code is MIT; fixtures and generated text are CC0.
