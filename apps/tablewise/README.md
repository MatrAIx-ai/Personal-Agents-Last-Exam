# Tablewise — restaurant reservations, M1

Original OpenTable-inspired diner App for approved proposal #40. Proposal text is unchanged. Node 18+, public runtime 1.6.0/Core 1.2.0; offline and no account/API keys.

From the checkout:

```sh
node runtime/web/server.cjs --app tablewise --registry apps/tablewise/registry.json --run tablewise-demo --port 8791
node --test apps/tablewise/tests/*.test.cjs
npm run app:verify -- --app apps/tablewise --output .artifacts/tablewise-public.json
node apps/tablewise/examples/run-connected.cjs
```

Open the access link printed by the server. The GUI uses the same Agent MCP handlers. Trusted user grants, venue quotes, stock changes and actual refund evidence enter through Infra events; the GUI cannot issue its own authority or mark refunds paid.

M1 includes six fictional venues, explicit released sittings, expiring protected holds, exact previews, atomic booking/deposit, strict 150-minute start gap and synthetic two-booking overlap profile, amendment/cancellation, original receipts, group inquiry/venue replies and Mail text/file delivery. Prices use integer USD cents; service/tax are each rounded on food. Failed changes preserve the original. Paid refunds require source evidence. Tool names use `tablewise.*` as required by Core; trusted events retain proposed `dining.*` names.

Historical records begin 2025-01-01, as corrected by the reviewer on 2026-11-24. The Task timeline starts 2026-01-01; this demo starts 2026-11-24 and offers November 28–29 sittings. History contains 23 monthly outings, independently of the active outing. Null venue attributes mean unknown. These are fixture scales for M1, not the complete proposed scene collection.

Still required for M2/M3: release-rule calculators (M1 uses explicit published release instants), waitlists/offers/subscriptions, group quote acceptance and headcount locks, scoped guest updates, contributions, additional scenario bundles/events, optional Calendar/Contacts/Messages, independent reproduction and maintainer validation/model-trial budget. Group inquiries do not reserve space; an instant public table booking does not accept a private-room quote. M1 amendments are available before the accepted free-cancel cutoff; deposits remain credit on the replacement, with lower-than-credit meal totals rejected.

Original receipt strings and hashes are immutable. `tablewise.notices.list` supplies stable source-owned Mail envelopes; Infra routes explicitly, and delivery failure leaves bookings intact. Reset affects this App only and returns its loaded baseline/clock. Export receipts/audit before reset; the runner coordinates other Apps and scheduled sessions. Resource mapping in `runtime/registrations/tablewise.json` needs normal Infra review.

Code MIT; original records and electronic menus CC0-1.0. Public Files/Mail package contracts and launcher reused under repository MIT. Reference: https://www.opentable.com/ informs search, available-time and reservation-management interactions; no product source, photography, logos, customer data or actual restaurant policies copied. All reservation/payment effects are simulated.
