# Implementation acceptance record

Scope: the complete StayReady proposal approved by Chenngzz at `8186a72bd0a5d2f837476db163ab75e36ed61233`, plus the submitter's November 26 request to incorporate the newly merged upstream evidence policy. The approved proposal file has not been edited. The implementation reuses public runtime/Web Host `1.6.0` at upstream `6933c430942c64f94874083815829e4a4b20920a`; no runtime or sibling App implementation is changed.

This is the author's reproducible implementation evidence, not an independent M4 sign-off. Exact package and Host hashes, final commands and observed results are in the [retained evidence manifest](../../../evidence/stayready/manifest.json). Required CI and human decisions must be checked against the submitted PR head.

| Requirement / mode | Scope source | Evidence / verdict basis | Remaining reviewer work |
| --- | --- | --- | --- |
| Package and public contracts | D1, D6; Core API 1.2.0 / contribution 0.4.0 | Candidate Node 18/22 and independent upstream-base verifier reports; App-only tests are copied away from Core and sibling Apps by the verifier; standalone example executes real business functions | Reproduce exact package; inspect declared tools, schemas, hooks and absence of runtime changes |
| Business workflows | D1, F1–F5 | App-only tests, six fixture reference/control executions, real MCP traces and browser sequences | Judge realism and whether explicit hotel terms resolve each need; do not equate a request with coverage |
| History/lifecycle/races | F4–F6 | Complete-history matching, unchanged static-event reset replay, epoch/receipt reset, separate runs, concurrent writes and reply/withdraw conflict, invalid-seed rollback | Reproduce order-dependent outcomes using the recorded versions and supplied virtual time |
| Optional Contacts/Notes | D4 | Actual version 1.0.0 public reads, source/account/version trace, explicit Infra grant, downstream request, unchanged source-state hashes; missing/denied/incompatible cases | Check that trusted source establishment is explicit; this is not live sync or implicit permission |
| GUI | D1, M4 | Real Chromium controls and ordered screenshots correlated with independent Agent/Infra state; reload, refresh, failures, retry, management denial, mobile and text-content checks | Compare public reference pages to the original synthetic GUI and reproduce key controls |
| Dataset | D3 plus current submission-evidence policy | 96 scenarios / 24 months, all public-MCP load/query results; explicit source/month/date semantics and hashes; six smaller workflow fixtures kept separate | Judge scenario usefulness, synthetic variation and the public-reference alternative |
| Human workflow/provenance | M4 | Explicit dates, facts, limitations, reference/implementation comparison and notices | **Pending independent reviewer**: acceptability of public FAQ references instead of authenticated booking-management pages, and their use as the November 2026 real factual anchor |
| Messaging and attachments | Excluded / not claimed | **Not applicable**: empty messaging directions and no App attachment resources | None unless scope is separately expanded |
| Model-agent trials and production remote deployment | Explicitly outside v1 | **Not applicable**, not inferred from local tests or screenshots | Separate scope only |

## Added evidence work after approval

Upstream PR #260 introduced the current screenshot/dependency/history evidence policy after plan approval. The submitter explicitly requested incorporating the new upstream requirements. The delivered additions are official public-page captures with source/date/hash, actual dependency runs, ordered GUI sequences and a two-year monthly scenario library. These additions increase the data/evidence volume beyond the originally estimated minimal fixture package; they do not add hotel booking commerce or change the event/recovery contract. The approval deadline is still December 8, 2026 at 22:01:06 UTC.

The dataset contains zero real guest records. November 26 public FAQ observations are separated from synthetic source observations and future service dates. Historical authenticated hotel pages were not collected. The [reference record](reference/README.md) documents the unavailable original category interaction and its public alternative. Maintainers must review that alternative; neither the user instruction nor this author report substitutes for maintainer acceptance of evidence-policy applicability.

## M4 acceptance request

The independent reviewer should reproduce the linked commands against the final PR SHA, inspect the F1–F6 valid/control differences, examine original and implemented screenshots with actual controls, verify real dependency source use and all-month seed loading, and record passed/failed/not-run/not-applicable per the repository checklist. Any remaining failure belongs in the PR with its reproduction and owner. Plan approval, a lifecycle submission command and green local tests do not merge or accept this contribution. Final approval/acceptance and merge remain maintainer actions.
