# Plateway

Plateway is a synthetic, independently branded restaurant delivery App for one account holder: browse restaurants that deliver to a saved address, build a cart with dish options and receipt labels, check out as soon as possible or for a scheduled time, follow the order through the restaurant and courier, cancel, report missing or wrong items, and rate the order. It implements the approved environment proposal [`proposals/environment/plateway-delivery.md`](../../proposals/environment/plateway-delivery.md) (PR #111) on the public runtime 1.6.0, Core API 1.2.0. There is no GUI; the Agent uses MCP tools and Infra drives restaurant and courier events.

## Run it

Node 18 or later, no installed packages.

```sh
cd apps/plateway
npm test                    # App-only business tests (no runtime code)
npm run example             # standalone event example
node dev/check-fixture.cjs  # content checks for the representative fixture
npm run mcp                 # real MCP checks on the pinned runtime
npm run mail                # Plateway → Mail 1.3.0 through Messaging

cd ../..
npm run app:verify -- --app apps/plateway --output .artifacts/plateway.json
```

`tests/mcp.integration.cjs` and `tests/mail.integration.cjs` take `--runtime PATH` (default: `PALE_RUNTIME_ROOT`, then `../../runtime`) and `--report FILE`; the Mail script also takes `--with PATH` for the Mail package (default: `examples/apps/mail` next to the runtime). The npm scripts set only `--report`, so `PALE_RUNTIME_ROOT=… npm run mcp` and `npm run mail -- --with PATH` both work; a later flag overrides an earlier one. The Mail script copies the runtime, this package and Mail into a fresh temporary directory with its own registry, runs there and removes it.

## Workflows and tests

| Workflow | Main path | Failure paths | Tests |
| --- | --- | --- | --- |
| W1 Browse and check out | Open restaurant serving the address → dish with a required option → preview → place with the token → `submitted`, one charge, cart emptied, `notice.order_placed` with the receipt | Price change between preview and placement → `stale_preview`; declining card → `payment_failed`; expired card, outside the delivery area, closed or paused restaurant, unavailable dish or option | T01–T04 |
| W2 Lifecycle | `order.accepted` → `order.delayed` → `order.picked_up` → `order.delivered`; a scheduled order released at its release time | No acceptance within 20 minutes → `cancelled`; paused or closed at release → `cancelled`; late events commit but do not change a cancelled or delivered order (timers due by their time still apply); unknown targets → `invalid_event` | T05–T09 |
| W3 Cancel | `orders.cancel.preview` → `orders.cancel.confirm` with the token: full refund before preparation, delivery fee and tip refunded while preparing | After pickup → `invalid_state`; a token taken before a status change → `stale_preview` | T10, T11 |
| W4 After delivery | Report a line `missing` or `wrong` within 48 hours → its subtotal and tax refunded, `notice.item_refunded`; rate once within 30 days | Second report of a line → `duplicate_request`; after the window → `window_closed`; before delivery → `invalid_state` | T12, T13 |
| All | Notices written once per occurrence; repeated requests and events deduplicated; reset restores the loaded seed | `idempotency_conflict`, `stale_version`, `permission_denied` for Agent management calls; a token from another seed ID → `stale_preview` | T14–T16 |

`tests/business.test.cjs` runs the App-only tests (T01–T14, edge cases, bounds and the fixture checks); they build their per-test seeds in JavaScript (`tests/seeds.cjs`, `tests/flows.cjs`). `tests/mcp.integration.cjs` covers the parts the proposal marks [MCP] and T15–T16 through real MCP clients. `tests/mail.integration.cjs` covers the Mail half of T14.

## Interface

Tools (`tools.json`), all prefixed `plateway.`:

- Reads: `account.get`, `restaurants.search`, `restaurants.get`, `menu_items.get`, `cart.get`, `checkout.preview`, `orders.list`, `orders.get`, `orders.cancel.preview`.
- Writes (each with `request_id` and `expected_version`): `cart.add_item`, `cart.update_item`, `cart.remove_item`, `orders.place`, `orders.cancel.confirm`, `orders.report_issue`, `orders.rate`.

Events (`schemas/events.schema.json`), applied by Infra through `env.apply_event`: `restaurant.status_changed`, `menu_item.availability_changed`, `menu_item.price_changed`, `order.accepted`, `order.rejected`, `order.item_unavailable`, `order.picked_up`, `order.delayed`, `order.delivered`.

## Rules in brief

- **Totals.** Line subtotal = (dish price + option deltas) × quantity; option deltas are never negative; tax 8% per line, rounded half up; service fee 12% of the subtotal; small-order fee $2.49 below a $12.00 subtotal; plus the restaurant's delivery fee and the tip (at most $1,000). The charge equals the previewed total. A cart holds at most 50 lines.
- **Previews and tokens.** `checkout.preview` and `orders.cancel.preview` store nothing and return a token: a digest of the actor, the action, its business arguments, the run, the seed ID and the business changes the confirm would make. A confirm recomputes the checks first and returns their error; otherwise a different digest is `stale_preview`. Like every write, a confirm with a fresh `request_id` and an outdated `expected_version` is refused with `stale_version` before any of this. A clock move alone does not stale an ASAP checkout token.
- **Scheduling.** A scheduled time is on a 15-minute boundary, at least 45 minutes ahead (elapsed time) and at most 7 days ahead in local wall time; its release time (delivery time minus preparation and travel) is after now and inside the restaurant's weekly hours. A pause does not block scheduling.
- **Timers.** Each order stores its due times: `release_at` for a scheduled order and `accept_by` (submission + 20 minutes) for a submitted order. Every write and event first applies the timers due by its time, in order of due time and order number, each dated at its due time; reads and previews show the same result without storing it. A timer due at the same instant as an event takes effect first. A seed may hold a timer already due at its clock. Because nothing runs between calls, a timer's refund and notice are stored, and become visible to a Mail sender, only when a later write or event commits them.
- **Cancellation and refunds.** Cancelling before preparation refunds what remains of the charge after earlier refunds; while preparing it refunds the delivery fee and tip (at most what remains); after pickup it is refused. An unavailable or reported line refunds its subtotal and tax, with `notice.item_refunded`; a $0 line (or one reached after refunds already equal the charge) gets no refund record, and its notice (titled “Item removed” or “Item reported”) says no refund was due; refunds never exceed the charge. A report or rating dated before the recorded delivery is refused (`invalid_state`).
- **IDs and time.** IDs created during a run are sequential (`o-13` follows `o-12`; lines, refunds and notices the same way) and are never reused after a removal; numeric suffixes go up to 999,999,999; once an account has used the last one, reads still show a due timer's effect, but writes and events that need a new ID are refused with `invalid_state` and change nothing, so keep seeded counters well below it. The optional seed field `issued` records the highest suffix issued per prefix (`o`, `ol`, `rf`, `n`); the App maintains it. Times the App computes (due times, estimates, release and scheduled delivery times) are written with the seed's time-zone offset; times taken from the clock or an event keep their supplied spelling.
- **Dates.** The App sets no date floor (the platform's Task template allows external-platform history from 2025-01-01); the representative fixture is dated in 2026. An order cannot be changed, and an event for it is refused, at a time before that order's own recorded history: cancellation previews and confirms, reports and ratings return `invalid_state`, and the event returns `invalid_event`.

## Data

`fixtures/minimal.json` is the representative seed (54 records): one account holder with two addresses in served zones and one outside them; three cards on invented networks (valid, declining, expired); six invented restaurants (one closed on Mondays, one open past midnight, one with split hours; the example scenario pauses Basil Row while it is open); 36 dishes with option groups and allergen declarations from the nine major US food allergens, including options that add an allergen and `may_contain` declarations, and a sold-out dish; ten past orders with receipts, recipient labels and four ratings, including a rejected order, a reported line, a line removed as unavailable and a small-order fee; one order being prepared and one scheduled for this evening. All history is dated in 2026 with the offset in force at each time. `dev/check-fixture.cjs` checks one holder, two served addresses and one outside, three cards (valid, declining, expired), six restaurants with six lead cuisines, 30 to 42 dishes, ten past orders, four ratings, one scheduled and one in-progress order, at least one of each other example listed here, the zone offset of every timestamp, that every date is on or after 2026-01-01, that the scenario pauses a restaurant while it is open, at or after the seed clock, a brand and card-network deny-list, and recomputes every total. Provenance and reuse terms are in [`contribution/dataset.json`](contribution/dataset.json): synthetic records authored with AI assistance, checked by the checker and reviewed by the contributor; no generator script.

Seed limits a Task author can hit: a restaurant rating average is between 1 and 5 even when its count is 0; preparation and travel times are 1 to 180 minutes; an option adds at most $1,000; a dish has at most 10 option groups of at most 20 options; a day has at most 4 opening spans, and a span whose end is at or before its start runs past midnight.

Task authors can replace the seed through `env.load_seed`. `schemas/seed.schema.json` and the App's `validateSeed` reject inconsistent history: fields missing or present for an order's status and mode (including the estimated delivery time), placement, release and delivery times out of order, refunds other than exactly what the App would have refunded (a cancellation refund only on a cancelled order, matching its cancellation record and the refund rule for its reason; each line refund equal to that line's subtotal and tax, capped at what remained of the charge), a reported line on an order that was not delivered, a release reason on an order that was not scheduled, a rating dated before the delivery, an account holder's cancellation whose refund does not match its stage (the cancellation's optional `stage` field, which the App records, or else the last order status recorded before it in the timeline; other timeline statuses are ignored), a `stage` its reason does not allow, a cancellation after a recorded pickup or delivery, an active order whose timeline records a later status, totals that do not recompute, options that are not on their dish (seeded cart lines are also checked against the option-group limits), unknown time zones and numeric ID suffixes above 999,999,999. Give each distinct seed its own `seed_id`: preview tokens include it.

## Mail notifications (optional)

Plateway writes every notice to its own log (`notices` in the App state). Mail is optional: the App runs fully without it. The receiving side is Mail 1.3.0's [receive declaration](../../examples/apps/mail/contribution/contribution.json) and [wire schema](../../examples/apps/mail/schemas/router-message.schema.json).

`infra/sender.cjs` is an Infra-run sender adapter, used like Mail's own publisher: Infra supplies a Plateway Infra client, a Messaging Router client and the grants from its Router configuration, and calls `send` after commits that append notices.

```js
const sender = require('./infra/sender.cjs');
const outcome = await sender.send({ plateway: platewayInfraClient, router: routerClient, grants: routerConfig.publishers[0].allowed_recipients });
```

`send` reads the log through `env.snapshot`, treats the entries present in the loaded seed as history, and publishes each newer entry through `router.publish` as a plain-text Mail message (`channel.email`, `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, receiver operation `mail.receive_notification`). The message `id` and the publish `request_id` are `e<epoch>-<notice id>`. Within the same Router session, while the Router is not halted and Mail's binding and epoch are unchanged, an identical retry returns the stored receipt marked `duplicate`; a notice written after a reset is a new message. It publishes only when the run binding gives the account holder a Mail account that the grants allow on `channel.email`, and the Router offers that channel; otherwise the entries stay in the log. It stops at the first receipt that is not `committed` and returns that receipt's `event_id`. A refusal before dispatch (for example `incompatible_contract` or `recipient_not_authorized`) leaves the Router running; a rejection by Mail or an unknown acknowledgement halts it for reconciliation. For that, take `receiverSetup(mailInfraClient)` when the Router starts and call `reconcile({ mail, setup, outcome })` with the `send` result after an `unknown` result: it reports `committed` when Mail's receipt and inbox record are both found, and otherwise `indeterminate` (the event ID is missing, Mail's run, account or epoch has changed, nothing is found yet, or the receipt and the inbox disagree). Infra should bring both Apps' clocks to the same time at each delivery boundary; after a Plateway reset its clock goes back, so Mail can be ahead of it. None of these outcomes changes Plateway's committed state. `infra/router.config.example.json` is an example Router configuration with the required grant; `schemas/router-message.schema.json` is the runtime's wire contract, byte for byte.

## Limitations

- Synthetic restaurants, menus, couriers and payments only. One account holder per App instance. MCP only: no GUI and no restaurant or courier screens.
- No clock event and no scheduler: due times are applied from the supplied virtual time when a write or event arrives.
- Restaurant aggregate ratings are not recomputed from new ratings. No promotions, group orders, substitutions, tips changed after delivery or real payment authorization.
- Mail failure cases in `tests/mail.integration.cjs` are induced without changing the runtime or Mail: a publisher package copy with a changed wire schema (incompatible contract), a message ID longer than Mail stores (receiver rejection), an in-process Router whose receiver reply is dropped after Mail commits (lost acknowledgement), an empty grant list and a Mail reset after Router setup.
- Not yet done: the maintainers' human review of realism and provenance, and trial runs with an Agent.
