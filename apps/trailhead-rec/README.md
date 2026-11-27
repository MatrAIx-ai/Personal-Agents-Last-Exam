# Trailhead Parks & Rec (`apps/trailhead-rec`)

Trailhead Parks & Rec is a standalone, resettable synthetic PALE Environment package for municipal parks and recreation program registration, 24-hour waitlist offers, household roster/pass management, and athletic court reservations.

## Local setup & verification

Requires Node.js >= 18 and no external runtime services or paid APIs.

```bash
# 1. Standalone unit tests and local event example
cd apps/trailhead-rec
npm test
npm run example

# 2. Official PALE runtime verification (from repo root)
cd ../..
npm run app:verify -- --app apps/trailhead-rec

# 3. Real MCP (ASSET_MISSING), Mail integration & 4-view Web Host test
node apps/trailhead-rec/examples/mail-integration.cjs

# 4. Launch the 4-view Web GUI via PALE shared Web Host with an explicit registry
node runtime/web/server.cjs --app trailhead-rec --registry /path/to/registry.json --profile sandbox
```

## Implementation notes (addressing PR #145 code review)

- **Added missing approved operations:** Implemented `trailhead-rec.enrollment.transfer` (state `transferred`, settling fee delta against household credit) and `trailhead-rec.court.booking.modify` (rescheduling a confirmed court booking to another open non-past slot).
- **4-view Web GUI:** Rebuilt `gui/src/app.js` with four interactive views (Programs Catalog, Household & Passes, Enrollments & Waitlist Offers, Courts & Bookings) and direct record-level action buttons (`Accept waitlist offer`, `Decline offer`, `Withdraw`, `Cancel booking`) passing exact record `id` via `/api/call`.
- **Dynamic weather closures:** `facility.weather_closure` is derived from `closed_until` vs `ctx.virtual_now` rather than permanently closing a facility; slots scheduled after `closed_until` remain bookable once `virtual_now` advances past the closure window.
- **Runtime `ctx.assets.read()`:** `assetWarning` reads through `ctx.assets.read()` (catching `unavailable`/`not_available`) and is verified over real MCP on `prg-pickleball-beg`.
- **Event alignment & policy notes:** Restored the proposal's exact `waitlist.spot_opened` event name; `use_pass_id` consumes active passes down to `depleted`; past court slots are rejected with `slot_in_past`; `prg-bball-u12` `min_age` is 8 (matching `enr-207`); `household.update_member` is narrowed to `emergency_contact` and `preferred_facility_id`. Withdrawals credit `household_credit_cents` at 100% before `full_refund_cutoff_at` (or during `penalty_free_until`), 50% before `partial_refund_cutoff_at`, and 0% thereafter.
- **Seeded history span:** Seeded historical records span `2025-01-15` through late 2026 (`>= 2025-01-01` historical baseline for `>= 2026-01-01` task timelines).
