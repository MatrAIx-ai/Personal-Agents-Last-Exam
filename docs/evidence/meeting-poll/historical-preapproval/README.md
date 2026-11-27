# Meeting Poll review evidence

The local implementation is ready for technical review against the proposed scope. **Official plan approval, non-author human review and maintainer implementation acceptance have not occurred.** The correct first PR stage is Proposal; the implementation is prepared locally for addition to that same PR after approval.

All final App-specific reports below cover package SHA-256:

`9a5ec7b39fa1523c0e499bfa8a07ca5a78a44d0a6cca1d52ed2272fbb1f8f250`

Public base commit: `61b637164e4abddf81536bb48935cdb688a69ff1`. Runtime 1.6.0, Core API 1.2.0, App 1.0.0, Node 22.16.0, Playwright 1.56.1 / Chromium 141.0.7390.37. Runs are timestamped in UTC inside reports. The separate base source was downloaded from GitHub and its archive commit prefix matches the fetched base; the runtime was not edited to make the App pass.

## Results and commands

| Mode / requirement | Result | Reproduction and evidence |
| :--- | :--- | :--- |
| Standalone business | Passed, 13 tests | `node --test apps/meeting-poll/tests/business.test.cjs`; raw TAP is embedded in [common report](reports/common.json). Covers transitions and negative controls, not just happy paths. |
| Official public MCP verifier | Passed, 38 checks | `node runtime/cli.cjs verify --app apps/meeting-poll --output .artifacts/meeting-poll/common.json`; [report](reports/common.json) |
| Untouched base validator | Passed, 38 checks | Run that same command using the separate base checkout's `runtime/cli.cjs`, with an absolute candidate App path; [report](reports/base-validator.json) |
| App-specific real MCP | Passed, 32 checks | `node apps/meeting-poll/tests/integration.cjs`; [report](reports/integration.json) |
| Actual GUI | Passed, 24 checks | `node apps/meeting-poll/tests/browser.cjs`; [report](reports/browser.json), [desktop](desktop.png), [mobile](mobile.png) |
| Reference controls | Passed | `node apps/meeting-poll/tests/reference-controls.cjs`; [output](reports/reference-controls.log). Correct outcome passes; no-op, wrong slot and cancelled final outcome fail. |
| Public reference regression suite | Passed, 22/22 stages | `npm test`; [summary](reports/reference-runtime.json), stage output under `reports/reference-*.log` |
| Generated business contracts / fixtures | Passed | `node apps/meeting-poll/scripts/contracts.cjs --check` and `node apps/meeting-poll/scripts/fixtures.cjs --check` |
| Documented startup | Passed | `node runtime/web/server.cjs --app meeting-poll --registry apps/meeting-poll/registry.json --run meeting-demo --profile sandbox`; exercised the package-local registry and received HTTP 200 from the public Host |
| Model-agent usability | Final frozen batch passed, 4/4 | `node apps/meeting-poll/tests/agent-smoke.cjs`; [batch](reports/agent-smoke.json) and complete [0](reports/smoke-0.json), [1](reports/smoke-1.json), [2](reports/smoke-2.json), [3](reports/smoke-3.json) transcripts |
| Cross-App delivery / media / production deployment | Not applicable | Explicitly excluded; app-local notifications do not establish Mail delivery or remote authentication. |
| Independent human workflow/provenance review | Not run | Assigned reviewer must reproduce and judge realism/usability. A clean base-validator run is not a substitute for a non-author reviewer. |
| Official plan and implementation acceptance | Not run | Must use the repository's commit-bound lifecycle commands and non-author review. |

App-only tests work without runtime imports. Integration/browser helpers use only the public runtime selected by `PALE_RUNTIME_ROOT` or the enclosing public checkout. The common verifier tests a disposable copy of the package. No neighboring App or private Core implementation is copied into Meeting Poll.

## Agent trial protocol and outcomes

Two fixed model IDs were used: `gpt-4.1-mini-2025-04-14` and `gpt-4.1-2025-04-14`, temperature 0, no parallel tool calls, at most 10 rounds and 1,200 completion tokens per round. Each trial starts with fresh Core state and only Agent-visible tools. The user permits confirmation when Alex answered yes; Sam is optional and the other poll must remain unchanged.

The ordinary scenario requires confirmation of the second slot. In the changed-response scenario, after the model's first poll read, Infra injects Alex's changed response and the user announces the change. The model must reread, use the new version, and confirm the first slot. Hidden grader code, Infra operations, snapshots and the event schedule are not sent to the model. The tests intentionally assess interface usability, not difficult personalized-task qualification.

All four final trials completed with the expected active slot and left the other poll unchanged. The final batch used 31,265 prompt tokens and 533 completion tokens. The runner's intentionally conservative reservation across both attempted batches was US$3.75887; this is a budget estimate, **not an invoice or a statement of current API prices**. API credentials were never written to source or reports. The adapter follows the [official Chat Completions function-tool contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## Retained failures and fixes

- The first model batch had two `ECONNRESET` transport failures before a mini-model completion. The two GPT-4.1 trials succeeded. [The entire first batch](reports/agent-attempt-1/agent-smoke.json), including all four traces, is retained. Those connection failures are not counted as agent reasoning failures. A complete second batch was run; successful trials were not selectively combined across batches.
- The initial full reference suite failed its hard-coded seven-App count after adding an eighth entry to the reference assembly. Meeting Poll now ships its own registry, and the official reference assembly and runtime remain unchanged. The final full suite passed all 22 stages.
- Early integration work corrected manifest resource/lifecycle declarations to match the actual Core profile, limited initial policy selection to Infra, and fixed public Web Host access-link initialization. These were development faults, not accepted compatibility evidence.
- Business review tightened repeat-withdraw behavior: a withdrawn response cannot be withdrawn again as a new logical action. Its negative test is included in the final frozen package.
- Browser inspection found a compressed search field and unpadded details when initially reusing shared CSS. The final GUI uses the host's layout primitives with the timezone selector in the sidebar; real browser controls, mobile overflow and screenshots were rechecked.

## Handoff and maintenance

[The proposal](../../../proposals/environment/meeting-poll.md) defines the scope, [App README](../../../apps/meeting-poll/README.md) explains startup/authority/limitations, and [validation map](../../../apps/meeting-poll/VALIDATION.md) maps each workflow to tests. The dedicated GitHub workflow reruns domain, MCP and browser checks without model credentials; the existing repository workflow runs candidate and base compatibility checks.

The proposal-only commit is prepared separately from the implementation commit so the contributor can follow the required approval sequence. After `/approve-plan <full-sha>`, add the prepared implementation to the same proposal branch, use `/start-implementation`, and submit exact-commit evidence with `/submit-implementation <full-sha> <https-evidence-url>`. A non-author maintainer must accept the implementation before final approval/merge. The first runnable implementation is due within 14 calendar days after first plan approval.
