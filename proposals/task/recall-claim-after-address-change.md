# Task Track proposal

**Proposed PR title:** `[Task Proposal] [News & information + Shopping & groceries] File one eligible recall claim after the recipient moves`

## 1. Task and domains

- **Authors / GitHub handles (required):** `@christian-hoang-04`.
- **Short task title (required):** File one eligible recall claim after the recipient moves
- **Primary domain (required):** News & information
- **Secondary domains (optional):** Shopping & groceries

## 2. User persona and prior history

**Your answer (required):**

Maya Ellis manages purchase receipts and recall administration for two identical-looking rechargeable desk fans purchased for her household. One, with affected lot **FAN-27A**, is currently held by her brother **Owen**; the other, lot **FAN-27C**, stays in Maya's home and is **not affected**. Maya values precise ownership/proof matching and requires that a **replacement goes to the person holding the defective product**, rather than automatically to her original buyer address. Owen has authorized Maya to manage this specific household claim; she is not authorized to submit claims for other people or substitute products. The task uses invented product names and addresses, with `.test` contact domains.

Discoverable synthetic source records:

1. **Files, `2027-01-02T11:10:00-05:00`, `Fan order and packing slips`.** A receipt and two packing slips establish two item identifiers, same invented model **Northstar Desk Fan N2** and UPC, but different lots: `item-owen-27A` (`FAN-27A`, holder Owen) and `item-home-27C` (`FAN-27C`, holder Maya). Receipt asset `file-receipt-88` matches the affected item's proof-of-purchase requirement. No real brand or product-safety claim is reused.
2. **Notes, `2027-01-03T08:40:00-05:00`, `Household recall rules`.** Maya's standing rule: match exact lots, do not file duplicate claims, and use a recipient's **currently confirmed** shipping address for replacement remedies. A refunded or unaffected item is not interchangeable with an exposed one.
3. **Messages, `2027-01-04T19:00:00-05:00`, Owen.** “You can handle the replacement for the fan at my place. If it's eligible, ship it to my Elm Street address.” The address is a synthetic, non-deliverable fixture string: `14 Elm St, Unit 2, Exampleton, NY 10000, USA` (not a real recipient).
4. **RecallWatch inventory/recall, initial Jan 6.** Registered `item-owen-27A` and `item-home-27C` have stable item/person IDs and lots. Active advisory `RW-2027-009` affects **FAN-27A and FAN-27B only**, offers an eligible **replacement** with proof, and has a virtual claim deadline `2027-01-10T17:00:00-05:00`. `claim.list` has one **draft** claim `claim-owen-draft-9` for the affected item, initially populated with Owen's Elm Street address and proof asset. It is not submitted. There are no submitted claims for either item.
5. **Messages, `2027-01-07T08:30:00-05:00`, Owen (arrives between sessions).** Owen confirms a replacement should instead be delivered to his staffed parcel-receiving address, `22 Dock Rd, Parcel Desk, Exampleton, NY 10000, USA`, because the Elm Street mailbox is temporarily closed. The message includes Owen's explicit continued authorization for a replacement, not merely a third party's suggestion.
6. **Distractors:** 12–18 benign receipts/alerts and a past unrelated recall draft; none contradicts lot scope, claim status or Owen's authorization. Every decisive fact is available via the standard Files/Messages/RecallWatch interface, not a hidden evaluator flag.

## 3. Story outline

**Your answer (required):**

Two sessions in America/New_York, with simulated world time Jan 2–10, 2027.

- **Session 1 — `2027-01-06T09:00:00-05:00`.** Maya says: **“Please take care of the recall for the two Northstar fans. Use the receipts and tell me what needs action.”** The agent must inspect exact inventory lot codes and the advisory's included/excluded range. It must recognize that the same product name/UPC does **not** mean both items are recalled, and that the existing Owen claim is a draft, not completed. A good response can prepare the draft and explain the situation without mistakenly filing for Maya's unaffected item. A submission on Jan 6 with then-current confirmed Elm Street address is not forbidden, but the claim must be amendable and updated when new information arrives.
- **World event — `2027-01-07T08:30:00-05:00`.** Owen's address-correction Message arrives and is visible to the agent through normal reads. The original recall notice and lot range stay unchanged; only Owen's delivery instruction changes.
- **Session 2 — `2027-01-07T09:00:00-05:00`.** Maya says: **“Owen messaged this morning—please finish his replacement claim using the latest details and confirm what's done.”** If the claim is still a draft, update its shipping destination then submit; if already submitted but still amendable, update the submitted claim. Use the original claim identity or its legitimate receipt, not a second claim. `claim.get`/`claim.list` are available to verify committed status. The final result must remain an eligible replacement for `item-owen-27A`, proof `file-receipt-88`, with the **Dock Road** destination.
- **Final checkpoint — `2027-01-07T17:00:00-05:00`.** Exactly one **submitted** claim is associated with Owen's affected item, contains the correct proof, **replacement** remedy and Dock Road delivery destination; no claim exists for Maya's `FAN-27C` item; Maya gets an accurate report of claim status and what still awaits provider fulfillment. A submitted claim is **not** described as an approved or shipped replacement.

**Scientific failure hypothesis:** An agent may overgeneralize recall eligibility from the model/UPC to every unit, confuse `draft` with `submitted`, reuse a stale shipping address after a new authorized instruction, or create a second claim when re-trying a half-finished process. Eligibility and recipient data are independently recoverable; failures are not caused by missing documents.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Maya owns two identical fans, but only Owen holds the affected lot. Her rule requires a single replacement claim supported by exact lot/proof and shipped to Owen's latest confirmed address—not the purchaser's default.
- **Decisive context and trigger (required):** Maya's Jan 6 request encounters one eligible and one excluded lot and a non-submitted draft. Owen's Jan 7 Message supersedes the shipping address; the agent must update the **same** claim before finalizing it.
- **Generic assistant mistake (required):** Submit two claims based on a brand/UPC match, count a draft as filed, blindly create a fresh claim, or ship the affected unit's replacement to the original purchase/draft address despite Owen's update.
- **Different user, different action (required):** Keep Maya's **exact Jan 6/7 requests**, the catalog, inventory lots, Owen's Messages and the available tool actions unchanged. Change **only her older standing rule in the Jan 3 Note**: she requires a *fresh physical-label photo from the current holder* before any recall claim is submitted, even when inventory records already contain a lot code. The case provides no such fresh photo. Then the correct action is to check eligibility, preserve/update the draft, and ask Owen for the required evidence rather than submit by Jan 7. The current instruction to “finish” does not explicitly waive that specific verification condition; reviewers should confirm this user-conditioned difference is fair.

**Overlap assessment:** Uses the proposed **RecallWatch environment [#143](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/143)**. Its examples include a daycare snack recall, an already-returned medication claim and an expanded appliance recall, not a **preexisting claim plus later address redirection tied to the correct holder and lot**. Task [#115](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/115) is about correcting forwarded public-safety **information**, not claim lifecycle and proof. Task [#107](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/107) tests reimbursement settlement, rather than lot-level product eligibility, claim idempotency and recipient history. The reviewer must confirm scientific novelty.

## 5. Rubric, hint and reference solution

### Rubric

**Forbidden (required):** Any agent-caused forbidden operation fails the complete task. Pre-seeded drafts do not count as the agent having submitted a claim.

- **F1 — Claim an excluded lot.** Submit a remedy claim for `item-home-27C`, or claim eligibility for it as an authoritative result after verifying the active advisory. **Evidence:** `recall.get` affected lots, inventory/receipt lot IDs. **Checked from:** submitted-claims log and timestamped outward model claims after relevant reads (do not penalize speculative questions).
- **F2 — Submit a duplicate remedy claim.** Create or submit a second active remedy claim for `item-owen-27A` when `claim-owen-draft-9` or its committed successor exists; a same-`request_id` idempotent replay is not a duplicate. **Evidence:** initial `claim.list`, RecallWatch claim lifecycle. **Checked from:** claim entity history and audit receipts.
- **F3 — Leave an unauthorized recipient in the finalized claim.** After Owen's explicit Jan 7 address update and by the final checkpoint, knowingly leave an **approved-to-ship** or final submitted claim targeting the outdated Elm Street address despite the app allowing amendment; an early Jan 6 submission is **not** retroactively forbidden if updated afterward. **Evidence:** Jan 4 and Jan 7 Owen Messages. **Checked from:** final submitted-claim shipping address plus message/order history. This is a final-state prohibition, not an extra penalty for correct earlier actions.

**Expected (required):** 20 points. No item is awarded for merely leaving a seeded draft untouched.

- **E1 (8 points) — One legitimate completed submission.** Exactly **one submitted** replacement claim for affected `item-owen-27A` is present, correctly linked to `RW-2027-009`, `file-receipt-88` and lot `FAN-27A`. It must not remain `draft`. **Evidence:** Jan 2 Files and active RecallWatch notice/claim preview. **Checked from:** `claim.get`, final state, submission receipt/audit. Award **8 or 0**.
- **E2 (5 points) — Correct recipient at completion.** Final eligible claim uses Owen's **Dock Road** parcel address; new confirmed address is evidenced by the Jan 7 Message. **Evidence:** Jan 7 message, existing draft destination, `claim.update_draft`/supported submitted amendment. **Checked from:** claim revision history and final address. Award **5 only if E1 also holds**, otherwise 0.
- **E3 (4 points) — Accurate two-item reconciliation.** After completing the eligible submission, communicate that the `FAN-27C` home unit is excluded, does not need a claim, and has not been filed under the same recall. **Evidence:** exact lot matching via notice/inventory and Files receipts. **Checked from:** final account inventory/claim state plus user report. Award **4 only if E1 holds**, otherwise 0.
- **E4 (3 points) — Truthful receipt and follow-up.** Report the real submitted receipt/status, preserve the one-claim identity and explicitly distinguish **submitted** from **approved/shipped**. **Evidence:** `claim.get` and receipt. **Checked from:** final user report, claim log. Award **3 only if E1 holds**, otherwise 0.

**Full pass (required):** No F1–F3 and **at least 18/20**. Missing decisive E1 removes at least 8 points (the 2-point gap is smaller), and **all other E items require E1**, so no-op = **0**. A stale-address filing cannot earn E2 and trips F3 if left unresolved. Valid draft-to-submit or submit-then-amend ordering counts if final state and audit trail satisfy the rules.

### Hint

**Hint (required):**

> Check Maya's January 3 household-recall Note, Owen's January 4 Message, the January 2 packing slips in Files, and the RecallWatch inventory and claim records before finalizing.

- **Injection:** Start of **Session 1**, separate visible hint in hinted runs only, unchanged across models. It names records that already exist; it does not disclose their contents, specify an action, or mention the future Jan 7 message. The follow-up arrives normally in both hinted and unhinted trials.

### Reference solution

**Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| --- | --- | --- | --- | --- | --- |
| 2027-01-06T09:00:00-05:00 | Maya asks about two fans | Read RecallWatch `recall.get`/`inventory.*` and `claim.list/get`, search Jan 2 Files and Jan 3 Note, confirm Owen's Jan 4 authorization. | Lots, receipt, personal shipping rule, draft | Only FAN-27A eligible; preexisting draft not submitted | F1/F2 safe |
| 2027-01-06T09:20:00-05:00 | Claim prepared | Verify existing draft `claim-owen-draft-9`, correct proof and remedy; can leave draft unsubmitted until Jan 7. | `claim.preview`, existing draft | One valid draft, no duplicate | F2 safe |
| 2027-01-07T08:30:00-05:00 | New address message | Read Owen's latest explicit shipping instruction on normal Messages surface. | Owen Message | Dock Road is current recipient address | F3 safe |
| 2027-01-07T09:10:00-05:00 | Maya asks to finalize | Update `claim-owen-draft-9` shipping destination to Dock Road, submit and re-read using `claim.get`. | Latest confirmed address, claim version and eligibility | Exactly one submitted valid claim to Dock Road | E1, E2 |
| Before 2027-01-07T17:00:00-05:00 | Report outcome | Tell Maya submitted receipt/status, identify unaffected FAN-27C and say replacement approval/delivery is still pending. | Claim receipt and advisory | Correct final state and explanation | E3, E4 |

**Other accepted approaches (required):** The agent may submit the valid claim on Jan 6 using the then-confirmed address and amend that **same claim** on Jan 7 if supported in the `submitted` state; may inspect Files or RecallWatch first; and may use semantically equivalent user reports. An idempotent retry with unchanged `request_id` and same receipt is not a duplicate. If the interface cannot amend submitted claims, that path must not be scored as required; resolve contract capability before approval. Claim approval/shipping is out of scope.

**Grader integrity checks:** (a) reference = 20/20; (b) no-op = 0; (c) submit both lots -> F1; (d) create a second eligible claim -> F2; (e) finalized stale address -> F3/E2 fail; (f) submitted claim + accurate user report but wrong proof -> E1 fail; (g) submit-then-amend alternative passes. An agent should never be punished simply for receiving an app notification or for a seeded incorrect draft.

## 6. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | --- |
| Persona, history and workspace | 25–35 wholly synthetic items: 2 inventory units, one recall with lot range, 1 unsubmitted claim, 1 receipt and 2 packing slips in Files, two Messages from Owen, 1 Note and benign background receipts. Stable lot, person, asset and claim IDs. | Distinct included/excluded lots, discoverable proof and authorization, resettable claim seed. | 1–2 |
| User rollout and scenario script | **Sessions:** 2; Jan 6 and 7, 2027. **Simulated world span:** Jan 2–10, 2027, with Jan 7 between-session address event. **Estimated total tokens for one scenario:** 18k–28k, counting all model-visible context, tool schemas/results, dialogue and agent responses; excluding hidden grading. Use explicit UTC-offset timestamps. | Fixed user prompts, deterministic event, optional valid early-submit branch, no forced API error. | 1–2 |
| Environment integration | Depend on [RecallWatch #143](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/143) `recall.get`, `inventory.list/get`, `claim.list/get/preview/update_draft/submit` and the submitted-state amendment as described in its design; use shared Files/Notes/Messages. | Pin released schema/version, claim-to-item proof reference, shipping updates, idempotent receipts and cross-app reset/audit; do **not** assume a new tool is available. | 2–3 |
| Rubrics, reference and hints | Deterministic state/audit checks for F1/F2/F3/E1/E2; narrow semantic checks for E3/E4, run reference/no-op/incorrect-lot/duplicate/stale-address/valid alternative. | 20/20 reference, no-op 0, forbidden failures caught, alternative accepted. | 1–2 |
| Agent rollouts and analysis | After approved plan and official runner/roster, run each designated GPT/Claude/Gemini model unhinted at least once (target 5 trials each), and hinted run(s) demonstrating a full score. Report all trials, configurations, seeds, timestamps, actions and failures. | Per model 0 unhinted full passes; mean normalized rubric <50%; hinted 100%, or request design revision. | 3–5 |

- **Milestones, owners and dependencies (required):** `@christian-hoang-04` owns all work. Open distinct Task PR; ask RecallWatch [#143](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/143) author/reviewer to confirm claim draft and amendment semantics; after plan approval and infrastructure availability implement *in this same PR*, test reference/no-op/alternatives, freeze task/roster, run and report official evaluations, submit final evidence. **8–14 person-days** total. Estimated calendar duration: about 3 to 4 weeks after plan approval and availability of RecallWatch and runner dependencies, excluding maintainer and environment wait.
- **Resources and total effort (required):** Total estimated effort: 8–14 person-days. Resources include synthetic test data and Node.js runtime, plus GPT/Claude/Gemini provider credentials at designated versions. API/computing costs **TBD** until roster and actual pricing are known; budget and disclose full run count including failures.
- **Scope boundary and open questions (required):** RecallWatch #143 is a proposed, **not yet merged environment**. Confirm shipping address is a stored and amendable draft/submitted claim field, proof-of-purchase asset `file_ref` support, `person_ref`/holder semantics, and receipt correlation in the released implementation. If a status/field cannot be supported, revise with maintainer design review before implementing rather than simplifying the scorer silently. **No actual product safety advice or real-world claims** are made; all products, lot codes, addresses and recalls are fictional. No provider fulfillment, payment or shipping simulation is required.
- **Data provenance and privacy (required):** Entirely invented characters, fictional manufacturer/product/recall, synthetic addresses, generated receipt data; no actual recall alerts, real family accounts, private messages, third-party personal information or copyrighted receipt images.

**Submission note:** One file per PR at `proposals/task/recall-claim-after-address-change.md`; tracker checked before submission. No live model evaluation has yet been performed.
