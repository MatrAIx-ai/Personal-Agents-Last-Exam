# University Course Registration: Web views

`index.html` and `src/app.js` are this App's business interface. The public Web Host (`runtime/web/server.cjs`) serves them on loopback and forwards only the Agent MCP tools the current permission profile allows; `runtime/web/client.js` supplies the connection, the version each write is checked against and safe retries. `src/view.js` is the compatible reviewer renderer and is not used by the business page.

From the repository root:

```sh
node runtime/web/server.cjs --app university-course-registration --registry apps/university-course-registration/registry.local.json --run web-demo --state-dir <state-dir> --profile sandbox
```

Open the access link the Host prints. The Host needs Node.js 18 or later and no package installation. A new run starts from the default seed with the chosen profile; starting the Host on an existing run never resets it or changes its profile. Use `--profile scenario` on a fresh run for a read-only page. Seeds, resets, events and the clock stay on the separate Infra MCP connection: the page has no route to them.

## What the three v1 views do

The page shows the same ledger an MCP client sees, for the same run and state directory. It stores nothing in the browser; Refresh reads the App again, which is also how a change made by an Infra event or by an MCP client becomes visible.

| View | Reads | Operations offered |
| :--- | :--- | :--- |
| Catalog | `catalog.search` (list and search), `course.get` (sections and seats, lecture/lab combinations, prerequisites and whether each is completed, registration window), `record.get` (credits in use) | `enrollment.enroll` for a combination with seats; `waitlist.join` for one without; when the course is already held, `enrollment.swap` or `waitlist.join` as a pending swap for its other combinations |
| My schedule | `schedule.get` (enrollments and meeting times, credits, time conflicts with the event that caused them, pending swaps) | `enrollment.withdraw`; `enrollment.swap` or a pending swap to another section of the same course |
| Waitlists & offers | `waitlist.list` (own entries with rank, what each still waits for, what blocks it; offers with deadline and whether it has passed) | `offer.accept` and `offer.decline` until the offer's deadline; `waitlist.leave` at any time |

A button calls one business tool with the version the page last read. If the ledger changed in the meantime the App answers `stale_version` and the page says so instead of overwriting; a refused operation shows the App's own message (for example the overlapping sections) and changes nothing. A button whose tool the current profile does not allow is not shown.

Timestamps are shown exactly as the App stores them, with their UTC offset, so an offer deadline reads the same in the page and through MCP.

## Not in v1

The approved plan delivers three of six views in v1; the three views need not expose every write. The following are M4:

- Separate views for course detail, for the academic record and rules, and for change review and activity receipts. In v1 the eligibility facts appear inside the Catalog view; `activity.list` (notices and receipts) and `change.preview` are available through MCP only.
- A swap to a different course, and a pending swap chosen from the Catalog of another course, from the page. Both are available through MCP.
- Confirmation dialogs and a preview step before a write.
- Browser validation with a real browser: stale forms, denied Infra and private-check access, account and run isolation, and the same state through MCP and after reload. v1 checks these at HTTP level in `tests/runtime.integration.cjs` ("the business Web Host serves the three views on the same ledger and exposes nothing else").

The page uses the shared stylesheet only; it has no images or other assets.
