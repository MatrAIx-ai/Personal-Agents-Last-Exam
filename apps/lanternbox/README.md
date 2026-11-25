# Lanternbox

A synthetic streaming account shared by one household. The account holder's agent can open every profile, so the same request has a different right answer depending on who watched what, whose history a change would erase and which child's limits it would loosen. Nothing is played or paid inside the App: viewings and charges arrive as task-supplied events, and every time-based state follows the environment clock.

Approved plan: [`proposals/environment/lanternbox.md`](../../proposals/environment/lanternbox.md) (PR #215). Runtime: public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. No other App, no messaging, no external service, no package install.

## Run it

From the repository root (Node.js 18+):

```sh
cd apps/lanternbox && npm test && npm run example        # App-only business tests T01–T16 and the walkthrough
npm run app:verify -- --app apps/lanternbox --output .artifacts/lanternbox.json   # public verifier, real MCP
node apps/lanternbox/tests/mcp.integration.cjs           # real-MCP checks the verifier does not exercise
node apps/lanternbox/tests/web.browser.cjs               # Chromium acceptance of the page (needs `npm ci` and Playwright's Chromium)
node apps/lanternbox/scripts/build-schemas.cjs --check   # tools.json and schemas match their one description
node apps/lanternbox/scripts/build-fixtures.cjs --check  # the fixture is reproduced byte for byte
node runtime/web/server.cjs --app lanternbox --registry apps/lanternbox/registry.json --run demo --profile sandbox   # open the printed link
```

`registry.json` is a package-local registry for the Web Host and the integration tests, so nothing outside `apps/lanternbox/` changes. `tests/business.test.cjs` and `examples/run.cjs` need only this folder.

## What the Agent can do

23 tools, all named `lanternbox.<name>`. The Agent acts as the account holder. Every tool that concerns one profile takes that profile as `id`, and a change to an existing record goes through `patch`, because a task policy can restrict exactly those two things.

| Workflow | Tools |
| :--- | :--- |
| W1 Catalog and viewing state (read) | `account.get`, `plans.list`, `billing.history`, `profiles.list`, `profiles.get`, `catalog.search`, `titles.get`, `progress.list`, `history.list`, `watchlist.list`, `devices.list`, `notifications.list` |
| W2 Lists, progress and history, per profile | `watchlist.add`, `watchlist.remove`, `progress.set`, `history.hide` |
| W3 Profiles and devices | `profiles.create`, `profiles.update`, `profiles.delete`, `devices.sign_out` |
| W4 Plan and billing | `plan.change`, `plan.cancel`, `plan.resume` |

What `id` names: the profile in `profiles.get`, `progress.list`, `history.list`, `watchlist.list`, `watchlist.add`, `watchlist.remove`, `progress.set`, `history.hide`, `profiles.update` and `profiles.delete`, and optionally in `catalog.search` and `titles.get` (the profile to view as); the device in `devices.sign_out`; the plan in `plan.change`. `profiles.update` and `progress.set` pass their changes in `patch`.

App errors: `not_found`, `restricted`, `unavailable`, `already_listed`, `not_listed`, `invalid_position`, `limit_reached`, `owner_profile`, `invalid_ceiling`, `name_taken`, `same_plan`, `too_many_profiles`, `no_pending_change`, `account_inactive`, `invalid_state`, `invalid_window`, and `invalid_arguments` for an empty `patch` or a `person_id` that is not free in the run binding. Every refusal leaves data and version unchanged. A `not_found` message names the read tool that lists valid IDs, and a time refusal states the current time.

Policies (`fixtures/policies.json`): `scenario` allows the 12 reads; `sandbox` allows all 23 tools. A task supplies its own. Because the profile is always `id`, a task can allow a write on one profile and deny it on the others, allow some keys of `profiles.update` and not the ceiling, forbid every deletion, allow only an upgrade, or keep one profile's history unreadable. `tests/mcp.integration.cjs` runs each of these.

## Rules worth knowing

- **Who the Agent acts for.** The account holder: the `lanternbox` account in the run's `binding.json` whose `account_id` is the seed's. If the owner profile carries a `person_id`, it must be that account's `owner_person_id`. Identity is matched by `person_id`, never by a profile name.
- **Watched and marked stay apart.** Only `playback.recorded` writes a history row. `progress.set` changes one progress row, marks it `set_by: agent`, and its activity row keeps the value it replaced.
- **Ceilings.** A profile sees a title only if the title's rating is at or below its ceiling. The same check is used by profile-scoped reads, `watchlist.add`, `progress.set` and `playback.recorded`. Lowering a ceiling deletes nothing: lists leave out the rows above it, and they return when the ceiling is raised.
- **Time.** Lanternbox has no timers and no clock event, and Agent reads and writes never move the clock. Infra moves it with an event or `env.advance_time`, which runs no handler but raises the App revision, so a write prepared earlier returns `stale_version`. Four things depend on the clock and none is stored: a title's `availability`, whether an episode is released (and so `next_up`), the account's `status`, and the plan in effect. `env.snapshot` returns stored state, so a grader recomputes these from the snapshot's `virtual_now`; `src/derive.cjs` is the pure module the handlers themselves use (`availability`, `nextUp`, `account`, `canSee`). One clock jump and many small steps leave identical data and identical readings.
- **Boundaries.** A title is `upcoming` before `available_from`, `leaving_soon` from exactly 14 × 24 hours before `available_until`, and `expired` at `available_until`. An account is `active` before `paid_through`.
- **IDs.** Records created during a run get `prof-r<n>`, `hst-r<n>`, `chg-r<n>` and `ntf-r<n>`, counted per kind in commit order from 1 after a load or reset. A film is its own playable: its playable ID is its title ID.

### Plan and billing

The account stores `plan_id`, `paid_through` and at most one pending change with its due time. Everything else is read from those and the clock.

| Situation | Plan in effect | Profile limit | Next charge | Status |
| :--- | :--- | :--- | :--- | :--- |
| Upgrade | the dearer plan, at once | the dearer plan's | its price | unchanged |
| Downgrade asked for, before `paid_through` | the current plan | the cheaper plan's, at once | the cheaper plan's price | `active` |
| Clock reaches `paid_through` with a pending downgrade | the cheaper plan, by time, with no event | the cheaper plan's | the cheaper plan's price | `past_due` until a charge is paid |
| Paid charge for the next period | the plan in effect; a due downgrade is stored and one `plan.changed` notification written | that plan's | that plan's price | `active`, `paid_through` moved |
| `paid_through` passes with no paid charge, or the charge fails | unchanged | unchanged | the same period, still due | `past_due`, then `suspended` exactly 7 × 24 hours after `paid_through` |
| Cancellation asked for | the current plan | the current plan's | none | `active` until `paid_through`, then `cancelled` |

One change can be pending. A second downgrade replaces the first. Choosing the current plan while a downgrade is pending clears it (`effect: pending_cleared`). `plan.cancel` replaces a pending downgrade, and `plan.resume` then clears the cancellation without bringing the downgrade back. `plan.change` while a cancellation is pending returns `invalid_state`: undo it with `plan.resume` first. A paid charge clears a pending cancellation and returns a `past_due`, `suspended` or `cancelled` account to `active`. Writes are refused with `account_inactive` while the account reads `suspended` or `cancelled`; `past_due` can still be changed. A charge row keeps the amount the task sent beside the plan and price the App expected.

## Events

Six events through `env.apply_event`: `lanternbox.playback.recorded`, `lanternbox.catalog.title_added`, `lanternbox.catalog.episode_released`, `lanternbox.catalog.leaving_set`, `lanternbox.billing.charged`, `lanternbox.device.signed_in`. `examples/scenario.json` is one valid event; the tests hold one of each.

`playback.recorded` names its profile by `profile_id` or by `profile_name`, exactly one of them. Profile names are unique, so a task can write a viewing for a profile the Agent is expected to create. The name is compared after trimming and case-folding, against the names at the time of the event.

Every rejection is `invalid_event` with a message, leaves state and clock unchanged, and is read with `env.event_status`: a duplicate title, playable, device or charge ID; an unknown profile, device, title or playable, or a name no profile has; a viewing on a signed-out device, of a title that is restricted for the profile or not available at that time, of an unreleased episode, beyond the runtime, starting after the event or before 2025-01-01, or while the account is suspended or cancelled; an end date that is not after the event; and a charge whose period does not start at the account's `paid_through`.

Notifications are an in-App log (`notifications.list`) written for what events do, never for the Agent's own writes and never for time alone: `episode.released` and `title.leaving` (one for each profile that has the title on its watchlist or in progress, may see it, and has that setting on), `payment.failed`, `plan.changed` and `device.new`.

## Records for graders

- **App state in the snapshot** holds every profile's progress, history and watchlist and the `activity` rows: `seq`, `at`, `actor` (`agent` or `event`), `action`, `object_id`, `profile_id`, `request_id` or `event_id`, `replaced` (old values of what changed) and, for `profiles.delete`, `removed` (the counts of history rows, progress rows and watchlist entries, the same as in the tool result). There is one row for every committed Agent write and every applied event, and none for a read, a refusal, a replay or the passing of time.
- **Core audit rows** give the tool, the decision with its reason, and the versions before and after. They hold no arguments and no request ID, and a replay writes no audit row.
- **The Agent execution trace** gives arguments and results.

So: which profiles, titles and dates the Agent read comes from the trace only. A committed write is matched to the trace by the activity row's `request_id` and to its audit row by the committed version. Rejected calls are counted from the deny audit rows and their reasons. Replays appear only in the trace, as results carrying `duplicate: true`. Take the snapshot before a reset: reset restores the most recently loaded seed and its clock and clears the audit and receipts.

## Data

`fixtures/minimal.json` is generated by `scripts/build-fixtures.cjs`. The catalog and plans are written directly; everything the household did is replayed, with a fixed seed, through the App's own handlers (tools for the account holder, events for viewings, charges, devices and catalog changes). It holds 3 plans; 1 account on `standard` with 4 profiles (Sana, the account holder; Dele; Timi, a kids profile; Auntie Bisi, a relative); 60 titles (40 films, 20 series with 269 episodes) across the five ratings, 6 with an end date; 364 viewings, 298 progress rows, 22 watchlist entries, 5 devices, 24 charges, 17 notifications and 427 activity rows, dated from 2025-01-02 to 2026-11-16. `fixtures/clock.json` sets 2026-11-18T09:00:00-08:00. All people, titles, episode names and synopses are invented. A task loads its own household with `env.load_seed`; the seed schema accepts every record type above, including an account that is already past due or has a pending change. Catalog dates may be any date; records of what the household did run from 2025-01-01 up to the loaded clock.

## The page

`gui/index.html` and `gui/src/app.js` are the business page, declared in `contribution/gui.json` (`pale.web`) and served by the shared Web Host over the Agent MCP bridge. Four views: Browse, Profiles, Plan and billing, Notifications. See [`gui/README.md`](gui/README.md).

## Plan and implementation

Review items from PR #215, as handled:

1. **Policies.** Every profile-scoped tool takes the profile as `id`, and `profiles.update` passes its changes in `patch`, so Core's own check applies. Per-profile reads are restricted the same way. The MCP run loads a policy that allows writes on one profile only.
2. **Profiles the Agent creates.** A viewing event names its profile by ID or by its unique name. T15 and the MCP run create a profile and then apply a prewritten viewing for it, with a control where no profile has the name.
3. **Downgrade and billing.** The downgrade takes effect by time at `paid_through`. With no paid charge the account reads `past_due`, then `suspended` 7 days later. One change can be pending. The table above gives the plan, the limit and the amount due in each case; T12–T14 test each row.

Suggestions taken: the fixture history starts in January 2025; a profile deletion returns the removed counts and records them in its activity row. Related work: #216 (Tidepool Audio) is a podcast and music service shared by a family; Lanternbox is film and series viewing with maturity ceilings, availability windows and season order, and holds no audio. #20 covers a subscription-cancellation flow, #124 and #11 family settings and purchases on a game platform, #194 a photo library; none holds viewing state. Task #83 describes the shared-series need.

Differences from the approved plan:

- **A browser page was added.** The plan said MCP-only; reviewers now ask Environments for a GUI.
- **Argument names.** The plan passed the profile as `profile_id`; it is `id`, with changes in `patch`, for the reason in item 1.
- **Downgrade by time.** The plan's state table applied a downgrade with the next paid charge. It now applies at `paid_through` by the clock; the paid charge stores it and writes the `plan.changed` notification.
- **`past_due` without a failed charge.** The plan reached `past_due` through a failed charge; it is now read from `paid_through` alone, so an account with no charge event behaves the same.
- **Pending changes.** `plan.change` while a cancellation is pending returns `invalid_state`, and choosing the current plan clears a pending downgrade. The plan left both open.
- **History starts in 2025**, so the counts are larger than planned: 364 viewings over 23 months against about 180 over 3 months, 298 progress rows against 45, 24 charges against 6, 17 notifications against 14, 269 episodes against about 260. Titles, plans, profiles, devices, watchlist entries and end dates are as planned.
- **The fixture is generated**, by replaying history through the App's handlers, instead of being authored by hand. `--check` reproduces it byte for byte, and the fixture test does the planned consistency checks.
- **Fixture clock.** It is 2026-11-18T09:00:00-08:00, the repository registry's start time. The plan's example viewing of 14 November is part of the fixture history; its other examples dated before the clock are tested at later times.
- **History above a lowered ceiling is not rejected by `validateSeed`.** The plan listed that check, but Core validates after every write, and lowering a ceiling must keep earlier rows. Every other planned check is there.
- **Events.** `playback.recorded` accepts `profile_name` and an optional `seconds_watched`; `billing.charged` accepts an optional `charge_id`.
- **Smaller choices the plan left open.** A title that is not out yet can be put on a watchlist (`unavailable` is for an expired one). A profile follows a series it has any progress on, and a film it has started and not finished. `profiles.create` accepts an optional `person_id` from the run binding. The charge amount is recorded as sent, beside the expected one.

Not in this version, as in the plan: playback itself, artwork and trailers, recommendations and search ranking, downloads, simultaneous-stream limits, profile locks and PINs, profile transfer, extra-member add-ons, gift cards, payment methods and refunds, proration, taxes, regional catalogs, subtitles and audio settings, and delivery of notifications outside the App.

Known limits: the 14-day and 7-day windows ignore daylight-saving changes (exact multiples of 24 hours); one account per App instance; an event that names a profile nobody created is rejected, not stored; text limits count UTF-16 units.

## Workflow-to-test mapping

| Workflow | App-only tests | Real MCP | Browser |
| :--- | :--- | :--- | :--- |
| W1 | T01–T04 | a title expires by the clock; a read narrowed to one profile | one series as two profiles; the kids catalog; read-only profile |
| W2 | T05–T08 | write, replay, conflict, stale version; the replaced value and no viewing row | mark watched, set position, list add and remove, hide and unhide, refused write |
| W3 | T09–T11 | deletion counts against the snapshot; a profile created by the Agent then reached by an event | create, edit, delete with its counts, sign out, refused limit and ceiling |
| W4 | T12–T14 | downgrade at the boundary, `past_due`, `suspended`, recovery by a paid charge | upgrade, pending downgrade, undo, cancel, refused downgrade, `past_due` after the clock moves |
| All | T15–T16, fixture test | seed floors, writes on one profile only, reset ×20, one jump against daily steps, run isolation | reload, event after refresh, stale form, lost response, no management access, 390 px, no script errors |

Still for human review: realism of the catalog and the household's history, and that every person, title and episode name is invented.
