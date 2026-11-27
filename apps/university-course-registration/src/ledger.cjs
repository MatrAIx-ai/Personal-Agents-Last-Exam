'use strict';
// The enrollment ledger: bundles, seats, holds, timetable conflicts, ID
// allocation and the notice / receipt log. Functions over the App data; the
// current time is always passed in, never read from a clock.

const ACTIVE = 'enrolled';
const WAITING = ['queued', 'offered'];

function index(data) {
  const courses = new Map(data.courses.map(c => [c.id, c]));
  const sections = new Map(data.sections.map(s => [s.id, s]));
  const byCourse = new Map(data.courses.map(c => [c.id, []]));
  for (const s of data.sections) if (byCourse.has(s.course_id)) byCourse.get(s.course_id).push(s);
  return {courses, sections, byCourse};
}

// A bundle is one lecture of a course plus exactly one of its labs when the
// course requires a lab. Returns {course, lecture, lab, sections} with the
// lecture first, or {missing} / {problem} describing why it is not a bundle.
function resolveBundle(idx, sectionIds) {
  const found = [];
  for (const id of sectionIds) {
    const section = idx.sections.get(id);
    if (!section) return {missing: id};
    found.push(section);
  }
  const course = idx.courses.get(found[0].course_id);
  if (!course) return {problem: 'Section ' + found[0].id + ' belongs to an unknown course.'};
  if (found.some(s => s.course_id !== course.id)) return {problem: 'All sections of a bundle must belong to the same course.'};
  const lectures = found.filter(s => s.kind === 'lecture'), labs = found.filter(s => s.kind === 'lab');
  if (lectures.length !== 1) return {problem: 'A bundle needs exactly one lecture section of ' + course.code + '.'};
  if (course.requires_lab && labs.length !== 1) return {problem: course.code + ' must be taken as one lecture plus one lab section.'};
  if (!course.requires_lab && labs.length) return {problem: course.code + ' has no lab component.'};
  const lecture = lectures[0], lab = labs[0] || null;
  if (lab && lab.linked_lecture_ids && !lab.linked_lecture_ids.includes(lecture.id)) {
    return {problem: lab.label + ' of ' + course.code + ' cannot be combined with ' + lecture.label + '.'};
  }
  return {course, lecture, lab, sections: lab ? [lecture, lab] : [lecture]};
}

// Every valid lecture/lab combination of a course.
function bundlesOf(idx, course) {
  const sections = idx.byCourse.get(course.id) || [];
  const lectures = sections.filter(s => s.kind === 'lecture'), labs = sections.filter(s => s.kind === 'lab');
  if (!course.requires_lab) return lectures.map(lecture => [lecture]);
  return lectures.flatMap(lecture => labs
    .filter(lab => !lab.linked_lecture_ids || lab.linked_lecture_ids.includes(lecture.id))
    .map(lab => [lecture, lab]));
}

// Seats per section. Occupied = background occupants + enrolled ledger rows
// + live offer holds; the invariant occupied <= capacity is checked on every commit.
function seats(data) {
  const table = new Map(data.sections.map(s => [s.id, {capacity: s.capacity, enrolled: s.base_enrolled, held: 0, available: 0}]));
  for (const e of data.enrollments) {
    if (e.status !== ACTIVE) continue;
    for (const id of e.section_ids) if (table.has(id)) table.get(id).enrolled++;
  }
  for (const o of data.offers) {
    if (o.status !== 'live') continue;
    for (const id of o.held_section_ids) if (table.has(id)) table.get(id).held++;
  }
  for (const row of table.values()) row.available = row.capacity - row.enrolled - row.held;
  return table;
}

// Sections a waitlist entry would newly occupy: its target bundle minus any
// section the occupant already holds through the enrollment it swaps from.
function netNewSectionIds(data, entry) {
  if (!entry.swap_from_enrollment_id) return entry.section_ids.slice();
  const source = data.enrollments.find(e => e.id === entry.swap_from_enrollment_id);
  const kept = new Set(source ? source.section_ids : []);
  return entry.section_ids.filter(id => !kept.has(id));
}

// Weekly wall-clock meetings conflict when they share a day and overlap.
const meetingsOverlap = (a, b) => a.days.some(d => b.days.includes(d)) && a.start < b.end && b.start < a.end;
const sectionsConflict = (a, b) => a.meetings.some(m => b.meetings.some(n => meetingsOverlap(m, n)));
// Unordered conflicting pairs as stable "idA|idB" keys. The same section can be
// listed twice (a target bundle that shares a section with a held one); a
// section never conflicts with itself.
function conflictPairs(sections) {
  const pairs = new Set();
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[i].id === sections[j].id) continue;
      if (sectionsConflict(sections[i], sections[j])) pairs.add([sections[i].id, sections[j].id].sort().join('|'));
    }
  }
  return pairs;
}

const activeEnrollments = (data, occupant) => data.enrollments.filter(e => e.status === ACTIVE && e.occupant_ref === occupant);
const scheduleSections = (idx, enrollments) => enrollments.flatMap(e => e.section_ids.map(id => idx.sections.get(id)));
const credits = (idx, enrollments) => enrollments.reduce((sum, e) => sum + idx.courses.get(e.course_id).credits, 0);

const collections = data => [data.courses, data.sections, data.enrollments, data.waitlist_entries, data.offers, data.notices, data.receipts];
const sequenced = data => [data.enrollments, data.waitlist_entries, data.offers, data.notices, data.receipts].flat();

// The latest instant the ledger itself records: when a row was written or
// ended, or a section's times were replaced. Offer deadlines and the term's
// dates lie ahead by design and do not count. Null for an empty ledger.
function lastRecorded(data) {
  const stamps = [
    ...data.enrollments.flatMap(e => [e.enrolled_at, e.ended_at]),
    ...data.waitlist_entries.flatMap(e => [e.joined_at, e.ended_at]),
    ...data.offers.flatMap(o => [o.issued_at, o.resolved_at]),
    ...data.notices.map(n => n.at),
    ...data.receipts.map(r => r.at),
    ...data.sections.flatMap(s => s.history.map(h => h.replaced_at))
  ].filter(stamp => stamp !== null);
  return stamps.reduce((latest, stamp) => latest === null || Date.parse(stamp) > Date.parse(latest) ? stamp : latest, null);
}
// A change made while the clock is behind those records would be dated before
// the history it follows (an enrollment ending before it began, a queue out of
// its join order). Returns the instant the clock has yet to reach, or null.
function aheadOfClock(data, now) {
  const last = lastRecorded(data);
  return last !== null && Date.parse(now) < Date.parse(last) ? last : null;
}

// Business IDs come from a counter stored in the App data, so they stay
// collision-free across snapshots and seed reloads. Core's own counter
// restarts on reset / load and is not visible to the App.
function allocate(data, prefix) {
  const taken = new Set(collections(data).flat().map(r => r.id));
  let n = data.counters.next_seq;
  while (taken.has(prefix + '-' + n)) n++;
  data.counters.next_seq = n + 1;
  return {id: prefix + '-' + n, seq: n};
}

// What the student is told, and what each committed write leaves behind.
function addNotice(data, at, kind, text, refs) {
  const {id, seq} = allocate(data, 'ntc');
  // The stored text is bounded; the refs carry the facts in full.
  data.notices.push({id, seq, at, kind, text: text.length > 500 ? text.slice(0, 497) + '...' : text, refs});
  return id;
}
function addReceipt(data, at, action, requestId, refs) {
  const {id, seq} = allocate(data, 'rcp');
  data.receipts.push({id, seq, at, action, request_id: requestId, refs});
  return id;
}

// An instant some minutes later, written with the same UTC offset as the
// instant it is counted from (the fixtures fix the university's offset).
function plusMinutes(iso, minutes) {
  const zone = /(Z|[+-]\d{2}:\d{2})$/.exec(iso), suffix = zone ? zone[1] : 'Z';
  const offset = suffix === 'Z' ? 0 : (suffix[0] === '-' ? -1 : 1) * (Number(suffix.slice(1, 3)) * 60 + Number(suffix.slice(4, 6)));
  const wall = new Date(Date.parse(iso) + (minutes + offset) * 60000).toISOString();
  return (wall.endsWith('.000Z') ? wall.slice(0, 19) : wall.slice(0, 23)) + suffix;
}

// "CS240 LEC 1 + LAB 1" for notices and messages.
function bundleLabel(idx, sectionIds) {
  const sections = sectionIds.map(id => idx.sections.get(id));
  return idx.courses.get(sections[0].course_id).code + ' ' + sections.map(s => s.label).join(' + ');
}
const meetingText = meetings => meetings.map(m => m.days.join('/') + ' ' + m.start + '-' + m.end).join(', ') || 'no meetings';

module.exports = {ACTIVE, WAITING, index, resolveBundle, bundlesOf, seats, netNewSectionIds, meetingsOverlap,
  sectionsConflict, conflictPairs, activeEnrollments, scheduleSections, credits, collections, sequenced, lastRecorded,
  aheadOfClock, allocate, addNotice, addReceipt, plusMinutes, bundleLabel, meetingText};
