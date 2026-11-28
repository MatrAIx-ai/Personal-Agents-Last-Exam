# Namegrove Web App

Namegrove provides five product views backed only by the Agent MCP connection: search/checkout, portfolio/renewal, hosted DNS editing, inbound/outbound transfers and the notification center.

From the repository root:

```sh
node runtime/web/server.cjs --app namegrove-domains --run namegrove-demo --profile sandbox
```

Open the printed loopback access URL. Forms retain the Core/object/zone versions observed when opened, so stale edits show a conflict instead of overwriting newer state. The page constructs text nodes and never evaluates record content as HTML. Infra-only seed, event, time, snapshot and reset operations and the trusted Mail router are intentionally absent.
