'use strict';
// Boundaries the workflow suites pass by: meetings that only touch, a single
// remaining seat, repeated section-time changes, a clock behind the ledger's
// own records, names no table holds, a seed that is not settled, an offer that
// outlives the close of registration. Loaded by business.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const ledger = require('../src/ledger.cjs');
const rules = require('../src/rules.cjs');
const {APP, fixture, read, seed, clone, withSeed, seatsOf, section, rejected, holdingCs240, event, EXAMPLE_EVENTS, offered, refusedEvent,
  entryOf, offerOf, enrollmentOf, recordChecks} = require('./support.cjs');

const HIST105 = {section_ids: ['sec-hist105-lec1']}, ECON101 = {section_ids: ['sec-econ101-lec1']};
const CS240_LAB1 = ['sec-cs240-lec1', 'sec-cs240-lab1'], CS240_LAB2 = ['sec-cs240-lec1', 'sec-cs240-lab2'];
const occupancy = (id, at, payload) => event(id, at, 'occupancy.change', payload);
const reschedule = (id, at, section_id, meetings) => event(id, at, 'section.reschedule', {section_id, meetings});
const meets = (days, start, end) => ({days, start, end});
const conflicts = f => f.call('schedule.get').conflicts;

test('meetings that only touch do not conflict; one overlapping minute, or one overlapping meeting among several, does', () => {
  // The student holds MATH221 on MON/WED 10:00-11:20.
  const adjacent = fixture({data: withSeed(d => {
    section(d, 'sec-econ101-lec1').meetings = [meets(['MON', 'WED'], '11:20', '12:40')];   // starts as MATH221 ends
    section(d, 'sec-hist105-lec1').meetings = [meets(['MON'], '08:40', '10:00')];          // ends as MATH221 starts
  })});
  assert.equal(adjacent.call('change.preview', {action: 'enroll', ...ECON101}).allowed, true);
  assert.equal(adjacent.call('enrollment.enroll', ECON101).status, 'committed');
  assert.equal(adjacent.call('enrollment.enroll', HIST105).status, 'committed');
  assert.deepEqual(conflicts(adjacent), [], 'back-to-back classes are not a conflict');

  for (const [id, args, meeting] of [['sec-econ101-lec1', ECON101, meets(['MON', 'WED'], '11:19', '12:40')], ['sec-hist105-lec1', HIST105, meets(['MON'], '08:40', '10:01')]]) {
    const minute = fixture({data: withSeed(d => { section(d, id).meetings = [meeting]; })});
    rejected(minute, () => minute.call('enrollment.enroll', args), 'time_conflict', new RegExp(id));
  }
  // The same times on another day do not meet at all.
  const otherDay = fixture({data: withSeed(d => { section(d, 'sec-hist105-lec1').meetings = [meets(['TUE'], '10:00', '11:20')]; })});
  assert.equal(otherDay.call('enrollment.enroll', HIST105).status, 'committed');

  // A section with several meetings conflicts as soon as one of them overlaps,
  // whichever of the two sections has the several.
  const target = fixture({data: withSeed(d => { section(d, 'sec-hist105-lec1').meetings = [meets(['FRI'], '13:00', '15:50'), meets(['WED'], '11:00', '11:50')]; })});
  rejected(target, () => target.call('enrollment.enroll', HIST105), 'time_conflict', /sec-hist105-lec1/);
  const held = fixture({data: withSeed(d => { section(d, 'sec-math221-lec1').meetings = [meets(['MON', 'WED'], '10:00', '11:20'), meets(['FRI'], '14:00', '14:50')]; })});
  rejected(held, () => held.call('enrollment.enroll', HIST105), 'time_conflict', /sec-math221-lec1/);
  const a = {meetings: [meets(['MON'], '09:00', '10:00'), meets(['THU'], '09:00', '10:00')]}, b = {meetings: [meets(['THU'], '09:59', '11:00')]};
  assert.deepEqual([ledger.sectionsConflict(a, b), ledger.sectionsConflict(b, a)], [true, true]);
  const first = meets(['MON'], '09:00', '10:00'), next = meets(['MON'], '10:00', '11:00');
  assert.deepEqual([ledger.meetingsOverlap(first, next), ledger.meetingsOverlap(next, first)], [false, false]);
});

test('a single remaining seat is a seat: it is listed as open, can be taken, and leaves nothing to wait for', () => {
  const oneLeft = () => fixture({data: withSeed(d => { section(d, 'sec-hist105-lec1').capacity = 36; })});
  const f = oneLeft(), t = f.now;
  assert.equal(seatsOf(f, 'sec-hist105-lec1').available, 1);
  assert.ok(f.call('catalog.search', {open_only: true}).courses.some(c => c.code === 'HIST105'), 'open with one seat');
  assert.deepEqual(f.call('course.get', {id: 'crs-hist105'}).bundles, [{section_ids: ['sec-hist105-lec1'], available: true}]);
  // Nobody can queue for it, the student or a competitor.
  rejected(f, () => f.call('waitlist.join', HIST105), 'seats_available');
  refusedEvent(f, occupancy('one-1', t, {change: 'waitlist_join', occupant_ref: 'synthetic-070', ...HIST105}), 'seats_available');
  // A competitor takes it; the next one finds the section full and can now wait.
  f.event(occupancy('one-2', t, {change: 'enroll', occupant_ref: 'synthetic-070', ...HIST105}));
  assert.deepEqual(seatsOf(f, 'sec-hist105-lec1'), {capacity: 36, enrolled: 36, held: 0, available: 0});
  refusedEvent(f, occupancy('one-3', t, {change: 'enroll', occupant_ref: 'synthetic-071', ...HIST105}), 'section_full');
  f.event(occupancy('one-4', t, {change: 'waitlist_join', occupant_ref: 'synthetic-071', ...HIST105}));
  assert.ok(!f.call('catalog.search', {open_only: true}).courses.some(c => c.code === 'HIST105'));
  assert.deepEqual(f.call('course.get', {id: 'crs-hist105'}).bundles, [{section_ids: ['sec-hist105-lec1'], available: false}]);
  rejected(f, () => f.call('enrollment.enroll', HIST105), 'section_full');
  // The student takes the last seat just the same.
  const g = oneLeft();
  assert.equal(g.call('enrollment.enroll', HIST105).status, 'committed');
  assert.equal(seatsOf(g, 'sec-hist105-lec1').available, 0);
  // A lecture/lab bundle with one seat left in its lab.
  const lab = fixture({data: withSeed(d => { section(d, 'sec-cs240-lab2').capacity = 10; })});
  assert.deepEqual(lab.call('course.get', {id: 'crs-cs240'}).bundles[1], {section_ids: CS240_LAB2, available: true});
  refusedEvent(lab, occupancy('one-5', lab.now, {change: 'waitlist_join', occupant_ref: 'synthetic-072', section_ids: CS240_LAB2}), 'seats_available');
});

test('the day filter keeps a course only when a whole bundle meets within the days asked for', () => {
  const codes = (f, args) => f.call('catalog.search', args).courses.map(c => c.code);
  const f = fixture();
  assert.deepEqual(codes(f, {days: ['MON']}), [], 'a MON/WED class does not fit a Monday-only week');
  assert.deepEqual(codes(f, {days: ['MON', 'WED']}), ['CS310', 'ECON101', 'MATH221']);
  assert.deepEqual(codes(f, {days: ['TUE', 'THU']}), ['MATH221', 'PSYC100', 'STAT210'], 'MATH221 through its second lecture; PHYS150 needs its Wednesday lab');
  // A section that also meets on another day is outside the filter.
  const saturday = fixture({data: withSeed(d => { section(d, 'sec-hist105-lec1').meetings.push(meets(['SAT'], '10:00', '10:50')); })});
  assert.deepEqual(codes(saturday, {days: ['FRI']}), []);
  assert.deepEqual(codes(saturday, {days: ['SAT', 'FRI']}), ['HIST105']);
});

test('a conflict is attributed to the change that created it, however many changes follow', () => {
  const MATH = 'sec-math221-lec1', STAT = 'sec-stat210-lec1', pair = [MATH, STAT];
  const at = hour => '2027-01-11T' + hour + ':00:00-05:00';
  const f = fixture();
  // e1 moves MATH221 into STAT210's time (TUE/THU 14:00-15:20): the conflict begins here.
  f.event(reschedule('e1', at(10), MATH, [meets(['TUE', 'THU'], '14:30', '15:50')]));
  const e1 = {event_id: 'e1', section_id: MATH, replaced_at: at(10), from_version: 1, to_version: 2};
  assert.deepEqual(conflicts(f), [{section_ids: pair, caused_by: e1}]);
  // e2 moves MATH221 again and e3 moves STAT210; both keep the overlap, so neither is its cause.
  f.event(reschedule('e2', at(11), MATH, [meets(['TUE'], '15:00', '15:10')]));
  assert.deepEqual(conflicts(f), [{section_ids: pair, caused_by: e1}], 'a later change of the same section does not erase the cause');
  f.event(reschedule('e3', at(12), STAT, [meets(['TUE', 'THU'], '15:00', '16:20')]));
  assert.deepEqual(conflicts(f), [{section_ids: pair, caused_by: e1}], 'nor does a later change of the other section');
  // e4 ends the overlap; e5 starts a new one, and that one is e5's.
  f.event(reschedule('e4', at(13), MATH, [meets(['FRI'], '08:00', '08:50')]));
  assert.deepEqual(conflicts(f), []);
  f.event(reschedule('e5', at(14), STAT, [meets(['FRI'], '08:30', '09:30')]));
  assert.deepEqual(conflicts(f), [{section_ids: pair, caused_by: {event_id: 'e5', section_id: STAT, replaced_at: at(14), from_version: 2, to_version: 3}}]);
  assert.deepEqual([section(f.data, MATH).history.map(h => h.event_id), section(f.data, STAT).history.map(h => h.event_id)], [['e1', 'e2', 'e4'], ['e3', 'e5']]);
  assert.deepEqual(f.data.enrollments.filter(e => e.occupant_ref === 'stu-noor').map(e => e.status), ['enrolled', 'enrolled'], 'nothing was dropped on the way');

  // An overlap the seed already had stays unattributed, whatever moves afterwards without ending it.
  const old = fixture({data: withSeed(d => { section(d, MATH).meetings = [meets(['TUE', 'THU'], '14:30', '15:50')]; })});
  assert.deepEqual(conflicts(old), [{section_ids: pair, caused_by: null}]);
  old.event(reschedule('o1', at(10), STAT, [meets(['TUE', 'THU'], '14:40', '15:00')]));
  old.event(reschedule('o2', at(11), MATH, [meets(['THU'], '14:45', '14:50')]));
  assert.deepEqual(conflicts(old), [{section_ids: pair, caused_by: null}]);

  // Both sections moved at the same instant: the cause named is the change of the pair's first section.
  const both = fixture();
  both.event(reschedule('b1', at(10), STAT, [meets(['TUE', 'THU'], '16:30', '17:30')]));
  both.event(reschedule('b2', at(10), MATH, [meets(['TUE', 'THU'], '16:00', '17:00')]));
  assert.deepEqual(conflicts(both), [{section_ids: pair, caused_by: {event_id: 'b2', section_id: MATH, replaced_at: at(10), from_version: 1, to_version: 2}}]);
  // A history whose versions skip numbers is reported with the versions it records.
  const gap = fixture({now: at(12), data: withSeed(d => {
    Object.assign(section(d, MATH), {version: 5, meetings: [meets(['TUE'], '14:00', '14:30')], history: [
      {version: 1, meetings: [meets(['MON', 'WED'], '10:00', '11:20')], replaced_at: at(10), event_id: 'g1'},
      {version: 3, meetings: [meets(['TUE'], '14:10', '14:20')], replaced_at: at(11), event_id: 'g2'}]});
  })});
  assert.deepEqual(conflicts(gap)[0].caused_by, {event_id: 'g1', section_id: MATH, replaced_at: at(10), from_version: 1, to_version: 3});
});

test('nothing is changed while the clock is behind the ledger\'s own records', () => {
  // The packaged seed's latest record is the competitor's waitlist entry.
  const LATEST = '2027-01-07T09:40:00-05:00';
  assert.equal(ledger.lastRecorded(seed()), LATEST);
  // Every kind of recorded instant counts; deadlines and term dates do not.
  const stamped = change => ledger.lastRecorded(withSeed(change));
  const LATER = '2027-01-09T12:00:00-05:00';
  assert.equal(stamped(d => { d.enrollments[0].enrolled_at = LATER; }), LATER);
  assert.equal(stamped(d => { Object.assign(d.enrollments[2], {status: 'withdrawn', ended_at: LATER}); }), LATER);
  assert.equal(stamped(d => { Object.assign(d.waitlist_entries[1], {status: 'left', ended_at: LATER, end_reason: 'left'}); }), LATER);
  assert.equal(stamped(d => { d.offers.push({issued_at: LATER, resolved_at: null, expires_at: '2027-03-01T00:00:00-05:00'}); }), LATER);
  assert.equal(stamped(d => { d.offers.push({issued_at: '2027-01-08T12:00:00-05:00', resolved_at: LATER}); }), LATER);
  assert.equal(stamped(d => { d.notices.push({at: LATER}); }), LATER);
  assert.equal(stamped(d => { d.receipts.push({at: LATER}); }), LATER);
  assert.equal(stamped(d => { d.sections[3].history.push({replaced_at: LATER}); }), LATER);
  assert.equal(stamped(d => { d.enrollments = []; d.waitlist_entries = []; }), null, 'an empty ledger records nothing');
  assert.deepEqual([ledger.aheadOfClock(seed(), '2027-01-07T09:39:59-05:00'), ledger.aheadOfClock(seed(), LATEST), ledger.aheadOfClock(seed(), '2027-01-07T14:40:00Z')],
    [LATEST, null, null], 'instants are compared, not their spelling');

  // One second short of that record: reads answer, a preview says why nothing can be done, every write is refused.
  const behind = () => fixture({now: '2027-01-07T09:39:59-05:00'});
  const f = behind(), before = f.data;
  for (const name of ['catalog.search', 'record.get', 'schedule.get', 'waitlist.list', 'activity.list']) assert.equal(f.call(name).status, 'ok');
  assert.equal(f.call('course.get', {id: 'crs-hist105'}).registration.open, true);
  for (const args of [{action: 'enroll', ...HIST105}, {action: 'withdraw', id: 'enr-noor-stat210'}, {action: 'withdraw', id: 'enr-unknown'},
    {action: 'swap', id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']}, {action: 'accept_offer', id: 'off-unknown'}]) {
    const preview = f.call('change.preview', args);
    assert.deepEqual([preview.allowed, preview.failures.map(x => x.code)], [false, ['invalid_state']], args.action + ' reports this and nothing else');
    assert.match(preview.failures[0].message, /records dated up to 2027-01-07T09:40:00-05:00.*later than the current time/);
  }
  const writes = [['enrollment.enroll', HIST105], ['enrollment.withdraw', {id: 'enr-noor-stat210'}], ['enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']}],
    ['waitlist.join', {section_ids: ['sec-psyc100-lec1']}], ['waitlist.leave', {id: 'wl-noor-cs240'}], ['offer.accept', {id: 'off-unknown'}], ['offer.decline', {id: 'off-unknown'}]];
  assert.deepEqual(writes.map(([name]) => APP + '.' + name), read('tools.json').filter(t => !t.read_only).map(t => t.name), 'every write tool');
  for (const [name, args] of writes) rejected(f, () => f.call(name, args), 'invalid_state', /Nothing can be changed until the clock reaches that instant/);
  assert.deepEqual(f.data, before);
  // An event dated before the record is refused as well; one dated at it is applied.
  refusedEvent(f, event('early-1', f.now, 'offers.expire'), 'invalid_event', /cannot be applied at an earlier time/);
  refusedEvent(f, occupancy('early-2', f.now, {change: 'withdraw', occupant_ref: 'synthetic-017', enrollment_id: 'enr-synthetic-017-cs240'}), 'invalid_event', /2027-01-07T09:40:00-05:00/);
  f.event(occupancy('on-time', LATEST, {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-synthetic-021-cs240'}));
  assert.equal(entryOf(f, 'wl-synthetic-021-cs240').ended_at, LATEST);
  // Once the clock has reached the record, the same writes go through.
  const reached = fixture({now: LATEST});
  assert.equal(reached.call('change.preview', {action: 'enroll', ...HIST105}).allowed, true);
  assert.equal(reached.call('enrollment.enroll', HIST105).status, 'committed');
  const advanced = behind();
  advanced.advance(LATEST);
  assert.equal(advanced.call('enrollment.withdraw', {id: 'enr-noor-stat210'}).status, 'committed');

  // The cases this replaces: a seed started at a clock before its history used
  // to load and then fail a later write on a ledger invariant.
  const registryClock = fixture({now: '2026-11-18T09:00:00-08:00'});
  rejected(registryClock, () => registryClock.call('enrollment.withdraw', {id: 'enr-noor-stat210'}), 'invalid_state', /later than the current time/);
  rejected(registryClock, () => registryClock.call('waitlist.join', {section_ids: ['sec-psyc100-lec1']}), 'invalid_state');
  rejected(registryClock, () => registryClock.call('enrollment.enroll', HIST105), 'invalid_state');
  // A ledger with no records has nothing for the clock to be behind.
  const empty = fixture({now: '2026-11-18T09:00:00-08:00', data: withSeed(d => { d.enrollments = []; d.waitlist_entries = []; })});
  rejected(empty, () => empty.call('enrollment.enroll', HIST105), 'registration_closed');
});

test('a name no table holds is not an operation, a change or an event', () => {
  const f = fixture(), data = f.data;
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', APP + '.constructor', APP + '.catalog.search.extra', '']) {
    assert.throws(() => plugin.handleTool(f.context, clone(data), name, {}), {code: 'unknown_tool'}, name);
  }
  const envelope = (operation, payload = {}) => ({event_id: 'odd-1', at: f.now, operation, payload});
  for (const operation of ['constructor', 'toString', '__proto__', APP + '.valueOf', APP + '.capacity.change']) {
    assert.throws(() => plugin.applyEvent(f.context, clone(data), envelope(operation)), {code: 'invalid_event'}, operation);
  }
  for (const change of ['constructor', 'toString', '__proto__', 'promote']) {
    assert.throws(() => plugin.applyEvent(f.context, clone(data), envelope(APP + '.occupancy.change', {change, occupant_ref: 'synthetic-070'})),
      error => error.code === 'invalid_event' && /does not know the change/.test(error.message), change);
  }
  // The declared names still resolve, with or without the App prefix.
  assert.deepEqual(plugin.handleTool(f.context, clone(data), 'record.get', {}).result.student.id, 'stu-noor');
  assert.deepEqual(plugin.handleTool(f.context, clone(data), APP + '.record.get', {}).result.student.id, 'stu-noor');
});

test('a refused write reports the first failed rule in the documented order, whatever order the rules ran in', () => {
  const failures = [{code: 'time_conflict', message: 'T.'}, {code: 'section_full', message: 'S.'}, {code: 'not_found', message: 'N.'}];
  assert.throws(() => rules.reject(failures), error => error.code === 'not_found' && error.message === 'N. Also: [time_conflict] T. [section_full] S.');
  assert.throws(() => rules.reject(failures.slice(0, 2)), error => error.code === 'section_full' && error.message === 'S. Also: [time_conflict] T.');
  assert.throws(() => rules.reject([failures[0]]), error => error.code === 'time_conflict' && error.message === 'T.');
  // A code the order does not list is still reported rather than lost.
  assert.throws(() => rules.reject([{code: 'unlisted', message: 'U.'}]), error => error.code === 'unlisted' && error.message === 'U.');
  // The README states the same order.
  const readme = require('node:fs').readFileSync(require('node:path').join(__dirname, '../README.md'), 'utf8');
  const stated = readme.slice(readme.indexOf('its status is the first in this order')).split('\n')[0].match(/`[a-z_]+`/g).map(code => code.slice(1, -1));
  assert.deepEqual(stated, rules.PRIORITY);
});

test('competitors meet the same edges: a name that is not theirs, a second bundle, a course they already hold', () => {
  const f = fixture({data: withSeed(d => { section(d, 'sec-cs240-lab2').capacity = 9; })}), t = f.now;
  // An event cannot reach the student's entry by naming a competitor, nor a competitor's by a wrong ID.
  refusedEvent(f, occupancy('k-1', t, {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-noor-cs240'}), 'not_found');
  refusedEvent(f, occupancy('k-2', t, {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-nobody'}), 'not_found');
  assert.deepEqual([entryOf(f, 'wl-noor-cs240').status, entryOf(f, 'wl-synthetic-021-cs240').status], ['queued', 'queued']);
  // Waiting for one bundle does not stop a competitor waiting for another that shares its lecture.
  f.event(occupancy('k-3', t, {change: 'waitlist_join', occupant_ref: 'synthetic-021', section_ids: CS240_LAB2, entry_id: 'wl-synthetic-021-lab2'}));
  assert.deepEqual(entryOf(f, 'wl-synthetic-021-lab2').section_ids, CS240_LAB2);
  // The same bundle named lab first is the same bundle.
  refusedEvent(f, occupancy('k-4', t, {change: 'waitlist_join', occupant_ref: 'synthetic-021', section_ids: ['sec-cs240-lab1', 'sec-cs240-lec1']}), 'invalid_state', /already waiting/);

  // The student is blocked (credits), so the seat freed by evt-0007 is offered to the competitor behind her.
  const start = (change = () => {}) => {
    const g = fixture({data: withSeed(d => { d.student.credit_limit = 9; change(d); })});
    g.event(EXAMPLE_EVENTS[0]);
    assert.deepEqual(g.data.offers.map(o => [o.entry_id, o.status]), [['wl-synthetic-021-cs240', 'live']]);
    return g;
  };
  // Other people's enrollments in the course, and her own in other courses, do not stand in the way of accepting.
  const busy = start(), at = EXAMPLE_EVENTS[0].at, offerId = busy.data.offers[0].id;
  busy.event(occupancy('k-5', at, {change: 'enroll', occupant_ref: 'synthetic-060', section_ids: CS240_LAB2}));
  busy.event(occupancy('k-6', at, {change: 'enroll', occupant_ref: 'synthetic-021', ...HIST105}));
  busy.event(occupancy('k-7', at, {change: 'offer_accept', occupant_ref: 'synthetic-021', offer_id: offerId}));
  assert.deepEqual(busy.data.enrollments.filter(e => e.occupant_ref === 'synthetic-021' && e.status === 'enrolled').map(e => e.course_id), ['crs-hist105', 'crs-cs240']);
  // Having enrolled in the course another way meanwhile, the competitor cannot also accept.
  const twice = start();
  twice.event(occupancy('k-8', at, {change: 'enroll', occupant_ref: 'synthetic-021', section_ids: CS240_LAB2}));
  refusedEvent(twice, occupancy('k-9', at, {change: 'offer_accept', occupant_ref: 'synthetic-021', offer_id: twice.data.offers[0].id}), 'duplicate_enrollment');
  assert.equal(offerOf(twice, twice.data.offers[0].id).status, 'live', 'the offer stays open until it is declined or expires');
  // A competitor's pending swap replaces their own enrollment in that course when accepted.
  const swapping = start(d => {
    d.enrollments.push({id: 'enr-synthetic-021-cs240', seq: 6, occupant_ref: 'synthetic-021', course_id: 'crs-cs240', section_ids: CS240_LAB2,
      status: 'enrolled', enrolled_at: '2026-12-06T09:00:00-05:00', ended_at: null});
    d.waitlist_entries[1].swap_from_enrollment_id = 'enr-synthetic-021-cs240';
    d.counters.next_seq = 7;
  });
  assert.deepEqual(swapping.data.offers[0].held_section_ids, ['sec-cs240-lab1'], 'only the lab is new to them');
  swapping.event(occupancy('k-10', at, {change: 'offer_accept', occupant_ref: 'synthetic-021', offer_id: swapping.data.offers[0].id}));
  assert.deepEqual(swapping.data.enrollments.filter(e => e.occupant_ref === 'synthetic-021').map(e => [e.section_ids, e.status]),
    [[CS240_LAB2, 'swapped_out'], [CS240_LAB1, 'enrolled']]);
  assert.deepEqual([seatsOf(swapping, 'sec-cs240-lab1').available, seatsOf(swapping, 'sec-cs240-lab2').enrolled, entryOf(swapping, 'wl-noor-cs240').status], [0, 9, 'queued']);
  assert.deepEqual(swapping.data.notices, [], 'none of this is the student\'s business');
  recordChecks(swapping.data);
});

test('offers that fall due together expire in the order they were made', () => {
  // The student waits for CS240 and for PSYC100; a seat frees in each at the same moment.
  const f = fixture({data: withSeed(d => {
    section(d, 'sec-psyc100-lec1').base_enrolled = 99;
    d.enrollments.push({id: 'enr-synthetic-090-psyc100', seq: 6, occupant_ref: 'synthetic-090', course_id: 'crs-psyc100', section_ids: ['sec-psyc100-lec1'],
      status: 'enrolled', enrolled_at: '2026-12-07T09:00:00-05:00', ended_at: null});
    d.waitlist_entries.push({id: 'wl-noor-psyc100', seq: 7, occupant_ref: 'stu-noor', course_id: 'crs-psyc100', section_ids: ['sec-psyc100-lec1'],
      swap_from_enrollment_id: null, status: 'queued', joined_at: '2027-01-08T10:00:00-05:00', ended_at: null, end_reason: null, blocked_reason: null});
    d.counters.next_seq = 8;
  })});
  const at = EXAMPLE_EVENTS[0].at;
  f.event(occupancy('due-1', at, {change: 'withdraw', occupant_ref: 'synthetic-090', enrollment_id: 'enr-synthetic-090-psyc100'}));
  f.event(EXAMPLE_EVENTS[0]);
  const [first, second] = f.data.offers, live = f.data;
  assert.deepEqual([[first.entry_id, first.expires_at], [second.entry_id, second.expires_at]],
    [['wl-noor-psyc100', '2027-01-12T09:30:00-05:00'], ['wl-noor-cs240', '2027-01-12T09:30:00-05:00']]);
  const expiredIn = g => {
    g.event(EXAMPLE_EVENTS[2]);
    assert.deepEqual([offerOf(g, first.id).status, offerOf(g, second.id).status], ['expired', 'expired']);
    const told = g.data.notices.filter(n => n.kind === 'offer_expired');
    assert.ok(told[0].seq < told[1].seq);
    return told.map(n => n.refs.offer_id);
  };
  assert.deepEqual(expiredIn(f), [first.id, second.id], 'she is told in the order the offers were made');
  // That is the order of issue, not the order the rows happen to be stored in.
  const reversed = fixture({now: at, data: {...live, offers: live.offers.slice().reverse()}});
  assert.deepEqual(reversed.data.offers.map(o => o.id), [second.id, first.id]);
  assert.deepEqual(expiredIn(reversed), [first.id, second.id]);
});

test('an offer deadline keeps the clock\'s own offset, and a long notice is cut to the stored limit', () => {
  assert.equal(ledger.plusMinutes('2027-01-11T09:30:00-05:00', 1440), '2027-01-12T09:30:00-05:00');
  assert.equal(ledger.plusMinutes('2027-01-11T14:30:00Z', 1440), '2027-01-12T14:30:00Z');
  assert.equal(ledger.plusMinutes('2027-03-13T23:30:00+05:30', 60), '2027-03-14T00:30:00+05:30');
  assert.equal(ledger.plusMinutes('2027-01-11T09:30:00.250-05:00', 90), '2027-01-11T11:00:00.250-05:00');
  // Offsets of ten hours and more, either side of UTC.
  assert.equal(ledger.plusMinutes('2027-01-11T22:30:00+10:30', 120), '2027-01-12T00:30:00+10:30');
  assert.equal(ledger.plusMinutes('2027-01-11T23:30:00-11:00', 60), '2027-01-12T00:30:00-11:00');
  assert.equal(ledger.plusMinutes('2027-01-11T09:00:00+12:45', 1440), '2027-01-12T09:00:00+12:45');
  for (const stamp of ['2027-01-11T22:30:00+10:30', '2027-01-11T23:30:00-11:00', '2027-01-11T09:00:00+12:45']) {
    assert.equal(Date.parse(ledger.plusMinutes(stamp, 1440)) - Date.parse(stamp), 86400000, stamp + ' plus a day is a day later');
  }
  // Through the App: a run whose clock is written in UTC issues a deadline in UTC, the same instant as ever.
  const utc = fixture({now: '2027-01-11T14:00:00Z'});
  utc.event({...EXAMPLE_EVENTS[0], at: '2027-01-11T14:30:00Z'});
  assert.deepEqual([utc.data.offers[0].issued_at, utc.data.offers[0].expires_at], ['2027-01-11T14:30:00Z', '2027-01-12T14:30:00Z']);
  utc.advance('2027-01-12T09:29:59-05:00');
  assert.equal(utc.call('waitlist.list').offers[0].expired, false);
  utc.advance('2027-01-12T09:30:00-05:00');
  assert.equal(utc.call('waitlist.list').offers[0].expired, true);

  // A notice is stored whole up to 500 characters and cut to exactly 500 beyond that.
  const store = text => { const data = seed(); ledger.addNotice(data, '2027-01-11T09:00:00-05:00', 'offer_issued', text, {}); return data.notices[0].text; };
  const exact = 'A' + 'b'.repeat(499), over = exact + 'c';
  assert.equal(store(exact), exact);
  assert.equal(store(over), 'A' + 'b'.repeat(496) + '...');
  // Through the App: ten meetings on every day of the week make a long sentence.
  const f = fixture(), many = Array.from({length: 10}, (_, i) => meets(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], String(8 + i).padStart(2, '0') + ':00', String(8 + i).padStart(2, '0') + ':30'));
  f.event(reschedule('long-1', '2027-01-11T10:00:00-05:00', 'sec-math221-lec1', many));
  const notice = f.data.notices[0];
  assert.equal(notice.text.length, 500);
  assert.match(notice.text, /^MATH221 LEC 1 now meets MON\/TUE\/WED\/THU\/FRI\/SAT\/SUN 08:00-08:30, .*\.\.\.$/);
  assert.deepEqual(notice.refs, {event_id: 'long-1', course_id: 'crs-math221', section_id: 'sec-math221-lec1', from_version: 1, to_version: 2, enrollment_id: 'enr-noor-math221'},
    'the refs carry the facts in full');
  assert.deepEqual(section(f.data, 'sec-math221-lec1').meetings, many, 'and the section itself holds every meeting');
});

test('waitlist.join takes an explicit null to mean an entry that is not a swap', () => {
  const PSYC100 = {section_ids: ['sec-psyc100-lec1']};
  const f = fixture(), g = fixture();
  const plain = f.call('waitlist.join', PSYC100), explicit = g.call('waitlist.join', {...PSYC100, swap_from_enrollment_id: null});
  assert.deepEqual(explicit, plain);
  assert.deepEqual(g.data, f.data);
  assert.deepEqual([explicit.swap_from_enrollment_id, explicit.existing, entryOf(g, explicit.id).swap_from_enrollment_id], [null, false, null]);
  assert.ok(!('enrollment_id' in g.data.receipts[0].refs), 'the receipt names no enrollment');
  // Joining again either way finds the same entry.
  assert.deepEqual([g.call('waitlist.join', PSYC100).existing, g.call('waitlist.join', {...PSYC100, swap_from_enrollment_id: null}).existing], [true, true]);
  assert.throws(() => f.call('waitlist.join', {...PSYC100, swap_from_enrollment_id: ''}), /Input schema/);
});

test('a competitor who has gone cannot go again, and one who leaves with an offer in hand passes the seat on', () => {
  const f = fixture();
  f.event(EXAMPLE_EVENTS[0]);   // synthetic-017 withdraws from CS240
  refusedEvent(f, {...EXAMPLE_EVENTS[0], event_id: 'gone-1', at: '2027-01-11T10:00:00-05:00'}, 'invalid_state', /enr-synthetic-017-cs240 is no longer held \(withdrawn\)/);
  assert.deepEqual([enrollmentOf(f, 'enr-synthetic-017-cs240').status, enrollmentOf(f, 'enr-synthetic-017-cs240').ended_at], ['withdrawn', EXAMPLE_EVENTS[0].at],
    'the first withdrawal stands as it was recorded');

  // An entry the scenario does not name is numbered in the waitlist's own series.
  const g = fixture();
  g.event(occupancy('gone-2', g.now, {change: 'waitlist_join', occupant_ref: 'synthetic-080', section_ids: ['sec-psyc100-lec1']}));
  assert.deepEqual(g.data.waitlist_entries.at(-1), {id: 'wl-6', seq: 6, occupant_ref: 'synthetic-080', course_id: 'crs-psyc100', section_ids: ['sec-psyc100-lec1'],
    swap_from_enrollment_id: null, status: 'queued', joined_at: g.now, ended_at: null, end_reason: null, blocked_reason: null});

  // The student is blocked (credits) and two competitors wait behind her; the first of them is offered the freed seat.
  const h = fixture({data: withSeed(d => {
    d.student.credit_limit = 9;
    d.waitlist_entries.push({...clone(d.waitlist_entries[1]), id: 'wl-synthetic-033-cs240', seq: 6, occupant_ref: 'synthetic-033', joined_at: '2027-01-08T09:00:00-05:00'});
    d.counters.next_seq = 7;
  })});
  h.event(EXAMPLE_EVENTS[0]);
  const offer = h.data.offers[0], at = EXAMPLE_EVENTS[0].at;
  assert.deepEqual([h.data.offers.length, offer.entry_id, offer.status], [1, 'wl-synthetic-021-cs240', 'live']);
  // They leave the queue instead of answering: the offer is closed with them and the seat goes to the next in line.
  h.event(occupancy('gone-3', at, {change: 'waitlist_leave', occupant_ref: 'synthetic-021', entry_id: 'wl-synthetic-021-cs240'}));
  assert.deepEqual(h.data.offers.map(o => [o.entry_id, o.status, o.resolved_at]), [['wl-synthetic-021-cs240', 'cancelled', at], ['wl-synthetic-033-cs240', 'live', null]]);
  assert.deepEqual([entryOf(h, 'wl-synthetic-021-cs240').status, entryOf(h, 'wl-synthetic-021-cs240').end_reason, entryOf(h, 'wl-synthetic-033-cs240').status,
    entryOf(h, 'wl-noor-cs240').status], ['left', 'left', 'offered', 'queued']);
  assert.deepEqual(seatsOf(h, 'sec-cs240-lab1'), {capacity: 12, enrolled: 11, held: 1, available: 0}, 'one hold, never two');
  assert.deepEqual(h.data.notices, []);
  recordChecks(h.data);
});

test('a seed that is not settled is settled by the first commit, whatever that commit is; reading does not settle it', () => {
  // A seat is free in the lab the student waits for, she is eligible, and the seed carries no offer.
  const unsettled = () => fixture({data: withSeed(d => { section(d, 'sec-cs240-lab1').capacity = 13; })});
  const pending = f => f.data.offers.map(o => [o.entry_id, o.status, o.issued_at, o.held_section_ids]);
  const due = t => [['wl-noor-cs240', 'live', t, CS240_LAB1]];
  const looked = unsettled(), t = looked.now;
  const waiting = looked.call('waitlist.list');
  assert.deepEqual([waiting.entries[0].waiting_for_section_ids, waiting.entries[0].blocked_by, waiting.offers], [[], [], []]);
  for (const [name, args] of [['catalog.search', {}], ['course.get', {id: 'crs-cs240'}], ['schedule.get', {}], ['change.preview', {action: 'enroll', ...HIST105}]]) looked.call(name, args);
  assert.deepEqual(pending(looked), [], 'no read issues an offer');
  // A write about another course altogether: enrolling, or joining another queue.
  const enrolled = unsettled();
  enrolled.call('enrollment.enroll', HIST105);
  assert.deepEqual(pending(enrolled), due(t));
  assert.deepEqual(enrolled.data.notices.map(n => [n.kind, n.refs.offer_id, 'event_id' in n.refs]), [['offer_issued', enrolled.data.offers[0].id, false]]);
  const joined = unsettled();
  const entry = joined.call('waitlist.join', {section_ids: ['sec-psyc100-lec1']});
  assert.deepEqual(pending(joined), due(t));
  assert.deepEqual(joined.call('waitlist.list').offers.map(o => o.entry_id), ['wl-noor-cs240'], 'the offer is for the seat that was free, not for the queue just joined');
  assert.equal(entryOf(joined, entry.id).status, 'queued');
  // An event with nothing of its own to do: an expiry with nothing due.
  const expired = unsettled();
  expired.event(event('settle-1', t, 'offers.expire'));
  assert.deepEqual(pending(expired), due(t));
  assert.deepEqual(expired.data.notices.map(n => [n.kind, n.refs.event_id]), [['offer_issued', 'settle-1']]);
});

test('several conflicts are listed in one order, whatever order the rows are stored in', () => {
  // MATH221, ECON101 and STAT210 all meet on Monday morning: three overlapping pairs.
  const MATH = 'sec-math221-lec1', ECON = 'sec-econ101-lec1', STAT = 'sec-stat210-lec1', HIST = 'sec-hist105-lec1';
  const crowded = change => fixture({data: withSeed(d => {
    section(d, STAT).meetings = [meets(['MON'], '10:30', '11:00')];
    d.enrollments.push({id: 'enr-noor-econ101', seq: 6, occupant_ref: 'stu-noor', course_id: 'crs-econ101', section_ids: [ECON], status: 'enrolled',
      enrolled_at: '2026-12-02T10:20:00-05:00', ended_at: null});
    d.counters.next_seq = 7;
    change(d);
  })});
  const sorted = [[ECON, MATH], [ECON, STAT], [MATH, STAT]];
  for (const f of [crowded(() => {}), crowded(d => { d.enrollments.reverse(); }), crowded(d => { d.sections.reverse(); d.enrollments.reverse(); })]) {
    assert.deepEqual(conflicts(f), sorted.map(section_ids => ({section_ids, caused_by: null})));
    const preview = f.call('change.preview', {action: 'withdraw', id: 'enr-noor-econ101'});
    assert.deepEqual([preview.conflicts.current, preview.conflicts.resulting, preview.conflicts.resolved, preview.conflicts.introduced],
      [sorted, [[MATH, STAT]], [[ECON, MATH], [ECON, STAT]], []]);
  }
  // Conflicts a change would add are listed the same way.
  const adding = fixture({data: withSeed(d => { section(d, HIST).meetings = [meets(['THU'], '14:00', '15:00'), meets(['MON'], '10:00', '11:00')]; d.enrollments.reverse(); })});
  const preview = adding.call('change.preview', {action: 'enroll', ...HIST105});
  assert.deepEqual([preview.allowed, preview.conflicts.introduced, preview.failures.map(x => [x.code, x.conflicts])],
    [false, [[HIST, MATH], [HIST, STAT]], [['time_conflict', [[HIST, MATH], [HIST, STAT]]]]]);
});

test('an offer that outlives the close of registration cannot be accepted; its seat stays held until it is declined or expires', () => {
  const ISSUED = '2027-01-22T10:00:00-05:00', CLOSE = '2027-01-22T17:00:00-05:00', DEADLINE = '2027-01-23T10:00:00-05:00';
  const start = () => {
    const f = fixture({now: ISSUED});
    f.event({...EXAMPLE_EVENTS[0], at: ISSUED});
    assert.deepEqual(f.data.offers.map(o => [o.entry_id, o.status, o.expires_at]), [['wl-noor-cs240', 'live', DEADLINE]], 'a day to answer, seven hours of registration left');
    return f;
  };
  const held = {capacity: 12, enrolled: 11, held: 1, available: 0};
  const f = start(), id = f.data.offers[0].id;
  f.advance('2027-01-22T16:59:59-05:00');
  assert.equal(f.call('change.preview', {action: 'accept_offer', id}).allowed, true, 'until the close it can be accepted');
  f.advance(CLOSE);
  // From the close on, the reads say so before anything is tried.
  const list = f.call('waitlist.list');
  assert.deepEqual([list.offers.map(o => [o.id, o.expired]), list.entries[0].blocked_by.map(b => b.code)], [[[id, false]], ['registration_closed']]);
  assert.equal(f.call('course.get', {id: 'crs-cs240'}).registration.open, false);
  assert.deepEqual(f.call('change.preview', {action: 'accept_offer', id}).failures.map(x => x.code), ['registration_closed']);
  rejected(f, () => f.call('offer.accept', {id}), 'registration_closed');
  assert.deepEqual([offerOf(f, id).status, seatsOf(f, 'sec-cs240-lab1')], ['live', held], 'the refusal neither closes the offer nor frees the seat');
  // Declining frees it. Nobody behind her can be offered a seat in a closed course.
  assert.equal(f.call('offer.decline', {id}).status, 'committed');
  assert.deepEqual([f.data.offers.map(o => [o.entry_id, o.status]), entryOf(f, 'wl-synthetic-021-cs240').status, seatsOf(f, 'sec-cs240-lab1').available],
    [[['wl-noor-cs240', 'declined']], 'queued', 1]);
  // Left alone, it is closed by the expiry event at its deadline, and she is told.
  const g = start();
  g.advance(CLOSE);
  g.event(event('late-1', DEADLINE, 'offers.expire'));
  assert.deepEqual([g.data.offers.map(o => [o.entry_id, o.status]), seatsOf(g, 'sec-cs240-lab1').available, g.data.notices.map(n => n.kind)],
    [[['wl-noor-cs240', 'expired']], 1, ['offer_issued', 'offer_expired']]);
});

test('a pending swap that gives up another course for one the student already holds is taken, blocked, and says how to put it right', () => {
  // She holds MATH221 and CS240 (LEC 1 + LAB 2); LAB 1 is full and nobody is waiting.
  const f = fixture({data: holdingCs240(d => { d.waitlist_entries = []; })});
  // Asked as a swap out of MATH221, the request is a queue entry like any other: joining does not judge eligibility.
  const wrong = f.call('waitlist.join', {section_ids: CS240_LAB1, swap_from_enrollment_id: 'enr-noor-math221'});
  assert.deepEqual([wrong.existing, wrong.rank, wrong.waiting_for_section_ids, wrong.blocked_by.map(b => b.code)], [false, 1, ['sec-cs240-lab1'], ['duplicate_enrollment']]);
  assert.deepEqual(f.call('waitlist.list').entries.map(e => [e.id, e.swap_from_enrollment_id, e.blocked_by.map(b => b.code)]), [[wrong.id, 'enr-noor-math221', ['duplicate_enrollment']]]);
  assert.deepEqual(f.call('schedule.get').pending_swaps.map(p => [p.entry_id, p.from_enrollment_id]), [[wrong.id, 'enr-noor-math221']]);
  // While it stands, the same bundle cannot be queued for as the swap it should have been; the refusal names the entry to leave.
  rejected(f, () => f.call('waitlist.join', {section_ids: CS240_LAB1, swap_from_enrollment_id: 'enr-noor-cs240'}), 'invalid_state',
    new RegExp('through entry ' + wrong.id + ', a pending swap from enr-noor-math221\\. Leave that entry before joining as a swap from enr-noor-cs240'));
  // A seat frees: the blocked entry is passed over and holds nothing.
  f.event(EXAMPLE_EVENTS[0]);
  assert.deepEqual([f.data.offers, entryOf(f, wrong.id).status, seatsOf(f, 'sec-cs240-lab1').available], [[], 'queued', 1]);
  // Leaving it and swapping the CS240 enrollment itself is the way through; both enrollments she started with are intact until then.
  assert.equal(f.call('waitlist.leave', {id: wrong.id}).status, 'committed');
  const swapped = f.call('enrollment.swap', {id: 'enr-noor-cs240', section_ids: CS240_LAB1});
  assert.deepEqual([swapped.replaced_id, enrollmentOf(f, 'enr-noor-math221').status, enrollmentOf(f, 'enr-noor-cs240').status, enrollmentOf(f, swapped.id).section_ids],
    ['enr-noor-cs240', 'enrolled', 'swapped_out', CS240_LAB1]);

  // Queued for the right way from the start, the same request is not blocked.
  const g = fixture({data: holdingCs240(d => { d.waitlist_entries = []; })});
  const right = g.call('waitlist.join', {section_ids: CS240_LAB1, swap_from_enrollment_id: 'enr-noor-cs240'});
  assert.deepEqual([right.waiting_for_section_ids, right.blocked_by], [['sec-cs240-lab1'], []]);
});
