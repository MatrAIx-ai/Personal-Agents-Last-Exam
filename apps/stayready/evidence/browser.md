# StayReady browser evidence

The packaged GUI uses `runtime/web/server.cjs`, its authenticated session and fixed Agent MCP bridge. `gui/src/app.js` imports the shared DOM, presentation and metadata helpers from `/shared/client.js`, and `gui/index.html` uses `/shared/style.css`. No private server, management API, copied business state or browser fixture loader is added.

Run from the repository root after installing the pinned Playwright dependency and Chromium:

```sh
node apps/stayready/tests/browser.test.cjs
```

The test writes `.artifacts/stayready/browser/report.json` and ordered PNGs in the same directory. Set `STAYREADY_BROWSER_REPORT_DIR` to choose a different output directory. It launches the public Web Host against `stayready.registry.json`, creates an isolated temporary run, and cleans up the run and browser processes after writing the evidence. The report includes Node, Playwright, Chromium and Host versions, viewport, App package hash, static event inputs, observed browser requests, independent Agent MCP inspections, Infra snapshots and receipts, console errors and page errors. The lost-response check deliberately produces a network error after a successful server commit; its second unchanged submission uses the original transport request ID.

## Workflow comparison

StayReady is an original text-only service-arrangement workspace. Its reference-product comparison is about the booking details, special-request, confirmation and history workflows; it does not copy a hotel product's branding or promise visual parity. The implementation intentionally separates a confirmed room reservation, a current local need, a pending request and the hotel's actual terms. An arrival acknowledgment is visibly unconfirmed. A change or cancellation request leaves the earlier promise visible until a valid hotel response changes it. All time fields are explicitly UTC for the fictional fixture property.

The three views reuse the public Host's sidebar, record list, detail panel, metadata rows, tags and dialog layout. The booking view exposes same-headcount companion replacement and route conditions. The needs view shows current and historical personal needs, linked readable sources, authorized service facts and an exact request preview. The hotel record view shows immutable submitted conditions, replies, original promises, current availability and observed history. Backend authorization is rechecked for every operation; the GUI does not contain reset, seed, future-event or management controls.

## Ordered sequence

The report is the authoritative index for the current run's filenames, actions and expected outcomes. The sequence covers:

| Workflow | Browser controls and evidence | Independent state check |
| --- | --- | --- |
| Inspect booking and hotel policy | Open stay → Policies & routes → booking details | Fixed reservation and current people are visible; stepped and step-free routes are distinguished. |
| Maintain a need and companion | Source change → Refresh → Edit need → Save → simulated lost reply → unchanged retry → reload; clear a confirmed breakfast need → reload; Replace companion → confirm → reload | The source fact is saved once; one successful write receipt survives the retry; clearing a local need preserves its hotel-confirmed service; the companion changes with the reservation and headcount preserved. |
| Preview and submit a service request | Preview request → inspect exact disclosure → Send to hotel → awaiting-hotel state | Preview does not change business state or version. A submitted request creates no commitment. Private background is absent from the request. |
| Follow up and manage an arrangement | Refresh after acknowledgment → refresh after confirmation → arrangements; preview change → send → withdraw; preview cancellation → send → refresh after hotel cancellation | Static hotel events match the actual request history. Acknowledgment creates no promise; change/withdraw and pending cancellation preserve earlier promises; confirmed cancellation affects only its selected service. |
| Breakfast with a partial confirmation | Edit and save both breakfast mornings → preview → send → refresh after the prewritten one-day confirmation → inspect arrangements | The immutable request asks for 2 and 3 December. The hotel reply and commitment cover only 2 December; the GUI explicitly retains that narrower date coverage. |
| Invalid, stale and denied operations | Invalid breakfast date; submit an open form after a second Agent writes; preview after source sharing is revoked | Failed operations retain prior business state, display the reason, and do not silently overwrite newer data or create a hotel request. |
| Content, management boundary and mobile layout | Preview a permitted source fact containing literal markup; directly attempt a hidden management request; inspect a 390 × 844 viewport | No script executes or image element appears; private background remains omitted; Host returns 403 for management calls; no horizontal page overflow. |

Screenshots supplement the real controls, MCP inspections and persisted receipts. The independent M4 reviewer still needs to reproduce the evidence against the submitted commit. Local browser success is not an independent acceptance decision.

## Local execution and visual inspection

The retained [browser report](../../../evidence/stayready/browser/report.json) indexes the 34 ordered screenshots beside it. Evidence is stored outside the App package so adding reports does not create a circular package hash.

The 2026-11-26 local run passed 38 browser checks and generated 34 ordered screenshots on Node 22.23.5, Playwright 1.56.1 and Chromium 141.0.7390.37, with the public Host at version 1.6.0. There were no browser JavaScript exceptions. Two expected console errors were retained in the report: the deliberately lost post-commit response and the rejected management request (403).

The booking page, disclosure preview, hotel-confirmed reply, partial breakfast confirmation, cleared-need result, activity history and narrow-screen needs page were visually inspected. The breakfast screenshots visibly separate the two requested mornings from the one confirmed morning, and retain that promise after the local need is cleared. Visual inspection also caught narrow footer buttons before delivery; adding the existing shared `actions` class makes them wrap at 390 pixels. The final mobile check verifies both absence of page overflow and readable action-button dimensions. The final report's package/Host hashes and the submission evidence manifest bind these observations to their tested source; rerun after changes before claiming current-commit acceptance.
