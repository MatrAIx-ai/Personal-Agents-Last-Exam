# Meeting Poll Web GUI

Run the public PALE Web Host, Node 18+:

```sh
node runtime/web/server.cjs --app meeting-poll --registry apps/meeting-poll/registry.json --run meeting-demo --profile sandbox
```

Open its printed local access link. The Host supplies a fixed Agent session; all controls call declared MCP business tools. It exposes no Infra controls. The five views are the poll list, draft/editor dialog, participant response dialog, organizer overview, and meeting/activity detail. Notifications are application-local receipts, not email delivery.

Create uses named participants and local-time candidate fields with IANA timezone and explicit first/second choice for ambiguous daylight-saving times. Deadline fields accept ISO timestamps with an offset; candidate times display in a selectable timezone. Published participant lists are fixed. Other participants' replies are driven by trusted Infra scenario events, never a GUI impersonation switch.

Forms retain the version observed on opening. An unchanged submission retries the same request ID after a lost response; changed input uses a new ID. Business errors stay in the dialog. Refresh retrieves actual backend state. User text is rendered with text nodes, never HTML. The public Host supplies CSS; no external fonts, media, scripts or tracking are used.

The legacy `view.js` is only a reviewer text renderer. Browser acceptance uses `index.html` and `src/app.js`, never that renderer as a substitute.
