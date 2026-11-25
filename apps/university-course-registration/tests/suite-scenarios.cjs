'use strict';
// The generated scenario seeds: reproducible, valid, settled, and each one
// really contains the situation its summary describes. Loaded by business.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const ledger = require('../src/ledger.cjs');
const queue = require('../src/queue.cjs');
const generator = require('../dev/generate-fixtures.cjs');
const {root, fixture, read, seedValid, recordChecks, rejected, event} = require('./support.cjs');

const index = read('fixtures/scenarios/index.json');
const load = id => {
  const entry = index.scenarios.find(s => s.id === id);
  return fixture({data: read('fixtures/scenarios/' + entry.file), now: entry.virtual_now});
};
const preview = (f, action, args) => f.call('change.preview', {action, ...args});
const codes = result => result.failures.map(x => x.code);
const lec = code => ['sec-' + code + '-lec1'];

test('the scenario seeds are exactly what the versioned generator produces', () => {
  assert.deepEqual(generator.drift(), [], 'run: node dev/generate-fixtures.cjs');
  assert.deepEqual(index.generator, {script: 'dev/generate-fixtures.cjs', version: generator.VERSION, seed: generator.SEED});
  assert.deepEqual(fs.readdirSync(path.join(root, 'fixtures/scenarios')).sort(), ['index.json', ...index.scenarios.map(s => s.file)].sort());
  assert.deepEqual(index.scenarios.map(s => s.id), ['eligibility', 'capacity', 'credits', 'offers', 'swaps', 'timetable']);
  for (const topic of ['eligibility', 'capacity', 'credits', 'offers', 'swaps', 'timetable changes']) {
    assert.ok(index.scenarios.some(s => s.covers.includes(topic)), 'a scenario covers ' + topic);
  }
  // One university and term, about twenty courses and thirty sections, four student accounts.
  assert.deepEqual(index.catalog, {courses: 21, sections: 34});
  const accounts = read('fixtures/binding.json').accounts.map(a => a.account_id);
  assert.deepEqual([...new Set(index.scenarios.map(s => s.account_id))].sort(), accounts.slice().sort(), 'every declared account has a scenario');
  const source = read('contribution/dataset.json').sources.find(s => s.source_id === 'generated-scenarios');
  assert.deepEqual([source.kind, source.generation.tool, source.generation.tool_version, source.generation.seed],
    ['synthetic', 'dev/generate-fixtures.cjs', generator.VERSION, generator.SEED]);
});

test('every scenario seed loads, is consistent and is settled at its own clock', () => {
  const minimal = read('fixtures/minimal.json'), people = read('fixtures/binding.json');
  for (const entry of index.scenarios) {
    const data = read('fixtures/scenarios/' + entry.file), label = entry.id;
    assert.ok(seedValid(data), label + ' matches the seed schema');
    plugin.validateSeed({app_id: 'university-course-registration', role: 'infra', binding: people, virtual_now: entry.virtual_now}, data);
    recordChecks(data);
    assert.equal(plugin.records(data).length, entry.records, label + ' record count');
    assert.deepEqual([data.courses.length, data.sections.length], [21, 34], label + ' catalog size');
    assert.deepEqual([data.university, data.term, data.enrollment_policy], [minimal.university, minimal.term, minimal.enrollment_policy],
      label + ' uses the same university, term and policy as the default seed');
    assert.deepEqual([data.account_id, data.student.id], [entry.account_id, entry.student_id]);
    const owner = people.accounts.find(a => a.account_id === data.account_id);
    assert.equal(people.people.find(p => p.person_id === owner.owner_person_id).name, data.student.name, label + ' student is the bound person');
    // Dates and timezone: every instant in the university's offset, the clock inside the registration window.
    for (const stamp of JSON.stringify(data).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^"\s.]*/g)) assert.match(stamp, /-05:00$/, label + ' ' + stamp);
    assert.ok(Date.parse(entry.virtual_now) >= Date.parse(data.term.registration.opens_at) && Date.parse(entry.virtual_now) < Date.parse(data.term.registration.closes_at));
    for (const row of [...data.enrollments, ...data.notices, ...data.receipts, ...data.offers]) {
      const stamp = row.enrolled_at || row.at || row.issued_at;
      assert.ok(Date.parse(stamp) <= Date.parse(entry.virtual_now), label + ' ' + row.id + ' is not in the future');
    }
    assert.equal(ledger.aheadOfClock(data, entry.virtual_now), null, label + ' holds no record dated after its clock, so its first write is not refused for that');
    // Capacities: no section over capacity, and each unpinned one has a seat.
    // Settled: a first write or event would not hand out an offer that was already due.
    assert.deepEqual(queue.recheck({virtual_now: entry.virtual_now}, structuredClone(data)), [], label + ' has no offer waiting to be issued');
    // The seed is live data: it loads, reads cleanly and reloads unchanged.
    const f = fixture({data, now: entry.virtual_now});
    for (const name of ['catalog.search', 'record.get', 'schedule.get', 'waitlist.list', 'activity.list']) f.call(name);
    assert.deepEqual(f.data, data);
  }
  // The generated catalog contains the default seed's courses and sections with the same identity, rules and times.
  const world = read('fixtures/scenarios/eligibility.json');
  for (const course of minimal.courses) assert.deepEqual(world.courses.find(c => c.id === course.id), course);
  for (const s of minimal.sections) {
    const twin = world.sections.find(x => x.id === s.id);
    assert.deepEqual([twin.course_id, twin.kind, twin.label, twin.meetings], [s.course_id, s.kind, s.label, s.meetings], s.id);
  }
});

test('eligibility scenario: each reason a course cannot be taken is there to be found', () => {
  const f = load('eligibility'), before = f.data;
  assert.deepEqual(f.call('schedule.get').enrollments.map(e => e.code), ['MATH221', 'STAT210']);
  assert.deepEqual(codes(preview(f, 'enroll', {section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2']})), ['prerequisite_missing', 'time_conflict']);
  // Enrolled in MATH221 this term is not "completed MATH221".
  const analysis = preview(f, 'enroll', {section_ids: lec('math310')});
  assert.deepEqual([codes(analysis), analysis.failures[0].missing_prerequisites], [['prerequisite_missing'], ['MATH221']]);
  assert.deepEqual(f.call('course.get', {id: 'crs-math310'}).prerequisites, [{code: 'MATH221', completed: false}]);
  // The term is open; this course's own window is not.
  const music = f.call('course.get', {id: 'crs-musc110'});
  assert.deepEqual(music.registration, {opens_at: '2026-11-23T09:00:00-05:00', closes_at: '2027-01-15T17:00:00-05:00', open: false});
  assert.deepEqual(codes(preview(f, 'enroll', {section_ids: lec('musc110')})), ['registration_closed']);
  assert.equal(f.call('course.get', {id: 'crs-hist105'}).registration.open, true);
  // Labs tied to one lecture.
  assert.deepEqual(f.call('course.get', {id: 'crs-biol120'}).bundles.map(b => b.section_ids),
    [['sec-biol120-lec1', 'sec-biol120-lab1'], ['sec-biol120-lec2', 'sec-biol120-lab2']]);
  assert.deepEqual(codes(preview(f, 'enroll', {section_ids: ['sec-biol120-lec1', 'sec-biol120-lab2']})), ['invalid_bundle']);
  // A lecture with seats, one lab full and the other overlapping STAT210.
  assert.deepEqual(codes(preview(f, 'enroll', {section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1']})), ['section_full']);
  assert.deepEqual(preview(f, 'enroll', {section_ids: ['sec-phys150-lec1', 'sec-phys150-lab2']}).failures.map(x => [x.code, x.conflicts]),
    [['time_conflict', [['sec-phys150-lab2', 'sec-stat210-lec1']]]]);
  assert.deepEqual(codes(preview(f, 'enroll', {section_ids: lec('econ101')})), ['time_conflict']);
  // And something he can simply take.
  assert.equal(preview(f, 'enroll', {section_ids: lec('engl210')}).allowed, true);
  assert.deepEqual(f.data, before);
  assert.equal(f.call('enrollment.enroll', {section_ids: lec('engl210')}).credits.enrolled, 9);
});

test('capacity scenario: partly free bundles, a last seat and queues shared with competitors', () => {
  const f = load('capacity');
  const physics = f.call('course.get', {id: 'crs-phys150'});
  assert.ok(physics.course.sections[0].available > 0, 'the lecture has seats');
  assert.deepEqual(physics.bundles.map(b => b.available), [false, false], 'but no lab does');
  assert.deepEqual(f.call('catalog.search', {query: 'PHYS150', open_only: true}).courses, []);
  assert.equal(f.call('course.get', {id: 'crs-hist105'}).course.sections[0].available, 1);
  assert.deepEqual(f.call('course.get', {id: 'crs-engl210'}).bundles.map(b => b.available), [false, true], 'a full section with an open alternative');
  assert.deepEqual(f.call('waitlist.list').entries.map(e => [e.id, e.rank, e.blocked_by.length]), [['wl-ife-stat210', 2, 0], ['wl-ife-psyc100', 1, 0]]);
  // The competitor ahead of her is served first when a STAT210 seat appears; a PSYC100 seat comes to her.
  f.event(event('cap-1', f.now, 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-106', enrollment_id: 'enr-synthetic-106-stat210'}));
  assert.deepEqual(f.call('waitlist.list').offers, []);
  assert.equal(f.call('waitlist.list').entries[0].rank, 2);
  f.event(event('cap-2', f.now, 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-101', enrollment_id: 'enr-synthetic-101-psyc100'}));
  assert.deepEqual(f.call('waitlist.list').offers.map(o => o.entry_id), ['wl-ife-psyc100']);
  // Joining the PHYS150 queue puts her behind the two competitors already there.
  assert.equal(f.call('waitlist.join', {section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1']}).rank, 3);
});

test('credits scenario: the limit applies to the schedule that would result', () => {
  const f = load('credits');
  assert.deepEqual(f.call('record.get').credits, {enrolled: 13, limit: 15});
  assert.deepEqual(codes(preview(f, 'enroll', {section_ids: lec('hist105')})), ['credit_limit_exceeded']);
  assert.deepEqual(preview(f, 'enroll', {section_ids: lec('musc110')}).credits, {current: 13, resulting: 15, limit: 15});
  assert.equal(preview(f, 'swap', {id: 'enr-mei-stat260', section_ids: lec('hist105')}).allowed, true, 'three credits for three');
  assert.deepEqual(preview(f, 'swap', {id: 'enr-mei-phys150', section_ids: lec('hist105')}).credits, {current: 13, resulting: 12, limit: 15});
  const [english, physics] = f.call('waitlist.list').entries;
  assert.deepEqual([english.id, english.rank, english.blocked_by.map(b => b.code)], ['wl-mei-engl210', 1, ['credit_limit_exceeded']]);
  assert.deepEqual([physics.id, physics.swap_from_enrollment_id, physics.blocked_by, physics.waiting_for_section_ids],
    ['wl-mei-phys150', 'enr-mei-phys150', [], ['sec-phys150-lab1']], 'a swap adds no credits');
  // The seat she is first in line for goes past her while she is over the limit.
  f.event(event('cr-1', f.now, 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-200', enrollment_id: 'enr-synthetic-200-engl210'}));
  assert.deepEqual(f.data.offers.map(o => o.entry_id), ['wl-synthetic-201-engl210']);
  assert.deepEqual(f.call('waitlist.list').offers, []);
});

test('offers scenario: an offer about to expire, a queue behind it and a blocked entry beside a free seat', () => {
  const f = load('offers');
  const {entries, offers} = f.call('waitlist.list');
  assert.deepEqual(offers.map(o => [o.entry_id, o.held_section_ids, o.issued_at, o.expires_at, o.expired]),
    [['wl-noor-cs240', ['sec-cs240-lec1', 'sec-cs240-lab1'], '2027-01-11T09:30:00-05:00', '2027-01-12T09:30:00-05:00', false]]);
  assert.equal((Date.parse(offers[0].expires_at) - Date.parse(f.now)) / 60000, 90);
  assert.deepEqual(entries.map(e => [e.code, e.status, e.rank, e.blocked_by.map(b => b.code)]),
    [['ECON101', 'queued', 1, ['time_conflict']], ['CS240', 'offered', 1, []], ['PSYC100', 'queued', 2, []]]);
  assert.equal(f.call('course.get', {id: 'crs-econ101'}).course.sections[0].available, 1, 'the seat she is blocked from is free and unheld');
  assert.deepEqual(f.call('activity.list').notices.map(n => [n.kind, n.refs.event_id, n.refs.offer_id]), [['offer_issued', 'evt-0007', offers[0].id]]);
  assert.deepEqual(f.call('schedule.get').credits, {enrolled: 6, limit: 16}, 'nothing is enrolled by the offer');
  // Left alone, the expiry passes the bundle to the competitor behind her.
  f.event(event('evt-0015', '2027-01-12T09:30:00-05:00', 'offers.expire'));
  assert.deepEqual(f.data.offers.map(o => [o.entry_id, o.status]), [['wl-noor-cs240', 'expired'], ['wl-synthetic-021-cs240', 'live']]);
  // Accepted in time, it is hers.
  const g = load('offers');
  assert.equal(g.call('offer.accept', {id: offers[0].id}).credits.enrolled, 10);
});

test('swaps scenario: a live offer on a pending swap, a three-entry queue and three kinds of swap', () => {
  const f = load('swaps'), data = f.data;
  // The M4 continuation check needs exactly this running state.
  assert.deepEqual(data.waitlist_entries.map(e => [e.occupant_ref, e.status, e.swap_from_enrollment_id]),
    [['stu-tomas', 'offered', 'enr-tomas-phys150'], ['synthetic-401', 'queued', null], ['synthetic-402', 'queued', null]]);
  assert.deepEqual(data.offers.map(o => [o.status, o.held_section_ids, o.expires_at]), [['live', ['sec-phys150-lab1'], '2027-01-14T10:00:00-05:00']]);
  assert.deepEqual(data.receipts.map(r => [r.action, r.refs.enrollment_id]), [['waitlist.join', 'enr-tomas-phys150']]);
  const swap = f.call('schedule.get').pending_swaps[0], offer = f.call('waitlist.list').offers[0];
  assert.deepEqual([swap.from_enrollment_id, swap.status, swap.section_ids], ['enr-tomas-phys150', 'offered', ['sec-phys150-lec1', 'sec-phys150-lab1']]);
  // Immediately available, only by waiting, and not at all.
  assert.equal(preview(f, 'swap', {id: 'enr-tomas-math221', section_ids: ['sec-math221-lec2']}).allowed, true);
  assert.deepEqual(codes(preview(f, 'swap', {id: 'enr-tomas-engl210', section_ids: ['sec-engl210-lec2']})), ['section_full']);
  assert.deepEqual(codes(preview(f, 'swap', {id: 'enr-tomas-math221', section_ids: lec('math230')})), ['time_conflict']);
  rejected(f, () => f.call('waitlist.join', {section_ids: ['sec-engl210-lec2']}), 'swap_required');
  const second = f.call('waitlist.join', {section_ids: ['sec-engl210-lec2'], swap_from_enrollment_id: 'enr-tomas-engl210'});
  assert.deepEqual([second.existing, second.rank, second.blocked_by], [false, 1, []]);
  // Accepting the offer moves him to the Wednesday lab and frees the Thursday one.
  const done = f.call('offer.accept', {id: offer.id});
  assert.deepEqual([done.replaced_id, done.section_ids, done.credits], ['enr-tomas-phys150', ['sec-phys150-lec1', 'sec-phys150-lab1'], {enrolled: 10, limit: 16}]);
  assert.deepEqual(f.call('schedule.get').enrollments.map(e => e.code), ['MATH221', 'ENGL210', 'PHYS150']);
  recordChecks(f.data);
});

test('timetable scenario: a conflict made by an event, attributed to it, and repairable', () => {
  const f = load('timetable'), before = f.data;
  const schedule = f.call('schedule.get');
  assert.deepEqual(schedule.conflicts, [{section_ids: ['sec-biol120-lab1', 'sec-stat210-lec1'],
    caused_by: {event_id: 'evt-0031', section_id: 'sec-biol120-lab1', replaced_at: '2027-01-13T16:00:00-05:00', from_version: 1, to_version: 2}}]);
  assert.deepEqual(schedule.enrollments.map(e => e.code), ['BIOL120', 'ECON101', 'STAT210', 'HIST105'], 'nothing was dropped');
  const notices = f.call('activity.list').notices;
  assert.deepEqual(notices.map(n => [n.kind, n.refs.event_id, n.refs.enrollment_id, n.refs.from_version, n.refs.to_version]),
    [['section_rescheduled', 'evt-0031', 'enr-ife-biol120', 1, 2]], 'the move of a section she does not hold produced no notice');
  assert.match(notices[0].text, /BIOL120 LAB 1 now meets TUE 13:00-15:50 \(was MON 14:00-16:50\)\. It now overlaps STAT210 LEC 1/);
  assert.equal(f.call('course.get', {id: 'crs-phil140'}).course.sections[0].version, 2);
  // Three ways out, judged differently.
  const other = preview(f, 'swap', {id: 'enr-ife-biol120', section_ids: ['sec-biol120-lec2', 'sec-biol120-lab2']});
  assert.deepEqual([other.allowed, other.conflicts.resolved, other.conflicts.resulting], [true, [['sec-biol120-lab1', 'sec-stat210-lec1']], []]);
  assert.equal(preview(f, 'swap', {id: 'enr-ife-stat210', section_ids: lec('math230')}).allowed, true);
  const trade = preview(f, 'swap', {id: 'enr-ife-stat210', section_ids: ['sec-chem110-lec1', 'sec-chem110-lab1']});
  assert.deepEqual([codes(trade), trade.conflicts.introduced], [['time_conflict'], [['sec-biol120-lab1', 'sec-chem110-lab1']]]);
  // The existing overlap does not stop an unrelated enrollment.
  assert.equal(preview(f, 'enroll', {section_ids: lec('musc110')}).allowed, true);
  assert.deepEqual(f.data, before);
  f.call('enrollment.swap', {id: 'enr-ife-biol120', section_ids: ['sec-biol120-lec2', 'sec-biol120-lab2']});
  assert.deepEqual(f.call('schedule.get').conflicts, []);
});
