'use strict';
// What an Agent can know before it acts, and what no result may show.
// Loaded by business.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../src/rules.cjs');
const {APP, root, fixture, read, withSeed, section, rejected, holdingCs240, offered, EXAMPLE_EVENTS} = require('./support.cjs');

const HIST105 = {section_ids: ['sec-hist105-lec1']};
const STAT210 = {id: 'enr-noor-stat210'};
const PSYC100 = {section_ids: ['sec-psyc100-lec1']};
const OFFER = {id: 'off-6'};

// ---- rule discoverability ----------------------------------------------------
// Facts are taken from the plain reads only. change.preview is deliberately
// not used: it applies the rules itself and would make the check circular.
function known(f) {
  const catalog = f.call('catalog.search').courses, record = f.call('record.get'), schedule = f.call('schedule.get');
  const sections = new Map(catalog.flatMap(course => course.sections.map(s => [s.id, {...s, course}])));
  const course = args => sections.get(args.section_ids[0]).course;
  return {record, schedule, sections, course, detail: args => f.call('course.get', {id: course(args).id}), activity: () => f.call('activity.list'),
    waitlist: () => f.call('waitlist.list')};
}
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const overlap = (a, b) => a.days.some(d => b.days.includes(d)) && a.start < b.end && b.start < a.end;

// For each rule that can refuse a write: where the reads show that it applies.
const VISIBLE = {
  // catalog.search lists every section of the term.
  not_found: (k, args) => args.section_ids.some(id => !k.sections.has(id)),
  // schedule.get lists only enrollments that are still held; activity.list records the one given up.
  invalid_state: (k, args) => !k.schedule.enrollments.some(e => e.id === args.id)
    && k.activity().receipts.some(r => r.action === 'enrollment.withdraw' && r.refs.enrollment_id === args.id),
  // course.get lists the valid lecture/lab combinations.
  // waitlist.list shows the offers that are still open, and says when one has passed its deadline.
  offer_not_live: (k, args) => !k.waitlist().offers.some(o => o.id === args.id),
  offer_expired: (k, args) => k.waitlist().offers.some(o => o.id === args.id && o.expired),
  invalid_bundle: (k, args) => !k.detail(args).bundles.some(b => sameSet(b.section_ids, args.section_ids)),
  // The Agent cannot read the clock; time-dependent rules are shown as computed flags.
  withdrawal_closed: k => !k.record.withdrawal.open,
  registration_closed: (k, args) => !k.detail(args).registration.open,
  // Waiting for another bundle of a course already held needs the enrollment to swap from.
  swap_required: (k, args) => args.swap_from_enrollment_id === undefined && k.detail(args).enrollment_id !== null,
  pending_swap_exists: (k, args) => k.schedule.pending_swaps.some(p => p.from_enrollment_id === args.swap_from_enrollment_id),
  duplicate_enrollment: (k, args) => k.detail(args).enrollment_id !== null,
  prerequisite_missing: (k, args) => k.detail(args).prerequisites.some(p => !p.completed),
  // There is no queue for a bundle whose sections all have a seat.
  seats_available: (k, args) => args.section_ids.every(id => k.sections.get(id).available > 0),
  section_full: (k, args) => args.section_ids.some(id => k.sections.get(id).available < 1),
  credit_limit_exceeded: (k, args) => k.record.credits.enrolled + k.course(args).credits > k.record.credits.limit,
  time_conflict: (k, args) => args.section_ids.some(id => k.sections.get(id).meetings.some(m =>
    k.schedule.enrollments.some(e => e.sections.some(s => s.meetings.some(n => overlap(m, n))))))
};
// One refused write per rule, on the packaged seed unless stated.
const REFUSED = {
  not_found: {tool: 'enrollment.enroll', args: {section_ids: ['sec-geog200-lec1']}},
  invalid_state: {tool: 'enrollment.withdraw', args: STAT210, setup: f => f.call('enrollment.withdraw', STAT210)},
  offer_not_live: {tool: 'offer.accept', args: OFFER, build: () => offered(), setup: f => f.call('offer.decline', OFFER)},
  offer_expired: {tool: 'offer.accept', args: OFFER, build: () => offered(), setup: f => f.advance('2027-01-12T09:30:00-05:00')},
  invalid_bundle: {tool: 'enrollment.enroll', args: {section_ids: ['sec-cs240-lec1']}},
  withdrawal_closed: {tool: 'enrollment.withdraw', args: STAT210, now: '2027-02-19T17:00:00-05:00'},
  registration_closed: {tool: 'enrollment.enroll', args: HIST105, now: '2027-01-25T09:00:00-05:00'},
  swap_required: {tool: 'waitlist.join', args: {section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1']}, data: holdingCs240(d => { d.waitlist_entries.shift(); })},
  pending_swap_exists: {tool: 'waitlist.join', args: {...PSYC100, swap_from_enrollment_id: 'enr-noor-cs240'}, data: holdingCs240()},
  duplicate_enrollment: {tool: 'enrollment.enroll', args: {section_ids: ['sec-math221-lec2']}},
  prerequisite_missing: {tool: 'enrollment.enroll', args: {section_ids: ['sec-cs310-lec1']}},
  seats_available: {tool: 'waitlist.join', args: HIST105},
  section_full: {tool: 'enrollment.enroll', args: PSYC100},
  credit_limit_exceeded: {tool: 'enrollment.enroll', args: HIST105, data: withSeed(d => { d.student.credit_limit = 8; })},
  time_conflict: {tool: 'enrollment.enroll', args: {section_ids: ['sec-econ101-lec1']}}
};

test('every rule that can refuse a write is visible in the reads before the write is tried', () => {
  const codes = [...rules.PRIORITY].sort();
  assert.deepEqual(Object.keys(VISIBLE).sort(), codes, 'each rule has a place where the reads show it');
  assert.deepEqual(Object.keys(REFUSED).sort(), codes, 'each rule has a refused write');

  for (const code of rules.PRIORITY) {
    const {tool, args, data, now, setup, build} = REFUSED[code];
    const f = build ? build() : fixture({data, now});
    if (setup) setup(f);
    const before = f.data;
    assert.equal(VISIBLE[code](known(f), args), true, code + ' can be seen in the reads');
    assert.deepEqual(f.data, before, 'looking it up changes nothing');
    rejected(f, () => f.call(tool, args), code);
  }

  // The same lookups show nothing in the way of a change that is allowed, and that change commits.
  const allowed = [
    ['enrollment.enroll', HIST105, fixture, ['not_found', 'invalid_bundle', 'registration_closed', 'duplicate_enrollment', 'prerequisite_missing',
      'section_full', 'credit_limit_exceeded', 'time_conflict']],
    ['enrollment.withdraw', STAT210, fixture, ['invalid_state', 'withdrawal_closed']],
    ['waitlist.join', PSYC100, fixture, ['not_found', 'invalid_bundle', 'registration_closed', 'swap_required', 'pending_swap_exists', 'seats_available']],
    ['offer.accept', OFFER, offered, ['offer_not_live', 'offer_expired', 'registration_closed', 'credit_limit_exceeded']]
  ];
  assert.deepEqual([...new Set(allowed.flatMap(row => row[3]))].sort(), codes, 'every rule is also checked on a change that is allowed');
  for (const [tool, args, build, expected] of allowed) {
    const f = build(), k = known(f);
    // An acceptance is judged on the bundle its offer holds.
    const facts = tool === 'offer.accept' ? {...args, section_ids: k.waitlist().offers[0].held_section_ids} : args;
    for (const code of expected) assert.equal(VISIBLE[code](k, facts), false, code + ' is not reported for an allowed ' + tool);
    assert.equal(f.call(tool, args).status, 'committed');
  }

  // Each rule is also named where an Agent and a Task author read about the tools.
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const catalog = read('tools.json').find(t => t.name === APP + '.change.preview').outputSchema.anyOf[0].properties.failures.items.properties.code.description;
  for (const code of rules.PRIORITY) {
    assert.ok(readme.includes('`' + code + '`'), 'README names ' + code);
    assert.ok(catalog.includes(code), 'the tool catalog names ' + code);
  }
});

// ---- nothing about competitors -------------------------------------------------
test('no result names a competitor or shows a ledger row that is not the student\'s', () => {
  // One competitor is enrolled, one is queued behind the student, and a third holds a live offer.
  const data = withSeed(d => {
    section(d, 'sec-phys150-lab1').capacity += 1;
    d.waitlist_entries.push({id: 'wl-synthetic-040-phys150', seq: 6, occupant_ref: 'synthetic-040', course_id: 'crs-phys150',
      section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1'], swap_from_enrollment_id: null, status: 'offered',
      joined_at: '2027-01-08T09:00:00-05:00', ended_at: null, end_reason: null, blocked_reason: null});
    d.offers.push({id: 'off-7', seq: 7, entry_id: 'wl-synthetic-040-phys150', held_section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1'],
      issued_at: '2027-01-10T12:00:00-05:00', expires_at: '2027-01-11T12:00:00-05:00', status: 'live', resolved_at: null});
    d.counters.next_seq = 8;
  });
  const f = fixture({data}), self = data.student.id;
  // Recomputed from the stored ledger each time: competitors' rows change as the scenario runs.
  const hidden = () => {
    const now = f.data, theirEntries = now.waitlist_entries.filter(e => e.occupant_ref !== self).map(e => e.id);
    return ['synthetic', 'occupant_ref', 'base_enrolled', 'blocked_reason', ...now.enrollments.filter(e => e.occupant_ref !== self).map(e => e.id),
      ...theirEntries, ...now.offers.filter(o => theirEntries.includes(o.entry_id)).map(o => o.id)];
  };
  assert.deepEqual(hidden().slice(4), ['enr-synthetic-017-cs240', 'wl-synthetic-021-cs240', 'wl-synthetic-040-phys150', 'off-7']);
  const clean = (label, value) => {
    const text = JSON.stringify(value);
    for (const word of hidden()) assert.ok(!text.includes(word), label + ' must not expose ' + word);
    return value;
  };

  const reads = () => [
    ['catalog.search', {}], ['catalog.search', {query: 'physics', open_only: true}], ['catalog.search', {days: ['MON', 'WED', 'FRI']}],
    ...data.courses.map(c => ['course.get', {id: c.id}]),
    ['record.get', {}], ['schedule.get', {}], ['waitlist.list', {}], ['activity.list', {}],
    ['change.preview', {action: 'enroll', section_ids: ['sec-hist105-lec1']}],
    ['change.preview', {action: 'enroll', section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1']}],
    ['change.preview', {action: 'enroll', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1']}],
    ['change.preview', {action: 'withdraw', id: 'enr-noor-stat210'}],
    ['change.preview', {action: 'swap', id: 'enr-noor-stat210', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1']}]
  ].forEach(([name, args]) => clean(name + ' ' + JSON.stringify(args), f.call(name, args)));
  reads();
  // Totals are visible; whose seat it is, is not.
  const lab = f.call('course.get', {id: 'crs-phys150'}).course.sections.find(s => s.id === 'sec-phys150-lab1');
  assert.deepEqual([lab.capacity, lab.enrolled, lab.held, lab.available], [17, 16, 1, 0]);

  // Write results, and the reads again once there are receipts and history rows.
  clean('enrollment.enroll', f.call('enrollment.enroll', HIST105));
  clean('enrollment.swap', f.call('enrollment.swap', {id: 'enr-noor-math221', section_ids: ['sec-math221-lec2']}));
  clean('enrollment.withdraw', f.call('enrollment.withdraw', STAT210));
  reads();
  // Waitlist and offer writes, with competitors moving around her: a seat is freed and offered to her,
  // she declines, and it passes to the competitor behind her.
  const waiting = clean('waitlist.join', f.call('waitlist.join', PSYC100));
  f.event(EXAMPLE_EVENTS[0]);
  const offer = clean('waitlist.list', f.call('waitlist.list')).offers[0];
  clean('change.preview accept_offer', f.call('change.preview', {action: 'accept_offer', id: offer.id}));
  reads();
  clean('offer.decline', f.call('offer.decline', {id: offer.id}));
  clean('waitlist.leave', f.call('waitlist.leave', {id: waiting.id}));
  assert.deepEqual(f.data.offers.filter(o => o.status === 'live').map(o => o.entry_id), ['wl-synthetic-040-phys150', 'wl-synthetic-021-cs240']);
  assert.equal(hidden().length, 9, 'both competitors\' offers are among the rows that must stay hidden');
  reads();
  assert.deepEqual(f.call('activity.list').notices.map(n => n.kind), ['offer_issued']);

  // Naming a competitor's row is answered exactly like naming a row that does not exist.
  const mask = (value, id) => JSON.stringify(value).split(id).join('<id>');
  const refusal = (tool, args) => {
    try { f.call(tool, args); } catch (error) { return mask([error.code, error.message], args.id); }
    return 'committed';
  };
  for (const extra of [{action: 'withdraw'}, {action: 'swap', section_ids: ['sec-econ101-lec1']}]) {
    assert.equal(mask(f.call('change.preview', {...extra, id: 'enr-synthetic-017-cs240'}), 'enr-synthetic-017-cs240'),
      mask(f.call('change.preview', {...extra, id: 'enr-unknown'}), 'enr-unknown'), 'preview of ' + extra.action);
    const {action, ...args} = extra, tool = 'enrollment.' + action;
    assert.match(refusal(tool, {...args, id: 'enr-unknown'}), /^\["not_found"/);
    assert.equal(refusal(tool, {...args, id: 'enr-synthetic-017-cs240'}), refusal(tool, {...args, id: 'enr-unknown'}), tool);
  }
});

// ---- result fields the runtime reads -------------------------------------------
// The runtime's MCP audit summary reads these top-level result fields with
// meanings that belong to other Apps (a mail message, a calendar event, a
// busy list), and records a top-level id as the object the call acted on.
test('results keep clear of the fields the runtime\'s audit summary interprets', () => {
  const tools = read('tools.json');
  for (const t of tools) {
    const [success] = t.outputSchema.anyOf;
    assert.equal(success.additionalProperties, false, t.name + ' declares every result field, so none can appear unlisted');
    for (const key of ['message', 'messages', 'event', 'busy']) {
      assert.ok(!(key in success.properties), t.name + ' must not return a top-level "' + key + '"');
    }
    if (t.read_only) continue;
    // A committed write names the object it acted on and its receipt.
    for (const key of ['id', 'receipt_id']) assert.ok(success.required.includes(key), t.name + ' returns ' + key);
  }
  const f = fixture();
  const done = f.call('enrollment.enroll', HIST105);
  assert.ok(f.data.enrollments.some(e => e.id === done.id) && f.data.receipts.some(r => r.id === done.receipt_id));
});
