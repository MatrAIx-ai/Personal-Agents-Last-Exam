# Bellnote Web App

The guardian's school portal: `index.html` and `src/app.js` own the pages, labels, forms and record presentation. The repository's shared Web Host (`runtime/web/server.cjs`) serves them and forwards only the Agent-visible Bellnote tools of one run; `runtime/web/client.js` supplies session handling, discovery, schema forms, versioned writes and text-only DOM helpers. `src/view.js` is the compatible reviewer renderer named by the legacy part of `contribution/gui.json`.

## Start

From the repository root (Node 18+, no install):

```sh
node runtime/web/server.cjs --app bellnote --registry apps/bellnote/web.registry.json --run bellnote-web --profile sandbox
```

or `npm run web` inside `apps/bellnote`. Open the access link the Host prints. `apps/bellnote/web.registry.json` registers this package alone with the package clock (`fixtures/clock.json`), so the Host needs no change to the repository-wide `apps.registry.json` or to `runtime/`. A new run starts from `fixtures/reference.json`; starting the Host against an existing run never resets it. Use a fresh `--run` with `--profile scenario` for the read-only Task-like policy. Seeding, events, time and reset stay on the separate Infra MCP connection; the page has no route for them.

## Views

| View | Reads | What a guardian does here |
| --- | --- | --- |
| Home | `children.list`, `schools.get`, `attendance.list` (today), `forms.list`, `lunch.account_get` and `pickup.get` per child, `notifications.list` | Each child's attendance today, way home and lunch balance; forms waiting for an answer, low balances and unexplained marks; this week's changed ways home; latest notifications |
| Attendance | `schools.get` (coming days and cut-offs), `attendance.list` (four weeks), `absences.list` | Report an absence, late arrival or early leave; cancel a report while some day is still before its cut-off. Reports of the current school year are listed; earlier years' reports are folded under "Earlier school years" |
| Forms | `forms.list`, `forms.get`, `preferences.get` | To do / open and answered / closed lists with a filter (closed forms of earlier school years are folded under "Earlier school years" and open when the filter is used); read the exact text, questions, fee and version history; sign or decline per child (answers built from the form's own questions, fee charged to a chosen card); withdraw your answer |
| Pickup & dismissal | `pickup.get` | Way home for the next two weeks with each day's cut-off; change or cancel a day's way home; add or remove a pickup person; restrictions on file; earlier changes |
| Lunch | `lunch.account_get` (two weeks), `menu.list`, `preferences.get` | Balance, alert and limit, meal restrictions; purchases flagged `restricted_item` / `over_daily_limit`; this week's menu with items excluded for the child; add money; change alerts and limits |
| Notifications | `notifications.list` (60 days) | Filter by kind, read one, jump to the related view |
| Account | `preferences.get`, `payments.list` (school year), `children.list` | Email copies and default card; payment methods; payments and refunds; each guardian's rights per child |

Each child view has a child picker. A view shows only what the Agent connection returned at the last refresh: for a child the account holder is not custodial for, Pickup shows no list and makes no `pickup.get` call (the App would refuse it), and Home says the way home is shared with custodial guardians only. Controls are shown only when the tool is discovered for this session and the account holder's right for that child allows it (custodial for reports and pickup, `can_sign` for forms, `can_pay` for lunch); otherwise the view says who holds the right. The App still decides every write.

## Writes

All 11 Agent write tools are in the page. Report, add pickup person, change way home, add money, alerts and limits, and preferences use the shared schema form built from the live tool schema, with choices filled from the same reads (school days with their cut-offs, approved collectors, usable payment methods). Answering a form uses an App-owned sheet because `answers` is an open object whose keys are the form's questions. Cancel report, withdraw answer, remove person and cancel change are confirmations. Every write carries the version the page observed when the form opened and keeps its request ID while the form is unchanged, so a retry after a lost response commits once; a stale form shows `stale_version` and writes nothing. A refusal stays in the form with the App's code and message (for example `amount_out_of_range · A top-up must be between $5.00 and $200.00.`).

Not in the GUI: nothing among the Agent tools. Staff, cafeteria and other-guardian actions are events (Infra), and guardian links and restrictions come only from the seed, so the page has no controls for them.

## Implementation notes

- App styles are a constructed stylesheet in `src/app.js` added to `document.adoptedStyleSheets`, because the Host serves only `/`, `/app.js` and the shared files and its CSP allows no inline style. The shared stylesheet still provides the shell and the phone layout.
- The shared toolbar search is hidden: a record search over children is not useful here. Forms and Notifications have their own filters over the loaded list.
- Navigation state (view, child, form) is kept in `sessionStorage`; business data is never stored in the browser.

## Checks

```sh
cd apps/bellnote
npm run web:smoke     # real Host, session/CSRF, refused routes, reads, writes confirmed over MCP, conflicts, retries, scenario profile
npm run web:browser   # Playwright + Chromium from the repository root (npm ci && npx playwright install chromium)
```

`web:browser` writes screenshots and `report.json` to `.artifacts/bellnote-web/` (or `--out DIR`).
