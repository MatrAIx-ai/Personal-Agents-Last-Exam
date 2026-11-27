# CloverVet (`apps/clovervet`)

CloverVet is a standalone, resettable synthetic PALE Environment package for veterinary care, multi-pet vaccination compliance, boarding/interstate travel health clearances, clinic appointments, and veterinary prescription refills.

## Local setup & verification

Requires Node.js >= 18 and no external runtime services or paid APIs.

```bash
# 1. Standalone unit tests and local event example
cd apps/clovervet
npm test
npm run example

# 2. Official PALE runtime verification (from repo root)
cd ../..
npm run app:verify -- --app apps/clovervet

# 3. Real MCP (ASSET_MISSING, REFERENCE_INVALID), 3x Mail publishers & 4-view Web Host test
node apps/clovervet/examples/mail-integration.cjs

# 4. Launch the 4-view Web GUI via PALE shared Web Host with an explicit registry
node runtime/web/server.cjs --app clovervet --registry /path/to/registry.json --profile sandbox
```

## Implementation notes (addressing PR #184 code review)

- **Seeded history span:** Seeded historical records span `2025-01-12` through late 2026 (`>= 2025-01-01` historical baseline for `>= 2026-01-01` task timelines).
- **All three Mail publishers:** `src/publisher.cjs` implements `publishAppointmentConfirmation`, `publishClearanceNotice`, and `publishRefillNotice`, each verified end-to-end against real `examples/apps/mail` via `mail.get` (`thread_id === wire.id`) in `examples/mail-integration.cjs`.
- **Runtime `ctx.assets.read()`:** `assetWarning` uses `ctx.assets.read()` (catching `unavailable`/`not_available`) and is verified over real MCP (`clovervet.pet.get` on `pet-cleopatra` returns `ASSET_MISSING`).
- **`requirement_ref` validation:** `clovervet.clearance.check` and `clovervet.clearance.issue` accept structurally checked references and return `requirement_ref_status: "invalid"` + `REFERENCE_INVALID` on malformed references over real MCP.
- **4-view Web GUI:** `gui/src/app.js` exposes all four workflow views (Pets & Caretakers, Vaccinations & Clearances, Appointments & Open Slots, Prescriptions & Refills) with record-level clickable actions backed exclusively by `/api/call` (zero `env.*` controls).
- **Slot & error consistency:** Dogs are blocked from `cat_only_slot` (`HANDLING_CONSTRAINT_MISMATCH`); business errors use the proposal's uppercase codes; PNG fixtures are explicitly documented as synthetic color-coded placeholder cards.
