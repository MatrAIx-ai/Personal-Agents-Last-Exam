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
| Home | `children.list`, `attendance.list` (today), `forms.list`, `lunch.account_get` and `pickup.get` per child, `notifications.list` | Each child's attendance today, way home and lunch balance; forms waiting for an answer, low balances and unexplained marks; this week's changed ways home; latest notifications |
| Attendance | `attendance.list` (four weeks), `absences.list`; coming days and cut-offs from `schools.get` | Report an absence, late arrival or early leave; cancel a report while some day is still before its cut-off. Reports of the current school year are listed; earlier years' reports are folded under "Earlier school years" |
| Forms | `forms.list`, `forms.get`; payment methods from `preferences.get` | To do / open and answered / closed lists with a filter (closed forms of earlier school years are folded under "Earlier school years" and open when the filter is used); read the exact text, questions, fee and version history; sign or decline per child (answers built from the form's own questions, fee charged to a chosen card); withdraw your answer |
| Pickup & dismissal | `pickup.get` | Way home for the next two weeks with each day's cut-off; change or cancel a day's way home; add or remove a pickup person; restrictions on file; earlier changes |
| Lunch | `lunch.account_get` (two weeks), `menu.list`; payment methods from `preferences.get` | Balance, alert and limit, meal restrictions; purchases flagged `restricted_item` / `over_daily_limit`; this week's menu with items excluded for the child; add money; change alerts and limits |
| Notifications | `notifications.list` (60 days) | Filter by kind, read one, jump to the related view |
| Account | `payments.list` (school year), `children.list`, `preferences.get` | Email copies and default card; payment methods; payments and refunds; each guardian's rights per child |

Every view also reads `schools.get` for the selected child's school (the district's today, time zone, coming days and cut-offs). Each child view has a child picker. A view shows only what the Agent connection returned at the last refresh: for a child the account holder is not custodial for, Pickup shows no list and makes no `pickup.get` call (the App would refuse it), and Home says the way home is shared with custodial guardians only. Controls are shown only when the tool is discovered for this session and the account holder's right for that child allows it (custodial for reports and pickup, `can_sign` for forms, `can_pay` for lunch); otherwise the view says who holds the right. The App still decides every write.

## Writes

All 11 Agent write tools are in the page. Report, add pickup person, change way home, add money, alerts and limits, and preferences use the shared schema form built from the live tool schema, with choices filled from the same reads (school days with their cut-offs, approved collectors, usable payment methods). Answering a form uses an App-owned sheet because `answers` is an open object whose keys are the form's questions. Cancel report, withdraw answer, remove person and cancel change are confirmations. Every write carries the account version the page observed at its last refresh, and every value a form is prefilled from was read after that version in the same refresh, so a change made elsewhere in between (another Agent connection, an Infra event or a time move) makes the write `stale_version` instead of overwriting it. A write keeps its request ID while the form is unchanged, so a retry after a lost response commits once; a stale form says the record changed and writes nothing. A refusal stays in the form with the App's message (for example "A top-up must be between $5.00 and $200.00."); the code stays in the form's `data-code` attribute for tests and is not shown. Refusals that come from Core rather than from Bellnote (input that does not match the tool schema, a changed retry) are shown in plain words; a request that got no answer says it may not have arrived and that sending it again applies it once, and a request the Host turned down (for example after the access session ended) says so and asks for a reload. Amounts are typed in dollars as a plain amount (digits, optionally a point and one or two decimals) and sent as whole cents; anything else, such as `1,50`, `1e3`, `12.345`, `-5` or a space, is stopped at the field rather than read as another amount; the phone number and the arrival or leaving time are checked in the browser before anything is sent, so a malformed value is stopped at its field. The add-person form asks for name, relationship and phone only: the school recognizes people by phone number, and a school-held person ID is not something a guardian types (the tool still accepts one from an Agent).

Not in the GUI: nothing among the Agent tools. Staff, cafeteria and other-guardian actions are events (Infra), and guardian links and restrictions come only from the seed, so the page has no controls for them.

## Reads and timing

Core reads and validates the whole account state on every call, so each Bellnote call through the Host costs about 0.12–0.18 s (the Host checks the tool with a `tools/list`, then sends the call; most of the time is Core's schema check of the account, see [VALIDATION.md](../VALIDATION.md#seeded-history-from-2025-01-01-maintainers-request-after-approval)). Core handles one call at a time, so sending reads together saves little. The page therefore makes only the reads a view shows, and keeps nothing read for one view when it shows another:

- Moving between views, every write and Refresh go through the Host's refresh: the tool list, `children.list` with the account version, then the view's reads, including the school (`schools.get`, which also gives the district's "today", the coming days and their cut-offs) and, where the view uses them, the account preferences. Values a form is prefilled from therefore never predate the version the form sends, and a time move, a calendar change or another client's change shows on the next view.
- Choosing another child, or another form in Forms, stays in the view and re-reads only that choice (the view's reads for that child; one `forms.get` for a form), without the tool list and `children.list`. Those reads are newer than the version a later write sends, so a change made in between can only make the write stale.

Measured in headless Chromium against the reference fixture, three page loads per Node version (requests per action include the Host's `/api/tools`; time from click to a settled page, for a write from Save to the refreshed page; Node 22.23.1 / 18.20.8, load average 2.9–3.7 on 20 hardware threads):

| Action | Requests | Time |
| --- | --- | --- |
| First load (Home) | 11 | 1.14–1.33 / 1.17–1.28 s |
| Attendance | 5 | 0.49–0.62 / 0.49–0.56 s |
| Forms | 6 | 0.62–0.78 / 0.59–0.71 s |
| Pickup & dismissal | 4 | 0.38–0.41 / 0.39–0.42 s |
| Lunch | 6 | 0.59–0.87 / 0.57–0.69 s |
| Notifications | 4 | 0.39–0.41 / 0.40–0.41 s |
| Account | 5 | 0.49–0.54 / 0.50–0.52 s |
| Home (again) | 11 | 1.12–1.32 / 1.19–1.20 s |
| Another child (Attendance) | 3 | 0.35–0.49 / 0.35–0.39 s |
| Another form | 1 | 0.14–0.18 / 0.12–0.15 s |
| Another child (Lunch) | 4 | 0.45–0.67 / 0.45–0.50 s |
| Refresh or reload (Lunch) | 6 | 0.54–1.09 / 0.60–0.67 s |
| Save alerts and limits (Lunch) | 7 | 0.74–0.92 / 0.82–0.89 s |
| Save preferences (Account) | 6 | 0.63–0.92 / 0.64–0.68 s |

Home is the slowest view because it shows every child's balance and way home (one `lunch.account_get` per child and one `pickup.get` per custodial child); there is no tool that reads these for several children at once. A write costs the write itself plus the Host's refresh (tool list, `children.list`, then the view's reads).

## Implementation notes

- App styles are a constructed stylesheet in `src/app.js` added to `document.adoptedStyleSheets`, because the Host serves only `/`, `/app.js` and the shared files and its CSP allows no inline style. The shared stylesheet still provides the shell and the phone layout.
- The shared toolbar search is hidden: a record search over children is not useful here. Forms and Notifications have their own filters over the loaded list.
- Navigation state (view, child, form) is kept in `sessionStorage`; business data is never stored in the browser.

## Checks

```sh
cd apps/bellnote
npm run web:smoke     # real Host, session/CSRF, refused routes, reads, writes confirmed over MCP, conflicts, retries, scenario profile
npm run web:browser   # 64 checks; Playwright + Chromium from the repository root (npm ci && npx playwright install chromium)
npm run evidence:gui  # workflow screenshot sequences for the delivery evidence, written to ../evidence/gui/ (same requirements)
```

`web:browser` writes screenshots and `report.json` to `.artifacts/bellnote-web/` (or `--out DIR`).
