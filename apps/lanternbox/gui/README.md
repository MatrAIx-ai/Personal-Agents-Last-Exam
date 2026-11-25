# Lanternbox page

`index.html` and `src/app.js` are Lanternbox's business page. The shared `runtime/web/server.cjs` serves them and forwards only the Agent MCP tools the run's policy allows; the page has no management route. `src/view.js` is the plain reviewer renderer.

```sh
node runtime/web/server.cjs --app lanternbox --registry apps/lanternbox/registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. Use `--profile scenario` on a fresh run for the read-only policy. Seeds, events, clock and reset stay on the separate Infra MCP connection.

Views:

- **Browse.** The catalog with a search box and filters for kind and availability. “Viewing as” chooses the profile: the list then leaves out what that profile may not see, and the selected title shows that profile's progress and next episode. Buttons: Add to watchlist or Remove from watchlist; for a film and for each episode, Mark watched, Set position and Back to start.
- **Profiles.** Each profile with its settings, what is stored for it, its watchlist, what it has in progress and its viewing history. Buttons: New profile, Edit profile, Delete profile (the form states how many viewings, progress rows and list entries go with it), Remove on a list entry, Hide or Unhide on a viewing.
- **Plan and billing.** Status, plan, `paid_through`, pending change and next charge; the three plans with whether a move is possible now and why not; devices; recent charges. Buttons: Move to a plan, Cancel plan, Undo pending change, Sign out.
- **Notifications.** The in-App log, newest first.

How it behaves: the controller uses its own small transport over the Host's `/session`, `/api/tools` and `/api/call`, because Lanternbox's records are not one collection keyed by `id`. Each write opens a form that keeps the version read when it opened; if anything changed since, the form shows the conflict and saves nothing. An unchanged retry reuses its request ID, so a lost response cannot repeat an effect. A refused write stays in the form with its code. Buttons appear only for tools the policy allows. All text is rendered as text. The page keeps no business data of its own: Refresh reads the App again, so a change made by an event or by the clock shows after a refresh. Layout uses the Host's shared stylesheet.

`tests/web.browser.cjs` checks all of this in Chromium against a separate Infra connection.
