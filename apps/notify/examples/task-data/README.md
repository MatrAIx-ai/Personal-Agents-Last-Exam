# Task data

Replace the seed, binding and policies together, then use `env.validate_bundle` and `env.load_seed`. These files are input examples; loading is an Infra operation. A Task supplies its own device time zone, focus windows, reminders and past feed items. Every push sender in the feed (and every App that will push during the run) must be an account in the binding owned by the device owner.

Scenario events supply their own content and virtual time; a runner chooses when to apply them. To fire reminders, read `data.reminders` from `env.snapshot`, select the due ones with `src/due.cjs`, and apply `notify.reminder.fire` at each reminder's time.
