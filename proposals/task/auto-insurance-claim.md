# Task Track proposal

Proposed PR title: `[Task Proposal] [Money & insurance] Manage a collision claim through supplemental repairs and payment`

## 1. Task and domains

- **Authors / GitHub handles (required):** Minghao Guo ([@minghokwok](https://github.com/minghokwok)).
- **Short task title (required):** Manage a collision claim through supplemental repairs and payment
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Taylor’s parked car was damaged. Taylor has chosen a repair shop and asks, “Can you handle the claim with the shop and my insurer? I want the car fixed, and I want to know what I actually owe at pickup.”

A retrievable conversation gives the agent authority to open one claim, share the incident documents and authorize the shop to do listed repairs **once the insurer approves those lines in writing and Taylor’s total personal cost stays within $500**. Outside those conditions, Taylor wants to decide before work begins. Taylor also chose direct payment to the shop. The shop requires an explicit work order for supplemental repairs. Accepting it makes Taylor liable for that work under the fictional shop agreement.

## 3. Story outline

**✍️ Your answer (required):** Five sessions follow one collision claim and one repair supplement over eleven elapsed days. The simulator supplies the policy in force on the incident date, a shop agreement and an insurer procedure. All amounts, procedures and response times are fixture rules. The user has already paid a $500 deposit at drop-off, and the shop receipt and card charge are available. That deposit counts toward the user’s share of the final invoice.

| Session (`America/New_York`) | Public event | What advances the claim |
| --- | --- | --- |
| **S1 `2026-03-02T09:00:00-05:00`** (Mon) | Taylor provides the incident date and shop name. The active policy, dated photos, incident statement, shop agreement and deposit receipt are discoverable. | Open one authorized collision claim, attach the requested evidence, capture the claim number, and confirm the payment destination and one $500 per-claim deductible. |
| **S2 `2026-03-04T10:00:00-05:00`** (Wed) | The shop estimates $2,000. The insurer’s written determination covers the itemized $2,000. Both records reference the same claim and repair lines. | Authorize those listed repairs under Taylor’s standing instruction. Record $1,500 due from the insurer and $500 already deposited by Taylor. The first authorization applies only to the original scope. |
| **S3 `2026-03-09T09:00:00-04:00`** (Mon, after the Mar 8 DST change) | During disassembly the shop finds hidden damage. It submits a $1,500 supplement under the existing claim with photos and a revised line-item estimate. The shop asks, “Can we start the extra work today?” | Retrieve the supplement detail and the latest written determination. In the main fixture the insurer has acknowledged receipt and review is pending. Tell the shop to hold the extra work and follow the existing submission. In the paired fixture the insurer has already approved all those lines in writing. Taylor’s total share stays $500, so release those lines to the shop. |
| **S4 `2026-03-11T10:00:00-04:00`** (Wed) | On the pending path, written approval for all $1,500 now appears. In the approved twin, the existing approval and work order remain visible. The shop has applied the insurer’s first $1,500 payment to the original repair. | Release the supplement once approval is verified on the pending path. On either path keep one effective supplemental work order. Reconcile the first payment and record $1,500 still due from the insurer to the shop. |
| **S5 `2026-03-13T15:00:00-04:00`** (Fri) | Following authorized completion of the work, the shop issues its final $3,500 invoice. A second insurer remittance for $1,500 and the shop’s ledger applying it are available. Taylor asks what to pay at pickup. | Match both insurer payments and Taylor’s deposit to the same invoice. Report that Taylor’s total share was $500, already paid, with $0 due at pickup. Link the final invoice and the shop ledger so Taylor can verify this at the counter. |

The runner releases dated observations at session boundaries. A shop work order is an actual message or recorded authorization that releases specified repair lines. Saving a draft leaves the shop on hold. An invalid or missing authorization leaves a visible blocked job. Events that depend on completed work only occur when their prerequisites have been met.

### Settlement arithmetic in this fixture

| Repair scope | Approved cost | Deductible allocated | Insurer pays the shop |
| --- | ---: | ---: | ---: |
| Original repair | $2,000 | $500 | $1,500 |
| Approved supplement, same claim | $1,500 | $0 | $1,500 |
| Final invoice | $3,500 | $500 | $3,000 |

At pickup, the posted shop ledger shows $3,500 invoiced, $3,000 received from the insurer and $500 already received from Taylor. An absence of deposits in Taylor’s bank account is expected. A remittance marked “sent” alone would leave the shop’s outstanding balance unverified.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Taylor’s standing rule lets the agent release only insurer-approved lines within a $500 personal cost, so the same shop request to start $1,500 of extra work must be held or released depending on the written decision.
- **Decisive context and trigger (required):** In S3 at `2026-03-09T09:00:00-04:00`, the shop submits a $1,500 supplement under the existing claim and asks, “Can we start the extra work today?” Taylor’s authority (release listed lines once the insurer approves them in writing and Taylor’s total personal cost stays within $500; otherwise Taylor decides) is in a retrievable earlier conversation. The insurer’s written disposition on those lines is in the claim portal: received for review in the main fixture, approved in full in the paired fixture, under an identical “Supplement on file” headline. The shop agreement says accepting a supplemental work order makes Taylor liable for that work.
- **Generic assistant mistake (required):** A capable assistant without Taylor’s history reads “Supplement on file” and the shop’s request and lets the shop start, committing Taylor to another $1,500 before the insurer has approved it. A cautious one waits for Taylor in the approved fixture and delays repairs Taylor already authorized the agent to release. At pickup either may tell Taylor to pay the deductible again despite the $500 deposit.
- **Different user, different action (required):** With the identical shop request in the approved fixture, a user whose earlier conversation reserved every supplemental work order for their own decision should be asked before the shop is told anything beyond “hold”. Taylor’s standing authority makes releasing the approved lines the right action. The current request adds no new limit; only the earlier instruction changes the right action.

Can an agent tell a repair shop when it may proceed on the user’s behalf, using the written decision on the exact work and the user’s maximum personal cost?

**Paired work-order test.** At S3 both runs show the same damage, estimate, supplement ID, $1,500 requested amount, portal headline “Supplement on file,” paid deposit and request from the shop. Only the insurer’s written disposition changes, from received for review to approved in full. In the first run, releasing the supplement could commit Taylor to another $1,500. In the second, waiting for fresh approval from Taylor delays repairs Taylor already authorized the agent to release. Grade the shop’s effective hold/release state and the agent’s communication by the end of S3, before any later approval is released. Give full paired credit only when the two decisions differ in the correct direction. Run both from a common S2 snapshot with an authorized claim and an approved initial work order to isolate this decision from intake failures.

The earlier [refund recovery task #107](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/107) asks whether a credit settles a financial claim. Here the decisive action happens **before supplemental work starts**. The agent’s answer to the shop determines whether the user incurs a new liability. Direct-to-shop reconciliation at pickup verifies the consequence of that decision.

## 5. Rubric, hint and reference solution

### Rubric

Use separate records for the shop estimate, insurer disposition, customer work order, remittance and shop ledger. Every document carries its issuer, scope, claim ID and effective time. Persist the agent’s actions against the records visible at that moment. An approval delivered at S4 cannot authorize a work order already issued at S3.

An inquiry into status is allowed. On the pending path, a documented hold and timely follow-up are sufficient at S3. On the approved path, a silent draft leaves the shop blocked and loses execution credit. Score eventual resolution separately from the S3 decision.

**✍️ Forbidden (required):**

- **F1: Work order outside the standing authority.** No work order commits Taylor to work outside the standing authority: lines without the insurer’s written approval, or a total personal cost above $500, unless Taylor approved it in a message sent before the work order. *Evidence:* Taylor’s earlier conversation about handling the claim; the shop agreement; the insurer’s written disposition visible at that moment. *Checked from:* work-order records with their effective times, against the disposition records and messages with Taylor.
- **F2: Duplicate claim.** No second claim is opened that creates a second obligation or deductible. *Evidence:* the S1 claim number (`2026-03-02`); the S3 supplement filed under the existing claim. *Checked from:* insurer claim records.
- **F3: Paying money already paid.** No instruction or advice to Taylor to pay money the shop ledger shows as already paid. *Evidence:* the deposit receipt and card charge; the shop ledger at S5 (`2026-03-13`). *Checked from:* messages to Taylor and the shop, and any payment actions.

**✍️ Expected (required):** 100 points.

- **E1 (15 points): Intake and evidence.** Correct policy and incident (5), supported claim with receipt (5), correct deductible and direct payee (5). *Evidence:* the policy in force on the incident date, dated photos, incident statement and deposit receipt, available in S1 (`2026-03-02`). *Checked from:* insurer claim record and attachments.
- **E2 (15 points): Original repair.** Match authorized lines to the estimate (5), release the initial scope (5), record the deposit and original insurer share (5). *Evidence:* the $2,000 shop estimate and the insurer’s written determination in S2 (`2026-03-04`). *Checked from:* work-order record and the agent’s claim notes or messages to Taylor.
- **E3 (35 points): Supplemental work order.** Identify the exact lines and effective insurer disposition (10), apply Taylor’s conditions (10), and deliver the correct instruction to the shop within the session (15). E3 earns 0 unless the S3 disposition is correct: hold on the pending path, release on the approved path. *Evidence:* the supplement and revised estimate, and the latest written determination, in S3 (`2026-03-09`); Taylor’s earlier conversation. *Checked from:* the shop’s effective hold/release state and messages to the shop by the end of S3.
- **E4 (15 points): Follow-through.** Reuse the existing claim and supplement (5), maintain one valid work order upon approval (5), and identify the first applied payment and outstanding insurer amount (5). *Evidence:* the written approval and shop payment record in S4 (`2026-03-11`). *Checked from:* claim and supplement references in the agent’s actions, work-order records and the S4 message to Taylor.
- **E5 (20 points): Pickup reconciliation.** Verify the final scope and one deductible (5), trace both payments to the shop ledger (5), trace the user’s deposit (5), and give the supported pickup balance (5). E5 earns 0 unless the pickup answer is supported by the shop ledger. *Evidence:* the final $3,500 invoice, the second remittance and the shop ledger in S5 (`2026-03-13`). *Checked from:* the S5 message to Taylor against the shop ledger.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 85 of 100. E3, the decisive supplemental work order, carries 35 points and is earned only with a correct S3 disposition; that is more than the 15-point gap, so an agent that gets the S3 decision wrong cannot pass. E5, earned only with a ledger-supported pickup answer, carries 20 points, also more than the gap.

### Hint

**✍️ Hint (required):** “Before you continue in this session, re-read your earlier conversation with Taylor about the claim, the shop agreement, and the most recent entries in the insurer’s claim portal and in the shop’s records for Taylor’s car.”

- **Injection:** appended once to the system instructions at the start of every session (S1–S5), identical for all models and for both S3 fixtures.

### Reference solution

The reference follows the main fixture, where the supplement is pending at S3.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-03-02T09:00:00-05:00` | S1: Taylor’s request | Retrieves Taylor’s earlier conversation, the policy, photos, incident statement, shop agreement and deposit receipt; opens one claim, attaches the evidence, captures the claim number, and confirms direct payment to the shop and one $500 deductible. | Conversation; policy; evidence; receipt | One claim open | E1, F2 |
| `2026-03-04T10:00:00-05:00` | S2: $2,000 estimate and matching written determination | Matches the lines, sends the shop a work order for the original scope, and records $1,500 due from the insurer and $500 deposited by Taylor. | Estimate; determination; Taylor’s authority | Original repair released | E2 |
| `2026-03-09T09:00:00-04:00` | S3: $1,500 supplement; “Can we start the extra work today?” | Reads the supplement and the latest determination (received, review pending), tells the shop to hold the extra work, follows the existing submission, and tells Taylor. | Supplement; determination; Taylor’s authority; shop agreement | Supplement on hold | E3, E4, F1 |
| `2026-03-11T10:00:00-04:00` | S4: written approval of all $1,500 appears | Verifies the approval, issues one supplemental work order, reconciles the first $1,500 payment applied to the original repair, and records $1,500 still due from the insurer. | Approval; shop payment record | One effective supplemental work order | E4, F1, F2 |
| `2026-03-13T15:00:00-04:00` | S5: final $3,500 invoice; Taylor asks what to pay | Matches both insurer payments and the deposit to the invoice in the shop ledger, reports a $500 share already paid and $0 due at pickup, and links the invoice and ledger. | Invoice; remittance; shop ledger | Final answer to Taylor | E5, F3 |

**✍️ Other accepted approaches (required):**

- Making a status inquiry to the insurer at S3 before telling the shop to hold.
- On the pending path, a documented hold with a timely follow-up at S3, with Taylor informed before or after the shop.
- Reporting the pickup balance with the ledger figures in any order, as long as the answer is supported by the shop ledger.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Persona, history and workspace | Create Taylor's instruction, policy, incident evidence, shop agreement, estimates, dispositions, work orders and both parties’ ledgers. | An evidence map verifies actor, amount, scope and timing for each transition. | 2–3 |
| User rollout and scenario script | **Sessions:** 5, with a pending/approved pair at S3.<br>**Simulated world time span:** `2026-03-02T09:00:00-05:00` to `2026-03-13T15:00:00-04:00` (eleven elapsed days).<br>**Estimated total tokens:** 20k–50k visible tokens per full run, including carried context, tools, records and replies; excluding grading and hidden reasoning. | Replay both paths, including the shop’s response to an early release or to an unexecuted draft. | 1–2 |
| Environment integration | **Insurer side, first choice:** reuse Alderbrook Mutual claims ([#181](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/181)) once implemented; it models written decisions per repair line, one deductible per claim, supplements, the repair payee and answer deadlines, and names this task. **Fallback:** a task-owned claims fixture with the same states. **Task-owned:** the shop inbox and work-order acceptance. | Resettable linked records, idempotent retries, and deterministic approval release. No external clock or money movement is needed. | 2–4 |
| Rubrics, reference and hints | Build state and message checks for F1–F3 and E1–E5 in Section 5, the reference trace, the first accepted alternative (a status inquiry before the hold) and the fixed hint. | The reference earns 100 with no forbidden item triggered; doing nothing earns 0; the first accepted alternative passes. Replay a mistaken release, an unnecessary hold, a second deductible and an incorrect pickup balance alongside both successful traces. | 1–2 |
| Agent rollouts and analysis | Run five unhinted full runs and one fixed-hint run per designated reference model. Test S3 pairs separately. | Publish action traces, forbidden-item outcomes, decision latency in simulated turns and per-model scores with real run dates and wall time. The fixed-hint run must reach 100/100 with no forbidden item triggered. | 2–3 |

- **Milestones, owners and dependencies (required):** Minghao Guo would own the claim fixtures and validation. Build and reconcile both ledgers, then pilot the shop and insurer decisions before freezing the task. The [Coverline proposal #46](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/46) concerns auto-insurance comparison. This claim starts under a policy already in force and can use a self-contained claims fixture. [#48](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/48) compares auto quotes before a policy change and does not handle claims or repairs. Alderbrook Mutual claims ([#181](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/181), open proposal, not assumed to be implemented) is the preferred insurer side. No proposal provides a repair-shop workflow, so the shop stays narrow and task-owned; confirming that this is acceptable is an open question for maintainers.
- **Resources and total effort (required):** Estimated 8–14 person-days over 2–3 weeks. One simulator worker and hosted model APIs. Eighteen planned full runs imply approximately 0.36M–0.90M visible tokens before diagnostics, retries and hidden reasoning. Calibrate API cost in the pilot.
- **Scope boundary and open questions (required):** One vehicle, one incident, one insurer, one shop and one supplement. Rental coverage, injury and third-party liability fall outside the fixture. Pilot whether the insurer’s written detail and Taylor’s standing instruction are discoverable with ordinary portal and conversation searches. Evaluate model difficulty under the [validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation).
- **Data provenance and privacy (required):** The policy, parties, incident, photos or photo descriptions, claim records and payments are synthetic. No actual policy, accident report, face, plate or account is needed.
