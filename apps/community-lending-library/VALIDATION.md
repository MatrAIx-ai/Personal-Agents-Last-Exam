# Community Lending Library implementation validation

Follow-up to [the review of 3933b37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/50#pullrequestreview-6096954924). The approved proposal and runtime are unchanged. See the [ordered GUI and reference evidence](evidence/README.md) and [evaluation dataset report](data/README.md).

| Check | Result |
| --- | --- |
| App-only tests and example | Eight business tests cover custody, bindings, date floor, temporal histories and the six shifted fixture presets. The sample queue update shows counts without exposing other members. |
| Official public verifier | Passes against Runtime 1.6.0 / Core API 1.2.0 at current main `25d559778696dff849bb88fcca03f325185f2599` and baseline `61b637164e4abddf81536bb48935cdb688a69ff1`. The evidence ZIP records the verified candidate tree/digests and reports. |
| Independent live MCP | Exact desk receipt IDs, cancelled attempts, stale renewal, rejection/return, nonmutating reads, FIFO at expiry, and reset; full 24-month seed loads through Infra, reads through a separate bound Agent, and resets. Five exact-time snapshots were loaded and queried; a mismatched earlier clock failed before committing. |
| Real local Web Host plus Chromium | 31 ordered screenshots across eight sandbox runs, all five business views, including rejection, stale renewal, overdue/maintenance, cap and waitlist, no duplicate waitlist action for a held item, member-scoped due dates, separate active/past loan, hold and activity lists, and the early-clock evaluation catalog. Separate MCP verifies actual applied state. No page JS errors. |

From the App directory, use an absolute public runtime path:

```sh
export PALE_RUNTIME_ROOT=/absolute/path/to/runtime
npm test
node examples/run.cjs
npm run history
npm run test:core
node tests/host.cjs
node "$PALE_RUNTIME_ROOT/cli.cjs" verify --app "$PWD" --output /tmp/lending-verify.json
PALE_LENDING_SCREEN_DIR=/tmp/lending-screens npm run test:browser
```

`tests/browser.cjs` uses Playwright from `PALE_PLAYWRIGHT_MODULE` (or the standard `playwright` import) and optionally the Chromium/Headless Shell executable supplied in `CHROMIUM_PATH`. It enables Chromium's sandbox; do not disable it to work around unsupported host permissions. All browser and Core test activity involves synthetic local state. The reference comparison is to public myTurn materials only.
