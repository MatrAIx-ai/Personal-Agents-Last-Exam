# Coverline #46 — first runnable version and fresh audit

Checked November 24, 2026 (America/Los_Angeles; November 25 UTC). This delivers the approved **M1**, one sourced owner/vehicle scene and two fictional insurers. It does not complete the four-provider, three-scene M2 corpus or M3 independent acceptance. The approved proposal is unchanged: approved commit `d0b02296463767262e999e19794b8c364bdb4c60`, blob `f734d2f6cdce238b5c6bf34884cd13dbd6f51f5e`.

Audited App source: `aceb3af26ea2f67ef3b900b455d178520bd76ed1`. Exact App tree SHA-256: `9922aa328c2d63b623d7a44ad29b0d0594e0ffdec47fc443ed7fb13386af092b`. All three final public reports and all three workflow traces match this hash. This evidence directory is outside the App tree. The final PR submission commit contains this source plus the evidence; its exact SHA is supplied in the lifecycle comment.

Public runtime 1.6.0 / Core API 1.2.0; Node 18.20.8 and 22.22.0. Candidate Web Host SHA-256: `c27a1b0c90d911cb85cdc2036432dd86e4f267bceec582c4c1f1ec44af434e65`. The separately checked-out, unmodified upstream validator is `7a05aa958c824143ab9eee1aa21c2dfacd8be31a`, selected by the author. This is a different validator checkout, **not independent human reproduction**. Candidate-only changes are optional package CSS serving and Coverline's document-parent registration; both require Infra review. Base GUI styling and the candidate resource map are not claimed as base-Host passes.

## Results by mode

| Requirement / mode | Verdict | Evidence and limits |
| --- | --- | --- |
| Business and actual Core handlers | Passed: 21 | [Final TAP](business-final.tap). Four pure business checks also run from the copied App alone; runtime-backed checks exercise real Core. |
| Public MCP, candidate Node 18 | Passed: 47 common checks plus business/event stages | [Report](public-runtime-node18.json). Discovery, arguments, isolation, history loading, events, reset and persistence. |
| Public MCP, candidate Node 22 | Passed: same 47 checks and stages | [Report](public-runtime-node22.json). Same exact App hash. |
| Unmodified upstream validator | Passed: same 47 checks and stages | [Base report](public-runtime-base.json). No candidate validator substitution; candidate-specific GUI/map review remains separate. |
| Actual browser workflows | Passed: 12 main + 8 boundary checks | [Main report](browser-main.json), [boundary report](browser-boundaries.json). Playwright 1.56.1, Chromium 141.0.7390.37; no page JavaScript errors. |
| Real Mail/Files integrations | Passed: 8 asserted workflow checks | [Summary](mail-files.json), [7 recorded checkpoints with actual MCP calls/receipts](workflow-mail-files.json), [downloaded export](comparison-export.json). Two file-transfer assertions share one checkpoint. |
| Existing runtime regressions | Passed: 22/22 stages on both Node versions | [Node 18 log](reference-suite-node18.log), [structured Node 18 report](reference-suite-node18.json), [Node 22 log](reference-suite-node22.log). The runner uses its default `.artifacts` report directory; retain version-specific copies when reproducing. |
| Original seven-App browser regressions | Passed: 106 checks | [Report](reference-browser.json). Does not count as Coverline GUI evidence. |
| Historical audit reproductions | Failed before fixes: 5/5 targeted counterexamples | [Historical TAP](historical-review-before-fix.tap). Retained intentionally; replaced by the passing final run, which includes two further review cases. |
| Independent contributor reproduction / human workflow and provenance acceptance | Not run | Maintainer/reviewer-owned M3 work. Author automation and a fresh author review cannot satisfy this gate. |
| Full M2 corpus, broad error/scheduling/eligibility coverage, agreed model trials | Not run / incomplete | Four providers, three scenes, full quote/event sets, broader forms/documents and comparison-editing controls remain due under the approved scope. Trial roster/budget needs maintainer agreement. |
| Live insurer access, policy binding/payments, production deployment | Not applicable | Offline synthetic M1; no live accounts, paid model calls or insurance purchase. |

## Workflow records

Each `workflow-*.json` includes the synthetic initial state, App/Host versions and hashes, ordered role/tool/argument/result records, step expectations and observed state/receipts. Join calls by sequence, request/event ID, application/quote ID and Core version. Browser sessions, CSRF/access tokens and credentials are excluded. File base64 in calls is replaced by decoded byte counts; tool metadata retains file SHA-256. The separately attached comparison export contains the original synthetic bytes. [Artifact inventory](artifact-hashes.json) records review file hashes.

Initial Coverline state: Maya Chen, synthetic 2021 Civic, profile/coverage revision 1, annual mileage 12,000, two provider-scoped grants, two submitted applications, Harbor's open mileage question, a conditional $630 all-in six-month Harbor offer and a $660 written Juniper offer. Juniper explicitly lacks rental coverage and has a $1,000 collision deductible. Four original PDF/JSON assets are present. Virtual time is November 24, 09:00 Pacific. Each script uses a fresh disposable run; explicit resets are recorded. Mail/Files start from their public fixtures in the connected run.

| Approved workflow | Actions and expected result | Actual record |
| --- | --- | --- |
| Sourced profile / requested coverage | Change mileage using the obtained odometer source. Append a profile revision; old consent must fail. Set a requested deductible; append coverage without rewriting original offers. Unknown vehicle facts stay explicit. | Main steps 8–9, 11; boundaries step 8. Actual MCP state shows profile 2, new trusted provider consent, and coverage 2 with $1,000 requested collision deductible. |
| Application and disclosure | Preview exact fields, submit a fresh application, reload and inspect the same run through MCP. Stale version must remain a visible dialog error with no new application. Direct management HTTP routes must refuse access. | Boundaries steps 1–3. Matching active applications require amendment or withdrawal; the fresh-submission scenario first withdraws the old Juniper application. New application is pending with a linked immutable disclosure of 12,000 miles. |
| Written terms and originals | Inspect requested versus offered terms, complete cost and actual payments; download PDF bytes and verify their stored hash. Independent provider creates a new written revision after the sourced answer. | Main steps 1–3, 7, 9. Earlier offers remain historical; revised Juniper total is $680 with an exact uneven installment schedule. [PDF rendering](original-pdf-render.png) supplements byte checks; the unchanged original renderer was visually inspected. |
| Questions, requote and withdrawal | Reply with exactly the requested source field; keep other questions open. Only the final answer permits a new written offer. Amend with current consent; withdraw while preserving disclosures/originals. | Main steps 7–10; boundaries steps 4–6. First of two answers leaves `needs_info` and creates no quote; final answer creates one written revision. Withdrawn question has no reply control and MCP reports `withdrawn`. |
| Compare, save and export | Select exact offer versions, save, reload, download a frozen export with requested coverage and four hash-verified originals. Treat an HTML-looking collection name as literal text. Save export through public Files and read its immutable version/hash. | Main steps 4–6; boundaries step 7; connected comparison checkpoint. [Actual export](comparison-export.json) and receiver results are retained. Expiry byte stability and failed/capacity imports are covered separately in final TAP. |
| Mail/Files and reset | Publish actual text and PDF notices through public Messaging; read Mail text/attachments, save PDF and comparison in Files, read exact bytes/version/hash. Denied recipient must leave Mail unchanged; stable message retry must deduplicate. | Connected checkpoints 2–5. Mail PDF and Files version 1 match SHA-256 `0a791c869cdaaa3f5c59a3033dc1756849684aefa92880bcfb6dccdf65de17cc`. |
| Unknown delivery acknowledgement | Drop the acknowledgement only after the actual Mail `env.apply_event` commit. Sender must return `unknown`; reconcile the original event at Mail instead of sending a new message identity. | Connected checkpoint 6 contains actual `env.event_status` committed receipt and `mail.get` result. Fault injection wraps the public in-process router's real MCP receiver client, following the reference runtime test pattern. No fake receiver. |
| App-local reset | Export evidence first; reset Coverline, then read the already-delivered Mail/Files records again. | Connected checkpoint 7: both receivers retain committed records and exact bytes. Core reset/history epochs, corrupt-original rollback and parent authorization also pass final TAP. |

## Bugs found and fixed

The fresh audit found private profile mileage influencing a provider price when that field was not disclosed; a required verification could be skipped; one answer could finish an application with another question still open; withdrawn questions still appeared actionable; and invalid disclosure history could become a loaded reset baseline. A further case showed an unrelated question suppressing the required mileage request. Pricing now uses the actual immutable disclosure plus its supplemental replies. Requests and written stages respect all current questions. Reads close withdrawn/historical/expired questions, and seed validation checks source, grant, application and reply lineage. The provider actor also checks application revision after rereading state. The seven targeted review tests and browser cases above cover these corrections.

## Reproduce

From a clean candidate checkout with Node 18+:

```sh
node --test apps/coverline/tests/*.test.cjs
node runtime/cli.cjs verify --app apps/coverline --output .artifacts/coverline-public.json
node apps/coverline/examples/run-connected.cjs
npm ci
npx playwright install chromium
node apps/coverline/tests/browser.cjs
node apps/coverline/tests/browser-boundaries.cjs
npm test
npm run test:web:browser
node apps/coverline/examples/serve-demo.cjs
```

Use the printed localhost access link; port 8792, App-local persisted `coverline-demo` run. The browser interface cannot issue consent, reset or inject provider events. A separate trusted provider actor processes only submitted queues at supplied virtual time. Obtain renewed actual trusted user consent through the documented operator helper after profile changes. Tests use only synthetic grants and disposable state.

Repeat the public verifier using Node 18.20.8 and 22.22.0. Set `PALE_REPORT_DIR` to separate full-suite reports by Node version. For the base check, create a separate checkout at the pinned base and run **its** `node runtime/cli.cjs verify --app /absolute/path/to/candidate/apps/coverline --output /absolute/path/to/report.json`; do not copy the candidate runtime into that checkout. `PLAYWRIGHT_MODULE` can select the pinned existing Playwright installation. The three workflow scripts regenerate their JSON traces under `.artifacts/coverline-*`. Compare the App digest using `require('./runtime/verify.cjs').digestTree('apps/coverline')`.

This report follows the [implementation review guide](../../review/app-implementation.md), [acceptance checklist](../../review/app-implementation-checklist.md) and [same-PR lifecycle rules](../../review/proposal-lifecycle.md). Submission is M1 delivery subject to review. It is neither maintainer acceptance nor permission to merge.
