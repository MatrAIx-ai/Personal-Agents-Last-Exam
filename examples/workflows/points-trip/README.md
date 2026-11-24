# Points trip: Waypoint → Skyline / Harbor → Mail

From the repository root, run `npm run example:points-trip` (or `node examples/workflows/points-trip/run.cjs`). It uses temporary state and real public MCP processes for Waypoint, Skyline, Harbor and Mail plus Messaging, with no model API, installed packages or private host. It prints a report of 44 named checks and cleans up after itself. `registry.points.json` assembles the four Apps.

The run follows the approved example in proposal [#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193):

1. **Permissions.** The Agent's tools have no `env.*` operations; it cannot settle a transfer, the `scenario` profile cannot write, a combine cannot name another member as its source, and the Agent's connection sees only Daniel's account.
2. **Pool points.** Mei's own connection (held by the user harness, in a separate state root) combines 166,000 points to Daniel. Her publisher delivers the message through Messaging; Daniel's ledger shows the credit with Mei's account and message ID, Mei's shows the debit, and her transfer is settled with the receipt. Daniel's publisher cannot send a message as Mei (`source_identity_mismatch`).
3. **Transfer to Skyline.** Daniel transfers 150,000 points. Skyline credits the member with provenance, the sender stores the receiver receipt, and a repeated publish returns the original receipt with no second credit.
4. **Ticket an award.** Search HND → SFO → ORD on 2027-10-21 in business for two, book with both travelers in adjacent seats on both segments, and charge the partner fee and taxes to the chosen card.
5. **Sell out the rest.** `skyline.inventory.sold` takes the last saver seats; search finds nothing and booking the old option is `stale_version`.
6. **Schedule change.** `skyline.schedule.changed` makes the SFO connection illegal. The booking shows an open change, the notice with its deadline reaches Daniel's Mail inbox through Skyline's publisher, and the free next-day alternative keeps the pair together at no cost.
7. **Transfer to Harbor and book.** A 30,000-point Harbor transfer is released 24 hours later: before then nothing is delivered and the message cannot be built. After `env.advance_time`, Harbor credits it and counts it as activity. The Category 1–4 certificate pays one night at Kyoto Station (and is refused at Category 6 Gion), two Gion nights are booked at the Category 6 price, the booking notice reaches Mail, and after the category change takes effect search shows Category 7 while the reservation keeps its price.
8. **Rejected credit.** In a separate run, Skyline's account has another member number, so it refuses the credit (`receiver_rejected`, `permission_denied`) and Messaging halts that run. Skyline is unchanged, Waypoint records the rejection and refunds in a separate ledger entry, replaying the settlement refunds nothing more, and the halted run accepts no further delivery.

Files:

- `run.cjs`: the run and the host's delivery loop (`deliverable` → `waypoint.transfer.outbound` → `router.publish` → `settleEvent`).
- `skyline-steps.cjs`, `harbor-steps.cjs`, `rejected-credit.cjs`: steps 4–6, 7 and 8.
- `mei-config.json`, `daniel-config.json`: trusted publisher identities for each member's Waypoint account and the accounts each may credit.
- `skyline-mail-config.json`, `harbor-mail-config.json`: Skyline and Harbor publishing notices to Daniel's Mail account.
- `timeline.json`: the point amounts.

Configs are trusted local run configuration. They name publisher identities and allowed recipients; production credentials do not belong in them.
