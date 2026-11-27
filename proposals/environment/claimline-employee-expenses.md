# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Work & business + Money & insurance] Employee travel expenses (SAP Concur reference)`

## 1. App and domains

- **Authors / GitHub handles (required):** Genglin Liu ([@genglinliu](https://github.com/genglinliu)).
- **Reference app or website / URL (required):** [SAP Concur Expense](https://www.concur.com/products/concur-expense), with [ExpenseIt](https://www.concur.com/products/expenseit) as a receipt-capture reference. This simulated app uses original UI, company policies and records. The package keeps the ID `claimline`.
- **Primary domain (required):** Work & business
- **Secondary domains (optional):** Money & insurance

## 2. What you plan to build

**✍️ Your answer (required):** An employee travel-expense app covering receipt collection during a trip, expense preparation, company review and payment reconciliation. Each expense links the actual charge, itemized receipt and source-supported business purpose. The Agent gathers evidence, resolves discrepancies and follows the report through payment.

Five workflows:

1. **Trip and expenses.** Create a report before travel and collect airfare/rail, hotel, ground transport/car rental, meals, conference fees, parking and tolls. Record trip dates, purpose, project/cost center, payment method and payer.
2. **Receipt collection.** Import email attachments, download available merchant receipts, or save user-provided photos. Preserve original bytes, source, capture time and corrections. Readable electronic receipts provide source-linked field extraction and merchant/date/amount matching candidates; photos remain available for inspection and field entry.
3. **Reconciliation and itemization.** Confirm or separate candidate matches. Pending and settled charges share one transaction lineage, including tips/refunds. Itemize hotel room nights, taxes, parking, meals and personal items; itemizations sum to the parent amount. Record purpose and required attendees from obtained evidence or clarification.
4. **Policy and reports.** Apply published receipt requirements, category limits, deadlines and explanation rules. Preview findings and totals, submit, withdraw before review, or revise a returned report. Missing evidence stays visible.
5. **Review and payment.** A separate reviewer returns, approves, partially approves or rejects the submitted revision. Track scheduled, partial, paid and failed reimbursements and the outstanding balance.

**Payment types:** Default company cards are centrally paid. Their business expenses appear in the report and company-paid total. Eligible personal-card/cash expenses contribute to employee reimbursement. Personal items remain separate employee liabilities under company policy. For example, $1,200 of eligible expenses paid $900 by company card and $300 by the employee yields $300 due to the employee. Offsetting personal liabilities requires an explicit policy.

The main example is a conference trip: collect each meal's charge, itemized receipt and purpose while the trip is underway, handle a tip adjustment and corrected receipt, submit the report, resolve a return and check actual payment. [Task #43](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/43) develops that scenario and its rubric.

## 3. Potential app connections

- **Internal personal apps (required):** Mail 1.3.0 and Files 1.0.0 are required for the connected demonstration; Calendar 1.3.0 is optional trip context. App-only checks use bundled sources. Target public runtime 1.6.0 and Core API 1.2.0. The published contracts below are pinned to main `a4bce023953061483c41de5a287ba5e43f4a5648`.
- **Other apps and websites (required):** Package-local simulated card and merchant services supply charges and downloadable originals. Optional Finance [#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) supplies bank transactions and reimbursement deposits once its proposed interfaces are available.

| Workflow | Scope, caller and public interface | Stored reference / verification |
| :--- | :--- | :--- |
| Find receipt emails | Required demonstration; Agent: [Mail](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/tools.json) `mail.search/get`, `mail.attachment.get({id,asset_id})` | Mail account/message/asset, original bytes/hash and capture time |
| Preserve/export documents | Required demonstration; Agent: [Files](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/apps/files/tools.json) `files.put/get/read` | File ID, immutable version number and hash; read back those bytes |
| Read trip context | Optional; Agent: [Calendar](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/calendar/tools.json) `calendar.list/get` | Authorized event ID/sequence and observation time |
| Deliver review/payment notices | Required demonstration; App publishes, Infra routes to Mail `channel.email` / `mail.receive_notification` | Stable notice ID, bound employee mailbox, actual Mail record and Messaging receipt |
| Obtain charge/merchant evidence | Required local source; Agent reads card records or downloads a published merchant source | Source transaction/version and receipt bytes/hash; source records are created by Infra |
| Reconcile bank deposits | Optional; Agent reads #6 `finance.transactions.list`; Infra applies `finance.credit_posted` | Shared payment ID in `source_ref`, Finance account, posting ID and commit evidence |

Calendar is read-only in this scope. Employee questions and merchant requests are stored request records with named recipients; Task/Infra supplies actual replies. Messages and Calendar writes can be added later.

### Integration details

- **Operations and access (required):** Browser and MCP use the same business handlers. Proposed Agent operations are grouped below; versioned schemas follow at M1.

| Operations | Effect |
| :--- | :--- |
| `expense.trips.list/create/update` | Read/edit trip and report context |
| `expense.charges.list` | Read authorized pending/settled/refunded source records |
| `expense.receipts.list/download/register` | Read available sources/download bytes; register an obtained original and file reference |
| `expense.matches.preview/confirm/separate` | Read candidates; write or separate evidence associations |
| `expense.lines.create/update/itemize` | Edit expense details, sourced purpose, attendees and allocations |
| `expense.requests.create/cancel` | Record a request or cancel an outstanding request |
| `expense.policy.get` | Read applicable policy versions |
| `expense.reports.create/preview/submit/withdraw/discard/export` | Prepare reports; preview/read export bytes; write lifecycle changes |
| `expense.payments.list` | Read decisions, payments and outstanding amounts |

Infra alone seeds records, supplies merchant/user originals, applies charge/policy/reviewer/payment events, resets and advances time. Reviewer and payment actors enter through trusted Infra events with source references. The employee Agent prepares and submits reports. Source authority comes from the delivered merchant/user record; registration validates original bytes/hash and retains that source. Matching suggestions use visible merchant/date/amount fields. Purposes retain their supporting dialogue/document reference and any uncertainty.

**Evidence example:** `charge-7` (authorization then $96 settled) links to `receipt-7/v2`, saved as Files `file-7` version 2 with its SHA-256 hash. `purpose-7` cites an obtained employee clarification. Report `report-1/r2` freezes those references. Earlier receipt/report versions remain accessible.

- **State and lifecycle (required):** Separate run/binding, company/policy, employee, source records and business revisions. Seedable history includes trips, charges, originals/corrections, purposes, requests, draft/submitted reports, decisions and payments. Financial amounts use integer USD cents. The runner owns event ordering and delivery cursors. Source data is delivered through normal public observations; the simulated employee sees its own context and obtained observations.

Writes carry `request_id` and Core `expected_version` (`epoch`, `revision`). An identical retry returns its original receipt; changed-content reuse conflicts and stale new writes fail. Reads preserve business state. Submission freezes the report revision and evidence references. A later source correction adds a visible review flag while preserving that snapshot.

`reset_scope: app_instance`: reset restores the loaded Claimline baseline, assets and clock and clears Core receipts/audit. Export evidence first. Infra resets Mail, Files and optional Finance separately. Persisted state supports restart; historical seed imports establish a fresh baseline. Cross-App snapshot rollback is deferred.

**Report transitions:** Drafts are editable/discardable. Submitted revisions are locked; withdrawal before a review decision returns the report to a new draft revision. Returned reports can be amended and resubmitted. Approved/rejected revisions remain in history. Post-approval amount adjustments are later work. Request cancellation preserves earlier requests/replies.

Requested, approved, company-paid, employee-paid, employee-liability and reimbursed amounts are separate. Reviewer decisions record reasons for reductions/rejections. Payment handlers reject a wrong report revision or an amount above the approved employee balance. A $96 employee claim approved for $90 and paid $80 shows $10 still due. Source refunds/corrections remain visible for review. Completed payments require a unique payment ID and trusted payment evidence.

- **Events and notifications (required):** Use `ctx.virtual_now` and the public [time contract](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/docs/runtime-time.md). Task/Infra processes events and synchronizes clocks before sessions. Initial collection runs use scheduled sessions; Agent-owned wakeups are a later runner integration.

Each event has `{event_id, at, operation, payload}`. The table supplies independent examples of all proposed event types.

| `event_id` | `at` | `operation` | `payload` |
| :--- | :--- | :--- | :--- |
| `charge-7-pending` | `2026-12-01T18:00:00-08:00` | `expense.charge_recorded` | `{"charge_id":"charge-7","source_revision":1,"status":"pending","amount_cents":8000,"source_ref":"card-feed-7"}` |
| `charge-7-settled` | `2026-12-02T09:00:00-08:00` | `expense.charge_recorded` | `{"charge_id":"charge-7","source_revision":2,"status":"settled","amount_cents":9600,"source_ref":"card-feed-7-final"}` |
| `charge-7-refund` | `2026-12-06T09:00:00-08:00` | `expense.charge_recorded` | `{"charge_id":"charge-7","source_revision":3,"status":"refunded","refund_cents":9600,"source_ref":"card-refund-7"}` |
| `receipt-7-ready` | `2026-12-01T18:05:00-08:00` | `expense.receipt_delivered` | `{"source_id":"receipt-7","source_revision":1,"asset_id":"receipt-7-pdf","source_ref":"merchant-7","available_until":"2026-12-02T18:05:00-08:00"}` |
| `receipt-7-corrected` | `2026-12-02T09:05:00-08:00` | `expense.receipt_delivered` | `{"source_id":"receipt-7","source_revision":2,"supersedes":1,"asset_id":"receipt-7-v2-pdf","source_ref":"merchant-7-correction","available_until":"2026-12-03T18:05:00-08:00"}` |
| `purpose-7-reply` | `2026-12-02T10:00:00-08:00` | `expense.request_replied` | `{"request_id":"request-7","source_ref":"employee-turn-4","text":"Conference dinner with the project team."}` |
| `policy-2-published` | `2026-12-01T09:00:00-08:00` | `expense.policy_published` | `{"policy_id":"travel","revision":2,"effective_from":"2026-12-05","asset_id":"policy-v2","source_ref":"employer-policy-2"}` |
| `report-1-returned` | `2026-12-03T12:00:00-08:00` | `expense.review_recorded` | `{"report_id":"report-1","report_revision":1,"decision":"returned","reason":"Add the itemized receipt.","source_ref":"reviewer-1"}` |
| `report-1-approved` | `2026-12-04T12:00:00-08:00` | `expense.review_recorded` | `{"report_id":"report-1","report_revision":2,"decision":"approved","approved_line_amounts":{"line-7":9000},"source_ref":"reviewer-2"}` |
| `payment-1-scheduled` | `2026-12-04T13:00:00-08:00` | `expense.payment_recorded` | `{"payment_id":"pay-1","report_id":"report-1","report_revision":2,"amount_cents":8000,"status":"scheduled","source_ref":"employer-payment-1"}` |
| `payment-1-paid` | `2026-12-05T09:00:00-08:00` | `expense.payment_recorded` | `{"payment_id":"pay-1","report_id":"report-1","report_revision":2,"amount_cents":8000,"status":"paid","source_ref":"payment-proof-1"}` |
| `payment-1-failed` | `2026-12-05T09:00:00-08:00` | `expense.payment_recorded` | `{"payment_id":"pay-1","report_id":"report-1","report_revision":2,"amount_cents":8000,"status":"failed","source_ref":"payment-failure-1"}` |

Receipt events can deliver, correct or void a source; review decisions include returned, approved and rejected. Payment states preserve prior attempts; paid is terminal, and new installments have new payment IDs. Duplicate event IDs return the original result; changed-content reuse, obsolete source/report revisions and unauthorized actions fail. Payment IDs prevent counting the same payment twice across distinct events.

**Time rules:** Merchant download succeeds while `now < available_until`; saved originals remain readable afterward. Receipt voiding preserves the original and flags its use. Policy eligibility uses the expense's local occurrence date. Policies publish timezone, effective dates, first-submission deadline and return/amendment deadline. A timely report keeps its first submission time when returned. Expiry is checked on reads/writes; clock advancement triggers no business work.

**Mail direction and example:** Claimline publishes text notices to the employee's bound Mail account; incoming merchant emails are seeded/delivered by Task/Infra and read by the Agent. Use [text wire v2](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/schemas/router-message.schema.json); original files use the [attachment wire](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/schemas/router-attachments.schema.json). This example is addressed to the employee enabled in the run binding:

```json
{"specversion":"1.0","id":"claimline-report-1-r1-returned","source":"urn:pale:claimline:employee-account","type":"org.pale.mail.notification.v1","time":"2026-12-03T12:00:00-08:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"employee-1"},"source_object":{"app_id":"claimline","account_id":"employee-account","object_type":"report","object_id":"report-1"},"content":{"title":"Report report-1 revision 1 returned","body":{"format":"text/plain","text":"Please add the itemized receipt for expense-7, then resubmit report-1."},"asset_ids":[]},"extensions":[]}}
```

Business changes retain stable notice IDs. Infra routes notices under explicit grants and records delivery receipts. A failed delivery leaves the report/payment state committed; unknown delivery is checked before retrying the same notice ID.

- **Shared data and dependencies (required):** Bind the employee through `person_id`, App account and report/source IDs. Originals use PDF, text, PNG/JPEG, MIME type, SHA-256 and capture time; Files references include immutable version numbers. The package includes its source providers, original assets, Node handlers and business GUI and runs independently with the pinned public runtime (Node.js 18+). Mail/Files/Calendar are declared run-assembly connections. The [Web Host](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/runtime/web/README.md) uses the same Agent MCP state and permissions. Future source deliveries, scenario schedules and scoring data stay with Task/Infra; development scenes are developer-visible.

**Optional Finance #6 connection.** Claimline owns report/approval/payment accounting; Finance owns account balances and bank postings. Direct account-paid expenses retain their Finance transaction reference. Credit-card authorizations and merchant receipts remain package-local sources.

Once #6 is available, the runner binds the employee's Finance account. For payment `pay-1`, it applies the proposed Finance event `finance.credit_posted` with `{"account_id":"checking","amount_cents":8000,"source_ref":"claimline:pay-1"}`. It retries the same event ID after an unconfirmed reply, reads Finance's posting/commit evidence, then supplies `expense.payment_recorded` with that proof. The App marks the amount paid only after confirmed evidence. The bridge derives one stable Finance event ID per run/account/payment ID and retains its original envelope for retries. A confirmed payment is terminal; further installments use new payment IDs. Interrupted steps remain scheduled/unconfirmed until reconciled. This bridge uses public interfaces and is owned by this contribution; its schemas will be agreed with #6's implementation. Standalone runs use trusted local payment events.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Trip/report library, receipt inbox, expense/itemization detail, policy preview, review history and payment views. Implement the five workflows and public tools. | One source-to-payment flow through GUI and MCP; company-card and employee totals agree. | 5–7 |
| Data and image collection | Use Concur's public workflow documentation; inventory reused research sources/licenses. Create original UI and documents. | Source/reuse manifest; bundled assets. | 1 |
| Synthetic data and assets | Script three scenes with 10–15 expenses each: ordinary conference travel; missing/corrected evidence; mixed company-card/out-of-pocket and partial payments. Include two policy versions, hotel itemization and 12–16 timed inputs. | Fixed seeds, exact totals, coherent IDs/versions and source dates. | 3–4 |
| App integrations | Implement Mail/Files and local source providers, optional Calendar, and the proposed Finance bridge when #6 is available. | Actual receiver/file readback and public-interface checks; standalone reproduction while #6 is being built. | 4–6 |
| Validation and reset | Run the checks below, real-browser flows, history/reset/restart and independent reproduction. | Versioned commands, traces, receipts, hashes, reports and remaining checks. | 5–7 |

### Validation and asset budget

| Area | Planned success and failure evidence |
| :--- | :--- |
| Capture and association | Read original bytes back from Files and compare version/hash; detect missing originals, wrong/ambiguous matches, duplicates and corrected receipts. File saved but registration failed remains recoverable. |
| Itemization and policy | Hotel/tax/personal splits sum correctly; company-card expenses and employee reimbursement remain separate; policy version, attendees, source purpose and deadline checks are visible. |
| Reports and roles | Freeze submitted evidence; exercise discard, withdrawal, return/resubmit, partial approval and rejection. Stale revisions and employee attempts to record review/payment decisions fail. |
| Payment | Requested/approved/paid/outstanding amounts agree; partial/failed/duplicate events preserve correct balances. Optional Finance mode reads actual bank evidence and tests interrupted deposit/reconciliation. |
| Mail/Calendar | Verify employee inbox content and Messaging receipts, refused delivery, unchanged-ID retry, unknown acknowledgement reconciliation and authorized Calendar reads. Notifications preserve report/payment facts. |
| Runtime and GUI | Run App-only business tests, public Core/Messaging/CI checks and real-browser workflows with MCP readback/reload. Load prior history; reset to the loaded baseline; verify other Apps remain unchanged. Export audit before reset. |

Join App history, Core commit/denial receipts and supplied Agent calls/results by run, source, request, report revision and payment ID. Keep raw evidence and distinguish passed, failed and unrun checks. An independent maintainer/contributor reproduces the submitted package from a clean public checkout.

Budget each loaded App bundle for **at most 48 assets and 768 KiB decoded bytes**, including originals, corrections and exports. Mail/Files declare 64 assets and 1 MiB. Validate the peak loaded scene at generation and export time; preserve originals and report a capacity error if exhausted. Use text/electronic PDFs and a few small images. Structured extraction covers readable originals; advanced image OCR is later work.

- **Milestones, owners and dependencies (required):** @genglinliu owns M0–M3. M0 settles scope, schemas, source licenses and the optional Finance contract. Within 14 calendar days of first plan approval, M1 submits one runnable scene: capture/link/purpose, hotel split, policy preview, submission/return/approval, local payment reconciliation, Core seed/reset, a browser path and Mail/Files readback. M2 completes all views/scenes/errors and available connections. M3 supplies independent reproduction and final acceptance evidence. Full delivery is estimated at 4–5 working weeks; M1 lists remaining work.

  Related: [#33](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/33) stores documents; this App manages employee claims and payment accounting. [#14](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/14) covers patient/medical-benefits work. [#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) supplies optional bank effects. [#43](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/43) separately defines the conference receipt Task.

- **Resources and total effort (required):** 18–25 person-days: 5–7 + 1 + 3–4 + 4–6 + 5–7. CPU/browser and deterministic original scene data. Paid model services are optional; the maintainer will settle Environment trial requirements/budget at M0. Agreed runs retain model versions, configuration, traces and costs.
- **Scope boundary and open questions (required):** One employer/employee per run, one reviewer stage, USD, one project/cost center per expense, ordinary business travel, receipt matching/itemization and partial approvals/payments. Deferred: travel booking, pre-trip budget approval, FX, mileage/per-diem engines, multi-center allocation, post-approval amount changes, ERP/payroll, live payments and advanced OCR. The Agent handles evidence collection and follow-up; schedules remain runner-owned.
- **License and external dependencies (required):** New code MIT; original synthetic documents/assets CC0-1.0. Record compatible reuse licenses, hashes and notices. The local package includes its sources and assets; external product references describe workflows. Optional Finance is assembled through public interfaces.

Implementation and validation evidence will be added to this PR against the approved scope.
