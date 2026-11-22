# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Money & insurance] Auto insurance quotes and comparison`

## 1. App and domains

- **Authors / GitHub handles (required):** Genglin Liu ([@genglinliu](https://github.com/genglinliu)).
- **Reference app or website / URL (required):** [The Zebra](https://www.thezebra.com/auto-insurance/) provides a multi-provider quote-flow reference. [California's consumer guide](https://www.insurance.ca.gov/01-consumers/105-type/95-guides/01-auto/auto101.cfm) and the [NAIC shopping tool](https://content.naic.org/sites/default/files/consumer-auto-shopping-tool.pdf) inform terminology and comparison fields. The package keeps the ID `coverline` and uses original UI, fictional providers and published synthetic pricing rules.
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** An auto-insurance quote app where an Agent maintains sourced driver/vehicle facts, requests coverage, submits authorized applications to several insurers, handles questions and revisions, and saves a comparison with original written terms. The app exposes what was requested, what was disclosed and what each provider offered. The Agent decides which offers fit the user and what needs follow-up.

Five workflows:

1. **Prepare the profile and requested coverage.** Record drivers, vehicle, use, current policy and desired start date with sources and confirmed/unknown status. Save immutable profile and coverage revisions.
2. **Preview and submit applications.** Inspect provider requirements, preview the exact payload, submit under current scoped consent, amend or withdraw. Each submitted revision retains its actual disclosure.
3. **Read written quotes.** Inspect offered coverages, limits, deductibles, exclusions, dates, costs, payment schedules, discount conditions, outstanding verification and expiry. Requested and offered terms are separate.
4. **Answer questions and requote.** Reply to a specific information request, update sourced facts, request revised coverage and track pending, declined, withdrawn, expired and superseded records.
5. **Save and export comparisons.** Select exact quote versions, add sourced notes and export original terms plus a comparison manifest. The Agent explains cost normalization, trade-offs and uncertainty.

### Profile, coverage and quote fields

| Area | First-release fields |
| :--- | :--- |
| Drivers and vehicle | Listed/excluded drivers, driving experience and supplied accident/claim/violation history; vehicle year/make/model/VIN, garaging location, annual mileage, commute/business use and ownership/loan/lease |
| Existing insurance | Current declarations, policy end date, supplied continuous-coverage/lapse history and lender requirements |
| Liability | Separate bodily-injury per-person/per-accident and property-damage limits |
| Vehicle damage | Collision and comprehensive, each with its own deductible |
| UM/UIM and medical | Uninsured/underinsured motorist limits, applicable property-damage variants and medical payments; jurisdiction-specific items such as PIP carry explicit applicability |
| Add-ons | Rental reimbursement daily/total/day limits; roadside/towing limits; GAP availability and conditions |
| Price and conditions | Premium for stated term, included/extra fees and taxes, installments/down payment, total cost, discounts and qualification evidence, and estimate/conditional/written quote stage |
| Dates and provider | Requested and offered start/end dates, quote expiry, provider/legal entity, service notes, exclusions and unresolved facts |

Each term distinguishes offered, excluded, not offered, unknown and not applicable. Zero cost is a numeric value. Each scene declares one synthetic jurisdiction and its available coverages/discounts; the baseline uses medical payments and explicitly marks inapplicable items. Source-linked discount conditions can include pay-in-full, bundling, mileage or driving-data participation. Driver monitoring requires an explicit disclosure choice.

Example: a renewal comparison has one lower-priced quote missing rental coverage, another with a higher deductible, and a conditional discount. A mileage correction creates a new profile version. The Agent gathers current written offers and explains remaining differences. [Task #48](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/48) defines the user's requirements, rubric and model evaluations.

## 3. Potential app connections

- **Internal personal apps (required):** Mail 1.3.0 and Files 1.0.0 are required for the connected demonstration. Calendar 1.3.0 and Finance #6 are optional. App-only workflows use bundled originals and provider services. Contracts below are pinned to main `a4bce023953061483c41de5a287ba5e43f4a5648`; target public runtime 1.6.0 and Core API 1.2.0.
- **Other apps and websites (required):** Four package-local fictional insurers accept applications and expose their own requirements and written replies through trusted events. Pricing/fee rules are deterministic and documented. Live insurer, driving-record, credit-check, licensing/complaint and rating feeds are future integrations.

| Workflow | Caller, direction and interface | Record / verification |
| :--- | :--- | :--- |
| Read provider notices and originals | Agent: [Mail](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/tools.json) `mail.search/get`, `mail.attachment.get` | Actual mailbox/message/asset, application/quote reference and original bytes |
| Store declarations, quotes and exports | Agent: [Files](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/apps/files/tools.json) `files.put/get/read` | File ID, immutable version number, SHA-256 and exact byte readback |
| Publish quote/question notices | Coverline publishes; Infra routes Mail `channel.email` to the bound user's account | Stable notice ID, actual Mail record and Messaging receipt |
| Read renewal context | Optional Agent [Calendar](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/calendar/tools.json) `calendar.list/get` | Event ID/sequence and observation time |
| Consider budget context | Optional Agent reads proposed [Finance #6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) tools under user permission | Source account/observation reference retained in the Agent's analysis |

Calendar is read-only. Finance context helps the Agent assess affordability; insurer payloads contain only authorized quote fields. The default package runs independently with the public runtime and its declared dependencies.

### Integration details

- **Operations and access (required):** The browser uses the same Agent MCP handlers. Proposed tool groups become versioned schemas at M1:

| Operations | Effect |
| :--- | :--- |
| `auto.profile.get/update`, `auto.coverage.get/update` | Read or create sourced profile/coverage revisions |
| `auto.providers.list/get`, `auto.grants.list` | Read requirements, terms and current disclosure grants |
| `auto.disclosures.preview` | Store an exact payload preview and its source revisions |
| `auto.applications.submit/amend/withdraw` | Commit a submission/disclosure or withdrawal record |
| `auto.requests.list/reply` | Read questions; submit a version-bound supplemental disclosure |
| `auto.quotes.list/get/requote` | Read quote history; request a revised offer |
| `auto.comparisons.create/update/get/export` | Write collections/notes; read/export a pinned collection version |

Infra alone uses `env.load_seed`, `env.apply_event`, `env.snapshot`, `env.reset` and `env.advance_time`. Provider replies and trusted user confirmations arrive through that connection. Browser controls expose Agent business operations.

**Consent.** Coverline owns disclosure grants. Infra records a trusted user decision with source, provider, permitted fields, purpose, profile revision and expiry. Agent tools can read grants and prepare submissions. Each preview fixes the profile/coverage revisions and exact payload. Submission checks current consent, preview and access, then commits one immutable disclosure and application revision. A changed profile, provider, field scope, purpose or expired/revoked grant requires renewed consent. Coverage edits require a fresh preview. Supplemental replies have the same checks and reference their information request. Unknown facts remain unanswered until sourced.

- **State and lifecycle (required):** Separate run/binding, provider/rule definitions and user-owned business records. Seedable history includes current declarations, profile/coverage revisions, grants, submitted applications, actual disclosures, pending questions, old quotes and comparisons. Every source/document has an owner, revision and capture/delivery time. The runner owns future events and delivery cursors.

Writes use `request_id` and Core `expected_version` (`epoch`, `revision`). An identical retry returns its original receipt; changed-content reuse returns `idempotency_conflict`; stale new writes return `stale_version`. Reads preserve business state. A submission receipt identifies the local provider queue entry and disclosed payload; later provider decisions have their own records. Withdrawal preserves prior disclosures and quote history.

`reset_scope: app_instance`: reset returns Coverline to its loaded baseline and clock and clears Core receipts/audit. Export evidence first. Mail/Files retain delivered records until Infra resets them separately. Persisted state supports restarting a run; importing saved history creates a fresh baseline. Coordinated cross-App rollback is deferred.

- **Events and notifications (required):** Use `ctx.virtual_now` and the [public time contract](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/docs/runtime-time.md). Infra processes due events, synchronizes participating clocks and verifies the barrier before resuming actors. Initial scenes use scheduled sessions; Agent-owned wakeups are a later runner integration.

Events use `{event_id, at, operation, payload}`. These are independent examples; referenced terms/assets are part of the corresponding controlled source delivery.

| `event_id` | `at` | `operation` | `payload` |
| :--- | :--- | :--- | :--- |
| `grant-a-1` | `2026-12-01T09:00:00-08:00` | `auto.grant_recorded` | `{"grant_id":"grant-a","provider_id":"insurer-a","profile_revision":1,"fields":["vehicle","annual_mileage","coverage"],"purpose":"quote","expires_at":"2026-12-02T09:00:00-08:00","source_ref":"user-turn-2"}` |
| `grant-a-revoked` | `2026-12-01T11:00:00-08:00` | `auto.grant_revoked` | `{"grant_id":"grant-a","source_ref":"user-turn-5"}` |
| `profile-2` | `2026-12-01T11:00:00-08:00` | `auto.profile_corrected` | `{"profile_revision":2,"fields":{"annual_mileage":15000},"source_ref":"user-turn-4"}` |
| `rules-a-2` | `2026-12-01T09:00:00-08:00` | `auto.provider_rules_published` | `{"provider_id":"insurer-a","rule_revision":2,"effective_at":"2026-12-02T09:00:00-08:00","asset_id":"rules-a-v2"}` |
| `question-a-1` | `2026-12-01T09:30:00-08:00` | `auto.information_requested` | `{"provider_id":"insurer-a","application_id":"app-a","application_revision":1,"request_id":"request-a","fields":["annual_mileage"],"reply_by":"2026-12-02T10:00:00-08:00"}` |
| `quote-a-1` | `2026-12-01T10:00:00-08:00` | `auto.quote_delivered` | `{"provider_id":"insurer-a","application_id":"app-a","application_revision":1,"profile_revision":1,"coverage_revision":1,"quote_id":"quote-a","quote_revision":1,"terms_asset_id":"quote-a-json","document_asset_id":"quote-a-pdf","expires_at":"2026-12-03T10:00:00-08:00"}` |
| `quote-a-2` | `2026-12-01T12:00:00-08:00` | `auto.quote_delivered` | `{"provider_id":"insurer-a","application_id":"app-a","application_revision":1,"profile_revision":1,"coverage_revision":1,"quote_id":"quote-a","quote_revision":2,"supersedes":1,"terms_asset_id":"quote-a-v2-json","document_asset_id":"quote-a-v2-pdf","expires_at":"2026-12-03T12:00:00-08:00"}` |
| `decline-b-1` | `2026-12-01T10:00:00-08:00` | `auto.application_declined` | `{"provider_id":"insurer-b","application_id":"app-b","application_revision":1,"reason":"Requested use is outside this product.","source_ref":"provider-b-reply-1"}` |

Validate sender authority, object references, application/profile/coverage consistency and source revisions. Unknown or mismatched references fail. A valid reply to a historical application stays in that history and leaves the current application unchanged. Reusing a quote ID/revision requires identical terms; older deliveries preserve history while the newer revision stays current. Duplicate event IDs return the original outcome; changed-content reuse fails.

**Deadlines and transitions.** Information replies require a current open request and `now < reply_by`. Quote expiry is derived from `now >= expires_at` on reads/writes. Old, expired and superseded quotes remain readable/exportable with their versions and dates. Profile changes leave issued quote terms intact. Rule publications apply to future quotation work; an issued offer changes only through an explicit quote revision. Task/Infra defines same-time ordering; the strict deadline check also applies at that instant. Advancing time triggers no business handler or notice; any expiry notification is explicitly scheduled by Infra.

**Mail direction and example.** Coverline publishes notices to the bound user's Mail account through [text wire v2](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/schemas/router-message.schema.json). Original files use the [attachment wire](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/schemas/router-attachments.schema.json). Application/quote IDs appear in the visible title/body:

```json
{"specversion":"1.0","id":"coverline-quote-a-v1-ready","source":"urn:pale:coverline:owner-account","type":"org.pale.mail.notification.v1","time":"2026-12-01T10:00:00-08:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"owner-1"},"source_object":{"app_id":"coverline","account_id":"owner-account","object_type":"quote","object_id":"quote-a"},"content":{"title":"Quote quote-a revision 1 ready","body":{"format":"text/plain","text":"Insurer A replied to app-a revision 1 using profile 1. Quote quote-a revision 1 expires December 3 at 10:00 -08:00. Read the written terms in the app."},"asset_ids":[]},"extensions":[]}}
```

The App retains stable notice IDs with business history; Infra routes under explicit grants and records actual delivery. Failed delivery preserves the application/quote commit. Unknown acknowledgement is reconciled at Mail before retrying the same ID. Coverline has no Messaging receiver in the first release.

- **Shared data and dependencies (required):** Bind the owner through `person_id` and App account; retain provider, vehicle, profile/coverage, grant, application, disclosure, request, quote and collection versions. Use integer USD cents and explicit dates. Original electronic PDFs have readable text; structured terms and UTF-8 text reference their source bytes, revision and SHA-256. Files references include immutable version numbers.

The package includes provider services, source documents, schemas and its own pages/controller. It runs independently with the pinned public runtime and Node.js 18+. Mail/Files/Calendar are declared run-assembly connections. The [business Web Host](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/runtime/web/README.md) exposes the same Agent MCP state/permissions. Future provider replies, schedules and evaluator criteria stay with Task/Infra. Development scenes are developer-visible.

**Cost conventions.** Each quote states term premium after discounts, which taxes/fees are included or extra, discount eligibility and installment amounts. For example, a six-month premium of $600 plus six $5 fees totals $630, paid as six $105 installments. The initial payment is included in that schedule. Checks reconcile premium, fees and installments. The Agent chooses comparison assumptions across different terms.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Profile/coverage, provider details, disclosure preview, applications/questions, quote history and comparison/export views. Implement five workflows. | Complete application → question/reply → quote → revision/requote → export through GUI and MCP. | 4–5 |
| Data and image collection | Record terminology sources, reused code and licenses; create original UI/documents. | Source/license/hash manifest and bundled assets. | 1 |
| Synthetic data and assets | Script three owner/vehicle scenes, four insurers, two profile revisions and 8–12 written quote versions per scene, with 8–12 timed inputs. | Exact cost arithmetic, coherent disclosure/quote lineage, coverage/date variants and explicit unknowns. | 2–3 |
| App integrations | Public Core, local providers, Mail/Files and trusted consent/events; optional Calendar/Finance reads. | Actual recipient/file readback, current-version authority and package-only execution. | 4–5 |
| Validation and reset | Run the checks below, browser workflows, history/reset/restart and independent reproduction. | Versioned commands, traces, receipts, file hashes and passed/failed/unrun reports. | 4–7 |

### Workflow validation

| Workflow | Success evidence | Failure/retry evidence |
| :--- | :--- | :--- |
| Profile and requested coverage | Sources, listed drivers, lender constraints and exact requested fields/versions are visible. | Unknown facts stay unknown; unavailable source data remains explicit; unauthorized edits fail. |
| Application and consent | Receipt and immutable disclosure match the current preview/grant and local provider queue. | Wrong provider/fields/purpose, expired/revoked consent, changed profile/coverage preview, conflicting IDs; unchanged retry creates one application. |
| Written quotes | Terms/document agree on application, actual coverages, costs, conditions, dates and revisions. | Mismatched provider/application reply rejected; historical replies remain historical; missing coverage and expiry remain visible. |
| Information/requote | Reply targets the open request and source facts; revised application/offer keeps earlier records. | Old/late replies, withdrawal, source correction and simultaneous deadline events. |
| Comparison/export | Collection pins actual quote versions and sourced notes; exported bytes and Files version/hash match. | Stale collection update, unavailable document, comparison/export failure and unconfirmed Files write; saved collection remains available for retry. |

Also verify Mail's actual notice text/references and Messaging receipts, denied delivery with unchanged Mail state, stable-ID deduplication and unknown acknowledgement reconciliation. Exercise authorized Calendar reads only when enabled. Test account/role isolation, coverage/limit/deductible variants, fee totals, source corrections and profile changes in real-browser flows with MCP readback/reload.

App history records disclosures, revisions, outcomes and virtual times. Join it with Core commit/denial evidence and supplied Agent calls/results by run, account, request, application, quote and version. Count repeated requests by their original commit. Export evidence before reset. Load prior history, reset to the loaded baseline and verify Mail/Files remain unchanged. An independent maintainer/contributor reproduces the package from a clean public checkout.

**Document budget:** Each loaded App bundle targets at most 48 assets and 768 KiB decoded bytes, including originals, revisions and exports; Mail/Files declare 64 assets and 1 MiB. Validate peak loaded scenes and report a capacity error while preserving originals. Use readable electronic PDFs, UTF-8 text and JSON. Advanced scan OCR is later work.

- **Milestones, owners and dependencies (required):** @genglinliu owns M0–M3. M0 settles scope, schemas, consent rules and source licenses. Within 14 calendar days of first plan approval, M1 submits one runnable profile/two-provider scene with consent, application, question/reply, quote comparison/export, Core seed/reset, a browser path and Mail/Files readback. M2 completes four providers, three scenes and error/integration coverage. M3 supplies independent reproduction and acceptance evidence. Full delivery is estimated at 3–5 working weeks; M1 lists remaining work.

  Related: [Finance #6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) manages account transactions and optional budget context; [#33](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/33) stores documents; [#14](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/14) covers patient/medical billing. This package owns auto-quote applications, disclosures and offer history. [Task #48](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/48) supplies the personal comparison scenario and model qualification.

- **Resources and total effort (required):** 15–21 person-days: 4–5 + 1 + 2–3 + 4–5 + 4–7. Local CPU/browser, scripted original data and documents. A maintainer will settle Environment trial requirements/budget at M0; agreed runs retain model versions, configuration, traces and costs.
- **Scope boundary and open questions (required):** One policy owner/vehicle and one documented synthetic jurisdiction per run, with listed drivers, sourced underwriting inputs, explicit coverage options, written quotes and comparison exports. Pricing and eligibility use declared synthetic rules. Deferred: policy purchase/binding, premium payments, old-policy cancellation, claims handling, real record inquiries/ratings, multi-vehicle quote management and state-law rule packs. The Agent decides suitability and follow-up.
- **License and external dependencies (required):** New code MIT; original synthetic documents/assets CC0-1.0. Record compatible reuse licenses, versions, hashes and notices. The local package redistributes its sources/assets; product and consumer references inform workflows and terminology.

Implementation and validation evidence will be added in this PR against the approved deliverables.
