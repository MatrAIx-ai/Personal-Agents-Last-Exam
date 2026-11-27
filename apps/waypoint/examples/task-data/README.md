# Task data

Replace the seed, binding and policies together, then use `env.validate_bundle` and `env.load_seed`. These files are input examples; loading is an Infra operation. A Task supplies its own member, household, ledger history, partners, bonuses and past transfers.

The binding must contain every account the seed routes to: each partner's `recipient_account_id` must be owned by this member in the partner App, and each household member's `waypoint_account_id` must be owned by that member. A second household member is a second Waypoint instance with its own seed (see `tests/business.test.cjs`, `meiSeed`).

Scenario events supply their own virtual time; the host decides when to apply them. To deliver transfers, read `data.transfers` from `env.snapshot`, select the due ones with `src/settlement.cjs`, publish each `waypoint.transfer.outbound` message with `router.publish`, and apply the event `settleEvent` builds from the result.
