# Fernshelf web page

`index.html` and `src/app.js` are Fernshelf's own page and controller: the account holder's photo library with its albums, sharing, removal requests, storage, activity and trash. The repository's shared Web Host (`runtime/web/server.cjs`) serves them and connects the page to a fixed **Agent** MCP process for one run. The shared `runtime/web/client.js` supplies the session, tool discovery, the MCP call, the New album schema form and text-only DOM helpers; Fernshelf's controller makes its own forms and writes, with the version handling described below. `src/view.js` is the compatible reviewer renderer named by the legacy profile in `contribution/gui.json`.

The page was added after plan approval, because the maintainers asked every Environment for one ([comment on #111](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/111#issuecomment-7123353250)); the approved plan described an MCP-only App. No business schema, tool, event or seed format changed for it.

## Start

From the repository root (Node 18 or later, nothing to install):

```sh
node runtime/web/server.cjs --app fernshelf --registry apps/fernshelf/web.registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. `apps/fernshelf/web.registry.json` is a one-App registry that points at this folder (`"path": "."`) with the package clock (`fixtures/clock.json`), so the Host needs no change to the repository's `apps.registry.json` or to `runtime/`. State goes to the repository's `.state/` unless `--state-dir` is given.

- `--profile sandbox` (on a new run) allows every Agent write. `--profile scenario` allows only the ten reads: the page then shows no write controls, and the Host refuses a forced write.
- Starting a Host on an existing run never resets it or changes its policy. Loading a task, injecting events or moving the clock stays with the separate Infra MCP connection; the page has no route for any of them.
- The same run, registry and state directory let an MCP client and this page observe the same backend. **Refresh** reads it again; reopening the page shows what is committed. The page also reads the whole view again after each of its own writes, and as soon as any of its reads shows that something changed elsewhere.

## Views

| View | What it shows | Reads |
| --- | --- | --- |
| Photos | The library grid by month, newest first; stacks show their cover with the number of versions; favourites, videos and items waiting for backup are marked | `items.search` (all pages), `items.read` for thumbnails |
| Favourites, Archive | The same grid, filtered on the App's flags | `items.search` |
| Photo panel | Large image or placeholder, caption, time and place in the account's time zone, people, size, source, backup, stack versions, albums, **who can see it** (joined members, links, invited people, recorded views and saves, what returns on restore), removal requests and history | `items.get`, `items.read`, `exposure.get`, `account.get` |
| Albums | Album cards with cover, item count, contributions, sharing and link state | `albums.list`, `albums.get` (per card as it scrolls into view) |
| Album page | Items in album order, members' contributions, members (current and former) with role and status, links with their state, creation date, expiry, views and saves, items hidden while in the trash | `albums.get` |
| Sharing | Every album that someone can see or is invited to, with its members and active links | `albums.list`, `albums.get` |
| Requests | Removal requests, pending first, with requester, message, scope, the named items, members' photos named by who added them, answers and the albums an honour took them down from | `removals.list`, `albums.get` for albums that hold members' photos named in a request |
| Storage | Plan, used and free space, trash, waiting backups, duplicates, bytes by kind and source, the largest items and the duplicate copies | `storage.summary` |
| Activity | Notifications about what members, link viewers, requesters and the device did. The last 90 days (counted back from the newest notice) are listed; older notices, back to when the account was opened in January 2025, are folded under **Earlier** | `notifications.list` |
| Trash | Trashed items; the panel shows when each is deleted for good | `items.search` with `state: trashed` |

Images are only ever the bytes `fernshelf.items.read` returns on the Agent connection, shown through `blob:` URLs. An item without a file, a video, an item waiting for backup or an item in the trash shows a placeholder, and a policy that withholds `items.read` leaves every tile a placeholder.

## Workflows in the page

| Workflow (plan §2) | Controls | Writes |
| --- | --- | --- |
| W2 Organising | Favourite toggle; **Edit details** (caption, favourite, archived, corrected capture time); people chips with remove and **Add person**; **Make cover** in a stack; **Archive**/**Unarchive**; **New album**; album **Add items** (picker), **Rename**, **Move earlier/later**, **Remove from album**, **Delete album** (with the option to end access) | `items.update`, `albums.create`, `albums.update`, `albums.delete` |
| W3 Sharing | Album **Invite** (person and role), member **Change role** and **Remove**, **Create link** (optional expiry), **Revoke**, contribution **Save to my library** | `albums.members.invite`, `albums.members.update`, `albums.save_item`, `links.create`, `links.revoke` |
| W4 Removal requests | **Honour…** and **Decline…** with an optional note; the photo panel shows where each named item is visible before answering; after an honour, a summary lists what was taken down, what is not yours, and the views and saves that cannot be called back | `removals.respond` |
| W5 Storage and trash | **Move to trash**, **Restore**, **Delete forever** (with confirmation), on one item or several (**Select** in the grids); Storage view lists the largest items and duplicate copies to act on | `items.trash`, `items.restore`, `items.purge` |
| W1 Library (read-only) | All views above | the ten reads |

Every write the App answers with `removal_honored` warnings (adding to a shared album, inviting, creating a link, restoring) opens a notice naming each person, the photo and when their request was honoured. A refusal is explained in the form or confirmation that caused it, in the page's own words for each error code (for example, deleting an album that is still shared without ticking "Also end access" says so; the message only points to what the dialog offers, so a dialog drawn without that box says to cancel and open Delete album again); the App's messages are written for the Agent and name IDs, so the page does not show them. The code stays on the error element (`data-code`) for tests. Nothing refused is reported as saved.

The page shows names, titles and dates, never record IDs: links are listed by state and creation date, members' photos by who added them, albums by title (an album deleted since is named as such), stack versions by number, exact capture time and size, and an item's history in words.

All 13 Agent writes are reachable from the page. Not in the page, by design:

- Events by other people (joins, views, saves, contributions, removal requests and withdrawals), new items from the device, the clock, loading a task and resets: these are Infra operations and have no browser route.
- Mail notices: the Infra-run sender (`src/publisher.cjs`) needs a Messaging publisher connection the browser does not have.
- Several-item `albums.update` `order` beyond moving one item earlier or later, and `remove_ids` on several items at once: the page offers per-item moves and removal; the MCP tool accepts the longer forms.

## Forms, versions and what the page keeps

- **Forms.** Each form shows only the fields a person fills in: Rename (title), Edit details (caption, favourite, archived, corrected capture time), Invite (person, role), Change role (role), Create link (expiry), Honour and Decline (a note). The album, member, request and the decision are set by the button that opened the form; no form asks for a record ID. A form is offered only when the live Agent discovery lists its tool; a field a task policy denies is refused by Core (`permission_denied`) and the form says the action is not available. New album is the shared schema form, whose only field is the title.
- **One version per view.** Core keeps one version for the whole library, and every read answers with it. The page reads a view as one batch: every page of the items, the trash, the account, the albums, the requests, the open album and whatever the open view needs (storage, notifications, the albums behind Sharing and Requests). If the answers carry different versions, because something committed while they were being read, the batch is read again. So everything on screen was read at one version.
- **Writes carry the version of what the person saw.** A form first reads the record it shows (the item, the album or the requests) and sends the version of that read. A confirmation or chooser drawn from the view (Delete album, Remove member, Revoke, Delete forever, Add to album, Add items, Save to my library) keeps the view's version as it was when it opened and sends that. A plain button (Favourite, Archive, Move to trash, Restore, Make cover, Move earlier and later, Remove from the album, adding and removing people, the multi-select Restore and Move to trash) sends the view's version as it was when the button was drawn. If anything committed since, Core answers `stale_version`, the dialog says "Something changed in the library since this was opened…", and nothing is overwritten. While the view is being read again only forms write; any other control answers with the same message.
- **Reading again.** After each of its own writes the page reads the whole view again. When any later read (an image, "who can see this", an album cover, a form) answers with a newer version than the view's, the view is out of date and the page reads it again, also behind an open dialog. The view then shows the change, and the dialog still sends the version it opened with, so confirming it shows the conflict instead of acting on state it did not show. **Refresh**, the first load and a search do the same.
- **What is kept.** Only image bytes (an item's file never changes, and a purged item is never read again) and the tool schemas are kept between reads. The open view and an unsent form are the only other page state (the open view is kept in `sessionStorage` across a reload).
- **Retries.** An unchanged form or button retried after a failure reuses its request ID, so a write whose answer was lost commits once.
- App text is inserted as text nodes. The page's styles are added to the shared stylesheet through the CSS object model at start-up (the Host serves one stylesheet and its Content-Security-Policy allows no inline styles); one of these rules makes the `hidden` attribute always hide.

## Performance

Each call costs what Core does around it: Core reads the run's whole state, validates it, runs the App, validates the result and writes the state back, and the Agent process answers one call at a time. The stored state of a fresh run of the reference library is about 3.0 MB: the library (about 654 KB compact, mostly the two-year history and its 1,259-row activity log) twice, as the current and the initial data, and the 48 image files twice. On the real runtime a read took 0.14–0.24 s and a write 0.11–0.18 s (median of five calls per tool, three runs on each Node version, Linux, 20 cores, load average 2.6–5; Node 22 at the low end, Node 18 at the high end; one Node 22 run at load average 4.2 had read medians up to 0.32 s). In a CPU profile of the Agent process, most of a call is Core validating the library against the seed schema six times (the state's data and initial data when it reads the state, the data again, the App's result, and the state's data and initial data before it writes), then Core's check of the image bundle (a hash of every file), copying, parsing and writing the state; the App's own code is under 10 ms. The published seed schema has its definitions inlined, because the validator resolves a reference into another schema file on the file system each time it meets one. The Host also lists the tools before each call, which reads and validates the state once more.

Correctness comes first, so the page reads the whole view again after every write (see above) instead of keeping lists that could have changed. A load of the Photos view is 8 to 11 calls: the Host's list read, every page of the items, the trash, the account, the albums, the requests, then the selected item and "who can see this". Each of them is needed for the guarantees above: the Host's list read starts every refresh, the items come 200 to a page, the trash is a separate search, and the other lists are read again so that all of them carry one version. What keeps it from being slower:

- the reads of one view are sent together;
- a dialog closes as soon as its write commits, and the view is read behind it;
- image bytes are read once per page load and reused; the photo panel's image goes ahead of queued thumbnails, and thumbnails load two at a time as they scroll into view;
- album covers are read only for cards on screen;
- the search box refreshes after a pause in typing.

Measured in Chromium 141 against the shared Host on a fresh `sandbox` run of the reference library, three runs on each Node version (the Host on that version), load average 2.6–5:

| Action | Node 18 | Node 22 | Calls |
| --- | --- | --- | --- |
| First load (grid shown, idle) | 2.7–3.2 s; first thumbnail 2.8–3.5 s | 2.7–3.7 s; first thumbnail 2.9–3.7 s | 11–13, with thumbnails |
| Open a photo with a file | image 0.3–0.8 s; "who can see this" 0.6–0.8 s | image 0.3 s; "who can see this" 0.6 s | 2 (the image if not yet read) |
| Open Edit details (reads the item) | 0.3–0.8 s | 0.3 s | 1 |
| Save a caption | form closes 0.4–0.9 s; idle 2.7–3.7 s | form closes 0.3–0.9 s; idle 2.6–2.8 s | 10 |
| Create an album (opens it) | 2.9–3.4 s | 2.4–3.0 s | 9 |
| Create a link (form opened to idle) | 2.9–3.9 s | 2.9–3.0 s | 10 |
| Refresh button | 2.4–2.9 s | 2.4 s | 8 |

Under more load these grow in proportion to the per-call time. No single call came near the Host's request timeout or the runtime client's 6 s limit: the slowest single read measured was 0.33 s. The browser test (`npm run test:browser`, 145 checks) takes 3.5–4.5 minutes at load average 1–3.

## Checks

```sh
node --test tests/web-smoke.cjs     # from apps/fernshelf; real Host, no npm dependency
node tests/web-browser.cjs --out DIR # needs the repository's Playwright and Chromium
```

See [`../VALIDATION.md`](../VALIDATION.md) for results.
