'use strict';
// Enrollment eligibility. One pure evaluation is shared by previews (which
// report every visible rule failure and the resulting schedule) and by writes
// (which reject on any failure and leave the ledger unchanged).
const {fail} = require('./domain-utils.cjs');
const ledger = require('./ledger.cjs');

// When several rules fail, a rejected write reports the first of these as its status.
const PRIORITY = ['not_found', 'invalid_state', 'offer_not_live', 'offer_expired', 'invalid_bundle', 'withdrawal_closed',
  'registration_closed', 'swap_required', 'pending_swap_exists', 'duplicate_enrollment', 'prerequisite_missing',
  'seats_available', 'section_full', 'credit_limit_exceeded', 'time_conflict'];

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const pairs = set => [...set].sort().map(pair => pair.split('|'));

// A course may narrow the term's registration window; otherwise the term's applies.
function registrationWindow(data, course) {
  const term = data.term.registration;
  return course.registration_window || {opens_at: term.opens_at, closes_at: term.closes_at};
}
function registrationOpen(data, course, now) {
  const window = registrationWindow(data, course), at = Date.parse(now);
  return at >= Date.parse(window.opens_at) && at < Date.parse(window.closes_at);
}
// An enrollment can be given up (withdrawn or swapped out of) strictly before the term's deadline.
const withdrawalOpen = (data, now) => Date.parse(now) < Date.parse(data.term.registration.withdraw_deadline);

// No change is accepted while the clock is behind the ledger's own records.
// It is a set-up fault, not a registration rule: the seed was loaded with a
// clock earlier than its history. Returned as a failure list (empty or one).
function clockBehind(data, now) {
  const last = ledger.aheadOfClock(data, now);
  return last === null ? [] : [{code: 'invalid_state', message: 'This ledger holds records dated up to ' + last
    + ', which is later than the current time. Nothing can be changed until the clock reaches that instant; no request can resolve this.'}];
}

// The outcome of a change that alters nothing: the student's schedule as it is.
function unchanged(data) {
  const idx = ledger.index(data), current = ledger.activeEnrollments(data, data.student.id);
  const before = pairs(ledger.conflictPairs(ledger.scheduleSections(idx, current))), credits = ledger.credits(idx, current);
  return {
    failures: [], source: null, course: null, sections: [], cancelled_entries: [],
    credits: {current: credits, resulting: credits, limit: data.student.credit_limit},
    schedule: current.map(e => ({course_id: e.course_id, code: idx.courses.get(e.course_id).code, section_ids: e.section_ids.slice(), change: 'kept'})),
    conflicts: {current: before, resulting: before, introduced: [], resolved: []}
  };
}
// A change refused before any rule about the schedule applies.
function refused(data, code, message) {
  const outcome = unchanged(data);
  outcome.failures.push({code, message});
  return outcome;
}

// Evaluate one change for the signed-in student against the schedule that
// would result:
//   {action: 'enroll', section_ids}                  add a bundle
//   {action: 'swap', enrollment_id, section_ids}     replace a held bundle
//   {action: 'withdraw', enrollment_id}              give up a held bundle
// A swap is judged with the named original bundle replaced: it reuses the seat
// in any section both bundles share and needs seats only in the others.
// ownHeld lists sections already reserved for this student by a live offer.
// Returns every failure; an empty list means the change is allowed.
function evaluate(data, now, change, {ownHeld = []} = {}) {
  const idx = ledger.index(data), student = data.student, failures = [];
  const add = (code, message, details = {}) => failures.push({code, message, ...details});
  const current = ledger.activeEnrollments(data, student.id);
  const row = (enrollment, kind) => ({course_id: enrollment.course_id, code: idx.courses.get(enrollment.course_id).code,
    section_ids: enrollment.section_ids.slice(), change: kind});
  const before = ledger.conflictPairs(ledger.scheduleSections(idx, current));
  const outcome = unchanged(data);
  outcome.failures = failures;

  let source = null;
  if (change.action !== 'enroll') {
    // Only the student's own rows are addressable; anything else does not exist for them.
    source = data.enrollments.find(e => e.id === change.enrollment_id && e.occupant_ref === student.id) || null;
    if (!source) {
      add('not_found', 'Enrollment ' + change.enrollment_id + ' does not exist in this account.');
      return outcome;
    }
    if (source.status !== ledger.ACTIVE) {
      add('invalid_state', 'Enrollment ' + source.id + ' is no longer held (' + source.status + ').');
      return outcome;
    }
    outcome.source = source;
  }
  let bundle = null;
  if (change.action !== 'withdraw') {
    bundle = ledger.resolveBundle(idx, change.section_ids);
    if (bundle.missing) {
      add('not_found', 'Section ' + bundle.missing + ' does not exist in this term.');
      return outcome;
    }
    if (bundle.problem) {
      add('invalid_bundle', bundle.problem);
      return outcome;
    }
    if (source && sameSet(source.section_ids, bundle.sections.map(s => s.id))) {
      add('invalid_bundle', 'Enrollment ' + source.id + ' already holds exactly this bundle.');
      return outcome;
    }
    outcome.course = bundle.course;
    outcome.sections = bundle.sections;
  }

  const kept = current.filter(e => e !== source);
  if (source && !withdrawalOpen(data, now)) {
    add('withdrawal_closed', 'Enrollments could be given up until ' + data.term.registration.withdraw_deadline + '.');
  }
  if (bundle) {
    const {course, sections} = bundle;
    if (!registrationOpen(data, course, now)) {
      const window = registrationWindow(data, course);
      add('registration_closed', 'Registration for ' + course.code + ' is open from ' + window.opens_at + ' until ' + window.closes_at + '.');
    }
    if (kept.some(e => e.course_id === course.id)) {
      add('duplicate_enrollment', 'Already enrolled in ' + course.code + '; changing sections requires a swap.');
    }
    const completed = new Set(student.completed_courses.map(c => c.code));
    const missing = course.prerequisite_codes.filter(code => !completed.has(code));
    if (missing.length) {
      add('prerequisite_missing', course.code + ' requires completed ' + missing.join(', ') + '.', {missing_prerequisites: missing});
    }
    const table = ledger.seats(data), reused = new Set(source ? source.section_ids : []);
    const full = sections.filter(s => !reused.has(s.id) && !ownHeld.includes(s.id) && table.get(s.id).available < 1).map(s => s.id);
    if (full.length) {
      // A seat the student's own offer is holding is used by accepting that offer, not by a separate change.
      const mine = data.offers.find(o => o.status === 'live' && o.held_section_ids.some(id => full.includes(id))
        && data.waitlist_entries.some(e => e.id === o.entry_id && e.occupant_ref === student.id));
      add('section_full', 'No seat is available in ' + full.join(', ') + '; every newly occupied section of the bundle needs a seat.'
        + (mine ? ' A seat is being held for your offer ' + mine.id + ': accept that offer to use it.' : ''),
        {full_section_ids: full, ...(mine ? {offer_id: mine.id} : {})});
    }
  }
  const resulting = ledger.credits(idx, kept) + (bundle ? bundle.course.credits : 0);
  outcome.credits.resulting = resulting;
  if (bundle && resulting > student.credit_limit) {
    add('credit_limit_exceeded', 'The change would bring the term to ' + resulting + ' credits; the limit is ' + student.credit_limit + '.');
  }
  const after = ledger.conflictPairs([...ledger.scheduleSections(idx, kept), ...(bundle ? bundle.sections : [])]);
  const introduced = pairs(new Set([...after].filter(pair => !before.has(pair))));
  outcome.conflicts = {current: pairs(before), resulting: pairs(after), introduced,
    resolved: pairs(new Set([...before].filter(pair => !after.has(pair))))};
  if (introduced.length) {
    add('time_conflict', 'Meeting times would overlap: ' + introduced.map(pair => pair.join(' and ')).join('; ') + '.', {conflicts: introduced});
  }
  outcome.schedule = [
    ...current.map(e => row(e, e === source ? 'removed' : 'kept')),
    ...(bundle ? [{course_id: bundle.course.id, code: bundle.course.code, section_ids: bundle.sections.map(s => s.id), change: 'added'}] : [])
  ];
  // A pending swap is tied to the enrollment it would replace: when that
  // enrollment goes, the request is cancelled rather than turned into a plain enrollment.
  if (source) {
    outcome.cancelled_entries = data.waitlist_entries.filter(e => ledger.WAITING.includes(e.status) && e.swap_from_enrollment_id === source.id);
  }
  return outcome;
}

// Reject a write: the first failure by PRIORITY becomes the status, and the
// message lists every other failure so nothing visible is hidden.
function reject(failures) {
  const first = PRIORITY.map(code => failures.find(f => f.code === code)).find(Boolean) || failures[0];
  const others = failures.filter(f => f !== first);
  fail(first.code, first.message + (others.length ? ' Also: ' + others.map(f => '[' + f.code + '] ' + f.message).join(' ') : ''));
}

module.exports = {PRIORITY, registrationWindow, registrationOpen, withdrawalOpen, clockBehind, unchanged, refused, evaluate, reject};
