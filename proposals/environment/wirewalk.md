# Wirewalk public news feed

**Proposed PR title** — [Environment Proposal] [News & information + Social & communities] Wirewalk public news feed

## 1. App and domains

- **Authors / GitHub handles (required):** @byshail
- **Reference app or website / URL (required):** Wirewalk, a synthetic news reader inspired by [X (Twitter)](https://x.com/).
- **Primary domain (required):** News & information
- **Secondary domains (optional):** Social & communities

## 2. What you plan to build

**✍️ Your answer (required):** Wirewalk is a synthetic public feed for following a developing story. An agent can search posts, open a conversation, trace a quote or repost back to its source, inspect an account and save a post privately. A reply from the person or organization involved may arrive after a claim has already spread. The app preserves what was public at each point in the run so a reviewer can reconstruct what the agent could have known when it acted.

### Three example requests

| Request | What happens in the feed | Observable outcome |
| --- | --- | --- |
| **Local news.** “People are saying the last Green Line train is canceled. I’m at the show. Email me only if I need to leave early.” | At 9:05 pm a rider posts a cropped station-board photo. Three accounts quote it. At 9:12 the operator replies that only the 11:40 eastbound train is canceled. The last eastbound train now leaves at 10:55. The concert ends at 11:00 and the station is a 15-minute walk away. | Run the same feed with two saved itineraries. At the first agent turn after the reply, the eastbound rider should get one email with the 10:55 train and 10:40 leave-by time. The westbound rider should get zero emails through the end of the show. |
| **Markets.** “Ahead of Alder Glass earnings, read the two analysts I bookmarked. What are they actually disagreeing about, and what number should I look for on the call?” | Both analysts cite a 12% rise in shipments. One attributes it to repeat orders. The other thinks distributors filled their shelves early. A dozen reposts repeat the first analyst’s argument. | The briefing explains both interpretations, links each to its author and identifies the next-quarter reorder rate as the figure both say would distinguish them. That rate has yet to be reported. |
| **Current events.** “My parents are in Pine Hollow and we’re in Lakeview. I saw the 2 pm fire update. Can you keep an eye on both places until 8 tonight and email me if anything changes for either of us?” | In a fictional county, the 2 pm bulletin lists a warning for Pine Hollow and no notice for Lakeview. At 3:10 neighbors recirculate that bulletin. At 4:20 the county upgrades Pine Hollow to an evacuation order. At 6:05 it issues a warning for Lakeview and repeats the Pine Hollow order. | Two emails reach the user. The first identifies the new order for the parents’ area. The second identifies the new warning for the user’s area. Each links the corresponding county post and gives its issue time. The repost and the repeated order generate no duplicate alerts. |

These are illustrative workflows. Task authors supply the personal context, event schedule and success criteria. Wirewalk exposes post relationships and timestamps without labeling a claim true or deciding whether the user should be interrupted.

**Related proposals.** Postyard models public authorship, revisions and reach. Belltower models local coverage, notices and corrections, including copies of earlier reports. These examples use the same feed to decide when to interrupt someone, compare competing interpretations, and track changing notices across two family locations. The proposed addition is a reader’s private bookmarks combined with explicit quote-to-source and reply-to-parent links in a time-bounded public feed. The analyst comparison can be reproduced with two saved threads and a dozen reposts of one opinion. The count of reposts does not change the number of independent sources. Neither proposal is a runtime dependency. [Postyard #168](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/168) · [Belltower #172](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/172)

## 3. Potential app connections

**Internal personal apps (required):** The train example uses Calendar 1.3.0 to read the saved direction from the event title via `calendar.list` and `calendar.get`. Both alert examples use Mail 1.3.0 to draft and send plain-text email. The markets example uses only Wirewalk. These are scenario dependencies. Wirewalk itself uses only the shared runtime. Interfaces reviewed at `a4bce02`. [Calendar tools](../../examples/apps/calendar/tools.json) · [Mail tools](../../examples/apps/mail/tools.json)

**Proving delivery.** The example runner binds a sending mailbox and a separate inbox for the user. The agent drafts and sends from the first. The host relays the committed message through the existing Mail-to-Mail publisher with a grant for that recipient. The grader matches the receipt to the actual inbox record and checks recipient, content and timing. A denied grant should leave the inbox empty even if a sent record exists. An unknown acknowledgement pauses the run for reconciliation before any retry. Wirewalk observes neither mailbox. [Mail-to-Mail reference](../../examples/workflows/mail-to-mail/README.md) · [Mail receive declaration](../../examples/apps/mail/contribution/contribution.json)

**Other apps and websites (required):** X is an interaction reference. All accounts, posts, linked-item descriptions, links and media are fixtures. The analyst threads and county fire bulletins have stable synthetic post links. The examples can be completed from the posts and their link metadata without fetching external pages.

### Integration details

**Operations and access (required):** The agent uses MCP to list the feed, search visible post text, read a post or thread, inspect an account, and list, add or remove its own bookmarks. A quote preserves the quoting author's text and a reference to the quoted post. A repost points to its source. A reply records its parent. Search and thread reads return the author, publication time, stable post link and available relationships. Feed and search results sort newest first, with post ID as the tie-breaker. A cursor fixes the result set at the first page’s publication boundary. A fresh search includes newly published posts. Bookmarks persist across turns. The infra connection owns seed loading, event application, virtual time, reset and snapshots. [Public runtime](../../runtime/README.md)

**State and lifecycle (required):** Public records belong to the run. Private bookmarks belong to a bound account within that run. The agent cannot inject public posts or read another account’s bookmarks. Core version checks protect concurrent writes. A retried bookmark add or removal with the same request ID returns the original result. The pair of account and post IDs uniquely identifies a bookmark. Each bound account instance starts from the same synthetic public history plus its own bookmarks. The runner applies shared publications to each enabled instance before resuming agents. A snapshot captures the instance for inspection. Reset restores its loaded history, bookmarks and clock. A stale bookmark write leaves the set unchanged. Reload the current version before retrying. An unknown post ID or a future post has the same unavailable response.

**Events and notifications (required):** One proposed infra operation, `post.publish`, inserts an original, reply, quote or repost and makes it available to reads from that event onward. The app checks authors and referenced posts before committing. For example, the following event adds the transit agency’s reply to an existing question. Replaying the event ID leaves one reply. Wirewalk neither publishes nor receives cross-app notifications. The task schedules subsequent agent turns, and the agent decides whether to send an email. In the wildfire example, the runner resumes the agent after each listed update. A delayed-turn variant resumes it once at 6:10 pm after both county bulletins. The expected result is one email giving the latest status and source for each area. A fresh post after the 8 pm cutoff produces no email. The app has no alert queue or business timeout.

```json
{"event_id":"rail-reply-01","at":"2026-10-10T21:12:00-07:00","operation":"post.publish","payload":{"id":"p19","kind":"reply","parent_id":"p12","author_id":"green-line-ops","text":"Only the 11:40 pm eastbound is canceled. Last eastbound is 10:55 pm. Westbound service is on schedule."}}
```

**Shared data and dependencies (required):** Stable account, author and post IDs connect records within each run. The task binds the same synthetic user to Calendar, Mail and Wirewalk. Each image ships locally with alt text limited to what the crop shows. Ship one original PNG under 128 KiB with a stable asset ID and checksum. The board’s visible text is also in the post’s alt text, so the task runs through MCP text reads. Check the image and text agree. A missing image file fails fixture validation. The package runs standalone on the public Core runtime. The train test also loads Calendar and Mail. The wildfire test adds Mail only.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable and acceptance check | Person-days |
| --- | --- | --- | ---: |
| Web / app construction | Build the MCP reading and bookmark operations on Core. Model the four public post types, private bookmarks and stable pagination. | From a search hit, follow a quote to its source and read later replies. Add and remove a private bookmark and verify account isolation. | 3–4 |
| Data and image collection | All material is authored for the fixtures. | Record asset origin in the fixture manifest and verify every local reference resolves. | 0 external collection |
| Synthetic data and assets | Author three storylines, roughly 12 accounts and 35–45 posts including distractors, one cropped image and fixture link metadata. | Check thread links, dates, chronology, alt text and source identities. Check each analyst’s argument against their thread. Check the wildfire notices against the 2 pm baseline for each area. | 1–2 |
| App integrations | Use Mail in the train and wildfire runs. Bind the two alternative train itineraries through Calendar. | Compare the eastbound and westbound recipient inboxes against the same public event sequence. For the wildfire run, verify exactly two emails to the user, one for each change. Check the delayed-turn and cutoff variants separately. | 1 |
| Validation and reset | Exercise local business logic and public MCP access, history loading, replay, concurrent writes, cross-account access, invalid references and reset. | Publish reproducible commands and results against pinned app/runtime revisions. Verify the reply is absent before injection, appears afterward and disappears on reset. Compare bookmarks and recipient inbox records against expected results. Retain the final agent response for the markets comparison and use the supplied execution trace to check the evidence visible at each turn. | 2 |

**Milestones, owners and dependencies (required):** @byshail owns the app and example runs. Build the standalone reader and fixtures first, then test the train and wildfire integrations, then publish replay instructions and results in the same PR after design approval. Allow about two working weeks for one contributor.

**Resources and total effort (required):** Estimated effort is 7–9 person-days. A local Node.js 18+ runtime and small versioned fixtures should suffice. No paid data or service is required.

**Scope boundary and open questions (required):** The initial design covers reading and private bookmarks. Public posting by the agent, direct messages, recommendations, live X access and SMS delivery are outside the first version. Agent session scheduling belongs to the task runner. During design review, confirm whether maintainers prefer the reader capabilities as a separate package or an extension to Postyard given the shared post and thread concepts.

**License and external dependencies (required):** Proposed code, fixtures and original media use the repository’s MIT license. Synthetic handles and content ship with the package. No real posts, X assets or recordings are redistributed.
