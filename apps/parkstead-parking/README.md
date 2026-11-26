# Parkstead Parking

Parkstead is a resettable, independently branded synthetic parking-reservation
marketplace for PALE. Version 1.0.0 implements search/compare, quote/checkout,
upcoming reservation changes and cancellation, and explicit recovery from a
facility closure. It uses fictional facilities, prices, policies, vehicles,
payment metadata and entry passes. It never contacts a live parking, payment,
mapping or garage service.

Requires Node.js 18 or newer and the public runtime 1.6.0 / Core API 1.2.0.

## Run locally

```sh
cd apps/parkstead-parking
npm test
npm run example
npm run test:web
npm run test:web:browser   # requires repository Playwright + Chromium
npm run example:mail      # uses the repository runtime and real Mail receiver
```

From the repository root:

```sh
npm run app:verify -- --app apps/parkstead-parking --output .artifacts/parkstead-parking.json
node runtime/web/server.cjs --app parkstead-parking --run parkstead-demo --profile sandbox
```

Open the access link printed by the Web Host. Use a fresh run ID for a clean GUI
session. `sandbox` permits the declared business writes. A Task-like `scenario`
profile exposes only the read operations listed by `fixtures/policies.json`.

## Business workflows

| Workflow | Agent tools | Important failure/control behavior |
| --- | --- | --- |
| Search and compare | `parking.search`, `parking.facility.get` | Invalid windows, no rates, closed/unavailable facility, unsupported vehicle and sold-out inventory are explicit. Prices use integer cents, 15-minute units rounded up, and half-up tax rounding. Distances are integer meters. |
| Quote and reserve | `parking.quote.create/get`, `parking.reservation.create` | Quotes preserve rate/facility versions, itemized price, policy and expiry. Expired, invalidated, sold-out and reused quotes do not create a partial or duplicate booking. |
| Modify or cancel | `parking.reservation.requote/modify`, `parking.reservation.cancel.preview/cancel` | A change requires an accepted reservation-bound quote. Cancellation confirms the exact previewed fee/refund. Started/completed/cancelled/replaced bookings reject the upcoming flow. |
| Facility disruption | `parking.disruption.alternatives/resolve` | No automatic relocation. Replacement quotes bind reservation, facility and rate versions and expire. A higher price records a charge; a lower price records a refund. The full-refund path remains available after the original window starts or ends while unresolved. |

Full MCP names begin with `parkstead-parking.`. Read-only operations never mutate
business state. Every write also requires the Core `expected_version` and
`request_id`; reservation/facility/rate/notification versions protect finer
business decisions. Core provides persisted idempotency receipts and atomic commit
or rollback.

## Time and disruptions

`env.advance_time` only changes the App clock. Parkstead derives `started` and
`completed` at read time from `virtual_now` and the accepted parking window; it
does not claim a scheduler. An unresolved stored `action_required` status takes
precedence over those derived labels and preserves full disruption-refund
eligibility even after the window ends.

Task/Infra may apply `parking.facility_availability_changed` and
`parking.inventory_adjusted`. Closure invalidates overlapping quotes and marks
overlapping future reservations `action_required`. Replaying an event ID has no
second effect. A matching reopen event before manual resolution restores the
original booking; it does not create a replacement or adjustment. Inventory and
price events never rewrite an accepted reservation.

`examples/scenario.json` closes Harbor Lantern Garage and makes the seeded
upcoming booking observable in the disruption view. Infra owns event injection,
clock changes, seed loading, snapshots and reset; none appears in Agent discovery
or the GUI.

## Fixtures and reset

`scripts/generate.cjs` deterministically produces the tool catalog, strict input
contracts, seed/event/state schemas, 12 facilities across three fictional metros,
30 rate windows, four policies, three vehicles, two redacted payment methods,
history states, event fixture, declarations and asset integrity metadata. Run
`npm run generate:check` to detect drift.

The baseline includes upcoming, modified, cancelled, disrupted and completed
reservations plus an expired quote. It covers height/size restrictions, hours,
amenities, no match, cancellation cutoffs, sold-out inventory and closure recovery.
All history is synthetic and dated in 2026. `env.load_seed` may replace it with
Task-owned compatible history; `env.reset` restores that loaded baseline for only
the selected run/App. Separate Core run IDs remain isolated.

## Optional Mail 1.3.0

Parkstead declares a send-only optional `channel.email` capability copied from
Mail 1.3.0's [receive declaration](../../examples/apps/mail/contribution/contribution.json),
[payload schema](../../examples/apps/mail/schemas/email-payload.schema.json) and
[wire schema](../../examples/apps/mail/schemas/router-message.schema.json)
(`urn:pale:email-message:2`). Reservation,
modification, cancellation/refund, replacement and facility-unavailable actions
always commit an in-App notification first. Mail delivery is a later independent
operation and never rolls back parking state.

`npm run example:mail` uses real Messaging and Mail MCP instances to verify sender
state, committed receipt, actual destination record, duplicate delivery, denied
grant and lost-acknowledgement reconciliation. An `unknown` acknowledgement blocks
another preparation until reconciliation; no automatic retry/outbox is claimed.
Producer and receiver clocks are advanced to the same virtual instant.

## GUI and assets

The App-owned GUI provides search/results, quote confirmation, reservation
management, cancellation preview/confirm, disruption replacement/refund and
notification views through the public Agent MCP bridge. Errors and stale versions
remain visible. It has no reset, snapshot, event, seed or clock controls. All
business strings are inserted as text. Cards are compact and never use Notes'
`.note-paper` style.

Six original PNG illustrations are cataloged under `assets/`, total less than 1
MiB. No SVG, third-party image, logo, map, screenshot or real facility is included.
See `assets/README.md` and `contribution/dataset.json`. The current shared Host does
not serve arbitrary catalog assets, so the live page uses neutral CSS thumbnails;
the raster originals remain package review assets with deterministic hashes.

## v1 boundaries

Not included: live maps/geocoding, directions, valet custody, monthly or
peer-to-peer parking, airport shuttles, citations, loyalty/reviews, real payments,
hardware/barcode recognition, or automatic Calendar/car-rental/hotel integration.
Entry passes and all money movements are synthetic. Public stdio verification is
not production OAuth/HTTPS evidence, and local browser automation is not
maintainer UI acceptance.
