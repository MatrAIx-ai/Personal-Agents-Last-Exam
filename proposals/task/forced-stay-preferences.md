# Task Track proposal

**PR title format:** `[Task Proposal] [Travel & commuting] Book a hotel without mistaking forced stays for preferences`

## 1. Task and domains

- **Authors / GitHub handles (required):** [@onepounchman](https://github.com/onepounchman). Codex assisted with proposal drafting; the contributor owns review, implementation and validation.
- **Short task title (required):** Book a hotel without mistaking forced stays for preferences
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Nora regularly travels alone for short professional events. Her hotel history is dominated by large premium properties, often because an organizer required that property or the alternatives were unavailable. Two earlier conversations preserve actual comparisons between quiet and busy room locations: both options met her dates, spending limit and walking requirements, and she selected the quieter location. Price and other relevant room features are matched within each comparison. The records concern comparable overnight stays; the task does not assume that a business choice reveals a holiday preference.

The workspace contains six historical stays, their receipts, dated comparison messages, availability snapshots and short factual stay notes: approximately eighteen artifacts in total. The snapshots establish what Nora was actually offered at decision time. A room appearing somewhere in a catalog is not enough to assume she considered it. Noisy or busy properties remain acceptable when an immediate trip requirement makes them necessary; a quiet room is a preference rather than an absolute prohibition.

Standing permission allows one room for the specified night, up to US$180 in total. Dates, bed needs and walking limits are explicit. Nora's request is to book for her own tastes when a meaningful choice exists, rather than repeat the account's most frequent hotel category.

The main history includes these concrete contrasts; the other two stays repeat documented restrictions:

| Prior decision | Public evidence available before the next request | What the decision supports |
| :--- | :--- | :--- |
| Premium convention hotel | Organizer message requires that property; no alternative is authorized. | Evidence of a completed stay, without a comparison of room locations. |
| Premium hotel after a sellout | A dated offer thread shows the quieter alternative sold out before the purchase. | Availability explains the purchase; the unbookable option was not rejected on taste. |
| Courtyard room at a modest property | The actual offered rooms have the same price, bed, amenities and walking time. Nora says, “For these two rooms I'd rather have the courtyard one; the street-facing room would be worse for sleep,” and books the courtyard room. | Quiet location is supported by a genuine comparison and attributed feedback. |
| Quiet room within a premium property | Two offered rooms differ in published exposure to the late lobby events, with other relevant terms matched; Nora selects the sheltered room. | The supported feature transfers across property categories. |

### Dated source records

The following are the decisive records within the stated workspace counts. Remaining receipts and messages also carry full timestamps and source links. All seeded external-platform interactions are dated in 2026.

| Record | Available timestamp | Public source | What it establishes |
| :--- | :--- | :--- | :--- |
| R1 | `2026-04-28T09:00:00-07:00` | Organizer email and linked stay receipt | A premium property was mandatory; it was not a free comparison. |
| R2 | `2026-05-03T18:00:00-07:00` | Nora's room-offer conversation | Matched offers, an explicit preference for the courtyard room, and the resulting booking. |
| R3 | `2026-05-10T18:00:00-07:00` | Nora's second room-offer conversation | A sheltered room was preferred within a premium property with other relevant terms matched. |
| R4 | `2026-05-17T18:00:00-07:00` | Offer thread and linked receipt | The quieter alternative was already sold out. |
| R5 | `2026-05-25T09:00:00-07:00` | Nora's travel-permission note | One overnight room up to US$180; current dates, bed and walking requirements are supplied per request. |

## 3. Story outline

**✍️ Your answer (required):** Four sessions over three weeks alternate between a constrained stay and genuine choices. A successful assistant completes all four bookings, distinguishes informative decisions from forced purchases, and carries that distinction into a later unfamiliar catalog.

| Session and simulated timestamp | Request and available evidence | Expected outcome |
| :--- | :--- | :--- |
| 1 — `2026-06-02T09:00:00-07:00` | “Book tonight's workshop hotel; the organizer requires us to stay there.” The dated organizer record and inventory confirm the restriction. | Book and pay for the required hotel. Add the receipt without treating this forced stay as a new endorsement of its amenities. |
| 2 — `2026-06-09T09:00:00-07:00` | “For tomorrow, pick somewhere I'd actually enjoy staying.” The current shortlist includes quiet and busy room locations with matched prices, amenities, bed needs and walking times. | Use the earlier free comparisons to select an appropriate room, then complete payment. |
| 3 — `2026-06-16T09:00:00-07:00` | “Book tomorrow's room, but I need to be within a ten-minute walk of the early venue.” The quieter options are outside that limit. | Respect the current walking requirement, even if that means a less preferred hotel. Keep the exception's reason attached to this stay. |
| 4 — `2026-06-23T09:00:00-07:00` | “Same budget for the next overnight stop. Please choose for me.” A new premium property offers a quiet room; a modest property offers a room facing an evening event area. Prices, relevant room amenities, bed needs and walking times are matched. | Return to the supported room-location preference. Do not turn earlier modest-hotel purchases into a blanket rule to avoid premium properties. |

The four booked nights are June 2, June 10, June 17 and June 24 respectively. Each request specifies one overnight room and its date. The catalog contains about eight properties and sixteen room products overall, with several acceptable choices in unconstrained sessions. Prices include all charges; published walking times and room features avoid reliance on real maps or uncertain hotel stereotypes. The main path does not involve points, refunds, disrupted flights or waiting for price changes.

Clarification receives a truthful answer. If a history leaves the decisive preference genuinely unresolved, asking about that trade-off is a valid strategy and can earn full credit. The executable script must also support a complete solution from the published evidence in the main scenario. User silence creates no additional spending permission.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Nora's receipts mostly reflect hotels chosen under restrictions. Her own offered-choice conversations, rather than purchase frequency or hotel category, determine what to book when she has a choice.
- **Decisive context and trigger (required):** At `2026-06-09T09:00:00-07:00`, Nora asks, ‘For tomorrow, pick somewhere I'd actually enjoy staying.’ R2 and R3 are searchable earlier offered-choice conversations; R1 and R4 explain why other receipts concern premium hotels. The current offers match price and other relevant terms, so the prior comparison is usable without inventing a willingness to pay.
- **Generic assistant mistake (required):** Repeat the most frequent premium property type, or turn a past modest-property booking into a rule to avoid premium hotels. Either ignores why the earlier choices occurred. Always selecting quiet rooms also fails the current walking constraint on June 16.
- **Different user, different action (required):** Keep the June 9 request, budget and current offers identical. Keep the same historical receipts, but consistently change the earlier offered-choice histories: the busy-room purchases were freely preferred with explicit comparative feedback, while quiet-room purchases were required or the only bookable option. That user's record supports the busy room. This is a change to prior history, not to today's constraints or an undisclosed utility weight.

Related proposals: [#3](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/3) and [#77](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/77) also examine what personal history supports and when clarification is appropriate.

## 5. Rubric, hint and reference solution

### Rubric

Expected items score observable selections, arrangements and delivered work. No action and no delivered work earns 0; absence of a forbidden action never earns points. A selection may earn its item before payment only where explicitly stated. Unchanged seed records or background actor events earn no agent credit on their own.

**✍️ Forbidden (required):**

- **F1 — Paid commitments beyond permission.** Do not charge above the US$180 all-inclusive limit or buy extra/duplicate paid rooms beyond the one room requested for that night without fresh authorization. Silence does not expand the limit. *Evidence:* R5 and each current dated booking request. *Checked from:* Every charged order and the user authorization that preceded it.

**✍️ Expected (required):** 100 points.

- **E1 (30 points) — A supported free choice on June 9.** Create a valid room order for June 10 at a quiet location, supported by the matched personal comparisons. Award 30 for such a concrete order, paid or unpaid; several rooms may qualify. Do not grade an arbitrary hotel brand or star level. *Evidence:* R2, R3 and the June 9 offers/request. *Checked from:* The selected room product, night, public room features and matched current terms.
- **E2 (30 points) — The preference transfers on June 23.** Create a valid room order for June 24 using the supported room-location preference in the unfamiliar catalog, including the quiet room in the premium property where applicable. Award 30; a category-only shortcut does not qualify. *Evidence:* R2, R3 and the June 23 offers/request. *Checked from:* The selected product and its published room location, night and other current constraints.
- **E3 (20 points) — Current restrictions are met.** Both constrained selections are correct: the required property on June 2 and an available room within the ten-minute walk for June 17. Award the 20-point block only when both concrete orders satisfy the current requirements, even where a quieter option exists outside the feasible set. *Evidence:* R5; the June 2 organizer record and June 16 request. *Checked from:* The two selected room products, nights, mandatory-property record and published walking times.
- **E4 (15 points) — All four bookings completed.** All four requested one-night room orders were paid and valid for their requested dates and bed needs; completed stays remain valid evidence. Award the 15-point block only for all four; the location/constraint choices are scored above. *Evidence:* All four current requests and generated provider receipts. *Checked from:* The complete provider order/payment history and final status of each requested stay.
- **E5 (5 points) — A supported explanation.** For each free-choice booking, the delivered explanation links the selected room to a prior comparison and distinguishes the restricted purchases. Award 2.5 each. A corresponding concrete order must exist; there is no credit for explaining a choice never made. *Evidence:* R1–R4 and the two resulting orders. *Checked from:* The user-facing explanations against the dated sources; no hidden chain of thought is requested.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 90 of 100. The gap is 10 points; the decisive outcome items E1 (30), E2 (30), E3 (20), E4 (15) each carry more than that gap. Missing any such complete item cannot be compensated by the remaining items. Report partial points even after a forbidden item triggers; the full-task outcome fails separately. Weights and the threshold are proposed for design review and must be frozen before qualification runs.

### Hint

**✍️ Hint (required):** “Relevant sources are Nora's room-offer conversations of May 3 and May 10, the organizer email of April 28, and the offer thread of May 17, all in the initial workspace.”

- **Injection:** append this exact text to the system instructions at the opening of every session, after that session’s incoming user message and events are available and before the first agent action. Use the same text and position for all designated models. The named initial sources already exist; a source thread may later receive new messages. Do not inject the reference, rubric, future records or a paraphrase of their contents.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-06-02T09:00:00-07:00` | Mandatory workshop hotel | Book and pay for the required property for that night. | Current organizer record; R5 | One paid constrained stay. | F1; E3, E4 |
| `2026-06-09T09:00:00-07:00` | A stay she would enjoy | Read the actual comparisons and restriction records; book a qualifying quiet room for June 10; explain the choice. | R1–R5; current offers | One paid free-choice stay supported by personal evidence. | E1, E4, E5 |
| `2026-06-16T09:00:00-07:00` | Ten-minute walking limit | Book an available room inside the limit for June 17, retaining the dated constraint record. | Current request and walking-time offers | A feasible paid stay; its constraint remains discoverable. | E3, E4 |
| `2026-06-23T09:00:00-07:00` | Next overnight stop | Book the qualifying quiet room for June 24 and explain its relation to the earlier comparisons. | R2, R3; current offers | The fourth paid stay follows the room preference rather than category frequency. | E2, E4, E5 |

**✍️ Other accepted approaches (required):** Choose any equally qualifying room or obtain a truthful preference clarification before booking. A new price/amenity trade-off not identified by the earlier matched comparisons must allow clarification or a reviewed range of valid choices. The first alternative to replay asks Nora to confirm the relevant room trade-off, then books a different equally qualifying room.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Build six historical stays, roughly eighteen linked records, and eight fictional properties with about sixteen room products. Include two documented free comparisons and forced purchases with discoverable reasons. | A reviewer can identify the offered options and reason for every excluded alternative. Preference conclusions must follow from comparable choices or truthful clarification. | 2 |
| User rollout and scenario script | **Sessions:** 4.<br>**Simulated world time span:** June 2–23, 2026, plus six weeks of seeded history.<br>**Estimated total tokens:** 30k–65k per complete episode, including dialogue, retrieved history, repeated context, tools and agent outputs; exclude private grading and separately billed reasoning.<br>All sessions and events use the UTC-offset timestamps in Section 3. | Four requested bookings; responses to relevant questions; actual new receipts with their decision context preserved. Keep simulated action timestamps distinct from execution dates and wall-clock duration. | 2 |
| Environment integration | Reuse Vita hotel search, room details, booking and payment, plus the common PALE bridge budgeted in the lunch proposal. Add searchable historical comparison records and room-specific public attributes. | Persistent orders and available inventory, valid room IDs, English responses, deterministic reset and complete action receipts. | 1–2 |
| Rubrics, reference and hints | Implement Section 5 items with stable IDs, the full reference and the first listed accepted alternative. Include the dated personal-history comparison. | Reference and accepted alternative earn 100 with no forbidden item; a true no-op earns 0; partial work retains justified points. Check hint source existence, counterfactual consistency and every outcome item before the frozen batch. | 2–3 |
| Agent rollouts and analysis | Plan three pilots, then five unhinted and one fixed-hint run per designated GPT, Claude and Gemini model; budget six separate diagnostic episodes. | Frozen task/configuration/budgets, all traces and scores, and failure analysis separating historical inference from current constraint or transaction errors. | 2–3 |

### Environment reuse and preference identifiability

Use [VitaBench 2.0 at commit f60169e](https://github.com/meituan-longcat/VitaBench-2.0/tree/f60169e89f30499cb7883f3dad76bd03facc908d), particularly the [OTA toolkit](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/ota/tools.py). Reuse `create_hotel_order` and `pay_hotel_order`; validate that the selected product exists and has inventory before creating an order. Use one-night products so the stock room/date model can cover the declared scope. The history search view, room-level descriptive fields and state bridge are additions, not existing Vita capabilities claimed by this proposal.

Before freeze, a reviewer will enumerate the candidate rankings consistent with the matched historical decisions. The main path assumes only stable room-location choices across comparable solo work stays, with other relevant terms matched within a pair. It does not identify arbitrary utility weights or preferences over unobserved trade-offs. If the current candidates introduce a new trade-off, such as a higher price for quiet, earlier equal-price choices do not determine that trade-off: accept an evidence-supported range or truthful clarification. A private assertion that Nora “really prefers” a room cannot override discoverable evidence or her current answer. This check must happen before attributing a model's selection to an inference error.

The adapter will preserve actual state across sessions and reset it between independent episodes. It will replace Vita's deliberately vague clarification behavior with task-specific truthful replies, and use PALE's approved memory interface rather than oracle preference injection. Grading checks the complete order ledger rather than only the last write action. Confirm compatibility with the adopted PALE task interfaces before implementation.

### Design and validation checks

Replay the paired historical choice sets with identical current requests and offers. Rename/reorder listings and swap property categories without changing room-location evidence. A diagnostic without informative comparisons must accept clarification instead of a guess.

Section 5 describes the main history. In a diagnostic history variant, derive accepted outcomes from that variant's public personal records while retaining the rubric IDs, weights, current request and current constraints. Do not grade the comparison user against the main user's tastes or delegated commitments.

Replay the Section 5 reference and first accepted alternative, a true no-op, and representative partial/incorrect outcomes. An observation-only agent may legitimately earn verification/reporting points when it performs the specified work; do not mislabel that as doing nothing. No-op means no agent calls, selections, messages or work products, even if the scenario clock runs background events. Keep source fixtures, grading data and future event scripts separate from the agent's workspace.

Follow the [PALE validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation): freeze the exact task, rubric, roster, agent/memory configuration and resource budget. Each designated GPT, Claude and Gemini model independently needs 0/5 unhinted full-task passes and a mean normalized score strictly below 50%, plus its own separate fixed-hint episode scoring 100 with no forbidden item under the same budget. Report every run; pilot and diagnostic episodes are separate. The source-only hint's empirical sufficiency remains to be checked for each model. Repeat the complete frozen batch after substantive task changes. No model pilot or completed task implementation is claimed by this draft.

- **Milestones, owners and dependencies (required):** @onepounchman owns evidence construction, offered-choice and preference review, OTA integration, grading/reference checks and model trials, in that order. Allow about 3–4 calendar weeks after PALE interfaces are available. Shared dependencies are the English history view, clock, ledger, persistent sessions and reset bridge budgeted in the lunch proposal; this task owns its hotel fixtures, current constraints and grader. Resolve room-attribute representation and the ambiguous-history policy before freeze.
- **Resources and total effort (required):** 9–12 person-days assuming the common bridge is available. Local CPU fixtures and synthetic catalogs; no GPU, local model download or real booking. Twenty-seven planned episodes imply about 0.81–1.76 million visible tokens, plus reasoning and generation. Provisional API planning envelope: US$100–400, to be recalculated from pilots and the designated roster. Shared bridge work is not charged again here.
- **Scope boundary and open questions (required):** One traveler, one-night stays and stable tastes under comparable travel purposes. Exclude points, reimbursements, refunds, live travel disruptions, price monitoring and inferred medical needs. Full empirical identifiability under unconstrained human preferences is not claimed; scenario assumptions and accepted alternatives require independent review. If ordinary retrieval and clarification solve the task reliably, report that result rather than claim benchmark difficulty. Model rollouts have not been run.
- **Data provenance and privacy (required):** Adapted from the contributor's own real-life experiences of hotel choices shaped by availability or external requirements. The traveler, dates, properties, offers, conversations, prices and receipts will be fictionalized or synthesized for evaluation. These are not quotations from private booking logs. No original private messages, credentials or identifiable third-party records will be published. Reuse Vita's MIT-licensed code with notices retained; create fresh English catalogs and history. Record fixture licensing and later external assets before release. Codex assisted with drafting.

After approval, add the scenario, domain extensions, grader, reference and author-run evidence in the same PR. Substantial changes require design re-review.
