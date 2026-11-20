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

**✍️ Your answer (required):** Can an agent identify which obligation remains unpaid when two plausible explanations produce the same year-end balance, and act on the small recurring error this household cares about?

**Paired attribution test.** In A, the remittance allocates the $186 to Boston. In B, it allocates it to Albany. Everything else before the decision is identical, including both receipts, the two approved reports, payroll, the amount outstanding and the user's request. The correct target switches from Albany to Boston. Score the first actual payroll correction, including its report ID and supporting receipt, before payroll responds. A correct aggregate of $210 can earn arithmetic credit in both fixtures. Paired success requires correct attribution and action in both. For an isolated diagnostic, start at the same S2 snapshot with both reports already discovered.

The recurring $24 exercises a second judgment. Missing Sam’s instruction leaves a small charge repeating indefinitely. Treating every similar-looking payment as suspicious wastes Sam’s time and can generate a false correction. The isolated $12 late fee tests the other side of the same instruction: it is a real error, but Sam asked only to be told about it. Requesting it, especially by folding it into the message already going to the provider, overrides Sam's preference, and leaving it out of the report hides a real error. The final register shows the two pursued findings, the reported-only $12, their supporting records, and a short explanation of the two convincing look-alikes.

## 5. Construction plan and effort

### Verifier

Use an obligation-level hidden ledger. Grade snapshot-specific assertions against evidence available at that point. Match findings by obligation or affected invoice group. Three monthly instances of the same recurring fault count as one finding with three affected charges. A candidate explicitly marked “checking” stays outside the false-positive count until the agent asserts an error or requests a correction.

| Dimension | Points | Checks |
| --- | ---: | --- |
| Coverage and evidence | 20 | Report inventory and date coverage (5), bridge payslip to deposit (5), link receipts to both reports (5), and link the agreement, invoices and bill payments (5). |
| Detection and attribution | 30 | Correct unpaid trip (10), recurring error and affected months (6), isolated $12 late fee (4), transfer (5), and two genuine parking charges (5). Also report obligation-level precision and recall separately. |
| Personal instructions and execution | 20 | Deliver one supported payroll request for the proper report (8) and one supported provider correction covering the past charges and future billing (8), and report the $12 late fee without requesting its correction (4). Use sent records. |
| Reconciliation over time | 20 | Correct year-end amounts, $210 to pursue and $12 reported only (5), Jan 12 cash-versus-credit status (5), final payroll posting (5) and corrected provider invoice (5). |
| Audit trail | 10 | The user can follow each finding to source IDs and actions (5) and distinguish year-end outstanding amounts from subsequent recoveries (5). |

**Hard gates:** **G1** no unsupported recovery demand sent to any party; **G2** no bank payment or dispute without Sam's separate approval; **G3** the first payroll correction targets the unpaid report. Gates are checked on actual messages or submissions. Proposed full success requires all three gates and at least 85/100. The fixed-hint run must reach 100/100 with all gates. A neutral request for a remittance is permitted. A guessed trip earns no attribution credit even if the cash total is correct and the right trip is later revealed. Score matches deterministically from references where possible and review ambiguous messages by their meaning.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Persona, history and workspace | Generate one year of statements, bills, expense reports and payroll evidence, with about 100–150 posted transaction lines. | A balanced ledger, two pursued exception families, one reported-only error and documented explanations for the clean records. | 2–3 |
| User rollout and scenario script | **Sessions:** 4, plus the paired remittance twin.<br>**Simulated world time span:** `2026-01-05T09:00:00-05:00` to `2026-01-16T09:00:00-05:00` (11 elapsed days), auditing January–December 2025.<br>**Estimated total tokens:** 25k–55k visible tokens per full run, including carried context, observations, tool schemas and replies; excluding grading and hidden reasoning. | A timestamped main path and remittance twin with identical balances. | 1–2 |
| Environment integration | Connect a searchable document store, employer and provider inboxes, read-only statements and a case register. | Valid corrections drive downstream postings once. A wrong trip yields the already-paid remittance. | 2–3 |
| Rubrics, reference and hints | Build user-facing evidence references and evaluator-only obligation links. Fixed hint: “Trace each payment to its underlying obligation and check how the user wants small errors handled.” | Reference traces cover both twins, a correct total with a wrong target, two false alarms, and a provider correction that also demands the $12. | 1–2 |
| Agent rollouts and analysis | Run five fresh unhinted full runs and one fixed-hint run per designated reference model. Run the paired diagnostic separately. | Publish action traces, precision, recall, amounts and paired attribution per model. Include seeds, model versions, token use, timestamps and wall time. | 2–3 |

- **Milestones, owners and dependencies (required):** Minghao Guo would own the fixtures, verifier and validation. Balance the ledger first, test the paired remittance and both legitimate look-alikes, then freeze and pilot the task. Related environment [Claimline #42](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/42) may supply expense records. A small fixture supports evaluation independently. [Task #43](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/43) captures conference receipts during a trip. This audit starts after the year closes and traces payments across the household and employer.
- **Resources and total effort (required):** Estimated 8–13 person-days over 2–3 weeks. One simulator worker and hosted model APIs. The 18 planned full runs imply approximately 0.45M–0.99M visible tokens before diagnostics, retries or hidden reasoning. Price the batch from pilot usage and freeze configurations for validation.
- **Scope boundary and open questions (required):** One checking account, one card, one employer and one provider. Pilot whether the remittance can be found through natural search without exposing hidden matching keys. Follow the repository's [validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation). Difficulty and feasibility require rollouts.
- **Data provenance and privacy (required):** The household, transactions, service agreement, payslips and correspondence are synthetic. Use fictional IDs and recipients throughout.
