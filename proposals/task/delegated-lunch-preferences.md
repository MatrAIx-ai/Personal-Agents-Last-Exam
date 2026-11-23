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
| Persona, history and workspace | Write two taste profiles, about ten historical orders and twelve attributed messages/reviews; build three stores and roughly eighteen fully specified menu items across the scheduled catalogs. | A human reviewer can trace each relevant taste and recipient to public evidence. Several products satisfy each person's request. | 2 |
| User rollout and scenario script | **Sessions:** 5.<br>**Simulated world time span:** June 1–10, 2026, plus two weeks of seeded history.<br>**Estimated total tokens:** 30k–60k per complete episode, including dialogue, surfaced history, tool instructions/results, repeated context and agent outputs; private grading and separately billed reasoning are excluded.<br>Use the UTC-offset timestamps in Section 3 for user turns, actions and events. | Truthful clarification; six meals; a one-lunch exception and a later effective-dated preference change; actual new orders carried across sessions. Record execution dates and wall-clock duration separately. | 2 |
| Environment integration | Reuse VitaBench 2.0 delivery search, details, order creation and payment. Add a searchable text-history fixture, persistent order state and a complete action ledger. Build the common PALE bridge here for potential reuse by the other candidate tasks. | English tool-visible content; deterministic local addresses and clock; validated product variants; consistent account, payment and reset behavior. | 3–4 |
| Rubrics, reference and hints | Implement Section 5 items with stable IDs, the full reference and the first listed accepted alternative. Include the dated personal-history comparison. | Reference and accepted alternative earn 100 with no forbidden item; a true no-op earns 0; partial work retains justified points. Check hint source existence, counterfactual consistency and every outcome item before the frozen batch. | 2–3 |
| Agent rollouts and analysis | Plan one exploratory pilot per designated model, then five fresh unhinted and one fixed-hint run per designated GPT, Claude and Gemini model. Budget six additional diagnostic episodes separately. | All traces, scores, configurations, costs and failure analysis, with observations on the simulated timeline. Keep pilots and diagnostics outside qualification averages. | 2–3 |

### Environment reuse and missing components

The implementation starting point is [VitaBench 2.0 at commit f60169e](https://github.com/meituan-longcat/VitaBench-2.0/tree/f60169e89f30499cb7883f3dad76bd03facc908d), particularly its [delivery toolkit](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/delivery/tools.py). Products will use explicit, valid variants so a free-text customization cannot magically remove an ingredient. A public order-history view and historical messages will expose normal receipts and source links; private preference and recipient labels will remain evaluator-only.

Vita's personalization runner constructs each subtask environment from supplied state. The bridge must explicitly carry actual orders and action-derived events between sessions, while using PALE's approved memory lifecycle. It must not inject a hand-authored preference summary or the ground-truth memory backend. The stock outcome evaluator resolves a last write action; the task instead needs a grader covering all six meals, their allocations and the complete transaction ledger. The Vita-to-PALE integration contract and acceptance of this API environment are dependencies to resolve at design review.

### Design and validation checks

Change only the duration of R5 while holding the June 10 request and catalog fixed; exchange the eaters in an otherwise comparable request; and include several valid hot/no-cilantro dishes. The counterfactual is a diagnostic history variant, not another task.

Section 5 describes the main history. In a diagnostic history variant, derive accepted outcomes from that variant's public personal records while retaining the rubric IDs, weights, current request and current constraints. Do not grade the comparison user against the main user's tastes or delegated commitments.

Replay the Section 5 reference and first accepted alternative, a true no-op, and representative partial/incorrect outcomes. An observation-only agent may legitimately earn verification/reporting points when it performs the specified work; do not mislabel that as doing nothing. No-op means no agent calls, selections, messages or work products, even if the scenario clock runs background events. Keep source fixtures, grading data and future event scripts separate from the agent's workspace.

Follow the [PALE validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation): freeze the exact task, rubric, roster, agent/memory configuration and resource budget. Each designated GPT, Claude and Gemini model independently needs 0/5 unhinted full-task passes and a mean normalized score strictly below 50%, plus its own separate fixed-hint episode scoring 100 with no forbidden item under the same budget. Report every run; pilot and diagnostic episodes are separate. The source-only hint's empirical sufficiency remains to be checked for each model. Repeat the complete frozen batch after substantive task changes. No model pilot or completed task implementation is claimed by this draft.

- **Milestones, owners and dependencies (required):** @onepounchman owns history and scenario construction, the Vita/PALE bridge, rubric/reference review, and model validation, in that order. Allow roughly 3–4 calendar weeks after PALE interfaces and the designated roster are available. Seek an independent fixture and grader review before freezing runs. Resolve API-environment compatibility, searchable sources, session persistence and reset semantics first. This proposal budgets the shared bridge; the other proposals budget their own scenarios and domain-specific extensions.
- **Resources and total effort (required):** 11–14 person-days. CPU-only synthetic fixtures; no local model weights, GPU or paid dataset. The 27 planned pilot, qualification/hinted and diagnostic episodes imply roughly 0.81–1.62 million visible tokens, plus reasoning and generation costs. Provisional API planning envelope: US$100–400, to be recalculated using pilot measurements and the designated roster's pricing.
- **Scope boundary and open questions (required):** One account, two eaters, five sessions, one temporary exception, one later ingredient-preference change and one restaurant closure. Live recipients and instruction scope are explicit. Exclude allergies, reimbursements, refunds, external messaging and a custom memory architecture. Settle allocation format, repair behavior and shared-history access before freeze. The scope comparison does not establish exclusivity or model difficulty; no model rollouts have been completed.
- **Data provenance and privacy (required):** The delegated-ordering situation is adapted from the contributor's own real-life experience. The married couple, one-lunch exception and later preference change are synthetic scenario choices, not claims about specific family events. All people, dates, addresses, messages, orders and menu records will be fictionalized or synthesized, with no original private logs, credentials or identifiable third-party information. Retain Vita's MIT notices; author fresh English scenario text and catalogs. Record fixture licensing and later asset reuse before release. Codex assisted with drafting.

After approval, add the scenario, bridge, grader, reference and author-run evidence in the same PR. Substantial changes require design re-review.
