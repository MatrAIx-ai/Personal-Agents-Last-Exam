# Coverline: auto-quote environment, M1

Approved proposal #46, preserved unchanged. Original Zebra-inspired comparison UI; fictional insurers, owner, prices and jurisdiction `CL-DEMO`. No insurance recommendation, live record inquiry, policy purchase/binding, premium payment or driving-data enrollment.

Node 18+ and public runtime 1.6.0/Core 1.2.0. From the checkout:

```sh
node apps/coverline/examples/serve-demo.cjs
node --test apps/coverline/tests/*.test.cjs
node runtime/cli.cjs verify --app apps/coverline --output .artifacts/coverline-public.json
node apps/coverline/examples/run-connected.cjs
```

Open the printed access link. Default: port 8792, isolated run `coverline-demo`. The demo starts the public Agent-only Web Host and a separate trusted, deterministic local provider actor. It processes submitted queues at the current virtual time; it never advances time or issues user consent. Existing two-provider quotes and one mileage question are immediately inspectable.

M1 covers immutable sourced profile/coverage revisions, provider/field/purpose/profile-bound disclosure previews and consent, local applications and amendments/withdrawal, provider questions and supplemental replies, versioned readable PDF/JSON originals, quote status/expiry, exact-version comparisons and immutable JSON exports containing original bytes. Mail/Files are connected through their public interfaces in the separate walkthrough. Tools use Core-required `coverline.*`; trusted events retain `auto.*`.

After changing the profile, obtain renewed trusted consent before submitting it. The Agent/browser cannot self-issue a grant. A trusted operator can run `examples/record-consent.cjs --provider insurer-a --source USER_DECISION_REF --confirm` after an actual user decision; grants bind the current immutable profile revision and published required fields. The same applies independently to insurer-b. Unknown facts cannot be answered as confirmed facts. Application amendments use a fresh preview. Original disclosures and historical replies remain in history.

Original quote PDFs use deterministic selectable ASCII text and matching structured terms. The App checks their bytes/hash against its declared synthetic provider contract; it does not parse arbitrary external insurer PDFs or perform OCR. PDF and JSON original resources remain readable after expiry. Exported collections freeze quote IDs, notes and statuses at save time; original expiry timestamps remain visible for later review. Files commits are verified separately.

Remaining M2/M3: the other two providers and two scenes, the complete 8–12 quote/event corpus per scene, broader driver/coverage forms and comparison-editing controls, additional declaration/history documents, broader error/scheduling/eligibility variations, optional Calendar/Finance, independent reproduction and human workflow/provenance review. Environment trial roster/budget and agent-owned wakeups remain maintainer/runner decisions. No full acceptance or model benchmark claim.

The optional package CSS serving extension and `runtime/registrations/coverline.json` parent map need Infra review. Core owns state, versions, idempotency, asset storage and App-only reset. Original PDF/JSON imports are limited to 48 assets / 768 KiB; excess imports fail atomically. Code MIT; original records/assets CC0-1.0. Public Files/Mail contracts and launcher reused under repository MIT. Product reference: https://www.thezebra.com/auto-insurance/; terminology reference: https://www.insurance.ca.gov/01-consumers/105-type/95-guides/01-auto/auto101.cfm. No product code, imagery or customer data copied; this is not a California compliance rule pack.
