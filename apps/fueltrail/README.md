# Fueltrail

Fueltrail is a resettable synthetic fuel-price finder and vehicle fuel-log App for PALE. It has no live price, map, payment, vehicle, or external-network dependency.

## Implemented workflows

- Search 30 fictional stations across three saved places with vehicle/fuel compatibility, cash or credit prices, distance, amenities, status, 24-hour freshness labels, and deterministic price/distance/trip-cost sorting.
- Create, update, pause, resume and delete below-price or price-rise alerts. Only a fresh `false → true` transition at an open station creates an in-App notification. Create/update/resume arms without immediate notification; a clear condition can notify again later.
- Create, update, select and archive vehicle profiles that supply search defaults.
- Preview, create, update and soft-delete versioned fuel logs. Integer mills/thousandths/cents use `round(price_mills × volume_thousandths / 10000)` with a one-cent input tolerance. Economy is derived only across adjacent full fills; partial or missed fills break the chain.
- Apply idempotent price, station-status and station-detail Infra events.
- Optionally deliver price-alert notifications to Mail 1.3.0 through `channel.email`. Fuel-log correction email is intentionally outside v1. An unknown router receipt marks reconciliation required and blocks redelivery until the same request is reconciled.

The browser UI exposes station search/detail, alerts and notifications, vehicle profiles, fuel-log editing, and economy summaries. Infra seed/event/time/reset operations remain unavailable to the browser and Agent surface.

## Alert rules

- Below-price: the latest fresh matching observation is at or below the threshold.
- Price rise: the latest observation minus the immediately preceding observation for the same station, grade and payment type reaches the threshold.
- Both current and baseline observations used by a rise alert must be no more than 24 virtual hours old.
- Closed stations and stale prices never trigger. Station changes can clear/re-arm state but only a later price event sends a notification.
- Replayed event IDs and an unchanged met condition do not duplicate notifications.

## Run and verify

Node.js 18 or later is sufficient; no package installation or credentials are needed.

```sh
cd apps/fueltrail
npm test
npm run test:web
npm run example
cd ../..
npm run app:verify -- --app apps/fueltrail --output .artifacts/fueltrail.json
node apps/fueltrail/examples/mail-alert.cjs
npm test
```

Start the interactive product UI from the repository root:

```sh
node runtime/web/server.cjs --app fueltrail --run fueltrail-demo --profile sandbox
```

The deterministic source files can be regenerated with:

```sh
node apps/fueltrail/scripts/generate-tools.cjs
node apps/fueltrail/scripts/generate-contribution.cjs
node apps/fueltrail/scripts/generate-fixtures.cjs
```

Regeneration should produce no Git diff.

## Package layout

- `tools.json`, `schemas/`, `plugin.cjs`, `src/`: Agent operations, state/event contracts and business behavior.
- `fixtures/`: 30 stations, 120 observations, three vehicles, eight alerts and 24 fuel logs, all synthetic and dated in 2026.
- `gui/`: product-oriented browser UI with no SVG or remote media.
- `examples/`: deterministic price event and real Messaging-to-Mail example.
- `tests/`: schema-validated business transactions, alert state-machine coverage, arithmetic/revision checks, idempotency, failure atomicity and Mail reconciliation.
- `contribution/`: PALE interface, data provenance, GUI and messaging declarations.

Core owns App-level epoch/revision concurrency, request receipts, persistence and reset. Fueltrail adds record versions for alerts, vehicles and logs; business failures leave the working copy unchanged.
