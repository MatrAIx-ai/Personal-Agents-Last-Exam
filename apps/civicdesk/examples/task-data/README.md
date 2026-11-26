# Replaceable task inputs

Copies of the package fixtures that a task author can edit and load through Infra's `env.load_seed` (seed, binding, policies). `../schedule.json` holds the ten-event scenario schedule in the order a task would apply them with `env.apply_event`; `../scenario.json` is the single event the public verifier applies. Regenerate the seed and the studio images with `node apps/civicdesk/scripts/generate-fixture.cjs`. The linked Task #19 supplies its own seed in this shape (25 dockets, the target OCDD-2026-0031 and its decoy).
