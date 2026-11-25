'use strict';
// App-only business tests. They run from this package alone (no runtime
// import) and assert stored ledger state and side effects, not just replies.
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const ledger = require('../src/ledger.cjs');
const rules = require('../src/rules.cjs');
const {APP, fixture, seedValid, eventValid, recordChecks, read, seed, clone, withSeed, seatsOf, rejected} = require('./support.cjs');

const tool = name => APP + '.' + name;

test('generated contracts and package declarations agree', () => {
  assert.deepEqual(require('../dev/generate-contracts.cjs').drift(), [], 'run: node dev/generate-contracts.cjs');
  const manifest = read('app.json'), tools = read('tools.json'), policies = read('fixtures/policies.json');
  assert.deepEqual(policies.scenario.allow, tools.filter(t => t.read_only).map(t => t.name), 'scenario profile allows the read tools');
  assert.deepEqual(policies.sandbox.allow, tools.map(t => t.name), 'sandbox profile allows every tool');
  for (const t of tools) {
    assert.ok(t.name.startsWith(APP + '.'));
    assert.equal(t.inputSchema.additionalProperties, false, t.name + ' rejects unknown arguments');
    for (const [arg, schema] of Object.entries(t.inputSchema.properties)) {
      assert.ok(typeof schema.description === 'string' && schema.description.length > 20, t.name + ' explains its argument ' + arg);
    }
    if (!t.read_only) for (const key of ['expected_version', 'request_id']) assert.ok(t.inputSchema.required.includes(key), t.name + ' requires ' + key);
  }
  const readme = require('node:fs').readFileSync(require('node:path').join(__dirname, '../README.md'), 'utf8');
  for (const t of tools) assert.ok(readme.includes('| `' + t.name.slice(APP.length + 1) + '` |'), 'README documents ' + t.name);
  for (const type of manifest.event_types) assert.ok(readme.includes('| `' + type.slice(APP.length + 1) + '` |'), 'README documents ' + type);
  // The Web interface: declared files exist, and the controller calls only tools this App has.
  const gui = read('contribution/gui.json'), web = gui.extensions.find(e => e.namespace === 'pale.web').data;
  assert.equal(read('contribution/contribution.json').gui_ref, 'gui.json');
  assert.deepEqual([web.page, web.controller, gui.renderer_ref, web.status], ['gui/index.html', 'gui/src/app.js', 'gui/src/view.js', 'implemented']);
  const controller = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', web.controller), 'utf8');
  for (const file of [web.page, gui.renderer_ref]) assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', file)), file);
  const called = [...controller.matchAll(/(?:T\(|read\(|operation\(ui, [^,]+(?:\+[^,]+)*, )'([a-z]+\.[a-z_]+)'/g)].map(match => match[1]);
  assert.ok(called.length >= 12, 'the controller names its tools');
  for (const name of called) assert.ok(tools.some(t => t.name === APP + '.' + name), 'the Web controller calls a tool that does not exist: ' + name);
  assert.equal(typeof require('../gui/src/view.js').render, 'function');
  // The workflow-to-test mapping names tests that exist.
  const fs = require('node:fs'), path = require('node:path');
  const titles = fs.readdirSync(__dirname).filter(file => file.endsWith('.cjs'))
    .flatMap(file => fs.readFileSync(path.join(__dirname, file), 'utf8').match(/^test\('(?:[^'\\]|\\.)*'/gm) || [])
    .map(title => title.slice(6, -1).replace(/\\'/g, "'"));
  const mapping = readme.slice(readme.indexOf('## Workflows and their tests'), readme.indexOf('## Sources and licences'));
  const named = mapping.match(/"[^"]+"/g).map(quoted => quoted.slice(1, -1));
  assert.ok(named.length > 30 && titles.length > 80);
  for (const name of named) {
    assert.ok(titles.some(title => name.split(' ... ').every(part => title.includes(part))), 'README names a test that does not exist: ' + name);
  }
  assert.equal(read('package.json').version, manifest.version);
  assert.equal(read('schemas/state.schema.json').properties.package_version.const, manifest.version);
  const registry = read('registry.local.json');
  assert.deepEqual(registry.apps, [{app_id: APP, version: manifest.version, path: '.'}]);
  assert.equal(registry.initial_time, read('fixtures/clock.json').initial_time);
  const dataset = read('contribution/dataset.json');
  assert.deepEqual(dataset.expected_counts, {records: plugin.records(seed()).length, assets: 0}, 'dataset counts describe the packaged seed');
  assert.deepEqual(read('contribution/contribution.json').events.accepts.map(e => e.type), manifest.event_types);
});

test('the packaged seed is valid and starts in the documented situation', () => {
  const f = fixture(), data = f.data;
  assert.equal(data.account_id, 'ucr-noor');
  assert.equal(seatsOf(f, 'sec-cs240-lab1').available, 0, 'the CS240 lab the student waits for is full');
  assert.equal(seatsOf(f, 'sec-cs240-lec1').available, 7);
  const own = ledger.activeEnrollments(data, data.student.id);
  assert.deepEqual(own.map(e => e.course_id), ['crs-math221', 'crs-stat210']);
  assert.equal(ledger.credits(ledger.index(data), own), 6);
  assert.deepEqual(data.waitlist_entries.map(e => [e.occupant_ref, e.status]), [['stu-noor', 'queued'], ['synthetic-021', 'queued']]);
  assert.ok(Date.parse(f.now) >= Date.parse(data.term.registration.opens_at) && Date.parse(f.now) < Date.parse(data.term.registration.closes_at));
});

test('catalog search is a side-effect-free view of courses, sections and seats', () => {
  const f = fixture(), before = f.data;
  const all = f.call('catalog.search');
  assert.equal(all.status, 'ok');
  assert.deepEqual(all.term, {id: 'term-2027w', name: 'Winter 2027'});
  assert.deepEqual(all.courses.map(c => c.code), ['CS240', 'CS310', 'ECON101', 'HIST105', 'MATH221', 'PHYS150', 'PSYC100', 'STAT210']);
  const cs240 = all.courses[0];
  assert.deepEqual([cs240.credits, cs240.requires_lab, cs240.prerequisite_codes], [4, true, ['CS140']]);
  assert.deepEqual(cs240.sections.map(s => [s.id, s.kind, s.capacity, s.enrolled, s.held, s.available]), [
    ['sec-cs240-lec1', 'lecture', 60, 53, 0, 7], ['sec-cs240-lab1', 'lab', 12, 12, 0, 0], ['sec-cs240-lab2', 'lab', 12, 9, 0, 3]]);
  assert.deepEqual(cs240.sections[0].meetings, [{days: ['MON', 'WED'], start: '13:00', end: '14:20'}]);

  const codes = args => f.call('catalog.search', args).courses.map(c => c.code);
  assert.deepEqual(codes({query: 'data struct'}), ['CS240']);
  assert.deepEqual(codes({query: 'COMPUTER'}), ['CS240', 'CS310']);
  assert.deepEqual(codes({department: 'mathematics'}), ['MATH221']);
  assert.deepEqual(codes({query: 'no such course'}), []);
  // A course is open when at least one complete lecture/lab bundle has seats.
  assert.deepEqual(codes({open_only: true}), ['CS240', 'CS310', 'ECON101', 'HIST105', 'MATH221', 'STAT210']);
  assert.deepEqual(codes({days: ['FRI']}), ['HIST105']);
  assert.deepEqual(codes({days: ['MON', 'WED', 'FRI']}), ['CS240', 'CS310', 'ECON101', 'HIST105', 'MATH221']);
  // CS240's only Monday/Wednesday/Friday bundle uses the full lab.
  assert.deepEqual(codes({days: ['MON', 'WED', 'FRI'], open_only: true}), ['CS310', 'ECON101', 'HIST105', 'MATH221']);
  assert.deepEqual(codes({term_id: 'term-2027w', department: 'History'}), ['HIST105']);

  assert.throws(() => f.call('catalog.search', {term_id: 'term-2026f'}), {code: 'not_found'});
  assert.throws(() => f.call('catalog.search', {role: 'infra'}), /Input schema/);
  assert.throws(() => f.call('catalog.search', {days: ['FUNDAY']}), /Input schema/);
  // Totals only: no competitor identity or ledger row leaves the App.
  const text = JSON.stringify(all);
  for (const hidden of ['synthetic', 'occupant', 'enr-', 'wl-']) assert.ok(!text.includes(hidden), 'catalog must not expose ' + hidden);
  assert.deepEqual(f.data, before, 'reads never change the ledger');
});

test('enrolling commits the bundle, the seat, the credits and a receipt together', () => {
  const f = fixture(), before = f.data, seatBefore = seatsOf(f, 'sec-hist105-lec1');
  const out = f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1'], request_id: 'req-hist'});
  assert.deepEqual(out, {id: 'enr-6', receipt_id: 'rcp-7', course_id: 'crs-hist105', section_ids: ['sec-hist105-lec1'],
    credits: {enrolled: 9, limit: 16}, status: 'committed', app_id: APP, version: {epoch: 1, revision: 1}});
  const data = f.data;
  assert.deepEqual(data.enrollments.at(-1), {id: 'enr-6', seq: 6, occupant_ref: 'stu-noor', course_id: 'crs-hist105',
    section_ids: ['sec-hist105-lec1'], status: 'enrolled', enrolled_at: f.now, ended_at: null});
  assert.deepEqual(data.receipts, [{id: 'rcp-7', seq: 7, at: f.now, action: 'enrollment.enroll', request_id: 'req-hist',
    refs: {course_id: 'crs-hist105', enrollment_id: 'enr-6', section_ids: ['sec-hist105-lec1']}}]);
  assert.equal(data.counters.next_seq, 8);
  assert.equal(seatsOf(f, 'sec-hist105-lec1').enrolled, seatBefore.enrolled + 1);
  assert.equal(seatsOf(f, 'sec-hist105-lec1').available, seatBefore.available - 1);
  assert.equal(f.call('catalog.search', {department: 'History'}).courses[0].sections[0].available, seatBefore.available - 1);
  // Nothing else moved.
  for (const key of ['courses', 'sections', 'waitlist_entries', 'offers', 'notices', 'student']) assert.deepEqual(data[key], before[key]);
  assert.deepEqual(data.enrollments.slice(0, -1), before.enrollments);
});

test('a lecture and its required lab are enrolled as one bundle and credited once', () => {
  const f = fixture({data: withSeed(d => { d.enrollments = d.enrollments.filter(e => e.id !== 'enr-noor-stat210'); })});
  const out = f.call('enrollment.enroll', {section_ids: ['sec-cs240-lab2', 'sec-cs240-lec1']});
  assert.deepEqual(out.section_ids, ['sec-cs240-lec1', 'sec-cs240-lab2'], 'stored lecture first');
  assert.deepEqual(out.credits, {enrolled: 7, limit: 16}, 'MATH221 (3) + CS240 (4): the bundle counts once');
  assert.equal(seatsOf(f, 'sec-cs240-lec1').available, 6);
  assert.equal(seatsOf(f, 'sec-cs240-lab2').available, 2);
  assert.equal(f.data.enrollments.filter(e => e.course_id === 'crs-cs240' && e.occupant_ref === 'stu-noor').length, 1);
});

test('a lab linked to one lecture can only be bundled with that lecture', () => {
  // CS240 gains a second lecture; LAB 2 is linked to it alone.
  const f = fixture({data: withSeed(d => {
    d.sections.push({id: 'sec-cs240-lec2', course_id: 'crs-cs240', kind: 'lecture', label: 'LEC 2', capacity: 60, base_enrolled: 10,
      meetings: [{days: ['TUE', 'THU'], start: '08:30', end: '09:50'}], version: 1, history: []});
    d.sections.find(s => s.id === 'sec-cs240-lab2').linked_lecture_ids = ['sec-cs240-lec2'];
    d.enrollments = d.enrollments.filter(e => e.id !== 'enr-noor-stat210');
  })});
  const search = args => f.call('catalog.search', args).courses;
  const lab2 = search({query: 'data struct'})[0].sections.find(s => s.id === 'sec-cs240-lab2');
  assert.deepEqual(lab2.linked_lecture_ids, ['sec-cs240-lec2'], 'the link is visible to the Agent');
  assert.ok(!('linked_lecture_ids' in search({query: 'data struct'})[0].sections.find(s => s.id === 'sec-cs240-lab1')));
  // Without the link, LEC 1 (Mon/Wed) + LAB 2 (Tue) is an open bundle on Monday to Wednesday.
  // With it, LAB 2 only goes with LEC 2 (Tue/Thu), so no bundle fits those days.
  const hasCs240 = (source, args) => source.call('catalog.search', args).courses.some(c => c.code === 'CS240');
  const midweek = {open_only: true, days: ['MON', 'TUE', 'WED']};
  assert.equal(hasCs240(fixture(), midweek), true, 'unlinked: LEC 1 + LAB 2 qualifies');
  assert.equal(hasCs240(f, midweek), false, 'linked: LEC 1 + LAB 2 is not a bundle');
  assert.equal(hasCs240(f, {open_only: true, days: ['TUE', 'THU']}), true, 'LEC 2 + LAB 2 is open on Tuesday/Thursday');
  assert.equal(hasCs240(f, {open_only: true}), true);
  rejected(f, () => f.call('enrollment.enroll', {section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2']}), 'invalid_bundle', /LAB 2 of CS240 cannot be combined with LEC 1/);
  const out = f.call('enrollment.enroll', {section_ids: ['sec-cs240-lec2', 'sec-cs240-lab2']});
  assert.deepEqual(f.data.enrollments.at(-1).section_ids, ['sec-cs240-lec2', 'sec-cs240-lab2']);
  assert.equal(out.credits.enrolled, 7);
  assert.equal(seatsOf(f, 'sec-cs240-lec1').available, 7, 'the other lecture is untouched');
});

test('a rejected enrollment changes nothing and names the rule that failed', () => {
  const f = fixture();
  const enroll = (...section_ids) => () => f.call('enrollment.enroll', {section_ids});
  rejected(f, enroll('sec-does-not-exist'), 'not_found', /does not exist/);
  rejected(f, enroll('sec-phys150-lec1'), 'invalid_bundle', /one lecture plus one lab/);
  rejected(f, enroll('sec-cs240-lec1', 'sec-phys150-lab1'), 'invalid_bundle', /same course/);
  rejected(f, enroll('sec-math221-lec1', 'sec-math221-lec2'), 'invalid_bundle', /exactly one lecture/);
  rejected(f, enroll('sec-cs240-lab1'), 'invalid_bundle', /exactly one lecture/);
  rejected(f, enroll('sec-math221-lec2'), 'duplicate_enrollment', /requires a swap/);
  rejected(f, enroll('sec-cs310-lec1'), 'prerequisite_missing', /CS240/);
  rejected(f, enroll('sec-psyc100-lec1'), 'section_full', /sec-psyc100-lec1/);
  rejected(f, enroll('sec-econ101-lec1'), 'time_conflict', /sec-econ101-lec1 and sec-math221-lec1/);
  rejected(f, enroll('sec-cs240-lec1', 'sec-cs240-lab2'), 'time_conflict', /sec-cs240-lab2 and sec-stat210-lec1/);
  assert.throws(() => f.call('enrollment.enroll', {section_ids: []}), /Input schema/);
  assert.throws(() => f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1'], request_id: ''}), /Input schema/);
  assert.equal(f.version.revision, 0, 'no rejected call committed');
});

test('a free lecture with a full required lab takes no seat at all', () => {
  const f = fixture(), lecture = seatsOf(f, 'sec-phys150-lec1');
  assert.ok(lecture.available > 0);
  rejected(f, () => f.call('enrollment.enroll', {section_ids: ['sec-phys150-lec1', 'sec-phys150-lab1']}), 'section_full', /sec-phys150-lab1/);
  assert.deepEqual(seatsOf(f, 'sec-phys150-lec1'), lecture, 'no partial hold on the lecture');
});

test('registration windows are enforced on the supplied virtual time', () => {
  const window = seed().term.registration, target = {section_ids: ['sec-hist105-lec1']};
  const at = (now, data) => fixture({now, data});
  // A term that is only now opening has no enrollments or queues yet.
  const unopened = () => withSeed(d => { d.enrollments = []; d.waitlist_entries = []; });
  const early = at('2026-11-23T08:59:59-05:00', unopened());
  rejected(early, () => early.call('enrollment.enroll', target), 'registration_closed');
  assert.equal(at(window.opens_at, unopened()).call('enrollment.enroll', target).status, 'committed', 'open at the opening instant');
  const closing = at(window.closes_at);
  rejected(closing, () => closing.call('enrollment.enroll', target), 'registration_closed', /open from/);
  const late = at('2027-02-01T09:00:00-05:00');
  rejected(late, () => late.call('enrollment.enroll', target), 'registration_closed');
  // A course can narrow the term window.
  const narrowed = fixture({data: withSeed(d => {
    d.courses.find(c => c.code === 'HIST105').registration_window = {opens_at: '2026-11-23T09:00:00-05:00', closes_at: '2027-01-08T17:00:00-05:00'};
  })});
  rejected(narrowed, () => narrowed.call('enrollment.enroll', target), 'registration_closed', /HIST105/);
  const courses = narrowed.data.courses, open = code => rules.registrationOpen(narrowed.data, courses.find(c => c.code === code), narrowed.now);
  assert.deepEqual([open('HIST105'), open('MATH221')], [false, true], 'only the narrowed course is closed');
});

test('the credit limit applies to the resulting schedule, and every failure is reported', () => {
  const tight = fixture({data: withSeed(d => { d.student.credit_limit = 8; })});
  rejected(tight, () => tight.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1']}), 'credit_limit_exceeded', /9 credits; the limit is 8/);
  // Several rules fail: the status is the first by priority, the message lists the rest.
  rejected(tight, () => tight.call('enrollment.enroll', {section_ids: ['sec-cs310-lec1']}), 'prerequisite_missing', /\[credit_limit_exceeded\]/);
  const exact = fixture({data: withSeed(d => { d.student.credit_limit = 9; })});
  assert.deepEqual(exact.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1']}).credits, {enrolled: 9, limit: 9});
});

test('an existing conflict does not block an unrelated enrollment, but a new one is refused', () => {
  // The timetable already contains a conflict, as after a section-time change.
  const f = fixture({data: withSeed(d => {
    d.sections.find(s => s.id === 'sec-math221-lec1').meetings = [{days: ['TUE', 'THU'], start: '14:30', end: '15:50'}];
  })});
  const own = ledger.scheduleSections(ledger.index(f.data), ledger.activeEnrollments(f.data, 'stu-noor'));
  assert.deepEqual([...ledger.conflictPairs(own)], ['sec-math221-lec1|sec-stat210-lec1']);
  assert.equal(f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1']}).status, 'committed');
  rejected(f, () => f.call('enrollment.enroll', {section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2']}), 'time_conflict', /sec-cs240-lab2/);
});

test('the ledger invariants reject inconsistent data on load and after every commit', () => {
  const ctx = fixture().context;
  const invalid = (change, pattern) => {
    const data = withSeed(change);
    assert.ok(seedValid(data), 'still matches the seed schema, so the invariant is what rejects it');
    assert.throws(() => plugin.validateSeed(ctx, data), error => error.code === 'invalid_seed' && pattern.test(error.message), String(pattern));
  };
  const liveOffer = d => {
    d.sections.find(s => s.id === 'sec-cs240-lab1').capacity = 13;
    d.waitlist_entries[0].status = 'offered';
    d.offers.push({id: 'off-6', seq: 6, entry_id: 'wl-noor-cs240', held_section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1'],
      issued_at: '2027-01-10T09:30:00-05:00', expires_at: '2027-01-11T09:30:00-05:00', status: 'live', resolved_at: null});
    d.counters.next_seq = 7;
  };
  invalid(d => { d.account_id = 'ucr-nobody'; }, /binding/);
  // The owner must be a person of the binding, and one person is binding enough.
  const people = read('fixtures/binding.json');
  assert.throws(() => plugin.validateSeed({...ctx, binding: {...people, people: people.people.filter(p => p.person_id !== 'person-noor')}}, seed()),
    error => error.code === 'invalid_seed' && /binding/.test(error.message));
  plugin.validateSeed({...ctx, binding: {people: [people.people[0]], accounts: [people.accounts[0]], objects: {}}}, seed());
  invalid(d => { d.term.registration.closes_at = d.term.registration.opens_at; }, /open before it closes/);
  invalid(d => { d.term.registration.withdraw_deadline = '2027-01-22T16:59:59-05:00'; }, /cannot precede the close/);
  fixture({data: withSeed(d => { d.term.registration.withdraw_deadline = d.term.registration.closes_at; })});   // the same instant is allowed
  invalid(d => { d.courses[0].registration_window = {opens_at: '2026-12-01T09:00:00-05:00', closes_at: '2026-12-01T09:00:00-05:00'}; }, /Registration window of CS240/);
  invalid(d => { d.enrollments[1].id = d.enrollments[0].id; }, /IDs must be unique/);
  invalid(d => { d.enrollments[1].seq = d.enrollments[0].seq; }, /Sequence numbers must be unique/);
  invalid(d => { d.counters.next_seq = 5; }, /next sequence number/);
  invalid(d => { d.student.completed_courses.push(clone(d.student.completed_courses[0])); }, /listed only once/);
  invalid(d => { d.courses[1].code = d.courses[0].code; }, /codes must be unique/);
  invalid(d => { d.sections = d.sections.filter(s => s.course_id !== 'crs-cs240' || s.kind !== 'lab'); d.enrollments.pop(); d.waitlist_entries = []; }, /requires a lab/);
  invalid(d => { d.sections.find(s => s.id === 'sec-hist105-lec1').kind = 'lab'; }, /lecture section/);
  invalid(d => { d.sections[0].course_id = 'crs-missing'; }, /unknown course|lecture section/);
  // A course that keeps a lecture is still refused for a section of a course that does not exist,
  // for two sections under one label, for a lab it has no use for and for a lecture tied to lectures.
  const at = (d, id) => d.sections.find(s => s.id === id);
  invalid(d => { at(d, 'sec-math221-lec2').course_id = 'crs-missing'; }, /Section sec-math221-lec2 refers to an unknown course/);
  invalid(d => { at(d, 'sec-cs240-lab2').label = 'LAB 1'; }, /Section labels of CS240 must be unique/);
  const strayLab = d => { d.sections.push({...clone(at(d, 'sec-cs240-lab2')), id: 'sec-hist105-lab1', course_id: 'crs-hist105'}); };
  invalid(strayLab, /HIST105 has lab sections but does not require a lab/);
  invalid(d => { at(d, 'sec-math221-lec2').linked_lecture_ids = ['sec-math221-lec1']; }, /Only lab sections can be linked to lectures: sec-math221-lec2/);
  // The bundle resolver gives the same two answers by itself, should such rows ever reach it.
  assert.deepEqual(ledger.resolveBundle(ledger.index(withSeed(d => { at(d, 'sec-math221-lec2').course_id = 'crs-missing'; })), ['sec-math221-lec2']),
    {problem: 'Section sec-math221-lec2 belongs to an unknown course.'});
  assert.deepEqual(ledger.resolveBundle(ledger.index(withSeed(strayLab)), ['sec-hist105-lec1', 'sec-hist105-lab1']), {problem: 'HIST105 has no lab component.'});
  invalid(d => { d.sections[0].base_enrolled = 61; }, /background occupants/);
  invalid(d => { d.sections[0].meetings[0].end = '12:00'; }, /start before it ends/);
  // One bad meeting among good ones is enough, and a meeting of no length is bad.
  invalid(d => { d.sections[0].meetings.push({days: ['FRI'], start: '13:00', end: '13:00'}); }, /start before it ends/);
  // A section's history lists earlier versions, oldest first, each of them a valid timetable.
  const past = (version, end = '09:00') => ({version, meetings: [{days: ['MON'], start: '08:00', end}], replaced_at: '2027-01-05T08:00:00-05:00', event_id: 'evt-past-' + version});
  const history = (version, ...entries) => d => { Object.assign(d.sections[3], {version, history: entries}); };
  invalid(history(2, past(1, '08:00')), /start before it ends/);
  invalid(history(3, past(1), past(1)), /earlier versions in order/);
  invalid(history(3, past(2), past(1)), /earlier versions in order/);
  invalid(history(2, past(2)), /earlier versions in order/);
  fixture({data: withSeed(history(4, past(1), past(3)))});   // numbers may be skipped
  invalid(d => { d.sections.find(s => s.id === 'sec-cs240-lab1').linked_lecture_ids = ['sec-math221-lec1']; }, /not a lecture of its course/);
  invalid(d => { d.sections.find(s => s.id === 'sec-cs240-lab1').linked_lecture_ids = ['sec-cs240-lab2']; }, /not a lecture of its course/);
  invalid(d => { d.sections.find(s => s.id === 'sec-cs240-lab1').linked_lecture_ids = ['sec-nowhere']; }, /not a lecture of its course/);
  invalid(d => { d.enrollments[0].section_ids = ['sec-unknown']; }, /unknown section/);
  invalid(d => { d.enrollments[2].section_ids = ['sec-cs240-lec1']; }, /not a valid bundle/);
  invalid(d => { d.enrollments[0].course_id = 'crs-stat210'; }, /does not match its sections/);
  invalid(d => { d.enrollments[0].ended_at = '2027-01-05T09:00:00-05:00'; }, /end time exactly/);
  invalid(d => { Object.assign(d.enrollments[2], {status: 'withdrawn', ended_at: '2026-12-03T09:04:59-05:00'}); }, /ends before it starts/);
  fixture({data: withSeed(d => { Object.assign(d.enrollments[2], {status: 'withdrawn', ended_at: d.enrollments[2].enrolled_at}); })});   // ended the instant it began
  invalid(d => { d.enrollments.push({...clone(d.enrollments[0]), id: 'enr-dup', seq: 6, section_ids: ['sec-math221-lec2']}); d.counters.next_seq = 7; }, /one enrollment per course/);
  invalid(d => { d.sections.find(s => s.id === 'sec-cs240-lab1').capacity = 11; }, /over capacity/);
  invalid(d => { d.student.credit_limit = 5; }, /limit is 5/);
  invalid(d => { d.waitlist_entries[0].blocked_reason = 'time_conflict'; }, /derived, not stored/);
  invalid(d => { d.waitlist_entries[0].status = 'offered'; }, /without a live offer/);
  invalid(d => { d.waitlist_entries[0].ended_at = '2027-01-08T09:00:00-05:00'; }, /left the queue/);
  invalid(d => { d.waitlist_entries.push({...clone(d.waitlist_entries[0]), id: 'wl-again', seq: 6}); d.counters.next_seq = 7; }, /only once for the same bundle/);
  invalid(d => { d.waitlist_entries[0].swap_from_enrollment_id = 'enr-synthetic-017-cs240'; }, /same occupant/);
  // A waitlist entry names a bundle under the same rules as an enrollment, in whatever order it lists it.
  invalid(d => { d.waitlist_entries[1].section_ids = ['sec-cs240-lec1', 'sec-nowhere']; }, /Waitlist entry wl-synthetic-021-cs240 refers to unknown section sec-nowhere/);
  invalid(d => { d.waitlist_entries[1].section_ids = ['sec-cs240-lec1']; }, /Waitlist entry wl-synthetic-021-cs240 is not a valid bundle/);
  invalid(d => { d.waitlist_entries[1].course_id = 'crs-math221'; }, /Waitlist entry wl-synthetic-021-cs240 names a course that does not match its sections/);
  invalid(d => { d.waitlist_entries.push({...clone(d.waitlist_entries[0]), id: 'wl-again', seq: 6, section_ids: ['sec-cs240-lab1', 'sec-cs240-lec1']}); d.counters.next_seq = 7; },
    /only once for the same bundle/);
  invalid(d => { d.waitlist_entries[1].end_reason = 'left'; }, /still waiting and cannot carry an end reason/);
  // A swap still pending cannot rest on an enrollment that has ended; one that has itself ended can.
  const afterWithdrawal = entry => d => {
    Object.assign(d.enrollments[2], {status: 'withdrawn', ended_at: '2027-01-05T09:00:00-05:00'});
    Object.assign(d.waitlist_entries[1], {occupant_ref: 'synthetic-017', section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2'],
      swap_from_enrollment_id: 'enr-synthetic-017-cs240', ...entry});
  };
  invalid(afterWithdrawal({}), /Pending swap wl-synthetic-021-cs240 refers to an enrollment that is no longer held/);
  fixture({data: withSeed(afterWithdrawal({status: 'cancelled', ended_at: '2027-01-07T10:00:00-05:00', end_reason: 'source_withdrawn'}))});
  // The queue is served by sequence, so a later joiner cannot carry an earlier sequence.
  invalid(d => { d.waitlist_entries[0].joined_at = '2027-01-09T11:00:00-05:00'; }, /order they joined/);
  // Notices and receipts must point at rows that exist.
  const notice = refs => ({id: 'ntc-6', seq: 6, at: '2027-01-10T09:30:00-05:00', kind: 'offer_issued', text: 'A seat is held for you in CS240.', refs});
  const receipt = refs => ({id: 'rcp-6', seq: 6, at: '2027-01-10T09:30:00-05:00', action: 'enrollment.enroll', request_id: 'seeded-request', refs});
  const withRow = (list, row) => d => { d[list].push(row); d.counters.next_seq = 7; };
  invalid(withRow('notices', notice({course_id: 'crs-cs240', entry_id: 'wl-noor-cs240', offer_id: 'off-missing'})), /Notice ntc-6 refers to unknown offer off-missing/);
  invalid(withRow('notices', notice({section_id: 'sec-missing'})), /unknown section sec-missing/);
  invalid(withRow('notices', notice({entry_id: 'wl-missing'})), /unknown waitlist entry wl-missing/);
  invalid(withRow('receipts', receipt({enrollment_id: 'enr-missing'})), /Receipt rcp-6 refers to unknown enrollment enr-missing/);
  invalid(withRow('receipts', receipt({course_id: 'crs-missing'})), /unknown course crs-missing/);
  invalid(withRow('receipts', receipt({enrollment_id: 'enr-noor-math221', section_ids: ['sec-math221-lec1', 'sec-missing']})), /unknown section sec-missing/);
  invalid(withRow('receipts', receipt({cancelled_entry_ids: ['wl-noor-cs240', 'wl-missing']})), /unknown waitlist entry wl-missing/);
  invalid(withRow('receipts', receipt({replaced_enrollment_id: 'enr-missing'})), /Receipt rcp-6 refers to unknown enrollment enr-missing\./);
  invalid(withRow('offers', {id: 'off-6', seq: 6, entry_id: 'wl-nobody', held_section_ids: ['sec-hist105-lec1'], issued_at: '2027-01-08T09:30:00-05:00',
    expires_at: '2027-01-09T09:30:00-05:00', status: 'expired', resolved_at: '2027-01-09T09:30:00-05:00'}), /Offer off-6 refers to an unknown waitlist entry/);
  // The same rows with valid pointers load; an event ID is Core's and is not resolved.
  fixture({data: withSeed(withRow('notices', notice({event_id: 'evt-from-a-task', course_id: 'crs-cs240', entry_id: 'wl-noor-cs240'})))});
  fixture({data: withSeed(withRow('receipts', receipt({course_id: 'crs-math221', enrollment_id: 'enr-noor-math221', section_ids: ['sec-math221-lec1']})))});
  invalid(d => { liveOffer(d); d.offers[0].held_section_ids = ['sec-cs240-lab1']; }, /exactly the sections/);
  // A live offer belongs to exactly one entry, and that entry is in the offered state.
  invalid(d => { liveOffer(d); d.waitlist_entries[0].status = 'queued'; }, /exactly one waitlist entry in the offered state/);
  invalid(d => {
    liveOffer(d);
    d.sections.find(s => s.id === 'sec-cs240-lab1').capacity = 14;
    d.offers.push({...clone(d.offers[0]), id: 'off-7', seq: 7});
    d.counters.next_seq = 8;
  }, /exactly one waitlist entry in the offered state: off-7/);
  invalid(d => { liveOffer(d); d.offers[0].expires_at = d.offers[0].issued_at; }, /expire after/);
  invalid(d => { liveOffer(d); d.offers[0].resolved_at = '2027-01-10T10:00:00-05:00'; }, /resolution time/);
  invalid(d => { liveOffer(d); d.sections.find(s => s.id === 'sec-cs240-lab1').capacity = 12; }, /over capacity/);

  // In-flight state is loadable: a live offer holding seats, and a pending
  // swap that only needs the lab it does not already hold.
  const inFlight = withSeed(d => {
    liveOffer(d);
    d.enrollments.push({id: 'enr-synthetic-030-cs240', seq: 7, occupant_ref: 'synthetic-030', course_id: 'crs-cs240',
      section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2'], status: 'enrolled', enrolled_at: '2026-12-04T09:00:00-05:00', ended_at: null});
    d.waitlist_entries.push({id: 'wl-synthetic-030-swap', seq: 8, occupant_ref: 'synthetic-030', course_id: 'crs-cs240',
      section_ids: ['sec-cs240-lec1', 'sec-cs240-lab1'], swap_from_enrollment_id: 'enr-synthetic-030-cs240', status: 'queued',
      joined_at: '2027-01-08T09:00:00-05:00', ended_at: null, end_reason: null, blocked_reason: null});
    d.counters.next_seq = 9;
  });
  const f = fixture({data: inFlight});
  assert.deepEqual(seatsOf(f, 'sec-cs240-lab1'), {capacity: 13, enrolled: 12, held: 1, available: 0}, 'a live offer holds its seat');
  assert.deepEqual(ledger.netNewSectionIds(inFlight, inFlight.waitlist_entries[2]), ['sec-cs240-lab1'], 'the swap reuses the shared lecture seat');
  // The same enrollment cannot back a second pending swap.
  const second = clone(inFlight);
  second.waitlist_entries.push({...clone(second.waitlist_entries[2]), id: 'wl-synthetic-030-second', seq: 9,
    course_id: 'crs-hist105', section_ids: ['sec-hist105-lec1']});
  second.counters.next_seq = 10;
  assert.ok(seedValid(second));
  assert.throws(() => plugin.validateSeed(ctx, second), error => error.code === 'invalid_seed' && /one pending swap/.test(error.message));
  // Nor can a swap target the bundle it already holds.
  const same = clone(inFlight);
  same.waitlist_entries[2].section_ids = ['sec-cs240-lab2', 'sec-cs240-lec1'];
  assert.throws(() => plugin.validateSeed(ctx, same), error => error.code === 'invalid_seed' && /already holds/.test(error.message));
  // Checking leaves the rows exactly as they were given, in the order they were given.
  const listed = withSeed(d => { d.waitlist_entries.reverse(); d.enrollments.reverse(); }), given = clone(listed);
  plugin.validateSeed(ctx, listed);
  assert.deepEqual(listed, given);
});

test('data that the seed schema itself forbids is refused before any rule runs', () => {
  const broken = change => assert.equal(seedValid(withSeed(change)), false);
  broken(d => { delete d.courses[0].prerequisite_codes; });
  broken(d => { delete d.sections[0].capacity; });
  broken(d => { d.sections[0].meetings[0].days = ['FUNDAY']; });
  broken(d => { d.sections[0].meetings[0].start = '9:00'; });
  broken(d => { d.enrollments[0].status = 'maybe'; });
  broken(d => { d.enrollments[0].enrolled_at = '2026-12-02 10:15'; });
  broken(d => { d.enrollment_policy.queue.order = 'lottery'; });
  broken(d => { d.unexpected = true; });
  broken(d => { delete d.counters; });
});

test('business IDs stay collision-free and running data is itself a loadable seed', () => {
  // A record already uses the ID the counter would produce next.
  const f = fixture({data: withSeed(d => {
    d.enrollments[0].id = 'enr-6';
    d.enrollments = d.enrollments.filter(e => e.id !== 'enr-noor-stat210');
  })});
  const first = f.call('enrollment.enroll', {section_ids: ['sec-hist105-lec1']});
  assert.deepEqual([first.id, first.receipt_id], ['enr-7', 'rcp-8'], 'the taken ID is skipped');
  // Reload the live data as a seed, as a checkpoint would, and continue on
  // both copies: same business outcome, no reused ID.
  const reloaded = fixture({data: f.data, now: f.now});
  assert.deepEqual(reloaded.data, f.data);
  const bundle = {section_ids: ['sec-cs240-lec1', 'sec-cs240-lab2'], request_id: 'req-after-checkpoint'};
  const next = reloaded.call('enrollment.enroll', bundle);
  assert.deepEqual([next.id, next.receipt_id], ['enr-9', 'rcp-10']);
  f.call('enrollment.enroll', bundle);
  assert.deepEqual(reloaded.data, f.data, 'original and reloaded ledgers agree');
  recordChecks(reloaded.data);
  const ids = plugin.objects(reloaded.data);
  assert.equal(new Set(ids).size, ids.length);
});

// The remaining workflows are specified in their own modules.
require('./suite-boundaries.cjs');
require('./suite-reads.cjs');
require('./suite-changes.cjs');
require('./suite-waitlist.cjs');
require('./suite-events.cjs');
require('./suite-scenarios.cjs');
require('./suite-visibility.cjs');
