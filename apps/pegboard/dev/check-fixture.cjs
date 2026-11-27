#!/usr/bin/env node
'use strict';
// Consistency check of fixtures/minimal.json, beyond the seed rules the App enforces.
//   node dev/check-fixture.cjs
// It reads only files of this package. It does not replace human review of realism (the
// schedule, the policy values, notification wording) or of the invented names.
const path = require('node:path');
const { fixture } = require('../tests/harness.cjs');
const { compile } = require('../tests/schema-validator.cjs');
const { ms, isoAt, HOUR } = require('../src/util.cjs');
const model = require('../src/model.cjs');
const { inQuietHours, quietEnd } = require('../src/notifications.cjs');
const contracts = require('./contracts.cjs');

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tally = (list, key) => list.reduce((m, x) => { m[key(x)] = (m[key(x)] || 0) + 1; return m; }, {});

// Returns the list of problems (empty when the fixture is consistent) and a one-line summary.
function inspect() {
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };
const app = fixture(), data = app.data, now = ms(app.now), ix = model.index(data), me = data.owner_person_id, policy = data.workplace.policy;

// 1. The planned scale (proposal, "Synthetic data and assets").
const states = tally(data.shifts, model.shiftState);
check(data.workplace.locations.length === 2 && data.workplace.positions.length === 3 && Object.keys(policy).length === 5, 'workplace: 2 locations, 3 positions, a policy of five values');
check(data.people.length === 10 && data.people.filter(p => p.id !== me).length === 9, 'people: the account holder and 9 others');
check(data.weeks.length === 4, '4 posted weeks');
check(data.shifts.length === 168 && states.open === 12 && states.cancelled === 3, '168 shifts, 12 open, 3 cancelled: got ' + JSON.stringify(states));
check(data.shifts.filter(s => model.shiftState(s) === 'assigned' && s.assignee === me).length === 16, '16 shifts of the account holder');
check(data.availability.length === 3, '3 availability blocks');
check(data.time_off.length === 5 && same(Object.keys(tally(data.time_off, t => model.timeOffState(data, t, now))).sort(), [...contracts.TIME_OFF_STATE].sort()), '5 time-off entries that cover every state');
check(data.handoffs.length === 14 && same(Object.keys(tally(data.handoffs, h => h.kind)).sort(), [...contracts.KIND].sort())
  && same(Object.keys(tally(data.handoffs, h => model.handoffState(h, now))).sort(), [...contracts.HANDOFF_STATE].sort()), '14 handoffs that cover every kind and state');
check(data.notifications.length === 16 && same(Object.keys(tally(data.notifications, n => n.kind)).sort(), [...contracts.NOTIFICATION_KIND].sort()), '16 notifications that cover every kind');

// 2. Shifts: end after start, at most 16 hours, in a posted week, six a day.
for (const s of data.shifts) {
  check(ms(s.end) > ms(s.start) && model.hoursOf(s) <= 16, s.id + ': timing');
  check(ix.weeks.has(model.shiftWeek(data, s)), s.id + ': not in a posted week');
  check(s.history.length >= 1 && s.history[0].by === 'schedule', s.id + ': history starts with the posting');
}
check(Object.values(tally(data.shifts, s => model.shiftDay(data, s))).every(n => n === 6), 'six shifts on every day');

// 3. Handoffs: the state fits the shifts, and the cut-off is the policy's hours before the earliest shift.
for (const h of data.handoffs) {
  const named = model.namedShifts(h).map(x => ix.shifts.get(x)), moved = named.filter(s => s.history.some(row => row.handoff_id === h.id));
  check(h.state === 'approved' ? moved.length === named.length : moved.length === 0, h.id + ': shifts moved exactly when approved');
  const changedLater = named.some(s => s.history.some(row => row.by === 'manager' && ms(row.at) > ms(h.created_at) && (row.change.start || row.change.end)));
  if (!changedLater) check(ms(h.cutoff_at) === Math.min(...named.map(s => ms(s.start))) - policy.handoff_cutoff_hours * HOUR, h.id + ': cut-off');
  check(ms(h.created_at) < ms(h.cutoff_at), h.id + ': asked for before its cut-off');
  check(h.history.every((row, i) => i === 0 || ms(row.at) >= ms(h.history[i - 1].at)), h.id + ': history in time order');
}

// 4. Notifications: release times follow the delivery rule; wire messages match Mail's schema.
const wire = compile(require('../schemas/router-message.schema.json'), path.resolve(__dirname, '../schemas'));
for (const n of data.notifications) {
  const t = ms(n.created_at), starts = n.shift_ids.map(x => ms(ix.shifts.get(x).start)).filter(x => x > t);
  const urgent = starts.length > 0 && Math.min(...starts) - t < 12 * HOUR;
  // Shift times may have changed after the notification was written, so only the common case is recomputed.
  const expected = !urgent && inQuietHours(data.preferences, t) ? isoAt(quietEnd(data.preferences, t), data.preferences.timezone) : n.created_at;
  check(n.release_at === expected, n.id + ': release time ' + n.release_at + ', expected ' + expected);
  check(n.wire !== undefined && wire(n.wire) && n.wire.id === n.id && n.wire.time === n.release_at, n.id + ': wire message');
  check(data.activity.some(row => row.action === 'notification.created' && row.object_id === n.id && row.seq === n.seq), n.id + ': activity row');
}

// 5. Flags: only the one the fixture is meant to show (a Tuesday shift over a declared class).
const flagged = app.call('shifts.list', { start: '2026-11-01T00:00:00-08:00', end: '2026-12-31T00:00:00-08:00', mine: true, limit: 200 }).shifts.filter(s => s.flags.length).map(s => [s.id, s.flags]);
check(same(flagged, [['sh-1201-03', ['outside_availability']]]), 'flags: ' + JSON.stringify(flagged));

// 6. Activity: contiguous sequence; one row per write, event and event effect.
check(data.activity.every((row, i) => row.seq === i + 1), 'activity sequence is contiguous');
check(data.activity.every(row => (row.actor === 'agent') === (row.request_id !== undefined) && (row.actor === 'event') === (row.event_id !== undefined)), 'activity rows name the request or the event behind them');

// 7. Nothing that looks like a real contact detail or link.
const text = JSON.stringify(data);
check(!/https?:|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.test(text), 'no links, e-mail addresses or phone numbers');
check(text.length < 1048576, 'fixture under 1 MiB');

const summary = data.shifts.length + ' shifts in ' + data.weeks.length + ' weeks (' + states.open + ' open, ' + states.cancelled + ' cancelled), '
  + data.people.length + ' people, ' + data.handoffs.length + ' handoffs, ' + data.time_off.length + ' time-off entries, ' + data.notifications.length + ' notifications, '
  + data.activity.length + ' activity rows, ' + text.length + ' bytes';
return { problems, summary };
}
const check = () => inspect().problems;

module.exports = { check, inspect };
if (require.main === module) {
  const { problems, summary } = inspect();
  if (problems.length) { console.error('fixtures/minimal.json: ' + problems.length + ' problem(s)\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log('fixtures/minimal.json is consistent: ' + summary + '.');
}
