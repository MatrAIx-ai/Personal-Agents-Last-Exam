# Tablewise: first runnable milestone of #40

This submission delivers **M1** of the approved restaurant proposal. The complete approved scope remains the review baseline; the M2/M3 rows below are incomplete. This report supports first-version delivery and review, with final acceptance owned by a maintainer.

## Scope and policy baseline

- Proposal: `proposals/environment/tablewise-group-dining.md`, approved at `10662e1143e7e0eb17cae7a716c3349bbc250a33`; approved blob `c257399738a7d97bbcb6c00cfb0a816bad5432db`. Its text is unchanged.
- Approval: Jasonya, 2026-11-24T00:17:46Z; first-version deadline: 2026-12-08T00:17:46Z. The later reviewer correction supplies historical activity from 2025-01-01 and a Task window beginning 2026-01-01; fixtures follow that correction.
- [Lifecycle first-version rules](../../review/proposal-lifecycle.md#environment-first-version-deadline) allow a runnable core, representative fixtures/reset, tests, evidence and an explicit remaining-work list. [Implementation review](../../review/app-implementation.md) and its [checklist](../../review/app-implementation-checklist.md) still govern complete acceptance.
- App `tablewise` 0.1.0; public runtime 1.6.0/Core 1.2.0; Mail 1.3.0 for connected reproduction. The package runs independently; Mail is assembled explicitly for its connected example.
- Independently selected published upstream validation revision: `ae889d2cbbfc72242fc5e70b877f3f2a2f029618`. App hashes and actual versions are in [summary.json](summary.json) and the exact-package reports below.
- Before the update, GitHub's PR API reported legacy base `e1bb9aa7eca440ead4d082496f64e4ed4b371732`, which has no public runtime. Validation against that legacy snapshot is **not run**, rather than a compatibility pass. The independent compatible-base check uses the current published upstream revision above. GitHub CI selects its own base and requires maintainer handling if its check cannot run.

## Approved workflow to evidence

| Requirement / mode | Verdict | Actual evidence | Remaining work / owner |
| --- | --- | --- | --- |
| M1: find a venue, read menus and inspect released availability | Passed | Six venues; original registered menu bytes/hash; future stock redacted; local-date and release-boundary tests; actual browser menu/search controls | Full rolling/monthly release-rule calculators and DST scenario corpus: author, M2 |
| M1: hold, exact preview, confirm and simulated deposit | Passed | Protected five-minute holds; $520 two-person estimate / $100 deposit; repeat/expiry/capacity/authority tests; browser write and reload; actual MCP state readback | Waitlists, held offers and subscriptions: author, M2 |
| M1: change/cancel and monetary records | Passed | Failed amendment preserves original; actual deposit credit and balance; cancellation at exact cutoff; pending/partial/full provider refunds; original receipts and browser download hash | Additional no-show/attendance and scenario coverage: author, M2 |
| M1: group inquiry and actual venue response | Passed | Inquiry creates no booking/payment; public source event supplies quote; expected vs guaranteed headcount; quote revision/expiry; $780 eight-person minimum-spend arithmetic | Private-room quote acceptance, menu-specific dietary scope, headcount locks and guest-audience updates: author, M2 |
| M1: Mail text and original receipt file | Passed | Real Messaging delivery and Mail record readback; exact attachment bytes/SHA-256; unchanged-message retry; refused recipient preserves booking; reset preserves receiving Mail state | App-specific unknown-acknowledgement reconciliation and participant sharing: author, M2 |
| M1: Core lifecycle, identity and resource authority | Passed | Real MCP discovery; guessed Infra operations denied; histories/separate runs/reset/persistence; venue-parent resource denial; corrupt asset import rollback | Future scenario bundles with old offers/refunds: author, M2 |
| M1: business GUI | Passed | 11 main-flow checks and 8 boundary checks; actual clicks/forms/downloads, scenario updates and MCP readback; mobile layout | All remaining approved workflows also need App-owned controls: author, M2 |
| Synthetic bounded-overlap profile | Passed | Two permitted active bookings accepted and third rejected; strict profile rejects a start gap below 150 minutes | Full cleanup/backup scenarios: author, M2 |
| Shared-cost allocation/contributions | Not run: unimplemented | No contribution or payment invitations are implied by a participant or inquiry | Author, M2 |
| Three full scenes with six venues and 12–18 source events each | Not run: incomplete | M1 has one six-venue set, 36 sittings, 23 monthly historical outings from 2025-01-01, six original text assets | Author, M2 |
| Optional Calendar, Contacts and Messages paths | Not run | Interfaces remain separate from Tablewise's Mail publication | Author, M2 |
| Human realism, asset/provenance and workflow acceptance | Not run independently | Original data/code source declarations in the App; automated checks and author visual inspection supplied | Maintainer / independent reviewer, M3 |
| Environment model trials and agent-owned wakeups | Not run | No model-agent performance or unattended-task result claimed | Maintainer trial roster/budget and runner scheduling dependency |
| Production HTTPS/OAuth, live restaurant booking/payment | Not applicable to the approved offline M1 | All money/venues synthetic; local stdio/loopback only | Deployment work is separate |

## Reproduce

Node 18+ is sufficient for the business, Core and connected examples. The browser scripts use the root's pinned Playwright 1.56.1 and its Chromium installation. Start from a clean checkout at the submitted commit:

```sh
node --test apps/tablewise/tests/*.test.cjs
node runtime/cli.cjs verify --app apps/tablewise --output .artifacts/tablewise-node22.json
npx --yes --package node@18.20.8 node runtime/cli.cjs verify --app apps/tablewise --output .artifacts/tablewise-node18.json
node apps/tablewise/examples/run-connected.cjs
npm ci
npx playwright install chromium
node apps/tablewise/tests/browser.cjs
node apps/tablewise/tests/browser-audit.cjs
npm test
npm run test:web:browser
node runtime/web/server.cjs --app tablewise --registry apps/tablewise/registry.json --run tablewise-demo --port 8791
```

Use the full access link printed by the Host. Tests use disposable runs and do not reset the user preview. The browser source is App-owned and all business changes use the Agent connection; the Web Host exposes no management route. Its existing direct forbidden-request tests run in the full reference suite.

For an independent base check, create a clean checkout at `ae889d2cbbfc72242fc5e70b877f3f2a2f029618` and use that checkout's original validator:

```sh
node /path/to/trusted-base/runtime/cli.cjs verify --app /path/to/candidate/apps/tablewise --output /path/to/base-runtime.json
```

The actual execution also ran the base's `runtime/ci/verify-submissions.cjs` against all eight affected packages. Other packages passed without changes. The base common validator proves Core/MCP compatibility; its unextended Web Host does not serve the App's optional CSS. GUI reproduction uses the candidate Host extension and separately needs Infra review.

## Results and evidence

- [25 business/runtime/resource checks](business-runtime.tap), including six App-only business checks.
- [Node 22 public verification](public-runtime-node22.json) and [Node 18 public verification](public-runtime-node18.json): 44 common checks each, plus standalone business/example stages.
- [Unmodified published-base verification](base-runtime.json), [base affected-App log](base-apps.txt), [22/22 upstream regression stages](upstream-regression.txt), and [106 browser checks across seven original Apps](upstream-browser.txt).
- [Tablewise main browser report](browser-main.json), [browser boundary report](browser-audit.json), [desktop discovery](discover.png), [mobile discovery](mobile.png), and [quote revision/expiry display](quotes.png).
- [Real connected Mail walkthrough](connected.json): actual message, original file readback, retry/refusal and separate-App reset checks.
- [Machine-readable summary](summary.json); App-owned sources, licenses, commands and limits are in `apps/tablewise/PROVENANCE.md`, `README.md` and `VALIDATION.md`.

The self-review reproduced and fixed stale inventory/search, unreleased stock exposure, UTC/local-date mismatch, resumed-preview duplicate-record failure, retained-deposit balance, stale grant use, hidden dialog errors, invalid headcounts, expired/superseded quote presentation, long venue-cancellation reasons and percentage rounding. The linked checks validate the resulting behavior. Earlier successful reports with different package hashes are superseded.

## Shared changes and review boundaries

1. `runtime/web/server.cjs`: additive support for an optional package-local CSS file at `/app.css`, with the same validated path containment as the page/controller. No Tablewise business logic or management connection was added. The full reference suite and seven-App browser suite pass. **Infra review required.** This is the same small CSS extension used by #6/#42.
2. `runtime/registrations/tablewise.json`: venue resources require `tablewise.venues.document`; missing/restricted parent authority denies the read. **Infra review required.**

No live account state, local access links, credentials or future Task event queues are included. Author-run local evidence supports M1 review. Independent human reproduction, final GitHub CI, full M2/M3 implementation and commit-bound maintainer acceptance remain outstanding. The approved proposal has not been edited or narrowed.
