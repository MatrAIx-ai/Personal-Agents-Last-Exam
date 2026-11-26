# App demonstration, Environment data and Task history evidence

Use this contract when planning or delivering an Environment or Task. Proposal review checks the **plan**; completed screenshots, integration runs and coverage reports belong to delivery review. Record the policy revision alongside the approved scope. For an already approved proposal, agree and record any added delivery work rather than silently changing its scope.

## 1. GUI: reference, implementation and workflow sequence

For every required GUI workflow, provide an evidence index in the App README or a linked `evidence/README.md`. Keep screenshots in that directory or in stable PR attachments. Review evidence is separate from runtime assets and is not part of the App's media-bundle budget.

| Evidence | Required content |
| --- | --- |
| Reference-product screenshots | Screenshots of the original product's relevant pages/states, with source URL, capture/publication date and the workflow illustrated. Use public documentation or authorized captures; redact personal data. Explain inaccessible references and obtain a reviewed alternative, rather than inventing an original-product screenshot. |
| Corresponding implementation screenshots | Identify the matching implemented page/state, App commit, Host/browser version, viewport and synthetic run/account. Explain intentional functional or layout differences. A reference is a workflow comparison, not a requirement to copy branding or match pixels. |
| Ordered demonstration | For each core GUI workflow: starting state → actual control/action → intermediate/confirmation state where applicable → visible outcome. Include relevant edit/cancel, invalid/denied and stale/conflicting cases. Annotate actions and expected versus observed results, not just a gallery of unrelated pages. |
| State and test evidence | Link the sequence to its browser test or reproducible manual steps, MCP/API calls, persisted record/version and relevant receipt. Check reload and an independent update through the public interface. Retain App-only business and real MCP tests; screenshots do not replace either. |

The contributor supplies this comparison and sequence; the reviewer opens the artifacts and reproduces key flows in a real browser. Screenshots alone cannot establish that controls work. Report GUI, MCP/API and business-test outcomes separately. An approved MCP-only scope has no GUI screenshot requirement; record that scope explicitly. A promised GUI cannot be reclassified as MCP-only by omitting its implementation.

## 2. Demonstrate declared App dependencies

Cover **every integration claimed as implemented**, including required connections, delivered optional connections, separate Agent calls to personal Apps, and Messaging. Future/deferred connections stay explicitly outside the delivered scope. Use the real pinned dependency through its public tools/receive contract, not only a fake client or a private copy of its state.

For each workflow, record:

1. Source and destination App revisions, exact interface/contract, caller/direction, synthetic account binding and initial states.
2. Runnable command or demonstration steps, actual requests/results and correlation IDs. If the flow starts from a required GUI, include that GUI action and the destination's visible result when a destination GUI is available; otherwise use its real MCP/API result.
3. Result in the dependency: exact recipient/account, record IDs, state/version and, for files, immutable source version, received bytes/hash and accessibility. For read dependencies, show that the source record/version was actually read and used by the downstream action.
4. Relevant missing/denied dependency, incompatible contract/version, retry/duplicate and unknown-result behavior. Check both Apps for unintended changes. Do not infer automatic cross-App rollback.

Distinguish **local send/commit**, **receiver delivery/commit** and **recipient/business confirmation**. A successful publisher return or a delivery receipt does not prove the last of these. Keep App-only test doubles for unit tests, but label them correctly. Reviewers rerun the integration and inspect the dependency's actual state, not only the author's screenshots or test count. See [App integrations](app-integrations.md).

## 3. Environment dataset coverage

The Environment Track's delivered evaluation data must cover **2025-01-01 through 2026-12-31, inclusive**, with realistic records across that period. This is a dataset coverage window, not a requirement for activity on every date or a separate 300-date minimum for every App. Report the actual distribution and gaps; two endpoint records alone do not demonstrate coverage. Small App smoke-test fixtures may remain small, but do not replace the delivered evaluation dataset.

For websites whose earlier data cannot be retrieved, include real source data from **around November 2026** as an anchor and synthesize missing earlier periods. Complete other unavailable portions of the window with realistic synthetic data as needed. Distinguish real, synthetic and mixed records or partitions; retain source URLs, collection dates, represented event dates, generation methods and source versions/hashes. Do not present generated records, including records dated after collection, as observed historical facts. Preserve consistency across related records, users and Apps.

Environment authors own the coverage plan, data collection/synthesis, provenance and working seed/import and retrieval interfaces. Report coverage by month and source, with real versus synthetic portions and any remaining gaps. Reviewers inspect distribution, representative content and actual loading. These requirements concern the evaluation data delivered by the Environment; they do not require each Task to load the entire dataset.

## 4. Task history depth

History on **at least 300 distinct calendar dates is strongly recommended, not mandatory**, across the sources/Apps used by a Task. Select a history depth that supports its personalization challenge. Shorter histories are valid for focused tasks, tasks with few environment dependencies, or scenarios where more context adds little value. State the actual coverage and briefly explain the selected scope; reviewers must not reject a Task solely because it has fewer than 300 historical dates. Do not add filler or lengthen execution merely to reach the recommendation.

Task authors may reuse a versioned Environment dataset and select the relevant user history, preserving record IDs, provenance and permissions. Each Task reports its own selected history after applying the first-session cutoff, not the full Environment dataset's count. Multiple records, fields or Apps on one date count once; a 300-day elapsed span or 300 records is not 300 distinct dates. Dates need not be consecutive. Task history can reside in user context, App workspace records, or both.

History must precede the first session. Date-only records on the first-session date need an actual time to establish this ordering. External-platform tasks still start **on or after 2026-01-01**, and external-platform interaction records date **on or after 2025-01-01**. Earlier text-only personal history and user–agent conversations remain allowed and are reported separately from the Environment coverage window. The Environment dataset window does not impose an end date on Task sessions or scenario events. Do not expose later records from a full Environment dataset as pre-session history; stage them through the scenario's authorized events when appropriate.

### Reproducible count

For Environment coverage and Task history reports, supply a script, query or documented reproducible calculation over the **actual delivered or selected records**. Declare one IANA time zone; normalize timestamps before counting dates and treat date-only records in that zone. Use represented occurrence/receipt dates, not file modification, generation or export dates. Label the scope of each report. No new App schema or platform-specific file format is required. Include:

- Source files/dataset revisions and hashes, stable record IDs, the authoritative date field in each source, and any exclusions with reasons. For an export, explain how it maps to the records actually loaded into the Apps.
- The counting time zone, Environment coverage window or Task first-session cutoff, and treatment of missing/invalid dates. Exclude out-of-window records from Environment coverage and future records from Task history. Report older text-only Task history separately; unresolved errors must be visible.
- Exact calculation/reproduction steps, total record count, per-source distinct-date counts, the **global deduplicated count**, earliest/latest dates and a date breakdown. Environment reports also show monthly coverage, real/synthetic provenance and gaps across the required window.
- Representative content and a history-loading/query demonstration, so reviewers can check realism and that the counted data are actually available through the claimed App interfaces.

Reviewers rerun the supplied calculation, compare hashes and totals, and inspect representative content. Environment acceptance checks the required dataset window and provenance; Task acceptance checks that selected history supports the scenario, without a mandatory date-count threshold. Empty placeholders, duplicated filler, date lists or copied reports do not establish coverage. Scheduled future events and rollout actions do not count as pre-session history. Counting alone does not certify realism or prove successful loading.

At proposal stage, state the intended data scope, time zone, sources/date fields and collection/generation/check method. Environment proposals plan full-window coverage and any real-data access gaps; Task proposals explain selected history depth. Completed records and coverage reports belong to implementation review, not proposal submission.

## Delivery evidence index

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Name the actual workflow | Required, delivered optional, or deferred | Link or justified N/A | Ordered links and observed outcomes | Commands and reports | Inspect the actual dependency | Link when supplying Task history | Passed / failed / not run / N/A with reason |

Keep the four [implementation review sections](review/app-implementation-checklist.md) and the D1–D8 proposal checklist. These evidence requirements strengthen the relevant sections; they do not create a second approval process or replace maintainer review.
