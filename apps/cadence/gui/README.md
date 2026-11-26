# Cadence Web App

`index.html` and `src/app.js` own the business pages; the shared public `runtime/web/client.js` supplies the session, discovery, forms and safe text rendering, and `runtime/web/server.cjs` serves the App and forwards only permitted Agent MCP tools. `src/view.js` is the compatible read-only reviewer renderer.

From the repository root:

```sh
node runtime/web/server.cjs --app cadence --registry apps/cadence/registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Seed, reset and events stay in the separate Infra MCP process; the pages call the same `cadence.*` tools as any agent, under the same policy. Pages: class search and class detail with the two-step booking and the waitlist, reservations with cancellation (free, or late after a fee preview), check-in and rating, the waitlist, and the plan page with the two-step plan change or cancellation. The Host's Content-Security-Policy allows no inline styles, so `src/app.js` installs the App's presentation rules as a constructed stylesheet. Deep links use the URL fragment next to the access token (`/#page=reservations&reservation=<id>`, `/#page=plan`, `/#page=waitlist`). Studio and account pages are the next milestone. `evidence/capture.cjs` drives these pages in a real Chrome and records the screenshot sequences in `evidence/`.
