# Fernshelf web page

`index.html` and `src/app.js` are Fernshelf's own page and controller: the account holder's photo library with its albums, sharing, removal requests, storage, activity and trash. The repository's shared Web Host (`runtime/web/server.cjs`) serves them and connects the page to a fixed **Agent** MCP process for one run. The shared `runtime/web/client.js` supplies the session, tool discovery, schema forms, versioned writes and text-only DOM helpers. `src/view.js` is the compatible reviewer renderer named by the legacy profile in `contribution/gui.json`.

The page was added after plan approval, at the maintainers' request; the approved plan described an MCP-only App. No business schema, tool, event or seed format changed for it.

## Start

From the repository root (Node 18 or later, nothing to install):

```sh
node runtime/web/server.cjs --app fernshelf --registry apps/fernshelf/web.registry.json --run web-demo --profile sandbox
```

Open the access link the Host prints. `apps/fernshelf/web.registry.json` is a one-App registry that points at this folder (`"path": "."`) with the package clock (`fixtures/clock.json`), so the Host needs no change to the repository's `apps.registry.json` or to `runtime/`. State goes to the repository's `.state/` unless `--state-dir` is given.

- `--profile sandbox` (on a new run) allows every Agent write. `--profile scenario` allows only the ten reads: the page then shows no write controls, and the Host refuses a forced write.
- Starting a Host on an existing run never resets it or changes its policy. Loading a task, injecting events or moving the clock stays with the separate Infra MCP connection; the page has no route for any of them.
- The same run, registry and state directory let an MCP client and this page observe the same backend. **Refresh** reads it again; reopening the page shows what is committed.

## Views

| View | What it shows | Reads |
| --- | --- | --- |
| Photos | The library grid by month, newest first; stacks show their cover with the number of versions; favourites, videos and items waiting for backup are marked | `items.search` (all pages), `items.read` for thumbnails |
| Favourites, Archive | The same grid, filtered on the App's flags | `items.search` |
| Photo panel | Large image or placeholder, caption, time and place in the account's time zone, people, size, source, backup, stack versions, albums, **who can see it** (joined members, links, invited people, recorded views and saves, what returns on restore), removal requests and history | `items.get`, `items.read`, `exposure.get`, `account.get` |
| Albums | Album cards with cover, item count, contributions, sharing and link state | `albums.list`, `albums.get` (per card as it scrolls into view) |
| Album page | Items in album order, members' contributions, members with role and status, links with expiry, views and saves, items hidden while in the trash | `albums.get` |
| Sharing | Every album that someone can see or is invited to, with its members and active links | `albums.list`, `albums.get` |
| Requests | Removal requests, pending first, with requester, message, scope, the named items, items that are not yours, answers and what an honour took down | `removals.list` |
| Storage | Plan, used and free space, trash, waiting backups, duplicates, bytes by kind and source, the largest items and the duplicate copies | `storage.summary` |
| Activity | Notifications about what members, link viewers, requesters and the device did | `notifications.list` |
| Trash | Trashed items; the panel shows when each is deleted for good | `items.search` with `state: trashed` |

Images are only ever the bytes `fernshelf.items.read` returns on the Agent connection, shown through `blob:` URLs. An item without a file, a video, an item waiting for backup or an item in the trash shows a placeholder, and a policy that withholds `items.read` leaves every tile a placeholder.

## Workflows in the page

| Workflow (plan §2) | Controls | Writes |
| --- | --- | --- |
| W2 Organising | Favourite toggle; **Edit details** (caption, favourite, archived, corrected capture time); people chips with remove and **Add person**; **Make cover** in a stack; **Archive**/**Unarchive**; **New album**; album **Add items** (picker), **Rename**, **Move earlier/later**, **Remove from album**, **Delete album** (with the option to end access) | `items.update`, `albums.create`, `albums.update`, `albums.delete` |
| W3 Sharing | Album **Invite** (person and role), member **Change role** and **Remove**, **Create link** (optional expiry), **Revoke**, contribution **Save to my library** | `albums.members.invite`, `albums.members.update`, `albums.save_item`, `links.create`, `links.revoke` |
| W4 Removal requests | **Honor…** and **Decline…** with an optional note; the photo panel shows where each named item is visible before answering; after an honour, a summary lists what was taken down, what is not yours, and the views and saves that cannot be called back | `removals.respond` |
| W5 Storage and trash | **Move to trash**, **Restore**, **Delete forever** (with confirmation), on one item or several (**Select** in the grids); Storage view lists the largest items and duplicate copies to act on | `items.trash`, `items.restore`, `items.purge` |
| W1 Library (read-only) | All views above | the ten reads |

Every write the App answers with `removal_honored` warnings (adding to a shared album, inviting, creating a link, restoring) opens a notice listing each person and item. Refusals show the App's code and message in the form or confirmation that caused them (for example `confirm_required` when an album still has joined members or an active link), and nothing is reported as saved.

All 13 Agent writes are reachable from the page. Not in the page, by design:

- Events by other people (joins, views, saves, contributions, removal requests and withdrawals), new items from the device, the clock, loading a task and resets: these are Infra operations and have no browser route.
- Mail notices: the Infra-run sender (`src/publisher.cjs`) needs a Messaging publisher connection the browser does not have.
- Several-item `albums.update` `order` beyond moving one item earlier or later, and `remove_ids` on several items at once: the page offers per-item moves and removal; the MCP tool accepts the longer forms.

## Behaviour shared with the Host's other Apps

- Forms are built from the live Agent tool schemas; Fernshelf only chooses which fields an action shows and prefills the rest (for example the album ID and the decision).
- A write carries the version observed when the form or view was read. If anything committed in between, Core answers `stale_version`, the form shows the conflict, and nothing is overwritten.
- An unchanged form or button retried after a failure reuses its request ID, so a write whose response was lost commits once.
- There is no business data kept in the browser beyond what the last refresh read; the open view and an unsent form are the only page state (the open view is kept in `sessionStorage` across a reload).
- App text is inserted as text nodes. The page's styles are added to the shared stylesheet through the CSS object model at start-up (the Host serves one stylesheet and its Content-Security-Policy allows no inline styles).

## Performance

Core reads and validates the run's state for every MCP call, which takes about 0.25 s with the 420-item reference library on the machine used for validation, and the Agent process answers one call at a time. A refresh is six to eight calls (two pages of items, the trash, account, albums, requests, plus what the open view needs), so a write followed by its refresh takes a few seconds. Thumbnails load as they scroll into view, two at a time. Typing in the search box refreshes after a pause rather than on every key.

## Checks

```sh
node --test tests/web-smoke.cjs     # from apps/fernshelf; real Host, no npm dependency
node tests/web-browser.cjs --out DIR # needs the repository's Playwright and Chromium
```

See [`../VALIDATION.md`](../VALIDATION.md) for results.
