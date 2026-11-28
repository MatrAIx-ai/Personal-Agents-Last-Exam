# Brightpath business Web App

From the repository root run:

```sh
node runtime/web/server.cjs --app brightpath-student-loans --run brightpath-web --profile sandbox
```

Open the printed loopback access URL. The five product views use only the fixed Agent MCP bridge: dashboard, loan detail, plan comparison, applications, and status notices. Application edits retain the observed Core and record versions, so stale forms report a visible conflict. Text is inserted through DOM text nodes; no notice or borrower content is interpreted as HTML. No reset, seed, snapshot, event-injection, clock, or router management control is exposed.

Run `npm run test:web` for Host/API boundary smoke and `npm run test:web:browser` for App-specific Chromium clicks, shared-state inspection, conflict/error behavior, event refresh, text escaping, reload, and compact-card layout evidence.
