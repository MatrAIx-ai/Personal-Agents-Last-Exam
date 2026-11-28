# Refund-only Returns v1 validation
Scope: [PALE #7](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/7), approved plan commit `eae4dd2625981deb4776fe2ba452717fb4e41e03`. Implementation and maintenance: Xiao Cui (@2018cx). The approved proposal is unchanged; there are no sibling Apps or integrations.

The shared runtime is Core API 1.2.0 / runtime 1.6.0. The compatibility baselines are current main at `25d559778696dff849bb88fcca03f325185f2599` and the pinned `61b637164e4abddf81536bb48935cdb688a69ff1`. The companion validation capture records the exact candidate, runtime, browser and Node versions and check outputs.

From the App directory:
```sh
# PALE_RUNTIME_ROOT defaults to the checkout's runtime; optionally set it to a different checkout.
node --test tests/business.test.cjs
node examples/run.cjs
node evaluation/recount.cjs
node tests/core.cjs
node tests/web-http.cjs
# Optional driver only; CHROMIUM_PATH may point to a sandbox-capable Chromium executable.
PLAYWRIGHT_MODULE=/absolute/path/to/playwright PALE_EVIDENCE_DIR=/tmp/refund-evidence node tests/browser.cjs
# The same browser suite can also exercise tablet/mobile widths (768 or 390).
PALE_BROWSER_WIDTH=390 PLAYWRIGHT_MODULE=/absolute/path/to/playwright PALE_EVIDENCE_DIR=/tmp/refund-mobile node tests/browser.cjs
```
From the full checkout root:
```sh
npm run app:verify -- --app apps/refund-only-returns
npm test
```

- Business example and tests cover eligibility, date boundaries, allowed cancellation after deadline, repeat attempts and opaque IDs. Strict duplicate rejection stays enabled; separate per-order attempt ordinals distinguish a same-time second cancellation/discard from the first.
- Live Core MCP verified versioned stale and fresh-expiry rejection, exact idempotent replay, per-role and per-run isolation, two reset/replays, and independent full-window and earlier Task loads, status as-of cutoff, public lookup with or without #, and reset. The cutoff is inclusive. There was no real refund or external API use.
- Live Web Host HTTP and browser mode verifies shared Core state, administrative denial, layout and input feedback, same-time reattempts, and complete scene transitions including confirmed state after a stale refresh. See [GUI evidence and reference comparison](evidence/README.md).
- Dataset: see [evaluation instructions and coverage](evaluation/README.md). The evaluation dataset is separate from smoke fixtures; for a Task at an earlier initial time, generate a loadable profile with matching metadata and no future records.
