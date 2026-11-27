# Coverline M1 verification

This is the first runnable milestone of approved #46. The proposal is unchanged. Full four-provider/three-scene delivery, broad scenario coverage and independent acceptance remain M2/M3.

```sh
python3 apps/coverline/scripts/build-package.py
node runtime/build-contracts.cjs
node --test apps/coverline/tests/*.test.cjs
node runtime/cli.cjs verify --app apps/coverline --output .artifacts/coverline-public.json
node apps/coverline/examples/run-connected.cjs
node apps/coverline/tests/browser.cjs
node apps/coverline/tests/browser-boundaries.cjs
node apps/coverline/examples/serve-demo.cjs
```

The 21 App checks cover exact premium/fee/installment arithmetic, missing vs zero coverage, pure reads, missing records, sourced profile edits, no self-consent, strict deadlines, revocation, disclosure scope, provider/source/document mismatches, historical reply isolation, version-pinned export bytes, Core retry/version/reset behavior and 48-original capacity with rollback. Four business tests run from the App alone without a runtime sibling. The common verifier copies the package to a disposable assembly containing the public runtime.

The 12 main real-browser checks cover readable side-by-side terms; exact PDF/JSON downloads; saved-collection persistence; browser writes read back through actual MCP; a sourced question/reply and independent provider revision; profile correction requiring renewed trusted consent; amendment and uneven payment schedules; withdrawal preserving history; explicit unknown vehicle facts; and a 390px mobile layout without JavaScript errors. Playwright 1.56.1 / Chromium 141.0.7390.37 are used; root development dependencies and Chromium are required. `PLAYWRIGHT_MODULE` may point to an existing pinned installation.

Eight additional real-browser checks send forbidden management requests directly, reject a stale preview with a visible dialog error and unchanged applications, answer two questions sequentially, hide withdrawn question controls render untrusted saved names literally, submit a fresh application with reload/readback and append a requested coverage revision. Both browser runs record actual Agent/Infra calls, initial state, step expectations, state versions and observed results.

The connected example assembles real Mail 1.3.0 and Files 1.0.0 packages. It verifies the text notice and Messaging retry receipt, original PDF delivered through Mail, exact attachment readback, Files immutable version/hash readback, a pinned comparison export with all four originals, denied recipient with unchanged Mail, controlled acknowledgement loss after a real receiver commit followed by receipt reconciliation, and reset leaving Mail/Files intact. The eight connected steps record calls and real receipts; the acknowledgement fault uses the in-process public router with real receiver MCP clients, not a fake receiver. It is not a fake receiver/client test.

Generated PDFs were rendered and visually checked; originals and matching structured terms are hash-linked. The default fixture has four original assets; the runtime test reaches 48 and checks that the next import preserves all committed records/resources. Export bounds return a capacity error while retaining the saved collection. Files/Mail retain their own public budgets.

Reproducible review evidence is indexed at `docs/validation/coverline-first-runnable/README.md` in the candidate checkout. Runtime state and access tokens stay out of source control. The index records exact App hashes, independent base validator selection, Node 18/22 results and reference-suite regressions. These author-produced runs do not establish independent human reproduction. Human realism/provenance review and any agreed model trials remain pending. The same optional package-CSS Host extension used in #6/#42/#40 and the new document-parent resource map require Infra review. There is no paid model, live insurance account or production deployment claim.

The fresh audit caught and fixed undisclosed input affecting prices, skipped mileage verification, premature completion with multiple open questions, stale withdrawn-question controls and invalid historical disclosures accepted as a seed. Seven review tests include those regressions plus parent-authorized resource denial and corrupt-original import rollback. The before-fix failing report is retained as historical evidence, separately from the final passing runs.
