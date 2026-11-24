# Parcel Delivery Manager Web App

`index.html` and `src/app.js` are this App's business page and controller. The shared public Web Host (`runtime/web/server.cjs`, runtime 1.6.0) serves them and forwards only the Agent MCP tools the current policy permits. `runtime/web/client.js` supplies the session, forms and safe text rendering; the stylesheet is the Host's. There is no App-owned server, bridge or stylesheet, and no reviewer-only renderer.

## Start

From the repository root (Node.js 18+, no install):

```sh
node runtime/web/server.cjs --app parcel-delivery-manager --registry apps/parcel-delivery-manager/web.registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. `web.registry.json` lists only this package, so the root `apps.registry.json` is not changed. A new run starts from `fixtures/` at the clock in `fixtures/clock.json`. Starting against existing state never resets it. Use a fresh run with `--profile scenario` for read-only access. Loading a Task's history, injecting carrier events and advancing the clock stay on the separate Infra MCP connection; the page has no such route. To act as a collector or another person, Infra loads that account's ledger into its own run.

## Views

| View | Where | Tools |
| --- | --- | --- |
| Parcel inbox | Active parcels, Needs action, Waiting for carrier, Closed; search | `shipments.list` |
| Parcel details and timeline | Detail pane: plan, pickup point, deadlines, failure or return reason, timeline | `shipments.get` |
| Delivery options and pickup-point directory | Delivery options panel; Pickup points section | `options.get`, `addresses.list`, `points.list` |
| Change review and history | Preview then confirm dialog; pending request with Withdraw; Change requests section | `change.preview`, `change.submit`, `change.cancel`, `changes.list` |
| Collection authorization and pass | Collection panel: own pass, Authorize, Replace, Revoke; Collectors section | `pass.get`, `collectors.list`, `grant.preview`, `grant.create`, `grant.revoke`, `grants.list` |
| Notices | Notices section | `notices.list` |

## Behaviour

- **Same state as MCP.** The page keeps no business store. Every list and detail is read from the App, and Refresh reads it again. A change made through MCP or a carrier event appears after Refresh; a change made in the page is visible to MCP at once.
- **Review before every write.** A change or authorization is first checked by the App (`*.preview`). The dialog then shows the current and requested state and sends the confirmed request. A refused request stays in the form with the App's reason.
- **Versions and retries.** A write carries the version seen when the parcel was opened, so a stale form shows the conflict instead of overwriting. An unchanged request reuses its request ID after a lost response, so a retry has one effect.
- **Unavailable actions are text, not controls.** An option the policy, plan or a deadline rules out is listed with its reason. Under a read-only policy no write control is shown.
- **Time.** Instants are shown in UTC. Whether a pass is valid or a deadline has passed comes from the App (`valid_now`, `passed`), never from the browser clock. After a deadline passes by the clock and before its event arrives, the parcel keeps its status, is marked "Deadline passed" and offers no change.
- **Collectors** see only the parcel they may collect: pickup point, hours, deadline and their own pass.
- **Untrusted text** from App data is rendered as text. The Host's content security policy allows no inline script or style, and the controller uses neither.

## Verify

```sh
node apps/parcel-delivery-manager/tests/web/acceptance.cjs .artifacts/parcel-web
```

Needs Playwright with Chromium (`npm ci && npx playwright install chromium` at the repository root) and Node.js 20 or newer, which Playwright requires; the repository's browser CI uses Node 22. The App's other tests run on Node 18 and 22. It drives the real page for a recipient, a read-only profile, a collector and a failed-delivery-to-return run, and checks each write through independent Agent and Infra MCP connections. It writes `report.json` and screenshots to the given directory. It is browser acceptance, not a model-agent evaluation; the Host is loopback-only and is not a production deployment.

## Not included

No file upload or download (the App has no attachments), no map, no live push (use Refresh), and no in-page switch between people. Native desktop or mobile packaging is out of scope.
