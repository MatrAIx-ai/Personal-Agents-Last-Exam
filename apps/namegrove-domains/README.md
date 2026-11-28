# Namegrove Domains

Namegrove is a resettable, independently branded synthetic domain registrar and DNS manager. It has no live registry, DNS, payment, WHOIS or network dependency.

## Implemented workflows

- Search six fictional TLDs, compare first-year/renewal prices and policy restrictions, create a 15-minute quote, and explicitly confirm registration with contact, privacy, payment, term and auto-renew choices.
- Inspect a ten-domain portfolio across active, expiring, grace, redemption, transferred and deleted states; renew eligible domains, retry with another saved payment and update auto-renew. Charges use integer cents and `round(subtotal × tax_basis_points / 10000)`.
- Switch hosted/custom nameservers and create, update or delete A, AAAA, CNAME, MX, TXT and CAA records with zone versions, bounded TTLs, conflict checks and before/after revisions.
- Initiate/cancel inbound transfers; unlock eligible domains, issue short-lived outbound codes, and approve/cancel outbound transfers. Registry events drive approved/rejected/completed results.
- Process deterministic lifecycle/payment events to create 30/7/1-day reminders, grace/redemption transitions and exactly one correlated automatic-renewal charge/extension. Reminders never authorize an action by themselves.
- Optionally deliver safe confirmations and reminders to Mail 1.3.0. Registrar commits remain committed if routing fails; unknown acknowledgement blocks redelivery until same-request reconciliation.

Authorization codes are returned only by their issuance call. Business state stores only SHA-256 verification material; ordinary reads and Mail messages omit it. `scripts/sanitize-snapshot.cjs` removes secret fields and secret-bearing Core receipts from reviewer exports. Expired, used, reset or relocked codes cannot authorize an action, even if Core replays an earlier issuance receipt.

## Run and verify

Node.js 18 or later is sufficient; package tests need no install or credentials.

```sh
cd apps/namegrove-domains
npm test
npm run test:web
npm run test:web:browser
npm run example
npm run example:mail
cd ../..
npm run app:verify -- --app apps/namegrove-domains --output .artifacts/namegrove-domains.json
npm test
npm run test:web
```

Start the product UI from the repository root:

```sh
node runtime/web/server.cjs --app namegrove-domains --run namegrove-demo --profile sandbox
```

The five views are Search & register, Domain portfolio, DNS editor, Transfer center and Notifications. They call the same Agent MCP operations as non-browser clients. Infra seed/event/time/snapshot/reset and the trusted Mail router are not exposed to the page.

Regenerate checked-in deterministic artifacts with `npm run generate`; regeneration must produce no diff.

## Events and reset

`examples/event-examples.json` contains one offset-bearing example for each accepted event and its expected transition. `npm run example` demonstrates lifecycle → pending attempt → matching payment outcome → one charge/extension. Task/Infra owns scheduling and passes event time as the Core virtual time.

Reset restores the most recently loaded task baseline—not necessarily the package fixture—and starts a new Core epoch. Compare business data and virtual time, not audit/version envelopes. Resetting Namegrove does not reset Mail. Sanitized pre-reset exports can join App object versions, Core outcomes and supplied execution records by run/App/account plus request/event/object IDs; successful request replay is evidence of one logical action, not a new action.

## Package layout

- `tools.json`, `schemas/`, `plugin.cjs`, `src/`: 24 Agent operations, state/event contracts and business logic.
- `fixtures/`: 6 TLDs, 42 candidates, 10 domains, 5 contacts, 2 redacted payments, 35 DNS records and 5 transfers.
- `gui/`: product browser UI with text-only rendering and visible conflicts/failures.
- `examples/`: event workflow and real Messaging-to-Mail delivery/receipt evidence.
- `tests/`: schema-validated success, invalid input, stale records, duplicate request/event, read-only behavior, atomic failure, isolation, event time, GUI boundary, diagnostics, secrets and Mail reconciliation.
- `contribution/`: interface, provenance, GUI and Mail publishing declarations.

## v1 boundaries

No real purchase/EPP, live DNS, DNSSEC, forwarding, auctions, hosting, mailboxes, certificates, bulk administration, WHOIS/RDAP, disputes, redemption payment or deletion recovery. Redemption/deletion are visible and read-only. Production authentication, remote hosting, durable outbox/retry and maintainer acceptance remain separate work.
