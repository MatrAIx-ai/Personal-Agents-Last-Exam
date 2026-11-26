#!/usr/bin/env node
'use strict';
// Authoring-time script, never run by the App or the host.
//   node dev/build-fixture.cjs          write fixtures/minimal.json
//   node dev/build-fixture.cjs --check  exit 1 if the committed fixture differs
// It builds an invented workplace and replays a scripted four-week history through the App's
// own business functions (the in-memory harness of this package), so shift histories,
// handoffs, time off, notifications and the activity log follow the App rules. Deterministic:
// no random numbers, no wall clock. It reads and writes only files of this package.
const fs = require('node:fs'), path = require('node:path');
const { fixture } = require('../tests/harness.cjs');
const { addDays, localToInstant, isoAt, ms, HOUR } = require('../src/util.cjs');

const TZ = 'America/Los_Angeles', ME = 'person-noor', BOSS = 'person-rosa';
// The history ends here; fixtures/clock.json carries the same time for the launcher.
const CLOCK = require('../fixtures/clock.json').initial_time;
const at = (date, hhmm) => isoAt(localToInstant(date, hhmm, TZ), TZ);
const tag = date => date.slice(5, 7) + date.slice(8, 10);
const WEEKS = ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'];

const workplace = {
  id: 'wp-finch', name: 'Finch Street Café', timezone: TZ, week_start: 'monday', currency: 'USD',
  policy: { min_rest_hours: 10, max_weekly_hours: 40, handoff_cutoff_hours: 24, time_off_notice_days: 14, manager_approval: true },
  locations: [{ id: 'loc-finch', name: 'Finch Street' }, { id: 'loc-quay', name: 'Quay kiosk' }],
  positions: [{ id: 'pos-barista', name: 'Barista', hourly_rate: 17.5 }, { id: 'pos-cashier', name: 'Cashier', hourly_rate: 16.5 }, { id: 'pos-lead', name: 'Shift lead', hourly_rate: 20 }],
};
const B = 'pos-barista', C = 'pos-cashier', L = 'pos-lead';
const people = [
  { id: ME, name: 'Noor Haddad', role: 'employee', position_ids: [B, C], max_weekly_hours: 24 },
  { id: 'person-ines', name: 'Ines Okafor', role: 'employee', position_ids: [B, L], max_weekly_hours: null },
  { id: 'person-tomas', name: 'Tomas Lindqvist', role: 'employee', position_ids: [B, C], max_weekly_hours: null },
  { id: 'person-kai', name: 'Kai Moreno', role: 'employee', position_ids: [C], max_weekly_hours: 20 },
  { id: 'person-ada', name: 'Ada Brennan', role: 'employee', position_ids: [B], max_weekly_hours: null },
  { id: 'person-luz', name: 'Luz Ferreira', role: 'employee', position_ids: [B, C, L], max_weekly_hours: null },
  { id: 'person-sam', name: 'Sam Whitlock', role: 'employee', position_ids: [C], max_weekly_hours: null },
  { id: 'person-jo', name: 'Jo Ainsworth', role: 'employee', position_ids: [B, C], max_weekly_hours: null },
  { id: 'person-pip', name: 'Pip Nakamura', role: 'employee', position_ids: [B], max_weekly_hours: null },
  { id: BOSS, name: 'Rosa Delgado', role: 'manager', position_ids: [], max_weekly_hours: null },
];

// Six shifts a day: slot, location, position, start, end.
const TEMPLATE = [
  ['01', 'loc-finch', B, '06:00', '12:00'], ['02', 'loc-quay', C, '08:00', '14:00'], ['03', 'loc-finch', C, '07:00', '13:00'],
  ['04', 'loc-finch', B, '13:00', '19:00'], ['05', 'loc-finch', C, '16:00', '20:00'], ['06', 'loc-finch', L, '15:00', '21:00'],
];
// The account holder's shifts and the coworker shifts the scripted history relies on. null = posted open.
const PINS = {
  'sh-1109-01': ME, 'sh-1110-03': ME, 'sh-1112-01': ME, 'sh-1113-05': ME, 'sh-1114-05': ME, 'sh-1111-02': 'person-jo',
  'sh-1116-01': ME, 'sh-1120-05': ME, 'sh-1122-05': ME, 'sh-1121-05': 'person-luz', 'sh-1122-06': 'person-ines',
  'sh-1123-01': ME, 'sh-1126-02': ME, 'sh-1127-05': ME, 'sh-1128-05': ME, 'sh-1124-04': 'person-ines', 'sh-1129-01': 'person-ada',
  'sh-1201-03': ME, 'sh-1203-02': ME, 'sh-1204-05': ME, 'sh-1205-05': ME, 'sh-1206-05': 'person-luz', 'sh-1201-02': 'person-sam',
  // posted open
  'sh-1115-04': null, 'sh-1117-06': null, 'sh-1118-05': null, 'sh-1119-02': null, 'sh-1121-04': null, 'sh-1122-04': null,
  'sh-1125-02': null, 'sh-1127-01': null, 'sh-1129-04': null, 'sh-1206-04': null,
};
// Days a coworker is kept free so that a scripted cover or trade is possible on that day.
const DAYS_OFF = {
  'person-tomas': ['2026-11-10', '2026-11-16', '2026-11-26', '2026-11-28'], 'person-kai': ['2026-11-20'], 'person-jo': ['2026-11-12'],
  'person-luz': ['2026-12-05'], 'person-ines': ['2026-11-23'],
};
const GENERATOR_CAP = { 'person-kai': 16 }, DEFAULT_CAP = 34;
// The Friday close of the first week is posted an hour earlier and moved by the manager later.
const POSTED_TIMES = { 'sh-1113-05': ['15:00', '19:00'] };

// ---- the posted schedule ---------------------------------------------------------------
function buildSchedule() {
  const shifts = [];
  for (const week of WEEKS) for (let d = 0; d < 7; d++) {
    const date = addDays(week, d);
    TEMPLATE.forEach(([slot, location_id, position_id, start, end], n) => {
      const id = 'sh-' + tag(date) + '-' + slot, times = POSTED_TIMES[id] || [start, end];
      shifts.push({ shift_id: id, location_id, position_id, start: at(date, times[0]), end: at(date, times[1]), assignee: undefined, week, date, order: d * 6 + n });
    });
  }
  const byId = new Map(shifts.map(s => [s.shift_id, s]));
  for (const [id, who] of Object.entries(PINS)) { if (!byId.has(id)) throw new Error('Unknown pinned shift ' + id); byId.get(id).assignee = who; }
  const staff = people.filter(p => p.role === 'employee' && p.id !== ME);
  const held = who => shifts.filter(s => s.assignee === who);
  const hours = s => (ms(s.end) - ms(s.start)) / HOUR;
  const fits = (p, s) => {
    if (!p.position_ids.includes(s.position_id) || (DAYS_OFF[p.id] || []).includes(s.date)) return false;
    const mine = held(p.id);
    if (mine.some(x => x.date === s.date)) return false;                                   // one shift a day
    if (mine.some(x => (x.date < s.date ? ms(s.start) - ms(x.end) : ms(x.start) - ms(s.end)) < 10 * HOUR)) return false; // rest between days
    const week = mine.filter(x => x.week === s.week).reduce((t, x) => t + hours(x), 0);
    return week + hours(s) <= (GENERATOR_CAP[p.id] ?? DEFAULT_CAP);
  };
  for (const s of shifts) {
    if (s.assignee !== undefined) continue;
    const candidates = staff.filter(p => fits(p, s)).map(p => ({ p, load: held(p.id).filter(x => x.week === s.week).reduce((t, x) => t + hours(x), 0) }));
    // Least loaded first; ties rotate with the shift's place in the week so nobody always opens.
    candidates.sort((a, b) => a.load - b.load || ((staff.indexOf(a.p) - s.order + 800) % staff.length) - ((staff.indexOf(b.p) - s.order + 800) % staff.length));
    s.assignee = candidates.length ? candidates[0].p.id : null;
  }
  return week => shifts.filter(s => s.week === week).map(({ shift_id, location_id, position_id, start, end, assignee }) => ({ shift_id, location_id, position_id, start, end, assignee }));
}

// ---- the scripted history ------------------------------------------------------------
function build() {
  const posted = buildSchedule();
  const base = {
    account_id: 'pegboard-noor', owner_person_id: ME, workplace, people, weeks: [], shifts: [],
    availability: [{ weekday: 'tue', start: '09:00', end: '13:00' }, { weekday: 'wed', start: '18:00', end: '21:00' }, { weekday: 'sun', start: '08:00', end: '12:00' }],
    time_off: [], handoffs: [],
    preferences: { timezone: TZ, quiet_hours: { enabled: true, start: '22:00', end: '07:00' }, email_notices: true, open_shift_notices: true },
    notifications: [], activity: [],
  };
  const app = fixture({ seed: base, now: at('2026-10-26', '09:00') });
  let n = 0, r = 0;
  const go = (date, hhmm) => app.advance(at(date, hhmm));
  const call = (date, hhmm, name, args) => { go(date, hhmm); return app.call(name, { ...args, request_id: 'hist-req-' + String(++r).padStart(3, '0') }); };
  const event = (date, hhmm, name, payload) => app.event({ event_id: 'hist-' + String(++n).padStart(3, '0'), at: at(date, hhmm), operation: 'pegboard.' + name, payload });
  const post = (date, week) => event(date, '15:00', 'schedule.published', { week_start: week, shifts: posted(week), posted_by: BOSS });

  // Week of 9 November. Noor asks for 10 November off before the week is posted; nobody decides.
  call('2026-10-26', '10:00', 'time_off.request', { start: '2026-11-10', end: '2026-11-10', reason: 'Midterm review session' });            // to-0001, expires
  post('2026-10-26', WEEKS[0]);
  call('2026-10-27', '09:00', 'time_off.request', { start: '2026-11-15', end: '2026-11-15', reason: 'Family visit' });                      // to-0002
  event('2026-10-28', '11:00', 'time_off.decided', { time_off_id: 'to-0002', decision: 'approve', decided_by: BOSS });
  post('2026-11-02', WEEKS[1]);
  call('2026-11-02', '18:00', 'time_off.request', { start: '2026-11-24', end: '2026-11-24', reason: 'Dentist' });                           // to-0003, cancelled
  call('2026-11-03', '08:30', 'handoffs.cover', { id: 'sh-1110-03', to_person_id: 'person-tomas', message: 'I have a midterm review on Tuesday morning. Could you take this one?' }); // ho-0001
  event('2026-11-03', '12:10', 'handoff.answered', { handoff_id: 'ho-0001', answer: 'accept', message: 'Sure, I can take it.' });
  event('2026-11-04', '09:00', 'handoff.decided', { handoff_id: 'ho-0001', decision: 'approve', decided_by: BOSS, note: 'Approved.' });
  call('2026-11-04', '17:00', 'handoffs.trade', { id: 'sh-1112-01', their_shift_id: 'sh-1111-02', message: 'Would you swap your Wednesday kiosk shift for my Thursday open?' });    // ho-0002, expires unanswered
  call('2026-11-05', '09:00', 'time_off.cancel', { id: 'to-0003' });
  event('2026-11-05', '14:00', 'shift.changed', { shift_id: 'sh-1113-05', change: { start: at('2026-11-13', '16:00'), end: at('2026-11-13', '20:00') }, changed_by: BOSS, reason: 'Close moved an hour later' });
  call('2026-11-06', '10:00', 'handoffs.release', { id: 'sh-1113-05', message: 'The later close runs into my evening class.' });             // ho-0003, denied
  event('2026-11-07', '09:30', 'handoff.decided', { handoff_id: 'ho-0003', decision: 'deny', decided_by: BOSS, note: 'We are short on closers that week.' });
  post('2026-11-09', WEEKS[2]);
  call('2026-11-10', '09:00', 'handoffs.pickup', { id: 'sh-1121-04' });                                                                      // ho-0004, cancelled
  call('2026-11-11', '09:00', 'handoffs.cancel', { id: 'ho-0004' });
  event('2026-11-11', '12:00', 'shift.cancelled', { shift_id: 'sh-1113-02', changed_by: BOSS, reason: 'Kiosk closed for a private event' });
  call('2026-11-12', '08:00', 'handoffs.release', { id: 'sh-1114-05', message: 'Could someone else close on Saturday?' });                   // ho-0005, expires undecided
  call('2026-11-12', '10:00', 'handoffs.pickup', { id: 'sh-1119-02' });                                                                      // ho-0006, approved
  event('2026-11-12', '16:00', 'handoff.decided', { handoff_id: 'ho-0006', decision: 'approve', decided_by: BOSS });
  call('2026-11-13', '09:00', 'handoffs.pickup', { id: 'sh-1118-05' });                                                                      // ho-0007, expires undecided
  call('2026-11-13', '18:00', 'handoffs.cover', { id: 'sh-1116-01', to_person_id: 'person-tomas' });                                         // ho-0008, cancelled
  call('2026-11-14', '08:00', 'handoffs.cancel', { id: 'ho-0008' });
  event('2026-11-15', '10:00', 'handoff.received', { handoff_id: 'ho-0009', kind: 'trade', from_person_id: 'person-luz', their_shift_id: 'sh-1121-05', your_shift_id: 'sh-1122-05', message: 'Could you close Saturday if I close Sunday?' });
  call('2026-11-15', '19:00', 'handoffs.respond', { id: 'ho-0009', answer: 'decline', message: 'Sorry, I have plans on Saturday.' });
  post('2026-11-16', WEEKS[3]);
  call('2026-11-17', '09:00', 'handoffs.trade', { id: 'sh-1205-05', their_shift_id: 'sh-1206-05', message: 'Could we swap the Saturday and Sunday closes that weekend?' });        // ho-0010, void
  call('2026-11-17', '09:30', 'time_off.request', { start: '2026-12-19', end: '2026-12-20', reason: 'Cousin\'s wedding' });                  // to-0004, denied
  event('2026-11-18', '11:00', 'time_off.decided', { time_off_id: 'to-0004', decision: 'deny', decided_by: BOSS, note: 'Two people are already off that weekend.' });
  call('2026-11-18', '12:00', 'handoffs.cover', { id: 'sh-1120-05', to_person_id: 'person-kai', message: 'Any chance you could close for me on Friday?' });                         // ho-0011, declined
  event('2026-11-18', '20:15', 'handoff.answered', { handoff_id: 'ho-0011', answer: 'decline', message: 'I can\'t that day, sorry.' });
  event('2026-11-19', '09:00', 'shift.cancelled', { shift_id: 'sh-1122-02', changed_by: BOSS, reason: 'Kiosk closed on Sunday' });
  event('2026-11-19', '10:00', 'shift.changed', { shift_id: 'sh-1206-05', change: { start: at('2026-12-06', '15:00'), end: at('2026-12-06', '19:00') }, changed_by: BOSS, reason: 'Earlier close on Sunday' });
  event('2026-11-19', '14:00', 'shift.changed', { shift_id: 'sh-1201-02', change: { assignee: null }, changed_by: BOSS, reason: 'Sam is away that week' });
  call('2026-11-20', '08:00', 'time_off.request', { start: '2026-12-24', end: '2026-12-26', reason: 'Holiday travel' });                    // to-0005, pending
  event('2026-11-20', '09:00', 'shift.cancelled', { shift_id: 'sh-1202-02', changed_by: BOSS, reason: 'Kiosk closed for repairs' });
  call('2026-11-20', '17:00', 'handoffs.release', { id: 'sh-1204-05', message: 'I would like to drop this close if someone can take it.' }); // ho-0012, waits for the manager
  call('2026-11-21', '10:00', 'handoffs.cover', { id: 'sh-1128-05', to_person_id: 'person-tomas', message: 'Could you close for me next Saturday?' });                               // ho-0013, waits for Tomas
  event('2026-11-21', '12:00', 'handoff.received', { handoff_id: 'ho-0014', kind: 'cover', from_person_id: 'person-ada', their_shift_id: 'sh-1129-01', message: 'Could you open for me on Sunday the 29th?' });
  go(CLOCK.slice(0, 10), CLOCK.slice(11, 16));
  if (app.now !== CLOCK) throw new Error('The history ends at ' + app.now + ', but fixtures/clock.json says ' + CLOCK + '.');
  return app.data;
}
const print = data => JSON.stringify(data, null, 1);

function main() {
  const file = path.resolve(__dirname, '../fixtures/minimal.json'), text = print(build()) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('fixtures/minimal.json differs from dev/build-fixture.cjs.'); process.exit(1); }
    console.log('fixtures/minimal.json matches dev/build-fixture.cjs.');
  } else {
    fs.writeFileSync(file, text);
    console.log('Wrote fixtures/minimal.json (' + text.length + ' bytes).');
  }
}

module.exports = { build, print, CLOCK, TZ, ME, BOSS, workplace, people, TEMPLATE };
if (require.main === module) main();
