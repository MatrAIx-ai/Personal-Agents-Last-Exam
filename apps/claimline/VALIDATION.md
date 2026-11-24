# Validation map

- `tests/business.test.cjs`: original bytes/hash, explicit matches, itemization,
  separate totals, policy/deadlines, immutable submissions, return/resubmit,
  partial approvals, terminal payment IDs, failed/scheduled/paid distinctions.
- `tests/runtime.test.cjs`: real resource access and source corrections,
  Core request/version/epoch behavior, denied employee Infra calls, actual MCP
  persistence, policy-constrained resource reads and App-local reset.
- `examples/run-connected.cjs`: actual Mail attachment → immutable Files version
  → saved/matched Claimline original; return/amend/resubmit, partial approval,
  payment deduplication, routed Mail notice, JSON export and receiver reset
  isolation. Every source and actor action is supplied; no model trial is claimed.
- `tests/browser.cjs`: actual GUI controls, original preview, hotel split,
  six captures/matches, policy preview, frozen submission, no self-approval,
  trusted return/approval/payment, reload, mobile layout and console checks.
- `runtime/cli.cjs verify --app apps/claimline`: public package and MCP checks.

Reports and screenshots go under ignored `.artifacts/`. Current commands are in
README.md. Full M2 scenes/photo/PDF coverage, optional Calendar/Finance integration,
clean non-author reproduction, human workflow/source review, model-trial decisions
and final maintainer acceptance remain pending. This is a local M1 implementation,
not final upstream acceptance.
