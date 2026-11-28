# Ribbonwell page

`index.html` and `src/app.js` are Ribbonwell's business page. The shared `runtime/web/server.cjs` serves them and forwards only the Agent MCP tools the run's policy allows; the page has no management route. `src/view.js` is the plain reviewer renderer.

```sh
node runtime/web/server.cjs --app ribbonwell --registry apps/ribbonwell/registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only policy. Seeds, events, clock and reset stay on the separate Infra MCP connection.

Views:

- **Wish lists.** Every list in the member's groups. On the member's own list the page says that claims are hidden and shows none; on other lists each item shows what is left and who holds a claim. Buttons per item: Edit, Remove or Restore on lists the member owns or manages; Reserve elsewhere.
- **My claims.** The member's reservations and purchases with status, hold end, private note, exchange tag and anything the owner changed since. Buttons: Edit claim, Mark purchased or Back to reserved, Release.
- **Gift exchanges.** Status, dates, budget, participants, the member's own giftee and, for the organizer, whether a draw is ready. Buttons: New exchange, Join or Leave, Edit exchange, Run the draw.
- **Notifications.** The in-App log, newest first.

How it behaves: the controller uses its own small transport over the Host's `/session`, `/api/tools` and `/api/call`, because Ribbonwell's records are not one collection keyed by `id`. Each write opens a form that keeps the version read when it opened; if anything changed since, the form shows the conflict and saves nothing. An unchanged retry reuses its request ID, so a lost response cannot repeat an effect. Buttons appear only for tools the policy allows. All text is rendered as text. The page keeps no business data of its own: Refresh reads the App again. Layout uses the Host's shared stylesheet.

`tests/web.browser.cjs` checks all of this in Chromium against a separate Infra connection.
