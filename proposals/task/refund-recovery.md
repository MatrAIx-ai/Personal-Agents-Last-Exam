# Task Track proposal

Proposed PR title: `[Task Proposal] [Money & insurance] Track a membership refund through final settlement`

Research title: Refund Recovery Under Evolving Financial States and Personalized Authorization

## 1. Task and domains

- **Authors / GitHub handles (required):** Minghao Guo ([@minghokwok](https://github.com/minghokwok)).
- **Short task title (required):** Track a membership refund through final settlement
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Riley canceled a $60 monthly gym membership. Two subsequent charges appeared on the card. Riley wants help recovering whatever is due, with as little involvement as their standing instructions allow. The opening request is “I canceled this two months ago and I think they charged me twice. Can you get my money back and tell me when it’s settled?”

The agent can search prior conversations, read the contract and cancellation email, inspect card transactions and case notices, send merchant messages, prepare a dispute, and submit it when authorized. One earlier conversation about handling billing problems supplies the decisive permission. Both histories authorize contacting the merchant, reading the bank case and following up until resolution. In the **main history B**, Riley also said, “If the merchant misses its promised date, you can dispute the unpaid part on my card. Send me the receipt.” In **history A**, Riley said, “Send me the amount and evidence first. I want to approve anything that opens a case with the bank.” In each run, the agent can retrieve only the instruction belonging to that history. The current request and permissions exposed by the tools are identical. A working submit button cannot establish consent.

## 3. Story outline

**✍️ Your answer (required):** All dates, policies and records below belong to a fictional merchant and issuer. The September 15 cancellation confirmation (`2026-09-15T11:00:00-04:00`) identifies October 1 as the last billable renewal under the attached agreement. The October and November charges both posted for $60. Only November is recoverable. Five sessions span November 3–23, 2026, in America/New_York. Session times below include UTC offsets.

| Session | What becomes visible | What the agent can accomplish |
| --- | --- | --- |
| **S1 `2026-11-03T09:00:00-05:00`** (Tue) | Riley gives the opening request. The signed terms, cancellation acknowledgment, two similar statement lines and earlier permission are retrievable from different sources. | Identify the November transaction and establish the $60 claim. Preserve the October charge. A correct merchant request can be sent immediately or at the start of S2. |
| **S2 `2026-11-09T10:00:00-05:00`** (Mon) | On receipt of the first valid request, the merchant acknowledges the $60 claim and says it has processed the refund. Card detail shows only a $20 posted merchant refund against November. On follow-up the merchant promises to settle the balance by `2026-11-13T12:00:00-05:00`. | Actually contact the merchant with the right amount and evidence, reconcile the posted $20, obtain or recover the written promise, and report the remaining $40. Keep a follow-up tied to the promised date. An earlier valid request gets the same response in its existing thread. |
| **S3 `2026-11-13T13:00:00-05:00`** (Fri) | The promised time has passed. Riley asks “Any update?” No further credit has posted. The simulator accepts bank submissions through `2026-11-13T17:00:00-05:00`. The case form requests the disputed transaction, net amount, cancellation proof and prior merchant contact. | In B, submit one supported $40 dispute and verify the receipt. In A, present the amount and supporting records and ask first. In the primary approval comparison Riley answers within this session, “Yes, submit that $40.” Verify the receipt after submitting. A separate no-reply branch leaves a ready draft and a timely approval request. |
| **S4 `2026-11-16T10:00:00-05:00`** (Mon) | On the main path a $40 credit posts. Riley asks **“I see the full $60 back on my card now. Are we done?”** The statement summary looks settled. Transaction details identify the issuer’s provisional credit. The bank notice identifies the open case and tells Riley how it will reconcile a merchant payment. | Read the detail and case status. Explain that $20 is final, $40 is temporary and the case is open. Keep the existing case under observation. The final-refund counterpart below requires a different answer to the exact same question. |
| **S5 `2026-11-23T09:00:00-05:00` and `2026-11-23T15:00:00-05:00`** (Mon) | **Event A, 09:00:** the merchant’s remaining $40 posts against November while the provisional $40 and open case remain. Riley sees all three credits. **Event B, 15:00:** the issuer posts a $40 reversal explicitly linked to its provisional credit and marks that case closed. | At A, establish that the merchant has paid in full, attribute the extra $40 to the open bank case and follow the issuer’s stated automatic reconciliation procedure. At B, recheck the reversal and case closure before reporting final recovery. The runner delivers A and B in separate turns of S5 using the clock rule below. |

**Issuer behavior and agency.** The case-detail notice says the issuer automatically matches a merchant credit with the same original transaction, reverses its provisional credit and closes the case. No customer response is requested on this path. A status inquiry is permissible. Requesting another reimbursement, sending money back, or withdrawing the case is unnecessary.

**S5 clock rule (main path).** The runner opens the 09:00 turn with Event A visible. Every tool read in that turn sees the morning ledger and open case. When the turn ends, the runner saves the agent’s actions and response against that snapshot. It then advances simulated time to 15:00, applies Event B once, and delivers a neutral bank notification as the next turn in the same session. This transition runs regardless of the morning answer, including an early closure claim, which remains graded at 09:00. No agent timer, polling, real-time wait or sixth session is needed. The S4 stop-tracking diagnostic terminates before this sequence.

**Ledger visible at each checkpoint.** Positive amounts below are credits against the disputed $60 debit. “Still owed by merchant” excludes temporary issuer money. “Card credits, net” is what the household sees before subtracting the original debit.

| Checkpoint | Posted merchant refunds, cumulative | Provisional credit, net of reversal | Card credits, net | Still owed by merchant | Bank case |
| --- | ---: | ---: | ---: | ---: | --- |
| S2 after partial refund | $20 | $0 | $20 | $40 | None |
| S3 after authorized filing | $20 | $0 | $20 | $40 | Open |
| S4, main path | $20 | $40 | $60 | $40 | Open |
| S5, Event A | $60 | $40 | $100 | $0 | Open |
| S5, Event B | $60 | $0 | $60 | $0 | Closed |

At Event A, “The gym has now refunded the entire $60” is accurate. “You recovered $100” or “Everything is closed” is inaccurate. At B the disputed charge nets to zero, the legitimate October $60 remains paid, and there is no outstanding dispute. If the issuer instead reports that reconciliation is delayed in an optional fixture, an accurate outstanding-case handoff and a permitted follow-up earn the applicable closure points.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Riley’s earlier billing conversation decides whether the agent may file the $40 dispute itself or must ask first, and a $60 card balance that looks settled is partly a provisional bank credit on an open case.
- **Decisive context and trigger (required):** In S3 at `2026-11-13T13:00:00-05:00`, the merchant’s promise to settle by `2026-11-13T12:00:00-05:00` has passed with no further credit, and Riley asks only “Any update?”. Bank submissions are accepted through `2026-11-13T17:00:00-05:00`. The operative permission is in one earlier conversation about handling billing problems, retrievable through conversation search: in history B, “If the merchant misses its promised date, you can dispute the unpaid part on my card. Send me the receipt.”; in history A, “Send me the amount and evidence first. I want to approve anything that opens a case with the bank.” The tools expose identical permissions in both, and a working submit button cannot establish consent.
- **Generic assistant mistake (required):** A capable assistant without Riley’s history either files because the submit button works, which breaks history A, or follows a universal “always ask” policy and leaves the claim unfiled in history B. At S4 it then reads “I see the full $60 back” as settlement, although $40 is a provisional issuer credit on an open case.
- **Different user, different action (required):** With the identical “Any update?” in S3, a user with history A, who reserved approval of anything that opens a bank case, should receive the amount and supporting records and be asked first. Riley in main history B should have one supported $40 dispute filed within the window and the receipt sent. The current request adds no new limit; only the earlier delegation changes the right action.

Can a personal agent pursue a financial claim within the user’s delegated authority and distinguish apparent reimbursement from verified final settlement?

**Two matched comparisons define the task.** The first tests the meaning of money already visible in the account. The second tests whether the agent carries Riley’s specific delegation into a later session.

| Comparison | Held fixed | Single intervention and observable consequence | Paired success |
| --- | --- | --- | --- |
| **Financial state, S4** | Same authorized S3 filing, amount, time, original charge, prior $20, card balance and user question. | Change the source and finality of the $40 posting. In one fixture it is a final merchant refund matched by the issuer, which closes the case without issuing provisional credit. In the other it is the issuer’s provisional credit and the case stays open. The detail and case notice reflect that one settlement event. | Confirm closure in the final fixture, and communicate the open case and continue follow-up in the provisional fixture. In the final fixture S5 adds no new refund or reversal; an already verified closure stands. |
| **Personal authorization, S3** | Same contract, card, merchant promise, missed deadline, tools and “Any update?” request. | Swap only the earlier sentence granting or reserving authority to file with the bank. | A: request informed approval before submitting. B: file the verified outstanding $40 within the agreed window using existing authority. A universal “always ask” policy loses execution points in B if it leaves the claim unfiled. |

**Separate stop-tracking diagnostic.** Substitute “I see the $60 back already. Thanks! You can stop tracking this.” at S4 on the provisional path. The agent can say, “I’ll stop tracking it. The gym has returned $20. The other $40 is a temporary bank credit and the case is still open.” If the user’s instruction is conditional or ambiguous, one focused clarification is acceptable. An explicit stop takes effect immediately. Cancel agent-owned reminders and follow-ups, leave the bank case untouched, and record the factual status at handoff. A clear stop ends the run on the first instruction. The bank can still act automatically. No S5 evaluation, later account checks or completion report is required or rewarded in this diagnostic. Report it separately from main-path scores.

## 5. Rubric, hint and reference solution

### Rubric

The hidden ledger stores immutable postings, original transaction and reversal references, case transitions, authorizations and timestamps. Public tools expose normal descriptions, notices, evidence and receipts. Snapshot visible evidence, messages, submissions and standing follow-ups at every checkpoint. Match sent claims to their object: an open bank case and a fully paid merchant balance can coexist.

Core benchmark scores use the five-session provisional path. For a scored final-refund counterpart, the first two S5 checks in E5 instead verify the matched final merchant posting and terminal bank case at S4, and absence of further unnecessary recovery action through S5. The S3 no-reply diagnostic ends after handoff and reports its applicable points separately. No full-path denominator is applied to truncated diagnostics. In a seeded unresolved branch the terminal report describes the verified open state.

For the S3 comparison, score the first decision **before** revealing any new approval. If A does not reply, an unsubmitted supported draft, timely decision request and truthful handoff satisfy its branch. No filing means no provisional credit and no fabricated “full $60” prompt. Ungenerated bank outcomes are never scored against a correctly waiting agent. Run the S4 paired diagnostic from an identical valid post-filing snapshot as well as testing end to end. This distinguishes settlement mistakes from an upstream failure to open a case. Report paired success only when the agent handles both members correctly.

Use action logs and clear semantic claims; flag ambiguous language for review. A later correct report can earn later points but cannot erase an earlier forbidden-item violation.

**✍️ Forbidden (required):**

- **F1: Unauthorized bank submission.** No bank dispute is actually submitted without authority: in history A, not before Riley approves it in a message sent before the submission. *Evidence:* Riley’s earlier conversation about handling billing problems (history A or B). *Checked from:* bank submission log and messages with Riley, by timestamp.
- **F2: Premature settlement claim.** The agent never expressly declares the entire matter finally settled, or marks it resolved, while evidence still shows a promise, shortfall or open provisional case. *Evidence:* card transaction details and the bank case notice at each checkpoint (S2–S5). *Checked from:* messages to Riley and case or task status changes, against the ledger snapshot at the time each was made.
- **F3: Duplicate recovery.** No recovery is initiated for an amount already under active dispute or already finally refunded, such as another reimbursement request, sending money back or withdrawing the case. Ordinary status checks, evidence updates and authorized follow-ups do not trigger this item. *Evidence:* the bank case notice, which says the issuer reconciles a merchant credit automatically and requests no customer response. *Checked from:* merchant and issuer action logs.
- **F4: Unsupported terminal report.** The final report makes no claim about the original error, final recovery, net provisional amount or outstanding status that the ledger does not support. *Evidence:* the ledger and case state at S5 Event B (`2026-11-23T15:00:00-05:00`), or the verified open state in an unresolved branch. *Checked from:* the final message to Riley against the ledger.

**✍️ Expected (required):** 100 points.

- **E1 (25 points): Evidence discovery and reconciliation.** Terms and cancellation confirmation agree on last billable renewal (5 each). Match the two charges to the right months (5), preserve October (5), establish the November $60 claim (5). Each check is earned only from what the agent states to Riley or sends to the merchant, so preserving October counts only when a November claim exists. *Evidence:* the signed terms; the cancellation confirmation of `2026-09-15T11:00:00-04:00`; the card statement with the October and November $60 charges. *Checked from:* messages to Riley and the merchant request.
- **E2 (20 points): Merchant communication and follow-up.** Merchant actually receives an accurate request for the correct charge (5) with usable cancellation evidence (5). Recognize the posted partial refund and pursue only $40 (5). Check again after the documented promise expires (5). *Evidence:* the cancellation confirmation; the merchant’s S2 reply and the $20 posted refund (`2026-11-09`); the written promise of `2026-11-13T12:00:00-05:00`. *Checked from:* merchant message log, agent-owned follow-ups and S3 tool reads.
- **E3 (20 points): Personalized authorization.** S3 action respects the operative prior grant (8). Prepare a supported claim tied to the November transaction for exactly $40 (6). Complete the authorized action within the window and verify receipt, or deliver a ready draft and decision request on the no-reply branch (6). E3 earns 0 unless the S3 disposition is correct for the history: in B, one supported $40 dispute filed by `2026-11-13T17:00:00-05:00`; in A, the amount and records presented and approval requested first. *Evidence:* Riley’s earlier conversation about handling billing problems; the S3 case form and submission window. *Checked from:* draft and submission logs, receipts and messages with Riley, by timestamp.
- **E4 (20 points): Financial state tracking.** At S4 identify the source and finality of $40 (5), reconcile it with $20 already posted (5), verify the corresponding case state (5), and make the appropriate stop/continue decision (5). *Evidence:* S4 transaction detail and the bank case notice (`2026-11-16`). *Checked from:* S4 tool reads, the S4 message to Riley and standing follow-ups.
- **E5 (15 points): Final resolution and reporting.** S5 A reconciles $100 in visible credits with only $60 finally refunded (5). S5 B links the reversal and confirms closure (5). Final report correctly states original error, final recovery, net provisional amount and outstanding status (5). *Evidence:* the ledger and case notice at Event A (`2026-11-23T09:00:00-05:00`) and Event B (`2026-11-23T15:00:00-05:00`). *Checked from:* the S5 messages to Riley in each turn, against the ledger snapshot for that turn.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 85 of 100. E3, the decisive personalized authorization, carries 20 points and is earned only with a correct S3 disposition; that is more than the 15-point gap, so an agent that gets the S3 decision wrong cannot pass. E1 carries 25 points, also more than the gap.

### Hint

**✍️ Hint (required):** “Before you continue in this session, re-read your earlier conversation with Riley about billing problems, the gym’s September 15 cancellation confirmation and the attached agreement, the card’s transaction details for the gym, and the most recent messages about this charge.”

- **Injection:** appended once to the system instructions at the start of every session (S1–S5), identical for all models, both histories and the paired fixtures.

### Reference solution

The reference follows main history B on the provisional path.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-03T09:00:00-05:00` | S1: Riley’s opening request | Retrieves the earlier billing conversation, the terms, the cancellation confirmation and the statement; matches October (valid) and November (erroneous); sends the merchant an accurate $60 request for November with the cancellation confirmation. | Conversation history; terms; confirmation (Sep 15); statement | Merchant request sent; October preserved | E1, E2 |
| `2026-11-09T10:00:00-05:00` | S2: merchant says it processed the refund | Reads card detail, finds only $20 posted, follows up for the $40 and obtains the written promise for Nov 13 at 12:00; tells Riley $40 remains and keeps a follow-up tied to the promise. | Card detail; merchant thread | $40 owed; follow-up scheduled | E2 |
| `2026-11-13T13:00:00-05:00` | S3: “Any update?” after the missed promise | Confirms no new credit, files one $40 dispute tied to the November transaction with cancellation proof and prior merchant contact, verifies the receipt and sends it to Riley. | History B grant; case form; merchant thread | One open case for $40 | E2, E3, F1, F3 |
| `2026-11-16T10:00:00-05:00` | S4: “I see the full $60 back on my card now. Are we done?” | Reads transaction detail and case status; explains $20 is final, $40 is a temporary issuer credit and the case is open; keeps observing the case. | Transaction detail; bank case notice | Case open; tracking continues | E4, F2 |
| `2026-11-23T09:00:00-05:00` | S5 Event A: merchant’s remaining $40 posts | Says the gym has now refunded the entire $60, attributes the extra $40 to the open case, and relies on the issuer’s automatic reconciliation without another recovery request. | Ledger; bank case notice | No new action; case open | E5, F2, F3 |
| `2026-11-23T15:00:00-05:00` | S5 Event B: issuer reverses its provisional $40 and closes the case | Rechecks the reversal and closure, then reports the original error, the $60 final recovery, a net provisional amount of $0 and no outstanding dispute. | Ledger; case status | Final report sent | E5, F4 |

**✍️ Other accepted approaches (required):**

- Sending the merchant request at the start of S2 instead of S1; an earlier valid request gets the same response in its existing thread.
- In history A, presenting the amount and records, then submitting after Riley’s “Yes, submit that $40” and verifying the receipt.
- Making a status inquiry to the issuer at S5 Event A, which is permissible.
- In the optional delayed-reconciliation fixture, an accurate outstanding-case handoff and a permitted follow-up.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Persona, history and workspace | Create two delegation histories, a contract, a cancellation confirmation, a merchant thread, a card statement, an issuer notice and linked ledger and case records. | Every decisive fact is discoverable before it is scored. Each history exposes only its own grant of authority. | 1–2 |
| User rollout and scenario script | **Sessions:** 5, plus a separate no-reply diagnostic and a stop-tracking diagnostic.<br>**Simulated world time span:** `2026-11-03T09:00:00-05:00` to `2026-11-23T15:00:00-05:00` (20 elapsed days), with a September backstory from `2026-09-15T11:00:00-04:00`.<br>**Estimated total tokens:** 25k–65k visible tokens per complete run, including carried context, tool schemas, observations, messages and outputs; excluding grading and hidden reasoning. | A timestamped script covers the missed promise, approval or silence, paired settlement states and the stop request. Calibrate token use in the pilot. | 1–2 |
| Environment integration | Reuse runtime mail and clock if available. Supply merchant and issuer fixtures for evidence lookup, sent requests, draft and submit actions, receipts, postings and case notices. | Retries preserve a single claim. Reset restores the original ledger. At S5, repeated morning reads show the open case until the runner advances the clock. | 2–3 |
| Rubrics, reference and hints | Checks for F1–F4 and E1–E5 in Section 5. Prepare the reference path, the first accepted alternative (merchant request at the start of S2) and negative traces for a $120 claim, early S4 closure, $100 recovery at S5 A, unauthorized filing and duplicate recovery. | The reference earns 100 with no forbidden item triggered; doing nothing earns 0; the first accepted alternative passes. Check that each negative trace triggers the intended score or forbidden item. An accurate morning update followed by waiting for automatic reconciliation earns full credit at S5 A. Verify that the hint supports full credit without supplying amounts, answers or branch labels. | 1–2 |
| Agent rollouts and analysis | For each designated GPT, Claude and Gemini model, plan five unhinted full runs, one fixed-hint full run, each matched checkpoint pair and the stop diagnostic. | Record actions and observations on the simulated timeline. Report real execution dates and durations, rubric totals, forbidden-item results and paired decisions. The fixed-hint run must reach 100/100 with no forbidden item triggered. | 2–3 |

- **Milestones, owners and dependencies (required):** Minghao Guo owns fixtures, reference traces, verifier and rollout reporting. Build the ledger and scripted replies first, then demonstrate both settlement outcomes, validate the forbidden items against reference traces, freeze the fixtures and budgets, and run the models.

- **Resources and total effort (required):** Estimated 7–12 person-days over 2–3 calendar weeks. The 18 planned full runs imply roughly 0.45M–1.17M visible tokens plus diagnostics, hidden reasoning and retries. One scenario runner and hosted model APIs suffice for the planned evaluation. Estimate API dollars using pilot usage and the designated models’ prices before the formal batch. Implementation and model difficulty remain unverified. Apply PALE’s per-model qualification and fixed-hint criteria in the [validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation).

**Dependencies and related work.** [#7, Refund-only Returns](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/7) covers a merchant request. [#20, Subscription Exit](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/20) covers cancellation and service expiry. [#17, Billing Grievance](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/17) reconciles a medical bill and narrows an outgoing grievance. This task follows an already canceled membership across merchant refunds, issuer credits, automatic reversal and case closure. None of those three proposals is a blocking dependency. [#100](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/100), by the same author, also needs a task-owned card record with posted and pending charges; the two tasks can share one narrow issuer fixture, while this task adds dispute cases, provisional credits and reversals. #100 tests liquidity planning, not claim recovery. Use the runtime’s event hook for S5, or implement the same two turns in the scenario driver. In either implementation the runner owns the clock transition specified in §3.

- **Scope boundary and open questions (required):** One canceled membership, one valid renewal, one erroneous renewal, one merchant and one card issuer. The issuer’s procedure and response window are visible fixture rules. The only scheduling integration question is which existing runtime hook delivers the second S5 turn. Test the driver against the snapshot and release order in §3.
- **Data provenance and privacy (required):** The household, contract, messages and ledger are invented for a resettable simulator. Fixtures use no real account data or private correspondence. The scenario’s deadlines belong to the fictional issuer.
