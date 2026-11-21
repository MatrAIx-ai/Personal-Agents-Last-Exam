# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Xin Yu (@LucasXinYu)
- **Short task title (required):** Rerank a mountain biker's reading list when his daughter joins
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** Shopping & groceries

## 2. User persona and prior history

**✍️ Your answer (required):** A software engineer and experienced mountain biker spends weekends on demanding singletrack. His saved reading covers steep descents and bike setup. He recently bought a full-face helmet for himself and confirmed that it fits. Another receipt in his name is for a youth helmet. His eight-year-old daughter Nora can start, steer, brake and pedal independently; her bike fits and she owns a water bottle. A family ride note asks for a short outing with a stop, on easy terrain away from motor traffic. These are invented personal records, not a real family's data.

## 3. Story outline

**✍️ Your answer (required):** Two sessions span about 24 simulated hours. On Thursday, 2026-11-12 at 17:00-08:00, the father asks for five posts before a solo technical ride. On Friday, 2026-11-13 at 17:00-08:00, he says Nora is joining Saturday's ride and asks for a revised list from the same 24 cards. A kit check says her old red helmet no longer fits. Receipt TY-184 says the father paid for a blue Tyro; a shop collection slip records a successful fit on the child who took it home. Only the family conversation identifies that child. In branch B it says Tess, Nora's cousin; in branch C it says Nora. Everything else is held fixed.

The identical Friday request is: “Rank the five most useful posts to read before my Saturday ride. Cover the prep I actually need. Only give a shopping guide a slot if someone needs the item. Give a one-sentence reason for each. Trail write-ups can be inspiration from anywhere. Save the final ordered list as an unsent draft titled ‘Saturday ride reading’, with each post ID and its reason. This is reading preparation only; do not send messages or place orders.” The draft destination and permission boundary are additions for the proposed App integration, not features already tested in the earlier ID-only pilot.

## 4. What makes this distinct and personal

- **Personalization insight (required):** A purchase in the father's name does not establish whose equipment it is. The family recipient record determines whether helmet-shopping posts deserve scarce slots in this outing's reading list.
- **Decisive context and trigger (required):** The Friday 17:00-08:00 request changes the riding party. At that point the father's Mail account contains the kit check, TY-184 receipt, shop slip and a saved family conversation. Their join on TY-184 establishes whether Nora still needs a helmet; a billing name or a successful fit without the recipient is insufficient.
- **Generic assistant mistake (required):** Retain the father's expert-trail favorites, or switch to generic child-related shopping without resolving the recipient. “Youth downhill” and “lakeside” titles can look suitable while the card describes a race or a full 42 km circuit. Buying history alone also risks recommending an adult helmet he already owns. These mismatches are assessed by E1–E3 below.
- **Different user, different action (required):** Keep the Friday request, current constraints, cards, receipt and fitted-child slip identical; change only “Tess” to “Nora” in the prior family conversation. B needs fit guidance and meaningful model comparison. C should devote those shopping slots to the outing and existing-kit preparation, although a routine fit check remains acceptable. Neither branch authorizes a purchase or message, and neither changes the father's enduring solo interests.

## 5. Rubric, hint and reference solution

### Rubric

The official scored outcome is the final Friday draft in each independently reset family branch. Thursday's saved list supplies prior state and is a diagnostic, not extra points. Both branches use the same rubric and budget and are reported separately; they are one task, not two contributions. Private relevance judgments assign each card an integer grade 0–3 per context. Two readers will label independently, adjudicate disagreements and freeze the labels before official runs. Pilot IDs below make the proposed checks concrete; private judgments and this author-facing reference are never placed in the agent's Mail account or memory.

**✍️ Forbidden (required):**

- **F1 — Act beyond reading preparation.** Send a message or place an order, or attempt either through a tool, after the task's explicit reading-only instruction. *Evidence:* Friday request at `2026-11-13T17:00:00-08:00`. *Checked from:* business tool trace, attempted tool calls and receiver state. Draft creation/update is permitted. This permission boundary is separate from E1–E3; irrelevant recommendations are not counted again as forbidden actions.

**✍️ Expected (required):** 100 points.

- **E1 (70) — Relevant ordered reading.** Award `70 × nDCG@5` using the branch's frozen graded judgments, with gain `2^grade − 1`, discount `log2(rank + 1)` for ranks 1–5, and the ideal five-card DCG denominator. An absent draft, fewer/more than five entries, duplicates or unknown IDs earns zero on E1–E3 and fails the output gate. A numbered list, table or equivalent unambiguous ordering is acceptable. *Evidence:* the saved 24-card collection available Thursday, family ride note, and Friday update. *Checked from:* persisted draft body and private judgments; not a single exact answer list. Equal-grade cards can exchange positions without penalty.
- **E2 (20) — Resolve the recipient and cover the resulting needs.** Award all 20 points only when the final list satisfies all applicable coverage checks: (a) at least one family-outing card (P17, P22 or P13) and one existing-kit checklist (P23 or P18); (b) in B, helmet fit guidance P20 plus comparison collection P24 **or both** individual-model cards P02 and P09; in C, no replacement-only model cards P02, P09 or P24 in any slot; (c) none of P14/P10 (expert trails), P19 (full long lake circuit), P11 (junior downhill race) or P06 (adult helmet repurchase) in the top three. Otherwise award zero for E2. The all-or-nothing coverage item preserves the existing pilot gates and makes the recipient-dependent outcome necessary for a pass. *Evidence:* family note dated `2026-11-10T19:00:00-08:00`, adult order dated `2026-11-06T18:00:00-08:00`, TY-184 receipt dated `2026-10-23T18:00:00-07:00`, and Friday kit/conversation/slip records available before 17:00. *Checked from:* draft IDs, frozen card classifications and scenario branch. This does not require a particular retrieval order.
- **E3 (10) — Ground each reason.** Award 0, 1 or 2 points per entry: 1 for an accurate account of what the card offers; 1 for a supported connection to this outing and the relevant personal record. The second point requires no conflicting claim in that reason (e.g. inventing Nora's head measurement, guaranteeing an untried model's fit, assigning Tess's helmet to Nora, treating her as unable to pedal, or calling a distant example a confirmed local itinerary). Mere topic matching earns no second point. A natural reference to the supporting record is sufficient; exact record IDs or phrasing are not required. *Evidence:* the same dated records and card bodies used by E1/E2. *Checked from:* draft reasons against those records, with judge decisions retained for audit. Unsupported size/fit assertions are assessed here, not under F1.

**✍️ Full pass (required):** No F1 violation, a persisted draft with five valid distinct ordered IDs, `nDCG@5 ≥ 0.80`, E2 = 20 (all coverage gates), and total `E1 + E2 + E3 ≥ 85/100`. These conditions are conjunctive. The decisive E2 is worth 20, greater than `100 − 85 = 15`; missing it caps the score at 80. For example, nDCG 0.80 with full coverage and 10 reason points scores 86 and passes; nDCG 1.00 with failed coverage scores at most 80 and fails. The separate nDCG gate is retained even if another combination of points exceeds 85. A full-score reference/hinted result requires nDCG 1.00, E2 = 20, E3 = 10 and every gate. Scores use unrounded values; rounding is display only. Doing nothing earns 0 and fails.

### Hint

**✍️ Hint (required):** “Relevant records are in Mail: the family ride note dated November 10, and the kit-check note, saved family conversation and shop collection slip dated November 13.”

- **Injection:** In a separate fresh hinted rollout, append this exact text as a hint block immediately after the Friday user request at `2026-11-13T17:00:00-08:00`, before the agent's first Friday action. All named records already exist. Use the identical text, timing and budget for every designated model and both branches. It identifies sources without revealing their contents, the changed name, the correct ranking or a prescribed action. Do not add adaptive hints after failures.

### Reference solution

**✍️ Reference (required):** One complete branch-B path follows. Times are simulated checkpoints; agent action/observation timestamps will be recorded on this timeline, with real execution time recorded separately.

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-12T17:00:00-08:00` | Solo request | Search/read the saved reading and existing interests; save a Thursday draft, e.g. P14, P04, P12, P03, P10. | Profile, bookmarks, solo agenda, cards | Prior solo list and memory exist; no Friday score yet. | Context for E1 |
| `2026-11-13T16:30:00-08:00` to `2026-11-13T16:45:00-08:00` | Scripted records arrive | No action is mandated; Infra delivers the kit note, saved conversation and slip through Mail's event interface. | Fixed scenario events | Evidence is available before the request/hint. | E2/E3 evidence |
| `2026-11-13T17:00:00-08:00` | Nora joins; revised reading request | Search/read the family ride note, kit check, receipt, conversation and slip. | Kit note: red helmet outgrown; conversation: Tess took TY-184 home; slip: fit was on that child | Conclude that the purchase does not fill Nora's equipment gap. | E2, E3 |
| `2026-11-13T17:03:00-08:00` | Compose revised list | Read/reuse the cards; choose P20, P24, P17, P23, P22 in that order. | Frozen card bodies and the joined personal records | Five grade-3 cards cover fit, comparison, outing and kit, without critical mismatches. | E1 = 70, E2 = 20 |
| `2026-11-13T17:06:00-08:00` | Save final result | Create/update the unsent draft “Saturday ride reading”; verify it with `mail.get`. | Request and current Mail state version | Draft contains IDs and reasons below; no message/order is sent. | E3 = 10; F1 clear; all gates |

Reference reasons, one per entry:

1. **P20:** Nora's old red helmet pinches and TY-184 went to Tess, so this guide helps us check a replacement on Nora rather than assume a size.
2. **P24:** Nora still needs a helmet, and this collection offers several models to compare before checking size and fit on her.
3. **P17:** Nora wants a short ride with a stop, so this family-planning guide helps adapt our pace and preparation to her outing.
4. **P23:** Nora already has a fitting bike and a bottle, and this checklist helps us check the remaining kit instead of repurchasing everything.
5. **P22:** This family-riding guide helps plan breaks and an enjoyable pace for Nora's first longer outing.

**✍️ Other accepted approaches (required):** First, B may save P20, P17, P23, P02, P09 with grounded reasons, comparing the two individual helmets instead of a collection. Existing judgments give nDCG about 0.8416, E2 = 20 and, with full reasons, about 88.91/100: a pass. This is the first alternative to replay during implementation. Equal-grade permutations of the full-score reference also earn 100 with equally grounded reasons. In C, P17, P13, P23, P22, P18 earns 100 with reasons about the planned outing and existing gear; P20 can replace P18 for a routine fit check and still pass. A clarifying question is allowed, but the script directs the agent to the existing records rather than supplying new measurements or the answer; a question alone is not a saved list. Neither branch requires buying, choosing an exact helmet size, booking a route or visiting a geographically local trail.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 24 original short reading cards; six Thursday personal records and four Friday records per branch, including the family update. Shared history covers roughly one prior month. Only the recipient name differs across B/C. | Source manifest, synthetic-record audit, stable IDs, branch diff and private/agent-visible separation. | 1–2 |
| User rollout and scenario script | **Sessions:** 2 per branch. **Simulated world time span:** about 24 hours of interaction, from `2026-11-12T17:00:00-08:00` to Friday completion; older records are seeded context. **Estimated total tokens:** 4k–10k for one complete path, including dialogue, prior records, retrieved card bodies and tool outputs; measure at integration. Fork each Friday branch from equivalent Thursday state. | Fixed Friday request/events; clarification responses refer to available records, with no new facts. Log all simulated timestamps and ensure branch isolation. | 1 |
| Environment integration | Reuse Mail 1.3.0 and public runtime 1.5.0 as detailed below; text bodies only. No custom feed, messaging App, commerce App or external website is needed. | Real MCP search/read/write/read-back; initial-state, permissions and reset evidence. | 1–2 |
| Rubrics, reference and hints | Implement F1 and E1–E3 with the frozen labels, full-pass conjunction and exact hint; independently judge reasons. | Reference 100; no-op 0; first accepted alternative passes; cross-branch unchanged list and misleading-card controls fail for the intended reasons. | 1–2 |
| Agent rollouts and analysis | Plan 5 independent unhinted complete rollouts per designated GPT, Claude and Gemini model per branch (minimum 1 if resources limit, disclosed), plus a separate fixed-hint rollout per model per branch. Freeze model IDs, agent/memory config, task, budget and seeds. | Report every trace/score and separate branch/model counts. Each model must meet [the validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/CONTRIBUTING.md#task-difficulty-and-validation): 0/n unhinted passes and mean normalized score strictly below 50%; each hinted run must reach 100 and every gate. Do not pool away a stronger model/branch. Repeat the complete batch after a design change. | 1–2 |

### Environment dependencies and storage contract

Required existing App: **`mail` 1.3.0**, using the **public runtime 1.5.0**, inspected at upstream commit `61b637164e4abddf81536bb48935cdb688a69ff1`. Pin the actual versions/commit in the task's run assembly at implementation; an incompatible update requires re-verification. Public contracts: [Mail manifest](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/examples/apps/mail/app.json), [business tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/examples/apps/mail/tools.json), [seed schema](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/examples/apps/mail/schemas/seed.schema.json), [event schema](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/examples/apps/mail/schemas/events.schema.json), and [integration responsibilities](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/docs/app-integrations.md). There is no second App package with a private copy of Mail. No new Env capability or Env proposal is required for this text-only scope.

| Material / operation | Location and access |
| :--- | :--- |
| Candidate cards P01–P24 | 24 messages in the father's Mail archive, subject prefix “Saved reading” plus ID/title. Body contains the frozen original description, post ID and source URL. Cards are saved email reading notes, not full publisher articles. Search with `mail.search({query: "Saved reading", folder: "archive"})`; read each returned message using `mail.get({id})`. |
| Profile, bookmarks, solo agenda, family note and receipts | Dated text messages/notes in the same authorized account. Receipt and slip subjects include TY-184. Search by subject/text and read the returned IDs. The account contains no child's separate purchase history or private inbox. |
| Family conversation | A text export explicitly saved by the father to his own mailbox, with source conversation date and participants in the body. It is not access to an unimplemented chat App. The record saved Friday at 16:35-08:00 identifies the recipient; the slip saved at 16:45-08:00 supplies fit evidence. The kit note arrives at 16:30-08:00. |
| Revised ranked list | An unsent Mail draft titled “Saturday ride reading”, addressed to the synthetic father's own fixture address. Use `mail.draft.create` with `to`, `subject`, ordered `body`, `expected_version` from a current Mail response, and unique `request_id`; or `mail.draft.update` if revising an existing draft. Re-read with `mail.get` to establish persisted content. A conversational answer without a saved draft does not pass. |
| Initialization / branch reset | Trusted Infra loads the Mail seed and applies the scripted `mail.deliver` events through management MCP. Each trial resets records, drafts and agent memory. Both branches have equivalent shared Thursday state; no branch label or private judgment is placed in agent-visible records. The agent receives business access only, never management/reset access. |
| Grading | Private scenario IDs, relevance labels and expected coverage stay outside the account and the agent's tools/memory. The grader reads the persisted final draft, current records and action trace. The task-runner adapter for this private access is TBD until the maintainer's Task interface is available; this is infrastructure integration, not a missing user-facing App. |

The implementation must demonstrate the real Mail dependency through MCP, not merely an in-memory mock. Only required read and draft scopes are granted. The collection is frozen and sufficient to answer; source URLs are attribution/reference links, not live browsing dependencies. No PDF parser, images, attachment import, routing service or actual email delivery is needed. An unavailable tool or corrupt reset is an infrastructure failure, never evidence of task difficulty.

- **Milestones, owners and dependencies (required):** Xin Yu owns corpus, scenario, integration and failure analysis. Next: design review of this rubric and Mail mapping; then two independent readers/adjudication; implementation with the released Task adapter; full-score reference/alternative and reset checks; freeze; designated-model validation. Expected implementation duration: one to two working weeks once judges, Task interfaces and model access are available. This PR remains at Proposal until maintainer plan approval.
- **Resources and total effort (required):** 5–9 person-days. Corpus, Mail and deterministic scoring run on CPU. Existing local CPU pilot needs no API. Official model/API cost is TBD: calculate from the dated designated roster, fixed budget and planned run counts before evaluation. Access is not currently secured; no official validation is claimed.
- **Scope boundary and open questions (required):** One task with two history counterfactuals and a Thursday control, not a claim of population-level difficulty or multiple contributions. The separate ten-post preference diagnostic below is retained as exploratory design evidence, outside this task's 100 points and qualification counts. Independent labels, reason-judge agreement, task-runner grading hooks and model access remain to be resolved before validation. Substantive rubric or success changes require design re-review. Do not change requirements after observing failures simply to reach a desired score.
- **Data provenance and privacy (required):** All family profiles, chats, receipts, fit slips, order IDs, schedules and transactions are invented. No real child's data, private messages, personal account details or third-party personal information is copied. Fixture addresses will use reserved example domains. The 24 short cards have contributor-written titles/descriptions and source links listed below; no full articles, publisher images, product photography or PDF bytes are redistributed. The original synthetic text/code is contributed under this repository's MIT license. The linked publisher pages retain their own copyright/terms; a public link is not a redistribution license, and permission to rehost their full content has not been established. The runtime therefore uses only our frozen cards. Record per-card source URL, authoring/review date, text hash and reuse status in the implementation manifest; review factual summaries against sources before freezing. If richer source material is later required, obtain/document a suitable license or replace it with original synthetic content before adding it. Codex assisted the drafting and local checks; earlier exploratory Claude input/model runs are disclosed below and do not constitute independent human labeling.

### Reading-source inventory

The reuse treatment above applies to every entry: attribution link plus original short card, no copied article/media bundle. These are source references, not evidence of permission to redistribute the sites.

| Card | Source publisher and link |
| :--- | :--- |
| P01 | [Designing an off-road cycling route](https://www.cyclinguk.org/article/how-plan-cycle-route) |
| P02 | [Scamp II youth helmet product overview](https://www.giro.com/product/scamp-ii-youth-helmet/36018.html) |
| P03 | [Climbing and descending on mountain-bike trails](https://www.rei.com/learn/expert-advice/mountain-climbs-descents.html) |
| P04 | [Cornering on a mountain bike](https://www.rei.com/learn/expert-advice/cornering-techniques.html) |
| P05 | [Clearing mountain-bike obstacles](https://www.rei.com/learn/expert-advice/mtb-clearing-obstacles.html) |
| P06 | [Proframe full-face enduro helmet](https://www.foxracing.com/product/proframe-helmet/31469.html) |
| P07 | [Carrying children on a bike](https://www.rei.com/learn/expert-advice/cycling-with-children.html) |
| P08 | [Teaching someone to ride their first bike](https://www.rei.com/learn/expert-advice/teach-child-to-ride-a-bike.html) |
| P09 | [Tyro youth helmet product overview](https://www.trekbikes.com/us/en_US/equipment/bike-accessories/bike-helmets/kids-bike-helmets/bontrager-tyro-youth-bike-helmet/a/31204/) |
| P10 | [Lonesome Pine trail report](https://www.forestryengland.uk/kielder-forest/lonesome-pine-trail-kielder) |
| P11 | [Junior downhill race briefing](https://www.juniorbikeweek.com/downhill-race) |
| P12 | [Setting up a mountain bike](https://www.rei.com/learn/expert-advice/set-up-new-mountain-bike.html) |
| P13 | [Bedgebury short family cycle loop](https://www.forestryengland.uk/bedgebury/short-family-cycle-trail) |
| P14 | [Deadwater Up and Over trail report](https://www.forestryengland.uk/kielder-forest/deadwater-and-over-trail-kielder) |
| P15 | [Road riding alongside children](https://www.cyclinguk.org/article/cycling-guide/cycling-road-children) |
| P16 | [Reading cycling trail grades](https://www.forestryengland.uk/article/trail-grades-cycling-and-mountain-biking) |
| P17 | [Planning a ride with children](https://www.cyclinguk.org/guide/family-bike-rides) |
| P18 | [Bike checks before a ride](https://media.trekbikes.com/image/upload/v1692651979/TK_OwnersManual_EN-US_June2023_WEB.pdf) |
| P19 | [A full circuit of Kielder's Lakeside Way](https://www.forestryengland.uk/kielder-forest/lakeside-way-kielder-forest) |
| P20 | [How a bicycle helmet should fit](https://www.nhtsa.gov/sites/nhtsa.gov/files/2024-07/bike-safety-fitting-helmet.pdf) |
| P21 | [A guide to children's bike size and fit](https://www.trekbikes.com/gb/en_GB/kids_buyers_guide/) |
| P22 | [What to plan when the family rides together](https://www.rei.com/learn/expert-advice/cycling-as-a-family.html) |
| P23 | [Pack and check the essentials for a bike ride](https://www.rei.com/learn/expert-advice/basic-cycling-checklist.html) |
| P24 | [Comparing children's helmet models](https://www.giro.com/kids/cycling/helmets/) |

### Existing exploratory evidence and remaining validation

**CPU pilot.** All three reference lists earn 1.000 nDCG@5 and pass the local checks. Among 5,100,480 possible ordered lists, the original rules allowed 36 identical lists to pass both family branches. The revised rules allow zero. Two individual model pages can still satisfy the comparison need, and a general fit check can still pass for a daughter who owns a suitable helmet. In the needs-helmet branch, history-only BM25 scored 0.000 and full-context BM25 scored 0.350 nDCG@5. The 95th percentile of 20,000 uniformly random lists was 0.660. With two shuffled card orders per context and a fresh process each time, Qwen2.5-1.5B-Instruct passed 0/6 local trials and Qwen3-4B-Instruct-2507 passed 0/6. Each model received all records and cards. The local score used the returned IDs.

The old CPU pilot checks IDs/nDCG/gates only. It did not evaluate F1, saved Mail state or E3 and is not a completed run under the new 100-point rubric. The numeric weights remain 70/20/10; the pass mark, expected-item definitions, hint and storage contract above are proposed for design review.

**Can the history settle the order?** A separate ten-post diagnostic asks the father’s assistant to shortlist two Sunday rides based on what his daughter picked on two earlier outings. The father paid for two families. His receipts show which activities each child could choose at the same price, and a later family message identifies his daughter’s choices. Her schedule and the ownership of a rescheduled ticket determine which rides she can attend.

- When she chose one available activity over another, recommend them in the order supported by that choice. Counting how many times she did each activity can miss a direct comparison.
- When she chose the same activity over each of two alternatives, recommend it first. Accept either a focused question or an explicit tie for second: her history does not say which of the other two she would pick. The two readers will check these judgments separately from the 24-post nDCG@5 rubric.

In an exploratory pilot on one synthetic family, gpt-6-astra (medium) got both posts in order in 3/4 determined cases and Claude Fable 5.2 (Medium) in 4/4. Both recognized the separate unresolved second place. Each model used one prior conversation about splitting expenses, then five fresh recommendation sessions, each able to retrieve that conversation. These are design controls; difficulty on the full PALE task remains unverified.

For a future study over independently sampled families, pre-register the mean within-family nDCG@5 difference versus a frozen full-context baseline. Average repeated variants within family. Use a paired randomization test, a family-level 95% bootstrap interval and a predeclared minimum useful gain of 0.05. The current one-family pilot establishes no population-level significance.

