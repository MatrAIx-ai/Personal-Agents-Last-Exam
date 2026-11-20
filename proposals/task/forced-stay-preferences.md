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

## 3. Story outline

**✍️ Your answer (required):** Four sessions over three weeks alternate between a constrained stay and genuine choices. A successful assistant completes all four bookings, distinguishes informative decisions from forced purchases, and carries that distinction into a later unfamiliar catalog.

| Session and simulated timestamp | Request and available evidence | Expected outcome |
| :--- | :--- | :--- |
| 1 — `2026-06-02T09:00:00-07:00` | “Book tonight's workshop hotel; the organizer requires us to stay there.” The dated organizer record and inventory confirm the restriction. | Book and pay for the required hotel. Add the receipt without treating this forced stay as a new endorsement of its amenities. |
| 2 — `2026-06-09T09:00:00-07:00` | “For tomorrow, pick somewhere I'd actually enjoy staying.” The current shortlist includes quiet and busy room locations with matched prices, amenities, bed needs and walking times. | Use the earlier free comparisons to select an appropriate room, then complete payment. |
| 3 — `2026-06-16T09:00:00-07:00` | “Book tomorrow's room, but I need to be within a ten-minute walk of the early venue.” The quieter options are outside that limit. | Respect the current walking requirement, even if that means a less preferred hotel. Keep the exception's reason attached to this stay. |
| 4 — `2026-06-23T09:00:00-07:00` | “Same budget for the next overnight stop. Please choose for me.” A new premium property offers a quiet room; a modest property offers a room facing an evening event area. Prices, relevant room amenities, bed needs and walking times are matched. | Return to the supported room-location preference. Do not turn earlier modest-hotel purchases into a blanket rule to avoid premium properties. |

Each request specifies one overnight room and its date. The catalog contains about eight properties and sixteen room products overall, with several acceptable choices in unconstrained sessions. Prices include all charges; published walking times and room features avoid reliance on real maps or uncertain hotel stereotypes. The main path does not involve points, refunds, disrupted flights or waiting for price changes.

Clarification receives a truthful answer. If a history leaves the decisive preference genuinely unresolved, asking about that trade-off is a valid strategy and can earn full credit. The executable script must also support a complete solution from the published evidence in the main scenario. User silence creates no additional spending permission.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** A booking is evidence about taste only in light of the alternatives the user could and did consider. Nora's repeated premium stays and her few freely chosen stays carry different information. The assistant must recover that distinction across sessions and avoid replacing Nora's tastes with a generic rule to choose the highest-rated, cheapest or quietest property.

For example, the June 9 request does not repeat a preference for quiet rooms. A prior comparison conversation shows Nora choosing the courtyard room over an offered street-facing room with the same price, bed, amenities and walking time. A different premium receipt is paired with a dated sold-out notice for the quieter alternative. Both sources are searchable before the current choice. The free comparison supports the quieter option; the forced purchase does not establish a conflicting preference. On June 16 the walking limit changes what is feasible, and the assistant must retain that reason rather than infer that Nora's tastes have reversed.

The strongest diagnostic uses identical past purchase receipts in two histories. One history makes the quiet-location purchases informative free comparisons and the busy-location purchases forced; the other reverses which location choices were free. All associated offers, constraints and feedback change consistently. The appropriate future selection changes under the same current catalog. Separate controls swap property categories while keeping room-location evidence fixed, or remove all informative comparisons so clarification becomes appropriate. Receipt frequency, choosing the cheapest room and always choosing a modest property cannot explain all controls.

Related proposals: [#3](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/3) and [#77](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/77) also examine what personal history supports and when clarification is appropriate.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Build six historical stays, roughly eighteen linked records, and eight fictional properties with about sixteen room products. Include two documented free comparisons and forced purchases with discoverable reasons. | A reviewer can identify the offered options and reason for every excluded alternative. Preference conclusions must follow from comparable choices or truthful clarification. | 2 |
| User rollout and scenario script | **Sessions:** 4.<br>**Simulated world time span:** June 2–23, 2026, plus six weeks of seeded history.<br>**Estimated total tokens:** 30k–65k per complete episode, including dialogue, retrieved history, repeated context, tools and agent outputs; exclude private grading and separately billed reasoning.<br>All sessions and events use the UTC-offset timestamps in Section 3. | Four requested bookings; responses to relevant questions; actual new receipts with their decision context preserved. Keep simulated action timestamps distinct from execution dates and wall-clock duration. | 2 |
| Environment integration | Reuse Vita hotel search, room details, booking and payment, plus the common PALE bridge budgeted in the lunch proposal. Add searchable historical comparison records and room-specific public attributes. | Persistent orders and available inventory, valid room IDs, English responses, deterministic reset and complete action receipts. | 1–2 |
| Rubrics, reference and hints | Specify feasible sets and acceptable room selections from supported preferences; implement a reference, ambiguous-history branch and matched choice-condition controls. | Reference passes every branch; no-op fails; appropriate clarification and alternative rooms pass. Audit the hint against all rubric items and gates before the validation batch. | 2–3 |
| Agent rollouts and analysis | Plan three pilots, then five unhinted and one fixed-hint run per designated GPT, Claude and Gemini model; budget six separate diagnostic episodes. | Frozen task/configuration/budgets, all traces and scores, and failure analysis separating historical inference from current constraint or transaction errors. | 2–3 |

### Environment reuse and preference identifiability

Use [VitaBench 2.0 at commit f60169e](https://github.com/meituan-longcat/VitaBench-2.0/tree/f60169e89f30499cb7883f3dad76bd03facc908d), particularly the [OTA toolkit](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/ota/tools.py). Reuse `create_hotel_order` and `pay_hotel_order`; validate that the selected product exists and has inventory before creating an order. Use one-night products so the stock room/date model can cover the declared scope. The history search view, room-level descriptive fields and state bridge are additions, not existing Vita capabilities claimed by this proposal.

Before freeze, a reviewer will enumerate the candidate rankings consistent with the matched historical decisions. The main path assumes only stable room-location choices across comparable solo work stays, with other relevant terms matched within a pair. It does not identify arbitrary utility weights or preferences over unobserved trade-offs. If the current candidates introduce a new trade-off, such as a higher price for quiet, earlier equal-price choices do not determine that trade-off: accept an evidence-supported range or truthful clarification. A private assertion that Nora “really prefers” a room cannot override discoverable evidence or her current answer. This check must happen before attributing a model's selection to an inference error.

The adapter will preserve actual state across sessions and reset it between independent episodes. It will replace Vita's deliberately vague clarification behavior with task-specific truthful replies, and use PALE's approved memory interface rather than oracle preference injection. Grading checks the complete order ledger rather than only the last write action. Confirm compatibility with PALE's forthcoming environment interfaces before implementation.

### Proposed grading and reference

Proposed scoring totals 100 points: supported personal selection in the two sessions with a meaningful choice (60; 30 each); respecting the mandatory property and immediate walking constraint in the other two sessions (20; 10 each); completed paid bookings with the correct night, quantity and spending limits (10; 2.5 per booking); and accurate short booking explanations linking the two unconstrained selections to available personal evidence (10; 5 each). The freely chosen stays carry the main personalization score; correct transaction mechanics alone cannot establish success at learning Nora's tastes. Public explanations need not expose private reasoning or use a particular record-ID format. Selection quality and successful execution are scored separately.

Full-task gates require four completed suitable bookings, compliance with the current walking limits, and no unwanted paid rooms or unauthorized expenditure. Count all purchases, not just the final one. A gate failure does not erase unrelated rubric points. The reference retrieves the comparisons and restriction records, separates freely chosen stays from constrained ones, applies each current feasible set, books and pays, and verifies receipts. Several rooms may earn full credit; arbitrary tie-breaking is not graded.

The fixed hint is: “Interpret each earlier booking together with the options the user was actually offered and could book at that time. Use genuine comparisons to understand their tastes, apply today's constraints, and verify the selected room and payment.” This directs attention to the decisive evidence without naming a preferred attribute, property or final choice. The ordinary context supplies dates, budget and walking requirements.

Controls include the paired choice-condition histories, an otherwise comparable case with no informative free choice, and reordered/renamed listings. The ambiguous case should permit a question rather than reward guessing. Controls remain within this task and outside the qualification aggregate. Follow the [PALE validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation): each designated model independently needs 0/5 unhinted full-task passes, mean normalized score strictly below 50%, and a separate fixed-hint run at 100% with all gates under the same budget. Freeze the scenario, rubric, model roster and agent configuration before the batch and report every run. Correct use of clarification is success, even if that makes the task too easy to qualify.

- **Milestones, owners and dependencies (required):** @onepounchman owns evidence construction, offered-choice and preference review, OTA integration, grading/reference checks and model trials, in that order. Allow about 3–4 calendar weeks after PALE interfaces are available. Shared dependencies are the English history view, clock, ledger, persistent sessions and reset bridge budgeted in the lunch proposal; this task owns its hotel fixtures, current constraints and grader. Resolve room-attribute representation and the ambiguous-history policy before freeze.
- **Resources and total effort (required):** 9–12 person-days assuming the common bridge is available. Local CPU fixtures and synthetic catalogs; no GPU, local model download or real booking. Twenty-seven planned episodes imply about 0.81–1.76 million visible tokens, plus reasoning and generation. Provisional API planning envelope: US$100–400, to be recalculated from pilots and the designated roster. Shared bridge work is not charged again here.
- **Scope boundary and open questions (required):** One traveler, one-night stays and stable tastes under comparable travel purposes. Exclude points, reimbursements, refunds, live travel disruptions, price monitoring and inferred medical needs. Full empirical identifiability under unconstrained human preferences is not claimed; scenario assumptions and accepted alternatives require independent review. If ordinary retrieval and clarification solve the task reliably, report that result rather than claim benchmark difficulty. Model rollouts have not been run.
- **Data provenance and privacy (required):** Adapted from the contributor's own real-life experiences of hotel choices shaped by availability or external requirements. The traveler, dates, properties, offers, conversations, prices and receipts will be fictionalized or synthesized for evaluation. These are not quotations from private booking logs. No original private messages, credentials or identifiable third-party records will be published. Reuse Vita's MIT-licensed code with notices retained; create fresh English catalogs and history. Record fixture licensing and later external assets before release. Codex assisted with drafting.

After approval, add the scenario, domain extensions, grader, reference and author-run evidence in the same PR. Substantial changes require design re-review.
