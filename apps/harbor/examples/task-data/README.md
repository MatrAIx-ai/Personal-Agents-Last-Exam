# Task data

Replace the seed, binding and policies together, then use `env.validate_bundle` and `env.load_seed`. These files are input examples; loading is an Infra operation. A Task supplies its own award chart, hotels (with IANA time zones, category changes and blackout dates), certificates, reservations, ledger, charges and notices. The ledger must start with an `opening` entry and its running balance must end at `balance`; every Waypoint account that sent or will send points must be in the binding and owned by the member; `mail_account_id` must be a bound Mail account of the member, or null.

Scenario events supply their own content and virtual time; a runner chooses when to apply them. Apply `harbor.expiry.warn` within 60 days before `expires_at` (read it with `harbor.account` or compute it from `last_activity_at` and `inactivity_months`) and `harbor.points.expire` at or after it.
