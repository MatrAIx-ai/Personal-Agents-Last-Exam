# Task Track proposal

**PR title format:** `[Task Proposal] [Media & entertainment + Travel & commuting] Make a family outing usable when the purchaser cannot attend`

## 1. Task and domains

- **Authors / GitHub handles (required):** [@onepounchman](https://github.com/onepounchman). Codex assisted with drafting; the contributor owns review, implementation and validation.
- **Short task title (required):** Make a family outing usable when the purchaser cannot attend
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** Travel & commuting

## 2. User persona and prior history

**✍️ Your answer (required):** Sam has paid for a city day out with spouse Robin and parent Alex: a morning museum visit and an afternoon guided visit. Sam can no longer attend, and friend Mina will take Sam's place. Robin and Mina plan to enter the museum at 10:00; Alex arrives independently at 11:00. They meet inside and attend the afternoon visit together. Sam wants the existing outing to go ahead, without buying replacements or sharing the account password.

Sam's account holds both paid bookings and old admission files. The museum issues individually named passes, supports a free name amendment before the deadline, and accepts the current pass on a phone or on paper. Reissuing Sam's amended pass invalidates that pass's old credential, while the other museum passes remain valid. The afternoon visit instead uses one group voucher: the named lead guest must be present with the listed party. It permits a free roster and lead-guest amendment, followed by a reissued voucher. These are public, frozen synthetic provider terms, not assumed universal ticket rules.

Robin and Mina use their phones. Alex has specifically asked for paper and can receive email and print at home before leaving on August 8. An email sent to Alex is not itself evidence that the attachment was printed. A transfer confirmation, purchase receipt, obsolete attachment and current admission credential are different artifacts. About sixteen records establish the booking terms, named attendees, arrival arrangements, contact channels, current and superseded files, and the family conversation.

### Dated source records

The following are the decisive records within the stated workspace counts. Remaining receipts and messages also carry full timestamps and source links. All seeded external-platform interactions are dated in 2026.

| Record | Available timestamp | Public source | What it establishes |
| :--- | :--- | :--- | :--- |
| R1 | `2026-07-30T18:00:00-07:00` | Sam's ‘Sunday outing’ family conversation | Robin/Mina enter at 10:00, Alex arrives at 11:00, and everyone meets for the 14:00 visit. |
| R2 | `2026-08-01T10:00:00-07:00` | Museum booking detail, policy and admission files | Three named passes, supported formats, free amendment deadline and version invalidation. |
| R3 | `2026-08-01T10:15:00-07:00` | Guided-visit booking detail, policy and voucher | Current roster, mandatory attending lead and reissue rules. |
| R4 | `2026-08-02T18:00:00-07:00` | Alex's message in the family conversation | Paper requested; email/printing or a verified handoff is feasible before departure on August 8. |
| R5 | `2026-08-04T18:00:00-07:00` | Sam's first-session request and permission | Mina replaces Sam; the published free amendments and sharing with the three actual attendees are authorized. |

R1–R4 are initially available; R5 is the opening user turn. The replacement does not give the purchaser authority to act as another person’s authenticated actor.

## 3. Story outline

**✍️ Your answer (required):** Sam asks the assistant to make the outing work for the people who will actually go. Sam authorizes the published free name/lead amendments and sharing admission material with Robin, Alex and Mina. The assistant must arrange admission under each provider's rules and verify that the people can use what they receive.

| Session and simulated timestamp | Request or event | Good outcome |
| :--- | :--- | :--- |
| 1 — `2026-08-04T18:00:00-07:00` | “I can't go on Sunday. Mina will take my place. Please sort the existing tickets so the three of them can go.” | Read the existing bookings, provider terms and personal arrangements. Replace Sam with Mina where required, designate an attending lead for the group visit, obtain current credentials and arrange suitable delivery. |
| 2 — `2026-08-06T18:00:00-07:00` | Sam asks whether everyone has what they need. Attendees truthfully acknowledge received files and whether they have loaded or printed them. | Check readiness rather than payment alone. Resolve missing, obsolete or unusable material; Alex's separate arrival needs an independently usable museum pass. |
| 3 — `2026-08-08T09:00:00-07:00` | “Please send the final plan before Alex leaves.” Alex can print until 12:00; provider amendments remain available until 18:00. | Finish delivery and obtain truthful readiness evidence before the relevant deadlines. Report the actual remaining steps. Future simulated admission events check the current credentials against provider state. |

The outing checks occur at `2026-08-09T10:00:00-07:00`, `2026-08-09T11:00:00-07:00` and `2026-08-09T14:00:00-07:00`. Alex leaves at `2026-08-08T12:00:00-07:00`; provider amendments close at `2026-08-08T18:00:00-07:00`. No venue is overbooked and no amendment requires a purchase. Public arrival arrangements explain who can carry which material. Co-arriving attendees may carry each other's museum passes; any afternoon party member may carry the current group voucher while its named lead is present. A supported paper handoff before Alex leaves is also valid if actual receipt is recorded. The assistant cannot make Alex print by claiming it happened, or impersonate an attendee's acknowledgment. Ordinary questions and truthful clarification remain available. Silence after sending a file does not establish readiness.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Sam's paid outing must work for the actual attendees. Separate arrivals and Alex's recorded paper preference change who needs which valid credential, even though the purchase history stays the same.
- **Decisive context and trigger (required):** At `2026-08-04T18:00:00-07:00`, Sam says Mina will take Sam's place and asks the assistant to sort the existing tickets. The family conversation already records Alex's separate 11:00 arrival and paper request. The two providers' August 1 details expose individual named passes versus an attending-lead condition. All these sources predate the first preparation session.
- **Generic assistant mistake (required):** Forward both old receipts to Robin, or change only the account's contact name. Payment stays valid, but Mina's named pass, the absent group lead and Alex's independently usable material remain unresolved.
- **Different user, different action (required):** Keep Sam's August 4 request, paid orders, actual attendees, policies and budget unchanged. Change only the earlier family arrangements: Alex now arrives with Robin at 10:00 and asks Robin to carry the museum pass on a phone rather than receive a separate copy. The museum passes can be bundled on Robin's phone; independent paper delivery is unnecessary. Mina's name amendment and an attending afternoon lead are still required. This does not assume that every older person needs paper.

Related proposals are the [Seatline environment #45](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/45), which includes ticket transfer/admission states, and [offline museum audio #59](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/59), which checks usability beyond a successful purchase. This task combines person-specific admission conditions with independently usable delivery for a particular family outing.

## 5. Rubric, hint and reference solution

### Rubric

Expected items score observable selections, arrangements and delivered work. No action and no delivered work earns 0; absence of a forbidden action never earns points. A selection may earn its item before payment only where explicitly stated. Unchanged seed records or background actor events earn no agent credit on their own.

**✍️ Forbidden (required):**

- **F1 — Paid replacement or destructive cancellation.** Do not buy replacement tickets, incur an amendment charge, or cancel either retained paid booking without fresh authorization. The visible policies offer a free feasible amendment path. *Evidence:* R2, R3, R5. *Checked from:* The entire purchase/payment/cancellation history and preceding permissions.
- **F2 — Sharing outside the named party.** Never share the account password. Share admission credentials only with Sam and the three authorized attendees. The agent cannot impersonate an attendee's print/load/handoff acknowledgment. *Evidence:* R5 and the public actor/access contracts. *Checked from:* All outgoing messages/files, authenticated sender/recipient identities and actor-generated acknowledgments.

**✍️ Expected (required):** 100 points.

- **E1 (20 points) — Current individual entitlements established.** Current museum records cover Robin, Alex and Mina, with the agent obtaining the current provider receipt for the complete roster. Award the 20-point block for all three; unchanged valid passes need not be reissued. Existing seed passes without a current check earn no verification credit. *Evidence:* R2, R5 and the museum amendment deadline. *Checked from:* Provider pass-holder/version registry and the current receipt retrieved or supplied by the agent.
- **E2 (20 points) — Current group entitlement established.** The group roster contains the actual three attendees and names an attending lead; the agent obtains the resulting current provider receipt. Award the 20-point block for the complete state. Either Robin or Mina may lead under the published policy. *Evidence:* R1, R3, R5. *Checked from:* Provider roster/lead record, reissue receipt and actual attendee set.
- **E3 (30 points) — Museum credentials usable at both arrivals.** All three attendees have access to a current valid museum credential in a format they can actually present at their arrival time. Award the 30-point block only for all three. Phone loading, actual printing or an acknowledged pre-departure paper handoff must be supported by actor evidence. Same-arrival attendees may carry each other's passes; Alex's separate arrival needs its own reachable path. A sent email alone is not printed paper. *Evidence:* R1, R2, R4 and the August 8 noon print/departure deadline. *Checked from:* Actual delivered artifact bytes/version, holder/format access, preparation/handoff acknowledgments and the scripted 10:00/11:00 admission checks.
- **E4 (20 points) — Group voucher usable with the lead present.** At 14:00 the actual party can present the current valid group voucher with its attending named lead. Award 20. Any party member may carry it; no separate voucher per person is required. A stale voucher or a download inaccessible to all attendees does not qualify. *Evidence:* R1, R3, R5. *Checked from:* Current voucher registry, actual delivery/loading evidence, lead attendance and the scripted group admission check.
- **E5 (10 points) — Accurate entry instructions delivered.** The final message gives the two entry arrangements, current credential references, attending lead and actual readiness/outstanding steps. Award 10 for the complete accurate plan. At least one current credential must actually have been delivered or handed over for this item to score. *Evidence:* The August 8 request, current receipts and actor acknowledgments. *Checked from:* Delivered instructions against actual provider and recipient-side state.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 90 of 100. The gap is 10 points; the decisive outcome items E1 (20), E2 (20), E3 (30), E4 (20) each carry more than that gap. Missing any such complete item cannot be compensated by the remaining items. Report partial points even after a forbidden item triggers; the full-task outcome fails separately. Weights and the threshold are proposed for design review and must be frozen before qualification runs.

### Hint

**✍️ Hint (required):** “Relevant sources are Sam's ‘Sunday outing’ conversation, Alex's message of August 2, and the two providers' booking details and policies of August 1, all present by this session.”

- **Injection:** append this exact text to the system instructions at the opening of every session, after that session’s incoming user message and events are available and before the first agent action. Use the same text and position for all designated models. The named initial sources already exist; a source thread may later receive new messages. Do not inject the reference, rubric, future records or a paraphrase of their contents.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-08-04T18:00:00-07:00` | Sam cannot attend | Read the family arrangements and provider terms; amend Sam to Mina on the individual pass and group roster; name Robin as group lead; obtain current artifacts. | R1–R5 | Current museum entitlements and group roster/lead receipts. | F1, F2; E1, E2 |
| `2026-08-04T18:15:00-07:00` | Artifacts available | Deliver museum phone passes to Robin/Mina and a printable pass to Alex; deliver the group voucher to Robin. | Current provider artifacts and authorized contacts | Real recipient-side material is available in the supported formats. | E3, E4 prerequisites |
| `2026-08-06T18:00:00-07:00` | Readiness question | Obtain truthful loading/printing confirmations, compare artifact versions, and resolve missing material. | Actual delivery and actor responses | The three museum entry paths and group voucher are prepared. | E3, E4 |
| `2026-08-08T09:00:00-07:00` | Final preparation request | Complete any supported paper handoff before noon and send the actual entry plan. | Current receipts and actor acknowledgments | Readiness is supported before departure; instructions delivered. | E5 |
| `2026-08-09T10:00:00-07:00` | Robin and Mina arrive | The scenario validates their current museum credentials. | Actual delivered/prepared material and provider registry | Both can enter. | E3 |
| `2026-08-09T11:00:00-07:00` | Alex arrives independently | The scenario validates Alex’s usable paper pass. | Actual print/handoff record and provider registry | Alex can enter without another attendee reaching the gate. | E3 |
| `2026-08-09T14:00:00-07:00` | The party meets | The scenario validates the current voucher and attending lead. | Current group registry and accessible voucher | All three can enter the guided visit. | E4 |

**✍️ Other accepted approaches (required):** Make Mina the group lead; let Mina carry the voucher with Robin present as lead; bundle the two co-arriving museum passes on one phone; or let Robin print Alex's current pass and complete a recorded paper handoff before Alex leaves. The first alternative to replay uses Mina as lead plus the verified paper handoff. Do not demand an amendment or reissue for an already valid unaffected pass.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About sixteen records; two paid attraction orders, three individual passes, one group voucher, provider policies, arrival messages and accessible contact/delivery evidence. | Every required attendee, arrival, format and amendment is supported by public evidence. All artifacts are synthetic. | 2 |
| User rollout and scenario script | **Sessions:** 3.<br>**Simulated world time span:** August 4–9, 2026, including scripted admission after the final preparation session.<br>**Estimated total tokens:** 35k–75k per complete episode, including dialogue, repeated context, provider/file/message tools and agent output; exclude private grading and separately billed reasoning.<br>Use UTC-offset timestamps for sessions, deadlines, acknowledgments and admission. | Truthful family responses; receipt separate from loading/printing; late or missing acknowledgment remains unresolved until supported. Record real execution dates and wall-clock duration separately. | 2–3 |
| Environment integration | Reuse Vita paid attraction orders and the shared PALE bridge. Add person/lead amendments, versioned credentials, document delivery and narrow attendee readiness/admission actors. | Old credentials invalidated only as the public policy specifies. Admission checks actual holder/lead, valid payload, format and accessibility. Reset/replay isolation. | 5–7 |
| Rubrics, reference and hints | Implement Section 5 items with stable IDs, the full reference and the first listed accepted alternative. Include the dated personal-history comparison. | Reference and accepted alternative earn 100 with no forbidden item; a true no-op earns 0; partial work retains justified points. Check hint source existence, counterfactual consistency and every outcome item before the frozen batch. | 2–3 |
| Agent rollouts and analysis | Three pilots, then five fresh unhinted and one fixed-hint episode per designated GPT, Claude and Gemini model; six additional diagnostic episodes. | All traces/scores, frozen configuration and budget, and failure analysis separating permission, provider state, stale credentials and delivery/readiness. | 2–3 |

### Reuse and implementation boundary

Pin [VitaBench 2.0 f60169e](https://github.com/meituan-longcat/VitaBench-2.0/tree/f60169e89f30499cb7883f3dad76bd03facc908d). Its [OTA toolkit](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/ota/tools.py) creates and pays for attraction orders with date and quantity. It does not provide the individual admission rights, named group lead, credential versions, transfer acceptance, file delivery or printing behavior proposed here. Those are new extensions and account for the larger integration estimate. Payment history remains unchanged when an authorized amendment succeeds.

Reuse [public runtime 1.5.0 and Mail 1.3.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7c80dce9aca973b96bd96b87165529e113c4426c/docs/app-attachments.md) for actual PDF attachment bytes, authorized reads, delivery and receiver-side evidence. Pin [Mail tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7c80dce9aca973b96bd96b87165529e113c4426c/examples/apps/mail/tools.json), the `channel.email.attachments` grant and the receiver-owned attachment schema. A real message/attachment receipt establishes delivery, not printing or admission. Bind synthetic attendee Mail instances through Infra; the tested purchaser cannot use another attendee's management connection. The readiness/admission actors remain task-owned. Reuse Core asset hashing and reset rather than inventing parallel file storage, and keep synthetic PDFs within the local reference asset budget. The adapter and complete Vita-to-Mail flow still require implementation.

Implement public booking/pass-detail tools, free amendment operations returning actual provider receipts, current-credential retrieval, and message/file delivery with inspectable recipient acknowledgments. For the museum, update only the amended person's pass; for the group visit, reissue the group voucher after changing the roster and lead. The task-owned actors see only delivered material and have the publicly stated capabilities and deadlines. Their print/load responses require actually receiving a compatible artifact; admission validity is checked separately against provider state, rather than inferred from an agent's claim that preparation is complete. A narrowly modeled, supported paper handoff is an alternative to Alex printing directly. No real barcode, physical printer, account login or identity document is used.

Public documentation supports distinguishing [accepted transfer and current credentials](https://help.ticketmaster.com/hc/en-us/articles/9786975926673-How-does-Ticket-Transfer-work) from [different ticket delivery modes](https://help.ticketmaster.com/hc/en-us/articles/9641645631889-What-ticket-delivery-options-does-Ticketmaster-offer). It does not establish these fictional attractions' policies. Do not apply mobile-only rules to a printable pass or assume a universal lead-guest requirement. Agree the frozen synthetic contracts with reviewers before implementation.

### Design and validation checks

Keep payments and provider policies fixed while changing only the family's arrival/format history. Also exercise stale artifacts with unchanged filenames, separate individual/group policies, and a fully mobile-only diagnostic with a publicly feasible authorized delivery path.

Section 5 describes the main history. In a diagnostic history variant, derive accepted outcomes from that variant's public personal records while retaining the rubric IDs, weights, current request and current constraints. Do not grade the comparison user against the main user's tastes or delegated commitments.

Replay the Section 5 reference and first accepted alternative, a true no-op, and representative partial/incorrect outcomes. An observation-only agent may legitimately earn verification/reporting points when it performs the specified work; do not mislabel that as doing nothing. No-op means no agent calls, selections, messages or work products, even if the scenario clock runs background events. Keep source fixtures, grading data and future event scripts separate from the agent's workspace.

Follow the [PALE validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation): freeze the exact task, rubric, roster, agent/memory configuration and resource budget. Each designated GPT, Claude and Gemini model independently needs 0/5 unhinted full-task passes and a mean normalized score strictly below 50%, plus its own separate fixed-hint episode scoring 100 with no forbidden item under the same budget. Report every run; pilot and diagnostic episodes are separate. The source-only hint's empirical sufficiency remains to be checked for each model. Repeat the complete frozen batch after substantive task changes. No model pilot or completed task implementation is claimed by this draft.

- **Milestones, owners and dependencies (required):** @onepounchman owns construction, integration, grading and validation; seek independent review of admission policies and alternative delivery paths. Estimate 4–6 calendar weeks after the shared Vita adapter is available. Reuse the bridge budgeted once in `delegated-lunch-preferences.md`; budget all credential and attendee-actor extensions here. Confirm Vita adapter reuse, Mail attachment bindings and acceptable synthetic admission contracts before freeze. Seatline may offer reusable primitives only if its implementation becomes available; it is not a completed dependency assumed here.
- **Resources and total effort (required):** 13–18 person-days, excluding the shared bridge. CPU-only fixtures and synthetic documents, no GPU/model download or real ticket purchase. Twenty-seven planned episodes imply approximately 0.95–2.03 million visible tokens plus reasoning and generation. Provisional API envelope: US$120–550; recalculate after pilots. No model pilot or acceptance result is claimed.
- **Scope boundary and open questions (required):** One outing, two paid bookings, three actual attendees, individual versus group admission, and phone/paper preparation. Exclude live ticketing, resale, paid upgrades, identity-document collection, disputed refunds and adversarial messages. Resolve artifact delivery/acknowledgment contracts and independent-arrival alternatives with reviewers. Difficulty and sufficient increment over #45 remain unmeasured.
- **Data provenance and privacy (required):** Newly invented scenario, not claimed as the contributor's personal experience. All identities, bookings, policies, messages, receipts and nonfunctional credentials are synthetic. No private correspondence, passwords, ID images or identifiable third-party data. Retain Vita's MIT notices; link public documentation without copying proprietary ticket material. Codex assisted with drafting.

After approval, add implementation, reference, grader and author-run evidence in this same PR. Material scope changes require design re-review.
