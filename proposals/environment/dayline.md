# Dayline multi-outlet news reader

**Proposed PR title** — [Environment Proposal] [News & information] Dayline multi-outlet news reader

## 1. App and domains

- **Authors / GitHub handles (required):** @byshail
- **Reference app or website / URL (required):** Dayline is a fictional news reader. Google News is the reference for browsing coverage from multiple outlets. AP and CNN are references for the kinds of publishers represented. [Google News](https://news.google.com/) · [AP](https://apnews.com/) · [CNN](https://www.cnn.com/)
- **Primary domain (required):** News & information
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** Dayline lets a personal agent open several publishers’ accounts of the same event and see which editions the reader has already read or saved. A morning front page might carry a wire dispatch the reader saw last night under a new headline. Another outlet might run the same dispatch with a paragraph from its own reporter. Dayline exposes the bylines, credits, text and publication times that let the agent tell the reader what changed and give credit to the outlet that found it.

### Three example requests

| Reader request | What the reader and agent encounter | What a reviewer can check |
| --- | --- | --- |
| **Morning briefing.** “I’ve got five minutes. Give me one local story, one state story and one national or international story. I read last night’s headlines.” | Last night the reader opened a wire dispatch about a rail funding vote. Three morning editions carry it. The lead local edition adds an interview naming the first station to be repaired. The next local headline announces new weekend library hours. A state budget decision and an international election result lead the other requested sections. | The briefing covers three distinct developments. Its local item leads with the newly named station and credits the local interview. Reprints of the rail vote take up no extra slots. An alternate history where the reader already saw the interview tests whether the agent selects the other available local lead. |
| **Family travel.** “My sister flies out of Puerto Claro on Friday. The national paper says there’s an airport strike. What does the reporting there say about her flight?” | The national headline describes a countrywide dispute. A Spanish-language regional report says the confirmed Friday stoppage covers two named airports. Negotiations at Puerto Claro continue. A later English wire edition republishes the regional account. | The answer identifies what is confirmed at the two airports and what remains unresolved at Puerto Claro, cites the regional reporting and avoids promising that an individual flight will operate. The Spanish and English editions trace back to one report. |
| **Sports without spoilers.** “I recorded last night’s game. Save the full recap for later and tell me when my team plays next. Don’t give away the result.” | The sports desk publishes a recap whose headline reveals the winner, a pregame preview, and a separate schedule item. The task supplies the reader’s time zone. | The private reading list gains the full recap exactly once. The reply gives the next scheduled game’s local date and time. Its wording and any visible link text preserve the surprise. |

**Related work.** Belltower tracks revisions and which version a local outlet copied. It explicitly leaves grouping articles into a story outside its initial scope. Wirewalk follows quote posts and replies in public conversations. Dayline’s unit is a published edition within an editorial story group. A group can contain independent reporting, straight reprints and editions with local contributions. In the rail example, a single group contains the original dispatch, two straight reprints and the locally expanded edition. Only the expanded edition credits a station interview. The group is the editor’s navigation aid. The reader must still use text and credits to identify who reported each detail. Both proposals are related work and can run independently. [Belltower #172](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/172) · [Wirewalk #209](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/209)

## 3. Potential app connections

- **Internal personal apps (required):** None for the proposed workflows. The task supplies any itinerary details and preferred time zone in the user context. Saved editions and reading history belong to Dayline.
- **Other apps and websites (required):** None at runtime. All article links resolve to stable synthetic records in the app.

### Integration details

- **Operations and access (required):** Through MCP the agent can browse a regional or section front page in editorial order, search published editions, open a story group, read an exact edition, and list private history or saved editions. The agent can explicitly mark an edition as read, save it or remove it from the reading list. Reading an article on the user’s behalf leaves the user’s reading history intact unless the agent marks it read. An internal save returns the edition ID and save status, so the agent can confirm it without echoing a spoiler headline.
- **State and lifecycle (required):** A story group has a stable ID. Each edition records its outlet, section, geography, language, headline, text, byline, publication time and any explicit wire or local credit. New editions retain links to earlier editions when applicable. Each run loads its dated publications and front pages plus the bound account’s reading history and bookmarks. Saving twice leaves one bookmark. A stale write or an unknown edition ID leaves business state unchanged. Core checks request IDs and versions. Reset restores the loaded history, bookmarks, editions and clock. Infra can snapshot state for review.
- **Events and notifications (required):** Infra applies one proposed event, `edition.publish`, carrying an edition and its story and front-page placement. The edition becomes visible on commit, including when its publisher timestamp is earlier. Inserting it at position 1 shifts the other entries down and leaves their relative order intact. The runner controls timing. For example, the event below puts a local follow-up first on the local front page of a seeded rail story. An unknown story, outlet, or credited source edition causes the whole update to fail. Replaying an identical event ID creates no extra entry. Dayline sends and receives no cross-app notifications.
- **Shared data and dependencies (required):** Node.js 18+ and the public Core runtime, reference revision `a4bce02`. Public content belongs to the run fixture and private state belongs to the bound account instance. Fixtures ship as UTF-8 JSON with text in English or Spanish, synthetic bylines and stable IDs. Only publisher-disclosed credits are visible. Task authors keep expected briefing facts and spoiler checks in the evaluator. [Runtime](../../runtime/README.md) · [App contribution guide](../../docs/app-contribution.md)

```json
{
  "event_id": "rail-local-morning",
  "at": "2026-10-14T07:10:00-07:00",
  "operation": "edition.publish",
  "payload": {
    "edition_id": "rail-local-2", "story_id": "rail-funding", "outlet_id": "valley-daily",
    "section": "transport", "geography": "valley", "language": "en",
    "headline": "Eastbank will be the first station repaired", "byline": "Mara Bell",
    "text": "The board approved rail repairs Tuesday. In an interview with the Valley Daily, the project lead named Eastbank as the first station.",
    "credits": [{"edition_id": "rail-wire-1", "credit": "Wire service reporting on the vote"}],
    "published_at": "2026-10-14T07:05:00-07:00", "front_page": "local", "position": 1
  }
}
```

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Web / app construction | Build the MCP reader, editorial front pages, grouped coverage and private read/save operations. | Open one story from two sections, trace a credited edition, save and remove a recap, and check private state across two account instances. | 3–4 |
| Data and image collection | Author all text and metadata for the proposal. | Fixture manifest records authorship and language. External asset count is zero. | 0 |
| Synthetic data and assets | Write about 24–30 editions in 7–9 story groups across six fictional publishers or desks. Include local, state, national, international, wire and sports coverage. | Check every credit and edition link. Review Spanish and English text for consistent place names, dates and uncertainty. Seed two morning reading histories and a scoreboard-free schedule item. | 2–3 |
| App integrations | The three workflows run entirely inside Dayline. | Run with only Dayline and Core enabled. | 0 |
| Validation and reset | Test privileged event injection, version conflicts, repeat saves, reset, publication order and isolation. Exercise all three requests with the public runtime. | Publish commands, pinned versions and traces in the PR. Compare morning answers against what each account saw, check the airport facts and sources, and inspect both the saved recap ID and the user-visible sports response. | 2 |

- **Milestones, owners and dependencies (required):** Proposed owner is @byshail. Build the edition and reader-state model, then write the fixtures, then run the examples and reset checks. Estimated duration is about two working weeks for one contributor.
- **Resources and total effort (required):** Estimated 7–9 person-days. A local Node runtime and under 1 MiB of original text fixtures should suffice.
- **Scope boundary and open questions (required):** First version covers text editions, editor-assigned story groups, front pages and private reading state. Live ingestion, automatic clustering, paywalls, video and real game schedules are outside the proposed scope. The examples use fictional people, places and events. During review, confirm whether maintainers prefer the grouped-edition model in this standalone package or as an extension to Belltower.
- **License and external dependencies (required):** Proposed code and original fixtures use the repository’s MIT license. Publisher names and websites above serve as design references. The package requires no external accounts, licensed articles or network feeds.
