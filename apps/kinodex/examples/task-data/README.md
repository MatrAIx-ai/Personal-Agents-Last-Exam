# Task data: second account

Edit `seed.json`, `binding.json`, `policies.json` and `dataset.json` together, then use `env.validate_bundle` and `env.load_seed`. These are input examples; loading is an Infra operation. Event files supply content and virtual time; a task runner decides when to inject them.

The four files describe a second Kinodex account at the fixture clock (Tuesday Dec 1, 2026, 09:00 −08:00):

- **Owner:** Ines Calloway (`kinodex-ines`, owner `person-ines`).
- **Region and services:** the UK, with Northcast and Kettlewing. Her `time_zone` is `Europe/London`, so "today" for `watched_on` is the London date.
- **Watchlist:** 10 titles at `watchlist_version` 4.
- **Diary:** 60 entries in whole stars, some watched with Tomas (`person-tomas`). It includes *Salt Year*'s theatrical edition in June 2025.

The catalog is identical to `fixtures/minimal.json`, so the same catalog events apply to both accounts. The example requests have different right answers for Ines:

- *Lantern Hill* is UK PG and stays on her Kettlewing subscription.
- Only *Fieldglass* leaves her services this week (Kettlewing UK until Dec 3 23:59 UTC).
- *Salt Year* is a rewatch for her.

Loading notes:

- **Clock.** Load with `virtual_now` at or after `2026-11-07`, the date of her latest diary entry. Earlier clocks load, because seed dates are never compared with the clock, but a diary write dated after the clock fails with `invalid_date`.
- **Bundle.** Pass a bundle built from the package catalog and this `dataset.json`. It carries the matching record count (184 titles) and its own `dataset_id`. Do not edit the package's `contribution/dataset.json`.
- **Policies.** `policies.json` grants all 32 tools in both profiles. The package default grants only reads.

Checks on this account:

- `tests/business.test.cjs` checks that the catalog equals the fixture's and that the request 2 answer differs.
- `examples/mcp-walkthrough.cjs` loads these files directly and runs the three example requests against this account and Dana's.
