# Belltower

Belltower is a synthetic local-news reader for PALE. Several local outlets and official notice feeds arrive in one account. Every item has a source, every change to an item is a numbered revision (an update, a correction or a retraction) that stays readable, and every republished copy says which revision of which item it copied. So the right answer depends on which version this person read, saved or passed on. It follows the Environment proposal `proposals/environment/belltower.md` (PR #172). All data is invented; there is no real outlet, place, person or event.

Status: version 1.0.0, the first-version submission for PR #172, on public runtime 1.6.0. All four workflows of the approved plan, the four events, the optional Mail notifications, the web pages and the tests are in place. The evidence report is `docs/validation/belltower-v1.0.0.md`; what remains is listed under "Remaining work".

## Run locally

Node.js 18 or later. No package installation, credentials, GPU or network.

```sh
cd apps/belltower
npm test            # App-only business tests (node --test tests/business.test.cjs)
npm run example     # one declared event changing state, with the package fixture
```

Both run from a copy of this folder alone. Against the public reference runtime (1.6.0 or later), from the repository root:

```sh
npm run app:verify -- --app apps/belltower --output .artifacts/belltower.json
node apps/belltower/tests/mcp.integration.cjs --runtime runtime     # every tool, the Core contracts and env.advance_time through real MCP
node apps/belltower/tests/mail.integration.cjs --runtime runtime    # Belltower -> Messaging -> real Mail
```

Both scripts take `--report FILE` to write their check names and versions as JSON.

The web pages (see "Web pages" below), from the repository root:

```sh
node apps/belltower/examples/web.cjs --runtime runtime      # starts the public Web Host on a fresh copy of the fixture; open the printed link
npm ci && npx playwright install chromium                  # once: the checkout's pinned browser-test dependency
node apps/belltower/tests/web.browser.cjs --runtime runtime  # browser checks; --chrome PATH uses an installed Chrome
```

The two scripts are given the runtime directory (`--runtime DIR`, or `PALE_RUNTIME_ROOT=DIR`); the first needs nothing else. The Mail flow also needs this package and the pinned Mail package inside that checkout, because the public Messaging router resolves a publisher package and its receiver registry relative to its own checkout. With `PALE_RUNTIME_ROOT` set, `npm test` runs both scripts as T17 and T16b; without it they are skipped and say so.

## What it does

| Workflow | Tools (`belltower.` prefix) |
| --- | --- |
| W1 Following and preferences | `follows.list`, `follows.create`, `follows.update`, `follows.remove`, `preferences.get`, `preferences.update` |
| W2 Evidence (read-only) | `sources.list`, `areas.list`, `items.list`, `items.get` |
| W3 Reading record and clippings | `reading.list`, `reading.mark`, `clippings.list`, `clippings.add`, `clippings.update`, `clippings.remove` |
| W4 Notifications and the digest | `notifications.list`; shaped through the W1 and W3 writes |

Nine tools read and eight write. Every write takes Core's `request_id` and `expected_version` and returns the object's `id`. The target object is always the argument `id` (an item, a follow rule or a clipping; for a new clipping or read mark, the item it is about) and a time window is always `start` / `end`. The Agent acts as the bound account holder; no argument names the account.

Content is whatever the task supplies. Belltower has no ranking, no recommendations and no fact-checking, and it never judges which source is right. One App instance holds one reader account. The account reads; it does not publish, comment or share.

### Time

Time is the environment's. Belltower has no timers, no scheduler and no clock event. Infra moves `virtual_now` with an event or with Core's `env.advance_time`, which runs no App code.

- Every time-based state is stored as a due time and read against `ctx.virtual_now`: a public notice's `effect` (`upcoming`, `in_effect`, `ended`) from its effective period, a notification's `held` or `released` from its `release_at`. Nothing is rewritten when a due time passes.
- An event is handled at its own `at`. That time becomes the revision's `received_at`; a held notification whose release time is after it can still be superseded; and a notification written then is held or released by the quiet hours and the digest time at that moment.
- The Infra-run sender uses the same derivation on the snapshot it reads.
- The App never reads the wall clock. Quiet hours and the digest time are wall times of the account's time zone (IANA names, through Node's built-in `Intl`).

### Rules worth knowing

Items and revisions

- A revision is named by its item and its number. Numbers run from 1 in the order the publisher issued them. Revision 1 is the `original`; a later one is an `update`, a `correction` (with the publisher's `note`) or a `retraction` (with the note and nothing else). Nothing follows a retraction.
- A revision's `published_at` is what its publisher states; `received_at` is when it reached Belltower. A revision cannot be published after it is received or before the revision it follows.
- An item is `retracted` when its latest revision is a retraction, otherwise `corrected` when any of its revisions is a correction, otherwise `current`.
- A retraction has no text of its own. Read as a revision, it shows the headline, topics, areas and priority of the revision before it, `body: null` and no effective period. The earlier revisions stay readable by number.
- Only a public notice has an `effective` period. `end: null` is an open-ended notice. Each revision is read with the period it announced.
- `based_on` is the publisher's own statement: one revision of another item, as a `copy` or a `report`. Belltower checks only that this revision exists when the link arrives. A copy published after its basis was corrected still names the revision it copied, and nothing in Belltower updates it. The item it names lists every such revision under `referenced_by`, each with `used_revision` and its own times. No read labels a copy as outdated, merges copies into one story or ranks sources.
- `items.get` returns the latest revision unless `revision` is given, and always says what it returned: `revision`, `type`, `is_latest`, with the list of all revisions.
- `items.list` shows each item as it stands now. The filters `start` / `end` (over `received_at`), `area_id`, `topic`, `min_priority` and `query` are checked against every revision, earlier ones included. An item is listed when at least one revision passes all of them, and `matched_revisions` names those revisions. So a claim that was later corrected is still found, and is shown as belonging to an earlier revision. The filters `source_id`, `kind`, `status` and `changed_since_read` are about the item.
- `query` is plain word matching in headline and body: letters and digits form words, every word of the query must appear as a whole word in one revision, in any letter case. A publisher's note is not searched.

Following

- A follow rule matches a revision when every filter the rule has is met: the item's source is in the rule's sources, one of the revision's topics is in its topics, the priority is at least `min_priority`, and one of the revision's areas overlaps one of the rule's areas. Two areas overlap when they are the same or one contains the other. A paused rule matches nothing. A retraction is matched with the topics, areas and priority of the revision before it.
- A rule needs at least one source, area or topic. Two rules with the same sources, areas, topics and minimum priority are the same rule, whatever their delivery (`already_following`). An account has at most 20 rules.
- A rule applies to what arrives after it. Nothing is notified for what was already published.

Reading record and clippings

- Reading an item never marks it. A read mark exists only when `reading.mark` is called or the seed has it, so the record says what the person was shown, not what the Agent looked up. `changed_since_read` is true when the item has a revision newer than the newest one marked.
- A clipping holds one revision of an item, with a note, an optional `linked_object` and a `watch` setting. An item has at most one clipping; an account has at most 100. A clipping is `behind` when its item has a newer revision. It can only move to a newer revision. Each earlier version of a clipping stays in its `history`. A patch that changes nothing is committed and adds no history row.
- `linked_object` is stored as given and never opened.

Notifications

- Whoever was told is told again. When a revision arrives, revision 1 included, the account gets exactly one notification if an active rule matches it, or the account already holds a notification for that item, or it watches a clipping of it. Otherwise it gets none. A read mark or an unwatched clipping alone brings none.
- The kind follows the revision: `item.published`, `item.updated`, `item.corrected`, `item.retracted`. `reasons` says why it was written (`follow`, `earlier_notification`, `watched_clipping`), and `matched_follow_ids` names the rules that match this revision, possibly none.
- Pausing or removing a rule, or ending a watch, stops discovery. It does not withdraw a notification that is already written, and it does not stop later revisions of an item the account was already told about: those still notify, with the reason `earlier_notification`. There is no opt-out for one item.
- Delivery is `immediate` when a matching rule is `immediate`, when the account watches a clipping of the item, when the item's previous notification was `immediate`, or when the revision is a correction or a retraction and `corrections` is `immediate`. Otherwise it is `digest`.
- An `immediate` notification written inside quiet hours gets the end of that quiet period as its release time, unless the revision is `urgent`. A `digest` notification gets the next daily digest time at or after the moment it is written; `urgent` does not change that. The digest time cannot lie inside the quiet hours.
- A replaced version is not put in front of the person. In the log: when a revision arrives while an earlier notification for the same item is still held, the earlier one becomes `superseded` and is never released, and the new one names it. A notification whose release time has been reached was released; it is left as it is and is followed by the new one. In Mail: see "Other Apps".
- Nothing is deleted or rewritten. Every notification stays in the log with its times and its state.

Errors

- App errors: `not_found`, `already_following`, `already_read`, `already_clipped`, `invalid_revision`, `invalid_window`, `invalid_timezone`, `limit_exceeded`. The App also answers `invalid_arguments` for what the input schema cannot express: an empty `patch`, a rule with no source, area or topic, quiet hours that start and end at the same time, a digest time inside the quiet hours, a query with no word in it, a cursor that is not a `next_cursor`. Events that would leave records inconsistent are rejected with `invalid_event`.

### Records for evaluators

- `data.activity`: one row for every committed Agent write, every applied event and every effect of an event (`notification.superseded`, `notification.created`), with sequence, virtual time, actor (`agent` or `event`), action, object ID and the `request_id` or `event_id` behind it. An event's own row comes first, then a superseded notification, then the notification written.
- `data.read_marks` with revision and time; each clipping's `history`; each notification with `created_at`, `release_at`, the revision it describes, `reasons`, `matched_follow_ids`, `supersedes` and `superseded_by`. A notification's `seq` is the sequence number of its activity row.
- A replay (the same `request_id` or `event_id` again) returns the stored receipt marked `duplicate` and writes nothing: no activity row and no audit row. Count it as a retry of the original.
- A rejected call writes no activity row; Core appends one denial audit row for each attempt.
- Time-driven changes (a notification released, a public notice coming into effect or ending) run no App code and write no row. Read them from the stored due times and the clock; Core's audit has one row for each `env.advance_time` with the clock before and after.
- Whether a notification has a Mail copy is read on the receiver's side: Mail's inbox records (their `thread_id` is the notification ID) and the sender's report. `email_prepared` only says that a message was prepared when the notification was written.

## Data and seeds

`fixtures/minimal.json` is a snapshot of an authored synthetic history: the invented city of Halden with 9 areas on three levels; 6 sources (2 official bodies, 2 newsrooms, 2 aggregators); 48 items with 70 revisions (12 public notices; 11 updates, 8 corrections, 3 retractions; 10 copies and 6 reports with `based_on`, three of them published after their basis was corrected); and one reader account with 5 follow rules, 14 read marks, 4 clippings (one behind its item, one with history) and 12 notifications (held, released and superseded). Its clock is Tuesday 17 November 2026, 17:00 in Chicago (`fixtures/clock.json`). The last step of that history is the correction the proposal gives as its example event, and its notification carries the proposal's example wire message. `dev/build-fixture.cjs` holds the authored content and rebuilds the fixture by replaying it through the App's own functions; `dev/check-fixture.cjs` checks it independently, without the App's code. The tests build their small variations from this fixture in code.

A task supplies its own records in the same shape (`schemas/seed.schema.json`) through `env.load_seed`, with its own `virtual_now`. The seed is history: everything in it has already been published and received, and new information arrives only through events. A seed stores no time-based state. No seed rule reads the clock, so a seed is valid or not whatever time it is loaded at. Besides references, unique IDs and timestamps with a UTC offset, the rules are:

- Areas form a tree of three levels (a city, its districts, their neighbourhoods). Preferences are valid as `preferences.update` would require. A follow rule has a source, an area or a topic, and no two rules have the same filters.
- Revisions are numbered from 1 in the order they were published and received, with the fields their type has. A `based_on` names a revision of another item that had been received by then.
- A read mark is not earlier than the revision it names. A clipping never holds a revision before it was received, and its history never moves back.
- The notification log follows the notification rules: a notification is created at the time its revision was received; once an item has one, every later revision has exactly one; the one before is superseded exactly when it was still held as the next was written; an immediate delivery stays immediate.

The App's rules answer `invalid_seed`. A shape the seed schema refuses (a timestamp without its UTC offset, an unknown topic, a stored `status` or `effect`) does not reach them on the host: Core checks `env.load_seed` against the schema first and answers `invalid_arguments`. Either way nothing is loaded. In the same way, an event that does not match `schemas/events.schema.json` is refused by Core with `invalid_arguments`, and an event the App's rules refuse with `invalid_event`.

Code and fixtures are under the repository's MIT License. Nothing was crawled, copied or imported. Three public references were used only for the shape of the workflows: the Atom syndication format for an entry's `published`, `updated` and `source` metadata (RFC 4287), schema.org's `correction` property for news articles, and Notify NYC for official notices by area and type. No articles, notices, feeds, logos or brand names are reused.

New IDs are `fl-NNNN`, `clp-NNNN` and `ntf-NNNN`: one more than the largest number in use, never an ID that another record has, and never the ID of a rule or clipping that was removed, because the logs still name it.

`tools.json` and the App-owned schemas are generated from `dev/contracts.cjs` (`node dev/build.cjs`, `--check` for drift). `dev/walk.cjs` is a seeded random walk over every write, every event and the clock. It has an oracle of its own for the notification rules, which shares no code with `src/`: before each event it works out whether a notification is due and with which delivery, release time and superseding, and compares that with what the App wrote. It fails if a read changes data, if a refused call changes anything, or if a call fails with anything but a documented error (`node dev/walk.cjs [first seed] [last seed] [steps]`; three short walks run with `npm test`). Nothing under `dev/` runs at run time.

## Web pages

The App owns its pages: `gui/index.html` and the controller `gui/src/app.js`, declared in `contribution/gui.json` through the `pale.web` extension and served by the public Web Host (`runtime/web/server.cjs`), which forwards only the Agent's permitted tools. Nothing on the page is stored outside the App; every value is read through those tools, and the browser clock is never used for a business decision. Times are shown in the account's zone.

- **News**: the items as `items.list` returns them, newest first. The search box is the App's word search, and the filters (source, area, topic, kind, status, priority, changed since read) are the App's filters, so an item found only in an earlier revision says so. An item page shows one revision with every revision listed (the latest by default; an earlier one is marked as such), the publisher's note of a correction or retraction, what a copy or report is based on and who copied or reported the item, each with the revision it used, and the notifications about the item. Nothing is labelled outdated or merged. Mark as read (the revision on the page) and Clip this item.
- **Following**: the follow rules, active and paused; New follow rule, Edit rule, Pause or Resume, Remove rule.
- **Clippings**: each clipping with the revision it holds, whether its item has a newer one, its note, what relies on it (shown as text, never opened) and its history; Move to the newer revision, Edit, Watch or Stop watching, Remove.
- **Notifications**: the log with the App's kind and state filters; a notification with its state (held until, released, or superseded and by which), its delivery, why it was written and which rules match.
- **Read**: the reading record, newest first. Opening an item never marks it; only Mark as read does.
- **Settings**: time zone, quiet hours, the digest time, how corrections are delivered and email copies; the sources and areas.

Every write carries the version the form was opened on, so a change made meanwhile shows as a conflict rather than being overwritten, and an unchanged resubmission reuses its `request_id`, so a retry after a lost response cannot repeat the effect. Edits send only the fields that changed, so a policy that allows one field is respected. Controls for tools the policy does not offer are not shown; a refusal is shown as such. App text is rendered as text only. `gui/src/view.js` is the compatible reviewer renderer. `tests/web.browser.cjs` drives the pages in a real browser and checks the same run through MCP after every write.

## Package boundary

The package runs on its own. It imports only Node built-ins and its own files, reads no file outside its folder and uses no other App's files or state; a test checks this. `service.cjs` is the provided launcher, which finds the pinned runtime. `tests/schema-validator.cjs` is a copy of the public runtime's schema validator, so the App-only tests check every argument, result and state against the contracts without the runtime. The two real-MCP scripts, the web starter and the browser checks are given the runtime's location; the browser checks also use the checkout's pinned Playwright.

## Other Apps

No App is required. Mail is optional and send-only. When `preferences.email_notices` is on at the moment a notification is written, the notification also carries the full wire message for Mail's existing receive declaration (Mail 1.3.0: `channel.email`, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), dated at the notification's release time. `schemas/router-message.schema.json` is a copy of Mail's wire schema; Messaging compares the two by content. Belltower builds no inbox, never writes to another App and does not read or write Calendar, Messages, Contacts, Files, Notes or Tasks. A clipping's `linked_object` can hold a reference the Agent supplies, for example a Calendar event ID.

Delivery is Infra's. `infra/sender.cjs` is an outbound adapter in the pattern of Mail's `src/publisher.cjs`: Infra runs it with its own connections and supplies both clients.

```js
const { publishReleased } = require('./infra/sender.cjs');
// source: an Infra MCP client of this Belltower instance; router: a publisher client of Messaging
const { stage, dispatched, skipped, sent } = await publishReleased({ source, router, sent: previousLog });
```

- It reads notifications through `env.snapshot` and dispatches one when three things hold in that snapshot: its release time has been reached, it is not superseded, and its revision is still the latest revision of its item. It calls `router.publish` with the stored wire message, in order of release time.
- It reports what it dispatched and what it skipped and why: `held`, `superseded` or `replaced`. A digest notification written at 10:00 is published by the first run after Infra has moved the clock to the 18:00 digest time, with no App event. One that was superseded at 16:30 is never published.
- The guarantee holds at first dispatch. A notification is due at 18:00, its item is corrected at 18:05, and the sender first runs at 18:10: the 18:00 notification is `released` in the log, but its revision is no longer the latest, so the sender skips it as `replaced` and Mail gets no copy of the old version. The correction is dispatched when its own release time is reached. Had the sender also run at 18:02, Mail would hold two records in order.
- Messaging decides from the run's bindings and grants whether the message reaches Mail. `infra/router.config.example.json` shows an Infra config that names this package as the publisher and grants the bound Mail account for `channel.email`; its paths are relative to the public checkout, as the router requires. Without a grant the delivery is rejected and Mail gets no record.
- Notifications that came with the seed are history, unless they were still held when the seed was loaded. A notification written while email notices were off has no wire message and is left out.
- The sender never writes into Belltower. `sent` is the caller's log; pass it back on the next run. A rejected or unknown delivery does not roll anything back; Messaging stops the run on an unknown acknowledgement.
- Messaging deduplicates in one router session. After `env.reset` of Belltower, start Messaging with a new run, because notification IDs start again.

`tests/mail.integration.cjs` checks this with the real Mail package: the committed receipt, the message the Mail Agent reads and its `thread_id`, a held notification that is published only after `env.advance_time` has reached its release time, that the superseded notification never reaches Mail, the delayed-dispatch case (one record when the sender first runs after the correction, two in order when it also ran before it), an identical retry, changed content, a forged source, a message of another type, a missing grant, a person with no Mail account bound in the run, email notices switched off, that Belltower's state is identical before and after dispatch, and that resetting Belltower leaves what Mail received. The pinned Mail package ships its own example account, so the script first has Infra load the account holder's empty mailbox into the run's Mail instance with the run's shared binding (`fixtures/binding.json`), as a task would.

## Workflow-to-test mapping

| Workflow | App-only tests (`tests/business.test.cjs`) | Real MCP |
| --- | --- | --- |
| W1 Following and preferences | T01, T02, T03 | `mcp.integration.cjs`: the W1 writes; policy narrowing by tool, object and field; `limit_exceeded` on a task seed |
| W2 Evidence | T04, T05, T06, T07 | `mcp.integration.cjs`: all W2 tools; reads leave data and version unchanged; the audit row of a read |
| W3 Reading record and clippings | T08, T09, T10 | `mcp.integration.cjs`: the W3 writes, a clipping moved to a newer revision under a narrowed policy |
| W4 Notifications and the digest | T11, T12, T13, T14, T15 | `mcp.integration.cjs`: an event with its receipt and replay; `mail.integration.cjs` (T16b) |
| All: the platform clock and the sender | T16 | `mcp.integration.cjs`: `env.advance_time` with no App event, the sender's plan on a real snapshot; `mail.integration.cjs`: delayed dispatch |
| All: Core contracts | T17 runs `mcp.integration.cjs` | replays, a changed input, stale versions, authority, failure atomicity, an event before the current time |
| All: seeds, reset, activity log | T18 | `mcp.integration.cjs`: task seed with `virtual_now`, reset to the loaded seed and time |
| All: the proposal's examples | the test of the plan's four events and its wire message | |
| All: consistency in any reachable state | the random-walk test (`dev/walk.cjs`), the contract and package-boundary tests | |
| Web pages (W1–W4) | the declaration and text-only checks | `web.browser.cjs`: every section in a real browser, writes checked through MCP, conflicts, retries, refusals, a restricted policy |

## Remaining work

- Independent reproduction and acceptance by a maintainer.
- Human review of realism (headlines, notice wording and publishers' notes, notification wording) and of the invented sources, places and names.
- No agent trials are included.
- The web pages run on the public loopback Web Host. A production deployment (remote authentication, HTTPS) is a platform matter, and no user-simulator integration is claimed. There is no reviewer console.
- Mail is the only connected App. Delivery uses the public Messaging router with a local Infra config; production Messaging credentials are a platform matter.
- The fields of `based_on` and of an item are those of the approved plan. A consumer Task that needs a further field (for example a street list as data) can name it in its own review.
