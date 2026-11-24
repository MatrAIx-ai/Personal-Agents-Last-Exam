# Waypoint Web App

`index.html` and `src/app.js` own this App's interface. The shared `runtime/web/client.js` provides forms and the connection; `runtime/web/server.cjs` serves the page and forwards only permitted Agent MCP tools. `src/view.js` is the escaped reviewer renderer.

From the repository root:

```sh
node runtime/web/server.cjs --app waypoint --registry registry.points.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only view.

Audience: the member (or an Agent acting for the member) on their own Waypoint account.

## Product interface

- **Points**: the balance, points held in pending transfers, and the ledger, newest first.
- **Partners**: each partner's ratio, increment, delay and the member's own account there, plus transfer bonuses and whether they are upcoming, active or ended.
- **Pending, Credited, Refunded**: transfers and combines by status, with the receipt or rejection once delivery is recorded.
- **Actions**: Transfer to partner (choose a partner and points) and Combine with household (choose a household member and points).

Delivery, settlement, bonus windows and incoming combines are Infra events, so the page shows them but cannot apply them. Only committed data comes from MCP; navigation and unfinished form text are transient UI state.
