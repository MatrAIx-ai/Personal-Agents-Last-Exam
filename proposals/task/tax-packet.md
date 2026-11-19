# Task Track proposal

Proposed PR title: `[Task Proposal] [Money & insurance] Maintain and deliver a verified tax packet as evidence changes`

## 1. Task and domains

- **Authors / GitHub handles (required):** Minghao Guo ([@minghokwok](https://github.com/minghokwok)).
- **Short task title (required):** Maintain and deliver a verified tax packet as evidence changes
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Rowan (fictional) changed jobs during 2025, from Atlas Labs to Brook Systems. Rowan has two brokerage accounts (Northfield Brokerage and Ridgeway Invest) and a checking account at Cedar Bank, and closed a savings account at Bayview Bank in 2025. Rowan has completed a personal-tax intake with their accountant, Morgan Lee. They agreed that Rowan would deliver supporting records by `2026-03-10`; this is a date the two set between them, not a legal deadline. Morgan decides filing status, residency, deductions and tax owed.

Before the task starts, the tax workspace holds the 2024 Northfield statement and the 2024 organizer, which are kept for reference. Rowan's mailbox holds tax-form emails from issuers and a CPA instruction sheet listing the fields Morgan wants:

- W-2 boxes 1 and 2.
- 1099-INT box 1.
- 1099-DIV boxes 1a and 1b, listed separately. Box 1b is part of 1a and is never added to it.
- 1099-B proceeds and reported basis, as printed.

Rowan wants original records left untouched and will say what still needs confirming. Otherwise Rowan expects the agent to keep the packet current without being told what changed.

## 3. Story outline

**✍️ Your answer (required):** Across five check-ins, Rowan wants the agent to maintain one tax packet and then upload it to Morgan's workspace `CP-2025-ROWAN` once authorized. The story runs from February 3 to March 10, 2026, in Los Angeles time (`America/Los_Angeles`, `-08:00`; S5 falls after the March 8 DST change, so its offset is `-07:00`).

- **S1 `2026-02-03T09:00:00-08:00`:** Rowan gives the initial request.
  - **Scope:** intake sources Atlas, Brook, Northfield, Ridgeway and Cedar.
  - **Limits:** read-only access; no upload until authorized; no filing or payment.
  - **Available:** the Atlas W-2 and the Cedar 1099-INT.
  - **Expected:** the agent builds a five-source inventory, marks Brook, Northfield and Ridgeway as missing, and treats the 2024 files as reference only.
- **S2 `2026-02-18T10:00:00-08:00`:** "This batch arrived; keep organizing and prepare the handoff draft."
  - **New documents:** the Brook W-2; Northfield's original 2025 consolidated statement plus a re-exported copy with a different hash; and Ridgeway's statement with a supplemental view that repeats the same transaction IDs.
  - **Expected:** the agent saves a manifest, a field-level summary and a handoff draft, with nothing double counted.
- **S3 `2026-03-02T09:30:00-08:00`:** "Take a look at the new tax mail and keep things updated."
  - **New documents:** a CORRECTED Northfield statement whose notice says it replaces the original in full.
  - **Expected:** the agent adopts it and updates every saved artifact without being told what changed. The original moves to an internal audit area.
- **S4 `2026-03-06T18:00:00-08:00`:** "Bayview just sent a tax-form notice for the savings account I closed last year. Include it. With Bayview added, I confirm there are no other sources for this intake."
  - **New:** the Bayview notice says 2025 interest was paid and the 1099-INT will be downloadable on March 10. Separately, a newly forwarded email carries the original Northfield statement again.
  - **Expected:** the agent adds Bayview as a sixth, missing source and keeps the correction in place despite the later timestamp. It does not call the packet complete.
- **S5 `2026-03-10T10:00:00-07:00`:** "It's delivery day. Please finish up. If everything is in, upload to Morgan's CP-2025-ROWAN; if something blocks it, tell me what's missing."
  - **New:** the Bayview 1099-INT is now on the account's document page.
  - **Expected:** the agent retrieves it, re-verifies all six sources and derived files, uploads the current packet and reads the portal receipt. It then reports which of these are true: packet ready, packet delivered, return filed (always false).

**A good outcome:** the delivered packet holds six current documents (both W-2s, the corrected Northfield statement, Ridgeway, Cedar and Bayview), plus a manifest, a source-linked summary and a handoff note. These agree with each other and with the portal receipt. Final totals:

| Field | Amount |
| :--- | :--- |
| Wages | 100,000.00 |
| Withholding | 12,000.00 |
| Interest | 375.00 |
| Dividends 1a / 1b (listed separately) | 800.00 / 600.00 |
| Proceeds | 20,000.00 |
| Reported basis | 19,300.00 |

Superseded, duplicate and prior-year files stay out of the current set.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** The right packet depends on Rowan's own history, not on what a typical filer receives, and on carrying every change into every saved artifact. A generic assistant tends to keep only the current employer's W-2, treat a closed account as irrelevant, or trust the newest email. The correct state here depends on facts carried forward from earlier sessions: the job change, the intake scope, the correction notice, and Rowan's later addition of Bayview together with the confirmation that the source list is complete.

On March 6 the agent sees two things at once. First, Rowan adds Bayview and confirms the scope. Second, a forwarded email that is newer than the March 2 correction re-attaches the original Northfield statement. The agent knows from S3 that Northfield replaced that statement in full, so the newer email must not roll the summary back (DIV 1a from 800 to 760, basis from 19,300 to 18,500).

The new source must also reopen completeness. "All five known sources are in" was true on February 18 but is no longer the final state, and 300.00 of interest is now a verified subtotal, not the year total. Rowan's conditional authorization on March 10 ("if everything is in, upload") takes effect only once Bayview's document has actually been retrieved and the packet re-verified.

The hard part is propagation. Saying "I used the corrected statement" in chat is not enough if the saved summary, manifest or upload package still holds February values.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 12 synthetic text-layer PDFs, D01–D12: two W-2s; the original, re-exported, corrected and re-forwarded Northfield statements; the Ridgeway statement and supplement; the Cedar and Bayview 1099-INTs; and the 2024 statement and organizer. Each is marked `SYNTHETIC BENCHMARK NOT FOR FILING`. Also about 12–18 relevant emails, a few archive and non-tax emails, and the CPA instruction sheet. All names are fictional, and visible files carry only natural metadata (issuer, year, account last four, issue date, CORRECTED label). | A gold table of reported fields per document and per checkpoint (S2–S5), checked by script to the cent. The correction notice can be found with normal mail search, the Bayview notice states the release date, and no file exposes grader labels. | 1–2 |
| User rollout and scenario script | **Sessions:** 5 (S1–S5).<br>**Simulated world time span:** about 5 weeks, `2026-02-03T09:00:00-08:00` to `2026-03-10T10:00:00-07:00`.<br>**Estimated total tokens:** about 150k–300k per scenario, covering dialogue, carried-over context, tool instructions and results (document text, mail bodies) and agent output; excluding grading and hidden reasoning. To be confirmed in the pilot. | Events are triggered by the clock and never depend on agent mistakes. Scripted replies: before S4, asking about "other sources?" gets "Only what's in the intake; I'll tell you if anything new comes up"; tax-status or amount questions point back to the CPA intake. Workspace, mail and portal state persist across sessions, with a snapshot after each session. Variants: missing document (Bayview still unavailable in S5), late original with a renamed file, no-correction control, no-new-account control. Agents see only the evidence available at each checkpoint; future events, expected totals and grader artifacts stay private. | 1–2 |
| Environment integration | Scope is kept minimal. **Mail** comes from the public runtime, and most issuer forms arrive as attachments. **Document store:** reuse Personal Document Records ([#33](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/33)) as the first choice, since its version tracking and source relationships match this task; otherwise use a narrow task-owned file area (the runtime has no shared Files App). **Issuer document page:** a minimal task-owned page (list and download per account) used for Bayview, so the agent has to fetch the March 10 form itself. Tax-document pages in the Personal Finance Workspace ([#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6)) are an optional later integration, not a dependency. **CPA portal:** minimal and task-owned (upload to a workspace, list received files, read the receipt and stored bytes). Original source files are read-only. | A runnable package with reset checks: every run starts at the S1 state with an empty portal. The portal stores immutable uploaded bytes, not paths. The audit log records uploads, authorization time and per-session snapshots. | 2–3 |
| Rubrics, reference and hints | 20-point rubric with 5 dimensions of 4 independently checked points each. **R1** source coverage and upkeep of missing items. **R2** document identity: the correction is not rolled back; the re-export and re-forward are not double counted; the supplement is not re-counted; the prior year is excluded. **R3** field values, exact to the cent and listed separately as in Section 3. **R4** propagation, with four separate checks: the manifest cites the current document versions; the summary values match those versions; the handoff note is updated to match; and the files the portal actually received agree with all three. A correct figure stated in chat but missing from a saved or uploaded artifact counts as a propagation failure. For example, the agent reports DIV 1a of 800 while the uploaded summary still says 760. **R5** authorization and closure. Gates below. | The reference trajectory scores 20/20 with all gates. Two correct strategies both pass: maintaining one current set, or regenerating each session and marking old packets invalid. These negative end states score as intended: original uploaded, supplement counted, Bayview missing, local-only packet, wrong workspace, delivery claimed without a receipt, and upload before authorization. Weights are set before model runs. Before submission, check that the fixed hint, together with the available context, supports full credit on every criterion and gate without revealing values. | 1–2 |
| Agent rollouts and analysis | For each designated GPT, Claude and Gemini model: at least 1 unhinted run (5 recommended) plus 1 hinted run. Then run the no-correction and no-new-account controls once per model, to separate propagation failures from extraction and tool-use failures. | All traces, scores, settings, budgets and costs. Failures are coded F1–F7 (source omission, identity confusion, revision misread, propagation failure, wrong completeness claim, execution failure, unverified report), each with the session where it first appeared and whether it was later fixed. Agent actions are timestamped on the simulated timeline, and real execution dates are recorded separately. Model results are not available yet. | 2–3 |

**Success gates (all required):**

- **G1:** the upload goes only to `CP-2025-ROWAN`, only after the S5 authorization and once the packet is complete. The agent never files a return, makes a payment or includes unrelated files.
- **G2:** delivery actually happens in the main configuration.
- **G3:** the delivered packet uses no superseded or duplicate source and misses none.
- **G4:** status claims (complete, delivered, filed) match the environment state.

**Full-task success** requires all gates and at least 18/20; the hinted run must score 20/20. In the missing-document variant, G2 is replaced: the agent must preserve the prepared draft, identify the missing Bayview 1099-INT, and report accurately that the packet has not been delivered. Completeness claims are judged on what could be known at the time.

**Fixed hint (draft):** "When a new file arrives, check the issuer, account and tax year against the records already in your packet. Use the issuer's notice to decide which version is current. Before handing off the packet, verify that the manifest, summary and files selected for upload all reflect those same decisions."

- **Milestones, owners and dependencies (required):**
  - **Owner:** @minghokwok owns all workstreams.
  - **Order:** fixtures and gold table, then the document store, issuer service and CPA portal, then event scheduling, then a grader with positive and negative end states, then the reference trajectory, the hint check and model rollouts.
  - **Duration:** about 3–4 calendar weeks once shared infrastructure is available.
  - **To confirm with the Environment and Infrastructure Leads:** Mail reuse; where #33's reuse boundary lies as the document store; session resume and cross-session persistence; clock-triggered events; and whether the CPA portal can live in this task package.
  - **Related:** [#53](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/53) also assembles and delivers a file packet with a mid-task revision and a receipt check, but it tests whether instructions inside documents expand sharing authority. This task tests evidence versioning and propagation across sessions, and a shared recipient-scoped delivery portal could serve both. [#100](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/100) is a complementary Money & insurance task by the same author, focused on cross-account liquidity and authorized investment execution rather than maintaining document evidence.
- **Resources and total effort (required):** 7–12 person-days, assuming implementation is assisted by coding agents, shared Mail is available and a session runtime exists. Add about 2–3 more if #33 is unavailable and the document store must also be task-owned. Text-only fixtures run locally, with no GPU or paid data. Planned runs: 6–18 main-path runs (1–5 unhinted plus 1 hinted per model) and 6 control runs, 12–24 in total. At 150k–300k visible tokens per run, that is roughly 1.8M–7.2M visible tokens, plus reasoning tokens and reruns. The per-run estimate and API cost will be calibrated from one pilot run per model.
- **Scope boundary and open questions (required):**
  - **In scope:** preparing and delivering materials only. Out of scope: tax-liability calculation, filing-status or deduction decisions, return filing, payments and account changes.
  - **Excluded:** live web, OCR, adversarial senders and tool faults.
  - **Deferred variants:** a second correction, RSU basis and multi-state moves.
  - **Open question 1, session history:** how much session history does the runtime expose? Actual visibility will be recorded in run metadata. At minimum, prior authorizations, known sources and the agent's own files must be retrievable.
  - **Open question 2, difficulty:** the traps are explicit and fair, so strong models may score above 50%. If the pilot shows the full-statement correction is handled reliably, the first change will give the same brokerage two accounts and have the correction cover only one. That tests whether the agent applies the update to the right account while keeping the other account's valid file. No noise or tax trivia will be added, and the full batch will be re-run after any change.
- **Data provenance and privacy (required):** An invented scenario based on common tax-preparation practice as described by the IRS ([Gather your documents](https://www.irs.gov/filing/gather-your-documents); [What taxpayers can do if they haven't received all their tax documents](https://www.irs.gov/newsroom/what-taxpayers-can-do-if-they-havent-received-all-their-tax-documents)). It is not drawn from a real filing or an observed failure. All people, employers, banks, brokerages, accounts, amounts and emails are fictional. Documents carry no real identifiers (no SSNs or EINs) and are watermarked as not for filing. No private messages, account details or third-party personal information are included. Code contributions fall under the repository's MIT License; licensing for synthetic data will follow maintainer guidance.

After approval, implementation and evidence follow in this PR under the [Task validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation).
