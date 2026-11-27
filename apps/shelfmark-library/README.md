# ShelfMark Public Library (`shelfmark-library`)

Resettable synthetic municipal public-library environment for PALE (`core_api_version: 1.2.0`, runtime `1.6.0`).

## Scope

- **Multi-branch catalog (`branches[]`, `titles[]`):** 4 municipal branches, 24 titles across 6 formats (`print`, `large_print`, `audiobook`, `ebook`, `museum_pass`, `library_of_things`), per-branch copy statuses, hold-queue depth, and branch map assets (including one declared missing asset on `br-harbor` that surfaces `ASSET_MISSING` via `ctx.assets.read()`).
- **Managed household cards (`managed_cards[]`):** One bound parent account (`acct-maya`) managing parent and linked child library cards (`card-maya`, `card-leo`, `card-nora`) with explicit fine-block thresholds (`block_threshold_cents`, `card_status: active | blocked_fines`).
- **Holds, loans, fines, and study rooms:** 20 `shelfmark-library.*` Agent tools and 8 Infra events (`hold.ready_for_pickup`, `hold.checked_out`, `loan.returned`, `loan.queue_pressure`, `fine.assess`, `fine.dispute_decided`, `branch.closure`, `room_booking.no_show`).
- **Virtual time:** Reads derive `effective_status` (`expired` holds, auto-resumed `queued` holds, `overdue` loans) from `ctx.virtual_now` without mutating state; subsequent writes or Infra events commit due transitions. `env.advance_time` never mutates records or dispatches Mail.
- **Outbound Mail integration:** Explicit post-commit publisher (`src/publisher.cjs`) emitting CloudEvents 1.0 envelopes matching `urn:pale:email-message:2` / `urn:pale:email-payload:1` to `examples/apps/mail` via `runtime/messaging/service.cjs`.
- **Web GUI:** 4-view interactive portal (`Catalog`, `Cards & Fines`, `Holds & Loans`, `Study Rooms & Passes`) hosted by `runtime/web/server.cjs` (`pale.web`), backed solely by Agent MCP tools.

## Verification

```bash
npm test
npm run example
npm run integration:mail
```
