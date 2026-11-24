# Fueltrail Web App

Fueltrail provides five product views backed only by the Agent MCP connection: station search/detail, price alerts and in-App notifications, vehicle profiles, fuel-log history/editor, and fuel-economy summaries.

From the repository root:

```sh
node runtime/web/server.cjs --app fueltrail --run fueltrail-demo --profile sandbox
```

Open the printed access URL. Infra-only seed, event, time and reset operations are never exposed by this page. Optional Mail routing is exercised by the separate integration example because the browser has no trusted router connection.
