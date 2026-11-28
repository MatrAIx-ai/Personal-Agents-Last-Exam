# Stoopside

Stoopside is a resettable community-groups App with synthetic data, built for the approved proposal in [#26](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/26) ([`proposals/environment/stoopside.md`](../../proposals/environment/stoopside.md)). Groups have roles, capped events with RSVPs that carry guest and child counts, posts with an audience, and sign-up sheets. Stoopside records who was shown or sent what, so a task about who learns what can be checked from state without a judge. Group, role, event, RSVP and waitlist structure follow Meetup's public help pages; the claim window, post audiences, child counts, sign-up sheets, member export and view-as are Stoopside's own rules.

**Delivery evidence:** [`evidence/README.md`](evidence/README.md) is the evidence index (Meetup reference screenshots, implementation screenshot sequences, Mail dependency row) and [`evidence/coverage.md`](evidence/coverage.md) is the dataset coverage report, both per `docs/submission-evidence.md`.

This is the **second version (M2)**, with the fixes from the implementation review of 2026-11-28 and its two follow-ups. M1 delivered workflows 1-5 through 25 MCP tools, the visibility function with its hand-written table, one fixture, reset, business tests, checks (a), (c) and (d), and a host-side publisher that delivers notices to Mail. M2 adds the eight business pages on the shared Web Host, two more fixtures, a companion Mail seed and an example scenario for every fixture, the fixture checker, and checks (b), (e), (f) on every fixture and (g). Check (h), an independent reproduction, is M3 (see [Remaining work](#remaining-work)).

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
node apps/stoopside/scripts/web-fixture.cjs maple-street   # Maple St at its clock, 2027-03-01 09:00 EST (npm run web)
node apps/stoopside/scripts/web-fixture.cjs hillcrest      # Hillcrest, the manifest seed, at 2026-11-18 09:00 PST (npm run web:hillcrest)
node apps/stoopside/tests/web-checks.cjs                   # add --evidence to rewrite evidence/screens/

# Dataset coverage report (from apps/stoopside): rewrite, or check the committed one
node scripts/coverage-report.cjs
node scripts/coverage-report.cjs --check

# Regenerate fixtures, bindings, Mail seeds, dataset hashes, schemas and tools.json after editing their sources
npm run generate
```

## Workflows

Every tool name carries the `stoopside.` prefix. Writes take `expected_version` and `request_id`. Core returns `stale_version` for a stale version and `idempotency_conflict` for a reused request ID with different arguments; a retried write with the same request ID returns the original receipt. A write that notifies several members or commits other people (event changes, RSVPs, posts) is a preview listing every recipient, then a confirm with a receipt. A preview expires after 15 simulated minutes (`preview_expired`), and confirming fails with `preview_stale` if anything it read has changed. Other writes are single calls.

| # | Workflow | Tools | Errors |
| :--- | :--- | :--- | :--- |
| 1 | Groups and membership. `pending` to `member` or `declined`; `member` to `left` or `removed`. Roles: organizer, co-organizer, event host, member. Members see member ID, display name, bio and role; emails appear only in `members.export` (co-organizer and above). Search matches parts of display names and bios only. `hide_from_member_list` limits search to organizers and co-organizers; `hide_rsvps` limits guest lists to the event's hosts, co-organizers and organizers. Leaving withdraws a pending request, or sets upcoming RSVPs in the group to `no`, releases sign-up slots and withdraws open swaps. | `groups.list`, `groups.get`, `groups.join`, `groups.leave`, `members.search`, `members.export`, `profile.get`, `profile.update` | `not_member`, `role_required`, `approval_pending`, `sole_organizer`, `sole_host` |
| 2 | Events and RSVPs. Hosts create, edit and cancel events (`published` to `cancelled`; `past` once the event ends). Each person takes one place; `guest_limit` caps guests. `rsvps.preview` pre-fills guests and children from the user's latest RSVP in that group when they are left out, and shows which RSVP and when; if a pre-filled guest count breaks the guest limit, the `guest_limit_exceeded` message names that RSVP too. A yes that does not fit goes on the waitlist. A freed place is offered for 24 hours, or until RSVPs close, to the earliest waitlisted RSVP that fits, then to the next. Moving the date, time or venue needs `notify: guests` (every open RSVP) or `group`, and flips each `yes` to `needs_reconfirm`, which holds the place for 48 hours (or until the event starts) and then becomes `no`. Cancelling notifies every open RSVP, locks sheets and cannot be undone. | `events.list`, `events.get`, `events.preview_change`, `events.confirm_change`, `rsvps.preview`, `rsvps.confirm` | `rsvp_not_open`, `rsvp_closed`, `guest_limit_exceeded`, `claim_expired`, `capacity_below_yes`, `notify_required` |
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
| Group home with discovery | `#/groups`, `#/group/<id>` | `groups.list`, `groups.get`, `groups.join`, `groups.leave`, `events.list`, `posts.list`, `posts.delete` | yes |
| Member directory | `#/members/<group>` | `members.search`, `members.export` | |
| Event | `#/event/<id>` | `events.get`, `posts.list`, `rsvps.preview`, `rsvps.confirm` | yes |
| Change preview | `#/change/<new\|edit\|cancel>/<id>` | `events.get`, `events.preview_change`, `events.confirm_change` | |
| Post composer | `#/compose/<group>[/<post\|comment\|edit\|event>/<id>]` | `groups.get`, `events.list`, `posts.preview`, `posts.publish` | |
| Sheet | `#/sheet/<id>` | `signups.get`, `events.get`, `signups.claim`, `signups.release`, `signups.swap_propose`, `signups.swap_answer` | yes |
| Profile | `#/profile` | `profile.get`, `profile.update` | |
| Help | `#/help` | `help.get` | |

Every value on a page is a tool result. Events, groups, posts, members and slots are cards with the name first and IDs as small secondary text; times are shown in the group's zone in a US format with the zone ("Sat, Mar 20, 2027, 4:00 PM EST"). A preview is a set of labelled sentences (what changes, the outcome, every recipient by name, where pre-filled RSVP counts came from) with Confirm and Cancel. A receipt stays on the page the user lands on, across the re-render that follows a confirm, until they move to another page; an error stays next to the form that caused it, with the tool's code. Delete post and leave group ask first, inline. Controls that are certain to fail are not shown: Claim on a full slot, the user's own slots as a swap target, Edit on other members' posts, role-gated links (create, edit or cancel an event, announcements, export, a hidden member list) for a role that cannot use them, and every write control the run's profile does not list (the `scenario` profile is read-only). The role check reads the user's role from `groups.list`; the tools still enforce every rule. The page keeps no business state; Refresh re-reads. A write sends the version the page last read (`stale_version` asks for a refresh) and reuses its request ID if the same write is retried. View-as lists members already visible on the page and shows `visibility.view_as`'s answer. App-owned text is at least 12px (body 14px): the Host allows no inline styles, so `app.js` adds its rules as a constructed stylesheet over the shared one. There are no images or icons; the brand mark is a text letter styled by the shared stylesheet.

**Clock.** Core starts a new instance from the manifest seed at the registry's `initial_time`, and a seed never loads at a clock earlier than its own history (see [Data](#data)). The manifest seed is the Hillcrest fixture, whose clock (2026-11-18 09:00 PST) is the shared `apps.registry.json` time, so Stoopside starts under the shared registry with nothing dated in its future. [`scripts/web-fixture.cjs`](scripts/web-fixture.cjs) starts the Host on a fixture at its own clock: `hillcrest` with [`web.hillcrest.registry.json`](web.hillcrest.registry.json), and `maple-street` with [`web.registry.json`](web.registry.json) (2027-03-01 09:00 EST), after which it loads Maple St through Infra's `env.load_seed` ([`scripts/load-fixture.cjs`](scripts/load-fixture.cjs)). The browser checks run on Maple St the same way.

[`tests/web-checks.cjs`](tests/web-checks.cjs) (85 checks) opens all eight pages in Chromium, compares what they show with the tool results over MCP, and drives every write through the pages: join and leave (with its confirmation), member search and export, an RSVP preview with pre-filled counts, Cancel, and a confirm with explicit counts, the `guest_limit_exceeded` error with its pre-fill source, a venue move with `notify_required` first and then notified to guests, a confirm made stale by an independent MCP edit, an event created and cancelled, a post with `audience_required` first and then to an event's guests, a delete with its confirmation, a slot release and a swap accept, a waitlist offer from an Infra event claimed through the page, and a profile edit. It checks that bad input (a negative or fractional guest count, an empty post, an empty display name) is refused on the page in its own words, that the landing page lists what waits for the user's answer (here a pending swap, with a link to its sheet), and that muted text has at least 4.5:1 contrast. It checks the committed state with an Infra snapshot after each write, reloads, checks that receipts survive the re-render, that no visible text is below 12px and no raw ISO time is shown, that the controls listed above are hidden, that a `scenario` (read-only) run shows no write control, that `not_found` changes the page title, that a management call from the page is refused, that a 390-pixel viewport has no horizontal overflow, that the Hillcrest run shows its own groups in PST, and that there are no JavaScript errors. With `--evidence` it also writes the curated screenshots and their manifest to [`evidence/screens/`](evidence/screens/).

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

[`examples/scenario.json`](examples/scenario.json) is a valid event for the manifest seed (Hillcrest's first scenario event), which the public verifier applies. [`examples/maple-street-event.json`](examples/maple-street-event.json) is the Maple St example (a guest drops out of the full Spring potluck); [`examples/run.cjs`](examples/run.cjs) applies it and claims the offered place for one. [`examples/timeline.json`](examples/timeline.json) lists one example of each event except `swap.answered` (which needs a swap the user proposed), in time order; a business test applies it.

## Notices and Mail

The user's notices (waitlist offers, event changes and cancellations, announcements, the digest, membership decisions, swaps, and receipts for RSVPs, posts and event changes) are stored in `notices` in the same commit as the business change. Each holds a full CloudEvents message for Mail 1.3.0's `channel.email` receive contract (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), with the notice ID as the CloudEvents `id`, plain text and no assets. Every commit validates these messages against a pinned copy of Mail's wire schema ([`schemas/router-message.schema.json`](schemas/router-message.schema.json)); the publish direction is declared in `contribution/contribution.json`. Deliveries to other members stay in Stoopside's history and are never sent anywhere.

There is no host-side publisher on main, so the package ships one: [`examples/publish-to-mail.cjs`](examples/publish-to-mail.cjs), with its trusted Messaging config [`examples/publish-to-mail.config.json`](examples/publish-to-mail.config.json) (publisher `stoopside`, account `st-dana`, one grant for `mail/mail-dana` on `channel.email`). It starts Stoopside and Mail under real Core, starts `runtime/messaging/service.cjs --publisher stoopside`, calls `router.publish` and reads each message back with Mail's `mail.get` using `receipt.event_id`.

- **When it runs:** after each committed write or event that creates a notice, and before Infra's next `env.advance_time`. Infra first brings Mail's clock up to Stoopside's.
- **Which notices are new:** Stoopside does not record delivery. The publisher keeps its own list of the notice IDs it has published in the run; a notice in the latest result or `env.snapshot` whose ID is not on that list is new. Notices are append-only between resets and their IDs are counters.
- **Outcomes it shows:** a delivery staged with no grant for the user's Mail account is rejected (`recipient_not_authorized`) with Mail and Stoopside unchanged; with the grant, the waitlist offer and the claim receipt are committed and read back through Mail, and the receipt agrees with the RSVP on ID, counts and times; publishing the same CloudEvents `id` again is deduplicated and Mail still holds one message for it; and an **unknown acknowledgement** stops the run for reconciliation, as the proposal promises. To stage it without changing `runtime/`, the script replaces the Router's receipt log in its state directory with a directory, so the Router cannot record the acknowledgement after Mail commits and answers `unknown` / `receipt_audit_failed` with `stop_run`. The publisher then stops, does not mark the notice delivered, sees `halted` / `run_halted` on any further publish, and reconciles by reading Mail with `mail.get` on the reported `event_id` (one message for the notice). The run is not scored. Recipient or business confirmation is not applicable: every notice goes to the user's own mailbox.
- **Required public dependency:** the script and its trusted config read the repository-level [`examples/registry.mail.json`](../../examples/registry.mail.json) (Mail 1.3.0 at `examples/apps/mail`). A copy holding only this package, the runtime and Mail needs that file too. The Mail row of the evidence index records revisions, requests, receipts and Mail message IDs.
- This script replaces the proposal's acceptance command `npm run app:verify -- --app apps/stoopside --with examples/apps/mail`, because `app:verify --with` loads Mail but does not start Messaging.

## Permissions

`fixtures/policies.json` has four profiles. `scenario` allows only reads and `sandbox` allows every tool, matching the reference Apps. `browse` leaves out `posts.publish`, `events.confirm_change`, `rsvps.confirm` and `members.export`; `full` allows them. Stoopside keeps no approval state; the task harness picks the profile.

## Data

Three fixtures, listed in [`fixtures/index.json`](fixtures/index.json). Each has a seed, a binding, a companion Mail seed (`fixtures/mail/<key>.json`, the user's Mail 1.3.0 mailbox) and an example scenario (`examples/scenarios/<key>.json`). The manifest seed (`app.json`) is `fixtures/hillcrest.json`; load the others with Infra's `env.load_seed`, passing `data`, the fixture's `binding`, `virtual_now` (its clock) and a bundle whose dataset names the fixture as its record source ([`scripts/load-fixture.cjs`](scripts/load-fixture.cjs) builds these arguments).

**Clocks and cut-offs.** `validateSeed` refuses a load whose clock is earlier than any row of the seed's history (a member, membership, event, RSVP, post, sheet claim, swap, delivery or notice dated after it) with `invalid_seed`, so the Agent never sees records from its own future. Each fixture is the account at its clock; for an earlier start inside the window, build a cut-off: `node scripts/generate-fixture.cjs --cutoff <fixture> <instant> [--out DIR]` writes the seed, binding and Mail seed as they stood at that instant ([`scripts/cutoff.cjs`](scripts/cutoff.cjs)). Records created later are dropped, kept records lose later revisions (an edited event gets its earlier times back, sheet claims are replayed, a swap answered later is still proposed), and events that start after the instant are upcoming. A test cuts every fixture at six clocks from 2025-09-15 to 2026-11-16 and runs the history checks on each cut, and a cut at a fixture's own clock reproduces the fixture byte for byte. How much is open at a cut depends on the event calendar (each fixture has 25 to 40 events, per the proposal), so `--scan <fixture>` lists, week by week, the open RSVPs, unlocked sheets and pending swaps a cut there would leave. In-window clocks with work to do include Riverside's own (2026-04-20) and Hillcrest's own (2026-11-18), and cuts at Maple St 2026-06-15 (two open RSVPs, two sheets), Riverside 2026-01-20 and 2026-03-10 (three open RSVPs each) and Hillcrest 2026-01-20, 2026-03-10 and 2026-09-01; a test keeps those open. A clock later than a fixture's own loads, but its events are all past.

| Fixture | Seed | Groups | Members (aliased) | Events | Sheets | RSVPs | Posts | Mail threads | Scenario events | Clock | Offset |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| Maple St | `minimal.json` | 4 | 64 (17) | 37 | 6 | 443 | 183 | 23 | 16 | 2027-03-01 09:00 | UTC-05:00 |
| Riverside | `riverside.json` | 3 | 70 (19) | 32 | 7 | 314 | 99 | 18 | 16 | 2026-04-20 09:00 | UTC-06:00 |
| Hillcrest (manifest) | `hillcrest.json` | 4 | 82 (21) | 39 | 7 | 375 | 157 | 19 | 17 | 2026-11-18 09:00 | UTC-08:00 |

History starts in January 2025 in every fixture and runs to its clock. **Coverage of 2025-01-01 to 2026-12-31** is reported by month and source in [`evidence/coverage.md`](evidence/coverage.md) (script [`scripts/coverage-report.cjs`](scripts/coverage-report.cjs), counting zone `Etc/GMT+5`, a test fails if the committed report is stale). Maple St is the full-window source: every month of 2025 and 2026 has history (428 distinct dates; 618 across the three fixtures). Riverside and Hillcrest are bounded by their clocks by design (2026-04-20 and 2026-11-18): a fixture has no history after its clock, so their later months hold only scheduled events or nothing. Six Maple St Mail threads were added in its thinnest months (July 2025, January, July and December 2026). **Provenance:** every record is synthetic; nothing is collected from Meetup or any real group, and there is no real-data anchor. The generator scripts and their hand-written text were written with AI assistance (no model runs at generation time); the human read of every member and event row is still pending (`contribution/dataset.json`, `review.status: pending`). Every fixture has a group where the user's latest RSVP, the one `rsvps.preview` pre-fills, is over 11 months old with guests and children: Maple St's school parents (2026-03-07, guests 1, children 2), Riverside's soccer families (2025-05-08, guests 1, children 2) and Hillcrest's library friends (2025-11-28, guests 1, children 2). Each also has a full event with a waitlist, a pending swap to the user, `hosts_only` and `event_guests` posts, an announcement, removed and departed members, and a member the user knows by another name who is not on a planning event (Birdie/Wren, Gwen/Wendy, Delia, whose retirement send-off is planned without her).

A member is **aliased** when the first word of their display name and their everyday first name are not prefixes of each other ("Wren" for Birdie, "Hal" for Harold; "Tom" for Tomasz is not aliased). Every aliased member has an agent-visible name link: their email in the user's member export (groups where the user is co-organizer or organizer), a post the user can see that uses both names, or a Mail message in the companion seed that uses both names.

The Riverside and Hillcrest fixtures come from [`scripts/fixture-builder.cjs`](scripts/fixture-builder.cjs) with the hand-written specs in [`scripts/fixtures/`](scripts/fixtures/) (people, groups, events, sheets, swaps, key posts and Mail threads) and the hand-written text files in [`scripts/fixtures/text/`](scripts/fixtures/text/) (background post texts by group and month of year, a reply pool, a description for every past event and a few post edits; each text is used once). A fixed-seed generator draws past RSVPs, background members' join dates, event lead times and RSVP windows, and background post dates and authors ([`scripts/history.cjs`](scripts/history.cjs) holds the parts shared with the Maple St generator). A group gets 0 to 3 background posts a month on any day of the month, more in its busy season; about a third of posts get replies, some a thread of two or three, sometimes with the author answering. Past events draw answers in proportion to their size and to the members the group had while RSVPs were open (a 200-place block party in a 35-member association draws most of it). About half the plain members join in a group's first months and the rest at any time up to a few weeks before the clock; a join is moved earlier when a hand-written row shows the member acting first. History changes after the fact: about one past answer in eight is revised (a yes becomes a no, a guest is added or dropped), a few posts are edited by their authors and a few deleted, two past events per fixture are moved by half an hour or an hour with the guests told, and one small past event is cancelled after its last answer. Times are drawn at minute resolution from a waking-hours distribution (almost nothing between midnight and 6 am, peaks at lunch and in the evening); events are posted 7 to 30 days ahead (24 to 55 for events of 80 or more), RSVPs open when the event is posted or a few days later and close 2 to 48 hours before the start; most answers come in the first days and a smaller wave near the close. A business test per fixture fails if more than a fifth of RSVPs, joins or posts fall on the hour, more than 3% fall between midnight and 7 am, fewer than 12 distinct lead times appear, or any post text or event description repeats; another fails if most group-months have exactly one post, no month has three, no post falls on days 28 to 31, fewer than five threads have two replies, or no answer, post or event changes. The Maple St Mail threads are in `scripts/fixtures/maple-street-mail.cjs`. The scenarios are hand-written. [`contribution/dataset.json`](contribution/dataset.json) records each fixture as a source, with the SHA-256 of its seed, binding, Mail seed and scenario and its counts.

**Fixture checker.** [`scripts/check-fixtures.cjs`](scripts/check-fixtures.cjs) (`npm run check:fixtures`, also a business test) runs ten checks per fixture: shape (3-4 groups, 60-90 members with 20-35% aliased, 25-40 events, 6-10 sheets, 15-25 Mail threads, 12-20 scenario events); seed schema and `validateSeed`; unique IDs (per collection, across object types, slots, emails, person IDs, Mail messages, scenario events, commit sequence numbers); ordered dates (history from 2025-01-01 to the clock, clock and scenario events from 2026-01-01, revisions, threads, commit order and scenario events in time order, consistent event times); coherent history (nobody answers, claims, posts or hosts in a group before joining it or after leaving it; an event is posted after its group exists, by a member, before its RSVPs open; RSVPs fall inside the RSVP window and not after a cancellation; claims fall between the posting and the lock; a swap trades slots both sides held); capacity arithmetic (places taken within capacity, guests within the limit, no waitlisted RSVP that would fit, sheet claims within quantity); emails matching the Mail seed (the mailbox address is the user's member email, every `@example.net` address is a member's email, every message is to or from the user); a name link for every aliased member; a stale default RSVP over 11 months old; and the scenario applying in order. A test breaks a copy of a fixture for each check and confirms the checker catches it.

### Maple St

[`fixtures/minimal.json`](fixtures/minimal.json) is one account (Dana Okafor, member `m-001`) on a fictional Maple St: four groups, 64 members (about a quarter with a display name unlike their everyday name, such as Wren Adeyemi, whom Dana calls Birdie), 37 events (30 past, 7 upcoming), 443 RSVPs, 183 posts and comments, 6 sign-up sheets and two swaps. History runs from 2025-01-06 to the clock, 2027-03-01 09:00 EST. A business test fails if any date in any fixture, binding, Mail seed or scenario is before 2025-01-01, or a clock or scenario event is before 2026-01-01. Dana's latest RSVP in the school parents' group is a year old (guests 1, children 2), which `rsvps.preview` pre-fills. Deliveries are recorded for posts from 2027-01-01 on; older notification history was not imported.

The fixture, [`fixtures/binding.json`](fixtures/binding.json) and the hashes in [`contribution/dataset.json`](contribution/dataset.json) come from [`scripts/generate-fixture.cjs`](scripts/generate-fixture.cjs): people, groups, upcoming events, sheets and the posts the checks rely on are written out by hand there, with the background texts, replies, past-event descriptions and post edits in [`scripts/fixtures/text/maple-street.json`](scripts/fixtures/text/maple-street.json); the generator uses the same time and history helpers as the builder. [`scripts/build-schemas.cjs`](scripts/build-schemas.cjs) generates the seed and event schemas and `tools.json`. A business test fails if any generated file is out of date. No real group, person or post is used.

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
| A load before the seed's history is refused; cut-offs at six in-window clocks pass the history checks; a cut at the clock reproduces the fixture | `tests/fixtures.test.cjs` | review |
| Companion Mail seeds load into Mail 1.3.0 and read back with `mail.get` | `tests/replay-checks.cjs` | M2 |
| Mail delivery: committed, rejected without a grant, retried | `examples/publish-to-mail.cjs` | M1 |
| Pages: all eight in Chromium against the tool results, error, cancel, stale and read-only paths, text size, receipts after re-render, bad input, contrast (85 checks) | `tests/web-checks.cjs` | M2, extended in review |
| Mail delivery: unknown acknowledgement stops the run and is reconciled | `examples/publish-to-mail.cjs` | review |
| Dataset coverage report matches a fresh run | `tests/fixtures.test.cjs`, `scripts/coverage-report.cjs --check` | review |
| Public verifier (MCP discovery, schemas, history load, event, reset, isolation, restart) | `npm run app:verify` | M1, rerun in M2 |
| (h) Independent reproduction by a second person | | M3, in progress |

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
- **Registry entry in its own commit.** The repository's `apps.registry.json` gets a Stoopside entry in a separate commit that changes nothing else, held on the local branch `st-registry-entry` until a maintainer answers the question in [#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25#issuecomment-7125189336). With it, the repository suite's `clock-contract` stage fails: `runtime/tests/clock.test.cjs` asserts that the registry has exactly seven Apps, and a submission may not change runtime tests. Without that commit every stage passes. Under the shared registry Stoopside starts from the Hillcrest manifest seed at its own clock.
- (e) also runs a third mode, small steps with a write after each step, so due items are committed at each step rather than at the next event; it gives the same hashes.

## Remaining work

- Check (h): a clean-checkout reproduction by a second person who did not implement the flows (in progress).
- A human read of every member and event row in Riverside and Hillcrest by Rohan Pandey (in progress; `dataset.json` review status stays `pending` until it is done).
- The repository registry entry passes the full suite only once the runtime's clock test no longer pins seven Apps (see Deviations); waiting for a maintainer decision in #25.
- Signed-in Meetup reference screens (RSVP and waitlist dialogs, organizer tools, a discussion post): to be captured by the author with a test account, personal data masked (see the evidence index).

## Dependencies

Public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. `required_apps` is empty: the package runs with only its own files and the runtime. Mail 1.3.0 is an optional publish target, reached only through Messaging; Calendar 1.3.0 is not used. The Mail publisher example also needs the public repository file `examples/registry.mail.json`. The browser checks and evidence scripts need the repository's pinned Playwright and Chromium. Code is MIT; fixtures and generated text are CC0. The Meetup screenshots under `evidence/reference/` belong to their owners and are not covered by this license (see its NOTICE.md).
