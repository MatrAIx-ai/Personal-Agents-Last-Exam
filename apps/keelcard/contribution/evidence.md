# Keelcard v1 evidence

Commands were run from the repository root on Node v22.23.4. Public runtime 1.6.0, Core API 1.2.0. Mail used by the integration test is the packaged Mail 1.3.0.

## Business tests and example

```sh
node --test apps/keelcard/tests/business.test.cjs
node apps/keelcard/examples/run.cjs
```

`node --test apps/keelcard/tests/business.test.cjs` passed 14 tests, 0 failed. The copied package used by `app:verify` skips the runtime case because the runtime directory is outside that copy. The same file, run from this checkout, includes that case and it passed.

`node apps/keelcard/examples/run.cjs` printed:

```json
{"app":"keelcard","authorizations":63,"added":"auth-0001","hold_cents":2500,"balance_cents":441170}
```

## Mail integration

```sh
node --test apps/keelcard/tests/mail-integration.cjs
```

3 tests passed, 0 failed. A committed publish stored one new Mail message whose id equals the Messaging `event_id`, and the body contains the code. A second publish of the same notice returned `duplicate: true` and left the message count unchanged. An empty grant returned `recipient_not_authorized` with `stopped: false` and the same code still on the request. A stub `unknown` result with `stop_run: true` stopped after one call and reported `unresolved`.

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
