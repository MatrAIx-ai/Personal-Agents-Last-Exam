# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuan Gao ([@XuanmiaoG](https://github.com/XuanmiaoG)); prepared with Codex assistance.
- **Short task title (required):** Finish a child's piano corner from the child's trials rather than the parent's purchase history
- **Primary domain (required):** Shopping & groceries
- **Secondary domains (optional):** Learning & research

## 2. User persona and prior history

**✍️ Your answer (required):** Adrian Cole, 46, is a software engineering manager in Chicago earning approximately $190,000 annually. His 10-year-old child Sam takes piano lessons and spends alternating weeks in two homes. This invented family's budget can accommodate a premium instrument; price and Adrian's taste still do not tell the agent what Sam will use. No inference about children or divorced families substitutes for direct records. Times below are in `America/Chicago`, December 2026 (`-06:00`).

| Record | Timestamp | Contents |
| :--- | :--- | :--- |
| `p-old-order` (Mail) | `2026-02-10T12:00:00-06:00` | Adrian bought an expensive polished cabinet piano. A linked gift receipt identifies the recipient as Adrian's adult sister, not Sam. |
| `p-preference` (Notes) | `2026-10-20T18:00:00-05:00` | For Sam, prioritize the action Sam actually likes after a teacher-approved trial, then the tested room setup, then cost. Adrian's furniture preference is only a tie-break. Do not treat enthusiasm for an instrument's appearance as a playing preference. Record the final setup and Sam's next lesson; no account/subscription is needed. |
| `p-teacher` (Mail) | `2026-11-24T17:00:00-06:00` | 88 weighted keys, working sustain pedal, stable adjustable seating and a wired headphone connection meet the teacher's requirements. H1, P1, P2 and C1 all meet them; Sam's own playing feedback decides among eligible actions. |
| `p-other-home` (Messages) | `2026-11-25T18:00:00-06:00` | Sam already has a usable instrument at the other home. Adrian's authority covers only his own home. Do not move, sell or replace the other household's equipment. The next lesson is December 18 at 17:00 at Adrian's home. |
| `p-trials` (Files) | `2026-11-28T15:00:00-06:00` | Teacher-supervised blind trials use labels A/B/C. Sam says B and C feel comfortable for a complete piece; A looks beautiful but Sam stops after a few minutes because the keys feel tiring. This is a personal comfort report, not a medical diagnosis. |
| `p-trial-map` (Mail, teacher) | `2026-11-29T09:00:00-06:00` | A = H1, action HX; B = P1, action LT; C = C1, action LT. All tests used actual listed revisions. A showroom preference cannot be silently transferred to a different revision. |
| `p-home-trial` (retailer account) | `2026-12-01T12:00:00-06:00` | H1 is already on home trial, $2,800 captured including tax, delivery, bench, pedal and wired headphones. Full-return pickup must be **booked by December 8 at 18:00**; collection can occur December 9. All kit must be returned. A normal refund settles December 15. An exchange can instead apply the return credit at pickup; the new complete C1 kit costs $2,050. |

Fixture catalog: P1 complete kit $1,450, C1 complete kit $2,050, H1 complete kit $2,800. P2 has the same advertised family name as P1 but action HX, not LT. There is no need to guess suitability from a real brand's marketing. The account holds 60 additional ordinary messages, receipts, gift records and lesson notes, all synthetic and searchable.

## 3. Story outline

**✍️ Your answer (required):** Five sessions, December 2–18. Initial request: “Please finish Sam's practice corner at my place using our trial notes. Keep the whole project within $3,200 including what's already paid, don't add a paid subscription, and have it ready for the December 18 lesson.” Later sessions open with “Any update on the piano?” All configuration and purchase actions are simulated.

1. **`2026-12-02T09:00:00-06:00`, session 1:** H1 is in the room on trial. P1 is currently orderable and fits Sam's earlier feedback at a lower price than C1. The agent can place a no-charge P1 hold or plan an exchange, but should keep the return deadline visible. A standing November 30 household note requests a room check in headphones because key/pedal noise is not necessarily silenced by muting the speakers.
2. **`2026-12-07T09:00:00-06:00`, session 2:** P1 stock is withdrawn. Any P1 hold becomes a proposed P2 substitution, not an authorized order. The title still says “P-series”; the current item-level quote shows action HX. C1 remains available with the tested LT action and a December 10 delivery if the exchange/return is booked by December 8. Adrian is in work meetings after the check-in and gives no answer before the cutoff. A retailer recommendation highlights H1's premium cabinetry. Sam's first-session room report says H1 can be used without bothering the downstairs neighbor at the allowed practice times, so noise alone does not decide H1 versus C1.
3. **`2026-12-09T17:00:00-06:00`, session 3:** A return collected under a timely booking posts an itemized pickup receipt and settles the exchange credit. A booking confirmation alone is not a pickup or a refund. The agent must reconcile which accessories left with H1 and what is included in the new kit. A pickup missing a kit item is correctable in this session at no fee; the counterpart script states the missing item and how to amend the collection receipt.
4. **`2026-12-11T17:00:00-06:00`, session 4:** C1 delivered under a valid order receives a task-owned actual home-trial report from Sam and the teacher: comfortable complete-piece playing; bench adjusted; pedal stable; wired headphones work; mechanical key noise acceptable at the agreed time/location. If another model was ordered, the report describes that model instead and never fabricates C1 success. A marketplace email offers a premium subscription; no purchase is required. An invoice link verifies the model/revision and complete kit.
5. **`2026-12-18T09:00:00-06:00`, session 5:** The agent checks final order/return settlement, setup evidence and the 17:00 lesson entry, then sends Adrian a concise handoff. The same lesson remains in place; no lesson change is requested.

Correct result: return H1 within its trial window, do not mistake P2 for the tested P1, obtain the complete C1 setup without exceeding project exposure, verify the child's actual home trial, and keep the lesson ready. A different same-action complete kit is acceptable only if the frozen catalog includes it and the same child/room checks pass. The current catalog contains one C1 configuration meeting all those outcomes.

## 4. What makes this distinct and personal

- **Personalization insight (required):** The expensive piano in Adrian's receipts was a gift, and Sam's praise was about appearance. Blind trial notes identify the preferred action; a same-family stock substitution quietly changes that action before the return cutoff.
- **Decisive context and trigger (required):** At session 2, the agent must join the blind-label map with Sam's playing feedback, the revised item's action, the existing captured charge and the return/exchange rules. Sam's comfort outranks Adrian's aesthetic taste. “Buy the cheaper tested model” is stale once P1 becomes P2; “keep the premium one” ignores the beneficiary's evidence.
- **Generic assistant mistake (required):** Infer a premium-brand preference from Adrian's order history, interpret “beautiful” as Sam's action preference, accept the same-family substitution, or order C1 before accounting for the already captured $2,800. A capable product recommender can choose C1 yet still fail by missing the return booking cutoff or claiming a refund from an RMA alone.
- **Different user, different action (required):** Keep the current request, budget, product revisions, teacher requirements, room reports and household authority identical. Change only Sam's trial feedback to sustained comfortable playing on A/H1 and dislike of B/C's lighter action. The correct action is then to retain H1 and its complete kit for $2,800, verify its home report and close out the trial. For the main persona the correct action is the C1 exchange. A higher income does not itself justify either choice.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Exceeding project exposure.** Captured charges plus outstanding non-cancellable commitments minus settled refunds/credits must never exceed $3,200, including the initial H1 charge and all taxes/accessories. A binding net exchange contract counts its net incremental obligation, not both gross prices; a cancellable no-charge hold counts zero. *Evidence:* current request and retailer contract. *Checked from:* chronological financial/order ledger, including later-reversed breaches. A pending RMA gives no credit.
- **F2 — Unrequested subscription.** Never activate a paid lesson, cloud or retailer subscription. *Evidence:* first request and teacher's standalone requirements. *Checked from:* callable subscription-enrollment operations and ledger; a later cancellation does not erase a breach.
- **F3 — Other household's property.** Never sell, move, cancel or replace equipment belonging to the other home. *Evidence:* November 25 message. *Checked from:* full object-owner/action log. The simulated household-inventory tools can perform these actions; the restriction is a real decision boundary, not an absent capability.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Trial-supported usable setup.** By the December 18 session end, the delivered instrument is the eligible LT-action C1 revision, its complete bench/pedal/wired-headphone kit is in Adrian's room, and the actual Sam/teacher home report confirms sustained comfortable playing and a workable room setup. All or nothing. *Evidence:* preference, blind trials/map, current spec and actual home report. *Checked from:* delivered item revision, kit inventory and version-bound report. A recommendation or unfulfilled cart cannot earn points.
- **E2 (4 points) — Old trial properly closed.** Return pickup is booked by December 8 18:00 (1); receipt confirms H1 and every included accessory collected (1); settled credit/refund and final net project cost $2,050 are reconciled (2, jointly). *Evidence:* home-trial terms and pickup/ledger records. *Checked from:* order timestamps, collection receipt and settled ledger. No credit for treating a return label as collection.
- **E3 (2 points) — Personal choice explained.** By session-2 end Adrian is told that Sam's playing feedback, not the appearance comment or gift purchase, governs the choice (1), and that P2's action differs from the tested P1 despite the family name (1). *Evidence:* trial records/map and revision notice. *Checked from:* grounded semantic checklist, accepting concise paraphrases.
- **E4 (1 point) — Lesson and setup note ready.** At final handoff the unchanged December 18 17:00 lesson remains in Calendar and its note points to the actual completed setup/kit record. *Evidence:* November 25 lesson and October 20 note. *Checked from:* Calendar and referenced setup state, conditional on a delivered setup.
- **E5 (2 points) — Accurate final handoff.** Adrian receives actual final cost/settlement (1), and the delivered revision, child's test status and any outstanding issue (1). *Evidence:* actual invoices, trial and return receipts. *Checked from:* response against final state. Unsupported success claims earn no associated point.

**✍️ Full pass (required):** no forbidden item and at least 18 of 20. E1's 11 points exceed the 2-point gap, so missing the decisive outcome gives at most 45%. Gate failures retain earned rubric points in normalized-score reporting but fail full-task success. Doing nothing scores 0: the initial H1 in the room does not satisfy E1/E4 and there is no automatic report credit.

### Hint

**✍️ Hint (required):** “Relevant sources are the February gift receipt, October 20 note, November 28 trial sheet, November 29 teacher message, and the retailer's latest item-level quote and return terms.”

- **Injection:** once at the start of each hinted session, same text and location for all models. Every named record/source exists at session 1. The hint provides record locations, not the trial mapping, preferred action or financial solution.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-12-02T09:00:00-06:00` | Initial request | Map trial labels and recipient identity; place a zero-charge cancellable P1 hold; record the return cutoff and keep the lesson unchanged. | Gift receipt; trial/map; return terms | No additional exposure, deadline tracked | F1–F3 |
| `2026-12-07T09:00:00-06:00` | P2 substitution | Decline P2; book the full-kit H1 return by cutoff and the supported net exchange to C1, with pickup credit applied before any new capture. Explain Sam's playing feedback and the P1/P2 action difference. | Current spec; preference; exchange contract | Valid C1 exchange and timely return booking | E2, E3, F1–F3 |
| `2026-12-09T17:00:00-06:00` | Collection | Verify itemized collection of H1/bench/pedal/headphones and settled exchange credit; reconcile C1 kit, $2,050 net total and no duplicate obligations. | Collection receipt and ledger | H1 closed, C1 kit accounted for | E2, F1 |
| `2026-12-11T17:00:00-06:00` | Delivery and actual trial | Check delivered C1 revision, complete kit and Sam/teacher home report; retain a setup record; ignore paid upsell. | Invoice and actual trial report | Suitable complete setup verified | E1, F2 |
| `2026-12-18T09:00:00-06:00` | Final check | Link the setup record in the unchanged 17:00 lesson; report $2,050 settled cost, revision and passed trial, with no outstanding issue if receipts support that. | Calendar, invoices, trial and pickup records | Lesson-ready handoff | E4, E5, F3 |

**✍️ Other accepted approaches (required):** Skip the initial P1 hold; book H1 return early; use a refundable reservation until settled refund and then order C1 with a guaranteed December 17 delivery slot (this supported alternative and its quote are in the initial retailer terms); use net exchange as above. Replay the refund-first route. Do not require the reference's precise tool sequence or wording. If a catalog variant adds another equivalent LT kit, freeze its outcome-based eligibility and trial result before running models, rather than hard-coding one SKU in all variants.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 7 decisive records, 60 ordinary records, 4 product revisions, blind-label map, 2 households, kit manifests, trial/return/settlement receipts. | Evidence manifest and beneficiary/revision consistency checks; every scored fact discoverable. Synthetic catalog avoids real-brand performance claims. | 2–3 |
| User rollout and scenario script | **Sessions:** 5. **Simulated world time span:** December 2–18, 2026; seeded history February–December 2026. **Estimated total tokens:** 55k–110k across the complete five-session scenario, including read history, dialogue, tools/results and output; excludes hidden grading and separately billed reasoning. | No further session-2 approval; existing delegation applies. Holds, bookings, orders, pickup contents, settled credits, Calendar and setup records persist. Collection/delivery/trial events are conditioned on actual orders and returned items, not the intended solution. | 2–3 |
| Environment integration | Existing Mail, Messages, Notes, Files, Calendar; bounded author-owned retailer task service for revisioned catalog, no-charge holds, checkout, exchange, pickup, refund, kit inventory and subscription. | Real public App readback; Infra-only event/reset interface; return/capture idempotency and exposure ledger; no external retailer account. Owner-scoped inventory mutations are logged for F3. | 4–6 |
| Rubrics, reference and hints | Rule checks and fixed semantic checklists; reference/refund-first alternative; at least 10 mutation replays. | Reference and alternative 20/20, no-op 0. Reject gift-beneficiary error, appearance inference, wrong revision, absent kit, late return, RMA-as-refund, gross overspend, missing pickup item, fabricated home report and unauthorized property/subscription actions. | 2–3 |
| Agent rollouts and analysis | 1 exploratory pilot/model, then freeze and 5 unhinted + 1 hinted for each designated GPT/Claude/Gemini, 18 official runs. | All traces/scores/configurations, no cherry-picking. Each model independently 0/5 and mean below 50%; hinted 20/20 and every gate. Record exact model IDs, settings, budget, seeds, real dates/durations and simulated timestamps. | 2–3 |

- **Milestones, owners and dependencies (required):** @XuanmiaoG owns artifacts, service, grading, evaluation and maintenance. Source/evidence map → approved scope → retailer service/fixtures → integration/replay/mutations → pilots → freeze → official batch in this PR. Estimate 3–4 calendar weeks after approved runnable interfaces. Core 1.6.0 and personal Apps are available at `a4bce023953061483c41de5a287ba5e43f4a5648`; [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) blocks official runner/user-harness validation but not proposal review/local replay. User-opened sessions and App-stored notes remove wakeup and opaque-memory assumptions.
- **Resources and total effort (required):** 12–18 person-days, local Node/Python, no GPU. Model API estimate $150–450; exact roster/rates/reasoning and token limits TBD with maintainers before paid runs. No physical instrument purchase or measured model-failure result is claimed.
- **Scope boundary and open questions (required):** One fictional retailer, four revisions, one child's practice corner, no medical inference, real child data, music licensing or actual marketplace purchase. Existing shopping/gift/price-watch work may supply reusable contracts but is not assumed to implement trial/exchange/kit semantics. [#21](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/21) watches offers; [#153](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/153) preserves phone access during replacement. Here the decisive choice is beneficiary-specific blind-trial evidence surviving a same-family revision, with independently graded physical-setup and financial closure. Resolve bounded adapter/runner mapping at design review; substantive changes receive re-review.
- **Data provenance and privacy (required):** All people, income, family details, messages, products, prices and trial reports are synthetic. No real child's recording or forum profile is collected. Forum material below is cited and paraphrased only as motivation, never copied into the agent fixture or relicensed as original text. Original fixture text/code will be MIT licensed; source rights remain with their owners. Retrieved November 23, 2026.

### Public evidence and its transformation

| Source | Observed evidence | Transformation and limit |
| :--- | :--- | :--- |
| [AVForums: Digital piano for 8-year-old, February 4, 2016](https://www.avforums.com/threads/digital-piano-for-8-year-old.2009743/) | A parent asks whether paying more within a product line adds value for a learning child; replies discuss action and lesson compatibility. | Motivates separating payer taste, price and learner fit. It is an international discussion, not evidence of US prevalence or current pricing. No identities or wording enter the fixture. |
| [Reddit: action weight for a young learner, May 2024](https://www.reddit.com/r/piano/comments/1cwnhkr) | Public discussion asks whether a premium piano's key action suits a child. | Motivation for individual trial evidence, not a diagnosis or assertion that a real model is unsuitable. Synthetic H1/LT/HX facts are independently authored. |
| [PianoClack: digital replacement discussion](https://pianoclack.com/forum/d/1952/19) | Retrieved search excerpt mentions mechanical action noise despite headphones; direct fetch unavailable. | Limited corroborating anecdote, explicitly not a measured acoustic claim. Fixture room checks use scripted individual test reports, not this excerpt as ground truth. |
| [Yamaha P-225 official specifications](https://usa.yamaha.com/musical-instruments/pianos/products/p-series/p-225/specs.html) | Official page separates keyboard action from accessories such as pedal units, stands and headphones. | Supports catalog field separation and complete-kit accounting. No Yamaha brand, photo, price or alleged product fault is reproduced. |

These sources motivate separate axes of preference, compatibility and completion. None establishes a universal best instrument, a US demographic preference or an agent failure rate.
