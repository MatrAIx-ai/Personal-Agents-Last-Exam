# Language Study Workspace: complete standalone candidate

A synthetic PALE environment for [PR #51](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/51). Three decks and 36 original text cards exercise card editing and suspension, plan preview/save, a persistent review cursor, explicit learner ratings, auditable undo, and changes to a card answer or deadline. Implementation and ongoing maintenance: **Xiao Cui (@2018cx)**.

## Reproduce

Use Node 18 or 22 and the public PALE Runtime 1.6.0 / Core 1.2.0 from upstream commit `61b637164e4abddf81536bb48935cdb688a69ff1`. The original design was approved at `126502f9972740e2b9d9777d300825a547e9d83f`. This candidate follows the on-time v1 `f5653d8a5a58edd22691ea60bcf82d70d63d1348`, without changing the approved proposal or vendoring the runtime. Start with a **fresh synthetic run** because the expanded seed schema changes fields; do not use existing v1 run data here.

From this App directory, with the pinned upstream checkout at `$UPSTREAM`:

```sh
export PALE_RUNTIME_ROOT="$UPSTREAM/runtime"
npm test
node "$PALE_RUNTIME_ROOT/cli.cjs" verify --app "$PWD" --output /tmp/study-verification.json
node tests/core.cjs
node tests/full-core.cjs
node tests/host.cjs
node tests/host-full.cjs
# Optional automated equivalent on an executor with the pinned upstream Playwright and launchable Chromium:
PALE_PLAYWRIGHT_MODULE="$UPSTREAM/node_modules/playwright" node tests/web.cjs
```

The optional browser wrapper starts Chromium with its sandbox enabled. Manually driving an already-running Chromium through the actual pinned Web Host is a separate test route. To reproduce manually, place the App at `apps/study` in a disposable pinned upstream checkout and run from that checkout's root:

```sh
printf '%s\n' '{"schema_version":1,"initial_time":"2027-01-08T00:00:00+08:00","apps":[{"app_id":"study","version":"1.0.0","path":"apps/study"}]}' > study-local.registry.json
node runtime/web/server.cjs --app study --registry study-local.registry.json --run study-preview --profile sandbox --state-dir /tmp/study-preview-state
```

Open the printed loopback link. Use a second `scenario` profile run for observer tests and a separate Agent connection to establish authoritative read-back. Only separate Infra may load history, advance time, apply the two events or reset. Follow the [browser test checklist](tests/FULL_GUI_VALIDATION.md) and the [Core evidence and six scenarios](BACKEND-VALIDATION.md). A second fixture contains two seeded historical reviews.

## Delivery evidence index

- **Business workflows and GUI:** [ordered Chromium evidence and independent Core readbacks](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/51#issuecomment-7204134192) for reviewed App code `3442ef7113b2c988fae2e7536f668893380e0765`. This data-only addition does not change the UI or the default fixtures.
- **Full-window history v1.0.0:** [provenance, loading and rerun instructions](data/history-v1/README.md), [scope approval and reviewed App code revision](data/history-v1/scope.json), [monthly/source counts and SHA-256s](data/history-v1/generated/coverage.json), [activity ledger](data/history-v1/generated/activity.jsonl) and [opt-in load payload](data/history-v1/generated/load-seed.json). Covers all 24 months of 2025–26: 675 reviews on 408 dates, entirely synthetic. Use the separate public Infra/Agent MCP check to validate, load, query and reset the delivered bytes. The normal smoke run is unchanged.

## Local results, by mode

| Mode | Result |
| --- | --- |
| App business / public verifier | Passed six Node business tests and all 42 pinned public verifier checks and its two runnable stages. |
| Core stdio and HTTP Web Host | Passed isolated synthetic runs, approved card/plan/session/undo/target scenarios, seeded history load, receipt and replay, independent read-back, management route denial and repeat reset. |
| Real Chromium, editor and observer | Passed the actual loopback Web Host interaction path below, including reload and denied changes. This was not an automated CI run; no separate launcher success, production authentication or model-driven study is claimed. |
| Official independent review and CI | Not established by local evidence. Review the exact PR commit and required checks separately. |

**Observed browser trace.** Discard a card edit, save a new prompt for C1, suspend and restore it; the queue hides it only while suspended. Preview a changed target; editing the draft invalidates the old save control, and discard retains day 10. Save day 8, then a concurrent Agent saves day 9 while a day‑7 draft is open; the old form is refused and reload shows day 9. Close a revealed answer without rating. Pause C1, refresh to observe the same paused cursor, resume and explicitly select Good. History records C1 due day 3. Cancel undo once, then undo; the sole row is preserved as Undone and the review slot is restored.

An Infra versioned correction changes the C1 answer while its older browser form is open. That form is rejected; after refresh the corrected answer appears and the ledger remains unchanged. A deadline event changes P1 to day −1, shows three missing slots and a source notice, and leaves caps 3/1 and the audit ledger unchanged. Create a separate synthetic card and read it back. The distinct observer run can reveal but does not offer rating, editing or plan-save actions. Two Infra resets restore original business data and clock, with another run unchanged. Backend tests cover same-request replay; deliberately dropping a browser network reply was not performed in this manual sequence.

## Behavior, provenance and limits

The fixed UTC+08 calendar starts 2027-01-08. Eligible due cards precede eligible new cards. Again resets to stage 0; Good advances up to stage 3, and delays are 1/3/7 study days. One effective review per card and day, subject to daily and new-card limits. Undo reverses only the current day's latest effective review and retains its audit record. Capacity estimates one next needed review per relevant card by the inclusive target, not proficiency. The App does not infer a rating or authenticate human origin; a user or task must supply it explicitly.

No real accounts, live notification, media, external runtime service, or third-party deck content is included. Original source and synthetic fixtures are released under [MIT](LICENSE); reuse notices are in [UPSTREAM-NOTICE](UPSTREAM-NOTICE). Anki is a public interaction reference only. No production deployment or final maintainer acceptance claimed.
