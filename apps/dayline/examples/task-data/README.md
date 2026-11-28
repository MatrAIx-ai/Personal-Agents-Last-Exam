# Task data: second reader

Edit seed, binding, policies and dataset together, then use `env.validate_bundle` and `env.load_seed`. These are input examples; loading is an Infra operation. The scenario supplies event content and virtual time; a task runner chooses when to inject it.

`seed.json`, `binding.json`, `policies.json` and `dataset.json` describe a second Dayline account, Ben Ikeda (`dayline-ben`), at 07:20 on Oct. 14, 2026. The public catalog is the minimal fixture after `examples/scenario.json`, which adds `rail-local-2` at position 1 of the `local` front page. Ben read that edition at 07:20, so a morning briefing for him should lead the Valley section with a different story.

- Load it with `virtual_now` at or after `2026-10-14T07:20:00-07:00`, its latest record, to see all of it. At an earlier clock Dayline shows only the editions and history dated by then, and `rail-local-2` is `not_found` until 07:10.
- Pass a bundle built from the package catalog and this `dataset.json`, which carries the matching record count (26). The package's own `contribution/dataset.json` counts the 25 editions in the minimal seed.
- `policies.json` grants the three private write tools in the `scenario` profile; the package default grants only reads.
- `tests/business.test.cjs` checks that this catalog equals the minimal seed plus the scenario event. `examples/mcp-walkthrough.cjs` rebuilds this exact seed over MCP from the minimal catalog, the event and one `mark_read` call.
