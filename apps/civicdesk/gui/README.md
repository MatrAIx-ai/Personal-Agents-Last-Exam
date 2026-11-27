# CivicDesk Web App

`index.html` and `src/app.js` own the business pages; the shared public `runtime/web/client.js` supplies the session, discovery, forms and safe text rendering, and `runtime/web/server.cjs` serves the App and forwards only permitted Agent MCP tools. `src/view.js` is the compatible read-only reviewer renderer.

From the repository root:

```sh
node runtime/web/server.cjs --app civicdesk --registry apps/civicdesk/registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Seed, reset and events stay in the separate Infra MCP process; the pages call the same `civicdesk.*` tools as any agent, under the same policy. Pages: docket search (open, closing soon, all), the docket page with its period in the agency's time zone, corrections and documents, the comment form with validation, the review step with the acknowledgment, the receipt, and my comments with status. The Host's Content-Security-Policy allows no inline styles, so `src/app.js` installs the App's presentation rules as a constructed stylesheet. Deep links use the URL fragment next to the access token (`/#docket=<id>`, `/#page=mine&comment=<id>`). `evidence/capture.cjs` drives these pages in a real Chrome and records the screenshot sequences in `evidence/`.
