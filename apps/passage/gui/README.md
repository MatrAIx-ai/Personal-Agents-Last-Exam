# Passage Web App

`index.html` and `src/app.js` own this App's interface. The shared `runtime/web/client.js` provides forms and the connection; `runtime/web/server.cjs` serves the page and forwards only permitted Agent MCP tools. `src/view.js` is the escaped reviewer renderer.

From the repository root, with a registry that includes Passage (for example the integrator's trip-paperwork registry):

```sh
node runtime/web/server.cjs --app passage --registry registry.trip-paperwork.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only view.

## Product interface

- **I-20 & signature**: the student, school, today's date at the office, the current travel signature (signing date, valid until, valid or lapsed, days left), any request in processing, and every signature on file.
- **My requests**: Travel Signature Requests, newest first, with submission time, the business-day count, the expected date or the signature produced.
- **Request travel signature**: submits the e-form (`passage.travel_signature.request`). Submitting while a request is in processing returns that request and changes nothing.

Processing is an Infra event. The Host connects as the Agent, so the page shows the result but cannot trigger it. The page renders its own panels and does not open a record detail, so it needs no per-record read tool. Only committed data comes from MCP; navigation is transient UI state.
