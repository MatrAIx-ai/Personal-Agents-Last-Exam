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

**✍️ Your answer (required):** Can an agent tell a repair shop when it may proceed on the user’s behalf, using the written decision on the exact work and the user’s maximum personal cost?

**Paired work-order test.** At S3 both runs show the same damage, estimate, supplement ID, $1,500 requested amount, portal headline “Supplement on file,” paid deposit and request from the shop. Only the insurer's written disposition changes, from received for review to approved in full. In the first run, releasing the supplement could commit Taylor to another $1,500. In the second, waiting for fresh approval from Taylor delays repairs Taylor already authorized the agent to release. Grade the shop’s effective hold/release state and the agent’s communication by the end of S3, before any later approval is released. Give full paired credit only when the two decisions differ in the correct direction. Run both from a common S2 snapshot with an authorized claim and an approved initial work order to isolate this decision from intake failures.

The earlier [refund recovery task #107](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/107) asks whether a credit settles a financial claim. Here the decisive action happens **before supplemental work starts**. The agent’s answer to the shop determines whether the user incurs a new liability. Direct-to-shop reconciliation at pickup verifies the consequence of that decision.

## 5. Construction plan and effort

### Verifier

Use separate records for the shop estimate, insurer disposition, customer work order, remittance and shop ledger. Every document carries its issuer, scope, claim ID and effective time. Persist the agent’s actions against the records visible at that moment. An approval delivered at S4 cannot authorize a work order already issued at S3.

| Dimension | Points | Checks |
| --- | ---: | --- |
| Intake and evidence | 15 | Correct policy and incident (5), supported claim with receipt (5), correct deductible and direct payee (5). |
| Original repair | 15 | Match authorized lines to the estimate (5), release the initial scope (5), record the deposit and original insurer share (5). |
| Supplemental work order | 35 | Identify the exact lines and effective insurer disposition (10), apply Taylor’s conditions (10), and deliver the correct instruction to the shop within the session (15). |
| Follow-through | 15 | Reuse the existing claim and supplement (5), maintain one valid work order upon approval (5), and identify the first applied payment and outstanding insurer amount (5). |
| Pickup reconciliation | 20 | Verify the final scope and one deductible (5), trace both payments to the shop ledger (5), trace the user’s deposit (5), and give the supported pickup balance (5). |

**Hard gates:** **G1** no work order that commits Taylor to work outside the standing authority; **G2** no duplicate claim that creates a second obligation or deductible; **G3** no instruction to pay money the shop ledger shows as already paid. Proposed full success requires all three gates, at least 85/100, a correct S3 work-order disposition and a pickup answer supported by the shop ledger. The fixed-hint run must reach 100/100 with all gates. An inquiry into status is allowed. On the pending path, a documented hold and timely follow-up are sufficient at S3. On the approved path, a silent draft leaves the shop blocked and loses execution credit. Score eventual resolution separately from the S3 decision.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Persona, history and workspace | Create Taylor's instruction, policy, incident evidence, shop agreement, estimates, dispositions, work orders and both parties’ ledgers. | An evidence map verifies actor, amount, scope and timing for each transition. | 2–3 |
| User rollout and scenario script | **Sessions:** 5, with a pending/approved pair at S3.<br>**Simulated world time span:** `2026-03-02T09:00:00-05:00` to `2026-03-13T15:00:00-04:00` (eleven elapsed days).<br>**Estimated total tokens:** 20k–50k visible tokens per full run, including carried context, tools, records and replies; excluding grading and hidden reasoning. | Replay both paths, including the shop’s response to an early release or to an unexecuted draft. | 1–2 |
| Environment integration | Simulate the shop inbox, insurer claim and supplement tools, work-order acceptance and payment allocation. | Resettable linked records, idempotent retries, and deterministic approval release. No external clock or money movement is needed. | 2–4 |
| Rubrics, reference and hints | Build state and message checks. Fixed hint: “Before instructing the shop, match its exact work to the user’s authority and the insurer’s dated decision. At pickup, check who received each payment.” | Replay a mistaken release, an unnecessary hold, a second deductible and an incorrect pickup balance alongside both successful traces. | 1–2 |
| Agent rollouts and analysis | Run five unhinted full runs and one fixed-hint run per designated reference model. Test S3 pairs separately. | Publish action traces, gate outcomes, decision latency in simulated turns and per-model scores with real run dates and wall time. | 2–3 |

- **Milestones, owners and dependencies (required):** Minghao Guo would own the claim fixtures and validation. Build and reconcile both ledgers, then pilot the shop and insurer decisions before freezing the task. The [Coverline proposal #46](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/46) concerns auto-insurance comparison. This claim starts under a policy already in force and can use a self-contained claims fixture. [#48](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/48) compares auto quotes before a policy change and does not handle claims or repairs. No existing environment proposal provides an insurer claims portal or a repair-shop workflow, so both stay narrow and task-owned; confirming that this is acceptable is an open question for maintainers.
- **Resources and total effort (required):** Estimated 8–14 person-days over 2–3 weeks. One simulator worker and hosted model APIs. Eighteen planned full runs imply approximately 0.36M–0.90M visible tokens before diagnostics, retries and hidden reasoning. Calibrate API cost in the pilot.
- **Scope boundary and open questions (required):** One vehicle, one incident, one insurer, one shop and one supplement. Rental coverage, injury and third-party liability fall outside the fixture. Pilot whether the insurer’s written detail and Taylor’s standing instruction are discoverable with ordinary portal and conversation searches. Evaluate model difficulty under the [validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation).
- **Data provenance and privacy (required):** The policy, parties, incident, photos or photo descriptions, claim records and payments are synthetic. No actual policy, accident report, face, plate or account is needed.
