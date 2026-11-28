# Home Repair Slots validation evidence
PALE [#5](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/5). Implementation: Xiao Cui (@2018cx). The approved proposal was not changed. [Jasonya's review](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/5#issuecomment-7125438222) identifies the three implementation fixes delivered in `9ae5673`. The [follow-up review](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/5#issuecomment-7237007343) is addressed by the published revision accompanying this index. The original run is documented in the [App README](../README.md). The companion current-revision bundle records the candidate and App tree, verifier version and output, and the Chromium run and frame index. The [November 26 supplement](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/5#issuecomment-7181272937) remains prior-head evidence only.

## Reference and intended differences

| Workflow | Reference | Local implementation |
| --- | --- | --- |
| Compare providers and choose a time | [Publisher's App Store screenshots](https://apps.apple.com/us/app/taskrabbit-handyman-more/id374165361), checked 2026-11-28; [Taskrabbit booking steps](https://support.taskrabbit.com/hc/en-us/articles/46260422073755-How-Do-I-Hire-a-Tasker), checked 2026-11-28 | Choose a fixed service offer in the approved date and all-inclusive price bounds; no real address, provider communication, or payment. |
| Review/confirm, or discard a selection | [Taskrabbit booking steps](https://support.taskrabbit.com/hc/en-us/articles/46260422073755-How-Do-I-Hire-a-Tasker), checked 2026-11-28 | The local preview holds no slot. Normal review has no stray placeholder. A competing Infra event can invalidate a preview; refreshed reconfirmation requires an available slot. |
| Inspect, move or cancel | [Taskrabbit rescheduling](https://support.taskrabbit.com/hc/en-gb/articles/46260501690651-How-Do-I-Reschedule-a-Task), checked 2026-11-28; [cancellation steps](https://support.taskrabbit.com/hc/en-gb/articles/46260428230939-How-Do-I-Cancel-a-Task), checked 2026-11-28 | Change or cancel a local record, preserve cancellation/history, no Tasker agreement, contact, fees or delivery; no sibling app. |

The reference service requires a real signed-in task for private review, status and cancel/reschedule screens. No live task or account was used. These are not matching authenticated booking screenshots. Public help text is not a substitute for all original GUI states. Jasonya accepted this explained public-reference alternative in the follow-up review. External references are linked, not treated as data or redistributed.

## Reproduction and checks
From the App directory:

```sh
npm test
node examples/run.cjs
node ../../runtime/cli.cjs verify --app "$PWD"
node tests/core.cjs
node evaluation/recount.cjs
node tests/evaluation.cjs
PALE_PLAYWRIGHT_MODULE=/path/to/pale/node_modules/playwright CHROMIUM_PATH=/path/to/chromium \
  PALE_EVIDENCE_DIR=/tmp/repair-proof node tests/browser.cjs
```

The browser harness uses root lockfile Playwright 1.56.1 on CI-gated Node 18.20.8 and 22.23.5. Install dependencies and Chromium once on a connected builder, or populate the npm cache and use `npm ci --offline --ignore-scripts` in the root; carry a compatible sandboxed Chromium binary and its operating-system libraries. This is an offline run with provisioned dependencies, not an offline download. Only the loopback Web Host is required.

The service/runtime fallback, stale and invalidated confirmation, restore-on-reset, previous and current booking slot reads and same state across MCP sessions are checked by `tests/core.cjs`. The real Chromium test defaults to a 1280×900 viewport in sandboxed `review-browser`, plus standalone Agent readbacks and Infra snapshot results. Ordered before and after evidence covers the offer table and labelled navigation with a live Bookings count, structured appointment records, readable booked-action dates, lookup, discard, a race after the competing event, reschedule and cancellation confirmations, historical read and reset/reload. Per-step expected and observed evidence goes to `browser/sequence.json` in the companion artifact. Use the current bundle's manifest for exact commit, runtime and browser versions. See the [full-window dataset plus public load/query instructions](../evaluation/README.md) for history and source reporting.

`browser/sequence.json` includes exact role/name locators, before-click frames and indexed after-action frames with observed browser text and independent state. The test blocks external browser requests and fails if any were attempted. Review UI labels are synthetic and are not a screenshot of a Taskrabbit account.
