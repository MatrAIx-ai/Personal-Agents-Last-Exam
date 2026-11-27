# Claimline — employee travel expenses

First runnable implementation for approved Environment PR #42. The workflow and
UI reference SAP Concur Expense; company, receipts, policies and interface assets
are original fictional data. No live accounts, bookings or payments are used.

## Open

Node.js 18+; no external services or API keys required:

```sh
node runtime/web/server.cjs --app claimline --registry apps/claimline/registry.json --run claimline-demo --port 8790
```

Open the printed local access link. Expenses, reports, originals, policy findings,
review history and payment totals share the public Agent MCP state. The browser
cannot issue reviewer or payment events. Core supplies persistence, versions,
idempotency, virtual time and App-local reset.

The conference scene has ten expenses, four already saved originals, six
available originals and two dated policy versions. Hotel itemization, missing
receipts and a meal explanation remain visible until the employee resolves them.
Use **Save original**, **Attach receipt**, **Itemize** and **Edit expense**, then
check policy and submit. Company-card business costs, employee claims and personal
liabilities stay separate. No implicit personal-liability offset is applied.

Review and payment enter through a separate trusted terminal:

```sh
node apps/claimline/examples/review.cjs --run claimline-demo --decision returned --reason 'Add the itemized hotel receipt.'
node apps/claimline/examples/review.cjs --run claimline-demo --decision approved --reason 'Checked originals and business purpose.'
node apps/claimline/examples/review.cjs --run claimline-demo --payment pay-1 --amount 8000 --status paid --reason local-payment-proof-1
```

Commands print the exact event and require confirmation. Amounts are USD cents.
Use a new payment ID per installment. Paid IDs are terminal and cannot be counted
twice. Returned reports retain their first submission time; revised submissions
freeze new evidence. Source corrections flag earlier evidence without rewriting
the frozen submission. Reads and invalid actions do not change business state.

## Reproduce

From this App directory, independent of a runtime sibling:

```sh
npm test
npm run example
```

From the public repository root:

```sh
node --test apps/claimline/tests/runtime.test.cjs
node apps/claimline/examples/run-connected.cjs
npm run app:verify -- --app apps/claimline --output .artifacts/claimline.json
node apps/claimline/tests/browser.cjs
```

Browser checks require the repository's pinned Playwright dependency and Chromium.
Generators use Python 3 standard library: `python3 apps/claimline/scripts/build-package.py`,
then `node runtime/build-contracts.cjs`. The business App itself uses Node only.

## Data and interfaces

Public operations are declared in `tools.json`. Core requires the App ID as the
tool namespace, so the proposal's `expense.*` tools are exposed as `claimline.*`.
`claimline.workspace.get` supplies
one current workspace read for the GUI. Receipt downloads use Core's authorized
resource reader. Registration validates exact original bytes/hash and preserves
an optional immutable Files version. Match suggestions never commit themselves.
Structured merchant fields are delivered source data, not image OCR.

Mail 1.3.0 and Files 1.0.0 are run-assembly connections for the connected example;
the App can run alone. That example reads an original attachment from actual Mail,
saves it through Files, registers the original and checks the saved bytes/version.
Review/payment notices have stable source-owned CloudEvents envelopes. Infra
routes them through the public Messaging service under explicit grants and
checks the actual Mail receiver receipt. Sending a notice does not prove delivery.

Original text assets are CC0-1.0; code is MIT. Saved originals deliberately keep
identical bytes under distinct source/receipt parents. The App enforces at most
48 associated assets and 768 KiB; the public Core's broader resource profile is
unchanged. Exports are read-only JSON bytes that can be saved through Files.

Reference: [SAP Concur expense workflow](https://help.sap.com/docs/concur-expense/concur-expense-standard-edition-end-user-help/expenses-and-reports-overview).
No SAP code, logos, screenshots or actual receipts are copied into the package.

## Remaining scope

This delivers M1's single conference scene. Additional 10–15-expense scenes,
timed scenarios, photo/PDF fixtures, richer extraction, optional Calendar and
Finance bridge, independent reproduction and final acceptance remain M2/M3 work.
Advanced OCR, live cards/payments, FX, mileage/per-diem, ERP/payroll and multi-stage
review are outside v1. No model-performance or final acceptance claim is made.
