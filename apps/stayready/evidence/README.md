# StayReady implementation evidence

This is the delivery evidence for StayReady 0.1.0 in PR #44, revised in response to [Chenngzz’s November 28 implementation review](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44#pullrequestreview-6094923977). The approved proposal at `8186a72bd0a5d2f837476db163ab75e36ed61233` is unchanged. The App reuses the existing plugin/Core/Web Host and reset plus ordered replay.

The [run summary](runs/summary.json), [manifest](runs/manifest.json) and [commands with actual outputs](runs/commands.json) record results, versions, input hashes and artifact hashes. All retained evidence now lives inside the App; no new top-level evidence directory or root registry is required. The large ordered MCP traces are losslessly compressed, not truncated. Read them with `gzip -dc PATH.json.gz`.

| Evidence | What it establishes |
| --- | --- |
| [Acceptance record](acceptance.md) and [review response](revision-2026-11-28.md) | Approved scope, item-by-item revisions, separate acceptance decisions |
| [Node 18 verifier](runs/verify-node18.json), [Node 22 verifier](runs/verify-node22.json), [independent base verifier](runs/verify-base.json) | Package/contracts and real runtime checks; standalone business tests and example |
| [Isolated delivery summary](runs/summary.json), [actual CLI startup](runs/package-start.json) | Browser and MCP execute with only StayReady, public runtime, Contacts and Notes; no root package.json, root registry or other Apps |
| [MCP result](runs/mcp-flow.json), [complete ordered trace](runs/mcp-trace.json.gz), [base result](runs/base/mcp-flow.json), [base trace](runs/base/mcp-trace.json.gz) | Fixed-event reset replay, complete-history matching, invalid-seed rollback, isolation and concurrent write/reply-withdraw receipts |
| [F1–F6 reference and control results](runs/fixture-controls.json) | Six valid references and twelve controls; no action is correct for already-covered F3. Complete traces: [F1](runs/fixture-f1.json.gz), [F2](runs/fixture-f2.json.gz), [F3](runs/fixture-f3.json.gz), [F4](runs/fixture-f4.json.gz), [F5](runs/fixture-f5.json.gz), [F6](runs/fixture-f6.json.gz) |
| [Contacts/Notes results](runs/dependencies.json), [complete trace](runs/dependency-trace.json.gz) | Real public reads, explicit source grants, actual downstream request, missing/denied/incompatible and unknown-result retry checks |
| [Browser report and ordered screenshots](runs/browser/report.json), [workflow explanation](browser.md), [references and pairings](reference/README.md) | Actual controls, expected and observed per-frame results, state correlation, local times, readable text, failures, persistence and isolation |
| [Coverage](data-coverage.md), [dataset declaration](../datasets/declaration.json), [all-seed MCP report](runs/dataset-mcp.json) | Varied synthetic scenarios over 24 months, prior requests/replies, exact distribution and actual loading/query |
| [Platform regression report](runs/platform/summary.json) and upstream Mail reset command in [commands](runs/commands.json) | Public platform suite and the newly merged reset regression |
| [Notices](../NOTICES.md) | Original code/data license and separate reference-publisher material |

## Hash scope and isolation

A report cannot contain its own full-package hash. `scripts/validate-delivery.cjs` copies **every App file except generated `evidence/runs/**`** to a disposable package and computes the public verifier’s ordinary `digestTree` on that exact input. There are no additional file exclusions. Documentation, reference images, schemas, tests, fixtures and all evaluation seeds are included. The manifest lists each input’s exact path, size and SHA-256, then separately lists every retained output artifact except the manifest itself.

Thus `input_sha256` and the reports’ `package_sha256` bind the isolated verification input, **not the final Git tree containing those reports**. The current PR commit binds the complete delivered tree. Run `node apps/stayready/scripts/check-evidence.cjs` to verify that all current non-report App bytes and all retained evidence still match. A direct public verifier against the final checkout legitimately reports a different full-package hash because it also includes the reports. No shared runtime hashing rule is changed.

## Reproduce the delivery

Use Node 22, a Node 18 executable, Playwright 1.56.1/Chromium, and a separate checkout of upstream `25d5597` for the independent validator. From a public checkout:

```sh
npm ci
npx playwright install chromium
STAYREADY_BASE_REVISION=25d5597 node apps/stayready/scripts/validate-delivery.cjs \
  --node18 /absolute/path/to/node18 \
  --base-runtime /absolute/path/to/independent-base/runtime \
  --output /tmp/stayready-new-evidence
node apps/stayready/scripts/check-evidence.cjs /tmp/stayready-new-evidence
```

Choose a new, empty output directory each time. The script creates and removes its own isolated package directory, runs candidate Node 18/22 and independent-base validation, App-only tests/example, fixture controls, real MCP on both runtimes, real dependencies, all evaluation seeds and the actual browser. `NODE_PATH` supplies the pinned browser-test package; this is developer tooling, not a hidden application dependency. Platform regressions run separately from the full public checkout because that suite intentionally tests the platform’s other examples. Reproduction requires no guest credentials, paid services or real reservations.

To retain a new run after successful verification, replace only `apps/stayready/evidence/runs/` with the generated output, then repeat `check-evidence.cjs`. This keeps source inputs stable and exposes any later source or report changes. Browser-only runs support `--output`; the documented GUI startup is in the [App README](../README.md).

## Acceptance boundaries

Author tests, independent reviewer reproduction, CI and maintainer acceptance are separate. The synthetic dataset needs no real-data anchor, as clarified in the November 28 review. Public original-product screenshots now strengthen the GUI comparison; the remaining inaccessible workflow states and their proposed alternatives are explicitly listed for maintainer judgment. A request or receipt is never treated as a hotel commitment, and local browser automation is not a model-agent benchmark or production deployment.
