# Meeting Poll validation map

This package targets PALE runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. The frozen public base is `25d559778696dff849bb88fcca03f325185f2599`. The exact package SHA-256, Node/ICU/tz versions and run outcomes are recorded in generated reports. Review artifacts live outside the App's runtime/GUI surface.

## Reproduce

Run from a public repository checkout, using Node 22.16.0 for matching evidence:

```sh
node apps/meeting-poll/scripts/contracts.cjs --check
node apps/meeting-poll/scripts/fixtures.cjs --check
node apps/meeting-poll/scripts/evaluation.cjs --check
node apps/meeting-poll/tests/evaluation.cjs
node --test apps/meeting-poll/tests/business.test.cjs
node apps/meeting-poll/examples/run.cjs
node runtime/cli.cjs verify --app apps/meeting-poll --output .artifacts/meeting-poll/common.json
node apps/meeting-poll/tests/integration.cjs
npm ci
npx playwright install chromium
node apps/meeting-poll/tests/browser.cjs
npm test
```

`PALE_RUNTIME_ROOT` may point at a separate pinned public runtime for integration tests; `PALE_REPORT_DIR` chooses the external report directory. App business tests require neither variable nor an installed runtime. The common verifier copies the exact App into a disposable registry, runs standalone business/example commands and separate Agent/Infra MCP processes. A second invocation with the untouched base runtime establishes compatibility without modifying its validator.

Optional paid model smoke batch (only synthetic context and public business tools are sent):

```sh
# Supply OPENAI_API_KEY through the process environment; do not put it in a command or file.
node apps/meeting-poll/tests/agent-smoke.cjs
```

The model versions, temperature, output/step limits, messages, tool calls/results, usage, actual final state and grader outcomes are saved. A conservative local cost reservation is capped at US$30 per batch and is not presented as an invoice. Prior attempts must be retained when rerunning. No automatic trial selection or success-only reporting is allowed. The grader and Infra client are inaccessible to the model. These are small environment usability checks; they do not establish the three-family Task Track difficulty requirement.

## Workflow and control evidence

| Requirement | Evidence |
| :--- | :--- |
| Create/edit/publish; draft privacy and no premature notices | `business.test.cjs` full lifecycle and invalid creation tests; `browser.cjs` actual create/edit/publish controls and MCP snapshot |
| Respond/change/withdraw; missing versus no; reply privacy | Business response/withdraw/permission tests; browser voting and withdrawal; MCP account-replacement/authority checks |
| Confirm/reopen/cancel; preserve one active arrangement | Business lifecycle tests, real MCP lifecycle and browser controls; old meeting becomes superseded/cancelled |
| Full-window evaluation data | `scripts/evaluation.cjs --check` and `tests/evaluation.cjs`; all 24 monthly partitions loaded, queried with permission checks, mutated/reset and reconciled with the coverage report |
| Candidate replacement | Business and browser checks retain inactive slot and old replies, create a new slot without inherited votes |
| Deadlines, clock and DST | Business deadline-equality, past-slot, gap/fold tests; real Infra clock/close event and backward-time rejection |
| Role and object isolation | Real MCP Agent management denial; guessed/forged actor tests; participant backend rejection; direct forbidden HTTP call |
| Read-only behavior and failed-write atomicity | App harness asserts unchanged reads; Core verifier and MCP test compare business data before/after rejection |
| Retry/concurrency | MCP duplicate/conflicting-key tests; two-process competing edits; stale confirmation; browser stale form and lost-acknowledgement retry |
| History/seed/reset/run isolation | Public verifier and App integration checks; distinct run, restarted client, new account binding, reset epoch and replay |
| GUI same-state behavior | Real Chromium clicks, MCP inspection, reload, independent MCP/event refresh, visible error, text escaping, desktop/mobile screenshots |
| No-op/wrong/partial outcomes | `tests/reference-controls.cjs` uses separate runner-side assertions; expected final outcome passes while unchanged, wrong-slot and cancelled final states fail |
| Public package boundary | Common verifier's standalone copy and pinned base-runtime invocation; no imported neighboring App or private source |
| Provenance and realism | Hand-authored fictional records; MIT reuse inventory in README and dataset.json; reviewer judgment remains pending |

## Review boundaries

Automated business, real MCP and real-browser results are separate. A browser test is not a model trial, and an independent base validator is not an independent human reviewer. The public loopback host does not prove production OAuth/TLS or remote user-simulator integration; those modes are excluded from this proposal.

Plan approval, independent human workflow/provenance review, acceptance on the exact commit and final merge belong to the repository's reviewers. The plan was approved on `452314ca5bc7e73132496362cf7c2ab19b540e11`. The `/start-implementation`, `/submit-implementation <full-sha> <evidence-url>` and non-author `/accept-implementation ...` follow the repository lifecycle. Local completion does not authorize self-approval.

Raw run reports and failure analysis are summarized in the repository's Meeting Poll evidence directory. Generated live state, credentials and browser sessions are not committed.
