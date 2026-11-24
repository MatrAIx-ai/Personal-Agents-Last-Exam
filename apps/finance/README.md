# Finance: simulated bank and brokerage

Finance implements the first runnable scope of approved proposal #6. It uses
fictional USD accounts and immediate whole-share fills. Default tests use
original synthetic prices. An optional feed runner collects actual market
observations or replays a frozen capture. No money moves outside the local
simulation. The Agent chooses the plan; the App checks rules and records effects.

## Real market data and offline replay

From the public checkout root, start a separate live-data run:

The default watchlist is VOO, QQQ and VOO's top 30 equity positions from the
October 31, 2026 holdings snapshot. The dated selection and source links are in
`market-watchlist.json`; it does not rebalance automatically. Alphabet's share
classes are separate positions; Berkshire B uses Yahoo's `BRK-B` ticker.

```sh
node apps/finance/examples/market.cjs live --run finance-voo-top30 --port 8787
```

To choose a smaller custom list:

```sh
node apps/finance/examples/market.cjs live --symbols IBM,SPY,QQQ --run finance-live --port 8787 --capture .artifacts/market-captures/live.json
```

Open the printed access link. The trusted runner collects Yahoo's public daily
and 15-minute charts every five minutes by default. The browser refreshes its permitted reads
every 30 seconds while no form is open. The Market view shows ticker, source,
actual quote time, collection time, provider delay when known, raw price and
daily/intraday charts. Unknown delay stays unknown. A live collection is not a
promise of exchange-real-time prices: closed-market observations retain their
actual earlier timestamps.

The financial accounts and fills remain simulated. Source prices are preserved
as decimal strings and rounded explicitly to cents for simulation. A new quote
version invalidates an earlier pending approval, even if its price is unchanged.
Use the trusted confirmation command below with `--run finance-live`.

Capture once without starting a web server, or replay the captured sequence
without any provider/network collection:

```sh
node apps/finance/examples/market.cjs collect --symbols IBM,SPY,QQQ --capture .artifacts/market-captures/frozen.json
node apps/finance/examples/market.cjs replay --capture .artifacts/market-captures/frozen.json --run finance-replay --port 8788
```

Replay defaults to the last recorded frame; `--frame 0` selects the first. Use a
new run to move to an earlier frame. The runner applies recorded frames through
the same Infra event interface and preserves the original availability times.
The replay clock is frozen at that recorded point. It cannot observe later data.

`--symbols` accepts up to 64 distinct USD tickers. `--interval 60` changes live
collection to every minute. Captured history is split into batches of at most
1,440 rows for the public MCP input limit. Each ticker retains up to 120 daily
and 120 intraday observations per collection; increasing the watchlist does not
truncate each ticker to the latest few observations. Time ranges without
distinct available history are disabled. A separate
Alpha Vantage daily demo is available with `--provider alphavantage_demo --symbols IBM`.
It supplies daily reference data, not a realtime entitlement; see the provider's
[documentation](https://www.alphavantage.co/documentation/#daily).

Provider failures stay explicit. Successful symbols remain usable; failed
symbols never receive synthetic fallback quotes. Cached observations retain
their original time and expiry. Changing provider/ticker universe or mixing
synthetic and real data requires a separate run. Existing account activity is
never reset to switch feeds.

Each local capture contains original response text, SHA-256, request URL,
collection times and normalized frames. Import/replay verifies hashes and
provenance links. These are integrity checks, not signed proof of provider
authenticity. Captures are kept under ignored `.artifacts/`, outside the MIT
synthetic dataset. Review provider terms before publishing them. An archive is
bounded to 64 MiB/2,048 frames; when full collection pauses explicitly and the
web page remains available with its last recorded observations. Start a new
capture to continue. Temporary state-lock/read timeouts retry within a fixed
budget. A failed background update is logged and does not close the web page.

This optional real-data extension was added at the contributor's request. It
still needs upstream scope/provenance review; the approved proposal file and
default reproducible synthetic fixtures remain unchanged.

## Open the web app

Requirements: Node.js 18+ and Python 3.11+ available as `python3`. ARE, model API
keys and market-service credentials are not required.

From the public PALE checkout root:

```sh
node runtime/web/server.cjs --app finance --registry apps/finance/registry.json --run finance-demo --port 8786
```

Open the access link printed by the server. The six views are Accounts, Holdings,
Market, Activity, Actions and Receipts. They use the same Agent MCP state as tool
clients. A new run starts at the fixture's simulated time. Wall-clock waiting
does not advance that clock or post transactions. The package-local registry
starts this standalone demo on December 1, when its first quotes are available.
For a combined assembly, Infra selects and synchronizes the participating clocks.

Market uses a large price/chart view with a searchable watchlist, line/candlestick
selection, volume, 1D/1W/1M/available-history ranges and pointer/keyboard inspection.
Only captured observations are plotted; the coverage caption shows the actual
dates available. Candles require source OHLC data. Buy/sell opens a preview for
the selected ticker. Source details remain available below the chart.

Select **Transfer cash**, **Buy shares** or **Sell shares** to create an exact
preview. The Actions view shows its terms, purpose and validity. Previewing does
not move cash or shares.

User decisions use a separate trusted terminal. In another terminal, list
proposals and then review a specific one:

```sh
node apps/finance/examples/review.cjs --run finance-demo
node apps/finance/examples/review.cjs --run finance-demo --proposal proposal-1
```

The second command prints the exact terms and asks you to type `APPROVE`.
Use `--decision reject` to reject. Refresh the web app after a decision, then
execute the approved action. The business browser and Agent tools cannot record
their own approvals. Tasks can supply trusted decisions through Infra events.
The terminal refuses changed state and requires a fresh review.

## Run the checks

App-only checks run from this directory without a runtime sibling:

```sh
npm test
npm run example
```

From the public checkout root:

```sh
node --test apps/finance/tests/runtime.test.cjs
node apps/finance/examples/run-mcp.cjs
node apps/finance/examples/run-connected.cjs
npm run app:verify -- --app apps/finance --output .artifacts/finance.json
```

Real-browser checks need the repository's pinned development dependencies and
Chromium. They use a temporary run and leave screenshots and a report:

```sh
npm ci
npx playwright install chromium
node apps/finance/tests/browser.cjs
```

Browser evidence is written to `.artifacts/finance-web/`. Validation scripts use
supplied actions and decisions. They make zero model calls and do not measure
Agent performance. See [VALIDATION.md](VALIDATION.md) for coverage and open review.

## Business behavior

- Money uses integer cents. Each linked account supports balances from zero to
  9,000,000,000,000 cents. All accounts belong to the bound workspace owner.
- Transfers, buys and sells need exact action-specific approval. The immutable
  preview binds its parameters, instruction revision, relevant account revisions
  and quote ID. Execution checks these bindings, expiry and revocation again.
- Whole-share orders fill at the displayed simulation reference quote (synthetic
  or collected), with no trading
  fees or slippage. Sells reduce acquisition cost proportionally using integer
  cents; selling the full position removes it. Short sales and margin are absent.
- Failed debit attempts remain visible with zero cash effect. Infra supplies
  each recurring occurrence and each retry. A successful occurrence cannot be
  paid again under a new event ID. Expected income stays separate from cash.
- A balance-check event assesses a published rule once per rule and local date,
  at or after its local daily cutoff. A low balance incurs the stated fee. Cash
  pays up to the available amount; assessed, paid and outstanding amounts remain
  separate. A no-fee assessment also closes that rule/date. Automatic later
  collection of outstanding fees is outside this version.
- Quotes, history and announcements expose only observations available at the
  current runtime time. An expired quote is readable but not executable. Real
  market ingestion is an Infra-only operation; Agent reads make no network calls.
- Core owns write versions, request/event deduplication, persistence, locks,
  clocks, snapshots and reset. Python returns candidate business state and never
  writes a separate ledger file. Same-request retries must retain all original
  arguments, including `expected_version`. A receipt describes its original fill.
- A timed-out Python computation retries its identical JSON input once. It has
  no external effects and cannot commit state. Persistent timeout is reported
  explicitly. The web app retries temporary read failures once; financial tool
  writes require an explicit retry with the original request.

## Tools and events

The ten Agent tools are declared in `tools.json`: accounts, holdings,
transactions, obligations and market reads; action preview/get/cancel/execute;
and receipt lookup. Account reads include action and receipt IDs so clients can
retrieve their permitted records after restart. Action reads include current
validity without mutating state.

Infra accepts credits, debit occurrences, balance checks, quotes, announcements,
instruction updates, exact decisions and revocations. Example schedules live in
`fixtures/scenes/*-events.json`; they are runner inputs and never load themselves.
Time advancement alone triggers no financial event or reminder.

`finance.market_imported` accepts a collected snapshot in live/replay runs. It
merges immutable observations, retains quote references used by actions, bounds
the working history, and records ready/degraded/unavailable source status. The
pure business plugin never imports the network collector. Source times and
available times remain separate; corrections are selected only after visibility
filtering. Synthetic quote/announcement events cannot enter a real-data run.

`src/ledger.py` owns action/approval rules. `src/trading.py` handles whole-share
fills and observation visibility. `src/account_events.py` handles account events.
The Node bridge returns `{data, result}` through the public Core plugin hooks.
Python 3.11+ uses the standard library only.

## Fixtures, reset and connections

Regenerate original fixtures and App-owned schemas with:

```sh
python3 -B apps/finance/scripts/build-fixtures.py
python3 -B apps/finance/scripts/build-schemas.py
npm run contracts:build
```

Each of three Finance scenes has three accounts, one to three holdings and 12
historical transactions. The scenes share six instruments, 360 price bars and
12 announcements. Each has six Mail messages and three Calendar events for the
optional connected assembly. Opening balances already include historical effects.
No external price records or prototype assets are copied.

Finance runs independently. The connected example explicitly enables Mail 1.3.0
and Calendar 1.3.0, loads synthetic records through Infra, and authorizes the
reminder workflow in that demonstration. The Agent reads the real notice and
creates/updates Calendar through its tools. Finance has no Messaging directions.
It never edits Mail or Calendar state directly.

`env.load_seed` loads a history and establishes its baseline. `env.reset` restores
that App's baseline and clock in a new epoch. Persisted runs can restart. Export
evidence before reset. Finance reset leaves Mail and Calendar records intact.

## Review still needed

This is a runnable implementation for review, not accepted work. A maintainer or
contributor who did not build it must reproduce essential flows and review data,
GUI behavior and evidence. Environment model-trial requirements and budget still
need the M0 maintainer decision. No paid trials or final acceptance are claimed.
The approved proposal file remains unchanged.

See [PROVENANCE.md](PROVENANCE.md) for the source inventory. Transfer queues,
business-day processing, account closure and standing investment grants retain
the proposal's deferred scope.
