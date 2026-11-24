# Task data

Replace the seed, binding and policies together, then use `env.validate_bundle` and `env.load_seed`. These files are input examples; loading is an Infra operation. A Task supplies its own member, balance and ledger history, passengers, schedule and seat maps, award chart, payment labels and past bookings. The binding must list the member, every passenger's person, the Mail account named by `mail_account_id` (or set it to `null`), and every Waypoint account that sends or sent points (owned by the member).

Scenario events supply their own content and virtual time; a runner chooses when to apply them: `skyline.inventory.sold` when other customers buy seats, `skyline.schedule.changed` when the airline retimes a flight, and `skyline.alternative.expired` at the change deadline. Loyalty credits arrive through Messaging as `skyline.receive`.
