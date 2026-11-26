# StayReady v1 retained validation

Final local validation was run on **2026-11-26** against StayReady 0.1.0, public runtime/Web Host 1.6.0 and Core API 1.2.0. The exact submitted App contains 187 files and has package SHA-256 **`a8d548f2e9ce0794435f3ce9f7b1853059729eccae32cce7547a0342115b240d`**, using the public verifier's `digestTree` algorithm. Reports are stored outside the App so the tested hash stays stable.

The independent compatible base was checked out from upstream **`6933c430942c64f94874083815829e4a4b20920a`**. Candidate and base validators were executed separately; the runtime, Contacts and Notes source trees are unchanged. The [manifest](manifest.json) binds source and artifact paths, hashes, versions and commands. The [acceptance record](../../apps/stayready/evidence/acceptance.md) maps D1–D6 and the independent M4 review requirement.

| Check | Observed result | Retained evidence |
| --- | --- | --- |
| App-only business | **26/26 passed**, including malformed historical seed rejection | Embedded TAP output in [Node 22 verifier](verify-node22.json) |
| App-only reference/control executions | **18/18 matched their asserted outcomes**: six valid references pass; F3 no-action passes; five other no-action and six incorrect controls explicitly fail their business goals | [Summary](fixture-controls.json), [F1](fixture-f1.json), [F2](fixture-f2.json), [F3](fixture-f3.json), [F4](fixture-f4.json), [F5](fixture-f5.json), [F6](fixture-f6.json) |
| Candidate runtime, Node 18.20.8 | **40/40 passed**, both standalone stages passed | [Report](verify-node18.json) |
| Candidate runtime, Node 22.23.5 | **40/40 passed**, both standalone stages passed | [Report](verify-node22.json) |
| Independent upstream base, Node 22 | **40/40 passed**, same package hash | [Report](verify-base.json) |
| Real Agent/Infra MCP | **64/64 passed**, including unchanged-event reset replay, invalid-seed rollback and concurrent writers/reply-withdraw races | [Result](mcp-flow.json), [ordered arguments/results/snapshots](mcp-trace.json) |
| Same flow on independent base | **64/64 passed**, same package hash | [Result](base/mcp-flow.json), [trace](base/mcp-trace.json) |
| Actual optional Contacts/Notes | **17/17 passed**, exact source account/object/version and unchanged source-state hashes | [Result](dependencies.json), [trace](dependency-trace.json) |
| Full Environment library | **96/96 seeds, 24/24 months passed** public load/query; 1,992 synthetic records | [MCP report](dataset-mcp.json), [coverage and date semantics](../../apps/stayready/evidence/data-coverage.md) |
| Actual browser controls | **38/38 passed**, **34 ordered screenshots**, zero JavaScript exceptions | [Report and screenshot index](browser/report.json), [workflow/reference comparison](../../apps/stayready/evidence/browser.md) |
| Supplementary Chrome operation | Preview → send → reload → withdraw, matched to persisted MCP state | [Report](manual/report.json), [pending after reload](manual/01-persisted-pending.png), [withdrawn](manual/02-withdrawn.png) |
| Existing public platform suite | **22/22 stages passed** | [Report](platform-regressions.json) |
| Generated contracts and dataset hashes | **Passed**; no invalid or out-of-window dates | [Commands and outputs](commands.json) |

The browser runs Chromium 141.0.7390.37 with Playwright 1.56.1, a 1360 × 920 desktop viewport and a 390 × 844 mobile check. The two expected console errors are deliberately injected loss of a committed response and backend denial of a management request (403). The report distinguishes them from page exceptions. Each screenshot entry records sequence, action and expected visible result, with independent Agent/Infra observations in the same report.

The original public references were actually captured on November 26. They provide hotel request, access-route and breakfast workflow facts; **zero real guest records** were collected. The monthly library's 384 represented dates include 96 observation/confirmation dates and 288 service dates, not 384 days of one person's history. See [reference sources and limitations](../../apps/stayready/evidence/reference/README.md). Their acceptability as public-reference alternatives and as the November 2026 factual anchor remains a maintainer decision.

## Reproduce

Use a clean public checkout at the submitted PR head, with Node 22, then repeat the public verifier under Node 18. From the checkout root:

```sh
npm ci
npx playwright install chromium
npm run app:verify -- --app apps/stayready --output .artifacts/stayready/verify.json
node apps/stayready/tests/fixture-controls.cjs
node apps/stayready/tests/mcp-flow.cjs
node apps/stayready/tests/dependencies.cjs
node apps/stayready/scripts/check-dataset.cjs
node apps/stayready/tests/dataset-mcp.cjs
node apps/stayready/tests/browser.test.cjs
npm run contracts:check
npm test
```

The App-only business tests/example are also directly runnable with `npm test` and `npm run example` inside `apps/stayready`. Public verification copies the App into a disposable directory and runs both without a Core or sibling-App tree beside it.

For independent validation, check out the pinned upstream commit separately and call that checkout's `runtime/cli.cjs verify --app /absolute/path/to/candidate/apps/stayready --output /absolute/output.json`. Then run the MCP driver with `PALE_RUNTIME_ROOT` pointing to that independent `runtime` directory. `STAYREADY_REPORT_DIR` and `STAYREADY_BROWSER_REPORT_DIR` choose fresh result directories. No production credentials or paid services are needed.

For manual review, use `npm run web -- --app stayready --registry stayready.registry.json --state-dir .artifacts/stayready-review --run stayready-review`, then open the Host's printed access URL. Business UI access does not grant Infra management privileges.

Local test success is not implementation approval. Required GitHub Actions, current-head review, the public-reference/data decisions and final maintainer acceptance/merge remain separate and must be recorded in PR #44.
