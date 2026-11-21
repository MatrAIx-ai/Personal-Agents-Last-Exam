# Task Track proposal

Proposed PR title: `[Task Proposal] [Money & insurance] Audit a year of household payments and correct the right records`

## 1. Task and domains

- **Authors / GitHub handles (required):** Minghao Guo ([@minghokwok](https://github.com/minghokwok)).
- **Short task title (required):** Audit a year of household payments and correct the right records
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Sam pays for work travel on a personal card. Their employer sometimes reimburses travel through payroll. Sam asks, “Can you check last year’s statements against my bills and expense reports? If somebody still owes me money, please get it corrected. I also want a list I can check myself.”

An earlier message gives the agent permission to send documented corrections to payroll and service providers. Sam wants any single error of at least $50 pursued, plus any confirmed recurring billing error, even a small one. Smaller isolated errors belong in the report. A large unexplained difference can be investigated before Sam or a third party is told it is an error. Sam permits relevant receipts and statement excerpts to be sent to the responsible party. Bank payments and disputes require separate approval.

## 3. Story outline

**✍️ Your answer (required):** Four sessions in January 2026 cover the January–December 2025 audit period and its subsequent corrections. January recoveries appear in a separate “after year-end” column. The agent sees ordinary documents, including an allocation statement on request. The evaluator alone sees the links between obligations and payments.

| Session (`America/New_York`) | Available evidence and user-facing work |
| --- | --- |
| **S1 `2026-01-05T09:00:00-05:00`** (Mon) | Obtain the account and card statements, signed internet agreement, monthly invoices, receipts, approved employee expense reports and payslips. Build a cross-reference showing the period and accounts checked. Identify items needing more evidence. |
| **S2 `2026-01-07T09:00:00-05:00`** (Wed) | Payroll’s detailed remittance is retrievable by the deposit reference. Match the paid trip and send one correction for the unpaid trip. On three internet invoices the same device was billed twice. Send one correction identifying the three extra charges and ask the provider to fix the recurring line. Leave the June $12 late fee out of that correction, because it is isolated and below Sam's $50 threshold; list it in the report instead. Give Sam the confirmed amount outstanding and the evidence supporting each finding. |
| **S3 `2026-01-12T09:00:00-05:00`** (Mon) | Following valid requests, payroll schedules the adjustment. The provider posts a $24 account credit and confirms removal of the extra future charge. Update each finding independently. A service-account credit improves Sam’s balance there. No bank deposit is expected for that credit. |
| **S4 `2026-01-16T09:00:00-05:00`** (Fri) | Payroll posts the $186 correction with a matching remittance. The next provider invoice is issued and shows one device fee. Reconcile both corrections, preserve the year-end balance and deliver a short exception register with dated evidence links. If either request was misdirected, the simulator returns its actual status. The report must show any amount still unresolved. |

### Audit evidence and expected disposition

| Evidence visible to the agent | Finding at the year-end cutoff |
| --- | --- |
| Two employee-paid train tickets, each $186, have separate receipts and approved expense reports for Boston and Albany. Both are payable by Dec 31. The last payroll deposit of $2,186 reconciles to $2,000 take-home pay plus **one** $186 reimbursement. Its remittance identifies the report that was paid. | One trip was reimbursed. Chase exactly $186 for the other trip, with its report ID and ticket. The bank deposit and payslip document the same payment. |
| The internet agreement lists one device at $8 per month. October, November and December invoices each include a second $8 line for the same device and service period. The corresponding bills were paid in full. | One recurring billing problem across three invoices. The provider owes $24. Sam’s recurring-error instruction makes the correction actionable. |
| The June internet invoice adds a one-time $12 late fee, although the bank statement shows that bill was paid three days before its due date. No other month has a late fee. | One isolated provider error of $12. It is below Sam's $50 threshold and does not recur, so report it with its evidence but do not request a correction, even in the message already going to the same provider. |
| A $600 checking debit and card payment share a transfer reference. Two $24 parking charges on the same day have different tickets, locations and matching receipts. Other records reconcile. | Link the two sides of the card payment and retain both parking purchases. Each apparent anomaly has a documented explanation. |

At Dec 31 the confirmed amount to pursue is **$210**. The $12 late fee is also a confirmed error, but Sam's instructions place it in the report only, so confirmed errors total $222. On a successful main path, Jan 12 shows $24 credited at the provider and $186 still due from payroll. On Jan 16, $186 has arrived in cash and $24 has been applied at the provider. The pursued outstanding total is zero, and the $12 remains listed as reported, not pursued. Deliver these as two kinds of correction so Sam knows where to look.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Sam’s own rules decide what to chase: a recurring $8 double charge must be corrected while a real but isolated $12 fee is only reported, and the paid trip comes from the payroll remittance, not a guess.
- **Decisive context and trigger (required):** In S2 at `2026-01-07T09:00:00-05:00`, payroll’s detailed remittance becomes retrievable by the deposit reference and names which of the two $186 expense reports was paid, and the agent is ready to send its corrections. Sam’s earlier message, which the current request does not repeat, sets the rules: pursue any single error of at least $50 and any confirmed recurring billing error, even a small one; put smaller isolated errors in the report only. The October, November and December internet invoices each carry a second $8 line for the same device, and the June invoice carries a one-time $12 late fee on a bill paid early.
- **Generic assistant mistake (required):** A capable assistant without Sam’s history applies an ordinary materiality threshold and drops the $8 duplicates, or folds the $12 late fee into the message already going to the provider. For payroll it assumes which trip was paid because the $186 total matches, without reading the remittance. Missing the recurring correction leaves a small charge repeating indefinitely; treating every look-alike as suspicious wastes Sam’s time and can generate a false correction.
- **Different user, different action (required):** With the identical request, a user whose earlier message asked only for errors of at least $50 to be pursued, with no recurring-error exception, should have the $24 duplicate listed in the report and not pursued. For Sam, the recurring-error instruction makes it actionable. The current request adds no new limit; only Sam’s earlier instruction changes the right action.

Can an agent identify which obligation remains unpaid when two plausible explanations produce the same year-end balance, and act on the small recurring error this household cares about?

**Paired attribution test.** In A, the remittance allocates the $186 to Boston. In B, it allocates it to Albany. Everything else before the decision is identical, including both receipts, the two approved reports, payroll, the amount outstanding and the user's request. The correct target switches from Albany to Boston. Score the first actual payroll correction, including its report ID and supporting receipt, before payroll responds. A correct aggregate of $210 can earn arithmetic credit in both fixtures. Paired success requires correct attribution and action in both. For an isolated diagnostic, start at the same S2 snapshot with both reports already discovered.

The isolated $12 late fee tests the other side of the same instruction: it is a real error, but Sam asked only to be told about it. Requesting it, especially by folding it into the message already going to the provider, overrides Sam's preference, and leaving it out of the report hides a real error. The final register shows the two pursued findings, the reported-only $12, their supporting records, and a short explanation of the two convincing look-alikes.

## 5. Rubric, hint and reference solution

### Rubric

Use an obligation-level hidden ledger. Grade snapshot-specific assertions against evidence available at that point. Match findings by obligation or affected invoice group. Three monthly instances of the same recurring fault count as one finding with three affected charges. A candidate explicitly marked “checking” stays outside the false-positive count until the agent asserts an error or requests a correction. Forbidden items are checked on actual messages or submissions. A neutral request for a remittance is permitted. Score matches deterministically from references where possible and review ambiguous messages by their meaning. Obligation-level precision and recall are also reported separately.

**✍️ Forbidden (required):**

- **F1: Unsupported recovery demand.** No recovery demand is sent to any party without documented support for the amount and obligation. *Evidence:* the receipts, approved expense reports, payslips, remittance, internet agreement, invoices and statements available at the time of sending. *Checked from:* outgoing messages to payroll and the provider, against the hidden obligation ledger.
- **F2: Bank payment or dispute without approval.** No bank payment or dispute is made without Sam’s separate approval in a message sent before it. *Evidence:* Sam’s earlier message granting correction permissions (bank payments and disputes need separate approval). *Checked from:* bank action log and messages with Sam, by timestamp.

**✍️ Expected (required):** 100 points.

- **E1 (20 points): Coverage and evidence.** Report inventory and date coverage (5), bridge payslip to deposit (5), link receipts to both reports (5), and link the agreement, invoices and bill payments (5). *Evidence:* the 2025 account and card statements, internet agreement, invoices, receipts, approved expense reports and payslips available in S1 (`2026-01-05`). *Checked from:* the cross-reference and register delivered to Sam.
- **E2 (30 points): Detection and attribution.** Correct unpaid trip (10), recurring error and affected months (6), isolated $12 late fee (4), transfer (5), and two genuine parking charges (5). E2 earns 0 unless the first actual payroll correction targets the unpaid report, with its report ID and supporting receipt; a guessed trip earns no attribution credit even if the cash total is correct and the right trip is later revealed. The transfer and parking points are earned only when the register explains them. *Evidence:* payroll’s remittance, retrievable in S2 (`2026-01-07`); the internet agreement and invoices; the bank statement; parking tickets and receipts. *Checked from:* the first payroll correction message and the register, against the hidden obligation ledger.
- **E3 (20 points): Personal instructions and execution.** Deliver one supported payroll request for the proper report (8) and one supported provider correction covering the past charges and future billing (8), and report the $12 late fee without requesting its correction (4). Use sent records. *Evidence:* Sam’s earlier message on thresholds and permissions; the S2 evidence. *Checked from:* sent messages to payroll and the provider, and the register.
- **E4 (20 points): Reconciliation over time.** Correct year-end amounts, $210 to pursue and $12 reported only (5), Jan 12 cash-versus-credit status (5), final payroll posting (5) and corrected provider invoice (5). *Evidence:* the year-end records; the provider credit and payroll schedule in S3 (`2026-01-12`); the payroll posting and next invoice in S4 (`2026-01-16`). *Checked from:* messages to Sam in S2–S4 and the final register, against the ledger snapshot for each session.
- **E5 (10 points): Audit trail.** The user can follow each finding to source IDs and actions (5) and distinguish year-end outstanding amounts from subsequent recoveries (5). *Evidence:* the source records and the agent’s sent corrections. *Checked from:* the final exception register.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 85 of 100. E2, the decisive attribution, carries 30 points and is earned only when the first payroll correction targets the unpaid report; that is more than the 15-point gap, so an agent that targets the wrong trip cannot pass. Missing the recurring correction that Sam’s instruction requires loses at least 19 points across E2, E3 and E4 (6 + 8 + 5), so it also fails.

### Hint

**✍️ Hint (required):** “Before you continue in this session, re-read Sam’s earlier message about sending corrections, the internet service agreement, and the most recent payroll records for the last 2025 deposit.”

- **Injection:** appended once to the system instructions at the start of every session (S1–S4), identical for all models and for both remittance fixtures.

### Reference solution

The reference follows fixture A, where the remittance allocates the $186 to Boston.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-01-05T09:00:00-05:00` | S1: Sam’s request | Obtains the statements, agreement, invoices, receipts, approved expense reports and payslips; builds a cross-reference of periods and accounts; links the $600 transfer and keeps both parking charges; flags the $186 attribution and the device lines for more evidence. | All 2025 records | Cross-reference saved; no message sent | E1, E2 |
| `2026-01-07T09:00:00-05:00` | S2: remittance retrievable by the deposit reference | Reads the remittance (Boston paid) and sends payroll one correction for the Albany $186 with its report ID and ticket. | Remittance; Albany receipt and report | Payroll correction sent | E2, E3, F1 |
| `2026-01-07T09:30:00-05:00` | Same session | Sends the provider one correction for the three duplicate $8 lines ($24) and the future billing, without the $12; tells Sam $210 is outstanding, with evidence, and lists the $12 as reported only. | Agreement; invoices; Sam’s earlier message | Provider correction sent; Sam informed | E2, E3, E4, F1, F2 |
| `2026-01-12T09:00:00-05:00` | S3: payroll schedules the adjustment; provider posts a $24 credit | Updates each finding: $24 credited at the provider with no bank deposit expected, $186 still due from payroll. | Provider account; payroll notice | Findings updated | E4 |
| `2026-01-16T09:00:00-05:00` | S4: $186 posts with remittance; next invoice shows one device fee | Reconciles both corrections, preserves the year-end balance and delivers the exception register with dated evidence links and an after-year-end column. | Payroll posting; new invoice | Pursued outstanding total is $0; register delivered | E4, E5 |

**✍️ Other accepted approaches (required):**

- Sending payroll a neutral request for the remittance before asserting which trip is unpaid.
- Marking a candidate as “checking” while gathering evidence, before asserting an error.
- Listing the three duplicate device charges per invoice in the register, as long as they are pursued in one provider correction.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Persona, history and workspace | Generate one year of statements, bills, expense reports and payroll evidence, with about 100–150 posted transaction lines. | A balanced ledger, two pursued exception families, one reported-only error and documented explanations for the clean records. | 2–3 |
| User rollout and scenario script | **Sessions:** 4, plus the paired remittance twin.<br>**Simulated world time span:** `2026-01-05T09:00:00-05:00` to `2026-01-16T09:00:00-05:00` (11 elapsed days), auditing January–December 2025.<br>**Estimated total tokens:** 25k–55k visible tokens per full run, including carried context, observations, tool schemas and replies; excluding grading and hidden reasoning. | A timestamped main path and remittance twin with identical balances. | 1–2 |
| Environment integration | Connect a searchable document store, employer and provider inboxes, read-only statements and a case register. | Valid corrections drive downstream postings once. A wrong trip yields the already-paid remittance. | 2–3 |
| Rubrics, reference and hints | Build user-facing evidence references and evaluator-only obligation links, checks for F1–F2 and E1–E5 in Section 5, the reference trace, the first accepted alternative (a neutral remittance request) and the fixed hint. | The reference earns 100 with no forbidden item triggered; doing nothing earns 0; the first accepted alternative passes. Reference traces cover both twins, a correct total with a wrong target, two false alarms, and a provider correction that also demands the $12. | 1–2 |
| Agent rollouts and analysis | Run five fresh unhinted full runs and one fixed-hint run per designated reference model. Run the paired diagnostic separately. | Publish action traces, precision, recall, amounts and paired attribution per model. Include seeds, model versions, token use, timestamps and wall time. The fixed-hint run must reach 100/100 with no forbidden item triggered. | 2–3 |

- **Milestones, owners and dependencies (required):** Minghao Guo would own the fixtures, verifier and validation. Balance the ledger first, test the paired remittance and both legitimate look-alikes, then freeze and pilot the task. Related environment [Claimline #42](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/42) may supply expense records. A small fixture supports evaluation independently. [Task #43](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/43) captures conference receipts during a trip. This audit starts after the year closes and traces payments across the household and employer.
- **Resources and total effort (required):** Estimated 8–13 person-days over 2–3 weeks. One simulator worker and hosted model APIs. The 18 planned full runs imply approximately 0.45M–0.99M visible tokens before diagnostics, retries or hidden reasoning. Price the batch from pilot usage and freeze configurations for validation.
- **Scope boundary and open questions (required):** One checking account, one card, one employer and one provider. Pilot whether the remittance can be found through natural search without exposing hidden matching keys. Follow the repository's [validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation). Difficulty and feasibility require rollouts.
- **Data provenance and privacy (required):** The household, transactions, service agreement, payslips and correspondence are synthetic. Use fictional IDs and recipients throughout.
