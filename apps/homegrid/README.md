# Homegrid

Homegrid is a resettable, synthetic utility and home-internet account App for Personal Agents' Last Exam. A person can start, stop and transfer electricity, water and internet; book and move installation windows; borrow a temporary hotspot; and return equipment. They can also follow outages and water advisories, and pay bills or arrange a payment plan. Every order, appointment, shipment, advisory version, bill line and notification is kept as a record with its virtual time, so graders can check what happened and what the agent saw.

Approved proposal: [`proposals/environment/homegrid-utilities-internet.md`](../../proposals/environment/homegrid-utilities-internet.md) (PR #170).

## Run it

Node.js 18 or newer; no packages to install.

```sh
# App-only business tests and the walkthrough (no runtime needed)
cd apps/homegrid
npm test
npm run example

# Regenerate, or check for drift in, the generated contracts and fixtures
npm run build
npm run check

# From the repository root: real MCP verification with the public runtime
npm run app:verify -- --app apps/homegrid --output .artifacts/homegrid.json

# Runtime and Mail integration through real MCP processes (needs the full checkout)
cd apps/homegrid && npm run integration
```

`npm run integration` runs `tests/runtime.integration.cjs` and then `examples/mail-integration/run.cjs`. The first checks four things through real MCP processes:
- a repeated `request_id` returns the original orders;
- a write after an event gets `stale_version`;
- `env.advance_time` changes no data, yet a held notice and a due order read correctly afterwards;
- two resets are byte-identical.

The second covers four delivery cases, all from the proposal: a boil-water notice delivered to Mail during quiet hours, a duplicate republish, an ungranted recipient, and a quiet-hour release after `env.advance_time`.

## Web page

Homegrid has a business web page served by the shared Web Host (`runtime/web/server.cjs`), following the `apps/notes` convention: `contribution/gui.json` declares the `pale.web` extension, `gui/index.html` is the page and `gui/src/app.js` the controller. From the repository root:

```sh
node runtime/web/server.cjs --app homegrid --registry <registry listing apps/homegrid> --run web-demo --profile sandbox
```

The page has seven sections:
- services;
- moves and installations (orders with their appointment windows);
- equipment;
- outages and advisories (with version chains);
- bills and payments (lines, payments, payment plans);
- notices;
- account and settings.

Each section has a list and a detail view. Record actions open forms built from the live tool schemas with the record's IDs filled in: test a connection, book or move a window, change or cancel an order, arrange a return, report an outage, pay a bill, request a plan, mark a notice read, change preferences. Global actions preview and place orders and make payments. Read actions, such as a preview, slots, plans or a full bill, show their result in the detail pane.

All data comes from the Agent MCP tools through the Host. Calendar dates are shown as written, and times in the account's time zone. `npm run gui` (`tests/gui.browser.cjs`, which needs Playwright at the repository root) drives the page in Chromium. It checks every effect in MCP state and writes screenshots to `.artifacts/web/`.

## Package boundary

Business tests and the example run from this folder with only the package. MCP verification needs the pinned public runtime (runtime 1.6.0, Core API 1.2.0). The package carries a byte-identical copy of Mail's wire schema (`schemas/mail-router-message.schema.json`) for its `messaging.publishes` declaration. Mail 1.3.0 and Messaging are needed only for the integration example, where Mail is a scenario recipient in the run assembly. Mail is not listed in `app.json` dependencies. No external service is used.

## Workflows

| Workflow | Agent tools | What it covers |
| :--- | :--- | :--- |
| 1. Account, services and plans | `account.get`, `premises.search`, `services.list`, `plans.list` | Premises with internet technology and self-install, services and their status, plans and tariffs |
| 2. Start, stop and transfer | `orders.list`, `orders.preview`, `orders.create`, `orders.reschedule`, `orders.cancel` | Business-day lead times with a holiday calendar, transfers with gap and overlap warnings, deposits, order tokens checked by recomputation, temporary hotspots from limited stock |
| 3. Appointments, activation, equipment | `appointments.slots/book/reschedule/cancel`, `connection.run_test`, `equipment.list`, `equipment.schedule_return` | Windows with capacity, the 24 h fee boundary, missed visits, activation, tests computed from state, gateway and hotspot returns |
| 4. Outages and advisories | `outages.list`, `outages.report`, `advisories.list` | Outage versions with restoration estimates, linked or investigating reports, advisory chains (`issue`, `update`, `lift`) with derived status |
| 5. Bills and payments | `bills.list/get`, `payments.list`, `payments.make`, `autopay.set`, `arrangements.request` | Bills computed from usage, credits and fees, pending and settled payments, autopay, payment plans |
| 6. Notifications | `preferences.get/update`, `notifications.list/acknowledge` | Trigger keys, quiet-hour holds released by the clock, health advisories, Mail delivery |

All tool names carry the `homegrid.` prefix: 15 reads and 14 writes. Every read returns `as_of`. Infra-only operations (`env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, `env.advance_time`) are not available to the Agent.

## Events

The task chooses the content and timing of every event; Homegrid only defines its effect.

| Operation | Effect |
| :--- | :--- |
| `field.technician_update` | Appointment moves `booked → technician_en_route → arrived → completed`, or to `no_access` or `missed_by_provider` (a $20.00 credit, and hotspot loans at the premise become free) |
| `field.activation_result` | `activated` makes the internet service active and its order effective; `failed` sets `install_failed` and the order stays open |
| `logistics.shipment_update` | Equipment `shipped`, `delivered` or `returned_received` (the return counts at the event's `at`) |
| `grid.outage_updated` | Outage `started`, `etr_updated` or `restored`; open reports at the premises are linked |
| `water.advisory_published` | Advisory `issue`, `update` or `lift` added to its version chain |
| `billing.cycle_closed` | Homegrid computes the bill from usage and its own records, and schedules autopay |
| `payment.settled` | A pending payment `settled` or `returned` (a $15.00 fee) |
| `notification.delivery_recorded` | Messaging outcome for one notification, generated by Infra |

Events may name objects the agent will create by their deterministic IDs:
- `sv-<premise_id>-<type>`;
- `or-<premise_id>-<type>-<n>`;
- `ap-<order_id>-<n>`;
- `eq-<order_id>`;
- `py-<account>-<n>`;
- `py-auto-<bill_id>`.

Events may also use a selector that matches at most one object: `{premise_id, service_type}`, `{premise_id, kind}` or `{oldest_pending: true}`. An event for something already cancelled or finished, or a selector that matches nothing, commits as a no-op. Its reason is kept in `ignored_events`.

## Time

Homegrid has no timers and no clock event. Infra moves time with an event's `at` or with `env.advance_time`, which runs no App code. Statuses that fall due with time are therefore derived from `ctx.virtual_now` wherever they are read or written, including by the outbound adapter (`src/derive.cjs`):
- an order becoming effective;
- an equipment return falling due;
- an advisory's status;
- a bill becoming past due;
- autopay becoming pending or skipped;
- an arrangement defaulting;
- a held notification's release.

Reads derive them on a copy and change nothing. Each write or event first stores them, stamped with the time each fell due, so the stored result does not depend on when it is stored. Fees that depend on a deadline are added when the next bill is computed.

## Mail delivery

`src/publisher.cjs` reads notifications that are `pending_delivery` at the current virtual time from an Infra snapshot. It builds Mail's `channel.email` message (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`) with title, body and `time` frozen on the notification, so a retry sends identical bytes. The message's `source_object` names the order, appointment, outage, advisory, bill or payment behind it. It is published with `request_id` equal to the notification ID (for example `n-adv-bw7-1-sam`, derived from the trigger key). Infra then records the outcome with `notification.delivery_recorded`.

## Scenario packs

Each pack in `examples/packs/<name>/` has a `seed.json`, `binding.json` and `clock.json` that a task can load, and an `events.json` with events in time order. The tests load every pack and replay all its events. The packs share one world: two fictional towns, Fairmont (`America/New_York`) and Wexley (`America/Chicago`), with four utility areas and 60 premises.

| Pack | Contents |
| :--- | :--- |
| `move-remote-worker` | A remote worker mid-move in Wexley (#9-shaped): a transfer already ordered from a cable premise to a self-install premise, the kit on its way, the old gateway to return, bills on autopay since January 2025. Events: kit shipped and delivered, activation, a 27-hour outage (a $3.23 credit), the gateway returned, the first bill at the new address |
| `boil-water-infant` | A family with an infant in Riverside (#115-shaped): quiet hours at night with the health bypass switched off, an earlier lifted advisory, bills since January 2025. Events: a boil-water advisory issued at 02:10, widened to a second area, a planned shutoff, then the lift |
| `tight-month` | A household behind on bills: 26 months of bills and payments (2025 on time, then a hard 2026), two returned payments, one completed payment plan, the latest bill past due and a late fee on the open one. Events: a settlement for anything the agent pays, and the next cycle |

## Data

`scripts/generate-fixtures.cjs` writes every fixture and pack deterministically from a fixed seed; `npm run check` fails if a regenerated file differs. The account history in each fixture is produced by running Homegrid's own event and write handlers in time order. Every seeded bill, payment, arrangement and notification is therefore one the App itself computes, and the tests recompute each bill's usage lines from the catalog. Seeded history starts in January 2025, about two years before the core examples, and the task timeline starts in 2026. All towns, addresses, people, tariffs and fees are synthetic, recorded in `contribution/dataset.json`.

## Implementation notes

Where the approved plan left a detail open, or review asked for a change:
- **`homegrid.premises.search`** was added at review (lookup by address), so there are 15 reads instead of 14.
- **Appointments in `orders.list`:** each order carries its installation appointments, so a booked window is readable without a separate tool.
- **Fee boundary:** a change exactly 24 h before the window starts is inside the fee window. For a Tue 08–12 window, a change at Mon 08:00 costs $25.00, and one at Mon 07:59 is free.
- **Stop dates:** a stop preview without a `date` returns `invalid_date`.
- **Technician lead time:** for an existing order, 3 business days count from when the order was placed, not from the booking request. A missed or moved visit can therefore be rebooked for the next free window, and the window must not have started. `appointments.slots` accepts an optional `order_id` for this. A new order counts from now.
- **Order tokens:** a token is sealed, so an edited token is `invalid_order_token`. `orders.create` recomputes the preview: any change returns `order_token_stale`, including a preview that now fails, such as `no_stock`.
- **Equipment status:** `ordered → shipped → delivered → in_use → return_due → returned`. `return_due` is derived: when internet stops for a gateway, after the loan's last day for a hotspot. `schedule_return` records the method.
- **Payments:** payments fill what is owed in due-date order. A bill under a payment plan is split into the part already paid and one piece per installment. A current bill is therefore paid before installments that are not yet due.
- **Late fees:** the late fee uses the balance still unpaid at the end of the grace period, counting a payment from its creation unless it was returned. An active or completed plan covers its bill. After a default, the remaining balance is charged at the next bill.
- **Deposits:** a "late payment" for the deposit rule is a seeded late payment or a bill not covered by the end of its due date. A returned payment counts only through the bill it leaves uncovered.
- **After a move:** fees and charges for a premise that no longer has any service go on the account's next bill at any premise: unreturned equipment, late fees on its final bill, and pending charges. A returned-payment fee is charged to a premise that still has service. Only equipment the customer received (delivered or in use) can incur an unreturned fee.
- **Prior balance:** each bill records `prior_balance_cents`, what earlier bills still owed at close (settled payments only). It is not a line item and not part of the total, because each bill is paid on its own lines.
- **Notices about money:** bill and payment-plan notices reach the account holder even after a premise's services have stopped, so a final bill is notified. Other premise notices follow the recipient rule.
- **Newer versions:** any notification for a newer version of the same source (an outage, advisory, appointment or order) withdraws held notices for earlier versions.
- **Outages** may name `areas`, `premise_ids` or both; areas expand to their premises when the outage starts.
- **Advisory updates and lifts** may omit fields; they carry over from the previous version. An update that no longer covers the account's premise says so.
- **Seed flag:** a payment method seeded with `fails: true` always returns.
- **Field name:** `outages.report` returns `report_status`, because Core reserves `status` in every result.
- **Final bills:** `billing.cycle_closed` may name a `premise_id` when nothing metered is billed, for example a final bill after a move.
- **Hotspot loans** are `effective` from their first day. They cost $10.00 per started 7-day period, counted from the first day (Jan 19–26 is one period), and last at most 30 days.
- **Charges** carry a `ref` to the object they are for (appointment, order, outage, equipment, bill or payment), so each fee or credit is applied once.
- **Dates:** a date that does not exist (such as `2027-02-30`) is rejected as `invalid_date`, or `invalid_event` in an event.

## Limitations

- No real customers, utilities, rates, outage maps or meter data; one account per App instance.
- Gas, solar and net metering, energy-assistance programs and disconnection for non-payment are out of scope.
- One business web page (see Web page); no reviewer console.
- Automatic invocation of the outbound adapter belongs to the planned runner; the example and tests invoke it explicitly.
