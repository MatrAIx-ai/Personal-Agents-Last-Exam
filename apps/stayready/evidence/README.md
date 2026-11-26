# StayReady implementation evidence

This is the evidence entry point for StayReady 0.1.0 in PR #44. The approved proposal is unchanged. The package implements late arrival, step-free access, breakfast, companion substitution, request/commitment history, change/cancel/withdraw, explicit disclosure and reset plus ordered replay using the existing plugin and Web Host.

The [retained run index](../../../evidence/stayready/README.md) and [machine-readable manifest](../../../evidence/stayready/manifest.json) record the tested package/Host SHA-256, upstream revision, Node/browser versions, commands, result artifacts and final checks. Run artifacts are outside the App directory so writing evidence does not change the package being verified. The package hash, rather than a self-referential documentation commit ID, binds every final run to the exact App bytes.

| Evidence | What it establishes |
| --- | --- |
| [Acceptance record](acceptance.md) | D1–D6 / M4 scope, separate mode verdicts, post-approval evidence additions and pending human decisions |
| [Node 18 public verifier](../../../evidence/stayready/verify-node18.json), [Node 22 verifier](../../../evidence/stayready/verify-node22.json), [independent base verifier](../../../evidence/stayready/verify-base.json) | Package/contract loading, standalone business/example execution and actual MCP protocol/lifecycle checks |
| [Real MCP result](../../../evidence/stayready/mcp-flow.json), [full ordered trace](../../../evidence/stayready/mcp-trace.json) | Unchanged prewritten hotel payloads, source→need→request→confirmation, immutable terms, clock effects, reset equality, invalid-state rollback, isolation and race receipts |
| [Six fixture controls](../../../evidence/stayready/fixture-controls.json) | F1–F6 valid, no-action and incorrect executions with explicit business outcome checks; no-new-action is correct for already-covered F3 |
| [Actual Contacts/Notes result](../../../evidence/stayready/dependencies.json), [full trace](../../../evidence/stayready/dependency-trace.json) | Pinned public reads, source use, narrow disclosure, same-key unknown-outcome retry, failure cases and unchanged source records |
| [GUI comparison and sequence](browser.md), [browser report](../../../evidence/stayready/browser/report.json) | Actual controls through the existing Host, ordered screenshots, independent MCP/state correlation, failures, persistence and backend isolation |
| [Supplementary manual browser check](../../../evidence/stayready/manual/report.json) | Chrome preview/send/reload/withdraw actions, observed persisted state and retained baseline service |
| [Data coverage](data-coverage.md), [all-seed MCP report](../../../evidence/stayready/dataset-mcp.json) | 96 loadable scenarios across all 24 months, real public loading/query, explicit date counts, synthetic provenance and hashes |
| [Official references](reference/README.md), [source/capture manifest](reference/sources.json) | Actual public page observations and screenshots, source/date/hash and unavailable-reference limitations |
| [Notices](../NOTICES.md) | Original code/data license, public platform reuse and distinct publisher material |

## What the results do not claim

An App business history records domain changes. Core audit and receipts record authorized execution, versions, retry identity and outcomes. Supplied traces correlate these layers; screenshots illustrate visible states. None is substituted for another, and no local evidence establishes a model-agent benchmark, production deployment, real external hotel delivery or independent maintainer acceptance.

The public-reference alternative and synthetic data realism remain for M4 review. Required GitHub CI and review status must be read at the final submitted head; a prior proposal approval is not implementation approval.
