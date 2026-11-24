# Gustline Web App

`index.html` and `src/app.js` are Gustline's own pages; the shared public Web Host (`runtime/web/server.cjs`) serves them and forwards only the Agent MCP tools the run's policy allows. `src/view.js` is the compatible reviewer renderer.

From the repository root:

```sh
node runtime/web/server.cjs --app gustline --registry apps/gustline/registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. `apps/gustline/registry.json` lists only this package, so the Host can serve it without a change to the repository's `apps.registry.json`; adding Gustline there is a one-line change if maintainers prefer it. As with the other Apps, the Host initializes a new run with the synthetic fixture and never resets existing state. Seed, reset and scenario events stay on the separate Infra MCP connection; the page has no route to them.

## Pages

- **Saved places** (sidebar, the default first): official alerts with their version history, the latest observation, current AQI with its averaging basis, daylight, the air-quality forecast, the next hours and days from the current issuance, and the issuance history. Rename, make default, remove, or start a rule for the place.
- **Rules:** every rule, including deleted tombstones, with its revision history. Create, edit (only changed fields are sent), pause, resume and delete.
- **Notifications:** newest first, filterable by status, with delivery outcome and read state; mark as read.
- **Find places:** search the gazetteer and save a place under your own label.
- **Settings:** units, your time zone and the default place.

Times are shown in the zone Gustline rendered them in (the place's zone), not the browser's.

## How it talks to the App

Gustline's records are keyed by `place_id`, `rule_id` and `notification_id`, so the controller has its own small transport instead of the shared `mount()`, which expects an `id` field. It keeps the shared rules:

- every value shown comes from a Gustline read on each refresh; there is no browser-side business store;
- a write carries the version observed when its form opened, and a stale form reports the conflict instead of refreshing over it;
- an unchanged retry reuses its `request_id`, so a lost response does not repeat a committed effect;
- App text is inserted as text, never as HTML.

Styles beyond the shared stylesheet come from a constructed stylesheet, so the Host's content security policy is unchanged.

## Browser check

```sh
npm ci && npx playwright install chromium   # once
node apps/gustline/tests/browser.test.cjs
```

It drives real clicks and form entry and checks every write in the App state through a separate Infra MCP connection: create, edit, pause, resume and delete a rule; save, rename and remove a place; change settings; mark a notification as read. It also checks reload persistence, a scenario event seen after Refresh, a stale form, a retry after a lost response, text escaping, a refused direct management request, the narrow layout and JavaScript errors. Screenshots and `report.json` go to `.artifacts/web/gustline/`.
