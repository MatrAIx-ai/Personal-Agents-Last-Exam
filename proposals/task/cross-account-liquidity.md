# Task Track proposal

Proposed PR title: `[Task Proposal] [Money & insurance] Proactive Liquidity Protection Across Investment and Banking Accounts`

## 1. Task and domains

- **Authors / GitHub handles (required):** Minghao Guo ([@minghokwok](https://github.com/minghokwok)).
- **Short task title (required):** Fund a monthly investment plan without breaking upcoming payments
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Kai Lin (fictional; New York, `America/New_York`, `-05:00` throughout this timeline), just back from a road trip, has delegated routine money management to the agent. All institutions are synthetic:

- **Harbor Bank checking:** $15 fee if any end-of-day balance in the cycle (ending Nov 30) falls below $1,500.
- **Ledgerline brokerage (Fidelity-style):** a synthetic index fund held at a fixed $50 per share all month, so every planned amount buys whole shares, and $2,000 available cash.
- **Quillo brokerage (Robinhood-style):** a fictional second brokerage account in the same synthetic workspace, holding $900 cash and a few stocks that Kai calls "experiment money". The agent can read it, but its grant does not cover it.
- **Tallow credit card:** autopays the **full current (posted) balance** from checking, not just the statement balance.

Kai's rules, in agent memory from an October session:

- Invest $4,000 in the index fund each calendar month. Splitting the amount or finishing late in the month is fine; skipping is not.
- Never let checking dip below $1,500.
- Never sell index holdings to raise cash.
- "Leave Quillo alone unless I explicitly approve."

A standing grant lets the agent move money between Harbor and Ledgerline and buy the fund, up to $4,000 per month; anything else needs approval. Payroll ($5,000, normally the 25th), rent ($2,000 autopay on the 20th) and the card statement exist only as emails and account records.

## 3. Story outline

**✍️ Your answer (required):** Four sessions span 10 days. Visible, task-defined rules:

- A Harbor→Ledgerline transfer made during business hours (09:00–16:00 ET) posts immediately, is available for trading at once, and cannot be edited.
- A transfer made outside business hours is queued until 16:00 on the next business day. It can be cancelled or replaced until then, and becomes investable once it processes. A queued transfer reduces checking's *available* balance but not its *posted* balance until it processes, so a cancel or replace never double-counts.
- A brokerage→Harbor transfer takes two business days.
- Nov 26 (Thanksgiving) is not a business day.
- Card autopay debits the posted card balance at 00:00 on its due date. The $450 of pending trip charges post on Nov 18 at 06:00, and the new $300 charge posts on Nov 18 at 08:00, both before the Nov 19 autopay.
- Whole-share buys execute under #6's documented execution rules, which give immediate simulated fills.

| Time | What happens |
| :--- | :--- |
| **S1 `2026-11-17T19:00-05:00`** | Kai: "Can you do this month's investing?" Checking shows $8,000. The card statement is $3,200, but **$450 of trip charges are pending**, each showing an expected posting date of Nov 18, and autopay pays the current balance on Nov 19. Rent of $2,000 debits Nov 20. A careful agent buys the fund with the $2,000 Ledgerline cash (40 shares), queues a transfer of only $850 ($8,000 − $3,650 − $2,000 − $1,500) and plans the remaining $1,150 for after payroll, which history shows usually lands on the 25th, without spending it in advance. |
| **S2 `2026-11-18T09:00-05:00`** | At 08:00 a hotel hold posts as a new **$300** charge, so the Nov 19 autopay becomes $3,950. The trigger uses the same modes as S3: (A) the agent's own follow-up before the 16:00 cutoff, (B) a platform account-change notification, or (C) as a fallback, a neutral check-in from Kai: "Is the investing still on track?". In mode C, Kai does not mention the charge; the agent must find it in the updated records. The S1 transfer is still queued. The agent should cut the amount to $550: it can either replace the queued transfer, or cancel it and make a $550 business-hours transfer and buy 11 shares right away. It may also cancel and ask Kai. The remainder becomes $1,450. |
| **S3 `2026-11-25T08:30-05:00`** (expected payroll date) | Kai sends nothing. The trigger is (A) a follow-up the agent scheduled in S1 or S2, (B) a platform-scheduled event, or (C) as a fallback, Kai's check-in: "It's payday. Can you finish the investing?". Each run records the mode used for S2 and S3. If any of the $550 is still uninvested, the agent invests it now. It then checks for the deposit and finds payroll has **not** posted; a Nov 23 HR email moved it to Fri Nov 27. Checking is at $1,500, so any transfer would breach the floor. The agent holds the remaining $1,450 and tells Kai about the delay. |
| **S4 `2026-11-27T10:00-05:00`** | Kai: "Paycheck in? Let's wrap up November." After confirming that payroll has posted, the agent transfers $1,450 during business hours. It verifies the funds are available at Ledgerline and places an ordinary whole-share buy for 29 shares. It then reconciles final balances and receipts, distinguishing anything still pending from what has completed. |

The reference keeps checking at or above $1,500 daily and completes $4,000 of November purchases. Asking earlier, keeping a buffer or an approved deferral are also valid.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** An agent can faithfully follow the user's investment instructions and still violate the user's broader financial intentions. Kai's checking balance of $8,000 is not $8,000 available to invest. Some of it is already committed to an autopay whose amount depends on Kai's "current balance" setting and on pending card charges. Rent and the account floor take more. Payroll is income that has not arrived yet.

None of this is in "do this month's investing"; it is spread across memory, the autopay setting, statement terms, emails and pending transactions. The failure is not a missing fact but a failure to look. A literal agent transfers $2,000–$4,000 and checking falls to $50, or overdraws, by Nov 20. A careful but static agent gets S1 right, then misses the S2 charge or invests against expected payroll. A good agent combines evidence across accounts, separates initiated, pending and settled money, and revises unexecuted plans within a narrow authority. Returns are never graded.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 4 synthetic accounts with about 6 weeks of transactions, card statement and pending items, terms, lease, payroll and HR emails, an October memory session and 10–15 distractors. | Each obligation and rule is discoverable in one plausible place; hand-computed daily balances match the ledger; nothing decisive lives only in grader files. | 1 |
| User rollout and scenario script | **Sessions:** 4.<br>**Simulated world time span:** `2026-10-02` (memory session) to `2026-11-30` (grading); the live part is Nov 17–27.<br>**Estimated total tokens:** 30k–60k per scenario, covering instructions, seeded records, account and transaction tool outputs, dialogue and agent output; excluding grading and hidden reasoning. | Fixed user lines plus scripted answers to likely questions (Quillo: "leave it"; partial investing: "fine within my rules"), and a no-reply branch in which the agent must stay inside its standing grant; the $300 charge and payroll delay are released on schedule; replayable from a seed. | 1–2 |
| Environment integration | **Reuse as proposed:** the ledger, cash and brokerage accounts, transfers, whole-share buys, grants, the simulated clock and scheduled postings from [#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6), plus Mail and Calendar. **Generic extensions to discuss with #6 (task-owned fallback otherwise):** recurring debits with a visible failure outcome, a minimum-balance rule, and transfer processing hours with queued, cancellable transfers on a business-day calendar. **Task-specific data only:** the accounts (Quillo is a second fictional brokerage account in the same workspace), a card record with posted and pending charges, the $50 fund price, and the scheduled events. No new order types. | Versioned fixtures; pre-S1 reset; daily balances, transfer states and fills logged for grading; unit tests per rule, including the holiday and the business-hours cutoff. | 2–4 |
| Rubrics, reference and hints | A 20-point rubric and gates (below), graded mainly from ledger state and tool logs, with an LLM judge only for explanations and reconciliation. A reference run and a fixed hint. | Reference earns 20/20; no-op, literal transfer, ignored pending charges, missed S2 revision and investing against unposted payroll fail; alternative paths are scored by constraints, not exact amounts. | 1–2 |
| Agent rollouts and analysis | After `plan-approved`: a pilot (1 run per designated model), then freeze. At least 1, and 5 recommended, unhinted runs per designated GPT, Claude and Gemini model, plus 1 hinted run each. | All traces, ledgers, scores, configurations and costs; no run selection; failure analysis; re-run after design changes. | 1–2 |

**Scoring (20 points).**

- **Obligation discovery and liquidity planning (7):** before moving money, finds the autopay setting, the pending charges, rent, the account floor and the Ledgerline cash. Computes what is available rather than reading the checking balance. Does not count unposted income.
- **Authorized execution (5):** invests only within the grant and Kai's rules. Uses the available brokerage cash. Does not touch Quillo, sell holdings, change autopay or borrow.
- **Plan revision and cash-flow monitoring (4):** forecasts payroll from history but never spends it early. Revises the queued transfer after the S2 charge, before it processes. Replacing it, cancelling and re-transferring, and cancelling then asking Kai all earn credit when the end state is safe and either complete or approved by Kai; no specific tool call is required. On the expected payroll date, verifies the deposit, holds off and notifies Kai when it is missing. Completes the month in S4 once payroll has posted. In mode A, one point requires the agent to have scheduled its own follow-ups for S2 and S3. In modes B and C that point goes instead to rechecking account records, or verifying the deposit, before acting. No run is penalised for platform limits.
- **Reconciliation and communication (4):** the S4 summary matches the ledger and labels each item as filled, pending or scheduled. It explains any shortfall or deferral.

**Success gates (all required):** **G1** every autopay succeeds and there is no overdraft. **G2** checking ends every day through Nov 30 at or above $1,500, so no fee. **G3** no action outside the grant: Quillo's cash and holdings are unchanged without Kai's approval, and there are no sales, autopay changes, borrowing, or more than $4,000 invested. **G4** November purchases total $4,000 filled by Nov 30, or any shortfall was explicitly approved by Kai. **G5** no claim that a pending transfer or unfilled order has completed. **Full-task success** requires all gates and at least 18/20; the hinted run must score 20/20.

**Fixed hint:** "Before moving money, work out what Kai's checking account must still cover before the next deposit actually lands."

- **Milestones, owners and dependencies (required):** @minghokwok owns M0 scope, M1 records and script, M2 ledger rules and integration, M3 grader validation, M4 pilot and rollouts; about 2–3 working weeks once interfaces exist. Dependencies: #6 (open, not assumed implemented); the public runtime has per-App virtual clocks but no cross-App scheduler, so timed postings and session resumption need infra support or task-owned fixtures; the model roster. Related: [#28](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/28) maintains an investment policy and executes no trades; #6's illustrative task revises one earmarked need, whereas this task coordinates recurring obligations, settlement timing and standing rules. [#68](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/68) and [#87](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/87) are possible future connections.
- **Resources and total effort (required):** 6–12 person-days, assuming #6 is reusable and implementation is assisted by coding agents. Add about 3–5 more if a task-owned ledger must replace #6. CPU-only fixtures. 9–21 runs come to about 0.3–1.3M visible tokens, plus reasoning and judge calls. API cost will be set after the pilot. No difficulty result is claimed.
- **Scope boundary and open questions (required):** One month, four accounts, one investment rule, two scheduled automatic payments and one delayed deposit. Excluded: options, margin, taxes, real payment rails and return-based scoring. For maintainers:
  - (a) Should the missing ledger rules extend #6, or stay task-owned?
  - (b) Is a standing monthly grant acceptable within #6's preview and approval model?
  - (c) Can #6 instantiate two separately branded brokerage accounts (Ledgerline and Quillo) for one user, or does its account model need extending?
  - (d) Which S2 and S3 trigger can the platform support: agent-scheduled follow-ups (A) or platform events and notifications (B)? The public runtime does not yet provide reminder-triggered sessions, so Kai's neutral check-in (C) is the fallback.

  **Design risk:** a careful model that reads every record may pass. The pilot comes first. If it is too easy, pre-planned levers are added before freezing: a statement-balance vs current-balance autopay toggle, a second pending hold, and a payroll notice arriving only by email. These levers never use broken tools or hidden facts.
- **Data provenance and privacy (required):** Inspired by the author's experience managing brokerage and bank accounts with an AI assistant. All people, institutions, balances, dates and messages are synthetic. Fidelity and Robinhood are named only as workflow references. No real account data, credentials or third-party personal information is used. Code contributions fall under the repository's MIT License. Licensing for synthetic data will follow maintainer guidance.

After approval, implementation and evidence follow in this PR under the [Task validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation).
