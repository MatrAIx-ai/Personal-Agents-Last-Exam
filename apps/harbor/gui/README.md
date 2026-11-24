# Harbor Web App

`index.html` and `src/app.js` own this App's interface. The shared `runtime/web/client.js` provides forms and the connection; `runtime/web/server.cjs` serves the page and forwards only permitted Agent MCP tools. `src/view.js` is the escaped reviewer renderer.

From the repository root, with a registry that includes Harbor (the integrator's points registry):

```sh
node runtime/web/server.cjs --app harbor --registry registry.points.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only view.

## Product interface

- **Confirmed, Cancelled**: reservations with confirmation number, dates at the hotel, payment method, locked category, price and the label charged.
- **Points & certificates**: balance, last activity, when points expire, any forfeiture, certificates with their cap and last check-in date, and the ledger.
- **Notices**: booking confirmations, category changes and expiry warnings, newest first.
- **Actions**: Search hotels (a read; results appear under the selected reservation), Book a stay (payment labels and active certificates are offered as choices), and Cancel reservation while it is confirmed.

Transfers in, category changes and expiry are Infra events. The Host connects as the Agent, so the page shows their results but cannot trigger them. Only committed data comes from MCP; navigation and unfinished form text are transient UI state.
