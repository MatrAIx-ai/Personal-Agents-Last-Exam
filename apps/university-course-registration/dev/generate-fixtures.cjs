#!/usr/bin/env node
'use strict';
// Versioned generator for the scenario seeds in fixtures/scenarios/.
//
//   node dev/generate-fixtures.cjs          write the six seeds and index.json
//   node dev/generate-fixtures.cjs --check  compare only; exit 1 on drift
//
// Every seed is synthetic. A scenario is a hand-written starting ledger on a
// shared fictional catalog, followed by a short history that is applied through
// this App's own handlers (the same code an Agent tool call or an Infra event
// runs), so offers, holds, notices and receipts in a seed are exactly what the
// App would have produced. Background occupancy comes from a fixed-seed
// generator, so the output is reproducible byte for byte.
//
// It only ever writes inside this package, and nothing at run time uses it.
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const ledger = require('../src/ledger.cjs');
const queue = require('../src/queue.cjs');
const {compile} = require('../tests/schema-validator.cjs');

const VERSION = '1.0.0';
const SEED = 20270111;
const root = path.resolve(__dirname, '..');
const APP = require('../app.json').app_id;
const base = require('../fixtures/minimal.json');
const binding = require('../fixtures/binding.json');
const OFFSET = '-05:00';
const at = (day, time) => '2027-01-' + String(day).padStart(2, '0') + 'T' + time + ':00' + OFFSET;

// ---- deterministic randomness ------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the catalog: 21 courses, 34 sections --------------------------------------
const DAYS = {M: 'MON', T: 'TUE', W: 'WED', R: 'THU', F: 'FRI'};
const meet = (days, start, end) => [{days: days.split('').map(d => DAYS[d]), start, end}];
const lec = (n, days, start, end, capacity) => ({kind: 'lecture', n, meetings: meet(days, start, end), capacity});
const lab = (n, days, start, end, capacity, lectures) => ({kind: 'lab', n, meetings: meet(days, start, end), capacity, lectures});
const CATALOG = [
  ['CS240', 'Data Structures', 'Computer Science', 4, ['CS140'], [lec(1, 'MW', '13:00', '14:20', 60), lab(1, 'F', '09:00', '10:50', 12), lab(2, 'T', '14:00', '15:50', 12)]],
  ['CS250', 'Computer Organization', 'Computer Science', 3, ['CS140'], [lec(1, 'TR', '10:00', '11:20', 50)]],
  ['CS310', 'Design and Analysis of Algorithms', 'Computer Science', 3, ['CS240'], [lec(1, 'MW', '15:00', '16:20', 40)]],
  ['CS330', 'Database Systems', 'Computer Science', 3, ['CS240'], [lec(1, 'TR', '13:00', '14:20', 45)]],
  ['CS360', 'Software Engineering', 'Computer Science', 4, ['CS240'], [lec(1, 'MW', '09:00', '10:20', 40), lab(1, 'R', '15:00', '16:50', 20)]],
  ['MATH221', 'Linear Algebra', 'Mathematics', 3, ['MATH121'], [lec(1, 'MW', '10:00', '11:20', 45), lec(2, 'TR', '08:30', '09:50', 45)]],
  ['MATH230', 'Discrete Mathematics', 'Mathematics', 3, ['MATH120'], [lec(1, 'TR', '11:30', '12:50', 50)]],
  ['MATH310', 'Real Analysis', 'Mathematics', 3, ['MATH221'], [lec(1, 'MW', '14:30', '15:50', 35)]],
  ['STAT210', 'Probability', 'Statistics', 3, ['MATH120'], [lec(1, 'TR', '14:00', '15:20', 50)]],
  ['STAT260', 'Statistical Methods', 'Statistics', 3, ['STAT210'], [lec(1, 'MW', '11:30', '12:50', 40)]],
  ['PHYS150', 'Mechanics', 'Physics', 4, ['MATH120'], [lec(1, 'TR', '10:00', '11:20', 90), lab(1, 'W', '15:00', '17:50', 16), lab(2, 'R', '15:00', '17:50', 16)]],
  ['PHYS250', 'Electromagnetism', 'Physics', 4, ['PHYS150'], [lec(1, 'MW', '13:00', '14:20', 60), lab(1, 'F', '13:00', '15:50', 16)]],
  ['CHEM110', 'General Chemistry', 'Chemistry', 4, [], [lec(1, 'MWF', '09:00', '09:50', 120), lab(1, 'T', '13:00', '15:50', 18), lab(2, 'R', '13:00', '15:50', 18)]],
  // Each BIOL120 lab belongs to one lecture.
  ['BIOL120', 'Cell Biology', 'Biology', 4, ['CHEM110'], [lec(1, 'TR', '08:30', '09:50', 70), lec(2, 'TR', '16:00', '17:20', 70),
    lab(1, 'M', '14:00', '16:50', 18, [1]), lab(2, 'W', '14:00', '16:50', 18, [2])]],
  ['ECON101', 'Principles of Microeconomics', 'Economics', 3, [], [lec(1, 'MW', '10:30', '11:50', 120)]],
  ['ECON210', 'Intermediate Microeconomics', 'Economics', 3, ['ECON101'], [lec(1, 'TR', '13:00', '14:20', 60)]],
  ['HIST105', 'World History Since 1500', 'History', 3, [], [lec(1, 'F', '13:00', '15:50', 80)]],
  ['PSYC100', 'Introduction to Psychology', 'Psychology', 3, [], [lec(1, 'TR', '16:00', '17:20', 100)]],
  ['PHIL140', 'Logic and Reasoning', 'Philosophy', 3, [], [lec(1, 'MW', '16:30', '17:50', 60)]],
  ['ENGL210', 'Technical Writing', 'English', 3, ['ENGL100'], [lec(1, 'TR', '11:30', '12:50', 30), lec(2, 'MW', '08:30', '09:50', 30)]],
  ['MUSC110', 'Music Appreciation', 'Music', 2, [], [lec(1, 'R', '18:00', '19:50', 40)]]
];
const courseId = code => 'crs-' + code.toLowerCase();
const sectionId = (code, kind, n) => 'sec-' + code.toLowerCase() + '-' + (kind === 'lecture' ? 'lec' : 'lab') + n;

// Sections not pinned by a scenario are between half and nine-tenths full and always have a seat.
function catalog(random) {
  const courses = [], sections = [];
  for (const [code, title, department, credits, prerequisite_codes, list] of CATALOG) {
    courses.push({id: courseId(code), code, title, department, credits, prerequisite_codes, requires_lab: list.some(s => s.kind === 'lab')});
    for (const s of list) {
      sections.push({
        id: sectionId(code, s.kind, s.n), course_id: courseId(code), kind: s.kind, label: (s.kind === 'lecture' ? 'LEC ' : 'LAB ') + s.n,
        capacity: s.capacity, base_enrolled: Math.min(s.capacity - 1, Math.floor(s.capacity * (0.5 + 0.4 * random()))),
        ...(s.lectures ? {linked_lecture_ids: s.lectures.map(n => sectionId(code, 'lecture', n))} : {}),
        meetings: s.meetings, version: 1, history: []
      });
    }
  }
  return {courses, sections};
}

// ---- the four interchangeable student accounts ---------------------------------
const done = (code, title, credits, term, grade) => ({code, title, credits, term, grade});
const STUDENTS = {
  noor: {account_id: 'ucr-noor', owner_person_id: 'person-noor', student: base.student},
  tomas: {account_id: 'ucr-tomas', owner_person_id: 'person-tomas', student: {id: 'stu-tomas', name: 'Tomas Lindqvist', program: 'BSc Mathematics', credit_limit: 16,
    completed_courses: [done('MATH120', 'Calculus I', 3, 'Fall 2025', 'A'), done('ENGL100', 'Academic Writing', 3, 'Fall 2025', 'B+'),
      done('PHIL101', 'Introduction to Philosophy', 3, 'Fall 2025', 'A-'), done('MATH121', 'Calculus II', 3, 'Winter 2026', 'A-')]}},
  ife: {account_id: 'ucr-ife', owner_person_id: 'person-ife', student: {id: 'stu-ife', name: 'Ife Adeyemi', program: 'BSc Biology', credit_limit: 17,
    completed_courses: [done('BIOL101', 'Foundations of Biology', 4, 'Fall 2025', 'A-'), done('MATH120', 'Calculus I', 3, 'Fall 2025', 'B'),
      done('ENGL100', 'Academic Writing', 3, 'Winter 2026', 'A'), done('CHEM110', 'General Chemistry', 4, 'Fall 2026', 'B+')]}},
  mei: {account_id: 'ucr-mei', owner_person_id: 'person-mei', student: {id: 'stu-mei', name: 'Mei Tanaka', program: 'BA Economics', credit_limit: 15,
    completed_courses: [done('ECON101', 'Principles of Microeconomics', 3, 'Fall 2025', 'A'), done('MATH120', 'Calculus I', 3, 'Fall 2025', 'B+'),
      done('ENGL100', 'Academic Writing', 3, 'Winter 2026', 'B'), done('MATH121', 'Calculus II', 3, 'Winter 2026', 'B'),
      done('STAT210', 'Probability', 3, 'Fall 2026', 'A-')]}}
};

// ---- scenario builder ------------------------------------------------------------
// rows(api) writes the starting ledger; history(api) then runs events and the
// student's own writes through the App, each at a stated time.
function build(spec, index) {
  const who = STUDENTS[spec.account], self = who.student.id;
  const world = catalog(mulberry32(SEED + index));
  let data = {
    account_id: who.account_id, owner_person_id: who.owner_person_id, university: base.university, term: base.term,
    enrollment_policy: base.enrollment_policy, student: who.student, courses: world.courses, sections: world.sections,
    enrollments: [], waitlist_entries: [], offers: [], notices: [], receipts: [], counters: {next_seq: 1}
  };
  const section = id => {
    const found = data.sections.find(s => s.id === id);
    if (!found) throw new Error(spec.id + ': unknown section ' + id);
    return found;
  };
  const bundle = ids => ({course_id: section(ids[0]).course_id, section_ids: ids});
  const seq = () => data.counters.next_seq++;
  const free = new Map();
  let requests = 0, clock = null;
  const ctx = now => ({app_id: APP, role: 'agent', binding, virtual_now: now});
  const tick = now => {
    if (clock !== null && Date.parse(now) < Date.parse(clock)) throw new Error(spec.id + ': history must be in time order (' + now + ')');
    clock = now;
  };
  const rows = {
    self,
    // After the starting rows are in, the section has exactly this many seats left.
    free(id, seats) { section(id); free.set(id, seats); },
    window(code, opens_at, closes_at) { data.courses.find(c => c.code === code).registration_window = {opens_at, closes_at}; },
    enrolled(id, occupant, ids, enrolled_at) {
      data.enrollments.push({id, seq: seq(), occupant_ref: occupant, ...bundle(ids), status: 'enrolled', enrolled_at, ended_at: null});
    },
    // A scenario states whether a competitor's entry is blocked; the student's own reason is always derived.
    waiting(id, occupant, ids, joined_at, {swap_from = null, blocked = null} = {}) {
      data.waitlist_entries.push({id, seq: seq(), occupant_ref: occupant, ...bundle(ids), swap_from_enrollment_id: swap_from, status: 'queued',
        joined_at, ended_at: null, end_reason: null, blocked_reason: blocked});
    }
  };
  const history = {
    self,
    event(event_id, now, operation, payload = {}) {
      tick(now);
      data = plugin.applyEvent({...ctx(now), role: 'infra'}, data, {event_id, at: now, operation: APP + '.' + operation, payload});
    },
    call(now, tool, args) {
      tick(now);
      const out = plugin.handleTool(ctx(now), data, APP + '.' + tool,
        {...args, request_id: spec.id + '-seed-' + (++requests), expected_version: {epoch: 1, revision: 0}});
      data = out.data;
      return out.result;
    }
  };
  spec.rows(rows);
  // Background occupancy: whatever leaves the pinned number of seats.
  const table = ledger.seats(data);
  for (const [id, seats] of free) {
    const s = section(id), named = table.get(id).enrolled - s.base_enrolled + table.get(id).held;
    s.base_enrolled = s.capacity - named - seats;
    if (s.base_enrolled < 0) throw new Error(spec.id + ': ' + id + ' cannot have ' + seats + ' free seats with ' + named + ' named occupants');
  }
  if (spec.history) spec.history(history);
  if (clock !== null && Date.parse(spec.now) < Date.parse(clock)) throw new Error(spec.id + ': the scenario clock precedes its own history');
  return data;
}

// ---- the six scenarios -------------------------------------------------------------
const cs240 = n => ['sec-cs240-lec1', 'sec-cs240-lab' + n], phys150 = n => ['sec-phys150-lec1', 'sec-phys150-lab' + n];
const biol120 = n => ['sec-biol120-lec' + n, 'sec-biol120-lab' + n];
const SCENARIOS = [
  {
    id: 'eligibility', account: 'tomas', now: at(18, '09:00'), covers: ['eligibility'],
    summary: 'What the student may take, and why not: missing prerequisites (including a course he is only enrolled in this term), a course '
      + 'whose own registration window has closed, labs tied to one lecture, a required lab that is full, and sections that would overlap his timetable.',
    rows(a) {
      a.enrolled('enr-tomas-math221', a.self, ['sec-math221-lec1'], '2026-12-01T09:12:00-05:00');
      a.enrolled('enr-tomas-stat210', a.self, ['sec-stat210-lec1'], '2026-12-01T09:14:00-05:00');
      a.window('MUSC110', '2026-11-23T09:00:00-05:00', at(15, '17:00'));
      a.free('sec-phys150-lab1', 0);
      a.free('sec-biol120-lab2', 0);
    }
  },
  {
    id: 'capacity', account: 'ife', now: at(11, '09:00'), covers: ['capacity', 'offers'],
    summary: 'Full sections, bundles that are only partly free and queues with competitors: a lecture with seats whose labs are all full, a last '
      + 'seat, a full section with an open alternative, and the student second in a three-entry queue and first in another.',
    rows(a) {
      a.enrolled('enr-ife-biol120', a.self, biol120(1), '2026-12-02T10:01:00-05:00');
      a.enrolled('enr-ife-econ101', a.self, ['sec-econ101-lec1'], '2026-12-02T10:04:00-05:00');
      a.enrolled('enr-synthetic-101-psyc100', 'synthetic-101', ['sec-psyc100-lec1'], '2026-12-03T11:20:00-05:00');
      a.enrolled('enr-synthetic-106-stat210', 'synthetic-106', ['sec-stat210-lec1'], '2026-12-03T11:45:00-05:00');
      a.waiting('wl-synthetic-104-phys150', 'synthetic-104', phys150(1), at(4, '09:30'));
      a.waiting('wl-synthetic-102-stat210', 'synthetic-102', ['sec-stat210-lec1'], at(5, '10:15'));
      a.waiting('wl-ife-stat210', a.self, ['sec-stat210-lec1'], at(5, '14:40'));
      a.waiting('wl-synthetic-105-phys150', 'synthetic-105', phys150(1), at(6, '08:50'));
      a.waiting('wl-ife-psyc100', a.self, ['sec-psyc100-lec1'], at(6, '16:05'));
      a.waiting('wl-synthetic-103-stat210', 'synthetic-103', ['sec-stat210-lec1'], at(7, '12:00'));
      for (const id of ['sec-psyc100-lec1', 'sec-stat210-lec1', 'sec-phys150-lab1', 'sec-phys150-lab2', 'sec-engl210-lec1', 'sec-biol120-lec2']) a.free(id, 0);
      a.free('sec-hist105-lec1', 1);
      a.free('sec-engl210-lec2', 6);
    }
  },
  {
    id: 'credits', account: 'mei', now: at(11, '09:00'), covers: ['credits', 'swaps'],
    summary: 'Thirteen of fifteen credits in use: a three-credit course does not fit, a two-credit course does, and a swap is judged on the '
      + 'credits after the old bundle is replaced. The student is first in a queue but blocked by the limit, with an eligible competitor behind '
      + 'her; her pending lab swap adds no credits and is not blocked.',
    rows(a) {
      a.enrolled('enr-mei-econ210', a.self, ['sec-econ210-lec1'], '2026-12-01T13:30:00-05:00');
      a.enrolled('enr-mei-stat260', a.self, ['sec-stat260-lec1'], '2026-12-01T13:33:00-05:00');
      a.enrolled('enr-mei-math221', a.self, ['sec-math221-lec2'], '2026-12-01T13:36:00-05:00');
      a.enrolled('enr-mei-phys150', a.self, phys150(2), '2026-12-04T08:55:00-05:00');
      a.enrolled('enr-synthetic-200-engl210', 'synthetic-200', ['sec-engl210-lec1'], '2026-12-05T09:10:00-05:00');
      a.waiting('wl-mei-engl210', a.self, ['sec-engl210-lec1'], at(5, '09:00'));
      a.waiting('wl-synthetic-201-engl210', 'synthetic-201', ['sec-engl210-lec1'], at(6, '10:30'));
      a.waiting('wl-mei-phys150', a.self, phys150(1), at(7, '15:20'), {swap_from: 'enr-mei-phys150'});
      a.window('MUSC110', '2026-11-23T09:00:00-05:00', at(15, '17:00'));
      a.free('sec-engl210-lec1', 0);
      a.free('sec-phys150-lab1', 0);
    }
  },
  {
    id: 'offers', account: 'noor', now: at(12, '08:00'), covers: ['offers'],
    summary: 'A seat offer that expires in ninety minutes. A competitor left CS240 the day before (evt-0007); the student was offered the bundle '
      + 'and has not answered, and another competitor waits behind her. She is second in the PSYC100 queue. She is first in the ECON101 queue and '
      + 'a seat there has been free for days (evt-0003), but that entry is blocked: ECON101 overlaps her MATH221 lecture.',
    rows(a) {
      a.enrolled('enr-noor-math221', a.self, ['sec-math221-lec1'], '2026-12-02T10:15:00-05:00');
      a.enrolled('enr-noor-stat210', a.self, ['sec-stat210-lec1'], '2026-12-02T10:17:00-05:00');
      a.enrolled('enr-synthetic-017-cs240', 'synthetic-017', cs240(1), '2026-12-03T09:05:00-05:00');
      a.enrolled('enr-synthetic-302-econ101', 'synthetic-302', ['sec-econ101-lec1'], '2026-12-03T09:40:00-05:00');
      a.waiting('wl-noor-econ101', a.self, ['sec-econ101-lec1'], at(4, '09:10'));
      a.waiting('wl-synthetic-301-psyc100', 'synthetic-301', ['sec-psyc100-lec1'], at(5, '08:45'));
      a.waiting('wl-noor-cs240', a.self, cs240(1), at(6, '11:00'));
      a.waiting('wl-synthetic-021-cs240', 'synthetic-021', cs240(1), at(7, '09:40'));
      a.waiting('wl-noor-psyc100', a.self, ['sec-psyc100-lec1'], at(7, '13:25'));
      a.free('sec-cs240-lab1', 0);
      a.free('sec-cs240-lec1', 7);
      a.free('sec-psyc100-lec1', 0);
      a.free('sec-econ101-lec1', 0);
    },
    history(h) {
      // ECON101 overlaps her MATH221 lecture: when a seat came free her entry was skipped, and it holds nothing.
      h.event('evt-0003', at(8, '10:00'), 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-302', enrollment_id: 'enr-synthetic-302-econ101'});
      h.event('evt-0007', at(11, '09:30'), 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-017', enrollment_id: 'enr-synthetic-017-cs240'});
    }
  },
  {
    id: 'swaps', account: 'tomas', now: at(13, '12:00'), covers: ['swaps', 'offers'],
    summary: 'Changing sections without losing a place. The student holds PHYS150 with the Thursday lab and has a pending swap to the Wednesday '
      + 'lab, for which a seat is on offer until the next morning; two competitors wait behind him for the same lab. One of his lectures can be '
      + 'swapped at once, another only by waiting, and one cross-course swap would create a conflict.',
    rows(a) {
      a.enrolled('enr-tomas-math221', a.self, ['sec-math221-lec1'], '2026-12-01T09:12:00-05:00');
      a.enrolled('enr-tomas-engl210', a.self, ['sec-engl210-lec1'], '2026-12-01T09:14:00-05:00');
      a.enrolled('enr-tomas-phys150', a.self, phys150(2), '2026-12-04T10:30:00-05:00');
      a.enrolled('enr-synthetic-400-phys150', 'synthetic-400', phys150(1), '2026-12-04T11:00:00-05:00');
      a.free('sec-phys150-lab1', 0);
      a.free('sec-engl210-lec2', 0);
      a.free('sec-math221-lec2', 9);
    },
    history(h) {
      // He asked for the swap himself, so the seed carries his receipt; two competitors joined behind him.
      h.call(at(8, '09:00'), 'waitlist.join', {section_ids: phys150(1), swap_from_enrollment_id: 'enr-tomas-phys150'});
      h.event('evt-0016', at(9, '14:10'), 'occupancy.change', {change: 'waitlist_join', occupant_ref: 'synthetic-401', section_ids: phys150(1), entry_id: 'wl-synthetic-401-phys150'});
      h.event('evt-0018', at(10, '08:20'), 'occupancy.change', {change: 'waitlist_join', occupant_ref: 'synthetic-402', section_ids: phys150(1), entry_id: 'wl-synthetic-402-phys150'});
      h.event('evt-0021', at(13, '10:00'), 'occupancy.change', {change: 'withdraw', occupant_ref: 'synthetic-400', enrollment_id: 'enr-synthetic-400-phys150'});
    }
  },
  {
    id: 'timetable', account: 'ife', now: at(14, '09:00'), covers: ['timetable changes', 'swaps'],
    summary: 'A timetable broken by the university, not by the student. Her BIOL120 lab was moved onto her STAT210 lecture the afternoon before '
      + '(evt-0031); both enrollments stand and the overlap is attributed to the event. The other lecture/lab pair of BIOL120 has seats, one '
      + 'replacement for STAT210 is clean and another would only trade the conflict for a new one. A section she does not hold also moved.',
    rows(a) {
      a.enrolled('enr-ife-biol120', a.self, biol120(1), '2026-12-02T10:01:00-05:00');
      a.enrolled('enr-ife-econ101', a.self, ['sec-econ101-lec1'], '2026-12-02T10:04:00-05:00');
      a.enrolled('enr-ife-stat210', a.self, ['sec-stat210-lec1'], '2026-12-02T10:06:00-05:00');
      a.enrolled('enr-ife-hist105', a.self, ['sec-hist105-lec1'], '2026-12-09T15:45:00-05:00');
      a.free('sec-biol120-lec2', 2);
      a.free('sec-biol120-lab2', 1);
    },
    history(h) {
      h.event('evt-0028', at(12, '11:00'), 'section.reschedule', {section_id: 'sec-phil140-lec1', meetings: meet('TR', '16:30', '17:50')});
      h.event('evt-0031', at(13, '16:00'), 'section.reschedule', {section_id: 'sec-biol120-lab1', meetings: meet('T', '13:00', '15:50')});
    }
  }
];

// ---- output, with the checks the proposal asks of the fixtures -----------------------
const text = data => '{\n' + Object.entries(data).map(([key, value]) => '  ' + JSON.stringify(key) + ': '
  + (Array.isArray(value) && value.length ? '[\n' + value.map(row => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]' : JSON.stringify(value))).join(',\n') + '\n}\n';

function verify(spec, data) {
  const problem = message => { throw new Error('Scenario ' + spec.id + ': ' + message); };
  const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
  if (!seedValid(data)) problem('does not match the seed schema');
  plugin.validateSeed({app_id: APP, role: 'infra', binding, virtual_now: spec.now}, data);   // sections, bundles, capacities, credits, references
  if (plugin.records(data).length !== plugin.objects(data).length) problem('records and objects disagree');
  // Prerequisites name a course of this catalog or one a student can have completed elsewhere.
  const known = new Set([...data.courses.map(c => c.code), ...Object.values(STUDENTS).flatMap(s => s.student.completed_courses.map(c => c.code))]);
  for (const course of data.courses) for (const code of course.prerequisite_codes) if (!known.has(code)) problem(course.code + ' requires unknown ' + code);
  // Every instant is written in the university's fixed offset.
  const stamps = JSON.stringify(data).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g) || [];
  for (const stamp of stamps) if (!stamp.endsWith(OFFSET)) problem('timestamp ' + stamp + ' is not in ' + OFFSET);
  // No record is dated after the scenario's clock: the App refuses every change while its clock is behind its records.
  const ahead = ledger.aheadOfClock(data, spec.now);
  if (ahead !== null) problem('holds a record dated ' + ahead + ', after its clock ' + spec.now);
  // Settled: nothing in the queue could be offered a seat at the scenario's clock.
  const probe = JSON.parse(JSON.stringify(data));
  if (queue.recheck({virtual_now: spec.now}, probe).length) problem('a queued entry could be offered a seat at ' + spec.now + '; the seed is not settled');
  return data;
}

function outputs() {
  const built = SCENARIOS.map((spec, index) => ({spec, data: verify(spec, build(spec, index))}));
  const index = {
    description: 'Scenario seeds for University Course Registration. Each file is a complete seed: load it with env.load_seed as data, together '
      + 'with fixtures/binding.json, fixtures/policies.json and the scenario\'s virtual_now, and without a bundle. All records are synthetic.',
    generator: {script: 'dev/generate-fixtures.cjs', version: VERSION, seed: SEED},
    catalog: {courses: CATALOG.length, sections: CATALOG.reduce((n, course) => n + course[5].length, 0)},
    scenarios: built.map(({spec, data}) => ({
      id: spec.id, file: spec.id + '.json', account_id: data.account_id, student_id: data.student.id, virtual_now: spec.now,
      covers: spec.covers, summary: spec.summary, records: plugin.records(data).length
    }))
  };
  return [
    ...built.map(({spec, data}) => ({file: 'fixtures/scenarios/' + spec.id + '.json', text: text(data)})),
    {file: 'fixtures/scenarios/index.json', text: JSON.stringify(index, null, 2) + '\n'}
  ];
}

function drift() {
  return outputs().filter(o => {
    const file = path.join(root, o.file);
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== o.text;
  }).map(o => o.file);
}

module.exports = {VERSION, SEED, CATALOG, SCENARIOS, outputs, drift};

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const changed = drift();
    if (changed.length) {
      console.error('Scenario seed drift: ' + changed.join(', ') + '. Run: node dev/generate-fixtures.cjs');
      process.exitCode = 1;
    } else console.log('Scenario seeds match dev/generate-fixtures.cjs.');
  } else {
    fs.mkdirSync(path.join(root, 'fixtures/scenarios'), {recursive: true});
    for (const o of outputs()) fs.writeFileSync(path.join(root, o.file), o.text);
    console.log('Wrote ' + outputs().length + ' files to fixtures/scenarios/ (generator ' + VERSION + ', seed ' + SEED + ').');
  }
}
