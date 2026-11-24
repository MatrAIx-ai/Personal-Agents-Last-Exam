# Rainshadow web pages

`index.html` and `src/app.js` are Rainshadow's business pages: the App's own navigation, forms and presentation of places, forecasts, alert threads, watches, notices and settings. The shared public `runtime/web/client.js` provides the session, tool discovery and form primitives; `runtime/web/server.cjs` serves the page and forwards only the Agent's permitted tools. `src/view.js` is the compatible reviewer renderer. The declaration is `../contribution/gui.json` (`pale.web` extension).

From the repository root:

```sh
node apps/rainshadow/examples/web.cjs --runtime runtime                     # sandbox profile
node apps/rainshadow/examples/web.cjs --runtime runtime --profile scenario  # the restricted, Task-like policy
```

Open the access link it prints. The starter copies the package into a temporary registry and starts the Host on a fresh copy of the fixture; Ctrl+C removes the copy. Seeds, events and the clock stay on the separate Infra MCP interface: the pages have no such controls, and the Host refuses a management request from the page session.

What the page holds itself is only UI state: the section, the selected item, the chosen forecast source and issuance, the notice filters and unfinished form text. Every value shown is read through the tools; Refresh reads everything again. Times are shown in the zone of the place they belong to (or the account's zone for notices); the browser's own clock and zone are never used.

Writes keep the version observed when a form opened, so a concurrent change shows as a conflict; an unchanged resubmission reuses its request ID after a lost response; edits send only changed fields. Styles are an App-owned constructable stylesheet, because the Host's content policy allows no inline styles.

`../tests/web.browser.cjs` checks these pages in a real browser against the same run through MCP (see the package README).
