# Keelcard v1 evidence

Commands were run from the repository root on Node v22.23.4. Public runtime 1.6.0, Core API 1.2.0. Mail used by the integration test is the packaged Mail 1.3.0. The package hash is omitted here because this file is inside the package, so `app:verify` prints the hash of the tree that includes this report.

## Business tests and example

```sh
node --test apps/keelcard/tests/business.test.cjs
node apps/keelcard/examples/run.cjs
```

`node --test apps/keelcard/tests/business.test.cjs` passed 23 tests, 0 failed. That run includes the runtime case: replay output validates with `duplicate: true`, an empty card is denied with the clock and business data unchanged, one of two competing authorizations is `stale_version` and the retry declines `exceeds_daily_limit`, a repeated wrong code does not add an attempt, and two resets return the same business data.

The copied package used by `app:verify` skips that runtime case because the runtime directory is outside the copy. In that copy the file passed 22 tests and skipped 1.

`node apps/keelcard/examples/run.cjs` printed:

```json
{"app":"keelcard","authorizations":63,"added":"auth-0001","hold_cents":2500,"balance_cents":441170}
```

## Checkout integration

`app:verify` does not run these files. They use the real router, real `env.event_status` and real Mail or Keelcard snapshots.

```sh
node --test apps/keelcard/tests/mail-integration.cjs apps/keelcard/tests/merchant-receive.cjs
```

Mail: 4 passed, 0 failed. The shipped `examples/mail-publisher.json` grant to `mail-maya` delivered a decline and a code. Each Mail message id equals the Messaging `event_id`, and `env.event_status` reported `receipt.status` `committed` for that id. The mailbox was loaded with `env.load_seed`: the packaged messages and assets stay, the owner is `person-grace`, and the account id stays `mail-maya`. A lost acknowledgement was confirmed from that real receipt and a later `publishPending` sent nothing. An oversized notice was `receiver_rejected`, the request stayed open, and a halt with no matching Mail evidence stayed `unresolved`. An empty grant returned `recipient_not_authorized` and left the code in place.

Merchant receive: 3 passed, 0 failed. The publisher and receiver schema bytes match. A granted `channel.card.authorization` publish committed one Keelcard authorization, and `keelcard.authorizations.lookup` returned the decision without the card number or security code. An empty grant returned `recipient_not_authorized` and left the Keelcard revision unchanged.

## App verification

```sh
node runtime/cli.cjs verify --app apps/keelcard
```

Exit 0. Report `passed: true` for app `keelcard` version `1.0.0`, runtime `1.6.0`, Core API `1.2.0`. Business and event-example stages passed. The scenario read, seed load, event commit, duplicate event, reset and a restarted MCP process all passed.

## Repository suite

```sh
node --test runtime/tests/clock.test.cjs
npm test
```

Clock tests: 7 passed, 0 failed. `npm test` (`node runtime/tests/run.cjs`): 22/22 stages passed, including contracts, clock, Mail, Calendar, personal Apps and the business web host.
