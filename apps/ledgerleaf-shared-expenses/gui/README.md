# Ledgerleaf business Web App

From the repository root, run:

```sh
node runtime/web/server.cjs --app ledgerleaf-shared-expenses --run ledgerleaf-web --profile sandbox
```

Open the one-time loopback access link printed by the Host. The five product views use only the fixed Agent MCP connection and the same persisted ledger as direct MCP callers. They cover group and membership management, flexible expense previews/commits/edits/tombstones, balances, settlement plans/records/reversals, revision history and activity. Errors and stale versions remain visible. No seed, reset, event, snapshot or delivery-injection control is exposed. Text is created with DOM text nodes; HTML in fixture notes is never executed.
