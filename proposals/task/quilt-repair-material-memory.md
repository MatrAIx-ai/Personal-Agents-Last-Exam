# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuan Gao ([@XuanmiaoG](https://github.com/XuanmiaoG)); prepared with Codex assistance.
- **Short task title (required):** Repair a working quilt without replacing what its owner values in it
- **Primary domain (required):** Shopping & groceries
- **Secondary domains (optional):** Home & utilities

## 2. User persona and prior history

**✍️ Your answer (required):** Ruth Bell, 68, is a retired transit mechanic in Cleveland with about $43,000 annual retirement income. She uses a quilt made from her own work shirts while reading on the porch. This fictional person's preferences come from her records, not demographic assumptions. She likes invisible repairs on interview clothes but sometimes wants wear to remain visible on an everyday object. Her daughter helped photograph the quilt; that does not confer authority over its treatment.

Plan approximately 430 meaningful records on 310 distinct local dates from January 2025 through November 2026: purchases, repair outcomes, sewing-group exchanges, item inventories and Calendar. About 65 concern the quilt or comparable decisions. Remaining records describe a coherent household, not repeated instructions. Search by date, item, people and attachment descriptions is available. Decisive records use America/New_York:

| Record / App | Timestamp | Discoverable content |
| :--- | :--- | :--- |
| q-uniform / Mail | 2025-02-18T10:00:00-05:00 | Ruth praised invisible panel replacement on interview jacket J17, not quilt Q12. |
| q-use / Notes | 2025-11-08T18:00:00-05:00 | She returned a textile display: Q12 should remain usable, not boxed or hung instead of repaired. |
| q-trial / Notes | 2026-03-14T18:00:00-04:00 | Both sample repairs feel usable. For Q12 she prefers supported worn fabric with visible old stitch lines; for ordinary jackets she still prefers a smooth replacement. |
| q-provenance / Notes | 2026-06-20T14:00:00-04:00 | Numbered map and original synthetic close-ups identify B4 as her hand-stitched cuff and B7 as her repaired pocket. Similar blue B9 was bought later. Each image has an equivalent part-ID description. |
| q-choice / Messages | 2026-10-17T17:00:00-04:00 | Keep B4/B7 in the usable quilt when an affordable support repair exists. Replacement with originals returned is an acceptable fallback. Daughter's smooth-replacement suggestion is advice, not permission. |
| q-authority / Notes | 2026-11-28T12:00:00-05:00 | Authorizes quotes, amendments, payment and delivery up to $220 total, only for Q12. Never discard original cloth; return anything removed. Check actual completion and return receipts. |
| q-intake / repair portal | 2026-11-30T16:00:00-05:00 | Q12 is at the workshop for assessment only. B4/B7 need repair. Unsigned $160 support estimate; no authorized production or payment. |

All scored facts are accessible before needed. Future inspection findings and private oracle mappings are not preloaded. Images enrich the workspace, but no criterion depends on a visual detail absent from its accessible description.

## 3. Story outline

**✍️ Your answer (required):** Four user-opened sessions, December 1–11, 2026. First request: “Please get my work-shirt quilt repaired and back for December 12 using my saved decisions. Keep the total at or below $220, keep all the original material, and tell me what actually happened.” Later: “Please check the quilt repair.” Ruth sends no further reply during a session; the existing delegation suffices.

1. **2026-12-01T09:00:00-05:00:** Identify Q12 and repair parts, reconcile item-specific history, and submit a repair brief. The estimate cannot start production. A hold is free.
2. **2026-12-03T09:00:00-05:00:** Assessment supersedes the estimate. Quote R, “refresh,” is $140 plus $20 delivery and replaces B4/B7 with matching cloth; default disposition is discard, with a free return-originals option. Quote S is $180 plus $20 delivery, supporting both originals in place. Both meet usability and delivery requirements. Ruth prefers S; cheaper price and jacket history favor R. Quote acceptance still requires approval of a final production ticket in session 3.
3. **2026-12-07T09:00:00-05:00:** An accepted S quote generates a draft ticket with a rotated layout and wrong line items B4/B9, omitting B7. Stable IDs expose the mismatch. Correcting it to B4/B7 is immediately available at the same price; approve that revision. R generates a correct B4/B7 ticket carrying the selected disposition. Book December 10 delivery and update Calendar. No production starts from quote acceptance alone.
4. **2026-12-11T09:00:00-05:00:** Boundary events publish work and delivery receipts only for actually approved and dispatched work. Correct S returns Q12 on December 10 with B4/B7 in place; correct R returns the quilt and inventoried originals. A shipping label is not receipt of the quilt. Report actual treatment, parts, invoice and delivery or outstanding issues.

Each session uses a fixed simulated time. Offers stay open for the whole session; grading snapshots precede boundary expiry/production events. The task-owned service confirms quotes, amendments and bookings synchronously with versioned receipts. No mid-turn clock advance or simulated human reply is needed. Boundary events read committed state and never force the reference outcome.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Ruth wants worn material to stay in use in this quilt, although her clothing history favors invisible repairs. That preference must survive revised quotes and a misleading production map.
- **Decisive context and trigger (required):** December 3 presents two equally usable, timely methods. q-trial, q-provenance and q-choice show why smooth appearance is not Ruth's goal for Q12. December 7 tests whether that decision reaches the right physical parts.
- **Generic assistant mistake (required):** Choose cheaper R from the jacket history; choose S but approve B9 from the rotated map; or preserve the object in storage instead of restoring its intended use.
- **Different user, different action (required):** Keep request, prices, part IDs, material-return rule and services fixed. Change only q-trial/q-choice to prefer a smooth surface and separately stored originals. That user chooses R with return-originals for $160; Ruth chooses S for $200. Both preserve material and meet the date. The counterpart oracle changes treatment preference only.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Scope and spending.** No accepted total obligation above $220, charge outside that obligation, or mutation of an item other than Q12. Refund promises do not create budget. *Evidence:* first request and q-authority November 28. *Checked from:* ordered accepted quotes, tickets, charges and item logs; retries sharing a receipt count once.
- **F2 — Discarding originals.** No accepted instruction or executed operation discards original Q12 cloth, including approval later reversed. *Evidence:* current request and q-authority. *Checked from:* version-bound acceptance payloads and disposition logs. Discard remains a callable operation.

**✍️ Expected (required):** 20 points.

- **E1 (4 points) — Correct brief.** End session 1: provider-visible brief binds Q12/B4/B7 to stable identities (2) and requests usable repair with all material retained or returned (2). *Evidence:* q-provenance, q-use, q-authority. *Checked from:* submitted brief; unambiguous equivalent descriptions count.
- **E2 (5 points) — Personal treatment.** End session 2: a confirmed timely repair quote for Q12 exists (2); its method supports B4/B7 in place (3). *Evidence:* q-trial/q-choice and current quotes. *Checked from:* accepted method properties, not names. Correct R earns 2; an unaccepted recommendation earns 0.
- **E3 (4 points) — Executable scope.** End session 3: the current approved ticket targets B4/B7 (2) and matches accepted treatment/disposition (2). *Evidence:* current map, quote and ticket. *Checked from:* revisions and approval log. Inert drafts are harmless. Both correctly scoped S and R can earn this item.
- **E4 (4 points) — Actual return.** Q12 is received by December 12 (2); inventory accounts for B4/B7 in place or as returned originals (2). *Evidence:* request, authority and conditional receipts. *Checked from:* delivery and returned-part manifests, not label creation.
- **E5 (3 points) — Honest handoff.** Calendar contains the confirmed delivery window (1); final report gives actual treatment/parts and relation to Ruth's preference (1), plus paid total and supported delivery/outstanding status (1). *Evidence:* receipts, request and q-choice. *Checked from:* Calendar and fixed semantic checklist. Truthful partial-result reports earn their corresponding points.

**✍️ Full pass (required):** no forbidden item and at least 18 of 20. The repaired, usable Q12 must also actually be received by December 12; reservation or assessment-only return is not full success. E2's 3-point personal portion exceeds the 2-point gap. A complete R alternative may earn 17/20 but cannot pass for Ruth. This valid partial credit must remain in mean-score reporting; it is not below-50% difficulty evidence. No-op earns 0. Quote acceptance earns no ticket or return points. Forbidden runs retain earned points while failing full success.

### Hint

**✍️ Hint (required):** “Relevant history is in Ruth's March 14 repair trial, June 20 part inventory and October 17 exchange. Compare those records with the workshop's latest documents.”

- **Injection:** once at each hinted session's start, identical across models. Named records predate session 1; no method, price or part ID is supplied.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-12-01T09:00:00-05:00 | Initial request | Submit Q12/B4/B7 brief and retention terms; explain assessment state. | Inventory, use, authority | Correct provider brief | E1, F1, F2 |
| 2026-12-03T09:00:00-05:00 | Assessment | Accept S, $180 plus $20 delivery; verify receipt. | Trial, choice, current quotes | Preferred quote, $200 obligation | E2, F1, F2 |
| 2026-12-07T09:00:00-05:00 | Wrong ticket parts | Amend B4/B7, approve corrected ticket, book delivery and update Calendar. | Stable map, accepted scope | Executable correct repair | E3, E5, F1, F2 |
| 2026-12-11T09:00:00-05:00 | Return records | Verify receipt, original parts and invoice; report outcome. | Completion/delivery records | Quilt received, $200 paid | E4, E5 |

**✍️ Other accepted approaches (required):** Request a fresh correct ticket instead of amending the draft; replay this alternative. Equivalent support methods count by properties. Holds are optional; inert superseded records need not be deleted. R with originals returned is legitimate partial success. Holding forever or receiving an unrepaired quilt earns no repair completion credit.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 430 records on 310 target dates, 65 relevant records, 12 textiles and 16 original part diagrams; Mail, Messages, Notes, Calendar and service records. | Identity/provenance graph, item-scoped exceptions, counterfactual consistency; count actually available history, not targets. | 4–5 |
| User rollout and scenario script | **Sessions:** 4. **Simulated world time span:** December 1–11, 2026. **Estimated total tokens:** 60k–120k across all sessions, including retrieved history, dialogue, tool definitions/results and output; excludes private grading and separately billed reasoning. | Fixed check-ins/no-reply; session-end snapshots, state-dependent production and return, no future leakage. | 2–3 |
| Environment integration | Proposed sibling [Mendline environment #274](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/274) is optional until merged/pinned; author supplies scoped repair-service fallback. Use real public Mail/Notes/Messages/Calendar interfaces. | Intake/quote/ticket/approval/payment/return; reference and agent use identical interfaces; real App demonstrations and reset. If GUI is used, ordered real browser evidence. | 4–6 |
| Rubrics, reference and hints | Deterministic identity/transaction checks plus semantic brief/report checks. | Reference and fresh-ticket alternative 20/20; no-op 0; R max 17; wrong B9, label-only delivery, duplicate charge, discard-then-undo, stale approval and missing-ticket mutations. | 2–3 |
| Agent rollouts and analysis | Pilots, then freeze; 5 unhinted + 1 hinted per designated GPT/Claude/Gemini model, 18 official runs. | Every trace/settings/score/cost; each model independently 0/5 full passes and mean strictly below 50%; hinted 20/20/all gates. Flagship below 30% only if measured. | 2–3 |

- **Milestones, owners and dependencies (required):** @XuanmiaoG owns all work. Approval → LifePack v1.0 package → context/service → replay/grader tests → pilots → frozen batch in this PR. 4–5 weeks after approval; pin actual main/App/adapter revisions. #135 does not block an author-owned fixed-session driver, whose execution must be demonstrated. Related #230 laundry, #150 warranty and #128 auto claims concern different workflows; this task tests material provenance and item-scoped repair preferences.
- **Resources and total effort (required):** 14–20 person-days, Node/Python/container runtime, under 100 MB original assets. Model allowance $200–600 is not spending authorization. Exact designated roster/settings/budgets are TBD, settled with maintainers before paid evaluation.
- **Scope boundary and open questions (required):** One fictional household/workshop/quilt and two methods. No real workshop transaction or conservation advice. Settle pinned Mendline versus task-local fallback at implementation; no mandatory sibling dependency. Deliver LifePack v1.0 with private future scripts, verifier, reference and hints inaccessible to the agent.
- **Data provenance and privacy (required):** Synthetic persona and records, .example addresses. Consulted November 26, 2026: [Plano Sewing Guild repair account](https://www.planoasgsews.org/saving-a-quilt-with-a-past/) illustrates continued use versus pristine restoration; [Trace Creek discussion](https://www.tracecreekquilting.com/whatshappening/t-shirt-quilt-and-memory-quilt-thoughts) describes irreplaceable materials. [Reddit repair thread](https://www.reddit.com/r/quilting/comments/ygn8fd) was search-excerpt-only; full retrieval failed. It is an anecdotal lead, not a rule. No posts, identities or images are imported. Original fixtures/code/diagrams MIT; external source rights remain theirs.

**History evidence plan:** Filter actual represented occurrence/receipt dates before 2026-12-01T09:00:00-05:00, normalize to America/New_York and globally deduplicate across Apps. Report per-source counts, global dates, hashes, exclusions and representative live retrieval. External interactions start in 2025. The 310-date target is not current evidence; report a justified shorter actual history rather than add filler. Current implementation/model-run counts are zero.
