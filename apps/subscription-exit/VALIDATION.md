# Subscription Exit validation
- Approved scope: [PALE #20 design](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/118a5f0665b5c0c9d542a722b4ed73cf371be147/proposals/environment/subscription-exit.md). Implementation and maintenance: Xiao Cui (@2018cx). Proposal unchanged.
- [Implementation review](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/20#pullrequestreview-6094921997): this candidate addresses renewed-period cancellation, distinct same-time previews, full-window synthetic history, a bound-account browser, readable dates and comparison/ordered evidence.
- [Follow-up review](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/20#pullrequestreview-6095914314): six coherent, overlapping, independently loadable histories, entitlement and real action tests per cohort, revised action controls and updated evidence labels.
- [Runtime-cutoff rereview](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/20#pullrequestreview-6096954728): clock-projected evaluation seeds and bundle, UTC and account/history context, matched current-head proof.
- Baselines: public Runtime 1.6.0 / Core API 1.2.0 at 61b637164e4abddf81536bb48935cdb688a69ff1 (pinned) and 25d559778696dff849bb88fcca03f325185f2599 (then-current main). Use the PR's evidence attachment for its exact commit, package digest and verification reports.

From the App directory with an official PALE checkout:

    export PALE_RUNTIME_ROOT=/absolute/path/to/pale/runtime
    node "$PALE_RUNTIME_ROOT/cli.cjs" verify --app "$PWD"
    npm test
    node examples/run.cjs
    node tests/core.cjs
    node evaluation/build.cjs --check
    # With sandbox-capable Chromium and Playwright:
    export PLAYWRIGHT_MODULE=/absolute/path/to/playwright
    export CHROMIUM_PATH=/absolute/path/to/chromium
    PALE_SCREENSHOTS=/tmp/subscription-exit-evidence node tests/browser.cjs

- Public verifier: package/schema, role policies, persistence/reset, App example and business stages. Separate stdio Core test covers both original and renewed exact boundaries, stale version and preview, repeat/abandon at one logical instant, duplicate/conflicting receipts, read-only denial, and resets.
- Browser: sandboxed Chromium clicks with separate Infra and Agent MCP connections. See the [workflow index](evidence/README.md) and PR attachment for expected versus observed, reload, comparison to public product documentation and exact-commit trace.
- Environment data: [UTC coverage and public load/read](evaluation/COVERAGE.md), 100% original synthetic. The Free smoke seed has a matching period end, history and receipt; load it at or after its recorded end. The evaluation builder's `--snapshot` mode emits complete `env.load_seed` arguments from a public Infra snapshot with the matching record count, no hand edits. Task authors should bind exactly one synthetic account per isolated run. Core verifies all six default cohorts and all six accounts at five representative clock cutoffs (including the reviewer’s November 20 example). The test asserts each cohort’s projected entitlement and billing boundaries, then proves the correct cancellation/withdrawal action works for paid accounts and is refused for ended accounts. No real payment, account data, third-party asset, or cross-App dependency.
