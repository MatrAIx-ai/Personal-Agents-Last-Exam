'use strict';
// Read projections. They expose the signed-in student's own records and
// per-section totals only; competitors' ledger rows never appear in a result.
// Anything that depends on the current time (an open window, an expired
// offer, a blocking reason) is computed here and never written back.
const {fail, copy} = require('./domain-utils.cjs');
const ledger = require('./ledger.cjs');
const rules = require('./rules.cjs');
const queue = require('./queue.cjs');

function sectionView(section, table) {
  const seat = table.get(section.id);
  return {
    id: section.id,
    kind: section.kind,
    label: section.label,
    meetings: copy(section.meetings),
    capacity: seat.capacity,
    enrolled: seat.enrolled,
    held: seat.held,
    available: seat.available,
    version: section.version,
    ...(section.linked_lecture_ids ? {linked_lecture_ids: section.linked_lecture_ids.slice()} : {})
  };
}
function courseView(idx, table, course) {
  return {
    id: course.id,
    code: course.code,
    title: course.title,
    department: course.department,
    credits: course.credits,
    requires_lab: course.requires_lab,
    prerequisite_codes: course.prerequisite_codes.slice(),
    sections: idx.byCourse.get(course.id).map(section => sectionView(section, table))
  };
}
const creditView = (data, idx) => ({
  enrolled: ledger.credits(idx, ledger.activeEnrollments(data, data.student.id)),
  limit: data.student.credit_limit
});
const failureView = failure => copy(failure);

// Filters select courses; a selected course is always returned with all of
// its sections so that lecture/lab requirements stay visible.
function catalogSearch(data, args) {
  if (args.term_id !== undefined && args.term_id !== data.term.id) {
    fail('not_found', 'Term ' + args.term_id + ' is not available; this portal serves ' + data.term.id + '.');
  }
  const idx = ledger.index(data), table = ledger.seats(data);
  const query = (args.query || '').trim().toLowerCase(), department = (args.department || '').trim().toLowerCase();
  const open = bundle => bundle.every(s => table.get(s.id).available > 0);
  const onDays = bundle => bundle.every(s => s.meetings.every(m => m.days.every(d => args.days.includes(d))));
  const courses = data.courses.filter(course => {
    if (query && ![course.code, course.title, course.department].some(v => v.toLowerCase().includes(query))) return false;
    if (department && course.department.toLowerCase() !== department) return false;
    if (!args.open_only && !args.days) return true;
    return ledger.bundlesOf(idx, course).some(bundle => (!args.open_only || open(bundle)) && (!args.days || onDays(bundle)));
  }).sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0).map(course => courseView(idx, table, course));
  return {term: {id: data.term.id, name: data.term.name}, courses};
}

function courseGet(data, args, now) {
  const idx = ledger.index(data), table = ledger.seats(data), course = idx.courses.get(args.id);
  if (!course) fail('not_found', 'Course ' + args.id + ' does not exist in this term.');
  const completed = new Set(data.student.completed_courses.map(c => c.code));
  const window = rules.registrationWindow(data, course);
  const held = ledger.activeEnrollments(data, data.student.id).find(e => e.course_id === course.id);
  return {
    course: courseView(idx, table, course),
    prerequisites: course.prerequisite_codes.map(code => ({code, completed: completed.has(code)})),
    registration: {opens_at: window.opens_at, closes_at: window.closes_at, open: rules.registrationOpen(data, course, now)},
    bundles: ledger.bundlesOf(idx, course).map(bundle => ({
      section_ids: bundle.map(s => s.id),
      available: bundle.every(s => table.get(s.id).available > 0)
    })),
    enrollment_id: held ? held.id : null
  };
}

function recordGet(data, now) {
  const student = data.student;
  return {
    student: {id: student.id, name: student.name, program: student.program},
    completed_courses: copy(student.completed_courses),
    credits: creditView(data, ledger.index(data)),
    university: copy(data.university),
    term: copy(data.term),
    withdrawal: {deadline: data.term.registration.withdraw_deadline, open: rules.withdrawalOpen(data, now)},
    enrollment_policy: copy(data.enrollment_policy)
  };
}

// A conflict is attributed to the meeting-time change that created it. Going
// back through both sections' histories, latest change first, that is the
// change before which the two did not overlap; later changes that kept the
// overlap are not its cause. A pair that has overlapped since the seed has none.
function conflictCause(a, b) {
  const replacedAt = (section, n) => Date.parse(section.history[n - 1].replaced_at);
  let i = a.history.length, j = b.history.length, meetingsA = a.meetings, meetingsB = b.meetings;
  while (i || j) {
    // Each section's changes are undone in their own order; between the two,
    // the later one first (the first-named section's when both moved at once).
    const first = !j || (i > 0 && replacedAt(a, i) >= replacedAt(b, j));
    const [changed, n] = first ? [a, i] : [b, j], previous = changed.history[n - 1];
    if (first) { meetingsA = previous.meetings; i--; } else { meetingsB = previous.meetings; j--; }
    if (!ledger.sectionsConflict({meetings: meetingsA}, {meetings: meetingsB})) {
      return {event_id: previous.event_id, section_id: changed.id, replaced_at: previous.replaced_at,
        from_version: previous.version, to_version: n < changed.history.length ? changed.history[n].version : changed.version};
    }
  }
  return null;
}

function scheduleGet(data) {
  const idx = ledger.index(data), own = ledger.activeEnrollments(data, data.student.id);
  const sections = ledger.scheduleSections(idx, own);
  return {
    enrollments: own.map(e => {
      const course = idx.courses.get(e.course_id);
      return {
        id: e.id, course_id: course.id, code: course.code, title: course.title, credits: course.credits, enrolled_at: e.enrolled_at,
        sections: e.section_ids.map(id => idx.sections.get(id)).map(s => ({id: s.id, kind: s.kind, label: s.label, meetings: copy(s.meetings), version: s.version}))
      };
    }),
    credits: creditView(data, idx),
    conflicts: [...ledger.conflictPairs(sections)].sort().map(pair => {
      const [a, b] = pair.split('|').map(id => idx.sections.get(id));
      return {section_ids: [a.id, b.id], caused_by: conflictCause(a, b)};
    }),
    pending_swaps: data.waitlist_entries
      .filter(e => e.occupant_ref === data.student.id && queue.waiting(e) && e.swap_from_enrollment_id !== null)
      .map(e => ({entry_id: e.id, from_enrollment_id: e.swap_from_enrollment_id, course_id: e.course_id, section_ids: e.section_ids.slice(), status: e.status}))
  };
}

// One of the student's waiting entries as it stands now: its rank, the
// sections it still lacks a seat in, and any other rule it currently fails.
function entryView(data, now, entry) {
  const failures = queue.evaluateEntry(data, now, entry).failures;
  const full = failures.find(f => f.code === 'section_full');
  return {
    id: entry.id,
    course_id: entry.course_id,
    code: ledger.index(data).courses.get(entry.course_id).code,
    section_ids: entry.section_ids.slice(),
    swap_from_enrollment_id: entry.swap_from_enrollment_id,
    status: entry.status,
    joined_at: entry.joined_at,
    rank: queue.rank(data, entry),
    waiting_for_section_ids: full ? full.full_section_ids.slice() : [],
    blocked_by: failures.filter(f => f.code !== 'section_full').map(failureView)
  };
}

function waitlistList(data, now) {
  const self = data.student.id;
  const own = data.waitlist_entries.filter(e => e.occupant_ref === self && queue.waiting(e));
  const entries = own.map(entry => entryView(data, now, entry));
  const offers = own.map(entry => [entry, queue.liveOffer(data, entry)]).filter(([, offer]) => offer).map(([entry, offer]) => ({
    id: offer.id,
    entry_id: entry.id,
    course_id: entry.course_id,
    held_section_ids: offer.held_section_ids.slice(),
    issued_at: offer.issued_at,
    expires_at: offer.expires_at,
    expired: queue.expired(offer, now)
  }));
  return {entries, offers};
}

const activityList = data => ({notices: copy(data.notices), receipts: copy(data.receipts)});

// A preview is a read: it stores nothing. The version Core returns with it is
// the state it was computed from.
function changePreview(data, args, now) {
  const needs = {enroll: ['section_ids'], withdraw: ['id'], swap: ['id', 'section_ids'], accept_offer: ['id']}[args.action];
  for (const key of ['id', 'section_ids']) {
    if (needs.includes(key) !== (args[key] !== undefined)) {
      fail('invalid_arguments', 'A preview of ' + args.action + ' takes ' + needs.join(' and ') + ' and nothing else.');
    }
  }
  // Accepting an offer is judged as the enrollment or swap its waitlist entry stands for.
  const check = args.action === 'accept_offer' ? queue.evaluateOffer(data, now, args.id)
    : rules.evaluate(data, now, {action: args.action, enrollment_id: args.id, section_ids: args.section_ids});
  // While the clock is behind the ledger's records every write is refused for
  // that reason alone, so that is all a preview reports.
  const behind = rules.clockBehind(data, now), failures = behind.length ? behind : check.failures;
  return {
    action: args.action,
    allowed: failures.length === 0,
    failures: failures.map(failureView),
    credits: check.credits,
    schedule: check.schedule,
    conflicts: check.conflicts,
    cancelled_entry_ids: check.cancelled_entries.map(e => e.id)
  };
}

module.exports = {sectionView, catalogSearch, courseGet, recordGet, scheduleGet, entryView, waitlistList, activityList, changePreview};
