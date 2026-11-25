# ConfDesk Web App

`index.html` and `src/app.js` own this App's interface. The shared `runtime/web/client.js` provides forms and the connection; `runtime/web/server.cjs` serves the page and forwards only permitted Agent MCP tools. `src/view.js` is the escaped reviewer renderer.

From the repository root, with a registry that includes ConfDesk (the integrator's trip-paperwork registry):

```sh
node runtime/web/server.cjs --app confdesk --registry registry.trip-paperwork.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only view (Preview registration stays available because a preview changes nothing).

## Product interface

- **Registration**: conference dates and venue, whether the author registration window is open, the deadline, the author rate and what it covers, the letter and correction business-day rules and calendar, the paper and its program status, and the registration with its payment.
- **Invitation letters**: the date the first letter is due, each correction request with its expected date, and every letter (current and superseded) as printed.
- **Actions**: Preview registration (a read; the preview ID, rate and expiry appear in the detail pane), Confirm registration (payment labels are offered as choices) and Request letter correction (only the fields to correct).

Opening the window, the deadline and letter issuing are Infra events. The Host connects as the Agent, so the page shows their results but cannot trigger them. Only committed data comes from MCP; navigation and unfinished form text are transient UI state.
