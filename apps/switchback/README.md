# Switchback

Switchback is a resettable campground reservation App with synthetic data, built for the approved proposal in [#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25) ([`proposals/environment/switchback.md`](../../proposals/environment/switchback.md)). Its workflows follow Recreation.gov's public pages; the $10 change fee is modelled on its [rules page](https://www.recreation.gov/rules-reservation-policies). The 15-minute cart hold, release schedule, refund ladders, cutoffs and alert effects are Switchback's own rules; `contribution/dataset.json` lists each rule with its source and access date. A booking can check out cleanly and still be wrong for the people going, and the end state shows which happened.

This is **M2 with the delivery evidence** of `docs/submission-evidence.md` (#260): workflows 1-4 through MCP tools and nine pages on the public business Web Host, per-facility policy records, three reset fixtures with default scenario schedules, reset, business tests, checks (a) to (e) and (g), and a publisher script that delivers notices to real Mail. Check (f), the independent reproduction, and the human read-through of the fixtures are still open (see [Remaining work](#remaining-work)).

**Evidence:** [`evidence/README.md`](evidence/README.md) is the delivery evidence index: Recreation.gov reference screenshots, the ordered GUI sequences for every workflow with their error, cancel and stale paths ([`evidence/sequences.md`](evidence/sequences.md)), the Mail dependency row, and the dataset coverage report ([`evidence/coverage.md`](evidence/coverage.md)).

## Run it

Node.js 18+. The business tests need no packages; the browser test needs the repository's Playwright dev dependency.

```sh
# From this directory: business tests (with checks (a) and (b) and the fixture checks) and the example event
npm test
npm run example

# From the repository root: real Core with separate Agent and Infra MCP connections
node runtime/cli.cjs verify --app apps/switchback
node runtime/cli.cjs verify --app apps/switchback --with examples/apps/mail
node apps/switchback/tests/platform-checks.cjs   # (c), (g), retries and stale versions
node apps/switchback/tests/schedule-checks.cjs   # (d) and (e)
node apps/switchback/examples/publish-to-mail.cjs

# Dataset coverage (also checked by npm test)
node apps/switchback/scripts/coverage-report.cjs --check

# Pages
node apps/switchback/examples/web-demo.cjs --fixture minimal
npm ci && npx playwright install chromium && node apps/switchback/tests/browser.cjs

# Evidence screenshots (rewrite evidence/screens and evidence/sequences.md; reference pages need network)
node apps/switchback/evidence/capture.cjs
node apps/switchback/evidence/capture-reference.cjs
```

## Workflows

All times are facility time at a fixed UTC offset, and follow the environment clock (`ctx.virtual_now`). Switchback has no scheduler or clock event. Hold expiry, rung changes, no-show release, refund posting and alert activity are computed from stored due times at each read and write. Reads never store anything. The next write or event commits what fell due, and creates any notice that falls due then.

| # | Workflow | Tools | Errors |
| :--- | :--- | :--- | :--- |
| 1 | Search and site detail. Sites list electric hookup and amperage, maximum vehicle length, ADA access, walk-in distance, occupancy and pets. Filters are off by default, and an unknown attribute never matches a filter. Night states are `unreleased`, `open`, `held`, `booked` and `closed`; nights release 180 days ahead at 07:00. | `facilities.search`, `facilities.get`, `sites.search`, `sites.get`, `policy.get` | `not_found` |
| 2 | Reservation lifecycle: 15-minute hold, preview, confirm, receipt. The preview pre-fills the default saved equipment, the companions marked for the party and the default card. The booking form checks only equipment length, party size and pets. | `cart.hold`, `cart.release`, `reservations.preview`, `reservations.confirm`, `account.get`, `wallet.list`, `wallet.set_default`, `equipment.save`, `companions.save` | `night_in_past`, `not_yet_released`, `site_taken`, `site_closed`, `hold_expired`, `equipment_exceeds_site`, `occupancy_exceeded`, `pets_not_allowed`, `preview_stale`, `preview_consumed`, `payment_declined` |
| 3 | Modify, cancel and no-show. The refund ladder is the facility's policy record. A change holds the new nights, re-runs workflow 2's checks and releases the original nights at confirm, which cannot be undone. Without check-in the site is released at 21:00 on arrival day, or 12:00 the next day after a late-arrival notice. | `reservations.list`, `reservations.get`, `reservations.modify.preview`, `reservations.modify.confirm`, `reservations.cancel.preview`, `reservations.cancel.confirm`, `reservations.late_arrival` | `night_in_past`, `outside_change_window`, `different_facility`, `already_cancelled`, `already_checked_in`, `invalid_state`, `notice_too_late`, `preview_stale` |
| 4 | Conditions and alerts. An active alert marks a stay affected without changing its state or ladder. An active electrical outage removes its sites from the electric filter. A closure cancels the whole stay with a full refund. | `alerts.list`, plus the scenario events below | `invalid_event` |

Every tool name carries the `switchback.` prefix. Writes take `expected_version` and `request_id`. Core returns `stale_version` for a stale version and `idempotency_conflict` for a reused request ID with different arguments. A retried write with the same request ID returns the original receipt.

### Refund policy records

Each facility points to a policy record in the seed. A rung ends at a time on a given day before arrival and sets the cancellation refund (a fixed fee, the first night and/or a percentage kept) and whether a change is allowed and at what fee. The fixture has two records:

- `pol-standard` (the proposal's default ladder): rungs change at 00:00 on the 14th and 4th day before arrival and at 15:00 on arrival day. A cancel refunds everything; all but $10; all but $10 and the first night; nothing. Changes cost $10 in the first two rungs.
- `pol-flex-3day`: free changes and cancellations until 18:00 three days before arrival, then 50%. These are Task #113's terms.

### Scenario events

Infra applies these with `env.apply_event`. An event naming an unknown record, or not applicable in the current state, is rejected with `invalid_event` and changes nothing.

| Operation | Effect |
| :--- | :--- |
| `switchback.inventory.claimed` | A competing booker takes each listed night that is `open`; held or booked nights are skipped. |
| `switchback.alert.posted` | New alert. Affected holders get a notice. |
| `switchback.alert.updated` | Replaces kind, sites, window or text. Affected marks and the electric filter are recomputed; holders whose status changed get a notice. |
| `switchback.alert.cancelled` | Ends the alert at the event time and lifts its effects. Expiry needs no event. |
| `switchback.closure.ordered` | Closes nights; cancels each covered stay (`closure_cancelled`), including one already checked in, with a full refund posting three days later, and a notice. |
| `switchback.reservation.checked_in` | `confirmed` to `checked_in` from arrival day on. |

[`examples/scenario.json`](examples/scenario.json) is a valid closure event; [`examples/run.cjs`](examples/run.cjs) applies it to the fixture.

## Notices and Mail

Confirmations, changes, cancellations, closures, alerts, no-show releases and posted refunds create a notice in the account's `notices`, in the same commit as the business change. Each notice holds a full CloudEvents message for Mail 1.3.0's `channel.email` receive contract (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), with the notice ID as the CloudEvents `id`. Every commit validates these messages against a pinned copy of Mail's wire schema ([`schemas/router-message.schema.json`](schemas/router-message.schema.json)). The publish direction is declared in `contribution/contribution.json`. Switchback does not record delivery.

No host-side publisher exists on main, so the package ships one: [`examples/publish-to-mail.cjs`](examples/publish-to-mail.cjs). The proposal's `app:verify --with examples/apps/mail` command also passes (see below), but it only adds Mail to the assembly and does not start Messaging.

**Required public dependencies of the publisher.** Besides this package it needs, from the public checkout: the pinned runtime (`runtime/`, including `runtime/messaging/`), Mail 1.3.0 (`examples/apps/mail/`) and the repository-level Mail registry [`examples/registry.mail.json`](../../examples/registry.mail.json), which both the script and the Messaging config ([`examples/messaging/config.json`](examples/messaging/config.json), field `registry`) name. A copy holding only this package, the runtime and Mail fails until that registry file is present. The App itself (tools, pages, checks) needs none of them.

- **What it does:** applies the example closure event through real Core, starts Messaging with `runtime/messaging/service.cjs --publisher switchback` and the trusted config in [`examples/messaging/config.json`](examples/messaging/config.json), calls `router.publish` for each stored notice, and reads each one back with Mail's own `mail.get` using `receipt.event_id`.
- **When it runs:** after the write or event that creates the notices and before the next `env.advance_time`, because Messaging delivers at the receiver's current virtual time.
- **Which notices are new:** it offers every stored notice in creation order, with the notice ID as both `request_id` and CloudEvents `id`. Messaging keeps the receipts, so a notice it already delivered returns `duplicate: true` with its original `event_id` and Mail does not change.
- **Outcomes it shows:** a committed delivery read back from Mail; a retry that is deduplicated; a rejection before delivery, staged with a config that has no grant for the recipient ([`config-no-grant.json`](examples/messaging/config-no-grant.json)), which returns `recipient_not_authorized` and leaves both Mail and Switchback unchanged (in the reference router a refusal by Mail itself halts the run, so the rejected case uses a missing grant); and an **unknown acknowledgement**: Mail commits the message but the reply to Messaging is lost. That case is staged the way `runtime/messaging/tests/test_time_trace.cjs` stages it, without changing `runtime/`: the script runs the reference router in-process and makes its receiver call throw after Mail's `env.apply_event` returns. Messaging answers `unknown` (`receiver_unconfirmed`, `stop_run: true`, the attempted `event_id`, no commit time) and halts the run, so the next publish is refused with `run_halted`. The publisher stops offering notices and reconciles from Mail's own records instead of retrying: Mail's Infra `env.event_status` shows the event committed once and `mail.get` returns the message, while Switchback still holds its notice and business result. As the proposal says, such a run is stopped for reconciliation and not scored.
- **Evidence output:** `--evidence FILE` writes the result as JSON: App and Mail versions, the `router.publish` request (notice ID as `request_id` and CloudEvents `id`), each receipt and the Mail message read back. Recipient or business confirmation is not applicable: the notices go to the account holder's own Mail account.

`node runtime/cli.cjs verify --app apps/switchback --with examples/apps/mail` (or `npm run app:verify -- --app apps/switchback --with examples/apps/mail`) runs the public verifier with Mail 1.3.0 added to the assembly, as the proposal names it. It checks that Switchback loads and runs next to Mail; it does not start Messaging or deliver anything. The publisher script above is the delivery proof.

## Pages

Nine pages, declared with the optional `pale.web` extension in [`contribution/gui.json`](contribution/gui.json) (`gui_ref` in `contribution.json`) and served by the public business Web Host (`runtime/web/server.cjs`). The Host serves only [`gui/index.html`](gui/index.html) and [`gui/src/app.js`](gui/src/app.js), so the pages are views inside that one controller, picked by the URL fragment:

| Page | Route | Tools it shows |
| :--- | :--- | :--- |
| Search | `#/search` | `facilities.search`, `sites.search` with every filter |
| Facility, with alerts | `#/facility/<id>` | `facilities.get`, `alerts.list` |
| Site | `#/site/<id>/<arrival>/<departure>` | `sites.get`, `facilities.get`; hold with `cart.hold` |
| Checkout preview | `#/checkout` | `account.get`, `reservations.preview`, `reservations.confirm`, `cart.release` |
| Receipt | `#/receipt/<id>` | `reservations.get`, `wallet.list` |
| Reservations | `#/reservations/<state>` | `reservations.list` (the state filter is the tool's) |
| Reservation detail | `#/reservation/<id>` | `reservations.get`; modify, cancel and late-arrival panels with their previews and confirms |
| Account and wallet | `#/account` | `account.get`, `wallet.list`, `wallet.set_default`, `equipment.save`, `companions.save` |
| Policy | `#/policy/<facility>` | `policy.get` |

Each page renders what its tools return. The controller has no business rules and no browser store: it keeps only the route, the last search form, the hold, preview and form choices of the current checkout, and the outcome of the last action. Writes carry the version the page last read and a request ID that a retry reuses. Checkout starts from the saved defaults by leaving those fields out, so the tool's own pre-fill applies and the stale card and trailer show on the preview, with no warning (the routine path is meant to check out cleanly).

The pages follow the reference product's layout where it fits the workflow (compared screen by screen in [`evidence/README.md`](evidence/README.md)), without copying its branding:

- **Readable records.** Campground and site names lead; reservation, hold and payment IDs are secondary. Dates read as "Fri, Jun 18, 2027" and times as "Fri, Jun 18, 2027, 9:00 PM (UTC-07:00)" in the facility's fixed offset, with the zone shown. Search results are an availability matrix with a legend (A available, R reserved, H in someone's cart, X closed, NR not yet released, P already past).
- **Previews as sentences.** Booking, change and cancellation previews read as labelled sentences and a refund table, each with a way back (Back to details, Discard change, Keep reservation). Discarding a change releases its hold.
- **Outcomes that stay.** A receipt (reservation, amount, payment ID) or an error stays on the page where the user acted until the next action: errors sit next to the form or button that caused them, and the status line repeats them. A `stale_version` error offers a Refresh that re-reads the page and keeps the checkout in progress.
- **Confirmations.** Releasing a hold, removing a companion and filing a late-arrival notice ask first in a dialog. Booking, changing and cancelling confirm only from a preview.
- **No control that is certain to fail.** Holding nights that are reserved, closed, past or not yet released, confirming with an expired card, and changing a stay in a period that does not allow changes are disabled or replaced with the reason. Write controls the run's permission profile does not list are hidden, with a note (the `browse` profile hides the confirms and Make default; the read-only `scenario` profile hides every write), and the Host refuses a direct request for them.
- **Missing records.** An unknown ID shows a Not found page that replaces the previous content and title.
- **Text size.** App text is 12px or more and body text 14px; the Host's shared status line and sidebar footer are raised to 13px.

The 15 icons are 24x24 PNG files drawn from simple shapes by [`gui/icons.cjs`](gui/icons.cjs), self-made and dedicated to the public domain (CC0 1.0). The GUI content policy disables SVG and the Host's image policy allows `blob:` but not `data:` URLs, so the PNG bytes are embedded in `app.js` and turned into `blob:` URLs in the browser. `node gui/icons.cjs --check` and a business test confirm that the embedded icons decode to the pixels the drawing code produces (pixels rather than compressed bytes, because zlib output differs between platforms). Styles that `/shared/style.css` lacks are added as a constructed stylesheet, which the Host's style policy allows.

### Start the pages

```sh
node apps/switchback/examples/web-demo.cjs --fixture minimal          # or high-country, desert-rivers
node apps/switchback/examples/web-demo.cjs --fixture high-country --until 2026-06-20T12:00:00-06:00
```

Open the access link it prints. The clock needs care. Core starts a new instance at the registry's `initial_time`, and the shared `apps.registry.json` uses 2026-11-18 for every App, while the minimal fixture's clock is 2027-05-20 (and the other fixtures have their own). At 2026-11-18 the June 2027 nights are unreleased and the seeded upcoming stays read as months away. So the script starts the Host, then acts as the trusted Infra caller: it loads the chosen fixture with `env.load_seed` at that fixture's clock, which also makes that clock the reset point. It loads only when the run is not already at that fixture's baseline (or with `--reload`), so restarting keeps earlier changes. `--until` applies the fixture's default schedule up to that instant and advances the clock. When `apps.registry.json` has no Switchback entry the script uses a disposable registry whose `initial_time` is `fixtures/clock.json`. Starting the Host directly (`node runtime/web/server.cjs --app switchback`) works too, but then the clock is 2026-11-18 until Infra moves it.

The Host's own permissions apply: it offers only the `sandbox` and `scenario` profiles; Infra can reset a run to `browse` or `full`. The browser test, [`tests/browser.cjs`](tests/browser.cjs), drives all four workflows through the pages and compares them with the same tools and Infra snapshots (54 checks: search results and the availability matrix, night states, disabled holds with reasons, a stale page refused with `stale_version` and its Refresh, stale defaults on the preview, Back, Discard and Keep, an expired card, booking with the receipt kept visible, change fee, cancel refund, the late-arrival dialog, an alert invisible until Infra applies it, wallet, equipment and companion writes with the removal dialog, policy text, Not found, 12px text on every page, the `browse` and read-only profiles and a direct forbidden write, icons, 390 px layout, no console or content-policy errors). Screenshots go to `.artifacts/web/switchback/`. The curated, annotated sequences in `evidence/` come from [`evidence/capture.cjs`](evidence/capture.cjs), which checks each step the same way.

**A run inside 2025-2026.** The minimal fixture's clock (2027-05-20) follows the proposal's examples, which are set in June 2027. `--fixture desert-rivers` (clock 2026-10-02) and `--fixture high-country` (clock 2026-06-12) start the pages inside the dataset window; sequence S12 in the evidence books a stay at the desert-rivers clock.

## Time

Agent reads and writes never move the clock. Time moves only when Infra calls `env.advance_time` or applies an event at its `at` time. A hold that should lapse, a refund rung that should pass or a no-show release therefore happens within a task only if the task's scenario schedules a clock advance or an event past that deadline.

## Permissions

`fixtures/policies.json` has four profiles. `scenario` allows only reads and `sandbox` allows every tool, matching the reference Apps. `browse` leaves out the three confirms and `wallet.set_default`, and `full` allows them. Switchback keeps no approval state; a task harness picks the profile.

## Data

Three reset fixtures, written by [`fixtures/generate.cjs`](fixtures/generate.cjs) from fixed seeds (the same seeds give the same bytes; `node fixtures/generate.cjs --check` and a test confirm it). All use one account (Dana Okafor) and the identity binding in `fixtures/binding.json`. Every record is synthetic: no real facility, person, payment or Recreation.gov record is used, and none is presented as an observed fact. The generator and its fixed text (facility names and descriptions, alert texts, companion names) were written with AI assistance; the records themselves come only from the script. See [`contribution/dataset.json`](contribution/dataset.json). A human read-through of the fixtures is still pending.

| Fixture | Clock | Facilities | Sites | Reservations | Seeded claims | Schedule events |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| [`minimal.json`](fixtures/minimal.json) (manifest seed) | 2027-05-20 09:00 -07:00 | 3 | 12 | 27 | 0 | 35 |
| [`high-country.json`](fixtures/high-country.json) | 2026-06-12 08:00 -06:00 | 7 (-06:00 and -07:00) | 308 | 14 | 1,237 | 38 |
| [`desert-rivers.json`](fixtures/desert-rivers.json) | 2026-10-02 07:30 -07:00 | 6 (-07:00 and -08:00) | 261 | 23 | 1,047 | 38 |

`minimal.json` is the M1 fixture plus five stays from the quiet-month pass below: two policy records, three cards, 27 reservations from 2025-01-02 to the two upcoming stays. The saved defaults are stale on purpose. The default card belongs to Dana's mother, one card is expired, the default equipment is an old 18 ft trailer, and one site has an unknown vehicle length.

The two larger fixtures follow the proposal's scale: 6-8 facilities with two or three policy records (the default ladder, the 3-day/50% record and a week-out record), 250-400 sites covering all six attributes with some unknown values, three cards under two cardholders (one expired, the default is Carol's), 2-3 equipment records, 5-6 companions, history from early January 2025 and four upcoming stays. Other bookers' claims fill part of the 180-day released window (busy weekends, quiet weekdays); nights beyond it are unreleased by rule, so no inventory is seeded there. Infra loads them with `env.load_seed` at the clock above; the manifest seed stays `minimal.json`.

Seeded history is on or after 2025-01-01; task clocks and every scheduled event are on or after 2026-01-01. A test checks every date in every fixture, schedule and claim-times file.

### Coverage of 2025-01 to 2026-12

[`evidence/coverage.md`](evidence/coverage.md) (and [`coverage.json`](evidence/coverage.json)), written by [`scripts/coverage-report.cjs`](scripts/coverage-report.cjs), counts each fixture's represented dates (bookings, check-ins, cancellations, stay nights, payments, alerts, closures, other bookers' claims, saved-record edits) in `America/Phoenix`, with per-fixture SHA-256, distinct-date counts, a month-by-month table and the gaps. `npm test` fails if the committed report differs from a fresh run, and `tests/platform-checks.cjs` checks that the counted records load through `env.load_seed` and come back from the Agent tools.

- `minimal` is the full-window source: its clock is after the window, so every month of 2025 and 2026 is past activity.
- `high-country` and `desert-rivers` have clocks inside the window. Their history runs from January 2025 to the clock; after it they hold only future bookings, up to the end of the 180-day released window (high-country's ends 2026-12-08 by rule).
- The main history loop skips about a third of its 30-day steps, which had left some months empty. `fillQuietMonths` in the generator now adds one stay of the same account for each such month (a stay in season, otherwise a booking made that month for a later trip), with its own random stream, so earlier records keep their bytes and IDs. The added reservations are listed in the report and in `dataset.json`.

### Schedules and hidden values

Each fixture has a default scenario schedule in [`fixtures/schedules/`](fixtures/schedules) with 30-50 events (competing claims, alerts posted, updated and cancelled, closures, a check-in). Applied in order, they check a stay in, cancel one by closure with a refund that posts later, release a no-show, and mark and unmark stays affected. Claim instants were drawn once from OS entropy (`crypto.randomInt`) into [`fixtures/evaluator/`](fixtures/evaluator) and are never regenerated; the generator merges them into the schedule. These files are evaluator and Infra input: no tool, page or business source reads them, and a test enforces that.

Fixture checks, in `tests/fixture-checks.cjs` (run by `npm test` and so by the verifier): each fixture passes the seed schema and `validateSeed`; IDs are unique in every collection; charges equal stay totals and refunds match their history rows to the cent; no site night is held by two stays or claims; every search filter matches some open sites and excludes others, and an unknown attribute never matches; each schedule has 30-50 events in time order that all apply.

## Checks

| Check | Where | Result |
| :--- | :--- | :--- |
| Business rules and every named error; each enforced rule mapped to its policy text and the preview or page it affects | `tests/business.test.cjs` | `npm test` |
| (a) Anchor runs: the reference passes every check; do-nothing fails exactly the checks that need a write; each wrong run fails exactly its declared checks | `tests/business.test.cjs`, `tests/scenarios.cjs`, `tests/checks.cjs` | `npm test` |
| (b) Mutation: 26 single-field mutants of the five reference end states; each fails its own check and only its listed derived checks; checks no mutant fails are reported (none) | `tests/mutation-checks.cjs` | `npm test` |
| Fixtures and schedules, as listed under Data | `tests/fixture-checks.cjs` | `npm test` |
| Dataset coverage: the committed `evidence/coverage.*` match a fresh run of `scripts/coverage-report.cjs`; no fixture has an empty month before its clock | `tests/fixture-checks.cjs` | `npm test` |
| Coverage loading: each fixture loaded with `env.load_seed` returns every counted reservation, payment and alert, with its counted date, through the Agent tools | `tests/platform-checks.cjs` | real Core |
| (c) Reset: 20 resets after the minimal fixture's anchor runs (audit exported first), and 20 per larger fixture after schedule events and Agent writes; each restores the loaded hash and clock with no outgoing notice left | `tests/platform-checks.cjs` | real Core |
| (d) Replay: each of the three schedules applied once with the clock jumping event to event and one `env.advance_time` jump to the end, once in six-hour `env.advance_time` steps with Agent reads between; same state hash, notices and Agent view | `tests/schedule-checks.cjs` | real Core |
| (e) Hidden values: an observer reads the Agent tools every 12 hours; no output shows an alert, update, cancellation, closure, check-in or claimed night before its event; copies differing only in the claim-times file (all claims redrawn, or one late claim redrawn) give identical traces until the first differing claim; the page files hold no scheduled value | `tests/schedule-checks.cjs` | tool handlers |
| (g) Permissions: `browse` leaves the three confirms and `wallet.set_default` out of discovery and refuses each with `permission_denied`, hash and version unchanged; `full` lists them and each commits | `tests/platform-checks.cjs` | real Core |
| Retries, stale versions and consumed previews | `tests/platform-checks.cjs` | real Core |
| Pages against the tools, in Chromium (54 checks) | `tests/browser.cjs` | Web Host |
| Ordered GUI sequences for every workflow, each step checked against the tools or a snapshot | `evidence/capture.cjs` | Web Host |
| Public verifier (MCP discovery, schemas, history load, event, reset, isolation, restart), alone and with Mail in the assembly | `node runtime/cli.cjs verify` | real Core |
| Delivery to real Mail through Messaging: committed and read back, retried, rejected for a missing grant, unknown acknowledgement halting the run and reconciled from Mail | `examples/publish-to-mail.cjs` | Messaging |
| (f) Independent reproduction by a second person | | M3 |

(e) runs the tool handlers directly rather than through Core, so the 2,500 reads per trace take seconds; the first probe of each trace compares both paths. Core adds only the status and version fields to those outputs.

## Remaining work

- Check (f), an independent reproduction from a clean checkout by someone who did not implement the flows: M3.
- A recorded human read-through of the three fixtures by the author (the proposal's data deliverable, including the fixed text written with AI assistance); `dataset.json` review status stays `pending` until then.
- The `apps.registry.json` entry: adding Switchback trips `runtime/tests/clock.test.cjs:64` (`m.configs.size === 7`), which is outside this package. The one-entry change is ready and waits on the maintainers' answer in #25.

## Dependencies

Public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. `required_apps` is empty: the package runs with only its own files and the runtime. Mail 1.3.0 is an optional publish target; Calendar 1.3.0 is used only through its own Agent tools.

| Dependency | Needed for | Required? |
| :--- | :--- | :--- |
| Public runtime 1.6.0 (`runtime/`) | everything except `npm test` | required |
| Mail 1.3.0 (`examples/apps/mail/`) | the Mail publisher and `verify --with examples/apps/mail` | optional (workflows 1-4 complete without it) |
| `examples/registry.mail.json` (repository level) | the Mail publisher and `evidence/capture.cjs` (sequence S9) | required public dependency of those two scripts |
| Playwright with Chromium (repository dev dependency) | `tests/browser.cjs`, `evidence/capture*.cjs` | required for the browser checks only |
| Python 3 with Pillow | shrinking evidence PNGs in `evidence/capture*.cjs` | optional (without it the PNGs are left uncompressed) |
