'use strict';
// Local walkthrough with the App's real business functions and the package fixture.
// It shows one declared event changing business state: the manager moves Monday's open an
// hour earlier, nine hours after the account holder's Sunday close, under a ten-hour rest
// policy. The schedule is applied as given; the shift carries a flag and a notification is
// written. Platform MCP, permissions, versions and persistence are verified separately.
const { fixture } = require('../tests/harness.cjs');
const app = fixture(), event = require('./scenario.json');
const week = { start: '2026-11-22T00:00:00-08:00', end: '2026-11-30T00:00:00-08:00' };
const brief = () => ({
  clock: app.now,
  my_shifts: app.call('shifts.list', { ...week, mine: true }).shifts.map(s => ({ id: s.id, start: s.start, end: s.end, flags: s.flags })),
  week_of_23_november: (({ scheduled_hours, cap, hours_left, estimated_pay }) => ({ scheduled_hours, cap, hours_left, estimated_pay }))(app.call('hours.summary', { start: '2026-11-23T00:00:00-08:00', end: '2026-11-30T00:00:00-08:00' }).weeks[0]),
  notifications: app.call('notifications.list', { limit: 100 }).notifications.length,
});
const before = brief();
app.event(event);
const after = brief(), notification = app.call('notifications.list', { limit: 1 }).notifications[0];
const monday = after.my_shifts.find(s => s.id === event.payload.shift_id), history = app.call('shifts.get', { id: monday.id }).shift.history;
console.log(JSON.stringify({ example: 'pegboard', mode: 'local business functions', event: { event_id: event.event_id, at: event.at, operation: event.operation }, before, after, new_history_row: history.at(-1), new_notification: notification }, null, 2));
const ok = before.my_shifts.every(s => s.flags.length === 0) && monday.start === event.payload.change.start && monday.flags.includes('short_rest')
  && after.week_of_23_november.scheduled_hours === 20 && after.notifications === before.notifications + 1 && notification.kind === 'shift.changed' && notification.change === 'changed'
  && history.at(-1).event_id === event.event_id;
if (!ok) {
  console.error('FAIL: the example did not produce the expected state change.');
  process.exit(1);
}
console.log('PASS: local App event example. Platform MCP, permissions and persistence are validated separately.');
