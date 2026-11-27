# Finance validation map

Run from a clean public PALE checkout using the commands in README.md. Reports
and screenshots are generated evidence, kept outside the App package. Commands
exercise supplied reference actions, not a model-controlled policy.

| Workflow | Check | Evidence |
| --- | --- | --- |
| Inspect finances | Business/runtime tests; browser Accounts/Holdings/Activity | Posted cash, expected income, holdings, history and persisted state |
| Transfer | Business/runtime tests and `examples/run-mcp.cjs` | Exact decision, conserved cash, one receipt, original request replay and fresh-process readback |
| Buy/sell | Business/runtime tests and real browser | Cash, quantity, acquisition cost, quote change/expiry denial and receipts |
| Account events | Debit/fee tests and browser | Failed debit with zero cash effect; funded retry; unique occurrence and rule/date; assessed/paid/outstanding fee |
| Mail/Calendar | `examples/run-connected.cjs` | Actual dated Mail notice, trusted revision, approved transfer, created/updated Calendar record, duplicate retry, overlap denial and reset isolation |
| GUI/MCP consistency | `tests/browser.cjs` | Six views, browser writes and MCP readback, refresh/reload, disabled invalid actions and desktop/mobile screenshots |
| Lost response | Business/runtime tests and browser interruption | Backend commits, response is dropped, identical retry produces one financial effect |
| Lifecycle and permissions | Public verifier and runtime tests | Agent/Infra separation, seed validation, isolated runs, reset epoch and restart |
| Fixture reproduction | App business tests | Generators reproduce generated files in a disposable App copy |
| Real data normalization | `tests/market_data_test.py`, invoked by App business tests | Source precision, OHLCV, observation/collection times, unknown delay, stale data and partial/all-provider failures |
| Capture and replay | Runtime tests | Real-source-shaped frames through Infra; captured response hashes; exact replay observations; changed-quote invalidation; mixed-provider/future-barrier rejection |
| Actual external data | Optional `market.cjs collect/live` and `tests/market-browser.cjs` | Actual public provider responses and live/replay GUI checks; retained separately from deterministic tests |

App-only tests use package-local handlers and Python standard-library code.
The public verifier copies the App into a temporary registry and tests its real
MCP service. Runtime tests exercise Finance-specific operations against Core.
Browser checks use pinned Playwright/Chromium and the shared Web Host, with a
separate Infra test client for trusted decisions and events.

Retain runtime/Core/Node/Python/browser versions, source commit and package
SHA-256, exact commands, statuses and logs. Local evidence is under `.artifacts/`;
publish an HTTPS evidence index for the eventual lifecycle command. The index
itself is not proof of correctness.

## Open review

- Reproduction by a non-author reviewer or maintainer.
- Human review of synthetic scenes, GUI and provenance.
- Maintainer decision on Environment model trials and budget; any agreed trials.
- Remote deployment/authentication, which the local host does not supply.
- Final implementation approval and upstream acceptance.

These tests do not establish the proposal's historical claim about earlier
prototype tests, Agent difficulty or model results.

Actual network smoke evidence is optional and kept separate: provider failures
must not fail deterministic default tests or be relabeled as synthetic success.
For browser inspection of already running real-data/replay servers, supply their
printed local access links as `--live-url` and `--replay-url`, plus `--capture`,
to `node apps/finance/tests/market-browser.cjs`. Reports omit access tokens.
