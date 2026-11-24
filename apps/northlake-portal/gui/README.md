# Northlake Patient Portal Web App

`index.html` and `src/app.js` own the business pages; the shared public `runtime/web/client.js` supplies the session, discovery, forms and safe text rendering, and `runtime/web/server.cjs` serves the App and forwards only permitted Agent MCP tools. `src/view.js` is the compatible read-only reviewer renderer.

From the repository root:

```sh
node runtime/web/server.cjs --app northlake-portal --registry apps/northlake-portal/registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Seed, reset and events stay in the separate Infra MCP process; the pages call the same `northlake-portal.*` tools as any agent, under the same policy. Pages: inbox and thread (messaging), billing ledger, claim detail and statement download. Provider directory, booking and appointment pages are listed as remaining work for the first version.
