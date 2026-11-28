# Six small fixture variants and controls

These are six independent, authored synthetic hotel situations for the approved F1–F6 environment checks. Each `seed.json` contains **two complete request/reply histories**, produced by the public StayReady plugin from `fixtures/minimal.json`. Each `events.json` contains **six fixed event inputs**: two bootstrap replies already represented in the seed and four future inputs for the control runs. The six future-event sets cover feasible confirmations, provider refusals, unanswered/no-match notices and conservative ambiguous matching.

The generator authors event selectors from known need IDs, exact business conditions and fixed virtual-time windows. It never reads generated request or commitment IDs into a hotel payload. The execution harness may resolve a predecessor ID or preview token through public inspection for an Agent action; those returned values are not substituted into any event.

| Group | Reference outcome | No-action control | Representative incorrect execution |
| --- | --- | --- | --- |
| F1 | Confirm the changed after-midnight arrival and the missing traveler's named step-free route. | Fails: old entrance window and missing personal access remain. | Save the arrival need and inspect lift information without requesting provider arrangements; coverage still fails. |
| F2 | Replace the companion; confirm their two breakfast mornings and access; obtain cancellation of both former services. | Fails: the requested substitution and services are unfinished. | Replace the companion and arrange only breakfast; former services remain and new access is missing. |
| F3 | Recheck only a refreshed breakfast source with the same service fact; retain every suitable promise and make no new hotel request. | **Passes:** the existing arrangements already meet the unchanged service facts. | Resend the covered arrival arrangement; the unnecessary request/disclosure predicate fails even though the old promise remains valid. |
| F4 | Observe received, clarification and refusal as distinct states; a refused cancellation preserves the arrival promise. | Fails: the requested provider decisions have never been obtained. | Withdraw A and submit identical B in one window; replies are ambiguous and cannot decide B. |
| F5 | Reject a preview after disclosure revocation; retain original unrelated promises; explicitly cancel the unavailable route. | Fails: the unavailable commitment remains uncancelled. | Clear the local access need; this does not obtain hotel cancellation. |
| F6 | Consume an unmatched event once, confirm only a later matching request, replay exact events without added effects, and reproduce the business state. | Fails: no later matching arrival promise exists. | Same-window withdrawal/resubmission remains ambiguous and cannot obtain that promise. |

`plan.json` contains evaluation goals and executions. Those labels are outside `seed.json` and are never returned by `stayready.inspect`. All three executions in a group receive the same four future event payloads at the same virtual times. Outcomes are checked from actual request, commitment, disclosure and history records; failing controls contain explicit failed business predicates. The runner validates every seed, regenerates its historical state through the plugin and compares it with the checked-in seed before executing controls.

From the repository root:

```sh
node apps/stayready/examples/fixtures/generate.cjs
STAYREADY_REPORT_DIR=.artifacts/stayready-fixtures node apps/stayready/tests/fixture-controls.cjs
```

The default output directory is `.artifacts/stayready` at the checkout root, outside the App package. The runner writes `fixture-controls.json` plus `fixture-f1.json` through `fixture-f6.json`, containing ordered public business calls/results, unchanged event payloads and matching outcomes, atomic error checks, canonical business-state hashes and complete final snapshots. It does not write or alter the checked-in seeds during a test run.

This harness tests App business functions. Reinitializing the App data is **not** a claimed public Core reset, and the runner does not fabricate transport request receipts, epochs, policies, cross-process persistence or a browser. `tests/mcp-flow.cjs` and its real MCP report separately cover those F6 Core boundaries; the browser report covers GUI behavior. This separation keeps the business control results reproducible without claiming unexecuted host behavior. These environment checks establish observable consequences, not a Task scoring rubric or a claim about model difficulty.
