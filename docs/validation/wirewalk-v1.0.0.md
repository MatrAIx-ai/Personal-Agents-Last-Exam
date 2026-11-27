# Wirewalk 1.0.0: implementation and verification

Owner: @byshail. App `wirewalk` 1.0.0 under `apps/wirewalk/`; public runtime 1.6.0, Core API 1.2.0, no App dependencies.
- **Scenario dependencies:** the walkthrough alone also uses Mail 1.3.0 and Calendar 1.3.0 from the checkout.
- **Plan:** it implements the plan in [PR #209](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/209), `proposals/environment/wirewalk.md` at `ef524fc1b1882ead45879862862b96b360ee8cfc`.
- **Approval:** the assigned Track reviewer approved that plan for implementation on 2026-11-24: review state `APPROVED` at 01:27:28Z, and `/approve-plan` for that commit at 01:27:39Z. The proposal file is unchanged since that commit (blob `79ea5b93c3555b818290b114dd10fed3e669007f`).
- **Commits:** the package is at commit `07303aeb2ed851b7aaaf1e1061a7b67adde9d8b7`. This report is updated in the next commit, which changes only `docs/validation/`. The first submission was `3eb7219` (package `a24e611`); this revision answers the v1 review of 2026-11-26 and its follow-up (the list of dataset posts that assume the example events) with the [evaluation dataset](#evaluation-dataset-and-clock-cutoff-added-after-plan-approval-260) and a [statement on CI](#ci-and-the-base-validator-at-the-submitted-revision).

This document records implementation evidence; it claims no acceptance.

Checked on 2026-11-26 (UTC) on macOS 27.2.1 (Darwin arm64) with Node v22.23.2 and v18.20.8. All data is synthetic. The runs used temporary directories and local stdio MCP, with no network, credentials or model API. Versions, the package hash and every count below are in [wirewalk/index.json](wirewalk/index.json), next to the raw reports.

**Automated outcome: passed.** Independent reproduction, official CI on the implementation commit and human review are still to come.

## Evidence

| Evidence | Result | What was exercised |
| :--- | :--- | :--- |
| App-only business tests, package alone | 26 passed, on both Node versions | A copy of `apps/wirewalk/` with nothing beside it, run with only `PATH` and `LANG` set. The tests call the real business functions through an App-only harness. The harness mirrors Core's event handling: the clock moves to the event's time before validation, and a failed event rolls back. Every result is checked against `tools.json`, and every refused call or event is checked to leave business data identical |
| Event example and generated files | Passed, on both | `examples/run.cjs` from the package alone. `dev/build-fixtures.cjs`, `dev/build-contracts.cjs` and `dev/build-dataset.cjs`, run in a copy, leave every committed file byte-identical: fixtures, events, task data, the image, both asset catalogs, dataset counts, schemas and `tools.json`. `npm run build:mail-wire`, which rewrites `examples/mail-wire.json` from a live walkthrough run, was not part of this check. The walkthrough instead asserts that the live wire message equals the committed file (W23) |
| Public App verifier | 40 checks passed, on both ([node22](wirewalk/public-runtime.node22.json), [node18](wirewalk/public-runtime.node18.json)) | An isolated package copy, then real MCP: discovery without Infra tools; published input and output of the 6 tools the default `scenario` profile lists; the Agent denied all seven Infra operations; history and asset loading and rejection; the declared event with retry and conflict; reset; a separate run; and a restarted process |
| CI job, reproduced | `wirewalk: PASS`, on both | `node runtime/ci/verify-submissions.cjs . <out> a4bce02…`, the command of the `public-runtime` job; it selected `wirewalk` only (`full: false`) |
| Real-MCP walkthrough | 134 checks passed, 572 calls traced, on both ([node22](wirewalk/mcp-walkthrough.node22.json), [node18](wirewalk/mcp-walkthrough.node18.json)) | What the verifier does not exercise for this App: the three approved requests and the delivery proof, run with real Calendar, two real Mail instances (a sending mailbox and the user's inbox) and real Messaging. Each scenario runs under its own run ID: train eastbound and westbound; train eastbound with no grant and with a lost acknowledgement; wildfire; its delayed-turn variant; its cutoff variant and control; markets with two readers; and paging. It also covers both bookmark writes, replays, `idempotency_conflict`, `stale_version`, a concurrent write, rejected events, the task data rebuilt and loaded directly, and reset of data and clock per instance. Every call is joined to run, App, account, connection, request or event ID and Core version, and the retained Core audit rows join back to it |
| Evaluation dataset over real MCP | 24 checks passed, on both ([node22](wirewalk/dataset-demo.node22.json), [node18](wirewalk/dataset-demo.node18.json)) | `examples/dataset-demo.cjs` loads `data/evaluation/seed.json` with its own `dataset.json` and asset catalog in one `env.load_seed` request (558,381 bytes), queries it at 2025-03-15, advances the clock to the dataset clock and to 2026-12-31 with `env.advance_time`, and queries again; nothing dated after the clock is visible and no record changes |
| Dataset coverage | 645 distinct dates in 24 of 24 months ([coverage.json](wirewalk/coverage.json)) | `dev/coverage-report.cjs --json` over the delivered file; details below |
| Repository suite | 22/22 stages passed, on both ([node22](wirewalk/reference-suite.node22.json), [node18](wirewalk/reference-suite.node18.json)) | The unchanged public suite (`npm test`) with this package present |
| Independent base validator | Passed, 40 checks ([report](wirewalk/base-runtime.json)) | An unmodified export of `main` at `a4bce023953061483c41de5a287ba5e43f4a5648`, the PR's base, validated the candidate checkout with its own `runtime/ci/verify-submissions.cjs`. It selected `wirewalk` only |
| Package identity | `92d454d03bf5b7d9519b15c3279cbbd2fe24763a50f50fe5e6e39028df3f01a7` | The same package hash appears in the two verifier reports, the base validator report, the two walkthrough reports and the two dataset reports. Git tree `6349ee36b79608713af239c67ca8c64690bc71cb` |
| Human review | Pending | Realism of the posts and threads, including the generated dataset; legibility of the rendered board image; that the accounts, people, places, agencies and companies are fictional |

## Reproduce

From the candidate checkout, with Node 18 or 22 and nothing to install:

```sh
cd apps/wirewalk && npm test && npm run example && cd ../..
npm run app:verify -- --app apps/wirewalk --output .artifacts/wirewalk.json
node runtime/ci/verify-submissions.cjs . .artifacts/submissions a4bce023953061483c41de5a287ba5e43f4a5648
node apps/wirewalk/examples/mcp-walkthrough.cjs > .artifacts/wirewalk-walkthrough.json
node apps/wirewalk/examples/dataset-demo.cjs > .artifacts/wirewalk-dataset-demo.json
node apps/wirewalk/dev/coverage-report.cjs
npm test
```

**Package alone.** Copy `apps/wirewalk/` to an empty directory and run `npm test` and `npm run example` there.

**Generated files.** Run `npm run build:fixtures`, `npm run build:contracts` and `npm run build:dataset` in a copy and compare it with the original.

**Walkthrough dependencies.** The walkthrough needs the checkout's Mail and Calendar packages, and refuses to run unless both are 1.3.0 (W1).

**Independent check.** Run this from a separate export of the base revision:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports a4bce023953061483c41de5a287ba5e43f4a5648
```

The base export was not modified and nothing in it came from the candidate.

## Workflow evidence

Each row reads: starting state → action → observed result, then a control that must leave state unchanged. "B" numbers are the business tests in `apps/wirewalk/tests/business.test.cjs`, in run order; "W" numbers are the walkthrough checks in the reports above.

- **Fixture reader:** Priya Raman (`ww-priya`). The fixture clock is Saturday, Oct. 10, 2026, 21:10 Pacific.
- **Task-data reader:** Dario Mendes (`ww-dario`), on Monday, Oct. 12 at 18:00.
- **The reference agent:** a scripted agent acts at each turn. It uses only what its MCP reads return, and remembers between turns only through its own Sent folder.

| Workflow | Starting state → action → observed result | Failure or control | Where |
| :--- | :--- | :--- | :--- |
| Local news (train) | **Setup.** Two runs share the same feed and differ only in the Calendar itinerary: a concert ending 23:00, and a ride home "Green Line eastbound" or "westbound" from Fennick St, a 15-minute walk. The operator's schedule (`p01`) gives both last trains as 11:40 pm, and a rider's cropped board photo (`p05`) shows "11:40 PM GREEN LINE / CANCELED". **Turns.** The 21:10 turn sees the photo and its three quotes but no operator statement, and sends nothing. Infra then applies the approved event: the operator's reply `p19` at 21:12. At the 21:13 turn the eastbound rider gets one email, "Leave the show by 10:40 pm for the last eastbound train", quoting and linking `p19`. The 22:30 turn sends nothing more | The westbound inbox and Sent folder stay empty through 23:00. Before injection `p19` is unavailable; a seeded post dated after the clock and an unknown ID get the same response | B3, B4, B15; W7–W14, W20–W22 |
| Proving delivery (Mail) | **Send.** The agent drafts and sends from the sending mailbox with Mail's own tools. **Relay.** The host reads the committed Sent record, builds the wire message with Mail's `notification()`, never the combined `send()`, and publishes through Messaging with a grant for the user's inbox. **Result.** The inbox record matches the Sent record (recipient, sender, subject, body, unread), arrives at the turn time and reads back through `mail.get`, and the receiver's `env.event_status` joins it. The live wire equals `examples/mail-wire.json`, which names the sender account, the explicit recipient account, source message `draft-1` and time 21:13 | **Replays.** The same request, and the same CloudEvent under a new request ID, return the original receipt as a duplicate. **Conflict.** Changed content under a used request ID is `idempotency_conflict`. The inbox still holds one record. **Counting.** Three committed publish responses count as one logical delivery | W15–W19, W23–W27, W134; the same delivery checks in W55–W64, W73–W77 and W93–W97 |
| Refused grant and unknown acknowledgement | **No grant:** Messaging returns `recipient_not_authorized`; the Sent record exists and the inbox is empty. **Lost acknowledgement:** an in-process Router loses the receiver's acknowledgement after the inbox commits. It returns `unknown` / `receiver_unconfirmed` with the attempted event ID and no commit time, and the runner halts | Reconciliation through `env.event_status` finds the receiver committed. A retry after the halt gets `run_halted` and adds no second record | W35–W43 |
| Markets | **Setup.** Dario has bookmarked two analysts' threads. **Action.** The agent reads both threads, the reposts and the company notice. **Reply.** It quotes verbatim: the company's 12% figure; each analyst's reading (repeat orders; distributors filling shelves early); each analyst's sentence naming the next-quarter reorder figure; and each "not out yet" sentence. The 12 reposts trace to Odile Park's thread (`p29`, `p30`), so they count as one source. The reply is kept in `reference_replies.markets` | Every quote is checked against that analyst's own posts in Infra's snapshot, not against the reply template. The reposts are counted from tool output. No post reports the reorder rate | B17; W103–W108 |
| Current events (wildfire) | **Setup.** Priya at Sunday 14:30 has seen the 2 pm bulletin: a warning for Pine Hollow and no notice for Lakeview. **Events, then turns 15:11–20:16:** a repost and a quote at 15:10; the Pine Hollow order at 16:20; the Lakeview warning and a repeat of the Pine Hollow order, both at 18:05; and a Pine Hollow zone change at 20:15. **Result.** Exactly two emails: at 16:21 the Pine Hollow order (`p24`, issued 4:20 pm), and at 18:06 the Lakeview warning (`p25`, issued 6:05 pm), each linking the county post | The recirculated bulletin sends nothing. The repeated order is not re-alerted. The 20:16 turn sees the 8:15 post and sends nothing after the 8 pm cutoff | B16; W44–W66 |
| Delayed turn and cutoff | **Delayed turn:** the agent is resumed once, at 18:10, after both 18:05 bulletins. It sends one email with the latest status and source per area: `p24`, repeated by `p26`, and `p25`. **Cutoff:** the cutoff run and its control are identical except for the user's cutoff, 8 pm against 9 pm | At 20:16 the 8 pm variant sees `p27` and sends nothing. The 9 pm control emails the Pine Hollow zone change from `p27`. So the cutoff is what suppresses the email | W67–W97 |
| Reader operations | **Feed and search.** The feed and search sort newest publication first, with the post ID breaking ties. Search matches the start of words in post text, alt text and link cards, ignoring case and accents. **Traversal.** From a search hit, the quote's source and its later replies are one step away. A thread shows ancestors and replies; account inspection counts only public posts | Reads change nothing. An unknown post and a not-yet-public post get the same `not_found`. A query with no letters or digits, or a reversed time window, is `invalid_arguments` | B1–B3, B6, B12, B18; W2, W8 |
| Stable paging | **Setup.** A first page of county posts after `p25` at 18:05. **Action.** `p26` arrives at the same 18:05. **Result.** The cursor's next page stays on the original set; a fresh search leads with `p26` | A lower-ID post at the same time, which would sort into the remaining pages, is kept out too. A seeded post that becomes public later is kept out. A forged count, another query or a differently refilled feed: `invalid_arguments` | B8–B11; W133 |
| Bookmarks and isolation | **Add.** `wirewalk.bookmarks.add` returns `{post_id, bookmarked, changed}` only. **Persistence.** After Infra advances the clock, a new Agent connection lists the same bookmarks. **Isolation.** Priya never sees Dario's bookmarks, and the tools take no `account_id` argument | Byte-identical retries of an add and of a removal return the original result as a duplicate. A reused request ID is `idempotency_conflict`. A stale add and a stale removal are `stale_version` with the set unchanged. Two writes against one version: one commits, one is stale. An unknown post is `not_found`. The package's default `scenario` policy denies both writes, so a task grants them in its own policies | B13, B14; W3, W109–W123 |
| Events | `post.publish` adds an original, reply, quote or repost, public from the event time. The approved example applies verbatim, and the parent's reply count and conversation include it | Each of these is `invalid_event` with state unchanged: an unknown author or referenced post; a reference to a later post or to a repost; the wrong relationship field; text on a repost; a second repost by the same account; an already-published ID. A replayed event ID leaves one reply; changed content under it is `idempotency_conflict`. The Agent cannot inject posts | B4, B5; W4, W9–W10, W124–W126 |
| Seeds, image, reset and records | `examples/task-data` (Dario, 44 posts) equals the minimal history plus the seven example events. It is rebuilt over MCP and also loads directly with its own dataset and catalog. Reset restores the loaded history, bookmarks and clock of that instance: after the train-east reset `p19` is unavailable again | Inconsistent seeds are refused (`invalid_seed`). A seed loaded before its latest record still loads, and its later posts stay hidden. Core refuses a bundle without the image bytes, or a post naming an uncatalogued image (`invalid_bundle`), with state unchanged. The PNG's pixels equal a render of its alt-text lines | B7, B19, B20, B22; W5–W6, W28, W30–W34, W98–W102, W130–W132 |
| Evidence join and counting | **Audit join.** Each MCP client is named after its trace connection, and Core stores that name in each audit row. Every retained audit row joins one trace row by connection, tool, request or event ID and status: 21 of 21 for train-east, 29 of 29 for Dario. **Retention.** A snapshot is kept before each reset | Successful replays add no audit row; denials are separate rows with `decision: "deny"`. A logical write is counted once however often it is replayed | W29, W127–W129, W134 |

## Evaluation dataset and clock cutoff (added after plan approval, #260)

The plan was approved on 2026-11-24; #260 published the Environment data rule on 2026-11-25. This scope was added after the plan was approved, to meet the Environment data rule in `docs/submission-evidence.md` sections 3 and 4 and the reviewer's request for a separate, versioned two-year feed with a reproducible count.

**Clock cutoff.** Agent tools show only records dated at or before `ctx.virtual_now`. Nothing is stored for the cutoff; later records appear when `env.advance_time` or an event moves the clock, and no record changes.

| Record | Date field | Class | Before the clock reaches the date |
| --- | --- | --- | --- |
| `posts` | `published_at` | happened in the service | `not_found` by ID for reads and bookmark writes; absent from the feed, search, threads, relationship lists and counts, account post counts and cursors |
| `accounts` | `joined_at` | happened in the service | `wirewalk.account.get` returns `not_found` |
| `bookmarks` | `saved_at` | happened in the service | absent from `wirewalk.bookmarks.list`; the post shows `bookmarked: false`, `saved_at: null` |

- **No scheduled fields.** Wirewalk has no scheduled or descriptive date fields.
- **Bookmark visibility is new in this change.** Post and account visibility already worked this way.
- **Agent add before a later seeded bookmark:** the agent's bookmark replaces the seeded one, leaving one record dated now.
- **Agent remove before a later seeded bookmark:** returns `changed: false` and keeps the seeded record, which is the approved contract for a post that is not bookmarked.
- **Events:** `post.publish` is unchanged.
- **Schemas and error codes:** no tool schema, event schema or error code changed.
- **Tests:** `tests/business.test.cjs` adds four tests (the fourth checks the event-dependency list):
  - an early-clock regression on `examples/task-data` (Dario at 12:00 Monday: reads hide the later reposts and bookmarks, writes on later posts return `not_found` with data unchanged, and moving the clock to 18:00 reveals them with data unchanged);
  - an agent bookmark that replaces a later seeded bookmark;
  - the evaluation dataset at four clocks, with its `dataset.json` counts and sha256 checked.

**Dataset.** `apps/wirewalk/data/evaluation/`, dataset `wirewalk-evaluation-2025-2026` version 1.0.0.

- **Seed:** `seed.json` (its sha256 is recorded under the generated source's `generation.parameters.outputs` in `dataset.json`, which a test validates against the dataset schema), sha256 `2fb3a768836b166b4e728fa197e10e11fb857654fe06fe43df52096cdb2894be`, one record per line, 505,511 bytes as compact JSON.
- **Records:** 23 accounts, 1,864 posts and 127 bookmarks of reader `ww-priya`. The 14 fixture accounts, 37 fixture posts and the fixture bookmark are included verbatim.
- **Event posts:** the seven event posts in `examples/scenario.json` and `examples/wildfire-events.json` are not in the seed and still apply as `post.publish` events. Two storylines continue after Oct. 12, 2026 as if those events had been applied: the Green Line 11:40 pm cancellation (8 posts from Oct. 13 07:10 PDT, needing `rail-reply-01`) and the Cinder Fork Fire evacuation order and aftermath (49 posts and the `cinder-fork-recovery` account from Oct. 13 09:00 PDT, needing the six wildfire events). The markets storyline needs no event. `data/evaluation/event-dependencies.json` lists every such post with the events its storyline needs and the storyline's `first_dependent_at`, and `dataset.json` and the App README state the rule: a Task that omits a storyline's events must end its history and run before that time, or drop the listed posts and accounts. A test checks the list against the events, closes it under replies, quotes and reposts, and validates the seed with the listed records dropped. An earlier clock alone does not make the dataset fit a different event history. Generated posts skip Oct. 10-12, 2026.
- **Dataset clock:** `2026-10-10T21:10:00-07:00`, the fixture clock. The reader's bookmarks end at it. Public posts continue to 2026-12-31, and one account joins on 2026-10-14.
- **Provenance:** every record is synthetic.
  - 52 records are copied from the authored fixture (`authored`): 14 accounts, 37 posts and 1 bookmark.
  - 1,962 are generated by `dev/build-dataset.cjs` (`generated`: template, PRNG seed 20261010).
  - Of the 1,996 counted records, 38 come from the fixture and 1,958 are generated.
  - All accounts, people, places, agencies and companies are invented, so there is no real November 2026 anchor.
- **Counting method:** dates are counted in America/Los_Angeles on `posts.published_at`, `accounts.joined_at` and `bookmarks.saved_at`.

| Measure | Value |
| --- | --- |
| Records / counted / excluded / invalid | 2,014 / 1,996 / 18 (accounts that joined before 2025) / 0 |
| Global distinct dates | 645 (2025-01-01 to 2026-12-31), 24 of 24 months |
| Distinct dates on or before the dataset clock | 577 |
| Window days without a record / longest gap | 85 / 3 days (2026-02-05 to 2026-02-07) |
| Records after the dataset clock | 253 posts, 1 account join, 0 bookmarks |
| Identical texts / pairs at word 5-gram Jaccard >= 0.8 / highest | 0 / 0 / 0.588 |

Per-source and per-month tables, the gap list and the exclusions come from the report command below.

**Reproduce.** From `apps/wirewalk/`:

```sh
node dev/build-dataset.cjs          # rewrites data/evaluation/; byte-identical on rerun (checked on Node 22 and 18)
node dev/coverage-report.cjs        # Markdown report; --json for the same numbers
npm test                            # includes the dataset test: counts, sha256, four clocks, the seven events applied on top
node examples/dataset-demo.cjs      # real MCP: env.load_seed in one request, queries at three clocks, env.advance_time
```

**Results.**

| Command | Node 22.23.2 | Node 18.20.8 |
| --- | --- | --- |
| `npm test` | 26/26 | 26/26 |
| `node runtime/cli.cjs verify --app apps/wirewalk` | passed, 40 checks | passed, 40 checks |
| `npm run walkthrough` | passed, 134 checks (same checks as before this change) | passed, 134 checks |
| `node apps/wirewalk/examples/dataset-demo.cjs` | 24 checks; load request 558,381 bytes | 24 checks; load request 558,381 bytes |

All reports carry package sha256 `92d454d03bf5b7d9519b15c3279cbbd2fe24763a50f50fe5e6e39028df3f01a7`, runtime 1.6.0 and Core API 1.2.0.

The demo checks:

- `env.load_seed` accepts the whole dataset with its own `dataset.json` (which follows `schemas/dataset.schema.json`; the seed's sha256 is under the generated source's `generation.parameters.outputs`) and its own asset catalog;
- Core stores every record;
- at 2025-03-15, at the dataset clock and at 2026-12-31 23:59, the feed total equals the posts published by then, and the next later post is `not_found`;
- bookmarks show only those saved by then, and `cinder-fork-recovery` is `not_found` until Oct. 14;
- at the dataset clock the feed opens on fixture post `p18` and the latest bookmark is `p01`;
- each `env.advance_time` changes no record.

**Added scope against the approval baseline:** the dataset with its three scripts and `event-dependencies.json`, bookmark visibility by `saved_at`, and a larger package: 1,085,945 bytes of tracked files under `apps/wirewalk/`, up from 399,371, mostly `data/evaluation/seed.json`.

## CI and the base validator at the submitted revision

The v1 review asked for an independent validator or CI result at the exact submitted revision, or a statement of what is unavailable.

- **Official PR CI: not available yet.** The fork's `App runtime validation` run for this revision has status `action_required`, waiting for a maintainer to approve it; until then GitHub reports no `public-runtime (18)`, `public-runtime (22)` or `base-runtime-compatibility` result for it. The first submission's head, `3eb7219`, changed only `docs/validation/` and got no run of that workflow; its only run is on `a24e611`, also waiting for approval.
- **Independent base validator: available.** An unmodified `git archive` export of `main` at `a4bce023953061483c41de5a287ba5e43f4a5648`, the PR's base, ran its own `runtime/ci/verify-submissions.cjs` against this checkout and passed with 40 checks: [wirewalk/base-runtime.json](wirewalk/base-runtime.json). The command is under Reproduce.
- **CI job command, reproduced locally:** `node runtime/ci/verify-submissions.cjs . <out> a4bce02…` printed `wirewalk: PASS` on Node 22 and 18.

## Plan and implementation

Everything in the plan's first version is implemented:

- the 8 operations it describes (6 reads, 2 writes) and the `post.publish` event;
- the state and lifecycle rules;
- one local PNG with alt text;
- a fixture for one reader and task data for a second;
- evidence for the three example requests and the delivery proof.

The README has the operation list, the rules, the data a task can use for each workflow and a proposal-item-to-evidence table.

The plan's open question was settled in review: Wirewalk is a standalone reader rather than an extension of Postyard (#168). Belltower (#172) remains related, independent work.

Where the implementation adds to the plan's wording:

- Search also covers image alt text and link cards, and reposts appear only in filter-only searches. A query with no letters or digits, or a `since` later than `until`, returns `invalid_arguments`.
- Every post has a stable link, `https://wirewalk.example/@<author>/posts/<id>`. Link cards stay on the reserved `.example` domain.
- `post.publish` carries text and link cards but not images, and a post's publication time is the event's `at`.
- A seed may carry posts dated after the run clock, so one seed can hold a whole storyline. They stay hidden until the clock reaches them, as do accounts that join later and bookmarks on posts that are not public yet. Wirewalk does not compare seed dates with the clock, because Core validates package fixtures when it registers them, under the registry's own clock.
- `wirewalk.thread.get` on a repost opens its source's conversation.
- Bookmarks have set semantics: adding an existing bookmark, or removing a missing one, succeeds with `changed: false` and changes nothing.
- An account reposts a post at most once. Replies, quotes and reposts must point to a post that is not itself a repost.
- A cursor stores the first page's clock, the number of posts public then and the ID of the last of them, so its result set cannot be widened or reused on a different feed.
- The post and account tools take `id`, so Core's policy `constraints.ids` can narrow them per object. The plan promises no per-object narrowing, so Wirewalk adds no App-side policy checks.
- Wirewalk declares no messaging and pins no App. The plan makes Mail and Calendar scenario dependencies (§3), and the integration guide puts a scenario-specific recipient in the run assembly. The alerts are ordinary Mail messages relayed over Mail's own Mail-to-Mail channel.
- The fixture has 14 accounts rather than "roughly 12", because six of them carry the dozen reposts.
- The walkthrough's reference replies are evidence for the data and tools, not model trials. Code assembles every reply from tool output:
  - the train and wildfire emails quote the operator's or county's post, and compute times from the posts and the Calendar event;
  - the markets reply quotes each analyst's sentences verbatim.

  The connecting words come from the script. Checks compare each reply's facts with the posts and the inbox records, not with that wording.

The approval review left three suggestions for implementation. All are resolved:

1. **Evidence join.** The trace joins Core's audit rows by connection, tool, request or event ID and status (W29, W127). A replay is counted once (W129, W134), and denials stay distinguishable (W128). A snapshot is retained before each reset. A delivery joins the Mail Sent record, the CloudEvents source and ID, the Messaging receipt, the inbox record and the receiver's `env.event_status` (W15–W19).
2. **Mail wire fixture.** `examples/mail-wire.json` is one complete plain-text Mail message, built by Mail's own `notification()` from the Sent record the train-east agent committed. It names:
   - the sender account (`mail-assistant`);
   - the explicit recipient account (`app_account_ref` to `mail-priya`);
   - the source message ID (`draft-1`);
   - the event time.

   The relay reuses the committed record (W23–W24) and halts on an unknown acknowledgement (W40–W43).
3. **Same-timestamp paging.** A post that arrives at a first page's timestamp stays out of that cursor's traversal while a fresh search sees it (B8–B10, W133).

## Package boundary

The package imports only Node built-ins and its own files:

- `service.cjs` is the provided launcher and the only file that loads the runtime.
- The optional diagnostics adapter carries IDs only and cannot change business results (B21).
- `tests/schema-validator.cjs` is a copy of the public validator.
- `tests/board-image.cjs` renders and decodes the board image; the tests and `dev/build-fixtures.cjs` share it.

Only the walkthrough reads files outside the package; the business tests, `examples/run.cjs` and the verifier never do. It finds the checkout by walking up from its own directory, or through `PALE_RUNTIME_ROOT`, and loads these scenario-only files:

- `runtime/prepare.cjs`, `runtime/client.cjs`, `runtime/verify.cjs` (`digestTree`) and `runtime/package.json`;
- `runtime/messaging/service.cjs`, spawned as the sending mailbox's publisher connection;
- `runtime/messaging/src/router.cjs`, in-process for the lost-acknowledgement run only, as `runtime/messaging/tests/test_time_trace.cjs` does;
- `examples/registry.mail.json` and `examples/registry.calendar.json`, which start the real packages;
- `examples/apps/mail/app.json` and `examples/apps/calendar/app.json`, for the version check (W1);
- Mail's notification builder, `examples/apps/mail/src/publisher.cjs`, which the approval review names and `examples/workflows/mail-to-mail/run.cjs` also uses.

Nothing from Mail or Calendar is copied into the package; the walkthrough assembles their seeds, as a task would. Only `apps/wirewalk/` and this report are added; no registry or runtime file is changed.

## Data and licence

The package data:

- **Minimal fixture.** `fixtures/minimal.json` (15 KB) holds 14 invented accounts and 37 posts in three storylines from Saturday to Monday, Oct. 10–12, 2026, with one reader's bookmark.
- **Example events.** `examples/scenario.json` (the plan's event, verbatim) and `examples/wildfire-events.json` add 7 posts by event.
- **Task data.** `examples/task-data/` holds the second reader's seed (44 posts), binding, policies, dataset and asset catalog.
- **Image.** One PNG, `assets/fennick-board-crop.png`: 605×125, 35,765 bytes, SHA-256 `990d12006ca3c6ea164261a7242db480af27cc1dab31f99ad2334150cc1a5c7d`. `tests/board-image.cjs` renders it from the two lines quoted in the post's alt text; in the story the rider posts it as a photo. A business test decodes it and compares its pixels with a fresh render of those lines (B7).
- **Generator.** `dev/build-fixtures.cjs` rebuilds all of the above.
- **Evaluation dataset.** `data/evaluation/` holds the 2025-2026 dataset described above (1,864 posts, 23 accounts, 127 bookmarks), rebuilt by `dev/build-dataset.cjs`, with `event-dependencies.json` beside it.

All text is original and fictional. Nothing was crawled, copied, translated or adapted, and every link is on the reserved `.example` domain. Provenance is in `contribution/dataset.json`: source `authored` (manual) for the text and `rendered-board` (procedural) for the image. Code, fixtures and the image are under the repository's MIT License. The code, fixtures and this report were prepared with AI assistance (Claude); the author reviews them and is accountable for them.

In `wirewalk/reference-suite.node*.json`, report paths inside stage commands were rewritten from a local temporary directory to `.artifacts/`. No other report was edited.

## Not claimed, and what remains

- **No model-agent runs:** they are deferred for v1. The walkthrough's replies come from a scripted reference agent.
- **No Agent reads of the image bytes:** these need a platform resource-access registration under `runtime/registrations/`, which requires Infra review and is outside this package. The alt text carries the visible text, so tasks run on text reads.
- **No GUI or reviewer console:** MCP is the declared interface, as approved.
- **No production deployment.**
- **Remaining:**
  - independent maintainer reproduction and acceptance;
  - official PR CI on the implementation commit (`public-runtime (18)`, `public-runtime (22)`, `base-runtime-compatibility`), which waits on maintainer approval of the fork's workflow run;
  - human review of realism (including the generated dataset), of the image's legibility, and of the invented accounts, places, agencies and companies.
