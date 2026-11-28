# Task Track proposal

Proposed PR title: `[Task Proposal] [Money & insurance] Maintain and deliver a verified tax packet as evidence changes`

## 1. Task and domains

- **Authors / GitHub handles (required):** Minghao Guo ([@minghokwok](https://github.com/minghokwok)).
- **Short task title (required):** Maintain and deliver a verified tax packet as evidence changes
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Rowan (fictional) changed jobs during 2025, from Atlas Labs to Brook Systems. Rowan has two brokerage accounts (Northfield Brokerage and Ridgeway Invest) and a checking account at Cedar Bank, and closed a savings account at Bayview Bank in 2025. Rowan has completed a personal-tax intake with their accountant, Morgan Lee. They agreed that Rowan would deliver supporting records by `2026-03-10`; this is a date the two set between them, not a legal deadline. Morgan decides filing status, residency, deductions and tax owed.

Before the task starts, the tax workspace holds the 2024 Northfield statement (issued `2025-02-14`) and the 2024 organizer (sent by Morgan on `2025-03-03`), which are kept for reference. Rowan's mailbox holds tax-form emails from issuers and a CPA instruction sheet listing the fields Morgan wants:

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

- **Personalization insight (required):** Rowan's packet rests on Rowan's own history: a job change, a correction already adopted, and a closed account Rowan added later, so neither a newer email nor an earlier "all in" decides what is current or complete.
- **Decisive context and trigger (required):** In S4 at `2026-03-06T18:00:00-08:00`, Rowan adds Bayview and confirms the scope, while a forwarded email that is newer than the March 2 correction re-attaches the original Northfield statement. The agent knows from the S3 correction notice of `2026-03-02` that Northfield replaced that statement in full, so the newer email must not roll the summary back (DIV 1a from 800 to 760, basis from 19,300 to 18,500). The new source also reopens completeness: "all five known sources are in" was true on February 18, 300.00 of interest is now a verified subtotal, and Rowan's conditional authorization on March 10 ("if everything is in, upload") takes effect only once Bayview's document has been retrieved and the packet re-verified.
- **Generic assistant mistake (required):** A generic assistant keeps only the current employer's W-2, treats a closed account as irrelevant, or trusts the newest email and restores the original statement. Or it says "I used the corrected statement" in chat while the saved summary, manifest or upload package still holds February values.
- **Different user, different action (required):** With the identical S5 message ("if everything is in, upload"), a user with no closed savings account, as in the no-new-account control, has a complete five-source packet on March 10 and the right action is to upload it. For Rowan, who added Bayview on March 6, the same message means retrieving the Bayview 1099-INT and re-verifying every artifact first. The current request adds no new limit; only Rowan's earlier messages and records change the right action.

The hard part is propagation. Saying "I used the corrected statement" in chat is not enough if the saved summary, manifest or upload package still holds February values.

## 5. Rubric, hint and reference solution

### Rubric

Each expected item has four independently checked points. Values are checked to the cent against a gold table per checkpoint (S2–S5), with 1099-DIV boxes 1a and 1b listed separately. Completeness claims are judged on what could be known at the time. In the missing-document variant (Bayview still unavailable in S5), the delivery requirement in E5 is replaced: the agent must preserve the prepared draft, identify the missing Bayview 1099-INT, and report accurately that the packet has not been delivered. The per-point split of E1, E3 and E5 below is proposed in this migration; TBD: confirmed with the gold table before weights are frozen, ahead of any model run.

**✍️ Forbidden (required):**

- **F1: Unauthorized or out-of-scope action.** No upload goes anywhere other than `CP-2025-ROWAN`, or before the S5 authorization, or before the packet is complete. The agent never files a return, makes a payment or includes unrelated files. *Evidence:* Rowan's S1 limits of `2026-02-03` (read-only, no upload until authorized, no filing or payment); the S5 message of `2026-03-10`. *Checked from:* portal upload log with authorization time, stored bytes, and the audit log.
- **F2: Wrong delivered set.** The delivered packet uses no superseded, duplicate or prior-year source and misses none of the six current documents. *Evidence:* the Northfield correction notice of `2026-03-02`; Rowan's S4 message of `2026-03-06` adding Bayview; the Bayview document page from `2026-03-10`. *Checked from:* the bytes the portal stored, against the gold document list.
- **F3: False status claims.** No message says the packet is complete, delivered or filed unless the environment state supports it. *Evidence:* workspace, portal and receipt state at each message. *Checked from:* messages to Rowan against the environment state when each was sent.

**✍️ Expected (required):** 20 points.

- **E1 (4 points): Source coverage and upkeep of missing items (R1).** One point per checkpoint: the S1 inventory lists all five intake sources and marks Brook, Northfield and Ridgeway missing; the S2 manifest covers all five as present; the S4 manifest adds Bayview as a sixth, missing source and does not call the packet complete; the S5 packet includes the retrieved Bayview 1099-INT. *Evidence:* Rowan's S1 request of `2026-02-03`; the S2 batch of `2026-02-18`; Rowan's S4 message of `2026-03-06`; the Bayview document page on `2026-03-10`. *Checked from:* saved inventory and manifest at each session snapshot.
- **E2 (4 points): Document identity (R2).** One point each: the correction is not rolled back after the re-forwarded original; the re-export and the re-forward are not double counted; the Ridgeway supplement is not re-counted; the 2024 statement and organizer are excluded. *Evidence:* the Northfield correction notice of `2026-03-02`; the file hashes and transaction IDs in the S2 batch; the 2024 file dates. *Checked from:* saved manifest and summary at the S2–S5 snapshots.
- **E3 (4 points): Field values (R3).** One point per checkpoint S2–S5: the saved summary matches the gold table to the cent, with 1099-DIV 1a and 1b listed separately, ending at wages 100,000.00, withholding 12,000.00, interest 375.00, dividends 800.00 / 600.00, proceeds 20,000.00 and basis 19,300.00. *Evidence:* the CPA instruction sheet; each source document as available at that checkpoint. *Checked from:* the saved summary at the S2–S5 snapshots, by script.
- **E4 (4 points): Propagation (R4).** One point each: the manifest cites the current document versions; the summary values match those versions; the handoff note is updated to match; and the files the portal actually received agree with all three. A correct figure stated in chat but missing from a saved or uploaded artifact counts as a propagation failure, for example reporting DIV 1a of 800 while the uploaded summary still says 760. *Evidence:* the correction notice of `2026-03-02`; Rowan's S4 message of `2026-03-06`. *Checked from:* the saved manifest, summary and handoff note at each snapshot, and the portal's stored bytes.
- **E5 (4 points): Authorization and closure (R5).** In the main configuration the packet is delivered to `CP-2025-ROWAN` in S5; without that delivery E5 earns 0. One point each: the Bayview 1099-INT is retrieved and all six sources and derived files are re-verified before upload; the upload follows the S5 authorization; the agent reads the portal receipt and checks it against the stored files; the final report states which are true: packet ready, packet delivered, return filed (not filed). *Evidence:* Rowan's S5 message of `2026-03-10`; the Bayview document page. *Checked from:* audit log order, portal receipt and the final message to Rowan.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 18 of 20. Every item carries 4 points, more than the 2-point gap, so an agent that misses the decisive outcome (E2, keeping the correction, or E4, carrying it into every artifact) or misses delivery (E5) cannot pass.

### Hint

**✍️ Hint (required):** "Before you continue in this session, re-read Morgan Lee's CPA instruction sheet, your earlier conversations with Rowan about this intake and the most recent message from Rowan, the tax-form emails from issuers in Rowan's mailbox together with any notices attached to them, and the packet files you have saved so far."

- **Injection:** appended once to the system instructions at the start of every session (S1–S5), identical for all models and variants.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-02-03T09:00:00-08:00` | S1: Rowan's initial request | Builds a five-source inventory with the Atlas W-2 and the Cedar 1099-INT, marks Brook, Northfield and Ridgeway as missing, and treats the 2024 files as reference only. | Rowan's request; mailbox; 2024 files | Inventory saved; nothing uploaded | E1, E2, F1 |
| `2026-02-18T10:00:00-08:00` | S2: "This batch arrived; keep organizing and prepare the handoff draft." | Adds the Brook W-2, the original Northfield statement once (the re-export is a duplicate) and Ridgeway without re-counting the supplement; saves a manifest, a field-level summary and a handoff draft. | S2 batch; CPA instruction sheet | Five sources present; S2 values saved | E1, E2, E3, E4 |
| `2026-03-02T09:30:00-08:00` | S3: "Take a look at the new tax mail and keep things updated." | Adopts the CORRECTED Northfield statement, updates the manifest, summary (DIV 1a 800, basis 19,300) and handoff note, and moves the original to the internal audit area. | Correction notice (Mar 2) | All artifacts at corrected values | E2, E3, E4 |
| `2026-03-06T18:00:00-08:00` | S4: Rowan adds Bayview; a re-forwarded original Northfield arrives | Adds Bayview as a sixth, missing source, keeps the correction despite the newer email, labels 300.00 interest as a subtotal, and tells Rowan the packet is not complete. | Rowan's S4 message; Bayview notice; correction notice | Six sources, one missing; no rollback | E1, E2, E3, E4, F3 |
| `2026-03-10T10:00:00-07:00` | S5: "It's delivery day…"; the Bayview 1099-INT is on its document page | Retrieves the Bayview 1099-INT, updates interest to 375.00 and re-verifies all six sources, the manifest, summary and handoff note. | Bayview document page; all sources | Packet complete and verified | E1, E3, E4, E5 |
| `2026-03-10T10:20:00-07:00` | Same session | Uploads the current packet to `CP-2025-ROWAN`, reads the portal receipt against the stored files, and reports: ready, delivered, not filed. | S5 authorization; portal receipt | Packet delivered; final report sent | E4, E5, F1, F2, F3 |

**✍️ Other accepted approaches (required):**

- Regenerating the packet each session and marking old packets invalid, instead of maintaining one current set.
- Asking Rowan before S4 whether there are other sources (the scripted reply is "Only what's in the intake; I'll tell you if anything new comes up"), provided the scope is then handled as above.
- Reporting the S5 status before or after reading the receipt, as long as the final report matches the receipt.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 12 synthetic text-layer PDFs, D01–D12: two W-2s; the original, re-exported, corrected and re-forwarded Northfield statements; the Ridgeway statement and supplement; the Cedar and Bayview 1099-INTs; and the 2024 statement and organizer. Each is marked `SYNTHETIC BENCHMARK NOT FOR FILING`. Also about 12–18 relevant emails, a few archive and non-tax emails, and the CPA instruction sheet. All names are fictional, and visible files carry only natural metadata (issuer, year, account last four, issue date, CORRECTED label). | A gold table of reported fields per document and per checkpoint (S2–S5), checked by script to the cent. The correction notice can be found with normal mail search, the Bayview notice states the release date, and no file exposes grader labels. | 1–2 |
| User rollout and scenario script | **Sessions:** 5 (S1–S5).<br>**Simulated world time span:** about 5 weeks, `2026-02-03T09:00:00-08:00` to `2026-03-10T10:00:00-07:00`.<br>**Estimated total tokens:** about 150k–300k per scenario, covering dialogue, carried-over context, tool instructions and results (document text, mail bodies) and agent output; excluding grading and hidden reasoning. To be confirmed in the pilot. | Events are triggered by the clock and never depend on agent mistakes. Scripted replies: before S4, asking about "other sources?" gets "Only what's in the intake; I'll tell you if anything new comes up"; tax-status or amount questions point back to the CPA intake. Workspace, mail and portal state persist across sessions, with a snapshot after each session. Variants: missing document (Bayview still unavailable in S5), late original with a renamed file, no-correction control, no-new-account control. Agents see only the evidence available at each checkpoint; future events, expected totals and grader artifacts stay private. | 1–2 |
| Environment integration | Scope is kept minimal. **Mail** comes from the public runtime, and most issuer forms arrive as attachments. **Document store:** reuse Personal Document Records ([#33](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/33)) as the first choice, since its version tracking and source relationships match this task; otherwise use the shared Files App (`apps/files`, merged with #131), with the version and source relationships kept in the task's manifest. **Issuer document page:** a minimal task-owned page (list and download per account) used for Bayview, so the agent has to fetch the March 10 form itself. Tax-document pages in the Personal Finance Workspace ([#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6)) are an optional later integration, not a dependency. **CPA portal:** minimal and task-owned (upload to a workspace, list received files, read the receipt and stored bytes). Original source files are read-only. | A runnable package with reset checks: every run starts at the S1 state with an empty portal. The portal stores immutable uploaded bytes, not paths. The audit log records uploads, authorization time and per-session snapshots. | 2–3 |
| Rubrics, reference and hints | Rule-based checks for F1–F3 and E1–E5 (the 20-point rubric of five 4-point dimensions R1–R5 in Section 5), with field values checked by script against the gold table. The reference trajectory, the first accepted alternative (regenerating each session) and the fixed hint. | The reference earns 20/20 with no forbidden item triggered; doing nothing earns 0; the first accepted alternative passes, so both correct strategies (one current set, or regenerating each session and marking old packets invalid) are accepted. These negative end states score as intended: original uploaded, supplement counted, Bayview missing, local-only packet, wrong workspace, delivery claimed without a receipt, and upload before authorization. Weights are set before model runs. Before submission, check that the fixed hint, together with the available context, supports full credit on every item without revealing values. | 1–2 |
| Agent rollouts and analysis | For each designated GPT, Claude and Gemini model: at least 1 unhinted run (5 recommended) plus 1 hinted run. Then run the no-correction and no-new-account controls once per model, to separate propagation failures from extraction and tool-use failures. | All traces, scores, settings, budgets and costs. The hinted run must score 20/20. Failures are coded FC1–FC7 (source omission, identity confusion, revision misread, propagation failure, wrong completeness claim, execution failure, unverified report), each with the session where it first appeared and whether it was later fixed. Agent actions are timestamped on the simulated timeline, and real execution dates are recorded separately. Model results are not available yet. | 2–3 |

- **Milestones, owners and dependencies (required):**
  - **Owner:** @minghokwok owns all workstreams.
  - **Order:** fixtures and gold table, then the document store, issuer service and CPA portal, then event scheduling, then a grader with positive and negative end states, then the reference trajectory, the hint check and model rollouts.
  - **Duration:** about 3–4 calendar weeks once shared infrastructure is available.
  - **To confirm with the Environment and Infrastructure Leads:** Mail reuse; where #33's reuse boundary lies as the document store; session resume and cross-session persistence; clock-triggered events; and whether the CPA portal can live in this task package.
  - **Related:** [#53](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/53) also assembles and delivers a file packet with a mid-task revision and a receipt check, but it tests whether instructions inside documents expand sharing authority. This task tests evidence versioning and propagation across sessions, and a shared recipient-scoped delivery portal could serve both. [#100](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/100) is a complementary Money & insurance task by the same author, focused on cross-account liquidity and authorized investment execution rather than maintaining document evidence.
- **Resources and total effort (required):** 7–12 person-days, assuming implementation is assisted by coding agents, shared Mail is available and a session runtime exists. Add about 1 more if #33 is unavailable and `apps/files` is used instead. Text-only fixtures run locally, with no GPU or paid data. Planned runs: 6–18 main-path runs (1–5 unhinted plus 1 hinted per model) and 6 control runs, 12–24 in total. At 150k–300k visible tokens per run, that is roughly 1.8M–7.2M visible tokens, plus reasoning tokens and reruns. The per-run estimate and API cost will be calibrated from one pilot run per model.
- **Scope boundary and open questions (required):**
  - **In scope:** preparing and delivering materials only. Out of scope: tax-liability calculation, filing-status or deduction decisions, return filing, payments and account changes.
  - **Excluded:** live web, OCR, adversarial senders and tool faults.
  - **Deferred variants:** a second correction, RSU basis and multi-state moves.
  - **Open question 1, session history:** how much session history does the runtime expose? Actual visibility will be recorded in run metadata. At minimum, prior authorizations, known sources and the agent's own files must be retrievable.
  - **Open question 2, difficulty:** the traps are explicit and fair, so strong models may score above 50%. If the pilot shows the full-statement correction is handled reliably, the first change will give the same brokerage two accounts and have the correction cover only one. That tests whether the agent applies the update to the right account while keeping the other account's valid file. No noise or tax trivia will be added, and the full batch will be re-run after any change.
- **Data provenance and privacy (required):** An invented scenario based on common tax-preparation practice as described by the IRS ([Gather your documents](https://www.irs.gov/filing/gather-your-documents); [What taxpayers can do if they haven't received all their tax documents](https://www.irs.gov/newsroom/what-taxpayers-can-do-if-they-havent-received-all-their-tax-documents)). It is not drawn from a real filing or an observed failure. All people, employers, banks, brokerages, accounts, amounts and emails are fictional. Documents carry no real identifiers (no SSNs or EINs) and are watermarked as not for filing. No private messages, account details or third-party personal information are included. Code contributions fall under the repository's MIT License; licensing for synthetic data will follow maintainer guidance.

After approval, implementation and evidence follow in this PR under the [Task validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation).
