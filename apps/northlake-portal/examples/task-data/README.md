# Replaceable task inputs

Copies of the package fixtures that a task author can edit and load through Infra's `env.load_seed` (seed, binding, policies). `../schedule.json` holds a ten-event scenario schedule in the order a task would apply them with `env.apply_event`; `../scenario.json` is the single event the public verifier applies. Regenerate the seed with `node apps/northlake-portal/scripts/generate-fixture.cjs`.
