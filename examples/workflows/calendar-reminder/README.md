# Calendar → Notify reminders and pushes

From the repository root, run `npm run example:calendar-reminder` (or `node examples/workflows/calendar-reminder/run.cjs`). It uses temporary state and real public MCP processes, with no model API, installed packages or private host. It prints a report and cleans up after itself. `registry.notify.json` assembles Notify with the reference Calendar.

The workflow checks:

1. **Permissions.** The Agent's tool list has no `env.*` operations and no user-only device operations. The Agent cannot fire a reminder, and the `scenario` profile cannot create one.
2. **Calendar → Notify.** The Agent creates a Calendar event, reads its start with `calendar.get`, and sets a reminder 15 minutes before it. The fire time is computed from the event start.
3. **Runner.** `env.advance_time` alone delivers nothing. The runner reads the snapshot, selects due reminders with `apps/notify/src/due.cjs`, and fires each at its own time and in order. The Agent reads the unread, actionable alert and marks it read. Retrying a fire returns the original receipt.
4. **Pushes through Messaging.** A send-only travel fixture (`publisher/`, a pinned copy of Notify's wire schema) publishes a flight delay. Notify stores provenance, producer time and arrival time. A repeated push deduplicates, and an unknown recipient account is rejected by the router.
5. **Quiet hours.** A reminder and a push that arrive inside the Sleep focus window are both stored as `silenced`, and `notify.focus.get` reports why.
6. **Boundaries.** Calendar state is unchanged by Notify. Moving the Calendar event does not move the existing reminder. In a separate run where the publisher is not bound to the device owner, the receiver rejects the push and the feed is unchanged.

`push-config.json` is trusted local run configuration: it names the publisher identity and its one allowed recipient. Production credentials do not belong in it.
