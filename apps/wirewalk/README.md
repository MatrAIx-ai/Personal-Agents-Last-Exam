# Wirewalk

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. Wirewalk is a fictional public news feed for following a developing story, in the style of X. An agent can search posts, open a conversation, trace a quote or repost back to its source, inspect an account and keep private bookmarks. Wirewalk records when each post became public, so a reviewer can reconstruct what the agent could have known when it acted.

- **Proposal:** [Environment proposal #209](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/209) (`proposals/environment/wirewalk.md`), plan approved at `ef524fc1b1882ead45879862862b96b360ee8cfc`. The approval keeps Wirewalk a standalone reader rather than an extension of Postyard (#168). Postyard and Belltower (#172) remain related, independent work.
- **Domains:** News & information (primary); Social & communities.
- **Interface:** Agent MCP and Infra MCP through the public runtime. MCP only: no GUI and no reviewer console, as approved.
- **Package dependencies:** Node.js 18+ and the public runtime 1.6.0 (Core API 1.2.0) at reference revision `a4bce02`. No other Apps, packages, network access or credentials. `app.json` declares no dependencies.
- **Scenario dependencies (walkthrough only):** Mail 1.3.0 (`examples/apps/mail`), Calendar 1.3.0 (`examples/apps/calendar`) and Messaging (`runtime/messaging`), all from this checkout. Wirewalk neither publishes nor receives cross-App notifications (proposal §3). The train and wildfire alerts are ordinary Mail messages: the agent sends them from a sending mailbox, and the host relays them to the user's inbox over Mail's own Mail-to-Mail channel. Following the [integration guide](../../docs/app-integrations.md), a scenario-specific recipient belongs in the run assembly, so Mail is not pinned as a package dependency.

## Model

| Record | Owner | Notes |
| --- | --- | --- |
| `accounts` | public history | 14 fictional people and organizations with `id` (the handle), display name, kind (`person` or `organization`), bio, location and join date. |
| `posts` | public history | Four kinds: `original`; `reply` (`parent_id`); `quote` (own text plus `quoted_id`); `repost` (`source_id`, no text of its own). Each post has an author, text, optional link cards and images, and a `published_at`. Posts are immutable. |
| `bookmarks` | private reader state | `{post_id, saved_at}`. The pair (bound account, post ID) identifies a bookmark, so a post is bookmarked at most once. |

- Each App instance holds one reader account (`account_id`, `owner_person_id`, bound through the task binding) and a copy of the run's public history.
- Two readers are two instances loaded with the same history. **Infra applies every `post.publish` event to every reader instance in the run**, so the histories stay identical. The walkthrough's markets run shows this for two readers.
- **Visibility.** A post is public from its `published_at` onward, an account from its `joined_at` and a bookmark from its `saved_at` (see the clock cutoff under [State and time](#state-and-time)).
  - A seed may carry history past the run clock (the fixture runs from Saturday to Monday; the evaluation dataset runs to the end of 2026): records dated after the run clock stay hidden until the clock reaches them.
  - An unknown post ID and a post that is not public yet get the same `not_found` response ("Post is not available in Wirewalk."). Reply, quote and repost lists and counts include only public posts.
- **Links.** Every post has a stable link, `https://wirewalk.example/@<author>/posts/<id>`, and every account a profile link. Link cards are fixture metadata (URL, title, description) on the reserved `.example` domain; nothing is fetched.

## Agent tools

| Tool | Effect | Purpose |
| --- | --- | --- |
| `wirewalk.feed.list` | read | The public feed, newest first, paged |
| `wirewalk.search` | read | Search visible post text with author, kind and time filters, newest first, paged |
| `wirewalk.post.get` | read | One post with its parent, quoted or source post, and its public replies, quotes and reposts |
| `wirewalk.thread.get` | read | The conversation around a post: ancestors, the post, replies with depth |
| `wirewalk.account.get` | read | Profile, public post count and recent posts |
| `wirewalk.bookmarks.list` | read | This reader's bookmarks, most recently saved first |
| `wirewalk.bookmarks.add` | write | Bookmark a public post; returns `{post_id, bookmarked, changed}` only |
| `wirewalk.bookmarks.remove` | write | Remove a bookmark; returns `changed: false` and changes nothing if the post was not bookmarked |

- **Ordering.** Feed and search results sort newest publication first. Equal timestamps fall back to the post ID, highest first, compared by code unit, so the order does not depend on the host locale.
- **Post fields.** Every row carries the author, `published_at`, `link`, text and the related post (`parent`, `quoted` or `source`) with its own author, time and link.
- **Search.** A post's searchable text is its own text, image alt text and link-card titles and descriptions. Matching ignores case and accents, and every query word must match the start of a word. Reposts carry no text of their own, so they appear only in filter-only searches (for example `kind: "repost"`) and in the feed. A blank query is a filter-only search. A query with no letters or digits (for example `"!!!"`), or a `since` later than `until`, returns `invalid_arguments`.
- **Paging.** Pass `next_cursor` back to continue. The cursor fixes the result set at the first page, as described below. A fresh call without a cursor includes newly published posts.
- **Threads.** `wirewalk.thread.get` follows reply links only; a quote starts its own conversation. Opening a repost opens its source's conversation.
- **Bookmark set semantics.** The pair (account, post) identifies a bookmark. Adding one that exists, or removing one that does not, succeeds with `changed: false` and changes nothing; an unknown or not-yet-public post returns `not_found`.
- **Writes.** Writes require Core's `expected_version` and a `request_id`. Core rejects a stale version (`stale_version`), returns the original result for an identical retry (`duplicate: true`), and rejects a reused request ID with different arguments (`idempotency_conflict`). A failed write leaves the bookmarks unchanged; reload the current version before retrying.
- **Session clock.** Several writes in one session share the virtual clock; the bookmark list then orders them by write order, latest first.
- **Policies.** The package `scenario` policy allows only reads. A task grants the two bookmark tools in its own policies (see `examples/task-data/policies.json`). Post tools take the post ID as `id` and `wirewalk.account.get` takes the account ID as `id`, so Core's `constraints.ids` can narrow them per object. The proposal promises no per-object narrowing, so Wirewalk adds no App-side policy checks.

### Stable paging

A cursor records four things: the first page's publication boundary (`as_of`, the clock at the first page), how many posts were public at that moment (`n`), the ID of the `n`-th of them (`b`) and the last row returned. Later pages draw only from the first `n` posts, in storage order, that were published by `as_of`. Events only append posts, so that is exactly the first page's set, and `b` pins it. This covers two cases:

- A post published by an event after the first page, even at exactly the same timestamp, falls outside `n`. This count is the version boundary the review asked for.
- A seeded post that becomes public because the clock advanced falls outside `as_of`.

Either kind of post appears in the next fresh call. A same-timestamp arrival with a lower ID, which sorts into the remaining pages, is kept out too (test *a same-timestamp arrival that sorts inside the remaining pages…*). `n` and `b` only ever describe public posts, so a cursor reveals nothing else. Reads stay stateless: the cursor is an opaque string that also carries the query's filters.

These return `invalid_arguments`:

- a cursor used with different filters or with another tool;
- a cursor whose count no longer matches `b` (a forged count);
- a cursor used on an instance whose posts up to `as_of` differ, for example after a reset that received a different event;
- a cursor whose `as_of` is later than the clock, for example after a reset to an earlier time.

## Incoming event: `post.publish`

Infra applies one event type. The payload has `id`, `kind`, `author_id`, the kind's relationship field, `text` (required except for reposts) and optional `links`. The publication time is the event's `at`. `examples/scenario.json` is the approved proposal's example verbatim; `examples/wildfire-events.json` holds the six wildfire updates. As a management call on the Infra connection, using the version from a fresh `env.snapshot` (this is the exact call the walkthrough records):

```json
{
  "method": "tools/call",
  "params": {
    "name": "env.apply_event",
    "arguments": {
      "expected_version": {"epoch": 2, "revision": 0},
      "event": {
        "event_id": "rail-reply-01",
        "at": "2026-10-10T21:12:00-07:00",
        "operation": "post.publish",
        "payload": {
          "id": "p19", "kind": "reply", "parent_id": "p12", "author_id": "green-line-ops",
          "text": "Only the 11:40 pm eastbound is canceled. Last eastbound is 10:55 pm. Westbound service is on schedule."
        }
      }
    }
  }
}
```

- The post becomes visible when the event commits, and the parent's reply count and conversation include it from then on.
- The whole event fails with `invalid_event` and nothing changes for any of these:
  - an unknown author;
  - a missing or unknown referenced post, or one published after the event;
  - a reference to a repost (point to the original instead);
  - the wrong relationship field for the kind, or text on a repost;
  - a second repost of the same post by the same account;
  - an already-published post ID;
  - blank text or a repeated link.
- Images are seed-only: an event carries text and link cards, because an image must also be catalogued as an asset.
- Core returns the original receipt for a replay of the same `event_id` (so a replay leaves one reply) and rejects the same ID with different content (`idempotency_conflict`).
- Wirewalk has no alert queue, business timeout or notification channel. The task runner schedules agent turns; the agent decides whether to send an email.

## State and time

- **Infra operations.** Infra loads a run's history and the bound reader's bookmarks with `env.load_seed`, applies events with `env.apply_event`, advances the clock with `env.advance_time`, takes `env.snapshot` and restores the loaded baseline with `env.reset`. None of these are available on the Agent connection, so the agent cannot inject public posts.
- **Reset scope.** Reset restores the loaded history, bookmarks and clock of that instance only. It does not touch Mail or Calendar.
- **Clock.** `ctx.virtual_now` is the reader's "now" and decides which posts are public. Agent reads and writes do not advance it; `saved_at` takes its value. Before each agent turn the runner applies due events and then advances every App in the run to the turn time (see the walkthrough's `advance`).
- **Seed dates.** Seed dates are not compared with the run clock, because Core validates the package fixture at registration, possibly under an earlier clock. Relative order is checked:
  - replies, quotes and reposts must not predate what they point to;
  - posts must not predate their author's join date;
  - bookmarks must not predate their post.
- **Clock cutoff.** Tools show only records dated at or before `ctx.virtual_now`. Nothing is stored for this: when `env.advance_time` or an event moves the clock, the later records appear and no record changes. A seed that runs past the clock, such as the evaluation dataset, can therefore load at any point in its window.

  | Record | Date field | Class | Before the clock reaches the date |
  | --- | --- | --- | --- |
  | `posts` | `published_at` | Happened in the service: the post exists from publication | `not_found` by ID for every read and both bookmark writes; absent from the feed, search, threads, reply, quote and repost lists and counts, account post counts and cursors |
  | `accounts` | `joined_at` | Happened in the service: the account exists from joining | `wirewalk.account.get` returns `not_found`. Seed validation keeps every post at or after its author's join date, so a visible post always has a visible author |
  | `bookmarks` | `saved_at` | Happened in the service: the reader saved the post then | Absent from `wirewalk.bookmarks.list`; the post shows `bookmarked: false` and `saved_at: null` |

  Wirewalk has no scheduled or descriptive date fields. Times written inside post text, such as "results Tuesday, Oct. 13", are content and are not filtered.
- **Writes before a later record.** Both bookmark tools return `not_found` for a post published after the clock and change nothing. If the agent bookmarks a post that the seed records as bookmarked later than the clock, the agent's bookmark replaces the later one, so the post keeps one bookmark, dated now. `wirewalk.bookmarks.remove` on such a post returns `changed: false` and keeps the seeded record, because at the clock that bookmark does not exist yet.
- **Events.** `post.publish` has no positions or "latest" logic, so the cutoff changes nothing there. Its checks still run against the stored history: a reference to a post published after the event time fails, and an event that reuses the ID of a seeded later post, or repeats a seeded later repost by the same account, fails with `invalid_event`, because the stored history must stay valid and posts are immutable.
- `fixtures/clock.json` sets the App-only example time: Saturday, Oct. 10, 2026, 21:10 Pacific, two minutes before the operator's reply.

## Fixtures

All text and the image are original and fictional (see `contribution/dataset.json`). Three storylines from Saturday to Monday, Oct. 10–12: 14 accounts, 37 seed posts and 7 event posts (44 in all), one image, and link cards for the county bulletins and the company notice.

- `fixtures/minimal.json`: the public history for reader Priya Raman (`ww-priya`), who bookmarked the operator's Saturday schedule (`p01`). Posts `p20` onward are dated Sunday and Monday and stay hidden until the clock reaches them.
- `examples/scenario.json`: at 21:12 the operator replies to the question `p12` (`p19`).
- `examples/wildfire-events.json`: six county and neighbor posts on Sunday (`p22`–`p27`).
- `examples/task-data/`: reader Dario Mendes (`ww-dario`) on Monday evening. His history is the minimal seed plus all seven example events, and he has bookmarked the two analysts' threads. The folder ships its own `dataset.json` and `assets.catalog.json`, with the image bound to his account.
- `data/evaluation/`: the two-year evaluation dataset, described [below](#evaluation-dataset-2025-01-01-to-2026-12-31). The fixtures stay small smoke data.
- `assets/fennick-board-crop.png`: one 605×125 PNG (35,765 bytes, asset ID `fennick-board-crop`, SHA-256 in the catalog), attached to `p05`.
  - It is rendered by `tests/board-image.cjs` from the two lines quoted in the post's alt text: "11:40 PM GREEN LINE" / "CANCELED". The crop does not show the direction. In the story the rider posts it as a photo; it is a rendering, and `contribution/dataset.json` says so.
  - The tests decode the PNG and compare its pixels with a fresh render of those lines, so image and text must agree.

| Workflow | Data a task can use |
| --- | --- |
| Local news (train) | **Saturday schedule (`p01`):** the last eastbound and the last westbound both leave at 11:40 pm, so the cropped board cannot show which one is canceled. **21:05:** a rider posts the cropped board photo (`p05`); `corvale-scanner`, `devin-hart` and `june-okoro` quote it (`p07`–`p09`), and there are reposts and a "which direction?" reply. **21:08:** `p12` asks the operator. **21:12:** `p19` (event) says only the 11:40 eastbound is canceled and the last eastbound is 10:55. Show end, walk time and the user's direction belong to the task (the walkthrough puts them in Calendar). |
| Markets | **Alder Glass notice (`p28`):** shipments up 12%, results Tuesday, Oct. 13. **Odile Park (`p29`–`p30`):** repeat orders. **Ravi Castellano (`p31`–`p32`):** distributors stocked up before a Jan. 1 price increase. Both name the next-quarter reorder rate as the deciding figure, and no post reports it. **`p33`–`p44`:** twelve reposts of Odile Park's thread by six accounts, all one source. |
| Current events (wildfire) | **2 pm county bulletin (`p21`):** warning for Pine Hollow, no notice for Lakeview. **15:10:** a repost and a quote recirculate it. **16:20:** Pine Hollow order. **18:05:** Lakeview warning (`p25`) and a repeat of the Pine Hollow order (`p26`), at the same timestamp. **20:15:** a zone change in Pine Hollow after an 8 pm cutoff (`p27`); with a later cutoff it would trigger an email. |

Expected answers and alert decisions for a real task belong in that task's evaluator, not in this package.

## Evaluation dataset, 2025-01-01 to 2026-12-31

`data/evaluation/` is the delivered evaluation data for the coverage window in [submission evidence, section 3](../../docs/submission-evidence.md#3-environment-dataset-coverage). The fixtures above stay small smoke data. This dataset was added after the plan was approved, when that section was published; it is recorded as added scope in the validation report.

- **Contents.** `seed.json` (version 1.0.0, about 0.5 MB) holds the public history of the fictional Corvale area feed and reader Priya Raman's bookmarks: 23 accounts, 1,864 posts (1,515 original, 194 replies, 38 quotes, 117 reposts) and 127 bookmarks.
  - It contains the 14 fixture accounts, the 37 fixture posts and Priya's fixture bookmark verbatim.
  - `binding.json`, `policies.json`, `clock.json`, `dataset.json` and `assets.catalog.json` sit beside it. `dataset.json` records the sources, the post count and the seed's sha256. The catalog binds the board image to Priya under this dataset's ID.
- **Story arcs** lead into and out of the fixture weekend:
  - the transit board's Saturday late-service pilot, from the September 2025 proposal through the Sept. 12, 2026 move to 11:40 pm and the report on the Oct. 10 cancellation;
  - the county's named evacuation zones from May 2025, red flag warnings and an August 2025 warning for LV-3, then the Cinder Fork Fire's containment and recovery after Oct. 12;
  - Alder Glass's quarterly reorder rates, two Jan. 1 price increases and the Oct. 13 results;
  - the music hall's weekly lineups, including the Oct. 10 show.
- **The storyline weekend.** Generated posts skip Saturday to Monday, Oct. 10-12, 2026, so the authored storylines read the same at any clock.
  - The seven event posts (`p19`, `p22`-`p27`) are not in the seed. A scenario applies them with `post.publish` exactly as on the minimal fixture, and `tests/business.test.cjs` applies all seven to this seed.
  - Later generated posts are written for a run in which those events happened.
- **Clock.** The dataset clock is the fixture clock, 21:10 Pacific on Saturday, Oct. 10, 2026.
  - Priya's bookmarks end there; the last is the fixture's `p01`, saved at 15:05.
  - Public posts continue to Dec. 31, 2026, and one account (`cinder-fork-recovery`) joins on Oct. 14. Wirewalk shows them as the run clock reaches them (see the clock cutoff above), so they are never pre-session history.
- **Provenance.** Every record is synthetic: 52 are copied from the authored fixture (14 accounts, 37 posts, 1 bookmark) and the other 1,962 are written by `dev/build-dataset.cjs` from templates and a fixed random seed. All accounts, people, places, agencies, companies and shows are invented, as in the approved design. There is therefore no real source to anchor in November 2026, and nothing was collected from real websites.
- **Coverage.** Counted in America/Los_Angeles on each record's own date field (`published_at`, `joined_at`, `saved_at`):
  - 645 distinct dates in all 24 months, 577 of them on or before the dataset clock;
  - no stretch longer than 3 days without a record;
  - the 18 accounts that joined before 2025 are excluded from the count;
  - no two posts share a text, and the highest word 5-gram Jaccard similarity between two posts is 0.59.

```sh
node dev/build-dataset.cjs          # rebuild data/evaluation/ (byte-identical on rerun)
node dev/coverage-report.cjs        # coverage by source and month, provenance, gaps, exclusions, content checks
node dev/coverage-report.cjs --json
node examples/dataset-demo.cjs      # load it over real MCP and query it at three clocks
```

## Commands

From this directory:

```sh
npm test                 # App-only business tests (no runtime needed)
npm run example          # App-only post.publish walkthrough
npm run walkthrough      # Real MCP evidence report (JSON on stdout); needs the public checkout
npm run build:contracts  # Maintainer: regenerate tools.json and the seed/event schemas
npm run build:fixtures   # Maintainer: regenerate fixtures, events, task data, image, catalogs and counts
npm run build:mail-wire  # Maintainer: rewrite examples/mail-wire.json from a live run
npm run build:dataset    # Maintainer: rebuild data/evaluation/ (byte-identical on rerun)
npm run dataset:coverage # Coverage report for data/evaluation/ (Markdown; add -- --json for JSON)
npm run dataset:demo     # Real MCP load and query of the evaluation dataset (JSON on stdout); needs the public checkout
```

From the repository root:

```sh
npm run app:verify -- --app apps/wirewalk --output .artifacts/wirewalk.json
node runtime/build-contracts.cjs --check
```

`npm run walkthrough` finds the runtime, Mail and Calendar the same way `service.cjs` finds the runtime: by walking up to the checkout, or through `PALE_RUNTIME_ROOT`. It needs no network or model API and cleans up its temporary state. It refuses to run unless Mail and Calendar are 1.3.0. The report includes the package SHA-256, runtime, Mail and Calendar versions and the Node version.

Only the walkthrough and the dataset demo read files outside this package; the tests, `examples/run.cjs` and the verifier never load them. The dataset demo uses only `runtime/prepare.cjs`, `runtime/client.cjs` and `runtime/verify.cjs` from the first row below. These are scenario-only dependencies (proposal §3):

| File in the checkout | Use |
| --- | --- |
| `runtime/prepare.cjs`, `runtime/client.cjs`, `runtime/verify.cjs` (`digestTree`), `runtime/package.json` | Prepare a registry copy of this package, open real MCP connections, hash the package, report the runtime version |
| `runtime/messaging/service.cjs` | Messaging publisher connection for the sending mailbox (spawned over MCP) |
| `runtime/messaging/src/router.cjs` | The same Messaging Router in-process, only for the lost-acknowledgement run. This copies the approach of `runtime/messaging/tests/test_time_trace.cjs` |
| `examples/registry.mail.json`, `examples/registry.calendar.json` | Registries that start the real Mail and Calendar packages |
| `examples/apps/mail/app.json`, `examples/apps/calendar/app.json` | Version check (1.3.0) |
| `examples/apps/mail/src/publisher.cjs` | Mail's own `notification()` builder, which the approval review names for the wire message. `examples/workflows/mail-to-mail/run.cjs` uses it the same way |

## Proposal checks and evidence

The walkthrough runs these over real MCP:

- **Train:** eastbound and westbound runs; an eastbound run with no recipient grant; an eastbound run whose delivery acknowledgement is lost.
- **Wildfire:** turns after each update; a delayed-turn variant that resumes once at 6:10 pm; a cutoff variant with a control run that differs only in the user's cutoff.
- **Markets:** a two-reader run.
- **Paging:** a run for the same-timestamp cursor case.

Each run has its own run ID and state. A scripted reference agent acts at each turn from what it can read. Its replies are reference evidence for the data and tools, not model-agent trials. Whether maintainers also expect a model-agent rollout for this PR is an open question for @byshail.

Results from each run are recorded outside this file, because the package SHA-256 covers this README. The verifier report and the walkthrough's JSON carry the package SHA-256, runtime 1.6.0 / Core API 1.2.0 at reference revision `a4bce02`, the Mail and Calendar versions and the Node version. The PR body carries these for Node 18 and 22, with the test, verifier and walkthrough counts.

| Proposal item | Evidence |
| --- | --- |
| Train: one email at the first turn after the reply (10:55 train, leave by 10:40); westbound none through the end of the show | Walkthrough `train-east` / `train-west`. Turns at 21:10, 21:13 and 22:30, clocks advanced to 23:00. Eastbound inbox: exactly one record; westbound inbox and Sent folder: empty. Before 21:12 both last trains read 11:40 in `p01`, so the crop alone does not say which direction is canceled. Test *train storyline…* |
| Markets: both interpretations linked to their authors, the unreported reorder rate, reposts are not sources | Walkthrough `markets`. The scripted reference reply, kept in `reference_replies.markets`, is built from sentences the tools returned and quotes them verbatim: each analyst's reading, the sentence naming the reorder figure, and the "not out yet" sentence. The checks confirm every quote against that analyst's own posts in Infra's snapshot, the shared 12% against the company post, and the repost count (12 reposts, one source) against tool output. They do not check the template's own wording. Test *markets storyline…* |
| Wildfire: two emails (Pine Hollow order at 4:20 pm, Lakeview warning at 6:05 pm), each with its county post link; no duplicates for the repost or the repeated order | Walkthrough `wildfire`: turns at 14:30, 15:11, 16:21, 18:06 and 20:16; the inbox holds exactly two records. Test *wildfire storyline…* |
| Delayed turn: the runner resumes the agent once at 6:10 pm; one email with the latest status and source per area | Walkthrough `wildfire-delayed`: exactly one turn and one email citing `p24` (repeated at 6:05 by `p26`) and `p25` |
| A fresh post after the 8 pm cutoff produces no email | Walkthrough `wildfire-cutoff` and its control `wildfire-cutoff-control`. The two runs are identical except for the cutoff (8 pm vs 9 pm). At 8:16 pm the variant saw `p27` and sent nothing, while the control sent one email for the Pine Hollow zone change in `p27`. So the cutoff is what suppresses it. The main `wildfire` run's 8:16 pm turn also sends nothing |
| Proving delivery: separate sending mailbox and inbox; host relays the committed message with a grant; receipt matched to the inbox record (recipient, content, timing) | Walkthrough `checkDelivered` for all four deliveries. Each joins the Sent record, wire, Messaging receipt, inbox record, the user's `mail.get` and the receiver's `env.event_status` |
| A denied grant leaves the inbox empty even if a Sent record exists | Walkthrough `train-east-denied`: `recipient_not_authorized`, Sent record present, inbox empty |
| An unknown acknowledgement pauses the run before any retry | Walkthrough `train-east-lostack`: `unknown` / `receiver_unconfirmed` with the event ID; the runner halts. Reconciliation finds the committed receiver event, and a retry gets `run_halted` with no second record |
| From a search hit, follow a quote to its source and read later replies | Test *from a search hit…*; walkthrough train turns (search, then the quoted source) |
| Add and remove a private bookmark; account isolation | Tests *bookmarks…*, *two reader instances…*; walkthrough `markets`: add, remove; Priya never sees Dario's bookmarks; no `account_id` argument |
| A retried add or removal with the same request ID returns the original result; a stale write leaves the set unchanged; bookmarks persist across turns | Walkthrough `markets`. Byte-identical retries of both the add and the removal return `duplicate: true`, and each has one audit row. A reused request ID with different arguments gives `idempotency_conflict`. A stale add and a stale removal each return `stale_version` with the set unchanged, and only the committed racer's bookmark exists. After Infra advances the clock, a new Agent connection lists the same bookmarks |
| Record asset origin and verify every local reference resolves | `contribution/dataset.json` source `rendered-board`; test *the cropped photo and its alt text agree…*; walkthrough: Core refuses a bundle without the image bytes and a post naming an uncatalogued image (`invalid_bundle`), with state unchanged |
| Check thread links, dates, chronology, alt text and source identities | Test *seed validation rejects…*, plus the alt-text and catalog checks above |
| Check each analyst's argument against their thread; wildfire notices against the 2 pm baseline | Tests *markets storyline…*, *wildfire storyline…* |
| Operations: feed, search, post, thread, account, bookmarks; newest first with post-ID tie-break | Tests *the feed is newest first…*, *search…*, *account inspection…*; verifier |
| Cursor fixed at the first page; a fresh search includes new posts | Tests *a cursor stays on its original result set…*, *a cursor also keeps out seeded posts…*; walkthrough `paging` |
| Unknown and future posts: same unavailable response | Test *an unknown post and a post that is not public yet…*; walkthrough train-east (`p29` vs `p999`) |
| `post.publish` checks authors and references; a replay leaves one reply | Tests *post.publish adds…*, *post.publish checks…*; walkthrough event replay, `idempotency_conflict` and `invalid_event` with data unchanged |
| History loading, concurrent writes, cross-account access, invalid references | Walkthrough: direct task-data load, a two-connection race (one `committed`, one `stale_version`), stale `expected_version`, unknown post, and the agent denied `env.apply_event` |
| Reply absent before injection, present after, gone on reset; bookmarks and clock restored | Walkthrough train-east reset and markets (Dario) reset, each after a retained snapshot; verifier |
| Shared publications applied to each enabled instance | Walkthrough `markets`: both instances receive the same seven events and end with identical public history; Dario's live state equals `examples/task-data/seed.json` |
| Use the supplied execution trace to check the evidence visible at each turn | `evidence.turns` lists, for every turn, the post IDs the agent's reads returned, its decision and any email; the checks assert, for example, that the 21:10 turn saw the photo and quotes but not `p19` |
| One PNG under 128 KiB with a stable asset ID and checksum; image and text agree | Test *the cropped photo and its alt text agree…*; Core quality check at registration |
| Package runs standalone on the public Core runtime | `npm test` and `npm run example` import no runtime; `npm run app:verify` passes |
| Calendar 1.3.0 and Mail 1.3.0 as scenario dependencies | The walkthrough's first check asserts both versions; the files it loads are listed under Commands |
| Publish reproducible commands and results against pinned app/runtime revisions | Commands above. The results for Node 18 and Node 22 go in the PR body: test, verifier and walkthrough counts, package SHA-256, runtime 1.6.0 at `a4bce02`. The verifier and walkthrough reports record the same fields |

### Evidence join and counting (approval suggestion 1)

The report's `trace` records one row per MCP call, with these fields:

- `run`, `app`, `account` and `connection`;
- `tool`, plus `request_id`, `event_id` or CloudEvents ID;
- `status`, `duplicate` and Core's `version` (`epoch`, `revision`).

The sources join as follows:

- **Wirewalk history** joins by run, App and account to each instance's snapshot. A post's `published_at` (for event posts, the event's `at`) and the event receipt (`event:<event_id>`) place it in that history.
- **Tool calls** join to Core's audit rows by run, App and account, then by connection, tool, `request_id` or `event_id`, and status. The walkthrough names each MCP client after its trace label, and Core stores that name as the audit row's `client_name`. Each retained audit row carries the `trace_seq` it joins to, and the walkthrough asserts that every row joins. In the last run that was 21 of 21 rows for train-east (two connections) and 29 of 29 for Dario (four connections).
- **A delivery** joins the Mail Sent record (`draft-N`, `sent_at`), then the CloudEvents `source` + `id` (`mail-draft-N`), then the Messaging receipt (`event_id`, target account, receiver version, `applied_at`), then the inbox record (its ID equals the receipt's `event_id`), then the receiver's `env.event_status`. `evidence.deliveries` lists each join, and `evidence.messaging_receipts` keeps each run's Messaging receipt log, including duplicates and refusals.

Counting rules:

- `trace_summary.logical_committed_writes` counts each committed `(run, App, account, request_id or event_id)` once.
- A successful idempotent replay is listed as `duplicate_replay` and adds no logical write. Core adds no audit row for it, and the walkthrough asserts both: train-east's three committed publish responses count as one delivery, and Dario's replayed add and replayed removal each have one audit row against two trace rows.
- Denials keep their status (`permission_denied`, `stale_version`, `idempotency_conflict`, `recipient_not_authorized` and so on), so they stay distinguishable. Each is its own audit row with `decision: "deny"`.
- Reset clears Core audit and receipts. The walkthrough therefore takes a snapshot before each reset and records its version, clock, post and bookmark state, receipt keys and the joined audit rows in `evidence.snapshots_before_reset`.

## How the approval suggestions were resolved

1. **Evidence join.** The report joins the sources by run, App, account and call or connection as described above, and the walkthrough asserts every audit-to-trace join. It counts each idempotent replay once and keeps denials distinguishable. It also retains a snapshot, with its audit rows, before each reset.
2. **Mail wire fixture.** `examples/mail-wire.json` is one complete plain-text Mail wire message: the Sent record the train-east agent committed, run through Mail's own builder (`examples/apps/mail/src/publisher.cjs`, `notification`). It carries the sender account (`source`, `source_object.account_id`), the explicit recipient account (`data.recipient`, `app_account_ref` to `mail-priya`), the source message ID (`draft-1`) and the event time (`time`, the send time).
   - The walkthrough rebuilds the message from the live record and checks it equals the file; `npm run build:mail-wire` regenerates it.
   - The relay reuses the committed record. It calls `notification()`, not the combined `send()` helper, which would send locally a second time.
   - The relay halts on an unknown acknowledgement, and the inbox and receipt checks above run against the real Mail receiver.
3. **Paging.** At 18:05 the Lakeview warning (`p25`) and the repeated Pine Hollow order (`p26`) share one timestamp. The test and the walkthrough take a first page of county posts after `p25`, then apply `p26`:
   - Page 2 returns `p21`, `p20`, and `total` stays 4.
   - A fresh search leads with `p26`, `p25`, and `total` is 5.
   - A lower-ID arrival at the same time, which would otherwise lead page 2, is also kept out (test).

   The cursor's count of posts public at the first page is the version boundary the review asked for.

## Additions beyond the approved text

These fill in details the proposal leaves open; none adds a workflow or a dependency.

- Search also covers image alt text and link cards. Reposts, which have no text, appear only in filter-only searches.
- The stable link format `https://wirewalk.example/@<author>/posts/<id>`, and link cards limited to the `.example` domain.
- `post.publish` carries text and link cards but not images.
- Accounts whose join date is after the clock are hidden like future posts. A bookmark is hidden until its `saved_at` (the clock cutoff, added after plan approval).
- `wirewalk.thread.get` on a repost opens the source's conversation. `wirewalk.bookmarks.remove` on a post that is not bookmarked returns `changed: false`.
- One repost per account per post, and replies, quotes and reposts must point to a non-repost.
- A second reader (`examples/task-data`, Dario) for the markets request and the isolation checks.
- A second provenance source, `rendered-board`, describes the procedurally rendered PNG (`generation.method: "procedural"`).
- The content of the post after the 8 pm cutoff (`p27`, a partial downgrade in Pine Hollow) is authored so that it would trigger an email before the cutoff; the `wildfire-cutoff-control` run demonstrates that it does.
- The cursor also pins its boundary post (`b`). Search rejects a query with no letters or digits, and a reversed time window.
- 14 accounts rather than "roughly 12": six of them carry the dozen reposts.

## Package map

| Path | Contents |
| --- | --- |
| `app.json`, `package.json`, `service.cjs`, `plugin.cjs` | Manifest, commands, provided launcher, hook exports |
| `tools.json` | The 8 Agent tools with input/output schemas |
| `src/model.cjs` | Seed and post consistency rules (`validateSeed`, shared `checkPost`), record and asset references |
| `src/catalog.cjs` | Visibility, post shapes, search, stable paging and conversations |
| `src/operations.cjs` | Agent tool handlers |
| `src/events.cjs` | `post.publish` handler |
| `src/domain-utils.cjs`, `src/diagnostics.cjs` | Shared helpers and the optional, ID-only diagnostics adapter |
| `schemas/` | Seed, event and state schemas plus the shared bundle, dataset, catalog, descriptor, quality and resource contracts |
| `contribution/` | Contribution declaration, dataset provenance, asset catalog |
| `assets/` | The rendered station-board PNG |
| `fixtures/` | Minimal seed (Priya), binding, policies, clock |
| `data/evaluation/` | The 2025-2026 evaluation dataset: seed, binding, policies, clock, its own `dataset.json` and asset catalog |
| `examples/` | App-only example, approved event, wildfire events, Mail wire fixture, task data for Dario, real-MCP walkthrough, real-MCP dataset demo |
| `tests/` | Business tests, App-only harness, board renderer and PNG codec, verifier cases, schema validator |
| `dev/` | Maintainer scripts that regenerate the schemas, `tools.json`, fixtures, events, task data, image, catalogs and dataset counts, build the evaluation dataset (`build-dataset.cjs`) and report its coverage (`coverage-report.cjs`). They reproduce the committed files byte for byte and are not run by the verifier; the business tests check the evaluation dataset's counts and hash. |

## Limitations

- **Reader only.** The Agent searches, reads and bookmarks. It cannot post, reply, repost, like, follow or send direct messages; public posts enter only through the seed or Infra's `post.publish`.
- **Image bytes.** There is one image: a rendered PNG with alt text. Agent byte reads of it need a platform resource-access registration that this package does not add. The alt text carries the visible text, so tasks run on text reads.
- **Events.** `post.publish` carries text and link cards, not images. A post's publication time is the event time.
- **No live ingestion.** Every account, post and link, in the fixtures and in the evaluation dataset, is synthetic and on the reserved `.example` domain; nothing is fetched.
- **One reader per instance.** Each App instance holds one reader account. The public history is copied into each instance, so Infra applies every `post.publish` event to every reader instance in the run.
- **Search.** Search matches the start of words, ignoring case and accents. There is no ranking, recommendation or trending.
- **Notifications.** Wirewalk neither publishes nor receives cross-App notifications; alerts are drafted and sent with Mail.
- **Interface.** MCP only: no GUI and no reviewer console.
