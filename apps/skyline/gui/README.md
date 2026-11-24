# Skyline Miles Web App

`index.html` and `src/app.js` own this App's interface. The shared `runtime/web/client.js` provides forms and the connection; `runtime/web/server.cjs` serves the page and forwards only permitted Agent MCP tools. `src/view.js` is the escaped reviewer renderer.

From the repository root, with a registry that includes Skyline (the integrator's `registry.points.json`):

```sh
node runtime/web/server.cjs --app skyline --registry registry.points.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only view.

## Product interface

- **Trips, Schedule changes, Cancelled**: bookings by status with route, locator, cabin, passengers, points, fee and taxes and the payment label. Each flight shows its seats and the free seats in the booked cabin, with free adjacent pairs.
- **Points**: member number, balance and the ledger, newest first. **Notices**: booking confirmations and schedule changes as sent to Mail.
- **Actions**: Search awards (result shown with option IDs), Book award (option ID, passengers, payment label; seats optional), Save seats per flight, Accept an alternative while a schedule change is open, and Cancel trip.

Sold seats, schedule changes and expiries are Infra events, so the page shows them but cannot cause them. Only committed data comes from MCP; navigation and unfinished form text are transient UI state.
