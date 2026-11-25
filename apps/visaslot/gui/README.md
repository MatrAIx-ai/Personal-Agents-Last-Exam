# VisaSlot Web App

`index.html` and `src/app.js` own this App's interface. The shared `runtime/web/client.js` provides forms and the connection; `runtime/web/server.cjs` serves the page and forwards only permitted Agent MCP tools. `src/view.js` is the escaped reviewer renderer.

From the repository root, with a registry that includes VisaSlot:

```sh
node runtime/web/server.cjs --app visaslot --registry <registry including apps/visaslot> --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only view.

## Product interface

- **Booked, Held, Cancelled**: appointments with the consulate, slot time, version, visa file version, history and, once held, the check result with each missing item.
- **Actions**: Find slots (a read; slots with their versions), Checklist (a read), Book a slot (consulates offered as choices), and on a selected booked appointment Reschedule and Cancel appointment with the appointment version prefilled, plus Visa file (a read: the registered documents, earlier versions and what would be missing if held now).

The visa file is registered through MCP with `visaslot.file.submit`; the shared form builder has no editor for its nested accommodation list. Slot changes by other applicants, consulate cancellations and the appointment check are Infra events. The Host connects as the Agent, so the page shows their results but cannot trigger them. Only committed data comes from MCP; navigation and unfinished form text are transient UI state.
