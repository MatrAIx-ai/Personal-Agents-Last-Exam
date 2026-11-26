# Task Track proposal

**PR title format:** `[Task Proposal] [Food & dining] Keep each person's lunch preferences current while ordering for family`

## 1. Task and domains

- **Authors / GitHub handles (required):** [@onepounchman](https://github.com/onepounchman). Codex assisted with proposal drafting; the contributor owns review, implementation and validation.
- **Short task title (required):** Keep each person's lunch preferences current while ordering for family
- **Primary domain (required):** Food & dining
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Maya usually manages lunch orders through her own delivery account. Her husband, Evan, works from home most days, while Maya usually goes to the office, so she often orders just for him. When she works from home, she orders for herself or both of them. The account and delivery address are the same, but their initial tastes differ: Maya prefers mild food without cilantro; Evan prefers hot food with cilantro. These are ordinary taste preferences, without medical restrictions. Most recent purchases were for Evan, so the account history contains more of his meals than hers.

The initial workspace contains about ten historical orders and twelve short messages or meal reviews spanning two weeks. Recipient attribution comes from dated conversations, references to particular orders and attributed feedback. A payment receipt alone does not establish who ate the meal. The record includes several clear examples for each person; it does not require guessing a preference from one ambiguous purchase.

Maya has authorized the assistant to order the requested number of lunches to the recorded home address, up to US$32 per person including all charges. That permission is recorded separately from either person's tastes. Each live request makes the intended eater clear. Maya relays her husband's lunch-specific request and his later ongoing preference change; no separate account access or external contact with him is required. The assistant must use those instructions with their stated scope while preserving Maya's preferences. The delegated-ordering situation is adapted from the contributor's experience; the married couple and specific requests are synthetic scenario choices.

### Dated source records

The following are the decisive records within the stated workspace counts. Remaining receipts and messages also carry full timestamps and source links. All seeded external-platform interactions are dated in 2026.

| Record | Available timestamp | Public source | What it establishes |
| :--- | :--- | :--- | :--- |
| R1 | `2026-05-18T19:00:00-07:00` | Maya's ‘Lunch at home’ conversation | The spouses, home address, per-person spending permission and their initial preferences. |
| R2 | `2026-05-21T13:00:00-07:00` | Evan's attributed meal review | A paid hot meal with cilantro is linked to its actual eater. |
| R3 | `2026-05-27T13:00:00-07:00` | Maya's attributed meal review | A paid mild meal without cilantro is linked to Maya. |
| R4 | `2026-06-03T11:00:00-07:00` | The second session message | An exception for this lunch only. |
| R5 | `2026-06-08T11:05:00-07:00` | The later message in the same household conversation | One ingredient changes from June 9; the other preference is unchanged. |

R1–R3 are initially available; R4 and R5 arrive at the indicated session times and are not exposed early. The permission is unchanged by taste updates.

## 3. Story outline

**✍️ Your answer (required):** Five sessions over ten days alternate between delegated and personal purchases. The assistant's own new orders become part of the same account history. A good outcome is six appropriately selected meals that respect each person's current preferences and any lunch-specific exception, with payment and recipient allocation confirmed.

| Session and simulated timestamp | User request or event | Expected outcome |
| :--- | :--- | :--- |
| 1 — `2026-06-01T11:00:00-07:00` | “Please order lunch for Evan at home again. Use my account.” | Find the relevant historical conversations and order one meal suited to Evan. |
| 2 — `2026-06-03T11:00:00-07:00` | “Lunch for Evan again, please. He wants mild food with no cilantro just for today's lunch.” | Follow the exception for this meal. Preserve its stated scope; this purchase does not change Maya's tastes or establish a lasting change for Evan. |
| 3 — `2026-06-05T11:00:00-07:00` | “I'm working from home today. Just order lunch for me.” | Select for Maya despite the greater frequency and recency of her husband's orders. |
| 4 — `2026-06-08T11:00:00-07:00` | “I'm home today. Lunch for Evan and me, please.” At `2026-06-08T11:05:00-07:00`, a further user message says, “Starting tomorrow, Evan would like cilantro left out of his lunches.” | Order for Maya's ongoing tastes and Evan's ongoing tastes today, after the June 3 exception has expired. Preserve the new cilantro instruction with its June 9 effective date. One cart or separate orders can be valid. |
| 5 — `2026-06-10T11:00:00-07:00` | The usual restaurant is closed in the current catalog. “Find Evan something else for lunch at home.” | Select hot food without cilantro at a different restaurant: honor Evan's lasting ingredient change while preserving his unchanged spice preference, then verify payment. |

All sessions request delivery to the couple's home for the published lunch window. The household records identify Maya and Evan as spouses, and each request makes its intended eaters clear. Each catalog offers several valid dishes and plausible alternatives, with explicit spice and ingredient information, including hot meals without cilantro. Prices and delivery windows remain straightforward. Historical chats and the current requests' recipient and scope remain searchable throughout the episode. The June 8 future instruction is delivered before the session ends, regardless of the agent's ordering strategy; it does not assert that an unmade purchase occurred.

Clarification is allowed. Scripted answers resolve a genuine recipient ambiguity or answer a taste question truthfully; the user simulator will not deliberately withhold an answer to make the task harder. An autonomous history-based solution and a solution using reasonable clarification can both pass. World events and new receipts depend on actions actually taken: the scenario never inserts a successful purchase the agent failed to make.

## 4. What makes this distinct and personal

- **Personalization insight (required):** One shared ordering account contains meals for two people. Maya's instructions change Evan's lunch once, then one ingredient from a later date; the next order depends on that history.
- **Decisive context and trigger (required):** At `2026-06-10T11:00:00-07:00`, Maya says, ‘Find Evan something else for lunch at home.’ The household conversation already contains the June 3 one-lunch request and the message delivered at `2026-06-08T11:05:00-07:00` with a June 9 effective date. The initial reviews establish the unchanged tastes. These sources determine the requested meal at the new restaurant.
- **Generic assistant mistake (required):** Use the latest mild order as Evan's default, or keep all his original tastes permanently. Either gives the wrong June 10 combination. Using the account's majority purchases for Maya also loses the distinction between spouses.
- **Different user, different action (required):** Keep the June 10 request, current menu, eater, budget and address identical. Change only the earlier June 8 message: in the comparison history it requests no cilantro for June 9 only, rather than from June 9 onward. On June 10 that person returns to hot food with cilantro; the main history requires hot food without cilantro. No earlier message overrides a newer explicit request.

Related proposal: [#3](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/3) also uses recipient evidence in personalized recommendations.

## 5. Rubric, hint and reference solution

### Rubric

Expected items score observable selections, arrangements and delivered work. No action and no delivered work earns 0; absence of a forbidden action never earns points. A selection may earn its item before payment only where explicitly stated. Unchanged seed records or background actor events earn no agent credit on their own.

**✍️ Forbidden (required):**

- **F1 — Purchases beyond permission.** Do not incur more than US$32 per requested person including all charges, buy extra paid meals beyond the current request, or place duplicate paid orders for the same requested lunch without fresh permission. A failed authorization or unpaid draft is not a charge. *Evidence:* R1 and each current session request in Section 3. *Checked from:* The full payment/order ledger, quantities and timestamped user authorizations.

**✍️ Expected (required):** 100 points.

- **E1 (20 points) — The exception has ended.** The June 8 selection for Evan is hot with cilantro. Award all 20 for a concrete valid cart or order allocated to him; an unexpressed internal choice earns none. Payment is scored in E4. *Evidence:* R1, R2, R4 and the June 8 request; R5 takes effect the following day. *Checked from:* The June 8 cart/order allocation and published product variants.
- **E2 (20 points) — The later ingredient change transfers.** The June 10 selection for Evan at an available different restaurant is hot without cilantro. Award all 20 for a concrete valid cart or order; both the changed ingredient and unchanged heat preference must be correct. *Evidence:* R2, R5 and the June 10 catalog/request. *Checked from:* The June 10 cart/order, restaurant availability and product ingredients/heat.
- **E3 (20 points) — The other four meals remain correct.** All four other allocations are correct: June 1 Evan hot/with cilantro; June 3 Evan mild/without cilantro; June 5 Maya mild/without cilantro; June 8 Maya mild/without cilantro. Award the 20-point block only when all four concrete selections match. Record per-meal diagnostics even when the block earns zero. *Evidence:* R1–R4 and the corresponding current requests. *Checked from:* The four cart/order allocations and product variants; no preference labels hidden from the agent.
- **E4 (35 points) — Six lunches actually arranged.** All six requested allocations have valid paid fulfillment records for the correct day, home address and published lunch window, with the requested quantities; completed deliveries remain valid evidence. Award the 35-point block only for all six; a valid selection alone is not fulfillment. Failed individual meals remain identifiable in diagnostics. *Evidence:* R1 and all five dated requests/catalogs in Section 3. *Checked from:* All actual provider orders, payments, allocations and delivery slots; score confirmed arrangements, not physical eating.
- **E5 (5 points) — Useful receipt summary.** The agent's messages identify the six purchased meals, their eaters and actual charges, and distinguish any unresolved item. Award 5 for a complete accurate summary across the episode. There must be at least one actual paid lunch for this item to score. *Evidence:* The resulting dated receipts and session requests. *Checked from:* The delivered messages against actual orders; no required wording or private reasoning trace.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 90 of 100. The gap is 10 points; the decisive outcome items E1 (20), E2 (20), E3 (20), E4 (35) each carry more than that gap. Missing any such complete item cannot be compensated by the remaining items. Report partial points even after a forbidden item triggers; the full-task outcome fails separately. Weights and the threshold are proposed for design review and must be frozen before qualification runs.

### Hint

**✍️ Hint (required):** “The relevant sources are Maya's ‘Lunch at home’ conversation and the attributed meal-review thread, both present in the initial workspace.”

- **Injection:** append this exact text to the system instructions at the opening of every session, after that session’s incoming user message and events are available and before the first agent action. Use the same text and position for all designated models. The named initial sources already exist; a source thread may later receive new messages. Do not inject the reference, rubric, future records or a paraphrase of their contents.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-06-01T11:00:00-07:00` | Lunch for Evan | Read the household records; select and pay for one hot meal with cilantro. | R1, R2; current catalog | One confirmed lunch allocated to Evan. | F1; E3, E4, E5 |
| `2026-06-03T11:00:00-07:00` | The one-lunch request | Select and pay for a mild meal without cilantro for Evan. | R4; current catalog | The requested exception is fulfilled for this meal. | E3, E4, E5 |
| `2026-06-05T11:00:00-07:00` | Lunch for Maya | Select and pay for her mild meal without cilantro. | R1, R3 | Maya receives her own preferred selection. | E3, E4, E5 |
| `2026-06-08T11:00:00-07:00` | Lunch for both spouses | Order Maya mild/without cilantro and Evan hot/with cilantro. | R1–R4 | Two allocated paid meals. | E1, E3, E4, E5 |
| `2026-06-08T11:05:00-07:00` | The later message arrives | Keep the dated message accessible for the next session. | R5 | The record is available without inventing another order. | E2 prerequisite |
| `2026-06-10T11:00:00-07:00` | Usual restaurant closed | Order Evan a valid hot meal without cilantro elsewhere; reconcile the receipts. | R2, R5; current catalog | The sixth lunch is confirmed; the summary matches purchases. | E2, E4, E5 |

**✍️ Other accepted approaches (required):** Use different valid dishes; use one cart or separate orders for the two-person lunch; or ask reasonable taste/scope questions and use truthful answers before committing. Explicit product variants must support the actual ingredients. The first alternative to replay is separate valid June 8 orders, with identical meal coverage and no extra charges beyond permission.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Create two taste profiles, about ten historical orders and twelve attributed messages/reviews; populate three stores and about eighteen dishes with explicit options. | Each person's tastes and meal attribution are traceable to dated records; several dishes satisfy each request. | 2 |
| User rollout and scenario script | **Sessions:** 5.<br>**Simulated world time span:** June 1–10, 2026, plus two weeks of seeded history.<br>**Estimated total tokens:** 30k–60k per complete episode, including dialogue, surfaced history, tool instructions/results, repeated context and agent outputs; private grading and separately billed reasoning are excluded.<br>Use the UTC-offset timestamps in Section 3. | Scripted user turns and truthful clarification, R4/R5 delivered at their stated times, and receipts reflecting actual purchases. | 2 |
| Environment integration | Assemble Plateway 1.0.0 and Messages 1.0.0 on public runtime 1.6.0; load task fixtures through their seed contracts. | Menu/cart/checkout/order operations, history retrieval, session persistence, process restart, synchronized clocks and reset. | 2–3 |
| Rubrics, reference and hints | Implement Section 5 items, the reference and the first accepted alternative; add the history comparison. | Reference and alternative score 100 with no forbidden item; no-op scores 0; incorrect and partial outcomes receive their specified scores. | 2–3 |
| Agent rollouts and analysis | One exploratory pilot, five fresh unhinted runs and one fixed-hint run per designated GPT, Claude and Gemini model; six additional diagnostic episodes. | Complete traces, scores, configurations, costs and failure analysis; pilots and diagnostics reported separately from qualification. | 2–3 |

### Environment reuse and task fixtures

Use [Plateway #111](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/111) for delivery and Messages for household history. Plateway's design is approved and its implementation is under validation. The tested baseline is [commit 82bbf112](https://github.com/X-iZhang/Personal-Agents-Last-Exam/tree/82bbf112b2208a8c36161abd8b4bc7297d10e0ac): Plateway 1.0.0, Messages 1.0.0, runtime 1.6.0 and Core API 1.2.0. Record accepted package revisions and contract hashes in the delivery manifest.

| Required App | Reused functionality | Task-specific fixtures |
| :--- | :--- | :--- |
| [Plateway 1.0.0 tools](https://github.com/X-iZhang/Personal-Agents-Last-Exam/blob/82bbf112b2208a8c36161abd8b4bc7297d10e0ac/apps/plateway/tools.json) | Restaurant/menu reads, cart options and receipt labels, `plateway.checkout.preview`, `plateway.orders.place`, `plateway.orders.list` and `plateway.orders.get`. Plateway owns orders, charges, receipts and fulfillment status. | Three stores, eighteen dishes with heat/cilantro options, the home address, a simulated card and about ten historical orders. Apply the existing `restaurant.status_changed` event on June 10. |
| [Messages 1.0.0 tools](https://github.com/X-iZhang/Personal-Agents-Last-Exam/blob/82bbf112b2208a8c36161abd8b4bc7297d10e0ac/apps/messages/tools.json) | `messages.list` with `query`, `messages.get` and conversation reads; attributed text and timestamps. | About twelve historical messages/reviews in the household and meal-review conversations, referencing Plateway order IDs. Stage R4/R5 through the published event contract. |

The task supplies the personal history, permission, eaters, preference changes, requests and grading. Product choices use declared option IDs. Eater allocation can be recorded in receipt labels or clear messages linking order/line IDs to people. Historical attribution comes from the dated conversations and reviews. These fixtures use existing App schemas; the compatibility probe below identified sufficient business operations for this task. The required run assembly consists of Plateway, Messages and public Core; provider receipts are read directly in Plateway.

Select about two weeks of household history before `2026-06-01T11:00:00-07:00`, in `America/Los_Angeles`. Repeated, attributed meals establish the two eaters' initial tastes; later sessions test how scoped changes apply. Following the [history guidance](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/docs/submission-evidence.md#4-task-history-depth), report the selected record IDs/hashes, per-source and globally deduplicated dates, and earliest/latest dates. Count order/receipt occurrence dates and Messages `sent_at`, documenting any receipt-time fallback or invalid date. Apply the first-session cutoff before counting.

The two-person lunch supports one cart at one restaurant or separate paid orders. Publish the shared-fee allocation rule alongside R1 before freeze and test unequal-price dishes and rounding against the US$32 per-person cap.

Deliver the task in [LifePack format 1.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/docs/lifepack-task-format.md). Core provides persistence, seed loading, reset and Infra-only time advancement. The [time contract](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/docs/runtime-time.md) assigns session/event ordering and App clock synchronization to the runner. The shared loader, global scheduler and user harness remain Infra dependencies; identify and demonstrate the supported runner/adapter during implementation.

Load initial state once and preserve writes across sessions. Apply provider events to orders actually created, deliver R5 at June 8 11:05, and synchronize both App clocks before subsequent actions. Reset both App instances between independent episodes.

### Feasibility checks and planned validation

Local checks at the pinned commit on Node 22.23.5 passed Plateway's 111 business tests and 53 real-MCP checks. A scripted Plateway/Messages probe passed 120 assertions across two five-session episodes, each arranging six paid lunches: one combined the June 8 cart and the other used separate orders. It exercised menu options, charges, receipts, dated history, process restart, restaurant closure and provider reset. The task-specific script and traces are local and will accompany implementation. Model qualification and full LifePack/grader validation remain planned work.

Replay the Section 5 reference, separate-order alternative, true no-op and representative wrong/partial paths. Check source availability at each session and retain justified partial credit. For the history comparison, change R5's duration while keeping the current request and catalog fixed, then derive accepted outcomes from that history under the same rubric IDs and weights.

Follow the [validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation). Freeze the task, rubric, exact designated roster, agent/memory configuration and resource budget. Each designated GPT, Claude and Gemini model independently needs 0/5 unhinted full-task passes and a mean normalized score strictly below 50%, plus a separate fixed-hint run scoring 100 with no forbidden item under the same budget. Report every run, separating pilots and diagnostics from qualification. Verify the source-only hint for each model and repeat the complete frozen batch after substantive changes.

- **Milestones, owners and dependencies (required):** @onepounchman owns fixtures and App assembly, scenario/runner integration, rubric/reference checks and model validation. Estimate 3–4 calendar weeks once accepted App revisions, a supported runner/adapter and the designated roster are available. Seek independent fixture and grader review before freeze. Plateway delivery and acceptance are tracked in #111. Vita integration for #80, #81, #90 and #91 requires a separate work plan and budget.
- **Resources and total effort (required):** 10–13 person-days for this task's fixtures, assembly and validation. CPU-only synthetic fixtures. The 27 planned pilot, qualification/hinted and diagnostic episodes imply roughly 0.81–1.62 million visible tokens, plus reasoning and generation costs. Provisional model/API budget: US$100–400, updated from pilot measurements and designated-model pricing.
- **Scope boundary and open questions (required):** One purchaser, two eaters, five sessions, six meals, one temporary exception, one effective-dated ingredient change and one restaurant closure. Receipts are read in Plateway and history in Messages. Resolve shared-fee attribution, accepted allocation evidence, runner/adapter support and Plateway acceptance before freeze.
- **Data provenance and privacy (required):** Adapted from the contributor's own delegated-ordering experience. The couple, events, dates, addresses, messages, orders and menus are fictionalized or synthetic. Release fresh scenario text and catalogs with private logs, credentials and identifiable third-party information removed. Retain source/license notices at the pinned PALE/Plateway revisions and record fixture/asset provenance. Codex assisted with drafting.

After approval, add the LifePack package, App assembly/runner adapter, grader, reference and author-run evidence in this PR. Substantial scope changes require design re-review.
