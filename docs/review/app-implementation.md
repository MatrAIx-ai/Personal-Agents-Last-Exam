# App implementation review

Verify the exact submitted revision against its approved scope. Public business tests, public runtime integration, independent CI/reviewer reproduction, human workflow review and production deployment evidence are distinct judgments.

Use the [App implementation acceptance checklist](app-implementation-checklist.md) to record per-mode evidence. Establish required modes from the original request, approved proposal and review decisions; a promised GUI does not become optional because the implementation contains only MCP or a renderer.

The [submission evidence contract](../submission-evidence.md) specifies original/implemented GUI comparisons and ordered workflow screenshots, live dependency demonstrations, and Environment data coverage. Inspect those artifacts and reproduce the underlying behavior; a screenshot gallery, test count or self-reported date span is insufficient. Record agreed additions when reviewing a previously approved plan.

## Before running code

Record proposal approval/scope, App commit/hash, App/Core API and runtime versions. Inspect entrypoints, scripts, dependencies and file/network behavior. Execute reviewed submissions in disposable environments without production credentials. The reference runtime's temporary directories and policy checks do not contain malicious Node plugins.

Use the public checkout's [commands](../../runtime/README.md). For App-only PRs, repeat common validation with a maintainer-selected base runtime. A change to the candidate's test/validator cannot certify itself; runtime changes need Infra review. Bootstrap with no base runtime is explicitly not run, not a compatibility pass.

## Evidence gates

| Gate | Observable evidence | Failure/control to inspect |
| --- | --- | --- |
| Package and contract | Pinned versions, valid paths, supported schema, declared tools/hooks/events/media; a run from a copy holding only the package, the pinned runtime and pinned dependencies | Missing references, version mismatch, unsupported required schema/extension, declared behavior without a handler; undeclared imports or file reads, hard-coded repository-relative paths outside the package, or access to another App's private implementation/state; works only inside this repository. Pinned runtime and declared public dependencies are allowed |
| Existing App dependencies | Links to reused tools/receive schemas; pinned real participants; demonstration/test of every delivered required or optional connection, including separate Agent reads; actual source use, target records/files/versions/receipts | Missing or incompatible dependency; copied receiver state; sender-only or fake-client success; delivery confused with business confirmation; untested retries/unknown outcomes |
| App-only business | Real App functions tested from the App package without runtime code | Domain failures, invalid input, missing records, duplicate IDs; success tests alone are insufficient |
| Real MCP | Initialize/discovery/call; declared input/output; result matches committed state | Forged role/run arguments; malformed output; mutation during a read |
| Authority | Agent versus Infra, object/field/resource constraints | Agent cannot load history, reset, snapshot or inject even when guessing names; unauthorized parent media inaccessible |
| History and lifecycle | Infra loads Task accounts/history/assets; separate run/App state; reset to loaded baseline | Failed load/event does not partly commit; stale epochs cannot be reused; reset does not reset other Apps |
| Versions and concurrency | Same request/event deduplicates; real persisted receipt/version; concurrent conflict visible | Same key changed content rejected, stale write rejected, competing writes do not silently overwrite |
| Events and time | App-specific transition at supplied virtual time; queryable event receipt | Backwards time rejected; timestamp presence is not a global scheduler or session trigger |
| Environment evaluation dataset | Load/query actual records; verify 2025-01-01 through 2026-12-31 coverage by month/source, real/synthetic provenance, hashes and representative content; real November 2026 data anchors inaccessible website history, with synthetic completion | Endpoint-only coverage, unexplained gaps, filler, synthetic records presented as observed facts, or a report unrelated to loaded data. Small smoke fixtures are not full delivery data; no per-App 300-date minimum |
| Messaging, when declared | Independent directions; real matching receiver/account/grant; actual target state and receipt | Forged source, wrong channel/schema, ambiguous/ungranted recipient, duplicates, reset target and unknown acknowledgement |
| Generic routing | A non-Mail/custom-channel receiver when changing the Messaging runtime | No product-name routing or implicit fallback to Mail; declarations alone do not prove a new business service exists |
| Resources, when declared | Actual bytes/MIME/hash, parent association, missing/oversized cases, loaded assets/reset; file delivery into the receiving App when promised | Cross-App/run/parent access denied; corrupt imports roll back; byte storage does not prove document parsing/OCR |
| Optional diagnostics | App checks/prepared steps, Core persisted outcomes, run/App/call/time correlation | No false commit after persistence failure; retries do not replay business; absent/failing hook leaves results unchanged; no sensitive content or Agent log access |
| GUI, when promised | Original reference screenshots with sources; matching implementation screenshots; ordered core/error workflow sequence; start submitted pages, reproduce controls and verify the same state through MCP and reload | Missing comparisons or sequences; a renderer or presentation-only demo; screenshots substituted for business/MCP tests; backend management exposure; failed actions showing success |
| Human review | Approved flows, realistic variation/errors, readable assets, provenance/licenses | Green automated tests do not establish realism or complete legal/data-source review |

Use **passed / failed / not run / not applicable**, with reason and evidence. Empty messaging directions or absent optional GUI are valid when outside approved scope. A generic checker may need a reviewed adapter for an App without its expected read/event fixture; do not change the App's declared scope just to satisfy that checker.

## Reference commands

```sh
# App-only business evidence
cd examples/apps/mail
npm test
npm run example

# From repository root: real public reference-host verification
npm run app:verify -- --app apps/<app-id> --output .artifacts/<app-id>.json
npm test
```

Add `--with PATH` for pinned dependencies. Reference verification includes Mail, Calendar, independent delivery→Mail, Mail→Mail and custom Noticebox routing. For file-bearing workflows, follow the [attachment guide](../app-attachments.md) and run `npm run example:attachments`: the order publisher sends PDF/ICS to Mail, and an explicit Calendar operation imports the event and attaches the receipt. Check exact receiver bytes, retry/rollback/reset and parent access. These examples exercise their own workflows; they do not automatically validate a newly contributed App or every Task using it.

## Required review report

- Approved scope and exact App/runtime revisions; commands, environment and package hash.
- Workflow-to-evidence mapping: initial state, operation/event, expected and actual result/state/receipt.
- Separate business, common runtime, messaging/GUI/media and manual outcomes.
- Failed checks, missing evidence, unavailable platform capabilities and limitations.
- Reproduction from a clean public checkout; identify any additional adapters/dependencies.
- Recommendation for maintainer acceptance review, with unresolved items visible.

Remote OAuth/HTTPS, restricted service credentials, network controls and official platform/Harbor integration are not established by local stdio tests. Test actual deployment separately when in approved scope. Public source availability does not remove operational authorization requirements.

Keep synthetic review artifacts outside committed live-state folders. Existing CloudEvents source time remains optional; missing time is never replaced with reception time. Prepared steps are not commit evidence, and logging is not universally mandatory unless scope requires it. Approval and merge remain maintainer actions.
