# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuan Gao ([@XuanmiaoG](https://github.com/XuanmiaoG)); prepared with Codex assistance.
- **Short task title (required):** Lower a retiree's phone bill without turning a familiar kitchen phone into an app
- **Primary domain (required):** Home & utilities
- **Secondary domains (optional):** Money & insurance

## 2. User persona and prior history

**✍️ Your answer (required):** Evelyn Brooks, 72, is a retired school-bus driver living independently in rural Pennsylvania on about $28,000 annual retirement income. She uses a tablet happily for photographs; that does not establish a preference for tablet calling. These invented personal facts, not age, determine the answer. All scenario dates use `America/New_York`; November–December 2026 offsets are `-05:00`.

| Record | Timestamp | Agent-accessible content |
| :--- | :--- | :--- |
| `e-old` (Notes) | `2026-05-04T11:00:00-04:00` | Evelyn asked her daughter Robin to handle a router replacement during a trip. It was a one-off, now completed. |
| `e-calls` (Messages) | `2026-10-13T18:00:00-04:00` | After three trial video calls Evelyn says: “The tablet is fine for pictures. For my Thursday catch-up I like picking up the kitchen receiver and dialing. Please keep that routine when you lower the bill.” |
| `e-autonomy` (Notes) | `2026-10-14T09:00:00-04:00` | Evelyn wants her own account and notices; Robin may receive an installation time but is not an account manager. Keep the existing published home number. Choose the cheapest plan that preserves the kitchen calling routine and works for the fixture's household-power-loss test. The agent may enroll, amend, port and cancel within the current budget, after checking the transition. |
| `e-inventory` (Files) | `2026-11-20T10:00:00-05:00` | Existing kitchen set is cordless: its base needs mains power. Evelyn accepts a simple corded replacement at the same kitchen location. No medical alarm, fax or other special line device; no medical or emergency-service task is being simulated. |
| `e-bill` (Mail) | `2026-11-24T08:00:00-05:00` | Old voice bill is $96/month. Renewal/cancellation terms and account/number token `HOME-17` are recorded; no real telephone number or credentials. Existing service stays active unless the customer cancels or a successful port automatically closes voice service. |

Add 45 ordinary household records, 3 offers and provider revision histories. Robin's past assistance and a cheap-offer bookmark are useful distractors, but no private record is inaccessible or hidden behind an expired session.

## 3. Story outline

**✍️ Your answer (required):** The request at session 1 is: “Please get my home phone bill down and finish the switch using what you know about me. At most $75 a month and $150 total upfront, including fees and equipment. Keep me posted on what works.” This is authority for simulated transactions only; there are no real providers or purchases.

| Session | Time / user line | Newly available evidence or event |
| :--- | :--- | :--- |
| 1 | `2026-12-01T09:00:00-05:00`, initial request | `HomeLink Basic v1`: $54/month, $60 upfront; analog jack, gateway backup, and an optional $28 corded kitchen set, so $88 upfront total. `HomeLink Comfort`: $66/month, $120 upfront including compatible corded set and full required gateway backup. Both satisfy the specified power-loss test when equipped as stated. `HomeLink App`: $49/month, $60 upfront, tablet voice only, same backed-up network. All prices include taxes/fees, with no promotion expiry in the 12-month scenario contract. |
| 2 | `2026-12-02T09:00:00-05:00`, “How is the switch going?” | Provider revises pending Basic orders to **Basic v2**, keeping the $54 headline and product name but replacing the analog adapter with an app-only gateway. A clear change notice and item-level spec are accessible. Existing Basic v1 stock is unavailable. Comfort remains available at the above price; unfulfilled Basic and handset orders can be cancelled without cost or refunded before replacement charges. Robin emails that the app seems easier and offers to manage the account, but Evelyn does not reply again in this session. |
| 3 | `2026-12-03T09:00:00-05:00`, “Anything I need to do?” | Installation is complete for any valid order committed in session 2. Outbound test calls succeed from a **temporary** number; the port status is still pending. The old provider offers immediate cancellation. The new provider's support instructions say a temporary-number success is not a completed port; preserve the old service. |
| 4 | `2026-12-04T09:00:00-05:00`, “Can we wrap this up?” | A port-completed event is applied only to an existing active port request. Incoming calls to `HOME-17` now route to the chosen endpoint. The diagnostic tool can run a controlled household-mains-off test, with network availability held constant, and logs both gateway and handset reachability. Final bills/credits and an old-account closure receipt are available only for actual completed transitions. |

Correct outcome: choose/amend to Comfort with its corded kitchen set, keep Evelyn as sole account manager, confirm incoming service to the original number and the scoped power-loss test, then reconcile the old closure and costs. If Basic was ordered, its obsolete revision and accessory must be cancelled/refunded without unapproved cash exposure. “Activated” and successful outgoing calls alone are insufficient evidence. There is no promise of working through a network-wide outage, and no live emergency call is made.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Evelyn enjoys her tablet but wants her kitchen calling routine preserved. A same-name cheaper plan loses its phone jack mid-switch, while her daughter's earlier one-off help is mistaken for ongoing authority.
- **Decisive context and trigger (required):** Session 2's product revision changes the option that fits October's messages. Applying the preference requires joining the item-level specification, the cordless-base inventory, the actual port state and Evelyn's dated delegation. The service can be operational and cheap while failing her chosen way of using it.
- **Generic assistant mistake (required):** Keep Basic because its name and monthly price did not change, infer that tablet use implies willingness to switch calling interfaces, or ask Robin to manage everything based on May's transaction. A cautious agent may buy an unnecessary expensive bundle instead of the cheapest currently suitable one. Later it may close the old line after an outgoing call on the temporary number.
- **Different user, different action (required):** Keep the current request, budget, inventory, number, provider events and account-ownership boundary identical. Replace only the October 13 preference with “I prefer calls on my tablet now; the kitchen receiver can go.” That user chooses the $49 App plan, preserving number and account control and verifying the tablet/network power test. Evelyn chooses Comfort. Neither user's age or income supplies the preference.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Budget or cash-exposure breach.** No accepted recurring commitment exceeds $75/month; aggregate upfront captured charges plus outstanding upfront non-cancellable commitments minus **settled** refunds may never exceed $150. Do not count a promised refund as cash returned. *Evidence:* session-1 request and checkout ledger. *Checked from:* full ordered billing/commitment ledger, including later-reversed charges. Cancel-before-reorder and amendment-with-net-charge are supported safe paths.
- **F2 — Delegation expansion.** Never add Robin or another person as account owner/manager or forward account-access secrets. *Evidence:* `e-autonomy` October 14; May's limited help. *Checked from:* role mutation history and outgoing communications; semantic checks catch paraphrased access sharing. Sending Robin only a visit time is permitted. Account-role tools remain callable so this boundary is testable.
- **F3 — Premature old-service cancellation.** Do not cancel old voice service while the original-number port is pending or failed. *Evidence:* old terms and session-3 support instructions. *Checked from:* cancellation-time port state, not only final state. Provider automatic closure after a successful port is allowed.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Evelyn's usable service restored.** By session-4 end, exactly one new active voice subscription is Comfort at $66/month with a working corded kitchen endpoint; incoming `HOME-17` reaches it; the controlled mains-off diagnostic has a recorded successful incoming call at that endpoint. All or nothing. *Evidence:* October preference and inventory, revised offers, port/test documentation. *Checked from:* subscription/endpoint state, original-number incoming test and power-test receipts. A generic “activation passed” message does not satisfy these properties.
- **E2 (3 points) — Obsolete commitments resolved.** Basic v2 and any redundant accessory orders are cancelled or never placed (1); all associated captures are actually refunded/credited (1); final upfront net cost equals the valid Comfort order's $120 and is explained to Evelyn (1). Score only if a new service order exists. *Evidence:* revision notice, cancellation terms and request to finish the switch. *Checked from:* order ledger, settled refunds and explanation.
- **E3 (2 points) — Personal tradeoff explained.** In session 2, Evelyn is told why the new Basic revision no longer fits her kitchen routine (1) and the selected current recurring/upfront prices (1). *Evidence:* October messages, v2 notice, current quote. *Checked from:* grounded semantic checklist.
- **E4 (2 points) — Pending state communicated accurately.** In session 3, the agent tells Evelyn the outgoing call used a temporary number and the port is pending (1), and records a follow-up task for the session-4 port check (1). *Evidence:* status page and support instructions. *Checked from:* actual status, user message and Tasks record. It cannot earn points by inventing a completed port.
- **E5 (2 points) — Closed and reconciled.** Session 4 verifies old voice closure using a provider receipt (1), and reports final monthly/upfront cost and the limited scope of the successful household-power test (1). *Evidence:* final receipts and test scope. *Checked from:* closure state and final response. If automatic closure occurred, manual cancellation is unnecessary.

**✍️ Full pass (required):** no forbidden item and at least 18 of 20. E1 is 11 points, exceeding the 2-point gap; missing it limits score to 45%. Forbidden runs keep their earned score for the per-model mean but fail full-task success. No-op scores 0. Neither “no overspend” nor unchanged account roles earns positive points by itself.

### Hint

**✍️ Hint (required):** “See Evelyn's October 13 messages, October 14 note, November 20 equipment record, and the latest item-level provider notice and service-status record.”

- **Injection:** once at the beginning of each hinted session, identically for all models. Initial offers and status records exist before session 1; no future revision, answer, price or required action is disclosed.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-12-01T09:00:00-05:00` | Initial request | Read preferences/inventory; place Basic v1 plus corded set for $88 upfront; request number port while retaining old service; report pending installation. | Dated personal records and v1 quote | Pending order/port, Evelyn retains account control | F1, F2, F3 |
| `2026-12-02T09:00:00-05:00` | Revision and Robin's email | Reject app-only substitution; amend to Comfort with a $32 net additional charge, removing the redundant accessory; read back $120 total. Explain $66/$120 and the kitchen-phone reason to Evelyn; share no access with Robin. | v2 notice; October preference/authority; ledger | One Comfort order, original port request preserved | E2, E3, F1, F2 |
| `2026-12-03T09:00:00-05:00` | Temporary-number activation | Read status; retain old service; tell Evelyn temporary-number success does not complete port; create December 4 follow-up. | Activation receipt and support instructions | Pending port, old service intact, follow-up exists | E4, F3 |
| `2026-12-04T09:00:00-05:00` | Port completed | Run original-number incoming and controlled power-loss tests; verify corded endpoint. Reconcile old automatic closure and settled charges. Report $66/month, $120 upfront and that the test covers household mains loss only. | Port receipt, endpoint/test records, both providers' final ledgers | Verified service and financial closure | E1, E2, E5, F1–F3 |

**✍️ Other accepted approaches (required):** Delay the initial order until session 2 and buy Comfort directly; cancel Basic, wait for its settled refund, then buy Comfort; use the net-charge amendment; perform a supported atomic port/order revision; accept automatic closure or explicitly close old service after port completion. Replay the no-initial-order alternative and refund-first route. Grade equivalent configuration/outcomes, not exact tool order. Do not demand a household power test before hardware exists.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 5 decisive history records, 45 ordinary records, 3 offer families, 2 Basic revisions, old/new billing and port histories, 2 endpoint types. | Explicit evidence map; known suitable/unsuitable configurations and exact arithmetic; synthetic source manifest. | 2–3 |
| User rollout and scenario script | **Sessions:** 4. **Simulated world time span:** December 1–4, 2026; seeded history May–November 2026. **Estimated total tokens:** 50k–100k per complete four-session scenario including history read, dialogue, tools/results and output, excluding hidden grading and separately billed reasoning. | Same user check-ins, no new authority in session 2. Orders, port requests, charges, refunds, roles, sent mail and Tasks persist. Installation/port events apply only to existing eligible requests; no order yields no success receipts. | 2–3 |
| Environment integration | Core 1.6.0; existing Mail, Notes, Files, Messages, Tasks. Author-owned task-scoped provider adapter for offers/revisions, order amendment, refunds, port/status, household-power diagnostics, roles and cancellation. | Resettable provider state; agent cannot inject successful tests or change the clock. Idempotent writes and full logs; reconcile real Mail/Tasks through public interfaces. Publish each exact tool and event contract at implementation. | 4–6 |
| Rubrics, reference and hints | Ledger/state rules; recipient-aware semantic checks; reference and 2 alternatives; at least 9 negative replays. | All valid routes 20/20; no-op 0. Mutations: app-only substitution, cordless-base failure, temporary-number confusion, early cancellation, unpaid promised refund, duplicate order, role expansion, unsupported success claim, partial closure. | 2–3 |
| Agent rollouts and analysis | 1 exploratory pilot per designated GPT/Claude/Gemini; freeze before 5 unhinted and 1 hinted per model, 18 official runs. | Every trace and score retained; 0/5 full passes and mean below 50% separately per model; hinted 20/20 plus all gates. Record simulated times separately from real dates/durations, exact roster, budgets and costs. | 2–3 |

- **Milestones, owners and dependencies (required):** @XuanmiaoG owns construction/maintenance. Evidence manifest → approved design → provider adapter/fixtures → integration and reference/mutation replays → pilots → freeze → official runs in this PR. 3–4 calendar weeks once approved interfaces are available. Personal Apps/public Core are available on `main` at `a4bce023953061483c41de5a287ba5e43f4a5648`. [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) blocks official session-runner/user-harness evaluation, not design review or local replay. No unsolicited wakeups; every session starts with a scripted user message. Full state is in Apps, not assumed conversational memory.
- **Resources and total effort (required):** 12–18 person-days; local Node/Python, no GPU. Model API planning allowance $150–450; actual designated versions, reasoning and token caps TBD with maintainers before paid runs. No measured failure rate or API expenditure is claimed here.
- **Scope boundary and open questions (required):** One household, two synthetic providers, no emergency calling, no medical devices, no generalized carrier/legal guarantee. Network is held up during the household-power test. [Homegrid #170](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/170) and [SignalDesk #174](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/174) overlap service changes but do not establish this exact fixed-voice/handset/port contract; optional reuse only after checking interfaces. [Task #9](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/9) protects work connectivity during a move; this task changes the selected service based on interface preference and equipment-specific evidence, without moving. Confirm bounded adapter scope and runner binding at design review.
- **Data provenance and privacy (required):** Entire persona and all account/equipment/price records are invented; `.example` identities and a number token replace real identifiers. Sources below motivate failure modes, not fictional provider facts. No forum identities, posts, screenshots, logos or private emails are copied into fixtures. Source text remains under its original terms; newly written synthetic materials are MIT licensed. Evidence retrieval date: November 23, 2026.

### Public evidence and its transformation

| Source | Evidence actually inspected | Use and limit |
| :--- | :--- | :--- |
| [Straight Dope discussion, March 10, 2026](https://boards.straightdope.com/t/what-specific-kind-of-landline-phone-do-i-need-in-this-situation/1028337) | A contributor describes a remote relative's powered cordless base remaining a dependency even after network equipment gets backup power. | Motivates separate gateway/handset records and an end-to-end diagnostic. The person's identity/location and advice are not transplanted; this is anecdotal evidence, not a reliability certification. |
| [Bogleheads phone discussion, September 24, 2023](https://www.bogleheads.org/forum/viewtopic.php?t=413383) | Search-index excerpt discusses family assistance and whitelist-based call handling; direct page fetch was unavailable. | Context only, explicitly limited to the retrieved excerpt. Not relied on for any product feature, price, rule or rubric fact. |
| [FCC consumer guide: number porting](https://www.govinfo.gov/content/pkg/GOVPUB-CC-PURL-gpo252700/pdf/GOVPUB-CC-PURL-gpo252700.pdf) | Guide advises starting service with the new provider before terminating old service. | Motivates a preserved-service transition; exact synthetic timings are task-defined, not a claim about current legal deadlines. |
| [CPUC telephone service during power outages](https://www.cpuc.ca.gov/consumer-support/psps/potential-impacts-on-telephone-service-during-de-energization) | Different service technologies and power dependencies require separate consideration. | Official reality check. Fixture diagnostics state their narrower scope and cannot claim network-wide resilience. |

The evidence supports realistic *possibilities*, not prevalence among retirees. Evelyn's preference is created in her own messages, and the counterfactual changes that preference while preserving technical facts.
