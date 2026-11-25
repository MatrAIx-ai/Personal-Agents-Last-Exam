# Ribbonwell

A synthetic wish-list and gift-exchange account seen from one member of a family group and a friends group. Everybody except a list's owner can see who has reserved or bought an item; the owner sees nothing. Nothing is bought inside the App: a purchase is a recorded state, what other members do arrives as task-supplied events, and the two time-based states follow the environment clock.

Approved plan: [`proposals/environment/ribbonwell.md`](../../proposals/environment/ribbonwell.md) (PR #225). Runtime: public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. No other App, no messaging, no external service, no package install.

## Run it

From the repository root (Node.js 18+):

```sh
cd apps/ribbonwell && npm test && npm run example        # App-only business tests T01–T16 and the walkthrough
npm run app:verify -- --app apps/ribbonwell --output .artifacts/ribbonwell.json   # public verifier, real MCP
node apps/ribbonwell/tests/mcp.integration.cjs           # real-MCP checks the verifier does not exercise
node apps/ribbonwell/tests/web.browser.cjs               # Chromium acceptance of the page (needs `npm ci` and Playwright's Chromium)
node apps/ribbonwell/scripts/build-schemas.cjs --check   # tools.json and schemas match their one description
node apps/ribbonwell/scripts/build-fixtures.cjs --check  # the fixture is reproduced byte for byte
node runtime/web/server.cjs --app ribbonwell --registry apps/ribbonwell/registry.json --run demo --profile sandbox   # open the printed link
```

`registry.json` is a package-local registry for the Web Host and the integration tests, so nothing outside `apps/ribbonwell/` changes. `tests/business.test.cjs` and `examples/run.cjs` need only this folder.

## What the Agent can do

24 tools, all named `ribbonwell.<name>`. Every tool names the object it acts on as `id`, and every change to an existing object goes through `patch`, because a task policy can restrict exactly those two things.

| Workflow | Tools |
| :--- | :--- |
| W1 What this member may see (read) | `account.get`, `groups.list`, `groups.get`, `lists.list`, `lists.get`, `items.get`, `items.search`, `claims.list`, `exchanges.list`, `exchanges.get`, `notifications.list` |
| W2 Own and managed lists | `lists.update`, `items.add`, `items.update`, `items.remove`, `items.restore` |
| W3 Reserving and buying for others | `claims.reserve`, `claims.update`, `claims.release` |
| W4 Gift exchanges | `exchanges.create`, `exchanges.update`, `exchanges.join`, `exchanges.leave`, `exchanges.draw` |

App errors: `not_found`, `not_list_editor`, `name_taken`, `invalid_quantity`, `own_list`, `removed_item`, `insufficient_quantity`, `already_claimed`, `not_my_giftee`, `joining_closed`, `already_joined`, `exchange_full`, `not_participant`, `not_organizer`, `too_few_participants`, `no_valid_draw`, `invalid_exclusion`, `invalid_window`, `invalid_state`. Every refusal leaves data and version unchanged. A `not_found` message names the read tool that lists valid IDs, and a time refusal states the current time.

Policies (`fixtures/policies.json`): `scenario` allows the 11 reads; `sandbox` allows all 24 tools. A task supplies its own; `tests/mcp.integration.cjs` shows a task forbidding exactly the `status` key of `claims.update` and limiting `items.add` to one list.

## Rules worth knowing

- **Who the Agent acts for.** The bound member is the member whose `person_id` equals the `owner_person_id` of the `ribbonwell` account in the run's `binding.json`. `validateSeed` requires that account to exist for the seed's top-level `account_id` and exactly one member to carry that `person_id`. Identity is matched by `person_id`, never by name.
- **Owner blindness.** Reads of the member's own list carry `claims_hidden: true` and no claim field; own-list writes return the same result and the same errors with and without claims; no notification is ever written about a claim on the member's own list. Those claims still exist in state, where only a grader reads them.
- **Time.** Ribbonwell has no timers and no clock event, and Agent reads and writes never move the clock. Infra moves it with an event or `env.advance_time`, which runs no handler but raises the App revision, so a write prepared earlier returns `stale_version`. Two things depend on the clock and neither is stored: a claim reads `lapsed` when its stored status is `reserved` and the time is at or past `reserved_until`; an exchange reads `open`, `closed`, `drawn`, `past` or `expired` from `join_by`, `exchange_date`, `drawn_at` and the clock. `env.snapshot` returns stored state, so a grader recomputes those two from the snapshot's `virtual_now`; `src/derive.cjs` is the pure module the handlers themselves use (`claimStatus`, `remaining`, `exchangeStatus`). One clock jump and many small steps leave identical data.
- **The draw.** `exchanges.draw` searches, in a fixed order, all assignments in which every participant gives once and receives once, nobody gives to themselves and no giver and receiver form an excluded pair. Givers are taken in the order of SHA-256(`draw_salt`, exchange, giver) and each giver's receivers in the order of SHA-256(`draw_salt`, exchange, giver, receiver); the first complete assignment is stored. `no_valid_draw` means that no such assignment exists. Seeds and `exchange.drawn` events are validated by the same rule, so an assignment made of several rings is valid. `draw_salt` is returned by no read.
- **Holds.** A reservation holds for exactly 14 × 24 hours and keeps the UTC offset of the clock it was computed from. A claim that becomes active again or grows is checked against what is left without it.
- **IDs.** Records created during a run get `itm-r<n>`, `clm-r<n>`, `exc-r<n>` and `ntf-r<n>`, counted per kind in commit order from 1 after a load or reset. Events give their own IDs.

## Events

Six events through `env.apply_event`: `ribbonwell.item.added`, `ribbonwell.item.changed`, `ribbonwell.claim.recorded`, `ribbonwell.exchange.opened`, `ribbonwell.exchange.member_changed`, `ribbonwell.exchange.drawn`. `examples/scenario.json` is one valid event; the tests hold one of each. An event names an item by `item_id` or by `item_match` (`list_id` and `name`), and an exchange by `exchange_id` or `exchange_match` (`group_id` and `name`), so a task can address a record the Agent creates during the run. A match compares names after trimming and case-folding and considers listed items only. Every rejection is `invalid_event` with a message, leaves state and clock unchanged, and is read with `env.event_status`: a duplicate ID, an unknown member, list, item or exchange, no match, an actor outside the group, the bound member as actor, an edit by someone who neither owns nor manages the list, a claim by the list owner or beyond what is left, a join when the exchange is not open or is full, and an invalid set of assignments.

Notifications are an in-App log (`notifications.list`) written for what events do, never for the Agent's own writes and never for time alone: `item.added`, `claim.item_changed`, `exchange.invited`, `exchange.member_changed`, `exchange.drawn`.

## Records for graders

- **App state in the snapshot** holds what no Agent read returns (claims on the member's own list, every assignment, `draw_salt`) and `activity` rows: `seq`, `at`, `actor` (`agent` or `event`), `action`, `object_id`, `list_id`, `exchange_id`, `request_id` or `event_id`, `replaced` (old values of the changed keys) and, for a removal, `unreleased_claims`. There is one row for every committed Agent write and every applied event, and none for a read, a refusal, a replay or the passing of time.
- **Core audit rows** give the tool, the decision with its reason, and the versions before and after. They hold no arguments and no request ID, and a replay writes no audit row.
- **The Agent execution trace** gives arguments and results.

So: which lists, items or exchanges the Agent read comes from the trace only. A committed write is matched to the trace by the activity row's `request_id` and to its audit row by the committed version. Rejected calls are counted from the deny audit rows and their reasons. Replays appear only in the trace, as results carrying `duplicate: true`. Take the snapshot before a reset: reset restores the most recently loaded seed and its clock and clears the audit and receipts.

## Data

`fixtures/minimal.json` is generated by `scripts/build-fixtures.cjs`, which replays a fixed, seeded history through the App's own handlers (tools for the bound member, events for everyone else): 1 account, 13 members in 2 groups (9 family, 6 friends, 2 in both), 15 lists (2 managed for children), 130 items (6 removed), 74 claims in every stored status (6 on the bound member's own family list), 4 exchanges (past, expired, drawn, open), 26 notifications and 291 activity rows, dated from 2025-01-04 to 2026-11-16. `fixtures/clock.json` sets 2026-11-18T09:00:00-08:00. All people, items and shops are invented. A task loads its own history with `env.load_seed`; the seed schema accepts every record type above, with dates from 2025-01-01 up to the loaded clock.

## The page

`gui/index.html` and `gui/src/app.js` are the business page, declared in `contribution/gui.json` (`pale.web`) and served by the shared Web Host over the Agent MCP bridge. Four views: Wish lists, My claims, Gift exchanges, Notifications. See [`gui/README.md`](gui/README.md).

## Plan and implementation

Review items from PR #225, as handled:

1. **Bound member.** Derived from the account's `owner_person_id` as described above; `member_id` is not a shared value and does not appear in the binding. Tested in T16 and over MCP.
2. **Evaluator records.** Described above as the reviewer corrected them; checked over MCP (no arguments or request IDs in audit rows, no audit row for a replay, the activity row's `request_id`).
3. **The draw.** Searches all valid assignments; the five-person example (one participant may only exchange with one other) is in T13 and succeeds with a pair and a ring of three.

Suggestions taken: `validateSeed` accepts dates from 2025-01-01, and the fixture carries 2025 history including last December's family draw. Related work: #11 (Beam) has an in-store wishlist and game gifting inside one store; Ribbonwell is shared family lists with claims hidden from the list owner and holds no store, order or payment.

Differences from the approved plan:

- **A browser page was added.** The plan said MCP-only; reviewers now ask Environments for a GUI.
- **Fixture clock.** The plan put the fixture at 2026-11-23; it is 2026-11-18T09:00:00-08:00, the repository registry's start time, so the package also loads under that registry. The tests move the clock to 23 November before running the plan's acceptance paths, so the planned dates (a hold until 7 December, a draw on 30 November) are the ones tested.
- **History starts in 2025**, not 2026, and the `past` exchange is the December 2025 family draw rather than one from January 2026.
- **Counts.** 74 claims and 26 notifications against “about 75” and “about 20”.
- **Changed-field markers.** Restoring an item clears the `removed` marker on its claims; the plan left this open.
- **`items.update` on a removed item** returns `invalid_state` (restore first); the plan named the code but not this case.
- **No time-zone field.** No rule depends on a local calendar date, so the account stores none.
- **Run-created IDs** follow the `-r<n>` rule above; the plan did not publish one.
- `exchanges.create` does not join the organizer (the plan's acceptance path joins separately), while `exchange.opened` adds the acting member as joined, as the plan states.

Not in this version, as in the plan: stores, links and price lookup, payments and chip-ins, shipping, photos, public registries, suggestions on someone else's list, archiving, creating or leaving groups, redrawing or cancelling an exchange, and delivery of notifications outside the App.

Known limits: holds ignore daylight-saving changes (exactly 336 hours); one account per App instance; a group has at most 12 members and an exchange at most 10 participants; text limits count UTF-16 units.

## Workflow-to-test mapping

| Workflow | App-only tests | Real MCP | Browser |
| :--- | :--- | :--- | :--- |
| W1 | T01–T03 | hidden values, policies | own list shows no claim; read-only profile |
| W2 | T04–T06 | item added by the Agent then reached by an event | add, edit, remove, restore, refused write |
| W3 | T07–T10 | reserve, replay, conflict, stale version, lapse at the boundary | reserve, mark purchased, release |
| W4 | T11–T14 | an undrawn exchange expires by the clock | join, create, draw readiness |
| All | T15–T16, fixture test | seed floors, reset ×20, one jump against daily steps, run isolation | reload, event after refresh, stale form, lost response, no management access, 390 px, no script errors |

Still for human review: realism of the lists and that every person, item and shop name is invented.
