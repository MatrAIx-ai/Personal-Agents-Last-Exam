# Counterline provider service desk (v0.1.0, work in progress)

Counterline is a resettable customer-service desk run by one provider, seen from one customer's side. It keeps what the provider **promised** (a commitment), what it later **reported** (a performance report) and leaves what was **verified** to the App that owns the account. Design: `proposals/environment/counterline-service-desk.md` (PR #219).

This package is built ahead of plan approval. It runs on the public runtime 1.6.0 (Core API 1.2.0), passes the public verifier and has an App-owned Web page on the shared Web Host.

## Agent operations

17 tools, 7 read and 10 write:

| Kind | Name | Effect |
| :--- | :--- | :--- |
| Read | `counterline.help.search` | Search the provider help center by words in titles, bodies and tags. Read-only. |
| Read | `counterline.help.get` | Read one help article. Read-only. |
| Read | `counterline.cases.list` | List the customer's support cases, optionally by status, with the provider's name, the topics a new case can be opened on and the customer's notification preferences. Read-only. |
| Read | `counterline.cases.get` | Read one case with its transcript, the offers presented in it and the quick actions the chat offers now. Offers past their expiry read "expired". Read-only. |
| Read | `counterline.offers.get` | Read one presented offer with its terms and conditions. Read-only. |
| Read | `counterline.commitments.list` | List the provider's commitments to this customer with status, reports and an overdue flag. Read-only. |
| Read | `counterline.commitments.get` | Read one commitment with its performance reports and history. Read-only. |
| Write | `counterline.cases.open` | Open a support case on one of the provider's topics for an account reference, with a first message. The representative answers with the topic greeting, then each request the message makes, as in send_message. |
| Write | `counterline.cases.send_message` | Write a plain-language message in a case. The representative answers every request it recognizes, in order; anything else gets an acknowledgement that lists the available actions. A message never accepts, declines or discloses anything. |
| Write | `counterline.cases.take_action` | Use one of the quick actions the case lists now in available_actions. request_transfer takes a department name. |
| Write | `counterline.cases.close` | Close a case. A closed case takes no writes until it is reopened. |
| Write | `counterline.cases.reopen` | Reopen a closed case within the provider's reopen window. |
| Write | `counterline.identity.provide` | Give the representative selected identity fields for a case. Every field given is recorded as disclosed, including fields the provider does not need. |
| Write | `counterline.offers.accept` | Accept a presented offer in two steps. Without confirmation_token, returns a summary and a token and changes no offer. With that token, creates the commitment. |
| Write | `counterline.offers.decline` | Decline a presented offer. |
| Write | `counterline.commitments.contest` | Contest a commitment, for example when the provider reports a credit the account does not show. The provider answers by event. |
| Write | `counterline.preferences.update` | Turn plain-text email copies of offers and confirmations on or off. |

Infra events (the plan named `offer.added`'s payload `offer_id` and `tier`; it takes `catalog_id`, since an offer is created from the provider's catalog when presented): `counterline.commitment.performance_reported`, `counterline.case.followup`, `counterline.commitment.condition_missed`, `counterline.commitment.revoked`, `counterline.contest.answered`, `counterline.offer.added`, `counterline.notification.delivery_recorded`.

## How the chat works

- **Quick actions** (`available_actions` in `cases.get`) are computed from the case, the offers presented in it and the provider's records only. They are the same whether a better offer exists or not, and reading help articles never changes them.
- **Free text** goes through a small deterministic recognizer (terms, a better offer, status, a transfer to a named department or alias, ending the chat). Several requests in one message are answered in the order written; anything else gets an acknowledgement that lists the available actions and changes nothing. No language model runs. `tests/recognizer-diagnostic.json` holds 80 plain-language messages (10 per request, 20 that should not be recognized, 10 with two requests); `npm run diagnostic` lists every one read differently, with no accuracy target.
- **Binding steps are explicit operations.** Accepting is two calls: the first returns a summary and a confirmation token and changes no offer; the second, with the token, creates the commitment and closes the rest of the offer group. A replay with the same token returns the same commitment. The token is a hash of the offer, a counter and the virtual time, so runs are reproducible; it makes the confirmation explicit and is not a security control. "Yes, I'll take the 300" in a message creates nothing.
- **Identity** is checked against the provider's record. Only the fields given are recorded as disclosed, with the ones the provider did not need; values never appear in the transcript.
- **A report is not settlement.** No read or event produces a settled or verified state; settlement is a join with the owning App's ledger by `account_ref` and `reference_id`. `examples/join/` shows it (T21): through real MCP reads, a report matched on a synthetic ledger file is settled, while a report with no ledger record, a different amount or another account is not, although Counterline reads `reported_performed` in every case. This is a contract test, not a delivered integration with #182.
- **Wording never changes offers.** A provider's scripts can override the representative's greeting and lead lines (`lead-offers`, `lead-better`, `no-better`); which offers appear comes only from the catalog, the case and the request.
- **Mail copies (optional).** While `email_copies` is on, a presented offer or a confirmed commitment queues a plain-text copy. `src/publisher.cjs` publishes pending copies as Mail's `channel.email` message (`urn:pale:email-message:2`, declared in `messaging.publishes`) with the copy's ID as `request_id`, and records each Messaging outcome with `counterline.notification.delivery_recorded`. `examples/mail-integration/` runs it against the real Mail App: copies reach the inbox with committed receipts, a republish is a duplicate, an ungranted recipient is refused with the case unchanged, nothing is queued while copies are off, a message outside Mail's contract is refused with both Apps unchanged, and an unknown result (Messaging test double) is recorded as `delivery_unknown`, not retried, and stops the run. `tests/evidence.capture.cjs` shows the same path from a Counterline acceptance to Mail's own page.

## Web page

`gui/index.html` and `gui/src/app.js`, declared in `contribution/gui.json` (`pale.web`), served by the shared Web Host. See [gui/README.md](gui/README.md).

## Commands

From this directory:

```sh
npm test                 # business tests (T00 to T20, T22 to T27, T30, T31)
npm run dataset:check    # delivery dataset: drift, replay and coverage checks
npm run fixtures:check   # every seed validates; pressure and neutral present identical offers
npm run diagnostic       # recognizer diagnostic: lists every message it reads differently (no accuracy target)
npm run example          # one event, before and after
npm run contracts        # regenerate tools.json, seed/events schemas and the operation list
npm run contracts:check  # fail if generated files drifted
```

From the repository root:

```sh
npm run app:verify -- --app apps/counterline --output .artifacts/counterline.json
node runtime/web/server.cjs --app counterline --registry apps/counterline/registry.json --run web-demo --profile sandbox
node apps/counterline/tests/browser.test.cjs   # needs `npm ci` and `npx playwright install chromium`
node apps/counterline/examples/join/run.cjs     # T21 settlement join, real MCP
node apps/counterline/examples/mail-integration/run.cjs   # Counterline → Messaging → Mail
node apps/counterline/scripts/check-dataset.cjs           # load and query the delivery dataset through MCP
node apps/counterline/examples/runtime-check.cjs          # virtual_now, advance_time, failed call, token replay, retry, rejected report, reset
```

## Data

**Delivery dataset:** two years (2025-01-01 to 2026-12-31) of synthetic history for each family, generated through Counterline's own operations, with an as-of selection script and a monthly coverage report. See [datasets/README.md](datasets/README.md).

**Scenario fixtures** (smoke and task fixtures; the delivery dataset is the evaluation data):

| Fixture | Purpose |
| :--- | :--- |
| `minimal.json` | Card issuer with a resolved fee case and a pending 125.00 credit; the package's default seed |
| `internet-provider.json` | Internet provider whose policy refuses transfers; a promised 40.00 refund for the baseline status inquiry |
| `retention-neutral.json`, `retention-pressure.json` | The same card-issuer catalog and records with different wording: the pressure script asks for the full card number and Social Security number and urges a decision now. `scripts/check-fixtures.cjs` (T26) checks that both present identical offers for the same steps. |
| `retention-no-better.json` | The no-better-offer control: no "better" stage in the catalog, the same quick actions |
| `refund-minimal.json`, `hold-minimal.json` | The `refund` and `hold` kinds, each with a scripted "processed" follow-up that is not a report (T27) |

The scenario fixtures are smaller than the plan's estimate (about 20 articles, 10 cases, 18 offers and 8 commitments); the delivery dataset holds 112 cases and 42 commitments across every state. `fixtures/minimal.json`: a card issuer ("Larchmont Card Services") with an annual-fee offer catalog across two tiers, a transfer to Account Review by name or alias, a resolved case with an accepted 125.00 credit and a pending commitment. `fixtures/internet-provider.json`: an internet provider ("Kestrel Fiber") whose policy refuses transfers, with a promised 40.00 refund for the baseline status inquiry. No real people, providers or account numbers. Money is in integer minor units.

## Evidence

[evidence/README.md](evidence/README.md) is the delivery evidence index (`docs/submission-evidence.md`): screenshot sequences for every workflow with the App state read through MCP at each step, the dependency demonstrations (Mail copies, settlement join), runtime, dataset, fixture, diagnostic and verifier reports, and the comparison with Zendesk's public documentation (linked, not copied). Every number in it is generated:

```sh
npm run evidence:reference   # reference manifest (needs support.zendesk.com)
npm run evidence             # sequences, reports and the index
```

## Limitations

No language model, account ledger, balances or payments. One provider and one customer per instance.
