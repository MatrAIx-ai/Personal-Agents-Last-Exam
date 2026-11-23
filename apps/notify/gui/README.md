# Notify Web App

`index.html` and `src/app.js` own this App's interface. The shared `runtime/web/client.js` provides forms and the connection; `runtime/web/server.cjs` serves the page and forwards only permitted Agent MCP tools. `src/view.js` is the escaped reviewer renderer.

From the repository root:

```sh
node runtime/web/server.cjs --app notify --registry registry.notify.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only view.

## Product interface

- **Upcoming, Fired, Cancelled**: reminders by status with their time, details, whether they need action, and the Calendar event they are anchored to.
- **Lock screen**: every feed item, newest first, with its source, arrival time, whether it arrived silently or was dismissed, and a Mark read button. A banner shows whether the phone is quiet now (focus or silence).
- **Actions**: New reminder (a fixed time, or all four calendar fields), Edit and Cancel while a reminder is upcoming.

Focus windows, silence and dismissal are user actions applied as Infra events. The Host connects as the Agent, so the page shows them but cannot change them. Only committed data comes from MCP; navigation and unfinished form text are transient UI state.
