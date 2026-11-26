# Northlake Patient Portal Web App

`index.html` and `src/app.js` own the business pages; the shared public `runtime/web/client.js` supplies the session, discovery, forms and safe text rendering, and `runtime/web/server.cjs` serves the App and forwards only permitted Agent MCP tools. `src/view.js` is the compatible read-only reviewer renderer.

From the repository root:

```sh
node runtime/web/server.cjs --app northlake-portal --registry apps/northlake-portal/registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Seed, reset and events stay in the separate Infra MCP process; the pages call the same `northlake-portal.*` tools as any agent, under the same policy. Pages: inbox and thread (messaging), billing ledger, claim detail with the two-step payment, and statement download. The Host's Content-Security-Policy allows no inline styles, so `src/app.js` installs the App's presentation rules as a constructed stylesheet. Deep links use the URL fragment next to the access token (`/#page=billing&claim=<id>`, `/#page=statements&statement=<id>`). Provider directory, booking and appointment pages are the next milestone. `evidence/capture.cjs` drives these pages in a real Chrome and records the screenshot sequences in `evidence/`.
