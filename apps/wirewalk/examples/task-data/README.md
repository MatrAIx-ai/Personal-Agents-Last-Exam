# Task data: second reader

These files describe a second Wirewalk account, Dario Mendes (`ww-dario`), at 18:00 on Monday, Oct. 12, 2026, the evening before Alder Glass reports. They are input examples; loading is an Infra operation.

- `seed.json`: the public history is the minimal fixture plus `examples/scenario.json` and `examples/wildfire-events.json`, applied in that order. Dario has bookmarked the two analysts' threads (`p29` and `p31`).
- `binding.json`: binds `ww-dario` to Dario.
- `policies.json`: grants the two bookmark tools in the `scenario` profile; the package default grants only reads.
- `dataset.json` and `assets.catalog.json`:
  - `dataset.json` carries the matching record count, 44 posts. The package's own `contribution/dataset.json` counts the 37 posts in the minimal seed.
  - `assets.catalog.json` binds the board image to `ww-dario`. Core requires an image to belong to the loaded reader's account.

To load it:

- Use `virtual_now` at or after `2026-10-12T17:02:00-07:00`, its latest record. An earlier clock still loads, but posts and bookmarks dated after it stay hidden until the clock reaches them.
- Build the bundle from this `dataset.json`, this `assets.catalog.json` and the image bytes from the package bundle (an Infra `env.snapshot` returns them under `resources.bundle.blobs`).
- Check it first with `env.validate_bundle`, then load it with `env.load_seed`.
- When editing, change the seed, binding, policies, dataset and catalog together.

Checks on this data:

- `tests/business.test.cjs` checks that this history equals the minimal seed plus the example events, and that only the IDs, counts and owner differ from the package dataset and catalog.
- `examples/mcp-walkthrough.cjs` rebuilds this exact seed over MCP from the minimal history and the seven events, then loads these files directly.
