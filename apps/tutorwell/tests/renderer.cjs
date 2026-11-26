'use strict';
// The reviewer renderer shows what the read tools return, escapes all text, and shows no evaluator-only record.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');
const {at, history, binding, MATH, WRITING} = require('./seeds.cjs');
const view = require('../gui/src/view.js');

const T = 'tutorwell.';

test('the four views follow the read tools after bookings, a cancellation, an attendance and a report', async () => {
  const f = fixture();
  f.call(T + 'appointments.book', {slot_id: 's3', intake: {...WRITING, questions: ['Is <b>this</b> a claim & a reason?']}});
  f.call(T + 'appointments.book', {slot_id: 's1', intake: MATH});
  f.call(T + 'appointments.cancel', {appointment_id: 'apt-2'});
  f.event(require('../examples/events/appointment-attended.json'));
  f.event(require('../examples/events/report-posted.json'));
  const model = await view.collect((name, args) => f.call(name, args));
  const html = view.render(model);
  assert.deepEqual([...html.matchAll(/data-view="([a-z]+)"/g)].map(x => x[1]), view.VIEWS);
  assert.ok(html.includes('As of 2027-03-10T15:30:00-05:00 (America/New_York)'));
  assert.ok(html.includes('weekly_cap 2, cancel_cutoff_hours 12, no_show_limit 2, no_show_window_days 30, suspension_days 14'));
  for (const s of f.call(T + 'slots.list').slots) assert.ok(html.includes('<td>' + s.id + '</td><td>' + s.weekday + ' ' + s.start + '</td>'), 'Every open slot: ' + s.id);
  for (const a of f.call(T + 'appointments.list').appointments) assert.ok(html.includes('<td>' + a.id + ' (' + a.slot_id + ')</td>'), 'Every appointment: ' + a.id);
  assert.ok(html.includes('<td>cancelled at 2027-03-08T09:00:00-05:00</td>'));
  assert.ok(html.includes('Is &lt;b&gt;this&lt;/b&gt; a claim &amp; a reason?') && !html.includes('<b>this'), 'Intake text is escaped');
  assert.ok(html.includes('<td>fu-1</td><td>revise</td><td>hist-essay-2</td><td>30</td><td>2027-03-11T17:00:00-05:00</td><td>open</td>'));
  assert.ok(html.includes('Extended time (1.5x) on timed work (acc-1)</td><td>no</td>'));
  for (const hidden of ['activity_log', 'shared_without_consent', 'expected_version']) assert.ok(!html.includes(hidden), hidden);
});

test('the evaluator-only boundary: a planted marker never reaches a tool result, an error or the page', async () => {
  const seed = history(), marker = 'MARKER-EVAL-ONLY-61';
  seed.evaluator.activity_log.push({seq: 1, at: at('03-07', '12:00'), operation: T + 'appointments.book', request_id: marker, expected_version: {epoch: 1, revision: 0},
    object_id: marker, appointment_id: marker, consents: [{accommodation_id: marker, consent_to_share: false}], details: {note: marker}});
  const f = fixture({seed, binding: binding(seed)});
  const seen = [];
  for (const t of require('../tools.json').filter(x => x.read_only)) seen.push(JSON.stringify(f.call(t.name, {})));
  seen.push(JSON.stringify(f.call(T + 'reports.list', {appointment_id: 'apt-h1'})));
  // Refusals that quote the caller's IDs or list the valid ones.
  for (const [name, args] of [['appointments.book', {slot_id: marker, intake: MATH}], ['appointments.cancel', {appointment_id: marker}],
    ['appointments.update_intake', {appointment_id: marker, intake: {questions: []}}], ['followups.set_status', {followup_id: marker, status: 'done'}],
    ['reports.list', {appointment_id: marker}], ['slots.list', {tutor_id: marker}], ['tutors.list', {skill_id: marker}],
    ['appointments.book', {slot_id: 's1', intake: {...MATH, skill_ids: [marker]}}]]) {
    let error = null;
    try { f.call(T + name, args); } catch (e) { error = e; }
    assert.ok(error && error.code && error.code !== 'ERR_ASSERTION', 'Expected a business refusal for ' + name);
    // The refusal may quote the caller's own ID back; anything else would come from the evaluator-only records.
    seen.push(error.message.split(JSON.stringify(marker)).join(''));
  }
  seen.push(view.render(await view.collect((name, args) => f.call(name, args))));
  const text = seen.join('\n');
  for (const secret of [marker, 'activity_log', '"consents"', 'shared_without_consent', 'expected_version']) assert.ok(!text.includes(secret), 'Leaked: ' + secret);
});
