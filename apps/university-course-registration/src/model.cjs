'use strict';
// Record consistency. Core calls validateSeed when a seed is loaded and again
// after every committed tool call and event, so these are the ledger's
// standing invariants: an operation that would break one is rolled back.
// None of them depends on the current time; a clock that is behind the
// ledger's own records is handled where changes are made (rules.clockBehind).
const {fail, references} = require('./domain-utils.cjs');
const ledger = require('./ledger.cjs');

const bad = message => fail('invalid_seed', message);
const at = value => Date.parse(value);
const unique = values => new Set(values).size === values.length;
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

// Core counts records and objects and requires the two to agree, so both
// enumerate exactly the same ledger rows.
const records = data => ledger.collections(data).flat();
const objects = data => records(data).map(record => record.id);

function validateCatalog(data, idx) {
  if (!unique(data.courses.map(c => c.code))) bad('Course codes must be unique.');
  for (const course of data.courses) {
    const window = course.registration_window;
    if (window && !(at(window.opens_at) < at(window.closes_at))) bad('Registration window of ' + course.code + ' must open before it closes.');
    const sections = idx.byCourse.get(course.id);
    if (!unique(sections.map(s => s.label))) bad('Section labels of ' + course.code + ' must be unique.');
    const lectures = sections.filter(s => s.kind === 'lecture'), labs = sections.filter(s => s.kind === 'lab');
    if (!lectures.length) bad(course.code + ' needs at least one lecture section.');
    if (course.requires_lab && !labs.length) bad(course.code + ' requires a lab but has no lab section.');
    if (!course.requires_lab && labs.length) bad(course.code + ' has lab sections but does not require a lab.');
  }
  for (const section of data.sections) {
    const course = idx.courses.get(section.course_id);
    if (!course) bad('Section ' + section.id + ' refers to an unknown course.');
    if (section.base_enrolled > section.capacity) bad('Section ' + section.id + ' has more background occupants than seats.');
    for (const version of [section, ...section.history]) {
      if (version.meetings.some(m => !(m.start < m.end))) bad('A meeting of section ' + section.id + ' must start before it ends.');
    }
    const versions = section.history.map(h => h.version);
    if (versions.some((v, i) => v >= section.version || (i && v <= versions[i - 1]))) bad('History of section ' + section.id + ' must list earlier versions in order.');
    if (section.linked_lecture_ids) {
      if (section.kind !== 'lab') bad('Only lab sections can be linked to lectures: ' + section.id + '.');
      for (const id of section.linked_lecture_ids) {
        const lecture = idx.sections.get(id);
        if (!lecture || lecture.kind !== 'lecture' || lecture.course_id !== section.course_id) bad('Lab ' + section.id + ' is linked to a section that is not a lecture of its course.');
      }
    }
  }
}

function validateBundle(idx, row, what) {
  const bundle = ledger.resolveBundle(idx, row.section_ids);
  if (bundle.missing) bad(what + ' ' + row.id + ' refers to unknown section ' + bundle.missing + '.');
  if (bundle.problem) bad(what + ' ' + row.id + ' is not a valid bundle: ' + bundle.problem);
  if (bundle.course.id !== row.course_id) bad(what + ' ' + row.id + ' names a course that does not match its sections.');
}

function validateLedger(data, idx) {
  const self = data.student.id;
  const enrollments = new Map(data.enrollments.map(e => [e.id, e]));
  const entries = new Map(data.waitlist_entries.map(e => [e.id, e]));
  const waiting = entry => ledger.WAITING.includes(entry.status);

  const held = new Set();
  for (const e of data.enrollments) {
    validateBundle(idx, e, 'Enrollment');
    const active = e.status === ledger.ACTIVE;
    if (active !== (e.ended_at === null)) bad('Enrollment ' + e.id + ' must have an end time exactly when it is no longer enrolled.');
    if (e.ended_at !== null && at(e.ended_at) < at(e.enrolled_at)) bad('Enrollment ' + e.id + ' ends before it starts.');
    if (!active) continue;
    const key = e.occupant_ref + '|' + e.course_id;
    if (held.has(key)) bad('An occupant can hold only one enrollment per course: ' + e.id + '.');
    held.add(key);
  }

  const queued = new Set(), sources = new Set();
  for (const entry of data.waitlist_entries) {
    validateBundle(idx, entry, 'Waitlist entry');
    if (waiting(entry) !== (entry.ended_at === null)) bad('Waitlist entry ' + entry.id + ' must have an end time exactly when it has left the queue.');
    if (waiting(entry) && entry.end_reason !== null) bad('Waitlist entry ' + entry.id + ' is still waiting and cannot carry an end reason.');
    if (entry.occupant_ref === self && entry.blocked_reason !== null) bad('The student\'s own blocking reason is derived, not stored: ' + entry.id + '.');
    if (entry.swap_from_enrollment_id !== null) {
      const source = enrollments.get(entry.swap_from_enrollment_id);
      if (!source || source.occupant_ref !== entry.occupant_ref) bad('Waitlist entry ' + entry.id + ' must swap from an enrollment of the same occupant.');
      if (sameSet(source.section_ids, entry.section_ids)) bad('Waitlist entry ' + entry.id + ' targets the bundle it already holds.');
      if (waiting(entry)) {
        if (source.status !== ledger.ACTIVE) bad('Pending swap ' + entry.id + ' refers to an enrollment that is no longer held.');
        if (sources.has(source.id)) bad('Only one pending swap is allowed per enrollment: ' + source.id + '.');
        sources.add(source.id);
      }
    }
    if (!waiting(entry)) continue;
    const key = entry.occupant_ref + '|' + entry.section_ids.slice().sort().join(',');
    if (queued.has(key)) bad('An occupant can wait only once for the same bundle: ' + entry.id + '.');
    queued.add(key);
  }
  // The queue is served in sequence order, so the sequence must be the order of joining.
  const inSequence = data.waitlist_entries.slice().sort((a, b) => a.seq - b.seq);
  if (inSequence.some((entry, i) => i && at(entry.joined_at) < at(inSequence[i - 1].joined_at))) {
    bad('Waitlist entries must be sequenced in the order they joined the queue.');
  }

  const live = new Map();
  for (const offer of data.offers) {
    const entry = entries.get(offer.entry_id);
    if (!entry) bad('Offer ' + offer.id + ' refers to an unknown waitlist entry.');
    if (!sameSet(offer.held_section_ids, ledger.netNewSectionIds(data, entry))) bad('Offer ' + offer.id + ' must hold exactly the sections its entry would newly occupy.');
    if (!(at(offer.issued_at) < at(offer.expires_at))) bad('Offer ' + offer.id + ' must expire after it is issued.');
    const open = offer.status === 'live';
    if (open !== (offer.resolved_at === null)) bad('Offer ' + offer.id + ' must have a resolution time exactly when it is no longer live.');
    if (!open) continue;
    if (entry.status !== 'offered' || live.has(entry.id)) bad('A live offer needs exactly one waitlist entry in the offered state: ' + offer.id + '.');
    live.set(entry.id, offer.id);
  }
  for (const entry of data.waitlist_entries) {
    if (entry.status === 'offered' && !live.has(entry.id)) bad('Waitlist entry ' + entry.id + ' is marked offered without a live offer.');
  }

  for (const [id, seat] of ledger.seats(data)) {
    if (seat.available < 0) bad('Section ' + id + ' is over capacity: ' + (seat.enrolled + seat.held) + ' occupants and holds for ' + seat.capacity + ' seats.');
  }
  const credits = ledger.credits(idx, ledger.activeEnrollments(data, self));
  if (credits > data.student.credit_limit) bad('The student is enrolled in ' + credits + ' credits; the limit is ' + data.student.credit_limit + '.');
}

// Notices and receipts point at ledger rows. A pointer to a row that does not
// exist is rejected; event IDs belong to Core and are not resolved here.
function validateRefs(data, idx) {
  const rows = list => new Map(list.map(row => [row.id, row]));
  const enrollments = rows(data.enrollments), entries = rows(data.waitlist_entries), offers = rows(data.offers);
  const single = {
    course_id: ['course', idx.courses], section_id: ['section', idx.sections],
    enrollment_id: ['enrollment', enrollments], replaced_enrollment_id: ['enrollment', enrollments],
    entry_id: ['waitlist entry', entries], offer_id: ['offer', offers]
  };
  const many = {section_ids: ['section', idx.sections], cancelled_entry_ids: ['waitlist entry', entries]};
  const check = (what, row) => {
    for (const [key, value] of Object.entries(row.refs)) {
      const [noun, known] = single[key] || many[key] || [];
      if (!known) continue;
      for (const id of many[key] ? value : [value]) {
        if (!known.has(id)) bad(what + ' ' + row.id + ' refers to unknown ' + noun + ' ' + id + '.');
      }
    }
  };
  for (const notice of data.notices) check('Notice', notice);
  for (const receipt of data.receipts) check('Receipt', receipt);
}

function validateSeed(ctx, data) {
  references(ctx, data);
  const window = data.term.registration;
  if (!(at(window.opens_at) < at(window.closes_at) && at(window.closes_at) <= at(window.withdraw_deadline))) {
    bad('Registration must open before it closes, and the withdrawal deadline cannot precede the close.');
  }
  if (!unique(objects(data))) bad('Record IDs must be unique across the whole ledger.');
  if (!unique(data.student.completed_courses.map(c => c.code))) bad('A completed course can be listed only once.');
  const seqs = ledger.sequenced(data).map(row => row.seq);
  if (!unique(seqs)) bad('Sequence numbers must be unique across enrollments, waitlist entries, offers, notices and receipts.');
  if (seqs.some(seq => seq >= data.counters.next_seq)) bad('The next sequence number must be greater than every sequence already used.');
  const idx = ledger.index(data);
  validateCatalog(data, idx);
  validateLedger(data, idx);
  validateRefs(data, idx);
}

module.exports = {validateSeed, records, objects, references: () => []};
