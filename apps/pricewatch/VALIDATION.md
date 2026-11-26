# PriceWatch v1 validation

Scope: the MCP-only App approved in PR #221, including Chenngzz's same-watch/material-change clarification. App 1.0.0, public runtime 1.6.0, Core API 1.2.0, optional Notes 1.0.0. The independent base is unmodified public main `a4bce023953061483c41de5a287ba5e43f4a5648`; no candidate Core, validator or other App change is required.

Local execution uses Node v23.9.0. Node 18/22 CI, human workflow/provenance acceptance and final maintainer merge are separate outcomes, not claimed by these local checks. No model, GUI, live merchant, phone-delivery or production authentication test is claimed.

## Workflow coverage

| Approved requirement | Evidence and controls |
| --- | --- |
| Stable watch intent and material criteria | Business tests update ceiling and variant under the same caller key; server ID remains stable. All material fields, explicit distinct keys and normalized seller/unit no-ops are checked. |
| Pause, edit and resume | Available candidates withdraw atomically; paused edits and subsequent lower prices create none; explicit resume opens one activation and re-evaluates current quotes. |
| Exact identity and payable quote | Formula, pack, quantity, seller and currency controls; unknown tax/shipping/identity/eligibility do not match. Integer arithmetic uses exact intermediate calculation and rejects unsupported totals. |
| Immutable market history | Episode replay under another event ID, conflicting reuse, supersession/revocation, unknown/cross-target references and future-start publication controls. |
| Expiry without read effects | Clock-only boundary reads show no effective candidate while business data/history remain unchanged; explicit expiry records one transition. Pause after expiry preserves the correct causal reason. |
| Loaded history | Minimal and second-account seeds have 39 records each; the historical seed has 75, including four watches, criteria/state history, candidates and receipts from 2026 onward. Real Infra loads/modifies/resets the full historical bundle. Impossible rule/activation/source-time histories, cross-collection IDs and foreign/inconsistent receipts are rejected. |
| Real Host authority and writes | Separate stdio Agent/Infra discovery and calls; guessed management operations and forged identity arguments fail. Exact retry, changed same-ID arguments, stale version, concurrent writes, persisted state, reset, separate runs and replacement account are tested against public Core. |
| Optional Notes assembly | Actual Notes MCP creation/read stores private synthetic history and returned watch/candidate IDs; assertions inspect PriceWatch state and attributable call arguments for absence of the diary. No fake receiver or direct state access substitutes for it. |
| Standalone boundary | Business tests and walkthrough run from a copy of only this package with runtime environment variables removed. The public Host separately verifies an isolated copied package. |

The complete business suite has 31 tests, including independent regressions for exact large-price arithmetic, candidate causal history, object identity collisions and invalid activation sequences. The App-only walkthrough covers seven successive workflow assertions. The dedicated real-MCP suite records its assertions and complete call/result/snapshot trace; the optional Notes example records 20 assertions and 26 real MCP interactions. Generated JSON reports state the actual count and package hash rather than treating a test count as acceptance.

## Reproduce

From the public repository root:

```sh
npm --prefix apps/pricewatch test
npm --prefix apps/pricewatch run example
npm run contracts:check
npm run app:verify -- --app apps/pricewatch --output .artifacts/pricewatch.json
PALE_RUNTIME_ROOT="$PWD/runtime" node apps/pricewatch/tests/runtime-integration.cjs .artifacts/pricewatch-runtime.json
PALE_RUNTIME_ROOT="$PWD/runtime" PALE_NOTES_APP="$PWD/apps/notes" node apps/pricewatch/tests/notes-integration.cjs .artifacts/pricewatch-notes.json
npm test
```

Run the independent base's unchanged `runtime/cli.cjs verify --app ABSOLUTE_PRICEWATCH_PATH --output REPORT` against the same package as well. For App-only PR CI selection, commit the package first: the selector uses the Git diff and must not be reported as a pass merely because uncommitted files were not selected. `app:verify` directly names the package and avoids that false pass.

Generated reports belong outside the App, under ignored `.artifacts/`, to keep the source package hash stable and avoid committing runtime state or creating a self-referential report hash. The public verifier records `package_sha256`; the custom MCP reports also hash the actual copied package, runtime files and optional Notes dependency. Export those reports before resetting or removing a run. Shared generated contract copies are checked with the unmodified official builder.

## Review limits

These checks establish local business behavior, public stdio MCP integration, history/reset behavior and the optional Notes assembly. The public verifier's remaining human App-workflow/provenance judgments are not overridden. Task #207's scenario, grader, SOTA qualification and eventual accepted-task credit remain separate. The Environment implementation is submitted for maintainer reproduction and review, not self-accepted or merged.
