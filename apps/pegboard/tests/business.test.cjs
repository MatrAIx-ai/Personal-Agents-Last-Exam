'use strict';
// App-only business tests T01-T19 of the proposal. They call the real business functions
// through tests/harness.cjs with the package fixture (clock: Saturday 2026-11-21 18:00 -08:00)
// and need nothing outside this package. Core behavior (T18, the real env.advance_time of
// T17, reset in T19) needs the public runtime and lives in tests/mcp.integration.cjs; the
// Mail flow lives in tests/mail.integration.cjs. Both run from here only when
// PALE_RUNTIME_ROOT names the runtime directory of a public checkout.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { fixture, plugin } = require('./harness.cjs');
const sender = require('../infra/sender.cjs');

const at = (date, hhmm, offset = '-08:00') => date + 'T' + hhmm + (hhmm.length === 5 ? ':00' : '') + offset;
const ME = 'person-noor', TOMAS = 'person-tomas', KAI = 'person-kai', INES = 'person-ines', ADA = 'person-ada', LUZ = 'person-luz', SAM = 'person-sam', JO = 'person-jo', PIP = 'person-pip', ROSA = 'person-rosa';
// The account holder's week of 23 November: 6 + 6 + 4 + 4 = 20 of her 24 hours.
const SUN_CLOSE = 'sh-1122-05', MON = 'sh-1123-01', THU = 'sh-1126-02', FRI = 'sh-1127-05', SAT = 'sh-1128-05', WED_OPEN = 'sh-1125-02';
const WEEK = { start: at('2026-11-23', '00:00'), end: at('2026-11-30', '00:00') };
const scenario = () => structuredClone(require('../examples/scenario.json'));
const seedCopy = () => structuredClone(require('../fixtures/minimal.json'));
const seedWith = change => { const seed = seedCopy(); change(seed); return seed; };

// A failing call or event must leave business data exactly as it was.
function rejects(app, fn, code) {
  const before = app.data;
  assert.throws(fn, { code });
  assert.deepEqual(app.data, before);
}
const ev = (id, when, name, payload) => ({ event_id: id, at: when, operation: 'pegboard.' + name, payload });
const changed = (id, when, shift_id, change, reason) => ev(id, when, 'shift.changed', { shift_id, change, changed_by: ROSA, ...(reason ? { reason } : {}) });
const cancelled = (id, when, shift_id) => ev(id, when, 'shift.cancelled', { shift_id, changed_by: ROSA });
const answered = (id, when, handoff_id, answer, message) => ev(id, when, 'handoff.answered', { handoff_id, answer, ...(message ? { message } : {}) });
const decided = (id, when, handoff_id, decision, note) => ev(id, when, 'handoff.decided', { handoff_id, decision, decided_by: ROSA, ...(note ? { note } : {}) });
const received = (id, when, handoff_id, from, theirs, yours, message) => ev(id, when, 'handoff.received', { handoff_id, kind: yours ? 'trade' : 'cover', from_person_id: from, their_shift_id: theirs, ...(yours ? { your_shift_id: yours } : {}), ...(message ? { message } : {}) });
const timeOffDecided = (id, when, time_off_id, decision, note) => ev(id, when, 'time_off.decided', { time_off_id, decision, decided_by: ROSA, ...(note ? { note } : {}) });
const posted = (id, when, week_start, shifts) => ev(id, when, 'schedule.published', { week_start, shifts, posted_by: ROSA });
const slot = (shift_id, date, start, end, assignee, position_id = 'pos-cashier', location_id = 'loc-finch') => ({ shift_id, location_id, position_id, start: at(date, start), end: at(date, end), assignee });
const shift = (app, id) => app.call('shifts.get', { id }).shift;
const handoff = (app, id) => app.call('handoffs.get', { id }).handoff;
const mine = (app, window = WEEK) => app.call('shifts.list', { ...window, mine: true }).shifts;
const flags = (app, window = WEEK) => Object.fromEntries(mine(app, window).filter(s => s.flags.length).map(s => [s.id, s.flags]));
const hours = (app, window = WEEK) => app.call('hours.summary', window).weeks[0];
const notifications = app => app.call('notifications.list', { limit: 100 }).notifications;
const actions = (app, from = 0) => app.data.activity.slice(from).map(a => a.actor + ':' + a.action + ':' + a.object_id);
const LATER = at('2026-11-21', '19:00');

test('T01 [W1] shift lists: mine, a coworker\'s, open ones, by position, location and window; pagination; a shift across midnight', () => {
  const app = fixture();
  const week = mine(app);
  assert.deepEqual(week.map(s => [s.id, s.hours, s.state, s.phase, s.is_mine, s.flags]), [[MON, 6, 'assigned', 'upcoming', true, []], [THU, 6, 'assigned', 'upcoming', true, []], [FRI, 4, 'assigned', 'upcoming', true, []], [SAT, 4, 'assigned', 'upcoming', true, []]], 'my four shifts of the week of 23 November, with no flags');
  assert.deepEqual([week[0].week_start, week[0].assignee, week[0].assignee_name, week[0].cutoff_at, week[3].pending_handoff_id], ['2026-11-23', ME, 'Noor Haddad', at('2026-11-22', '06:00'), 'ho-0013']);

  const tomas = app.call('shifts.list', { ...WEEK, person_id: TOMAS }).shifts;
  assert.deepEqual(tomas.map(s => s.id), ['sh-1123-02', 'sh-1124-03', 'sh-1127-02', 'sh-1129-02']);
  assert.ok(tomas.every(s => s.is_mine === false && s.flags.length === 0), 'flags are the account holder\'s only');
  assert.deepEqual(app.call('shifts.list', { ...WEEK, open: true }).shifts.map(s => [s.id, s.state, s.assignee]), [['sh-1123-06', 'open', null], [WED_OPEN, 'open', null], ['sh-1127-01', 'open', null], ['sh-1129-04', 'open', null]]);
  assert.deepEqual(app.call('shifts.list', { ...WEEK, open: true, position_id: 'pos-cashier' }).shifts.map(s => s.id), [WED_OPEN]);
  assert.equal(app.call('shifts.list', { ...WEEK, position_id: 'pos-lead' }).shifts.length, 7);
  assert.deepEqual(app.call('shifts.list', { ...WEEK, location_id: 'loc-quay' }).shifts.map(s => s.id.slice(-2)), Array(7).fill('02'));
  assert.deepEqual(app.call('shifts.list', { ...WEEK, mine: true, location_id: 'loc-quay' }).shifts.map(s => s.id), [THU]);

  // A window selects by start time, in order of start.
  const monday = { start: at('2026-11-23', '00:00'), end: at('2026-11-24', '00:00') };
  assert.deepEqual(app.call('shifts.list', monday).shifts.map(s => s.id.slice(-2)), ['01', '03', '02', '04', '06', '05']);
  assert.deepEqual(app.call('shifts.list', { start: at('2026-11-23', '06:00'), end: at('2026-11-23', '07:00') }).shifts.map(s => s.id), [MON], 'start is inclusive and end is exclusive');
  const sunday = { start: at('2026-11-22', '00:00'), end: at('2026-11-23', '00:00') };
  assert.deepEqual([app.call('shifts.list', sunday).shifts.length, app.call('shifts.list', { ...sunday, include_cancelled: true }).shifts.filter(s => s.state === 'cancelled').map(s => s.id)], [5, ['sh-1122-02']], 'a cancelled shift is listed only on request');

  // Pagination.
  const first = app.call('shifts.list', { ...WEEK, limit: 20 }), second = app.call('shifts.list', { ...WEEK, limit: 20, cursor: first.next_cursor }), third = app.call('shifts.list', { ...WEEK, limit: 20, cursor: second.next_cursor });
  assert.deepEqual([first.shifts.length, first.next_cursor, second.shifts.length, second.next_cursor, third.shifts.length, third.next_cursor], [20, '20', 20, '40', 2, null]);
  assert.equal(new Set([...first.shifts, ...second.shifts, ...third.shifts].map(s => s.id)).size, 42);
  assert.equal(app.call('shifts.list', WEEK).shifts.length, 42, 'the default page holds a whole week');

  rejects(app, () => app.call('shifts.list', { ...WEEK, cursor: 'abc' }), 'invalid_arguments');
  rejects(app, () => app.call('shifts.list', { start: WEEK.end, end: WEEK.start }), 'invalid_window');
  rejects(app, () => app.call('shifts.list', { start: WEEK.start, end: WEEK.start }), 'invalid_window');
  rejects(app, () => app.call('shifts.list', { ...WEEK, person_id: 'person-nobody' }), 'not_found');
  rejects(app, () => app.call('shifts.list', { ...WEEK, position_id: 'pos-none' }), 'not_found');
  rejects(app, () => app.call('shifts.list', { ...WEEK, location_id: 'loc-none' }), 'not_found');

  // A shift across midnight counts in the week and on the day in which it starts.
  app.event(posted('ev-night', LATER, '2026-11-23', [{ ...slot('sh-1129-08', '2026-11-29', '23:00', '23:00', LUZ), end: at('2026-11-30', '05:00') }]));
  const night = shift(app, 'sh-1129-08');
  assert.deepEqual([night.week_start, night.hours], ['2026-11-23', 6]);
  assert.deepEqual(app.call('shifts.list', { start: at('2026-11-29', '22:30'), end: at('2026-11-30', '00:00') }).shifts.map(s => s.id), ['sh-1129-08']);
  assert.deepEqual(app.call('shifts.list', { start: at('2026-11-30', '00:00'), end: at('2026-11-30', '06:00') }).shifts.map(s => s.id), [], 'it does not belong to Monday or to the next week');
  app.event(changed('ev-night-mine', LATER, 'sh-1129-08', { assignee: ME }));
  assert.deepEqual([hours(app).scheduled_hours, hours(app).shift_ids.includes('sh-1129-08'), app.call('hours.summary', { start: at('2026-11-30', '00:00'), end: at('2026-12-07', '00:00') }).weeks[0].scheduled_hours], [26, true, 20]);

  // The week follows the workplace's time zone, also where the offset changes inside it.
  const autumn = fixture({ seed: seedWith(s => {
    s.weeks.unshift({ week_start: '2026-10-26', posted_at: at('2026-10-12', '15:00', '-07:00') });
    s.shifts.unshift({ id: 'sh-1101-09', location_id: 'loc-finch', position_id: 'pos-cashier', start: at('2026-11-01', '23:00'), end: at('2026-11-02', '03:00'), assignee: ME, history: [] });
  }) });
  assert.deepEqual([shift(autumn, 'sh-1101-09').week_start, autumn.call('hours.summary', { start: at('2026-10-26', '00:00', '-07:00'), end: at('2026-11-02', '00:00') }).weeks.map(w => [w.week_start, w.scheduled_hours])], ['2026-10-26', [['2026-10-26', 4]]]);
});

test('T02 [W1] shifts.get with its history; phase at the start and end boundaries; workplace.get and team.list', () => {
  const app = fixture();
  const friday = shift(app, 'sh-1113-05');
  assert.deepEqual([friday.location_name, friday.position_name, friday.hourly_rate, friday.phase, friday.state, friday.cancelled_at, friday.history.length], ['Finch Street', 'Cashier', 16.5, 'ended', 'assigned', null, 2]);
  assert.deepEqual(friday.history[0], { at: at('2026-10-26', '15:00', '-07:00'), by: 'schedule', event_id: 'hist-001', changed_by: ROSA, change: { posted: { from: null, to: ME } } });
  assert.deepEqual(friday.history[1], { at: at('2026-11-05', '14:00'), by: 'manager', event_id: 'hist-006', changed_by: ROSA, reason: 'Close moved an hour later', change: { start: { from: at('2026-11-13', '15:00'), to: at('2026-11-13', '16:00') }, end: { from: at('2026-11-13', '19:00'), to: at('2026-11-13', '20:00') } } });
  assert.deepEqual(shift(app, 'sh-1119-02').history[1], { at: at('2026-11-12', '16:00'), by: 'handoff', handoff_id: 'ho-0006', event_id: 'hist-010', change: { assignee: { from: null, to: ME } } }, 'a handoff that moved the shift is in its history');
  const gone = shift(app, 'sh-1122-02');
  assert.deepEqual([gone.state, gone.cancelled_at, gone.history.at(-1).change], ['cancelled', at('2026-11-19', '09:00'), { cancelled: { from: false, to: true } }]);
  assert.deepEqual([shift(app, SAT).pending_handoff_id, shift(app, 'sh-1114-05').pending_handoff_id, shift(app, THU).cutoff_at], ['ho-0013', null, at('2026-11-25', '08:00')], 'an expired handoff is not pending');
  rejects(app, () => app.call('shifts.get', { id: 'sh-none' }), 'not_found');

  // phase follows the clock: upcoming until the start, started until the end, then ended.
  const phase = () => shift(app, SUN_CLOSE).phase, stored = app.data;
  assert.equal(phase(), 'upcoming');
  for (const [when, expected] of [['15:59:59', 'upcoming'], ['16:00', 'started'], ['19:59:59', 'started'], ['20:00', 'ended']]) {
    app.advance(at('2026-11-22', when));
    assert.equal(phase(), expected, 'at ' + when);
  }
  assert.deepEqual(app.data, stored, 'no record changed while the phase did');

  const place = app.call('workplace.get');
  assert.deepEqual(place.workplace.policy, { min_rest_hours: 10, max_weekly_hours: 40, handoff_cutoff_hours: 24, time_off_notice_days: 14, manager_approval: true });
  assert.deepEqual([place.workplace.name, place.workplace.timezone, place.workplace.week_start, place.workplace.locations.length, place.workplace.positions.map(p => [p.id, p.hourly_rate])], ['Finch Street Café', 'America/Los_Angeles', 'monday', 2, [['pos-barista', 17.5], ['pos-cashier', 16.5], ['pos-lead', 20]]]);
  assert.deepEqual([place.me.id, place.me.is_me, place.me.cap, place.me.max_weekly_hours, place.me.position_ids], [ME, true, 24, 24, ['pos-barista', 'pos-cashier']]);
  const team = app.call('team.list').people;
  assert.deepEqual([team.length, team.filter(p => p.is_me).map(p => p.id), team.filter(p => p.role === 'manager').map(p => p.id)], [10, [ME], [ROSA]]);
  assert.deepEqual(team.filter(p => [KAI, TOMAS].includes(p.id)).map(p => [p.id, p.max_weekly_hours, p.cap]), [[TOMAS, null, 40], [KAI, 20, 20]], 'a person without a cap of their own has the workplace\'s');
  assert.deepEqual(app.call('team.list', { position_id: 'pos-lead' }).people.map(p => p.id), [INES, LUZ]);
  rejects(app, () => app.call('team.list', { position_id: 'pos-none' }), 'not_found');
});

test('T03 [W1] weekly summary: hours, the cap that applies, hours left, days worked, estimated pay; a cancelled shift counts nowhere', () => {
  const app = fixture();
  assert.deepEqual(hours(app), {
    week_start: '2026-11-23', week_end: '2026-11-29', posted_at: at('2026-11-09', '15:00'), scheduled_hours: 20, cap: 24, hours_left: 4, over_cap: false, days_worked: 4,
    shift_ids: [MON, THU, FRI, SAT], estimated_pay: { amount: 336, currency: 'USD', estimate: true },
  }, '6 h barista at 17.50 and 6 + 4 + 4 h cashier at 16.50');
  const all = app.call('hours.summary', { start: at('2026-11-09', '00:00'), end: at('2026-12-07', '00:00') }).weeks;
  assert.deepEqual(all.map(w => [w.week_start, w.scheduled_hours, w.estimated_pay.amount]), [['2026-11-09', 20, 342], ['2026-11-16', 20, 336], ['2026-11-23', 20, 336], ['2026-11-30', 20, 330]]);
  assert.deepEqual(app.call('hours.summary', { start: at('2026-11-25', '12:00'), end: at('2026-11-25', '13:00') }).weeks.map(w => w.week_start), ['2026-11-23'], 'any window inside a week returns that whole week');
  const unposted = app.call('hours.summary', { start: at('2026-12-07', '00:00'), end: at('2026-12-14', '00:00') }).weeks[0];
  assert.deepEqual([unposted.posted_at, unposted.scheduled_hours, unposted.hours_left, unposted.shift_ids], [null, 0, 24, []], 'a week that was never posted has no shifts');
  rejects(app, () => app.call('hours.summary', { start: WEEK.end, end: WEEK.start }), 'invalid_window');
  rejects(app, () => app.call('hours.summary', { start: at('2026-01-01', '00:00'), end: at('2027-06-01', '00:00') }), 'invalid_window');

  // The cap that applies is the lower of the workplace's and the person's own.
  const noCap = fixture({ seed: seedWith(s => { s.people[0].max_weekly_hours = null; }) });
  assert.deepEqual([hours(noCap).cap, hours(noCap).hours_left], [40, 20]);
  const low = fixture({ seed: seedWith(s => { s.workplace.policy.max_weekly_hours = 16; }) });
  assert.deepEqual([hours(low).cap, hours(low).hours_left, hours(low).over_cap, flags(low)], [16, 0, true, { [SAT]: ['over_hours'] }]);

  // A cancelled shift leaves every count.
  app.event(cancelled('ev-cancel-thu', LATER, THU));
  const after = hours(app);
  assert.deepEqual([after.scheduled_hours, after.hours_left, after.days_worked, after.shift_ids, after.estimated_pay.amount], [14, 10, 3, [MON, FRI, SAT], 237]);
  assert.deepEqual(mine(app).map(s => s.id), [MON, FRI, SAT]);
  assert.equal(app.call('eligibility.check', { id: WED_OPEN }).hours.before, 14);
});

test('T04 [W1] flags on a schedule the manager made: overlap, short_rest, over_hours, outside_availability, during_time_off', () => {
  const app = fixture();
  assert.deepEqual(flags(app, { start: at('2026-11-09', '00:00'), end: at('2026-12-07', '00:00') }), { 'sh-1201-03': ['outside_availability'] }, 'the fixture shows one flag: a Tuesday shift over a declared class');

  // short_rest across two days: the manager moves Monday's open to 05:00, nine hours after Sunday's close ends at 20:00.
  app.event(scenario());
  assert.deepEqual([shift(app, SUN_CLOSE).end, shift(app, MON).start, shift(app, MON).flags, shift(app, SUN_CLOSE).flags], [at('2026-11-22', '20:00'), at('2026-11-23', '05:00'), ['short_rest'], ['short_rest']], 'both shifts on either side of the short rest carry the flag');
  assert.equal(hours(app).scheduled_hours, 20);

  // ... and not within one day: a second shift on Thursday two hours after the first.
  app.event(changed('ev-thu-close', at('2026-11-21', '20:50'), 'sh-1126-05', { assignee: ME }));
  assert.deepEqual(flags(app), { [MON]: ['short_rest'] }, 'two shifts on one day need no rest between them; the week is exactly at the cap');
  assert.deepEqual([hours(app).scheduled_hours, hours(app).over_cap, hours(app).days_worked], [24, false, 4]);

  // overlap, and over_hours on the shifts that take the week past the cap, counted in order of start.
  app.event(changed('ev-thu-overlap', at('2026-11-21', '21:00'), 'sh-1126-03', { assignee: ME }));
  assert.deepEqual(flags(app), { [MON]: ['short_rest'], 'sh-1126-03': ['overlap'], [THU]: ['overlap'], [FRI]: ['over_hours'], [SAT]: ['over_hours'] });
  assert.deepEqual([hours(app).scheduled_hours, hours(app).over_cap, hours(app).hours_left], [30, true, 0]);
  assert.deepEqual(app.call('shifts.list', { ...WEEK, person_id: SAM }).shifts.every(s => s.flags.length === 0), true);

  // outside_availability and during_time_off compare a shift with my own blocks and approved time off.
  const personal = fixture({ seed: seedWith(s => {
    s.availability = [{ weekday: 'thu', start: '13:30', end: '15:00' }, { weekday: 'sat', start: '20:00', end: '22:00' }];
    s.time_off.push({ id: 'to-0006', start_date: '2026-11-27', end_date: '2026-11-28', state: 'approved', requested_at: at('2026-11-01', '09:00', '-07:00'), decided_at: at('2026-11-02', '09:00'), decided_by: ROSA, history: [{ at: at('2026-11-01', '09:00', '-07:00'), actor: 'me', action: 'requested', state: 'pending' }, { at: at('2026-11-02', '09:00'), actor: 'manager', action: 'approved', state: 'approved' }] });
    s.time_off.push({ id: 'to-0007', start_date: '2026-11-23', end_date: '2026-11-23', state: 'pending', requested_at: at('2026-11-01', '09:00', '-07:00'), history: [{ at: at('2026-11-01', '09:00', '-07:00'), actor: 'me', action: 'requested', state: 'pending' }] });
  }) });
  assert.deepEqual(flags(personal), { [THU]: ['outside_availability'], [FRI]: ['during_time_off'], [SAT]: ['during_time_off'] }, 'a block that touches the shift by half an hour counts; a block that starts as the shift ends does not; pending time off does not');
  assert.deepEqual(flags(personal, { start: at('2026-11-30', '00:00'), end: at('2026-12-07', '00:00') }), { 'sh-1203-02': ['outside_availability'] }, 'a block repeats every week; time off does not');
});

test('T05 [W1] eligibility.check for me, for a coworker and for a trade: every rule, the hours and rest gaps, the cut-off; nothing is written', () => {
  const app = fixture(), before = app.data;
  assert.deepEqual(app.call('eligibility.check', { id: WED_OPEN }), {
    person_id: ME, shift_id: WED_OPEN, eligible: false, blocks: ['over_hours'], hours: { week_start: '2026-11-23', before: 20, after: 26, cap: 24 },
    rest: { before_hours: 44, after_hours: 18, minimum: 10 }, shift_state: 'open', flags: [], pending_handoff_id: null, cutoff_at: at('2026-11-24', '08:00'), cutoff_passed: false, other: null,
  }, 'the open six-hour Wednesday shift would take the week to 26 of 24 hours');
  const tomas = app.call('eligibility.check', { id: THU, person_id: TOMAS });
  assert.deepEqual([tomas.eligible, tomas.blocks, tomas.hours, tomas.shift_state], [true, [], { week_start: '2026-11-23', before: 24, after: 30, cap: 40 }, 'assigned']);
  const kai = app.call('eligibility.check', { id: MON, person_id: KAI });
  assert.deepEqual([kai.eligible, kai.blocks, kai.hours.after, kai.hours.cap], [false, ['not_qualified', 'overlap'], 20, 20], 'every rule that fails is listed: Kai is not a barista and works 07:00 to 13:00 that day');
  const ines = app.call('eligibility.check', { id: MON, person_id: INES });
  assert.deepEqual([ines.blocks, ines.rest], [['short_rest'], { before_hours: 9, after_hours: 25, minimum: 10 }], 'Ines closes at 21:00 the evening before a 06:00 open');
  assert.deepEqual(app.call('eligibility.check', { id: 'sh-1201-02' }).blocks, ['overlap', 'over_hours']);
  assert.deepEqual(app.call('eligibility.check', { id: 'sh-1123-06' }).blocks, ['not_qualified', 'over_hours']);
  assert.deepEqual(app.call('eligibility.check', { id: 'sh-1201-02' }).flags, ['outside_availability'], 'my own blocks are reported for a shift I would take');
  const own = app.call('eligibility.check', { id: MON });
  assert.deepEqual([own.eligible, own.hours.before, own.hours.after], [true, 20, 20], 'a shift I already hold adds nothing');

  // A trade: each person is checked with the shift they give up left out.
  const alone = app.call('eligibility.check', { id: 'sh-1127-02' });
  assert.deepEqual([alone.blocks, alone.hours.after, alone.other], [['over_hours'], 26, null], 'taking Tomas\'s six-hour Friday shift on top of mine would pass the cap');
  const trade = app.call('eligibility.check', { id: 'sh-1127-02', give_shift_id: FRI });
  assert.deepEqual([trade.eligible, trade.hours, trade.cutoff_at], [true, { week_start: '2026-11-23', before: 20, after: 22, cap: 24 }, at('2026-11-26', '08:00')], 'giving up the four-hour Friday close leaves 22; the cut-off is that of the earlier shift');
  assert.deepEqual([trade.other.person_id, trade.other.shift_id, trade.other.eligible, trade.other.hours], [TOMAS, FRI, true, { week_start: '2026-11-23', before: 24, after: 22, cap: 40 }]);
  const sameTime = app.call('eligibility.check', { id: 'sh-1126-03', give_shift_id: THU });
  assert.deepEqual([sameTime.eligible, sameTime.other.eligible, app.call('eligibility.check', { id: 'sh-1126-03' }).blocks], [true, true, ['overlap', 'over_hours']], 'the shift given up does not count as an overlap');
  const lead = app.call('eligibility.check', { id: 'sh-1127-06', give_shift_id: FRI });
  assert.deepEqual([lead.blocks, lead.other.blocks], [['not_qualified'], ['not_qualified']], 'both sides of a trade are reported');

  // The cut-off is the policy's hours before the shift starts; cutoff_passed follows the clock.
  assert.deepEqual([own.cutoff_at, own.cutoff_passed, own.pending_handoff_id, app.call('eligibility.check', { id: SAT, person_id: TOMAS }).pending_handoff_id], [at('2026-11-22', '06:00'), false, null, 'ho-0013']);
  rejects(app, () => app.call('eligibility.check', { id: 'sh-none' }), 'not_found');
  rejects(app, () => app.call('eligibility.check', { id: MON, person_id: 'person-nobody' }), 'not_found');
  rejects(app, () => app.call('eligibility.check', { id: MON, give_shift_id: 'sh-none' }), 'not_found');
  assert.deepEqual(app.data, before, 'eligibility.check writes nothing');
  app.advance(at('2026-11-22', '06:00'));
  assert.equal(app.call('eligibility.check', { id: MON, person_id: PIP }).cutoff_passed, true);
  assert.deepEqual(app.data, before);
});

test('T06 [W2] availability: replace the pattern, refuse overlapping or reversed blocks, flags follow; preferences: quiet hours, time zone and the two notice settings', () => {
  const app = fixture();
  assert.deepEqual(app.call('availability.get').blocks, [{ weekday: 'tue', start: '09:00', end: '13:00' }, { weekday: 'wed', start: '18:00', end: '21:00' }, { weekday: 'sun', start: '08:00', end: '12:00' }]);
  const rows = app.data.activity.length, stored = app.data;
  const set = app.call('availability.update', { blocks: [{ weekday: 'thu', start: '09:00', end: '13:00' }], request_id: 'req-thursday' });
  assert.deepEqual(set, { id: 'pegboard-noor', blocks: [{ weekday: 'thu', start: '09:00', end: '13:00' }] });
  assert.deepEqual(flags(app, { start: at('2026-11-23', '00:00'), end: at('2026-12-07', '00:00') }), { [THU]: ['outside_availability'], 'sh-1203-02': ['outside_availability'] }, 'my Thursday 08:00 to 14:00 shifts now read outside_availability, and the Tuesday flag is gone with its block');
  assert.deepEqual([app.data.shifts, app.data.handoffs, app.data.notifications], [stored.shifts, stored.handoffs, stored.notifications], 'nothing is rescheduled and nobody is told');
  assert.deepEqual(app.data.activity.slice(rows), [{ seq: rows + 1, at: app.now, actor: 'agent', action: 'availability.update', object_id: 'pegboard-noor', request_id: 'req-thursday', details: { blocks: 1 } }]);

  const sorted = app.call('availability.update', { blocks: [{ weekday: 'sun', start: '08:00', end: '12:00' }, { weekday: 'mon', start: '11:00', end: '13:00' }, { weekday: 'mon', start: '09:00', end: '11:00' }] }).blocks;
  assert.deepEqual(sorted.map(b => b.weekday + ' ' + b.start), ['mon 09:00', 'mon 11:00', 'sun 08:00'], 'blocks that only touch are allowed, and the pattern is kept in week order');
  rejects(app, () => app.call('availability.update', { blocks: [{ weekday: 'mon', start: '09:00', end: '11:00' }, { weekday: 'mon', start: '10:30', end: '12:00' }] }), 'invalid_arguments');
  rejects(app, () => app.call('availability.update', { blocks: [{ weekday: 'mon', start: '13:00', end: '09:00' }] }), 'invalid_arguments');
  rejects(app, () => app.call('availability.update', { blocks: [{ weekday: 'mon', start: '09:00', end: '09:00' }] }), 'invalid_arguments');
  assert.throws(() => app.call('availability.update', { blocks: [{ weekday: 'monday', start: '09:00', end: '10:00' }] }), { code: 'invalid_arguments' }, 'the input schema refuses an unknown weekday');
  assert.throws(() => app.call('availability.update', { blocks: [{ weekday: 'mon', start: '9:00', end: '10:00' }] }), { code: 'invalid_arguments' });
  assert.deepEqual([app.call('availability.update', { blocks: [] }).blocks, flags(app, { start: at('2026-11-09', '00:00'), end: at('2026-12-07', '00:00') })], [[], {}], 'an empty pattern clears every block');

  // Preferences.
  assert.deepEqual(app.call('preferences.get').preferences, { timezone: 'America/Los_Angeles', quiet_hours: { enabled: true, start: '22:00', end: '07:00' }, email_notices: true, open_shift_notices: true, in_quiet_hours: false });
  rejects(app, () => app.call('preferences.update', { patch: {} }), 'invalid_arguments');
  rejects(app, () => app.call('preferences.update', { patch: { timezone: 'Nowhere/Land' } }), 'invalid_timezone');
  rejects(app, () => app.call('preferences.update', { patch: { quiet_hours: { start: '07:00' } } }), 'invalid_arguments');
  rejects(app, () => app.call('preferences.update', { patch: { quiet_hours: { start: '21:00', end: '21:00' } } }), 'invalid_arguments');
  assert.throws(() => app.call('preferences.update', { patch: { quiet_hours: { start: '25:00' } } }), { code: 'invalid_arguments' });
  assert.throws(() => app.call('preferences.update', { patch: { units: 'us' } }), { code: 'invalid_arguments' }, 'unknown fields are refused by the input schema');
  const quiet = app.call('preferences.update', { patch: { quiet_hours: { start: '17:30' } } });
  assert.deepEqual([quiet.id, quiet.preferences.quiet_hours, quiet.preferences.in_quiet_hours], ['pegboard-noor', { enabled: true, start: '17:30', end: '07:00' }, true], 'a partial quiet-hours patch keeps the other fields; quiet hours may cross midnight');
  assert.equal(app.call('preferences.update', { patch: { quiet_hours: { enabled: false } } }).preferences.in_quiet_hours, false);
  // Quiet hours are taken in the account's time zone: 18:00 in Los Angeles is 21:00 in New York.
  const east = app.call('preferences.update', { patch: { timezone: 'America/New_York', quiet_hours: { enabled: true, start: '20:30', end: '06:00' }, email_notices: false, open_shift_notices: false } }).preferences;
  assert.deepEqual(east, { timezone: 'America/New_York', quiet_hours: { enabled: true, start: '20:30', end: '06:00' }, email_notices: false, open_shift_notices: false, in_quiet_hours: true });
  assert.deepEqual(app.data.preferences, { timezone: 'America/New_York', quiet_hours: { enabled: true, start: '20:30', end: '06:00' }, email_notices: false, open_shift_notices: false }, 'in_quiet_hours is derived, never stored');
  assert.deepEqual(app.data.activity.at(-1).details, { fields: ['timezone', 'quiet_hours', 'email_notices', 'open_shift_notices'] });
  assert.equal(app.data.notifications.length, stored.notifications.length, 'my own writes notify nobody');
});

test('T07 [W2] time off: request, approve, deny, cancel while pending and after approval; refusals; a pending entry expires on its first day', () => {
  const app = fixture();
  const listed = args => app.call('time_off.list', args).time_off.map(t => t.id + ' ' + t.state);
  assert.deepEqual([listed(), listed({ include_closed: true }), listed({ state: 'expired' })], [['to-0005 pending', 'to-0002 approved'], ['to-0005 pending', 'to-0004 denied', 'to-0003 cancelled', 'to-0002 approved', 'to-0001 expired'], ['to-0001 expired']], 'an entry nobody decided reads expired once its first day has begun');

  // Request for 12-13 December, 21 days ahead under a 14-day notice.
  const asked = app.call('time_off.request', { start: '2026-12-12', end: '2026-12-13', reason: 'Recital weekend', request_id: 'req-recital' });
  assert.deepEqual(asked, { id: 'to-0006', time_off: {
    id: 'to-0006', start_date: '2026-12-12', end_date: '2026-12-13', days: 2, reason: 'Recital weekend', state: 'pending', requested_at: app.now, expires_at: at('2026-12-12', '00:00'),
    decided_at: null, decided_by: null, note: null, history: [{ at: app.now, actor: 'me', action: 'requested', state: 'pending', request_id: 'req-recital' }],
  } });
  app.event(timeOffDecided('ev-approve', LATER, 'to-0006', 'approve', 'Enjoy the recital.'));
  const approved = app.call('time_off.list', { state: 'approved' }).time_off[0];
  assert.deepEqual([approved.id, approved.state, approved.decided_at, approved.decided_by, approved.note, approved.history.at(-1)], ['to-0006', 'approved', LATER, ROSA, 'Enjoy the recital.', { at: LATER, actor: 'manager', action: 'approved', state: 'approved', event_id: 'ev-approve', person_id: ROSA, note: 'Enjoy the recital.' }]);
  const told = notifications(app)[0];
  assert.deepEqual([told.kind, told.object, told.title, told.body], ['time_off.decided', { type: 'time_off', id: 'to-0006' }, 'Time off approved: Saturday 12 December to Sunday 13 December', 'Rosa approved your time off for Saturday 12 December to Sunday 13 December. Note: Enjoy the recital.']);
  // The manager is not checked: a shift she later assigns me on 12 December is applied and flagged.
  const december = { start: at('2026-12-07', '00:00'), end: at('2026-12-14', '00:00') };
  app.event(posted('ev-week-1207', at('2026-11-21', '19:10'), '2026-12-07', [slot('sh-1212-05', '2026-12-12', '16:00', '20:00', KAI), slot('sh-1210-05', '2026-12-10', '16:00', '20:00', ME)]));
  app.event(changed('ev-assign-1212', at('2026-11-21', '19:20'), 'sh-1212-05', { assignee: ME }));
  assert.deepEqual(flags(app, december), { 'sh-1212-05': ['during_time_off'] });

  // Refusals leave everything as it was.
  rejects(app, () => app.call('time_off.request', { start: '2026-11-26', end: '2026-11-26' }), 'too_late');
  rejects(app, () => app.call('time_off.request', { start: '2026-12-04', end: '2026-12-06' }), 'too_late');
  rejects(app, () => app.call('time_off.request', { start: '2026-12-05', end: '2026-12-05' }), 'shift_assigned');
  rejects(app, () => app.call('time_off.request', { start: '2026-12-08', end: '2026-12-10' }), 'shift_assigned');
  rejects(app, () => app.call('time_off.request', { start: '2026-12-26', end: '2026-12-27' }), 'conflict');
  rejects(app, () => app.call('time_off.request', { start: '2026-12-13', end: '2026-12-14' }), 'conflict');
  rejects(app, () => app.call('time_off.request', { start: '2026-11-21', end: '2026-11-22' }), 'invalid_window');
  rejects(app, () => app.call('time_off.request', { start: '2026-11-10', end: '2026-11-10' }), 'invalid_window');
  rejects(app, () => app.call('time_off.request', { start: '2026-12-16', end: '2026-12-15' }), 'invalid_window');
  rejects(app, () => app.call('time_off.request', { start: '2027-01-04', end: '2027-02-03' }), 'invalid_window');
  rejects(app, () => app.call('time_off.request', { start: '2027-02-30', end: '2027-03-01' }), 'invalid_window');
  assert.equal(app.call('time_off.request', { start: '2027-01-04', end: '2027-02-02' }).time_off.days, 30, 'thirty days is the longest request');
  assert.equal(app.call('time_off.request', { start: '2026-12-06', end: '2026-12-06' }).id, 'to-0008', 'the first day allowed is 14 days after today, on a day without a shift of mine');

  // Deny, and cancel while pending and after approval.
  app.event(timeOffDecided('ev-deny', at('2026-11-21', '19:30'), 'to-0008', 'deny'));
  assert.deepEqual(listed({ state: 'denied' }), ['to-0008 denied', 'to-0004 denied']);
  rejects(app, () => app.call('time_off.cancel', { id: 'to-0008' }), 'invalid_state');
  rejects(app, () => app.call('time_off.cancel', { id: 'to-0004' }), 'invalid_state');
  rejects(app, () => app.call('time_off.cancel', { id: 'to-0003' }), 'invalid_state');
  rejects(app, () => app.call('time_off.cancel', { id: 'to-0002' }), 'invalid_state');
  rejects(app, () => app.call('time_off.cancel', { id: 'to-0001' }), 'invalid_state');
  rejects(app, () => app.call('time_off.cancel', { id: 'to-none' }), 'not_found');
  const pendingCancelled = app.call('time_off.cancel', { id: 'to-0005', request_id: 'req-cancel-5' });
  assert.deepEqual([pendingCancelled.id, pendingCancelled.time_off.state, pendingCancelled.time_off.history.at(-1)], ['to-0005', 'cancelled', { at: app.now, actor: 'me', action: 'cancelled', state: 'cancelled', request_id: 'req-cancel-5' }]);
  assert.equal(app.call('time_off.request', { start: '2026-12-26', end: '2026-12-27' }).time_off.state, 'pending', 'a cancelled entry no longer blocks its days');
  assert.equal(app.call('time_off.cancel', { id: 'to-0006' }).time_off.state, 'cancelled', 'an approved entry can be cancelled before its first day');
  assert.deepEqual(flags(app, december), {}, 'and the flag goes with it');
  rejects(app, () => app.event(timeOffDecided('ev-late-decision', at('2026-11-21', '19:40'), 'to-0006', 'approve')), 'invalid_event');
  rejects(app, () => app.event(timeOffDecided('ev-unknown', at('2026-11-21', '19:40'), 'to-none', 'approve')), 'invalid_event');

  // A pending entry expires when its first day begins: the clock moves, and no App code runs.
  const waiting = app.call('time_off.request', { start: '2026-12-15', end: '2026-12-16' }).id, stored = app.data;
  const state = () => app.call('time_off.list', { include_closed: true }).time_off.find(t => t.id === waiting).state;
  app.advance(at('2026-12-14', '23:59:59'));
  assert.equal(state(), 'pending');
  app.advance(at('2026-12-15', '00:00'));
  assert.equal(state(), 'expired');
  assert.deepEqual(app.data, stored, 'expiry is read from the first day and the clock; nothing is rewritten');
  rejects(app, () => app.event(timeOffDecided('ev-after-expiry', at('2026-12-15', '09:00'), waiting, 'approve')), 'invalid_event');
  rejects(app, () => app.call('time_off.cancel', { id: waiting }), 'invalid_state');
  assert.equal(app.call('time_off.request', { start: '2026-12-29', end: '2026-12-30' }).time_off.state, 'pending');
  // An approved entry stays approved once it has begun, and can no longer be cancelled.
  const begun = fixture({ seed: seedWith(s => { const t = s.time_off.find(x => x.id === 'to-0005'); t.state = 'approved'; t.decided_at = at('2026-11-20', '12:00'); t.decided_by = ROSA; t.history.push({ at: at('2026-11-20', '12:00'), actor: 'manager', action: 'approved', state: 'approved' }); }) });
  begun.advance(at('2026-12-23', '23:59'));
  assert.equal(begun.call('time_off.cancel', { id: 'to-0005' }).time_off.state, 'cancelled');
  const later = fixture({ seed: begun.snapshot().initial_data, now: at('2026-12-24', '00:00') });
  rejects(later, () => later.call('time_off.cancel', { id: 'to-0005' }), 'invalid_state');
});

test('T08 [W3] cover: ask, accept, approve, and the shift changes hands exactly once, with history; decline; deny; cancel; no manager approval', () => {
  const app = fixture(), rows = app.data.activity.length, told = app.data.notifications.length;
  const message = 'I have a seminar on Thursday morning. Could you take the kiosk?';
  const asked = app.call('handoffs.cover', { id: THU, to_person_id: TOMAS, message, request_id: 'req-cover-thu' });
  assert.deepEqual(asked, { id: 'ho-0015', handoff: {
    id: 'ho-0015', kind: 'cover', state: 'awaiting_coworker', asked_by_me: true, requester_id: ME, counterpart_id: TOMAS,
    shift: { id: THU, start: at('2026-11-26', '08:00'), end: at('2026-11-26', '14:00'), hours: 6, position_id: 'pos-cashier', location_id: 'loc-quay', assignee: ME, state: 'assigned' },
    other_shift: null, message, cutoff_at: at('2026-11-25', '08:00'), created_at: app.now, decided_by: null, note: null,
    history: [{ at: app.now, actor: 'me', action: 'requested', state: 'awaiting_coworker', request_id: 'req-cover-thu' }],
  } });
  assert.deepEqual([shift(app, THU).assignee, shift(app, THU).pending_handoff_id, hours(app).scheduled_hours, app.data.notifications.length], [ME, 'ho-0015', 20, told], 'the shift is still mine and nobody is notified of my own request');

  app.event(answered('ev-accept', LATER, 'ho-0015', 'accept', 'Sure, I can take it.'));
  assert.deepEqual([handoff(app, 'ho-0015').state, shift(app, THU).assignee, handoff(app, 'ho-0015').history.at(-1)], ['awaiting_manager', ME, { at: LATER, actor: 'coworker', action: 'accepted', state: 'awaiting_manager', event_id: 'ev-accept', person_id: TOMAS, note: 'Sure, I can take it.' }], 'responsibility does not move while the manager has not decided');
  const approval = at('2026-11-21', '19:10');
  app.event(decided('ev-approve', approval, 'ho-0015', 'approve', 'Approved.'));
  const done = handoff(app, 'ho-0015'), moved = shift(app, THU);
  assert.deepEqual([done.state, done.decided_by, done.note, done.shift.assignee, done.history.map(r => r.action + '>' + r.state)], ['approved', ROSA, 'Approved.', TOMAS, ['requested>awaiting_coworker', 'accepted>awaiting_manager', 'approved>approved']]);
  assert.deepEqual([moved.assignee, moved.assignee_name, moved.is_mine, moved.pending_handoff_id, moved.history.length, moved.history.at(-1)], [TOMAS, 'Tomas Lindqvist', false, null, 2, { at: approval, by: 'handoff', handoff_id: 'ho-0015', event_id: 'ev-approve', change: { assignee: { from: ME, to: TOMAS } } }]);
  assert.deepEqual([hours(app).scheduled_hours, mine(app).map(s => s.id), app.call('shifts.list', { ...WEEK, person_id: TOMAS }).shifts.length], [14, [MON, FRI, SAT], 5]);
  assert.deepEqual(actions(app, rows), ['agent:handoffs.cover:ho-0015', 'event:handoff.answered:ho-0015', 'event:notification.created:ntf-0017', 'event:handoff.decided:ho-0015', 'event:shift.reassigned:' + THU, 'event:notification.created:ntf-0018']);
  assert.deepEqual(notifications(app).slice(0, 2).map(n => [n.kind, n.object.id, n.title, n.body]), [
    ['handoff.updated', 'ho-0015', 'Your cover was approved', 'Rosa approved cover ho-0015: the shift is now Tomas\'s. Note: Approved.'],
    ['handoff.updated', 'ho-0015', 'Tomas accepted your cover request', 'Tomas accepted your cover request ho-0015. It now waits for the manager; the shift is still yours until it is approved. Message: Sure, I can take it.'],
  ]);
  // Exactly once: nothing more can be answered or decided, and the shift is no longer mine to hand over.
  rejects(app, () => app.event(decided('ev-approve-again', at('2026-11-21', '19:20'), 'ho-0015', 'approve')), 'invalid_event');
  rejects(app, () => app.event(answered('ev-accept-again', at('2026-11-21', '19:20'), 'ho-0015', 'accept')), 'invalid_event');
  rejects(app, () => app.call('handoffs.cancel', { id: 'ho-0015' }), 'invalid_state');
  rejects(app, () => app.call('handoffs.cover', { id: THU, to_person_id: JO }), 'not_yours');

  // Decline: the shift stays mine.
  const second = app.call('handoffs.cover', { id: FRI, to_person_id: TOMAS }).id;
  app.event(answered('ev-decline', at('2026-11-21', '19:30'), second, 'decline', 'Sorry, I can\'t that evening'));
  assert.deepEqual([second, handoff(app, second).state, shift(app, FRI).assignee, shift(app, FRI).pending_handoff_id, notifications(app)[0].body], ['ho-0016', 'declined', ME, null, 'Tomas declined your cover request ho-0016. The shift is still yours. Message: Sorry, I can\'t that evening.']);
  rejects(app, () => app.event(decided('ev-decide-declined', at('2026-11-21', '19:40'), second, 'approve')), 'invalid_event');
  // Deny: the fixture's pending request to Tomas for Saturday's close.
  app.event(answered('ev-accept-sat', at('2026-11-21', '19:40'), 'ho-0013', 'accept'));
  app.event(decided('ev-deny-sat', at('2026-11-21', '19:50'), 'ho-0013', 'deny', 'Tomas is at 34 hours that week.'));
  assert.deepEqual([handoff(app, 'ho-0013').state, handoff(app, 'ho-0013').note, shift(app, SAT).assignee, shift(app, SAT).history.length, notifications(app)[0].body], ['denied', 'Tomas is at 34 hours that week.', ME, 1, 'Rosa denied cover ho-0013. Nothing changed hands. Note: Tomas is at 34 hours that week.']);
  // Cancel while pending; the shift can then be asked for again.
  const third = app.call('handoffs.cover', { id: MON, to_person_id: PIP }).id;
  const withdrawn = app.call('handoffs.cancel', { id: third, request_id: 'req-cancel' });
  assert.deepEqual([withdrawn.id, withdrawn.handoff.state, withdrawn.handoff.history.at(-1), shift(app, MON).pending_handoff_id], [third, 'cancelled', { at: app.now, actor: 'me', action: 'cancelled', state: 'cancelled', request_id: 'req-cancel' }, null]);
  rejects(app, () => app.event(answered('ev-answer-cancelled', at('2026-11-21', '19:55'), third, 'accept')), 'invalid_event');
  rejects(app, () => app.call('handoffs.cancel', { id: third }), 'invalid_state');
  assert.equal(app.call('handoffs.cover', { id: MON, to_person_id: PIP }).handoff.state, 'awaiting_coworker');

  rejects(app, () => app.call('handoffs.cover', { id: FRI, to_person_id: ME }), 'invalid_arguments');
  rejects(app, () => app.call('handoffs.cover', { id: FRI, to_person_id: 'person-nobody' }), 'not_found');
  rejects(app, () => app.call('handoffs.cover', { id: 'sh-none', to_person_id: TOMAS }), 'not_found');
  rejects(app, () => app.call('handoffs.cover', { id: FRI, to_person_id: ROSA }), 'not_qualified');
  rejects(app, () => app.call('handoffs.cancel', { id: 'ho-none' }), 'not_found');

  // Where the workplace does not ask for the manager, the coworker's acceptance completes the cover.
  const direct = fixture({ seed: seedWith(s => { s.workplace.policy.manager_approval = false; }) });
  const id = direct.call('handoffs.cover', { id: THU, to_person_id: TOMAS }).id, before = direct.data.activity.length;
  assert.equal(shift(direct, THU).assignee, ME);
  direct.event(answered('ev-direct', LATER, id, 'accept'));
  assert.deepEqual([handoff(direct, id).state, handoff(direct, id).decided_by, shift(direct, THU).assignee, shift(direct, THU).history.at(-1)], ['approved', null, TOMAS, { at: LATER, by: 'handoff', handoff_id: id, event_id: 'ev-direct', change: { assignee: { from: ME, to: TOMAS } } }]);
  assert.deepEqual([actions(direct, before), direct.data.activity[before].details, notifications(direct)[0].body], [['event:handoff.answered:' + id, 'event:shift.reassigned:' + THU, 'event:notification.created:ntf-0017'], { answer: 'accept', state: 'approved' }, 'Tomas accepted your cover request ' + id + '. No approval is needed: the change is done.']);
  rejects(direct, () => direct.event(decided('ev-direct-decide', at('2026-11-21', '19:10'), id, 'approve')), 'invalid_event');
});

test('T09 [W3] trade: both people are checked with the shift they give up left out; approval exchanges both shifts in one step; not_theirs', () => {
  const app = fixture();
  const asked = app.call('handoffs.trade', { id: FRI, their_shift_id: 'sh-1127-02', message: 'Could I take your Friday kiosk shift if you take my close?' }).handoff;
  assert.deepEqual([asked.id, asked.kind, asked.state, asked.requester_id, asked.counterpart_id, asked.shift.id, asked.other_shift.id, asked.other_shift.assignee, asked.cutoff_at], ['ho-0015', 'trade', 'awaiting_coworker', ME, TOMAS, FRI, 'sh-1127-02', TOMAS, at('2026-11-26', '08:00')], 'the cut-off is that of the earlier of the two shifts');
  assert.deepEqual([shift(app, FRI).pending_handoff_id, shift(app, 'sh-1127-02').pending_handoff_id], ['ho-0015', 'ho-0015']);
  app.event(answered('ev-accept', LATER, 'ho-0015', 'accept'));
  assert.deepEqual([handoff(app, 'ho-0015').state, shift(app, FRI).assignee, shift(app, 'sh-1127-02').assignee], ['awaiting_manager', ME, TOMAS]);
  const rows = app.data.activity.length, approval = at('2026-11-21', '19:10');
  app.event(decided('ev-approve', approval, 'ho-0015', 'approve'));
  assert.deepEqual([handoff(app, 'ho-0015').state, shift(app, FRI).assignee, shift(app, 'sh-1127-02').assignee], ['approved', TOMAS, ME], 'one event exchanges both shifts');
  assert.deepEqual([shift(app, FRI).history.at(-1), shift(app, 'sh-1127-02').history.at(-1)], [
    { at: approval, by: 'handoff', handoff_id: 'ho-0015', event_id: 'ev-approve', change: { assignee: { from: ME, to: TOMAS } } },
    { at: approval, by: 'handoff', handoff_id: 'ho-0015', event_id: 'ev-approve', change: { assignee: { from: TOMAS, to: ME } } },
  ]);
  assert.deepEqual(actions(app, rows), ['event:handoff.decided:ho-0015', 'event:shift.reassigned:' + FRI, 'event:shift.reassigned:sh-1127-02', 'event:notification.created:ntf-0018']);
  assert.deepEqual([hours(app).scheduled_hours, mine(app).map(s => s.id), notifications(app)[0].body], [22, [MON, THU, 'sh-1127-02', SAT], 'Rosa approved trade ho-0015: both shifts changed hands.']);

  // The shift each person gives up is left out of their own check: these two overlap each other.
  assert.deepEqual(app.call('eligibility.check', { id: 'sh-1126-03' }).blocks, ['overlap', 'over_hours']);
  const overlapping = app.call('handoffs.trade', { id: THU, their_shift_id: 'sh-1126-03' }).handoff;
  assert.deepEqual([overlapping.state, overlapping.counterpart_id], ['awaiting_coworker', SAM]);
  app.call('handoffs.cancel', { id: overlapping.id });

  // Both people are checked: the coworker for my shift, then me for theirs.
  rejects(app, () => app.call('handoffs.trade', { id: THU, their_shift_id: 'sh-1126-01' }), 'not_qualified'); // Ada is not a cashier
  const mineFails = fixture();
  assert.deepEqual([mineFails.call('eligibility.check', { id: 'sh-1125-06', give_shift_id: FRI }).blocks, mineFails.call('eligibility.check', { id: 'sh-1125-06', give_shift_id: FRI }).other.blocks], [['not_qualified'], []]);
  assert.throws(() => mineFails.call('handoffs.trade', { id: FRI, their_shift_id: 'sh-1125-06' }), e => e.code === 'not_qualified' && /The account holder does not hold the position Shift lead/.test(e.message), 'Luz could take my close, but I am not a shift lead');
  const capped = fixture({ seed: seedWith(s => { s.people[0].max_weekly_hours = 20; }) });
  rejects(capped, () => capped.call('handoffs.trade', { id: FRI, their_shift_id: 'sh-1127-02' }), 'over_hours');
  assert.equal(capped.call('handoffs.trade', { id: THU, their_shift_id: 'sh-1126-03' }).handoff.state, 'awaiting_coworker', 'an even exchange adds no hours');
  // Rest is checked for the coworker too: Ines closes on Sunday at 21:00, nine hours before my Monday open.
  rejects(mineFails, () => mineFails.call('handoffs.trade', { id: MON, their_shift_id: 'sh-1124-04' }), 'short_rest');

  rejects(app, () => app.call('handoffs.trade', { id: THU, their_shift_id: WED_OPEN }), 'not_theirs');
  rejects(app, () => app.call('handoffs.trade', { id: THU, their_shift_id: MON }), 'not_theirs');
  rejects(app, () => app.call('handoffs.trade', { id: 'sh-1203-02', their_shift_id: 'sh-1202-02' }), 'not_theirs'); // a cancelled shift
  rejects(app, () => app.call('handoffs.trade', { id: FRI, their_shift_id: 'sh-1127-06' }), 'not_yours'); // Friday's close is Tomas's now
  rejects(app, () => app.call('handoffs.trade', { id: 'sh-1123-02', their_shift_id: 'sh-1124-03' }), 'not_yours');
  rejects(app, () => app.call('handoffs.trade', { id: THU, their_shift_id: 'sh-none' }), 'not_found');
});

test('T10 [W3] release: approval makes the shift open; denial leaves it mine', () => {
  const app = fixture(), told = app.data.notifications.length;
  const asked = app.call('handoffs.release', { id: FRI, message: 'I need Friday evening for a rehearsal.' }).handoff;
  assert.deepEqual([asked.id, asked.kind, asked.state, asked.counterpart_id, asked.other_shift, asked.cutoff_at, shift(app, FRI).assignee], ['ho-0015', 'release', 'awaiting_manager', null, null, at('2026-11-26', '16:00'), ME], 'a release goes straight to the manager, and the shift stays mine meanwhile');
  rejects(app, () => app.event(answered('ev-answer-release', LATER, 'ho-0015', 'accept')), 'invalid_event');
  app.event(decided('ev-approve', LATER, 'ho-0015', 'approve'));
  const open = shift(app, FRI);
  assert.deepEqual([handoff(app, 'ho-0015').state, open.state, open.assignee, open.assignee_name, open.is_mine, open.history.at(-1)], ['approved', 'open', null, null, false, { at: LATER, by: 'handoff', handoff_id: 'ho-0015', event_id: 'ev-approve', change: { assignee: { from: ME, to: null } } }]);
  assert.deepEqual([hours(app).scheduled_hours, hours(app).hours_left, app.call('shifts.list', { ...WEEK, open: true }).shifts.map(s => s.id).includes(FRI)], [16, 8, true]);
  assert.deepEqual(notifications(app).slice(0, app.data.notifications.length - told).map(n => [n.kind, n.title, n.body]), [['handoff.updated', 'Your release was approved', 'Rosa approved release ho-0015: the shift is now open and no longer yours.']], 'one notification, and no open-shift notice for a shift I gave up myself');

  // Denial: the fixture's pending release of the Friday close of 4 December.
  assert.deepEqual([handoff(app, 'ho-0012').state, handoff(app, 'ho-0012').kind], ['awaiting_manager', 'release']);
  app.event(decided('ev-deny', at('2026-11-21', '19:10'), 'ho-0012', 'deny', 'Nobody else can close that day.'));
  assert.deepEqual([handoff(app, 'ho-0012').state, shift(app, 'sh-1204-05').assignee, shift(app, 'sh-1204-05').history.length], ['denied', ME, 1]);
  rejects(app, () => app.call('handoffs.release', { id: 'sh-1123-02' }), 'not_yours');
  rejects(app, () => app.call('handoffs.release', { id: FRI }), 'not_yours');
  rejects(app, () => app.call('handoffs.release', { id: 'sh-none' }), 'not_found');
  // A release needs the manager even where covers, trades and pickups do not.
  const direct = fixture({ seed: seedWith(s => { s.workplace.policy.manager_approval = false; }) });
  assert.equal(direct.call('handoffs.release', { id: FRI }).handoff.state, 'awaiting_manager');
});

test('T11 [W3] a coworker\'s request: accept (checked for me), decline, withdrawal by the coworker; invalid_state when it is not waiting for me', () => {
  const app = fixture();
  // The fixture's request from Ada: opening on Sunday 29 November would take my week to 26 of 24 hours.
  const fromAda = handoff(app, 'ho-0014');
  assert.deepEqual([fromAda.state, fromAda.asked_by_me, fromAda.requester_id, fromAda.counterpart_id, fromAda.shift.id, fromAda.shift.assignee, fromAda.cutoff_at], ['awaiting_me', false, ADA, ME, 'sh-1129-01', ADA, at('2026-11-28', '06:00')]);
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-0014', answer: 'accept' }), 'over_hours');
  rejects(app, () => app.call('handoffs.cancel', { id: 'ho-0014' }), 'invalid_state');
  const told = app.data.notifications.length;
  const declined = app.call('handoffs.respond', { id: 'ho-0014', answer: 'decline', message: 'Sorry, I am at my hours that week.', request_id: 'req-decline' });
  assert.deepEqual([declined.id, declined.handoff.state, declined.handoff.history.at(-1), shift(app, 'sh-1129-01').assignee, app.data.notifications.length], ['ho-0014', 'declined', { at: app.now, actor: 'me', action: 'declined', state: 'declined', request_id: 'req-decline', note: 'Sorry, I am at my hours that week.' }, ADA, told]);
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-0014', answer: 'accept' }), 'invalid_state');

  // A cover I can take: Kai's four-hour Tuesday close brings my week to exactly 24.
  app.event(received('ev-kai', LATER, 'ho-0031', KAI, 'sh-1124-05', null, 'Could you close for me on Tuesday'));
  const fromKai = notifications(app)[0];
  assert.deepEqual([handoff(app, 'ho-0031').state, handoff(app, 'ho-0031').cutoff_at, fromKai.kind, fromKai.title, fromKai.body], ['awaiting_me', at('2026-11-23', '16:00'), 'handoff.received', 'Kai asks you to cover a shift',
    'Kai asks you to take the cashier shift on Tuesday 24 November, 16:00 to 20:00 at Finch Street. Message: Could you close for me on Tuesday. Answer in Pegboard before Monday 23 November 16:00.']);
  const accepted = app.call('handoffs.respond', { id: 'ho-0031', answer: 'accept', message: 'Happy to.' }).handoff;
  assert.deepEqual([accepted.state, accepted.history.at(-1).action, accepted.history.at(-1).note, shift(app, 'sh-1124-05').assignee, hours(app).scheduled_hours], ['awaiting_manager', 'accepted', 'Happy to.', KAI, 20], 'my acceptance moves nothing until the manager approves');
  app.event(decided('ev-kai-approve', at('2026-11-21', '19:10'), 'ho-0031', 'approve'));
  assert.deepEqual([handoff(app, 'ho-0031').state, shift(app, 'sh-1124-05').assignee, hours(app).scheduled_hours, flags(app), notifications(app)[0].body], ['approved', ME, 24, {}, 'Rosa approved cover ho-0031: the shift is now yours.']);

  // A coworker's trade: Luz's Monday afternoon for my Monday open; the approval exchanges both shifts in one step.
  app.event(received('ev-luz', at('2026-11-21', '19:20'), 'ho-0032', LUZ, 'sh-1123-04', MON, 'Could we swap Monday?'));
  assert.deepEqual([handoff(app, 'ho-0032').state, handoff(app, 'ho-0032').shift.id, handoff(app, 'ho-0032').other_shift.id, handoff(app, 'ho-0032').cutoff_at, notifications(app)[0].title], ['awaiting_me', 'sh-1123-04', MON, at('2026-11-22', '06:00'), 'Luz asks to trade shifts with you']);
  assert.equal(app.call('handoffs.respond', { id: 'ho-0032', answer: 'accept' }).handoff.state, 'awaiting_manager');
  assert.deepEqual([shift(app, MON).assignee, shift(app, 'sh-1123-04').assignee], [ME, LUZ]);
  app.event(decided('ev-luz-approve', at('2026-11-21', '19:30'), 'ho-0032', 'approve'));
  assert.deepEqual([shift(app, MON).assignee, shift(app, 'sh-1123-04').assignee, shift(app, MON).history.at(-1).event_id, shift(app, 'sh-1123-04').history.at(-1).event_id, hours(app).scheduled_hours], [LUZ, ME, 'ev-luz-approve', 'ev-luz-approve', 24]);

  // Withdrawal by the coworker.
  app.event(received('ev-pip', at('2026-11-21', '19:40'), 'ho-0033', PIP, 'sh-1128-01', null));
  app.event(ev('ev-pip-withdraw', at('2026-11-21', '19:50'), 'handoff.withdrawn', { handoff_id: 'ho-0033', message: 'Never mind, sorted it out.' }));
  assert.deepEqual([handoff(app, 'ho-0033').state, handoff(app, 'ho-0033').history.at(-1), notifications(app)[0].title, notifications(app)[0].body], ['cancelled', { at: at('2026-11-21', '19:50'), actor: 'coworker', action: 'withdrawn', state: 'cancelled', event_id: 'ev-pip-withdraw', person_id: PIP, note: 'Never mind, sorted it out.' }, 'Pip withdrew the cover request', 'Pip withdrew cover request ho-0033. Nothing changed hands. Message: Never mind, sorted it out.']);
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-0033', answer: 'accept' }), 'invalid_state');

  // Not waiting for me.
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-0013', answer: 'accept' }), 'invalid_state'); // my own request, waiting for Tomas
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-0012', answer: 'decline' }), 'invalid_state'); // waiting for the manager
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-0009', answer: 'accept' }), 'invalid_state'); // already declined
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-none', answer: 'accept' }), 'not_found');
  rejects(app, () => app.event(ev('ev-withdraw-mine', at('2026-11-21', '19:55'), 'handoff.withdrawn', { handoff_id: 'ho-0013' })), 'invalid_event');

  // Both people of a trade are checked when I accept: the trade of the proposal's example would
  // have Ines open on Monday nine hours after her Sunday close.
  const example = fixture();
  example.event(received('ev-ines', LATER, 'ho-0031', INES, 'sh-1124-04', MON, 'Could you take my Tuesday close if I take your Monday open?'));
  rejects(example, () => example.call('handoffs.respond', { id: 'ho-0031', answer: 'accept' }), 'short_rest');
  assert.equal(example.call('handoffs.respond', { id: 'ho-0031', answer: 'decline' }).handoff.state, 'declined');
  // Where the workplace does not ask for the manager, my acceptance completes it.
  const direct = fixture({ seed: seedWith(s => { s.workplace.policy.manager_approval = false; }) });
  direct.event(received('ev-kai', LATER, 'ho-0031', KAI, 'sh-1124-05', null));
  const rows = direct.data.activity.length;
  const done = direct.call('handoffs.respond', { id: 'ho-0031', answer: 'accept', request_id: 'req-accept' }).handoff;
  assert.deepEqual([done.state, done.shift.assignee, shift(direct, 'sh-1124-05').history.at(-1), direct.data.activity.slice(rows).map(a => [a.action, a.details])], ['approved', ME, { at: LATER, by: 'handoff', handoff_id: 'ho-0031', request_id: 'req-accept', change: { assignee: { from: KAI, to: ME } } }, [['handoffs.respond', { answer: 'accept', state: 'approved' }]]]);
});

test('T12 [W3] refusals on my own handoffs, and the first one in the documented order when two apply; nothing changes', () => {
  const app = fixture();
  // not_yours: a coworker's shift, an open one, a cancelled one.
  rejects(app, () => app.call('handoffs.cover', { id: 'sh-1123-02', to_person_id: JO }), 'not_yours');
  rejects(app, () => app.call('handoffs.release', { id: WED_OPEN }), 'not_yours');
  rejects(app, () => app.call('handoffs.cover', { id: 'sh-1202-02', to_person_id: JO }), 'not_yours');
  // already_requested: Saturday's close already has my pending request to Tomas; Ada's Sunday open has her request to me.
  rejects(app, () => app.call('handoffs.cover', { id: SAT, to_person_id: JO }), 'already_requested');
  rejects(app, () => app.call('handoffs.release', { id: SAT }), 'already_requested');
  rejects(app, () => app.call('handoffs.trade', { id: SAT, their_shift_id: 'sh-1128-02' }), 'already_requested');
  rejects(app, () => app.call('handoffs.trade', { id: MON, their_shift_id: 'sh-1129-01' }), 'already_requested');
  // The four eligibility rules, for the coworker who would take my shift.
  rejects(app, () => app.call('handoffs.cover', { id: MON, to_person_id: KAI }), 'not_qualified');   // Kai is not a barista
  rejects(app, () => app.call('handoffs.cover', { id: MON, to_person_id: TOMAS }), 'overlap');       // Tomas works 08:00 to 14:00 at the kiosk
  rejects(app, () => app.call('handoffs.cover', { id: MON, to_person_id: INES }), 'short_rest');     // Ines closes at 21:00 the evening before
  const capped = fixture({ seed: seedWith(s => { s.people.find(p => p.id === KAI).max_weekly_hours = 16; }) });
  rejects(capped, () => capped.call('handoffs.cover', { id: THU, to_person_id: KAI }), 'over_hours'); // 14 + 6 hours against a cap of 16
  assert.equal(app.call('handoffs.cover', { id: THU, to_person_id: KAI }).handoff.state, 'awaiting_coworker', 'with his own cap of 20 the same request is allowed');
  assert.throws(() => app.call('handoffs.cover', { id: MON, to_person_id: INES }), e => e.code === 'short_rest' && /Ines Okafor would have 9 hours of rest next to this shift; the workplace minimum is 10/.test(e.message));

  // too_late: 20 hours before the start under a 24-hour cut-off, and after the start.
  const late = fixture();
  late.advance(at('2026-11-25', '07:59:59'));
  assert.equal(late.call('eligibility.check', { id: THU, person_id: TOMAS }).cutoff_passed, false);
  late.advance(at('2026-11-25', '08:00'));
  rejects(late, () => late.call('handoffs.cover', { id: THU, to_person_id: TOMAS }), 'too_late');
  late.advance(at('2026-11-25', '12:00'));
  for (const call of [['handoffs.cover', { id: THU, to_person_id: TOMAS }], ['handoffs.release', { id: THU }], ['handoffs.trade', { id: THU, their_shift_id: 'sh-1126-03' }], ['handoffs.trade', { id: FRI, their_shift_id: 'sh-1126-03' }]]) rejects(late, () => late.call(...call), 'too_late');
  assert.equal(late.call('handoffs.cover', { id: FRI, to_person_id: TOMAS }).handoff.state, 'awaiting_coworker', 'Friday\'s close is still more than 24 hours away');
  late.advance(at('2026-11-26', '09:00'));
  assert.throws(() => late.call('handoffs.release', { id: THU }), e => e.code === 'too_late' && /has started/.test(e.message));

  // The first refusal in the order: the shift is mine / theirs / open, then time, then a pending handoff, then the four rules.
  rejects(late, () => late.call('handoffs.cover', { id: 'sh-1126-03', to_person_id: JO }), 'not_yours');                 // not mine, and past its cut-off
  rejects(late, () => late.call('handoffs.trade', { id: 'sh-1126-03', their_shift_id: WED_OPEN }), 'not_yours');           // not mine, and the other is not theirs
  rejects(late, () => late.call('handoffs.trade', { id: THU, their_shift_id: MON }), 'not_theirs');                       // not theirs, and too late
  const order = fixture();
  order.advance(at('2026-11-25', '12:00'));
  rejects(order, () => order.call('handoffs.trade', { id: THU, their_shift_id: 'sh-1129-01' }), 'too_late');               // too late, pending on the other shift, and Ada is not a cashier
  rejects(app, () => app.call('handoffs.cover', { id: SAT, to_person_id: ADA }), 'already_requested');                     // pending, and Ada is not a cashier
  assert.deepEqual(app.call('eligibility.check', { id: MON, person_id: KAI }).blocks, ['not_qualified', 'overlap']);
  rejects(app, () => app.call('handoffs.cover', { id: MON, to_person_id: KAI }), 'not_qualified');
  // The manager gives Ines Monday's 07:00 cashier shift; she is then both double-booked and short of rest for my open.
  app.event(changed('ev-ines-monday', LATER, 'sh-1123-03', { assignee: INES }));
  assert.deepEqual(app.call('eligibility.check', { id: MON, person_id: INES }).blocks, ['overlap', 'short_rest', 'over_hours'], 'and 36 + 6 hours would pass the workplace cap of 40');
  rejects(app, () => app.call('handoffs.cover', { id: MON, to_person_id: INES }), 'overlap');
  const both = fixture({ seed: seedWith(s => { s.people.find(p => p.id === INES).max_weekly_hours = 32; }) });
  assert.deepEqual(both.call('eligibility.check', { id: MON, person_id: INES }).blocks, ['short_rest', 'over_hours']);
  rejects(both, () => both.call('handoffs.cover', { id: MON, to_person_id: INES }), 'short_rest');
});

test('T13 [W4] pickup with and without manager approval; not_open; my own duplicate; withdrawal', () => {
  const app = fixture();
  assert.deepEqual(app.call('shifts.list', { ...WEEK, open: true, position_id: 'pos-cashier' }).shifts.map(s => [s.id, s.hours]), [[WED_OPEN, 6]]);
  rejects(app, () => app.call('handoffs.pickup', { id: WED_OPEN }), 'over_hours');              // 20 + 6 hours against my cap of 24
  rejects(app, () => app.call('handoffs.pickup', { id: 'sh-1123-06' }), 'not_qualified');       // a shift-lead shift
  rejects(app, () => app.call('handoffs.pickup', { id: 'sh-1201-02' }), 'overlap');             // overlaps my Tuesday shift; it would also pass the cap
  rejects(app, () => app.call('handoffs.pickup', { id: 'sh-1123-02' }), 'not_open');            // Tomas's
  rejects(app, () => app.call('handoffs.pickup', { id: MON }), 'not_open');                     // my own
  rejects(app, () => app.call('handoffs.pickup', { id: 'sh-1202-02' }), 'not_open');            // cancelled
  rejects(app, () => app.call('handoffs.pickup', { id: 'sh-none' }), 'not_found');

  // After my Friday shift has been released and approved there is room for the Wednesday shift.
  const release = app.call('handoffs.release', { id: FRI }).id;
  assert.equal(app.call('eligibility.check', { id: WED_OPEN }).eligible, false, 'a pending release frees no hours');
  app.event(decided('ev-release', LATER, release, 'approve'));
  const check = app.call('eligibility.check', { id: WED_OPEN });
  assert.deepEqual([check.eligible, check.blocks, check.hours], [true, [], { week_start: '2026-11-23', before: 16, after: 22, cap: 24 }]);
  // Withdrawal while pending leaves the shift open; so does a denial.
  const first = app.call('handoffs.pickup', { id: WED_OPEN });
  assert.deepEqual([first.id, first.handoff.kind, first.handoff.state, first.handoff.requester_id, first.handoff.counterpart_id, first.handoff.cutoff_at, shift(app, WED_OPEN).state, shift(app, WED_OPEN).pending_handoff_id], ['ho-0016', 'pickup', 'awaiting_manager', ME, null, at('2026-11-24', '08:00'), 'open', 'ho-0016']);
  rejects(app, () => app.call('handoffs.pickup', { id: WED_OPEN }), 'already_requested');
  assert.deepEqual([app.call('handoffs.cancel', { id: first.id }).handoff.state, shift(app, WED_OPEN).state, shift(app, WED_OPEN).pending_handoff_id], ['cancelled', 'open', null]);
  rejects(app, () => app.event(decided('ev-decide-cancelled', at('2026-11-21', '19:10'), first.id, 'approve')), 'invalid_event');
  const second = app.call('handoffs.pickup', { id: WED_OPEN }).id;
  app.event(decided('ev-deny', at('2026-11-21', '19:20'), second, 'deny', 'Jo asked first.'));
  assert.deepEqual([handoff(app, second).state, shift(app, WED_OPEN).state, shift(app, WED_OPEN).history.length, hours(app).scheduled_hours], ['denied', 'open', 1, 16]);

  // Pending the manager's decision, then mine.
  const rows = app.data.activity.length;
  const asked = app.call('handoffs.pickup', { id: WED_OPEN, message: 'I can take Wednesday at the kiosk.', request_id: 'req-pickup' });
  assert.deepEqual([asked.id, asked.handoff.state, asked.handoff.message, shift(app, WED_OPEN).assignee], ['ho-0018', 'awaiting_manager', 'I can take Wednesday at the kiosk.', null]);
  const approval = at('2026-11-21', '19:30');
  app.event(decided('ev-pickup', approval, 'ho-0018', 'approve'));
  const taken = shift(app, WED_OPEN);
  assert.deepEqual([handoff(app, 'ho-0018').state, taken.state, taken.assignee, taken.is_mine, taken.history.at(-1), hours(app).scheduled_hours, mine(app).map(s => s.id)], ['approved', 'assigned', ME, true, { at: approval, by: 'handoff', handoff_id: 'ho-0018', event_id: 'ev-pickup', change: { assignee: { from: null, to: ME } } }, 22, [MON, WED_OPEN, THU, SAT]]);
  assert.deepEqual([actions(app, rows), notifications(app)[0].body], [['agent:handoffs.pickup:ho-0018', 'event:handoff.decided:ho-0018', 'event:shift.reassigned:' + WED_OPEN, 'event:notification.created:ntf-0019'], 'Rosa approved pickup ho-0018: the shift is yours.']);
  rejects(app, () => app.call('handoffs.pickup', { id: WED_OPEN }), 'not_open');
  rejects(app, () => app.call('handoffs.pickup', { id: FRI }), 'over_hours');                   // my released Friday close is open, but 22 + 4 hours is too many now

  // Where the workplace does not ask for the manager, a pickup is approved at once.
  const direct = fixture({ seed: seedWith(s => { s.workplace.policy.manager_approval = false; s.people[0].max_weekly_hours = null; }) }), before = direct.data.activity.length, told = direct.data.notifications.length;
  const done = direct.call('handoffs.pickup', { id: WED_OPEN, request_id: 'req-direct' });
  assert.deepEqual([done.handoff.state, done.handoff.shift.assignee, shift(direct, WED_OPEN).history.at(-1), hours(direct).scheduled_hours], ['approved', ME, { at: direct.now, by: 'handoff', handoff_id: done.id, request_id: 'req-direct', change: { assignee: { from: null, to: ME } } }, 26]);
  assert.deepEqual([direct.data.activity.slice(before).map(a => [a.actor, a.action, a.object_id, a.request_id, a.details]), direct.data.notifications.length], [[['agent', 'handoffs.pickup', done.id, 'req-direct', { shift_id: WED_OPEN, state: 'approved' }]], told], 'one row for my write and no notification');
  rejects(direct, () => direct.call('handoffs.cancel', { id: done.id }), 'invalid_state');
});

test('T14 [W3, W4] void and expiry: a manager\'s change, reassignment or cancellation voids pending handoffs; a pending handoff expires at its cut-off', () => {
  const app = fixture();
  const cover = app.call('handoffs.cover', { id: THU, to_person_id: TOMAS }).id;                    // ho-0015
  const trade = app.call('handoffs.trade', { id: FRI, their_shift_id: 'sh-1127-02' }).id;           // ho-0016
  const roomy = fixture({ seed: seedWith(s => { s.people[0].max_weekly_hours = null; }) });
  const pickup = roomy.call('handoffs.pickup', { id: WED_OPEN }).id;

  // A change of times voids the cover that names the shift, whatever the change.
  const rows = app.data.activity.length;
  app.event(changed('ev-thu-later', LATER, THU, { start: at('2026-11-26', '09:00'), end: at('2026-11-26', '15:00') }));
  assert.deepEqual([handoff(app, cover).state, handoff(app, cover).history.at(-1), shift(app, THU).assignee, shift(app, THU).pending_handoff_id], ['void', { at: LATER, actor: 'manager', action: 'voided', state: 'void', event_id: 'ev-thu-later', person_id: ROSA, note: 'Shift ' + THU + ' was changed by the manager.' }, ME, null]);
  assert.deepEqual(actions(app, rows), ['event:shift.changed:' + THU, 'event:notification.created:ntf-0017', 'event:handoff.voided:' + cover, 'event:notification.created:ntf-0018']);
  assert.deepEqual(notifications(app).slice(0, 2).map(n => [n.kind, n.object.id, n.title]), [['handoff.updated', cover, 'Your cover request is void'], ['shift.changed', THU, 'Your Thursday shift at Quay kiosk now starts at 09:00']]);
  assert.equal(notifications(app)[0].body, 'Rosa changed the cashier shift on Thursday 26 November, 09:00 to 15:00 at Quay kiosk, so the pending cover request ' + cover + ' no longer applies. Nothing changed hands.');
  rejects(app, () => app.event(answered('ev-answer-void', at('2026-11-21', '19:10'), cover, 'accept')), 'invalid_event');
  rejects(app, () => app.call('handoffs.cancel', { id: cover }), 'invalid_state');
  assert.equal(app.call('handoffs.cover', { id: THU, to_person_id: TOMAS }).handoff.cutoff_at, at('2026-11-25', '09:00'), 'a new request follows the changed shift');

  // A cancellation of the coworker's shift voids the trade; my own shift stays mine.
  app.event(cancelled('ev-cancel-theirs', at('2026-11-21', '19:20'), 'sh-1127-02'));
  assert.deepEqual([handoff(app, trade).state, shift(app, FRI).assignee, shift(app, FRI).pending_handoff_id, notifications(app)[0].body], ['void', ME, null, 'Rosa cancelled the cashier shift on Friday 27 November, 08:00 to 14:00 at Quay kiosk, so the pending trade request ' + trade + ' no longer applies. Nothing changed hands.']);
  // The manager gives the open shift to someone else while my pickup is pending.
  roomy.event(changed('ev-give-away', LATER, WED_OPEN, { assignee: JO }));
  assert.deepEqual([handoff(roomy, pickup).state, shift(roomy, WED_OPEN).assignee, notifications(roomy).map(n => n.kind).slice(0, 1)], ['void', JO, ['handoff.updated']]);
  rejects(roomy, () => roomy.event(decided('ev-decide-void', at('2026-11-21', '19:10'), pickup, 'approve')), 'invalid_event');
  // A coworker's request to me is voided the same way.
  app.event(changed('ev-ada-sunday', at('2026-11-21', '19:30'), 'sh-1129-01', { position_id: 'pos-cashier' }));
  assert.deepEqual([handoff(app, 'ho-0014').state, notifications(app)[0].title], ['void', 'Ada\'s cover request is void']);
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-0014', answer: 'accept' }), 'invalid_state');
  // Closed and expired handoffs are left as they are.
  const closed = app.data.handoffs.filter(h => ['ho-0005', 'ho-0011'].includes(h.id));
  app.event(changed('ev-old-shift', at('2026-11-21', '19:40'), 'sh-1205-05', { location_id: 'loc-quay' }));
  assert.deepEqual([app.data.handoffs.filter(h => ['ho-0005', 'ho-0011'].includes(h.id)), handoff(app, 'ho-0010').state], [closed, 'void']);

  // Expiry: the clock reaches the cut-off and no App code runs.
  const late = fixture(), listed = args => late.call('handoffs.list', args).handoffs.map(h => h.id + ' ' + h.state);
  assert.deepEqual([listed(), listed({ state: 'expired' })], [['ho-0014 awaiting_me', 'ho-0013 awaiting_coworker', 'ho-0012 awaiting_manager'], ['ho-0007 expired', 'ho-0005 expired', 'ho-0002 expired']], 'handoffs nobody answered or decided before their cut-off read expired');
  const stored = late.data;
  late.advance(at('2026-11-27', '15:59:59'));
  assert.equal(handoff(late, 'ho-0013').state, 'awaiting_coworker');
  late.advance(at('2026-11-27', '16:00'));
  assert.deepEqual([handoff(late, 'ho-0013').state, shift(late, SAT).pending_handoff_id, shift(late, SAT).assignee], ['expired', null, ME], 'the shift is still mine');
  rejects(late, () => late.event(answered('ev-too-late', at('2026-11-27', '16:30'), 'ho-0013', 'accept')), 'invalid_event');
  rejects(late, () => late.call('handoffs.cancel', { id: 'ho-0013' }), 'invalid_state');
  rejects(late, () => late.call('handoffs.cover', { id: SAT, to_person_id: JO }), 'too_late');
  late.advance(at('2026-11-28', '06:00'));
  assert.equal(handoff(late, 'ho-0014').state, 'expired');
  rejects(late, () => late.call('handoffs.respond', { id: 'ho-0014', answer: 'decline' }), 'invalid_state');
  rejects(late, () => late.event(ev('ev-withdraw-late', at('2026-11-28', '07:00'), 'handoff.withdrawn', { handoff_id: 'ho-0014' })), 'invalid_event');
  late.advance(at('2026-12-03', '16:00'));
  assert.equal(handoff(late, 'ho-0012').state, 'expired');
  rejects(late, () => late.event(decided('ev-decide-late', at('2026-12-03', '17:00'), 'ho-0012', 'approve')), 'invalid_event');
  assert.deepEqual([late.data, listed(), listed({ include_closed: true }).length], [stored, [], 14], 'no record changed: expiry is read from the cut-off and the clock');
  // A manager's change does not void an expired handoff.
  late.event(changed('ev-after-expiry', at('2026-12-03', '17:00'), 'sh-1204-05', { start: at('2026-12-04', '17:00') }));
  assert.deepEqual([late.data.handoffs.find(h => h.id === 'ho-0012').state, handoff(late, 'ho-0012').state], ['awaiting_manager', 'expired']);

  // Filters of handoffs.list.
  const all = fixture();
  assert.deepEqual([all.call('handoffs.list', { kind: 'trade', include_closed: true }).handoffs.map(h => h.id), all.call('handoffs.list', { id: 'sh-1122-05', include_closed: true }).handoffs.map(h => h.id), all.call('handoffs.list', { state: 'void' }).handoffs.map(h => h.id)], [['ho-0010', 'ho-0009', 'ho-0002'], ['ho-0009'], ['ho-0010']]);
  const page = all.call('handoffs.list', { include_closed: true, limit: 5 });
  assert.deepEqual([page.handoffs.map(h => h.id), page.next_cursor, all.call('handoffs.list', { include_closed: true, limit: 5, cursor: '10' }).next_cursor], [['ho-0014', 'ho-0013', 'ho-0012', 'ho-0011', 'ho-0010'], '5', null]);
  rejects(all, () => all.call('handoffs.list', { id: 'sh-none' }), 'not_found');
  rejects(all, () => all.call('handoffs.get', { id: 'ho-none' }), 'not_found');
});

test('T15 [all] invalid events leave state unchanged', () => {
  const app = fixture();
  const bad = (name, payload, when = LATER) => rejects(app, () => app.event(ev('ev-bad', when, name, payload)), 'invalid_event');
  const week = (shifts, week_start = '2026-12-07') => ({ week_start, shifts });
  const day = (id, extra = {}) => ({ ...slot(id, '2026-12-08', '08:00', '14:00', TOMAS), ...extra });

  // schedule.published
  bad('schedule.published', week([day(MON)]));                                                   // a shift ID that exists
  bad('schedule.published', week([day('ho-0001')]));                                             // an ID another record uses
  bad('schedule.published', week([day('sh-new-1'), day('sh-new-1')]));                           // twice in one event
  bad('schedule.published', week([day('sh-new-1', { location_id: 'loc-none' })]));
  bad('schedule.published', week([day('sh-new-1', { position_id: 'pos-none' })]));
  bad('schedule.published', week([day('sh-new-1', { assignee: 'person-nobody' })]));
  bad('schedule.published', week([day('sh-new-1', { end: at('2026-12-08', '08:00') })]));        // does not end after it starts
  bad('schedule.published', week([day('sh-new-1', { end: at('2026-12-09', '01:00') })]));        // 17 hours
  bad('schedule.published', week([{ ...slot('sh-new-1', '2026-12-14', '08:00', '14:00', TOMAS) }]));   // starts in another week
  bad('schedule.published', week([day('sh-new-1')], '2026-12-08'));                              // a week starts on a Monday here
  bad('schedule.published', { ...week([day('sh-new-1')]), posted_by: 'person-nobody' });
  assert.equal(app.event(posted('ev-sixteen', LATER, '2026-12-07', [day('sh-new-16', { end: at('2026-12-09', '00:00') })])).shifts.at(-1).id, 'sh-new-16', 'sixteen hours is the longest shift');

  // shift.changed
  const change = (shift_id, fields, extra = {}) => bad('shift.changed', { shift_id, change: fields, changed_by: ROSA, ...extra });
  change('sh-none', { assignee: null });
  change('sh-1202-02', { assignee: JO });                                                        // cancelled
  change('sh-1116-01', { assignee: JO });                                                        // ended
  change(MON, {});                                                                               // names no field
  change(MON, { start: at('2026-11-23', '06:00'), assignee: ME });                               // leaves the shift as it is
  change(MON, { position_id: 'pos-none' });
  change(MON, { location_id: 'loc-none' });
  change(MON, { assignee: 'person-nobody' });
  change(MON, { assignee: null }, { changed_by: 'person-nobody' });
  change(MON, { end: at('2026-11-23', '23:00') });                                               // 17 hours
  change(MON, { start: at('2026-11-23', '13:00') });                                             // would start after it ends
  change(MON, { start: at('2026-12-15', '06:00'), end: at('2026-12-15', '12:00') });             // into a week that was never posted

  // shift.cancelled
  bad('shift.cancelled', { shift_id: 'sh-none', changed_by: ROSA });
  bad('shift.cancelled', { shift_id: 'sh-1202-02', changed_by: ROSA });                          // already cancelled
  bad('shift.cancelled', { shift_id: 'sh-1116-01', changed_by: ROSA });                          // ended
  bad('shift.cancelled', { shift_id: MON, changed_by: 'person-nobody' });

  // handoff.received
  const request = (fields) => bad('handoff.received', { handoff_id: 'ho-0031', kind: 'cover', from_person_id: KAI, their_shift_id: 'sh-1124-05', ...fields });
  request({ handoff_id: 'ho-0001' });                                                            // a handoff ID that exists
  request({ handoff_id: MON });                                                                  // an ID another record uses
  request({ from_person_id: 'person-nobody' });
  request({ from_person_id: ME, their_shift_id: MON });                                          // from the account holder
  request({ kind: 'trade' });                                                                    // a trade names my shift
  request({ your_shift_id: MON });                                                               // a cover does not
  request({ their_shift_id: 'sh-none' });
  request({ their_shift_id: 'sh-1124-03' });                                                     // Tomas's shift, not Kai's
  request({ their_shift_id: WED_OPEN });                                                         // an open shift is nobody's
  request({ kind: 'trade', your_shift_id: 'sh-1124-03' });                                       // not mine
  request({ kind: 'trade', your_shift_id: 'sh-none' });
  request({ from_person_id: PIP, their_shift_id: 'sh-1122-01' });                                // its cut-off has passed
  request({ from_person_id: ADA, their_shift_id: 'sh-1120-01' });                                // it has ended
  request({ from_person_id: ADA, their_shift_id: 'sh-1129-01' });                                // already in a pending handoff
  request({ kind: 'trade', your_shift_id: SAT });                                                // my shift is already in a pending handoff

  // Answers, decisions and withdrawals in the wrong state.
  for (const id of ['ho-none', 'ho-0012', 'ho-0001', 'ho-0014', 'ho-0002']) bad('handoff.answered', { handoff_id: id, answer: 'accept' });        // unknown, waiting for the manager, approved, waiting for me, expired
  for (const id of ['ho-none', 'ho-0013', 'ho-0014', 'ho-0005', 'ho-0003']) bad('handoff.decided', { handoff_id: id, decision: 'approve', decided_by: ROSA }); // unknown, waiting for a coworker, waiting for me, expired, denied
  bad('handoff.decided', { handoff_id: 'ho-0012', decision: 'approve', decided_by: 'person-nobody' });
  for (const id of ['ho-none', 'ho-0013', 'ho-0009']) bad('handoff.withdrawn', { handoff_id: id });                                               // unknown, asked by me, closed
  for (const id of ['to-none', 'to-0002', 'to-0001', 'to-0004']) bad('time_off.decided', { time_off_id: id, decision: 'approve', decided_by: ROSA }); // unknown, approved, expired, denied
  bad('time_off.decided', { time_off_id: 'to-0005', decision: 'approve', decided_by: 'person-nobody' });

  // An operation Pegboard does not declare, and an event dated before the clock.
  assert.throws(() => plugin.applyEvent({ ...app.ctx, virtual_now: LATER }, app.data, ev('ev-clock', LATER, 'clock.advanced', {})), { code: 'invalid_event' });
  assert.throws(() => app.event(ev('ev-clock', LATER, 'clock.advanced', {})), { code: 'invalid_arguments' }, 'the events schema has no clock event');
  assert.throws(() => app.event({ event_id: 'ev-loose', at: '2026-11-21T19:00:00', operation: 'pegboard.shift.cancelled', payload: { shift_id: MON, changed_by: ROSA } }), { code: 'invalid_arguments' }, 'an event time needs its UTC offset');
  rejects(app, () => app.event(cancelled('ev-early', at('2026-11-21', '17:59'), MON)), 'invalid_event');
  assert.equal(app.now, LATER, 'rejected events do not move the clock');
  // The eight examples of the proposal are valid events.
  const examples = require('./proposal-events.json'), valid = require('./schema-validator.cjs').compile(require('../schemas/events.schema.json'), path.join(__dirname, '../schemas'));
  assert.deepEqual([examples.length, examples.every(valid), examples.map(e => e.operation)], [8, true, require('../app.json').event_types]);
});

test('T16 [all] notifications: one for each event that concerns me, none for my own writes; quiet hours and the 12-hour rule; open shifts; the wire message', () => {
  const app = fixture(), count = () => app.data.notifications.length, newest = () => notifications(app)[0];
  let n = count(), minute = 0;
  const when = () => at('2026-11-21', '19:' + String(++minute).padStart(2, '0'));
  const adds = (expected, event, message) => { app.event(event); assert.equal(count(), n += expected, message || event.event_id); return newest(); };

  // My own writes notify nobody.
  const cover = app.call('handoffs.cover', { id: THU, to_person_id: TOMAS }).id, release = app.call('handoffs.release', { id: FRI }).id;
  const off = app.call('time_off.request', { start: '2026-12-12', end: '2026-12-13' }).id;
  app.call('availability.update', { blocks: [] });
  app.call('preferences.update', { patch: { quiet_hours: { end: '07:00' } } });
  assert.equal(count(), n);
  // Events about other people's shifts do not concern me.
  adds(0, changed('ev-n1', when(), 'sh-1124-03', { start: at('2026-11-24', '08:00') }), 'a coworker\'s shift moved');
  adds(0, cancelled('ev-n2', when(), 'sh-1124-01'), 'a coworker\'s shift cancelled');
  adds(0, changed('ev-n3', when(), 'sh-1124-04', { assignee: PIP }), 'a coworker\'s shift given to another coworker');
  adds(0, changed('ev-n4', when(), 'sh-1123-06', { end: at('2026-11-23', '22:00') }), 'an open shift moved');

  // One for each event that concerns me.
  const a1 = adds(1, answered('ev-a1', when(), cover, 'accept'));
  const a2 = adds(1, decided('ev-a2', when(), cover, 'approve'));
  const a3 = adds(1, decided('ev-a3', when(), release, 'deny'));
  const a4 = adds(1, timeOffDecided('ev-a4', when(), off, 'approve'));
  const a5 = adds(1, received('ev-a5', when(), 'ho-0031', KAI, 'sh-1124-05', null));
  const a6 = adds(1, ev('ev-a6', when(), 'handoff.withdrawn', { handoff_id: 'ho-0031' }));
  assert.deepEqual([a1, a2, a3, a4, a5, a6].map(x => [x.kind, x.object.type, x.object.id, x.state]), [['handoff.updated', 'handoff', cover, 'released'], ['handoff.updated', 'handoff', cover, 'released'], ['handoff.updated', 'handoff', release, 'released'], ['time_off.decided', 'time_off', off, 'released'], ['handoff.received', 'handoff', 'ho-0031', 'released'], ['handoff.updated', 'handoff', 'ho-0031', 'released']]);
  assert.deepEqual([a2.shift_ids, a4.shift_ids, a4.change], [[THU], [], null]);
  // A manager's change that touches a shift of mine before or after it: changed, assigned, unassigned, cancelled.
  // (The first one also voids my pending request to Tomas for that shift, which is a second notification.)
  const c1 = adds(2, changed('ev-c1', when(), SAT, { location_id: 'loc-quay' }, 'Kiosk needs a second cashier'));
  const c2 = adds(1, changed('ev-c2', when(), 'sh-1125-05', { assignee: ME }));
  const c3 = adds(1, changed('ev-c3', when(), 'sh-1125-05', { assignee: KAI }, 'Kai is back'));
  const c4 = adds(1, cancelled('ev-c4', when(), MON));
  assert.deepEqual([notifications(app)[4], c2, c3, c4].map(x => [x.kind, x.change, x.object.id, x.title]), [
    ['shift.changed', 'changed', SAT, 'Your Saturday shift at Finch Street has changed'], ['shift.changed', 'assigned', 'sh-1125-05', 'New shift on Wednesday 25 November'],
    ['shift.changed', 'unassigned', 'sh-1125-05', 'You are off the shift on Wednesday 25 November'], ['shift.changed', 'cancelled', MON, 'Your shift on Monday 23 November is cancelled'],
  ]);
  assert.deepEqual([c1.kind, c1.object.id, c1.title, notifications(app)[4].body, c2.body, c3.body, c4.body], ['handoff.updated', 'ho-0013', 'Your cover request is void',
    'Rosa changed your cashier shift on Saturday 28 November at Finch Street: it is now at Quay kiosk (was Finch Street). Reason given: Kiosk needs a second cashier. Open Pegboard to see your week and your options.',
    'Rosa assigned you the cashier shift on Wednesday 25 November, 16:00 to 20:00 at Finch Street. Open Pegboard to see your week and your options.',
    'Rosa took you off the cashier shift on Wednesday 25 November, 16:00 to 20:00 at Finch Street. Reason given: Kai is back. Open Pegboard to see your week and your options.',
    'Rosa cancelled the barista shift on Monday 23 November, 06:00 to 12:00 at Finch Street. It no longer counts in your hours.']);

  // Postings. The first posting of a week: one notification if a shift is mine, none for its open shifts.
  const dec = (id, date, assignee, position_id) => slot(id, date, '16:00', '20:00', assignee, position_id);
  const p1 = adds(1, posted('ev-p1', when(), '2026-12-07', [dec('sh-1207-05', '2026-12-07', ME), dec('sh-1208-05', '2026-12-08', null), dec('sh-1209-05', '2026-12-09', KAI), dec('sh-1211-05', '2026-12-11', ME)]));
  assert.deepEqual([p1.kind, p1.object, p1.shift_ids, p1.title, p1.body], ['schedule.published', { type: 'week', id: '2026-12-07' }, ['sh-1207-05', 'sh-1211-05'], 'Schedule posted for the week of Monday 7 December',
    'The schedule is posted for the week of Monday 7 December. You have 2 new shifts: Monday 7 December 16:00 to 20:00; Friday 11 December 16:00 to 20:00. Open Pegboard to see your week.']);
  adds(0, posted('ev-p2', when(), '2026-12-14', [dec('sh-1214-05', '2026-12-14', KAI), dec('sh-1215-05', '2026-12-15', null)]), 'a first posting with no shift of mine');
  // Shifts added to a posted week: open_shift.posted for each open shift for a position I hold.
  const p3 = adds(1, posted('ev-p3', when(), '2026-12-14', [dec('sh-1216-05', '2026-12-16', null), dec('sh-1216-06', '2026-12-16', null, 'pos-lead'), dec('sh-1217-05', '2026-12-17', SAM)]), 'one open cashier shift; the shift-lead one is not for me');
  assert.deepEqual([p3.kind, p3.object, p3.title, p3.body], ['open_shift.posted', { type: 'shift', id: 'sh-1216-05' }, 'Open shift: Wednesday 16 December, 16:00 to 20:00', 'An open shift is available: the cashier shift on Wednesday 16 December, 16:00 to 20:00 at Finch Street (4 hours). Open Pegboard to check whether you can pick it up.']);
  const p4 = adds(2, posted('ev-p4', when(), '2026-12-07', [dec('sh-1212-05', '2026-12-12', ME), dec('sh-1213-05', '2026-12-13', null, 'pos-barista')]), 'a shift of mine and an open one added to a posted week');
  assert.deepEqual([notifications(app)[1].kind, notifications(app)[1].title, p4.kind, p4.object.id], ['schedule.published', 'Shifts added to the week of Monday 7 December', 'open_shift.posted', 'sh-1213-05']);
  // A coworker's shift that loses its assignee becomes an open shift.
  const o1 = adds(1, changed('ev-o1', when(), 'sh-1126-03', { assignee: null }, 'Sam is unwell'));
  assert.deepEqual([o1.kind, o1.object.id], ['open_shift.posted', 'sh-1126-03']);
  adds(0, changed('ev-o2', when(), 'sh-1126-06', { assignee: null }), 'a shift-lead shift is not for me');
  app.call('preferences.update', { patch: { open_shift_notices: false } });
  adds(0, changed('ev-o3', when(), 'sh-1127-03', { assignee: null }), 'open-shift notices are off');
  adds(0, posted('ev-o4', when(), '2026-12-14', [dec('sh-1218-05', '2026-12-18', null)]), 'open-shift notices are off');
  adds(1, changed('ev-o5', when(), 'sh-1128-05', { end: at('2026-11-28', '21:00') }), 'the preference covers open shifts only');
  assert.deepEqual(app.data.activity.filter(a => a.action === 'notification.created').length, count(), 'one activity row for each notification written');

  // Quiet hours (22:00 to 07:00 in the account's time zone) and the 12-hour rule.
  const quiet = fixture(), tell = (id, time, shiftId = THU) => { quiet.event(changed(id, time, shiftId, { location_id: quiet.data.shifts.find(s => s.id === shiftId).location_id === 'loc-quay' ? 'loc-finch' : 'loc-quay' })); return notifications(quiet)[0]; };
  const row = x => [x.state, x.created_at, x.release_at];
  assert.deepEqual(row(tell('q1', at('2026-11-21', '21:59:59'))), ['released', at('2026-11-21', '21:59:59'), at('2026-11-21', '21:59:59')]);
  assert.deepEqual(row(tell('q2', at('2026-11-21', '22:00'))), ['held', at('2026-11-21', '22:00'), at('2026-11-22', '07:00')], 'held to the end of that quiet period');
  assert.deepEqual(row(tell('q3', at('2026-11-22', '06:59:59'))), ['held', at('2026-11-22', '06:59:59'), at('2026-11-22', '07:00')]);
  assert.deepEqual(row(tell('q4', at('2026-11-22', '07:00'))), ['released', at('2026-11-22', '07:00'), at('2026-11-22', '07:00')]);
  assert.deepEqual(notifications(quiet).slice(0, 4).map(x => x.state), ['released', 'released', 'released', 'released'], 'held notifications read released once the clock has reached their release time');
  assert.deepEqual(row(tell('q5', at('2026-11-22', '22:30'), MON)), ['released', at('2026-11-22', '22:30'), at('2026-11-22', '22:30')], 'about a shift that starts in 7.5 hours: never held');
  assert.deepEqual(row(tell('q6', at('2026-11-22', '22:31'))), ['held', at('2026-11-22', '22:31'), at('2026-11-23', '07:00')], 'about Thursday\'s shift: held');
  assert.deepEqual(row(tell('q7', at('2026-11-27', '04:00'), FRI)), ['held', at('2026-11-27', '04:00'), at('2026-11-27', '07:00')], 'exactly 12 hours before the start is not less than 12 hours');
  assert.deepEqual(row(tell('q8', at('2026-11-27', '04:00:01'), FRI)), ['released', at('2026-11-27', '04:00:01'), at('2026-11-27', '04:00:01')]);
  assert.deepEqual([quiet.call('notifications.list', { state: 'held' }).notifications.map(x => x.created_at), quiet.data.notifications.filter(x => x.release_at !== x.created_at).length], [[at('2026-11-27', '04:00')], 4], 'nothing is rewritten when a release time passes');
  // The account's time zone, not the workplace's: 19:30 in Los Angeles is 22:30 in New York.
  const east = fixture();
  east.call('preferences.update', { patch: { timezone: 'America/New_York' } });
  east.event(changed('q9', at('2026-11-21', '19:30'), THU, { location_id: 'loc-finch' }));
  assert.deepEqual(row(notifications(east)[0]), ['held', at('2026-11-21', '19:30'), '2026-11-22T07:00:00-05:00']);
  east.call('preferences.update', { patch: { quiet_hours: { enabled: false } } });
  east.event(changed('q10', at('2026-11-21', '23:30'), THU, { location_id: 'loc-quay' }));
  assert.equal(notifications(east)[0].state, 'released', 'quiet hours switched off');

  // The wire message: stored with the notification when email notices are on, dated at the release time.
  const mail = fixture();
  mail.event(scenario());
  const stored = mail.data.notifications.at(-1), example = require('./proposal-wire.json');
  assert.deepEqual(stored.wire, { ...example, id: stored.id }, 'the proposal\'s example event produces the proposal\'s example message');
  assert.deepEqual([stored.id, notifications(mail)[0].email_copy, stored.wire.time, stored.cause], ['ntf-0017', true, stored.release_at, { event_id: 'ev-pb-310' }]);
  const heldWire = quiet.data.notifications.find(x => x.cause.event_id === 'q2').wire;
  assert.deepEqual([heldWire.time, heldWire.data.subscription_ref, heldWire.data.source_object.object_id], [at('2026-11-22', '07:00'), 'pegboard-noor:shift-changes', THU], 'a held notification is dated at its release time');
  const topics = Object.fromEntries(app.data.notifications.concat(seedCopy().notifications).map(x => [x.kind, x.wire.data.subscription_ref.split(':')[1]]));
  assert.deepEqual(topics, { 'schedule.published': 'schedule', 'shift.changed': 'shift-changes', 'open_shift.posted': 'open-shifts', 'handoff.received': 'handoffs', 'handoff.updated': 'handoffs', 'time_off.decided': 'time-off' });
  mail.call('preferences.update', { patch: { email_notices: false } });
  mail.event(cancelled('ev-no-mail', at('2026-11-21', '20:50'), THU));
  assert.deepEqual([mail.data.notifications.at(-1).wire, notifications(mail)[0].email_copy, notifications(mail)[0].kind], [undefined, false, 'shift.changed'], 'no wire message while email notices are off');
  mail.call('preferences.update', { patch: { email_notices: true } });
  assert.equal(mail.data.notifications.at(-1).wire, undefined, 'turning email back on does not rewrite what was written');

  // Listing: newest first, filters and pages.
  const list = args => app.call('notifications.list', args);
  assert.deepEqual([list({ limit: 100 }).notifications.length, list({ limit: 100 }).notifications.every((x, i, all) => i === 0 || Date.parse(all[i - 1].created_at) >= Date.parse(x.created_at))], [count(), true]);
  assert.deepEqual([list({ kind: 'open_shift.posted', limit: 100 }).notifications.map(x => x.object.id), list({ kind: 'time_off.decided' }).notifications.length, list({ state: 'held' }).notifications.length], [['sh-1126-03', 'sh-1213-05', 'sh-1216-05', 'sh-1201-02'], 3, 0]);
  assert.deepEqual([count(), list({ since: at('2026-11-21', '19:00'), limit: 100 }).notifications.length, list().notifications.length, list().next_cursor, list({ limit: 100, cursor: '20' }).notifications.length], [33, 17, 20, '20', 13], '16 from the seed and 17 written here');
  rejects(app, () => list({ cursor: 'x' }), 'invalid_arguments');
});

test('T17 [all] the platform clock: time moves with no App event', () => {
  // app.advance() stands for Core's env.advance_time here: it moves the clock and runs no App
  // code. The same sequence runs against the real operation in tests/mcp.integration.cjs.
  const app = fixture();
  // Tomas accepts in quiet hours; the notification about it is held until 07:00.
  app.event(answered('ev-night', at('2026-11-21', '23:10'), 'ho-0013', 'accept', 'I can close on the 28th.'));
  const held = notifications(app)[0], sent = {};
  assert.deepEqual([held.state, held.created_at, held.release_at, held.email_copy, handoff(app, 'ho-0013').state], ['held', at('2026-11-21', '23:10'), at('2026-11-22', '07:00'), true, 'awaiting_manager']);
  assert.deepEqual(sender.pending(app.snapshot(), sent), [], 'seed notifications are history and a held notification is not due');

  const stored = app.data, read = () => ({
    notification: notifications(app)[0].state, sunday: shift(app, SUN_CLOSE).phase, cover: handoff(app, 'ho-0013').state, request: handoff(app, 'ho-0014').state,
    release: handoff(app, 'ho-0012').state, holiday: app.call('time_off.list', { include_closed: true }).time_off.find(t => t.id === 'to-0005').state,
  });
  const move = to => { app.advance(to); assert.deepEqual(app.data, stored, 'moving the clock to ' + to + ' changes no business record'); return read(); };
  assert.throws(() => app.advance(at('2026-11-21', '23:00')), { code: 'invalid_time' });
  const start = { notification: 'held', sunday: 'upcoming', cover: 'awaiting_manager', request: 'awaiting_me', release: 'awaiting_manager', holiday: 'pending' };
  assert.deepEqual(read(), start);
  assert.deepEqual(move(at('2026-11-22', '06:59:59')), start);
  assert.deepEqual(move(at('2026-11-22', '07:00')), { ...start, notification: 'released' }, 'a held notification reads released once the clock reaches its release time');
  assert.deepEqual(sender.pending(app.snapshot(), sent).map(x => [x.id, x.wire.id, x.wire.time]), [[held.id, held.id, at('2026-11-22', '07:00')]], 'and the sender picks it up');

  // A shift starts and ends, and can no longer be handed over.
  assert.equal(app.call('eligibility.check', { id: SUN_CLOSE, person_id: KAI }).cutoff_passed, true, 'its cut-off passed a day before it starts');
  assert.deepEqual(move(at('2026-11-22', '16:00')), { ...start, notification: 'released', sunday: 'started' });
  assert.throws(() => app.call('handoffs.cover', { id: SUN_CLOSE, to_person_id: KAI }), e => e.code === 'too_late' && /has started/.test(e.message));
  rejects(app, () => app.call('handoffs.release', { id: SUN_CLOSE }), 'too_late');
  assert.deepEqual(move(at('2026-11-22', '20:00')), { ...start, notification: 'released', sunday: 'ended' });
  rejects(app, () => app.event(changed('ev-ended', at('2026-11-22', '20:30'), SUN_CLOSE, { assignee: KAI })), 'invalid_event');
  // Pending handoffs and a pending time-off entry expire at their cut-off and first day.
  assert.deepEqual(move(at('2026-11-27', '16:00')), { ...start, notification: 'released', sunday: 'ended', cover: 'expired' });
  rejects(app, () => app.event(decided('ev-late', at('2026-11-27', '16:30'), 'ho-0013', 'approve')), 'invalid_event');
  assert.equal(shift(app, SAT).assignee, ME, 'the cover that was accepted but never approved moved nothing');
  assert.deepEqual(move(at('2026-11-28', '06:00')), { ...start, notification: 'released', sunday: 'ended', cover: 'expired', request: 'expired' });
  rejects(app, () => app.call('handoffs.respond', { id: 'ho-0014', answer: 'accept' }), 'invalid_state');
  assert.deepEqual(move(at('2026-12-03', '16:00')), { ...start, notification: 'released', sunday: 'ended', cover: 'expired', request: 'expired', release: 'expired' });
  rejects(app, () => app.call('handoffs.cancel', { id: 'ho-0012' }), 'invalid_state');
  assert.deepEqual(move(at('2026-12-24', '00:00')), { notification: 'released', sunday: 'ended', cover: 'expired', request: 'expired', release: 'expired', holiday: 'expired' });
  rejects(app, () => app.call('time_off.cancel', { id: 'to-0005' }), 'invalid_state');
  assert.deepEqual([app.call('handoffs.list').handoffs, app.call('time_off.list').time_off.map(t => t.id), mine(app, { start: at('2026-11-09', '00:00'), end: at('2026-12-07', '00:00') }).every(s => s.phase === 'ended')], [[], ['to-0002'], true]);
  assert.deepEqual([app.data.activity.length, app.data.activity.at(-1).action], [stored.activity.length, 'notification.created'], 'no activity row for a time-driven change');
  // Writes use the same derivation: with every old handoff expired, nothing blocks a new request.
  app.event(posted('ev-new-week', at('2026-12-24', '09:00'), '2026-12-28', [slot('sh-1230-05', '2026-12-30', '16:00', '20:00', ME)]));
  assert.equal(app.call('handoffs.cover', { id: 'sh-1230-05', to_person_id: KAI }).handoff.state, 'awaiting_coworker');

  // The sender adapter with stand-in clients: selection, the request it builds, and its log.
  // The real Messaging and Mail flow is tests/mail.integration.cjs.
  return (async () => {
    const before = app.data, newer = app.data.notifications.at(-1);
    const published = [], source = { call: async name => (name === 'env.snapshot' ? { status: 'ok', snapshot: app.snapshot() } : { status: 'permission_denied' }) };
    const router = { call: async (name, args) => { published.push([name, args.request_id, args.message.id]); return { status: 'committed', event_id: 'mail-' + published.length, target: { app_id: 'mail', account_id: 'mail-noor' }, committed_at: 'x' }; } };
    const first = await sender.publishReleased({ source, router, sent });
    assert.deepEqual([first.stage, published, Object.keys(sent)], ['delivered', [['router.publish', 'pegboard:1:' + held.id, held.id], ['router.publish', 'pegboard:1:' + newer.id, newer.id]], [held.id, newer.id]], 'in order of release time');
    const again = await sender.publishReleased({ source, router, sent });
    assert.deepEqual([again.stage, again.results.length, published.length], ['nothing_pending', 0, 2], 'a notification in the sender log is not published twice');
    const refusing = { call: async () => ({ status: 'rejected', code: 'recipient_not_authorized' }) };
    const refused = await sender.publishReleased({ source, router: refusing, sent: {} });
    assert.deepEqual([refused.stage, refused.results.length, Object.keys(refused.sent)], ['router_rejected', 1, []], 'a rejected delivery is reported and not logged as sent');
    const down = await sender.publishReleased({ source: { call: async () => ({ status: 'permission_denied' }) }, router, sent: {} });
    assert.deepEqual([down.stage, down.results], ['source_read', []]);
    assert.deepEqual(app.data, before, 'the sender writes nothing back');
  })();
});

test('T17b [all] a seed notification that is still held when the seed is loaded is published after its release time; one without a wire message never', () => {
  const seed = seedCopy(), prior = seed.notifications.at(-1);
  seed.notifications.push({ ...prior, id: 'ntf-0017', seq: 0, created_at: at('2026-11-21', '17:30'), release_at: at('2026-11-22', '07:00'), title: prior.title + ' (held)', wire: { ...prior.wire, id: 'ntf-0017', time: at('2026-11-22', '07:00') } });
  const { wire, ...plain } = prior;
  seed.notifications.push({ ...plain, id: 'ntf-0018', seq: 0, created_at: at('2026-11-21', '17:40'), release_at: at('2026-11-22', '07:00') });
  const app = fixture({ seed });
  assert.deepEqual([notifications(app).slice(0, 2).map(x => [x.id, x.state, x.email_copy]), sender.pending(app.snapshot())], [[['ntf-0018', 'held', false], ['ntf-0017', 'held', true]], []]);
  app.advance(at('2026-11-22', '07:00'));
  assert.deepEqual(sender.pending(app.snapshot()).map(x => x.id), ['ntf-0017'], 'history that was already released at load time stays history');
});

const RUNTIME = process.env.PALE_RUNTIME_ROOT;
test('T18 [all] Core contracts, the real env.advance_time and reset on the public runtime (real MCP)', t => {
  if (!RUNTIME) return t.skip('set PALE_RUNTIME_ROOT to the runtime directory of a public checkout, or run tests/mcp.integration.cjs --runtime DIR');
  const run = spawnSync(process.execPath, [path.join(__dirname, 'mcp.integration.cjs'), '--runtime', RUNTIME], { encoding: 'utf8', timeout: 180000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('T16b [all] Pegboard -> Mail through Messaging on the public runtime (real MCP)', t => {
  if (!RUNTIME) return t.skip('set PALE_RUNTIME_ROOT to the runtime directory of a public checkout that holds this package and the Mail package, or run tests/mail.integration.cjs --runtime DIR');
  const run = spawnSync(process.execPath, [path.join(__dirname, 'mail.integration.cjs'), '--runtime', RUNTIME], { encoding: 'utf8', timeout: 180000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('T19 [all] seed validation failures; one activity row per write, event and event effect, none for a rejected call or a time-driven change', () => {
  const app = fixture(), bad = (change, ctx = app.ctx) => { const seed = seedCopy(); change(seed); assert.throws(() => plugin.validateSeed(ctx, seed), { code: 'invalid_seed' }, String(change)); };
  const find = (list, id) => list.find(x => x.id === id), last = list => list[list.length - 1];
  plugin.validateSeed(app.ctx, seedCopy());
  // The account and the binding.
  bad(s => { s.account_id = 'unbound-account'; });
  bad(s => { s.owner_person_id = 'person-nobody'; });
  bad(() => {}, { ...app.ctx, binding: { people: [], accounts: [], objects: {} } });
  bad(s => { s.people[0].role = 'manager'; });
  bad(s => { s.owner_person_id = ROSA; }, { ...app.ctx, binding: { people: [{ person_id: ROSA, name: 'Rosa Delgado' }], accounts: [{ app_id: 'pegboard', account_id: 'pegboard-noor', owner_person_id: ROSA }], objects: {} } });
  // Duplicate IDs, within a kind and across kinds.
  bad(s => { s.people[1].id = s.people[0].id; });
  bad(s => { s.shifts[1].id = s.shifts[0].id; });
  bad(s => { s.handoffs[1].id = s.handoffs[0].id; });
  bad(s => { s.time_off[0].id = s.handoffs[0].id; });
  bad(s => { s.notifications[0].id = s.shifts[0].id; });
  bad(s => { s.workplace.positions[0].id = s.workplace.locations[0].id; });
  // Dangling references.
  bad(s => { s.people[1].position_ids = ['pos-none']; });
  bad(s => { s.shifts[0].location_id = 'loc-none'; });
  bad(s => { s.shifts[0].position_id = 'pos-none'; });
  bad(s => { s.shifts[1].assignee = 'person-nobody'; });
  bad(s => { s.handoffs[0].shift_id = 'sh-none'; });
  bad(s => { s.handoffs[1].other_shift_id = 'sh-none'; });
  bad(s => { s.handoffs[0].counterpart_id = 'person-nobody'; });
  bad(s => { s.handoffs[0].decided_by = 'person-nobody'; });
  bad(s => { s.time_off[1].decided_by = 'person-nobody'; });
  bad(s => { s.notifications[0].object.id = '2026-01-05'; });
  bad(s => { s.notifications[3].object.id = 'ho-9999'; });
  bad(s => { s.notifications[1].object.id = 'to-9999'; });
  bad(s => { s.notifications[5].shift_ids = ['sh-none']; });
  // Time zones, weeks and shift timing.
  bad(s => { s.workplace.timezone = 'Nowhere/Land'; });
  bad(s => { s.preferences.timezone = 'Nowhere/Land'; });
  bad(s => { s.preferences.quiet_hours.end = s.preferences.quiet_hours.start; });
  bad(s => { s.weeks[0].week_start = '2026-11-10'; });
  bad(s => { s.weeks.push({ ...s.weeks[0] }); });
  bad(s => { s.weeks.shift(); });
  bad(s => { s.shifts[0].end = s.shifts[0].start; });
  bad(s => { s.shifts[0].end = at('2026-11-09', '23:00'); });
  // A shift's history must lead to the shift as it is.
  bad(s => { find(s.shifts, 'sh-1113-05').history.reverse(); });
  bad(s => { find(s.shifts, 'sh-1113-05').start = at('2026-11-13', '15:30'); });
  bad(s => { find(s.shifts, 'sh-1113-05').history[1].change.start.from = at('2026-11-13', '14:00'); find(s.shifts, 'sh-1113-05').history.splice(1, 0, { at: at('2026-11-01', '09:00'), by: 'manager', change: { start: { from: at('2026-11-13', '13:00'), to: at('2026-11-13', '15:00') } } }); });
  bad(s => { delete find(s.shifts, 'sh-1122-02').cancelled_at; });
  bad(s => { find(s.shifts, MON).assignee = TOMAS; });
  // A handoff's structure, and a state that does not fit the shifts it names.
  bad(s => { s.handoffs[0].counterpart_id = null; });                                         // a cover names a coworker
  bad(s => { s.handoffs[2].counterpart_id = TOMAS; });                                        // a release names nobody
  bad(s => { s.handoffs[1].other_shift_id = null; });                                         // a trade names a second shift
  bad(s => { s.handoffs[0].other_shift_id = MON; });                                          // a cover does not
  bad(s => { s.handoffs[0].requester_id = KAI; });                                            // the account holder is not part of it
  bad(s => { s.handoffs[0].counterpart_id = ME; });                                           // from and to the same person
  bad(s => { s.handoffs[3].requester_id = TOMAS; });                                          // a pickup is the account holder's
  bad(s => { find(s.handoffs, 'ho-0013').state = 'awaiting_me'; last(find(s.handoffs, 'ho-0013').history).state = 'awaiting_me'; });
  bad(s => { find(s.handoffs, 'ho-0014').state = 'awaiting_coworker'; last(find(s.handoffs, 'ho-0014').history).state = 'awaiting_coworker'; });
  bad(s => { find(s.handoffs, 'ho-0012').state = 'awaiting_coworker'; last(find(s.handoffs, 'ho-0012').history).state = 'awaiting_coworker'; });
  bad(s => { last(find(s.handoffs, 'ho-0013').history).state = 'declined'; });
  bad(s => { find(s.shifts, 'sh-1110-03').assignee = ME; });                                  // an approved cover whose shift is still mine
  bad(s => { const x = find(s.shifts, 'sh-1110-03'); x.history.pop(); x.assignee = ME; });    // ... also when the history says nothing of it
  bad(s => { find(s.shifts, 'sh-1119-02').history[1].change.assignee.to = TOMAS; find(s.shifts, 'sh-1119-02').assignee = TOMAS; }); // an approved pickup that gave the shift to someone else
  bad(s => { s.handoffs.push({ ...find(s.handoffs, 'ho-0013'), id: 'ho-0015' }); });          // two pending handoffs on one shift
  bad(s => { const x = find(s.shifts, SAT); x.history.push({ at: at('2026-11-21', '12:00'), by: 'manager', change: { assignee: { from: ME, to: TOMAS } } }); x.assignee = TOMAS; }); // pending, but the shift is no longer mine
  bad(s => { const x = find(s.shifts, 'sh-1129-01'); x.history.push({ at: at('2026-11-21', '13:00'), by: 'manager', change: { assignee: { from: ADA, to: null } } }); x.assignee = null; }); // pending, but no longer the coworker's
  bad(s => { find(s.handoffs, 'ho-0013').cutoff_at = at('2026-11-28', '17:00'); });           // a cut-off after the shift starts
  // Availability, time off, notifications and the activity log.
  bad(s => { s.availability.push({ weekday: 'tue', start: '12:00', end: '14:00' }); });
  bad(s => { s.availability[0].end = '08:00'; });
  bad(s => { s.time_off[0].end_date = '2026-11-09'; });
  bad(s => { s.time_off[0].start_date = '2026-02-30'; });
  bad(s => { delete s.time_off[1].decided_by; });
  bad(s => { s.time_off[1].state = 'denied'; });
  bad(s => { s.notifications[0].release_at = at('2026-10-26', '14:00', '-07:00'); });
  bad(s => { s.activity[1].seq = s.activity[0].seq; });
  // A timestamp without its UTC offset. (On the host, Core's check of the seed schema refuses it first.)
  bad(s => { s.shifts[0].start = '2026-11-09T06:00:00'; });
  bad(s => { s.weeks[0].posted_at = '2026-10-26T15:00:00'; });
  bad(s => { find(s.shifts, 'sh-1113-05').history[1].change.start.to = '2026-11-13T16:00:00'; find(s.shifts, 'sh-1113-05').start = '2026-11-13T16:00:00'; });
  bad(s => { s.handoffs[0].history[0].at = '2026-11-03 08:30'; });
  bad(s => { s.notifications[0].release_at = '2026-10-26T15:00:00'; });
  bad(s => { s.activity[0].at = 'yesterday'; });
  // Shapes the seed schema refuses: a timestamp without its UTC offset, and stored time-based states.
  const refused = change => { const seed = seedCopy(); change(seed); assert.throws(() => fixture({ seed }), { code: 'schema_mismatch' }, String(change)); };
  refused(s => { s.shifts[0].start = '2026-11-09T06:00:00'; });
  refused(s => { s.handoffs[0].created_at = '2026-11-03 08:30'; });
  refused(s => { find(s.handoffs, 'ho-0002').state = 'expired'; });
  refused(s => { s.time_off[0].state = 'expired'; });
  refused(s => { s.shifts[0].phase = 'ended'; });
  refused(s => { s.shifts[0].flags = ['short_rest']; });
  refused(s => { s.notifications[0].state = 'released'; });
  refused(s => { delete s.notifications[0].release_at; });
  refused(s => { s.activity[0].actor = 'timer'; });
  refused(s => { s.shifts[0].history[0].change = { note: 'posted' }; });
  refused(s => { delete s.workplace.policy.manager_approval; });
  // What a seed may leave out, and what depends on the time it is loaded at.
  plugin.validateSeed(app.ctx, seedWith(s => { for (const x of s.shifts) if (!s.handoffs.some(h => h.state === 'approved' && [h.shift_id, h.other_shift_id].includes(x.id))) x.history = []; }));
  // An account with nothing in it yet, and a seeded leave that is longer than a request may be: every read answers.
  const empty = fixture({ seed: { ...seedCopy(), weeks: [], shifts: [], availability: [], time_off: [{ id: 'to-0001', start_date: '2026-12-01', end_date: '2027-01-14', state: 'approved', requested_at: at('2026-10-01', '09:00', '-07:00'), decided_at: at('2026-10-02', '09:00', '-07:00'), decided_by: ROSA, history: [{ at: at('2026-10-02', '09:00', '-07:00'), actor: 'manager', action: 'approved', state: 'approved' }] }], handoffs: [], notifications: [], activity: [] } });
  assert.deepEqual([empty.call('shifts.list', WEEK), empty.call('hours.summary', WEEK).weeks.map(w => [w.posted_at, w.scheduled_hours, w.hours_left]), empty.call('handoffs.list', { include_closed: true }), empty.call('notifications.list'), empty.call('availability.get'), empty.call('time_off.list').time_off.map(t => [t.id, t.days, t.state]), empty.call('team.list').people.length, empty.call('workplace.get').me.id, empty.call('preferences.get').preferences.timezone],
    [{ shifts: [], next_cursor: null }, [[null, 0, 24]], { handoffs: [], next_cursor: null }, { notifications: [], next_cursor: null }, { blocks: [] }, [['to-0001', 45, 'approved']], 10, ME, 'America/Los_Angeles']);
  rejects(empty, () => empty.call('shifts.get', { id: MON }), 'not_found');
  rejects(empty, () => empty.call('handoffs.pickup', { id: WED_OPEN }), 'not_found');
  assert.equal(empty.call('time_off.request', { start: '2027-01-15', end: '2027-01-16' }).id, 'to-0002');
  const moved = s => { const x = find(s.shifts, 'sh-1111-02'); x.history.push({ at: at('2026-11-10', '09:00'), by: 'manager', change: { assignee: { from: JO, to: SAM } } }); x.assignee = SAM; };
  plugin.validateSeed(app.ctx, seedWith(moved));
  bad(moved, { ...app.ctx, virtual_now: at('2026-11-05', '09:00') });                         // while the trade that names it was still pending
  assert.deepEqual([plugin.records(seedCopy()).length, new Set(plugin.objects(seedCopy())).size, plugin.references(seedCopy())], [219, 219, []]);

  // A generated ID never repeats an ID that another record uses.
  const crowded = fixture({ seed: seedWith(s => { s.workplace.locations.push({ id: 'ho-0015', name: 'Pop-up stall' }, { id: 'to-0006', name: 'Market stand' }, { id: 'ntf-0017', name: 'Festival cart' }); }) });
  assert.deepEqual([crowded.call('handoffs.release', { id: FRI }).id, crowded.call('time_off.request', { start: '2026-12-12', end: '2026-12-13' }).id, crowded.event(scenario()).notifications.at(-1).id], ['ho-0016', 'to-0007', 'ntf-0018']);

  // The activity log.
  const rows = () => app.data.activity.length;
  let n = rows();
  for (const read of [['workplace.get'], ['team.list'], ['shifts.list', WEEK], ['shifts.get', { id: MON }], ['hours.summary', WEEK], ['eligibility.check', { id: WED_OPEN }], ['availability.get'], ['time_off.list'], ['handoffs.list'], ['handoffs.get', { id: 'ho-0014' }], ['notifications.list'], ['preferences.get']]) app.call(...read);
  assert.equal(rows(), n, 'the 12 reads write no row');
  const writes = [
    ['availability.update', { blocks: [{ weekday: 'tue', start: '09:00', end: '13:00' }] }], ['preferences.update', { patch: { open_shift_notices: true } }], ['time_off.request', { start: '2026-12-12', end: '2026-12-13' }],
    ['time_off.cancel', { id: 'to-0006' }], ['handoffs.cover', { id: THU, to_person_id: TOMAS }], ['handoffs.cancel', { id: 'ho-0015' }], ['handoffs.trade', { id: THU, their_shift_id: 'sh-1126-03' }],
    ['handoffs.release', { id: FRI }], ['handoffs.respond', { id: 'ho-0014', answer: 'decline' }], ['handoffs.pickup', { id: WED_OPEN }],
  ];
  const roomy = fixture({ seed: seedWith(s => { s.people[0].max_weekly_hours = null; }) }); // the pickup needs room under the cap
  for (const [name, args] of writes) {
    const target = name === 'handoffs.pickup' ? roomy : app, before = target.data.activity.length;
    const result = target.call(name, { ...args, request_id: 'req-' + name }), row = target.data.activity.at(-1);
    assert.equal(target.data.activity.length, before + 1, name + ' writes one row');
    assert.deepEqual([row.actor, row.action, row.object_id, row.request_id, row.at, row.seq], ['agent', name, result.id, 'req-' + name, target.now, before + 1]);
  }
  n = rows();
  rejects(app, () => app.call('handoffs.cover', { id: THU, to_person_id: KAI }), 'already_requested');
  rejects(app, () => app.event(decided('ev-none', LATER, 'ho-none', 'approve')), 'invalid_event');
  assert.equal(rows(), n, 'a rejected call and a rejected event write no row');
  app.advance(LATER);
  assert.equal(rows(), n, 'moving the clock writes no row');
  app.event(changed('ev-coworker', at('2026-11-21', '19:10'), 'sh-1124-03', { start: at('2026-11-24', '08:00') }));
  assert.deepEqual(app.data.activity.slice(n).map(a => [a.actor, a.action, a.object_id, a.event_id, a.at, a.details]), [['event', 'shift.changed', 'sh-1124-03', 'ev-coworker', at('2026-11-21', '19:10'), { fields: ['start'] }]], 'an event with no further effect writes one row');
  n = rows();
  // One event with several effects: the manager takes Thursday's shift from me while my trade with Sam is pending.
  app.event(changed('ev-take-thu', at('2026-11-21', '19:20'), THU, { assignee: JO }));
  assert.deepEqual(app.data.activity.slice(n).map(a => [a.actor, a.action, a.object_id, a.event_id]), [
    ['event', 'shift.changed', THU, 'ev-take-thu'], ['event', 'notification.created', 'ntf-0017', 'ev-take-thu'], ['event', 'handoff.voided', 'ho-0016', 'ev-take-thu'], ['event', 'notification.created', 'ntf-0018', 'ev-take-thu'],
  ], 'one row for the event and one for each of its effects');
  assert.ok(app.data.activity.every((a, i) => a.seq === i + 1 && ['agent', 'event'].includes(a.actor) && (a.actor === 'agent') === (a.request_id !== undefined) && (a.actor === 'event') === (a.event_id !== undefined)));
  assert.deepEqual(app.data.notifications.slice(-2).map(x => x.seq), [n + 2, n + 4], 'a notification carries the sequence number of its row');
  n = rows();
  app.advance(at('2026-12-24', '00:00'));
  assert.deepEqual([rows(), app.call('handoffs.list').handoffs.length, app.call('time_off.list').time_off.map(t => t.id)], [n, 0, ['to-0002']], 'handoffs and time off that expired by time alone leave no row');
});

test('contracts, fixture and declarations are in step', () => {
  const dev = path.join(__dirname, '../dev');
  for (const [ref, text] of Object.entries(require(path.join(dev, 'build.cjs')).outputs())) assert.equal(fs.readFileSync(path.join(__dirname, '..', ref), 'utf8'), text, ref + ' differs from dev/contracts.cjs');
  const builder = require(path.join(dev, 'build-fixture.cjs'));
  assert.equal(fs.readFileSync(path.join(__dirname, '../fixtures/minimal.json'), 'utf8'), builder.print(builder.build()) + '\n', 'fixtures/minimal.json differs from dev/build-fixture.cjs');
  assert.deepEqual(require(path.join(dev, 'check-fixture.cjs')).check(), []);
  const manifest = require('../app.json'), tools = require('../tools.json'), declared = require('../contribution/contribution.json'), policies = require('../fixtures/policies.json');
  assert.deepEqual(tools.map(t => t.name.slice(9)).sort(), require('../src/operations.cjs').tools.slice().sort());
  assert.deepEqual([tools.filter(t => t.read_only).length, tools.filter(t => !t.read_only).length], [12, 10]);
  assert.deepEqual(tools.filter(t => !t.read_only).map(t => t.name.slice(9)), ['availability.update', 'time_off.request', 'time_off.cancel', 'handoffs.cover', 'handoffs.trade', 'handoffs.release', 'handoffs.pickup', 'handoffs.respond', 'handoffs.cancel', 'preferences.update']);
  assert.deepEqual(declared.interfaces.find(i => i.interface_id === 'agent-mcp').operations.map(o => [o.name, o.effect]), tools.map(t => [t.name, t.read_only ? 'read' : 'write']));
  assert.deepEqual(declared.events.accepts.map(e => e.type), manifest.event_types);
  assert.deepEqual(manifest.event_types.map(e => e.slice(9)), ['schedule.published', 'shift.changed', 'shift.cancelled', 'handoff.received', 'handoff.answered', 'handoff.decided', 'handoff.withdrawn', 'time_off.decided'], 'eight events and no clock event');
  assert.deepEqual(require('../schemas/events.schema.json').oneOf.map(e => e.properties.operation.const), manifest.event_types);
  assert.deepEqual(declared.messaging.receives, []);
  assert.deepEqual(declared.messaging.publishes.map(p => [p.channel, p.schema_id, p.status]), [['channel.email', 'urn:pale:email-message:2', 'implemented']]);
  assert.deepEqual([policies.sandbox.allow.slice().sort(), policies.scenario.allow.every(name => tools.some(t => t.name === name))], [tools.map(t => t.name).sort(), true]);
  // Every stored wire message passes the package's copy of Mail's wire schema (urn:pale:email-message:2).
  const wireSchema = require('../schemas/router-message.schema.json'), wireValid = require('./schema-validator.cjs').compile(wireSchema, path.join(__dirname, '../schemas'));
  assert.equal(wireSchema.$id, 'urn:pale:email-message:2');
  const example = require('./proposal-wire.json');
  for (const candidate of [example, ...seedCopy().notifications.map(x => x.wire)]) assert.ok(wireValid(candidate), 'wire message ' + candidate.id + ' matches Mail\'s schema');
  const noRecipient = structuredClone(example); delete noRecipient.data.recipient;
  const otherType = { ...structuredClone(example), type: 'org.pale.other.v1' };
  assert.deepEqual([wireValid(noRecipient), wireValid(otherType)], [false, false], 'broken variants fail');
  assert.equal(require('../fixtures/clock.json').initial_time, builder.CLOCK);
  assert.equal(require('../contribution/dataset.json').expected_counts.records, plugin.records(seedCopy()).length);
  assert.ok(manifest.event_types.includes(scenario().operation));
  const cases = require('./cases.json');
  assert.equal(fixture().call(cases.read.name.slice(9), cases.read.args).shifts.length, 4, 'the read case of the public verifier returns my week');
});

test('the package runs on its own: no import or file path leaves its folder', () => {
  const root = path.resolve(__dirname, '..'), files = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.(cjs|js|mjs)$/.test(e.name)) files.push(f); } };
  walk(root);
  assert.ok(files.length >= 20);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8'), rel = path.relative(root, file);
    for (const m of text.matchAll(/require\(\s*(['"`])([^'"`]+)\1\s*\)/g)) {
      const target = m[2];
      if (target.startsWith('node:')) continue;
      assert.ok(target.startsWith('.'), rel + ' requires ' + target + ': only Node built-ins and package files are allowed');
      const resolved = path.resolve(path.dirname(file), target);
      assert.ok(resolved === root || resolved.startsWith(root + path.sep), rel + ' requires a file outside the package: ' + target);
    }
    // A literal path may climb at most to the package root (the file's own depth below it).
    const depth = rel.split(path.sep).length - 1;
    for (const m of text.matchAll(/['"`](\.\.(?:\/[^'"`]*)?)['"`]/g)) {
      const parts = m[1].split('/'), climbs = parts.findIndex(x => x !== '..');
      assert.ok((climbs === -1 ? parts.length : climbs) <= depth, rel + ' has a path that leaves the package: ' + m[0]);
    }
  }
  // The business entrypoint and everything under src/ never touch the file system, the network or a child process.
  for (const file of files.filter(f => path.relative(root, f).startsWith('src' + path.sep) || path.relative(root, f) === 'plugin.cjs')) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /node:(fs|child_process|net|http|https|dgram|worker_threads)|Date\.now\(|new Date\(\)/, path.relative(root, file));
  }
});

test('invariants hold along a seeded random walk over every write, every event and the clock', () => {
  // dev/walk.cjs: the harness checks each argument, result and resulting state at every step,
  // and here every sixteenth step the walk also compares reads with each other. One walk, with
  // seed 30: no manager approval, no personal cap and a two-hour cut-off, where the tests above
  // use the fixture's own policy. `node dev/walk.cjs` runs more walks, under every policy,
  // comparing reads every fourth step.
  const seen = require('../dev/walk.cjs').walk(30, 160, 16);
  assert.deepEqual(Object.keys(seen).sort(), [...require('../tools.json').filter(t => !t.read_only).map(t => t.name.slice(9)), ...require('../app.json').event_types.map(e => e.slice(9)), 'env.advance_time'].sort(), 'every write, every event and the clock were walked');
  assert.ok(Object.values(seen).every(counts => counts.ok > 0), 'and each of them succeeded at least once');
});
