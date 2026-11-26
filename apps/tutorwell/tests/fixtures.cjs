'use strict';
// The two full fixtures: they rebuild byte for byte from the centre and the profiles, have the shape the proposal
// describes, and hold the facts the reference scenarios rely on, read through the Agent tools.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {fixture} = require('./harness.cjs');
const {run, profiles} = require('../scripts/build-fixtures.cjs');
const {checkAppointments} = require('../src/checker.cjs');

const T = 'tutorwell.', NOW = '2027-03-01T09:00:00-05:00';
const dir = id => path.join(__dirname, '../fixtures/students', id);
const load = (id, now = NOW) => fixture({seed: require(path.join(dir(id), 'seed.json')), binding: require(path.join(dir(id), 'binding.json')), now});

test('the fixtures match their profiles and the proposal\'s shape', () => {
  assert.deepEqual(run({check: true}).drift, []);
  assert.deepEqual(profiles().map(p => p.id), ['daniel', 'maya']);
  for (const p of profiles()) {
    const f = load(p.id);
    const services = f.call(T + 'services.list').services;
    assert.deepEqual(services.map(s => [s.id, s.skills.length]), [['math', 40], ['writing', 6]], p.id + ': Milepost\'s 40 math skills and 6 writing skills');
    const tutors = f.call(T + 'tutors.list').tutors;
    assert.equal(tutors.length, 6);
    assert.deepEqual([...new Set(tutors.map(t => t.service_id))].sort(), ['math', 'writing'], p.id + ': six tutors across both services');
    const slots = f.call(T + 'slots.list').slots;
    assert.deepEqual([slots[0].start, slots.at(-1).start], ['2027-03-01T10:00:00-05:00', '2027-03-13T11:00:00-05:00'], p.id + ': two weeks of open slots');
    assert.equal(slots.length, 39, p.id + ': 40 slots in the two weeks, one of them booked by the student');
    const list = f.call(T + 'appointments.list').appointments;
    assert.equal(list.length, 12, p.id + ': a term of twelve appointments');
    const statuses = new Set(list.map(a => a.status));
    for (const s of ['completed', 'no_show', 'cancelled', 'cancelled_by_centre', 'booked']) assert.ok(statuses.has(s), `${p.id}: has a ${s} appointment`);
    const reports = f.call(T + 'reports.list').reports;
    assert.equal(reports.length, list.filter(a => a.status === 'completed').length, p.id + ': every completed session has a report');
    assert.ok(reports.flatMap(r => r.followups).some(x => x.status === 'open') && reports.flatMap(r => r.followups).some(x => x.status === 'done'));
    const profile = f.call(T + 'profile.get');
    assert.equal(profile.suspension, null, p.id + ': not suspended at the loading time');
    assert.ok(profile.accommodations.some(a => !a.consent_to_share), p.id + ': an accommodation without consent to share');
  }
  // Accommodations with different consents: Maya consents to one of her two, Daniel to none.
  assert.deepEqual(load('maya').call(T + 'profile.get').accommodations.map(a => a.consent_to_share), [true, false]);
  assert.deepEqual(load('daniel').call(T + 'profile.get').accommodations.map(a => a.consent_to_share), [false]);
});

test('Daniel: the record behind s1 and s2', () => {
  const f = load('daniel');
  // s1: Ana's latest report names alg-7-3 next and asks him to redo problems 6 and 8 of set 7; Ana teaches it, Kofi
  // teaches alg-7-4, and the first open math slot of the week is a statistics tutor's.
  const [latest] = f.call(T + 'reports.list').reports;
  assert.deepEqual([latest.id, latest.next_focus, latest.followups.map(x => [x.id, x.kind, x.item_refs, x.status])],
    ['rep-7', 'alg-7-3', [['fu-8', 'practice', ['ps7-q6', 'ps7-q8'], 'open'], ['fu-9', 'read', ['alg-text-7-3'], 'open']]]);
  assert.deepEqual(f.call(T + 'tutors.list', {skill_id: 'alg-7-3'}).tutors.map(t => t.id), ['t-ana']);
  assert.deepEqual(f.call(T + 'tutors.list', {skill_id: 'alg-7-4'}).tutors.map(t => t.id), ['t-kofi']);
  assert.equal(f.call(T + 'slots.list', {service_id: 'math'}).slots[0].tutor_id, 't-mei');
  // s2: one no-show (11 February) in the 30-day window, and Wednesday's session with Raj.
  const g = load('daniel', '2027-03-02T21:00:00-05:00');
  assert.deepEqual(g.call(T + 'profile.get').no_shows, {in_window: 1, window_days: 30, limit: 2});
  assert.deepEqual(g.call(T + 'appointments.list', {status: 'booked'}).appointments.map(a => [a.id, a.start, a.tutor_id]), [['apt-12', '2027-03-03T10:00:00-05:00', 't-raj']]);
  // The February suspension: the no-show with January's late cancellation reached the limit; it ended before he
  // booked again (the builder refuses a booking made during a suspension).
  const [suspension] = checkAppointments(f.snapshot()).suspensions;
  assert.deepEqual([suspension.from, suspension.until, suspension.cause_appointment_id, suspension.counted],
    ['2027-02-11T09:30:00-05:00', '2027-02-25T09:30:00-05:00', 'apt-8', ['apt-3', 'apt-8']]);
});

test('Maya: the record behind s3 and s4', () => {
  const f = load('maya');
  // s3: Tuesday's writing session with Sam, booked with her lab report draft.
  const writing = f.call(T + 'appointments.list', {status: 'booked'}).appointments;
  assert.deepEqual(writing.map(a => [a.id, a.tutor_id, a.start, a.intake.draft_ref]), [['apt-12', 't-sam', '2027-03-02T18:00:00-05:00', 'bio-lab-3-v1']]);
  assert.deepEqual(f.call(T + 'reports.list').reports.flatMap(r => r.followups).filter(x => x.status === 'open').map(x => x.id), ['fu-3']);
  // s4: only Raj teaches probability; Mei teaches the first two units.
  assert.deepEqual(f.call(T + 'tutors.list', {skill_id: 'sta-3-3'}).tutors.map(t => t.id), ['t-raj']);
  assert.deepEqual(f.call(T + 'tutors.list', {skill_id: 'sta-2-4'}).tutors.map(t => t.id), ['t-mei', 't-raj']);
  assert.deepEqual(f.call(T + 'profile.get').this_week, {week_start: '2027-03-01', count: 1, weekly_cap: 2});
});

test('the builder refuses a history the centre\'s rules would not have produced', () => {
  const {build} = require('../scripts/build-fixtures.cjs');
  const daniel = change => { const p = structuredClone(profiles().find(x => x.id === 'daniel')); change(p); return () => build(p); };
  const apt = (p, id) => p.appointments.find(a => a.id === id);
  assert.throws(daniel(p => { apt(p, 'apt-10').booked_at = '2027-02-24T09:45:00-05:00'; }), /apt-10: booked while the student was suspended/);
  assert.throws(daniel(p => { apt(p, 'apt-9').start = '2027-02-13T11:00:00-05:00'; }), /apt-9: booked when the week of 2027-02-08 already had 2 appointments/);
  assert.throws(daniel(p => { apt(p, 'apt-1').start = '2027-01-18T08:00:00-05:00'; }), /apt-1: Ana Ruiz has no in_person slot on Mon at 08:00/);
  assert.throws(daniel(p => { apt(p, 'apt-4').intake.skill_ids = ['alg-7-3']; }), /apt-4: Raj Patel does not cover every intake skill/);
  assert.throws(daniel(p => { apt(p, 'apt-1').report.followups[0].done_by = 'agent'; }), /fu-1: a seeded follow-up can be done only by the student/);
  assert.throws(daniel(p => { apt(p, 'apt-2').booked_at = '2027-01-17T10:40:00-05:00'; }), /appointment IDs follow the booking order/);
  assert.doesNotThrow(daniel(() => {}));
});
