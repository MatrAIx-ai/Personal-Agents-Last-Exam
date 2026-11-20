# Environment Track proposal

**PR title:** `[Environment Proposal] [News & information + Social & communities] Cornerpost local business reviews (Yelp-inspired)`

## 1. App and domains

- **Authors / GitHub handles (required):** Huawei Lin ([@huawei-lin](https://github.com/huawei-lin))
- **Reference app or website / URL (required):** Cornerpost, an independently branded synthetic local-business review site with no map. Yelp (https://www.yelp.com) is the public interaction reference; the review sections of Google Maps and Dianping are comparable. No third-party branding, data or assets are used.
- **Primary domain (required):** News & information
- **Secondary domains (optional):** Social & communities

## 2. What you plan to build

**✍️ Your answer (required):** Cornerpost is a resettable third-party source of business listings and customer reviews that sits outside the businesses it describes. A listing, its star average, an individual review, the reviewer's history, an owner reply and the business's own website are separate records that can disagree. The App stores what people wrote and when; it never labels a business as risky, summarizes reviews or recommends a choice. The agent decides what the evidence means for this user.

Many personal tasks start with "find me someone to do this" and turn on evidence the provider does not control. Without a shared source, each provider App would embed its own reviews, which makes them first-party and removes the cross-check. Cornerpost supplies that source once for any category a task loads: movers, contractors, clinics, restaurants, repair shops.

Five workflows, each complete end to end:

1. **Search and listing detail.** Search by category, text and area label. A listing shows name, text address, phone, website, hours, open/closed and claimed status, creation date, rating average, review count, and an optional external reference to the business's own App or registry record.
2. **Read reviews as evidence.** Sort by most relevant (default), newest, highest or lowest; filter by keyword or stars; page. Each review has rating, text, dates, optional photos, an optional dated owner reply, and the reviewer's profile: account age, review count and other reviews. Reviews flagged as not recommended appear only in a separate section and do not count toward the average or review count; the listing shows how many exist. The flag comes from the seed or an event, never from the App.
3. **Saved lists and notes.** Create, rename and delete lists; add or remove listings; keep a private note per saved listing, so a shortlist and its reasons persist across sessions.
4. **Contribute and correct.** Post, edit or delete the user's review, with optional photo; report another review and withdraw the report. One review per account per listing.
5. **Ask the business.** Post and delete a public question; read answers, which arrive as scenario events.

Core examples (precondition → action or event → outcome → control case):

| Workflow | Example |
| --- | --- |
| 1 | Two listings have near-identical names → `places.get` on each → different phone, creation date and external reference → an unknown ID returns `not_found`. |
| 2 | A listing averages 4.6 → `reviews.list` with `sort=newest` → the last eight reviews are 1–2 stars within six weeks → an unsupported sort is rejected. |
| 2 | A listing shows 4.6 from 31 reviews and "14 not recommended" → `reviews.list` with `section=not_recommended` → 14 reviews, 11 with 1–2 stars → the default call never includes them. |
| 3 | `lists.item.add` with a stale `expected_version` → rejected, no duplicate → a repeated `request_id` returns the original result. |
| 4 | `review.create` → review visible, average recomputed → a second create on the same listing is rejected and points to `review.update`. |
| 5 | `question.answered` event → answer visible with its date → replaying the event ID adds nothing. |

Illustrative downstream task: a user wants a car shipped at the lowest price. The cheapest company has a high average, but its newest and not-recommended reviews describe a price increase after dispatch, and a near-identical listing belongs to a different company. A companion Task proposal will define the person, the companies' behavior, the rubric and model trials; this App encodes no task's answer.

**Distinct scope:** by our reading of the proposal list on 2026-11-18, no Environment proposal provides an independent listings-and-reviews source, and News & information has no Environment proposal. Provider Apps such as [#5](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/5), [#40](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/40) and [#41](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/41) own bookings; Cornerpost owns none and can be referenced by any of them.

## 3. Potential app connections

- **Internal personal apps (required):** Mail, optional: a text notification when an owner replies to the user's review, a question is answered or a report is resolved, through Mail's declared receive contract in [PR #12](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/12). The same facts are readable in the App without Mail.
- **Other apps and websites (required):** None at run time. A listing's external reference is a stored ID, not a call; Cornerpost does not read or write another App's state.

### Integration details

- **Operations and access (required):** Agent-facing MCP business tools under the package contract proposed in PR #12. Reads: `places.search`, `places.get`, `reviews.list` (`section` = `recommended` or `not_recommended`), `reviews.get`, `reviews.photo.get`, `reviewers.get`, `questions.list`, `lists.list`, `lists.get`. Writes: `lists.create|update|delete`, `lists.item.add|remove|note`, `review.create|update|delete`, `review.report`, `review.report.withdraw`, `question.ask`, `question.delete`, each with `expected_version` and `request_id`. An optional read-only renderer serves reviewers; it is not an agent computer-use interface. Seed loading, reset, snapshot and event injection are Infra-only. Names are provisional until agreed at M0.
- **State and lifecycle (required):** One user account per instance. Seed: listings, reviewers, reviews, photos, replies, questions, and the user's existing lists and reviews. Per-run state: the user's lists, notes, reviews, reports, questions and applied-event IDs. Average and count are derived from visible recommended reviews, never stored. "Most relevant" is a documented deterministic function of rating, length, photo presence and age, with ties broken by review ID. Stale versions fail without partial writes. Reset restores the seed.
- **Events and notifications (required):** Task-scheduled, Infra-applied: `review.added`, `review.edited`, `review.removed`, `review.recommendation_changed`, `owner.replied`, `place.updated`, `question.answered`, `report.resolved`. Example: `{"type":"review.added","event_id":"ev-014","place_id":"pl-07","review":{"id":"rv-311","reviewer_id":"u-88","rating":1,"text":"Quoted one price, charged another after pickup was assigned.","posted_at":"2027-02-24T15:10:00Z"}}` makes the review visible and changes the average. Replayed event IDs have no effect. Outbound: the optional Mail notification only.
- **Shared data and dependencies (required):** Stable IDs for listings, reviewers, reviews, photos, questions and lists; UTC timestamps on the simulated clock; UTF-8 text; area as a text label. Photos are PNG or JPEG assets within the reference bundle limit (64 assets, 1 MiB); no OCR. Required: public Core runtime. Optional: Mail.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Package under `apps/cornerpost/`: manifest, about 22 tools, seed/state/event schemas, operations, ranking and aggregate rules. Optional read-only renderer with three views. | All five workflows run end to end with edit, delete, withdraw and error paths; the six core examples pass as business tests. | 4–5 |
| Data and image collection | N/A. No real listings or reviews are crawled or copied; real reviews are personal data. | Provenance record stating all content is original and synthetic. | 0 |
| Synthetic data and assets | One reusable fixture: 24 listings in 3 categories, about 40 reviewers, about 480 reviews (about 60 not recommended), replies on roughly 15%, 30 questions, about 20 small photos. Template-generated text, edited by hand. Tasks may replace it with their own seed. | Checks for near-duplicate text, date order, valid references and asset size; human review of 60 sampled reviews. | 3–4 |
| App integrations | Optional Mail notification for three events; external references as stored IDs. | An `owner.replied` event produces one message in the receiving Mail, verified from Mail's state and receipt; behavior is otherwise identical without Mail. | 1–2 |
| Validation and reset | Business tests for search, sorts, sections, filters, paging, lists, review lifecycle, reports, questions, stale versions, repeated request IDs and event replay. Public-runtime checks over separate Agent and Infra connections. | `npm test` and `app:verify` reports with exact versions; repeated reset gives identical state; management calls are rejected for the Agent; workflow-to-test mapping. | 2–3 |

- **Milestones, owners and dependencies (required):** Huawei Lin ([@huawei-lin](https://github.com/huawei-lin)) owns all workstreams. **M0:** design review, tool names and ranking rule. **M1:** schemas, workflows 1–2, fixture. **M2:** workflows 3–5 and events. **M3:** Mail notification, runtime verification, evidence. About 3 weeks part-time once the runtime contract is available. Blocking dependency: the runtime in PR #12; M1 follows the merged contract. Related: companion car-shipping Task proposal (TBD).
- **Resources and total effort (required):** 10–14 person-days; under $30 in model usage for text generation; no GPU, paid data or hosting.
- **Scope boundary and open questions (required):** Excluded: maps, coordinates and routing; live data; ads; an owner console; personalized ranking; review summaries or risk labels; any algorithm deciding which reviews are recommended; an agent computer-use interface. Open questions for design review: (1) is News & information the right primary domain; (2) will the 1 MiB asset budget grow, or should photos stay few and small; (3) should replies that depend on what the agent wrote live in the task's scenario script or a provider App (we assume the script); (4) is a reviewer-only renderer sufficient?
- **License and external dependencies (required):** Code under MIT. All listings, reviews, names and photos are original synthetic content released with the package; no real business, person or review is reproduced. Yelp, Google Maps and Dianping are cited only as public interaction references. No external service at run time.
