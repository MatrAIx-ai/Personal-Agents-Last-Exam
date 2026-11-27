# Parkstead business Web App

From the repository root, start a fresh writable sandbox profile:

```sh
node runtime/web/server.cjs --app parkstead-parking --run parkstead-web-demo --profile sandbox
```

Open the printed loopback access link. The App supplies product-oriented search,
quote/checkout, reservation modification and cancellation, disruption replacement
or refund, and notification views. Every read and write goes through the fixed
Agent MCP bridge and the same persisted backend state used by MCP clients.

The browser receives no Infra connection or route. Seed loading, event injection,
time control, snapshots and reset remain separate Infra operations. Failed calls,
including stale versions, remain visible in the live status region. Facility and
notification strings are appended as text nodes; HTML is never executed. Parkstead
cards deliberately do not use Notes' `.note-paper` class or its 620px minimum height.

The shared reference Host does not currently expose package assets as arbitrary
static URLs, so the live cards use an App-owned neutral CSS thumbnail while the six
reviewable PNG originals remain verified in `assets/` and the asset catalog.
