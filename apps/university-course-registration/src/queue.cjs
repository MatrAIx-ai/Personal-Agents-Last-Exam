'use strict';
// The waitlist queues: who waits for what, when a seat is offered, and how an
// entry or an offer ends. The student and the synthetic competitors share one
// queue order. Nothing here keeps a clock or a timer: an offer is issued while
// a write or an event is being applied, and it ends only through a write or an
// event.
const ledger = require('./ledger.cjs');
const rules = require('./rules.cjs');

const waiting = entry => ledger.WAITING.includes(entry.status);
const liveOffer = (data, entry) => data.offers.find(o => o.entry_id === entry.id && o.status === 'live') || null;
const own = (data, row) => Boolean(row) && row.occupant_ref === data.student.id;
// An offer cannot be accepted at or after its expiry instant.
const expired = (offer, now) => Date.parse(now) >= Date.parse(offer.expires_at);
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

// Entries are served in join sequence. An entry's rank counts the earlier
// entries still waiting for a seat in any section it would newly occupy.
function rank(data, entry) {
  const wanted = new Set(ledger.netNewSectionIds(data, entry));
  return 1 + data.waitlist_entries.filter(other => other !== entry && waiting(other) && other.seq < entry.seq
    && ledger.netNewSectionIds(data, other).some(id => wanted.has(id))).length;
}

// The change an entry stands for: a swap from its original enrollment, or a plain enrollment.
const entryChange = entry => entry.swap_from_enrollment_id
  ? {action: 'swap', enrollment_id: entry.swap_from_enrollment_id, section_ids: entry.section_ids}
  : {action: 'enroll', section_ids: entry.section_ids};

// Would the student's own entry be allowed right now? Seats held by its own
// live offer count as available to it.
function evaluateEntry(data, now, entry) {
  const offer = liveOffer(data, entry);
  return rules.evaluate(data, now, entryChange(entry), {ownHeld: offer ? offer.held_section_ids : []});
}

// Can this queued entry be given an offer now? Every section it would newly
// occupy needs a seat, and the entry must be eligible.
function canBeOffered(data, now, entry) {
  const table = ledger.seats(data);
  if (!ledger.netNewSectionIds(data, entry).every(id => table.get(id).available > 0)) return false;
  if (own(data, entry)) return evaluateEntry(data, now, entry).failures.length === 0;
  // A competitor's academic record is not part of this ledger: the scenario
  // states whether the entry is blocked. Rules that need no record still apply.
  if (entry.blocked_reason !== null) return false;
  if (!rules.registrationOpen(data, ledger.index(data).courses.get(entry.course_id), now)) return false;
  return !data.enrollments.some(e => e.status === ledger.ACTIVE && e.occupant_ref === entry.occupant_ref
    && e.course_id === entry.course_id && e.id !== entry.swap_from_enrollment_id);
}

// Hold the seats and open a time-limited offer. Only the signed-in student is notified.
function issue(ctx, data, entry, eventId) {
  const now = ctx.virtual_now, {id, seq} = ledger.allocate(data, 'off');
  const offer = {id, seq, entry_id: entry.id, held_section_ids: ledger.netNewSectionIds(data, entry), issued_at: now,
    expires_at: ledger.plusMinutes(now, data.enrollment_policy.offer_window_minutes), status: 'live', resolved_at: null};
  data.offers.push(offer);
  entry.status = 'offered';
  if (own(data, entry)) {
    const swap = entry.swap_from_enrollment_id;
    ledger.addNotice(data, now, 'offer_issued',
      'A seat is on offer for ' + ledger.bundleLabel(ledger.index(data), entry.section_ids) + ' until ' + offer.expires_at
      + '. It is held for you but is not an enrollment: accept or decline offer ' + offer.id + '.'
      + (swap ? ' Accepting replaces enrollment ' + swap + '; until then that enrollment is kept.' : ''),
      {course_id: entry.course_id, entry_id: entry.id, offer_id: offer.id, expires_at: offer.expires_at,
        ...(swap ? {enrollment_id: swap} : {}), ...(eventId ? {event_id: eventId} : {})});
  }
  return offer;
}

// Walk every queued entry in join order and offer whatever can be offered.
// It runs at the end of each committed write and each event. An entry that
// cannot be served is skipped without holding anything and keeps its place.
// One pass is enough: issuing an offer only takes seats away.
function recheck(ctx, data, eventId) {
  const issued = [];
  const queued = data.waitlist_entries.filter(e => e.status === 'queued').sort((a, b) => a.seq - b.seq);
  for (const entry of queued) {
    if (canBeOffered(data, ctx.virtual_now, entry)) issued.push(issue(ctx, data, entry, eventId));
  }
  return issued;
}

function endEntry(entry, status, at, reason = status) {
  entry.status = status;
  entry.ended_at = at;
  entry.end_reason = reason;
}
function endOffer(offer, status, at) {
  offer.status = status;
  offer.resolved_at = at;
}

// The enrollment a pending swap would replace is gone: cancel the request and
// release any seats its live offer was holding. It never turns into a plain
// enrollment. The signed-in student is told why.
function cancelPendingSwaps(ctx, data, source, reason, because, eventId) {
  const now = ctx.virtual_now, idx = ledger.index(data);
  return data.waitlist_entries.filter(e => waiting(e) && e.swap_from_enrollment_id === source.id).map(entry => {
    const offer = liveOffer(data, entry);
    if (offer) endOffer(offer, 'cancelled', now);
    endEntry(entry, 'cancelled', now, reason);
    if (own(data, entry)) {
      ledger.addNotice(data, now, 'swap_cancelled',
        'Your pending swap into ' + idx.courses.get(entry.course_id).code + ' was cancelled because ' + because + '.',
        {course_id: entry.course_id, entry_id: entry.id, enrollment_id: source.id, ...(offer ? {offer_id: offer.id} : {}),
          ...(eventId ? {event_id: eventId} : {})});
    }
    return entry.id;
  });
}

// Turn an offered entry into the enrollment it stands for. For a pending swap
// the original bundle is given up in the same step; its seat in a section both
// bundles share simply carries over.
function fulfil(ctx, data, entry, offer) {
  const now = ctx.virtual_now;
  let replaced = null;
  if (entry.swap_from_enrollment_id) {
    replaced = data.enrollments.find(e => e.id === entry.swap_from_enrollment_id);
    replaced.status = 'swapped_out';
    replaced.ended_at = now;
  }
  const {id, seq} = ledger.allocate(data, 'enr');
  const enrollment = {id, seq, occupant_ref: entry.occupant_ref, course_id: entry.course_id, section_ids: entry.section_ids.slice(),
    status: 'enrolled', enrolled_at: now, ended_at: null};
  data.enrollments.push(enrollment);
  endOffer(offer, 'accepted', now);
  endEntry(entry, 'fulfilled', now);
  return {enrollment, replaced};
}

// Accepting one of the student's own offers, judged as the enrollment or swap
// its entry stands for. The returned offer and entry are the rows in `data`.
function evaluateOffer(data, now, offerId) {
  const offer = data.offers.find(o => o.id === offerId);
  const entry = offer && data.waitlist_entries.find(e => e.id === offer.entry_id);
  if (!own(data, entry)) return rules.refused(data, 'not_found', 'Offer ' + offerId + ' does not exist in this account.');
  if (offer.status !== 'live') {
    return rules.refused(data, 'offer_not_live', 'Offer ' + offer.id + ' is no longer open (' + offer.status + ').');
  }
  const check = rules.evaluate(data, now, entryChange(entry), {ownHeld: offer.held_section_ids});
  if (expired(offer, now)) {
    check.failures.unshift({code: 'offer_expired', message: 'Offer ' + offer.id + ' expired at ' + offer.expires_at + ' and can no longer be accepted.'});
  }
  // The entry being fulfilled is not one of the swaps its own acceptance cancels.
  check.cancelled_entries = check.cancelled_entries.filter(e => e.id !== entry.id);
  return {...check, offer, entry};
}

// Joining a queue for the signed-in student. Eligibility for the seat itself
// is not decided here: it is checked when an offer is issued and when it is
// accepted, and an entry that is blocked in between says so when it is read.
function evaluateJoin(data, now, args) {
  const idx = ledger.index(data), student = data.student, failures = [];
  const add = (code, message) => failures.push({code, message});
  const outcome = {failures, existing: null, course: null, sections: [], source: null};
  const bundle = ledger.resolveBundle(idx, args.section_ids);
  if (bundle.missing) { add('not_found', 'Section ' + bundle.missing + ' does not exist in this term.'); return outcome; }
  if (bundle.problem) { add('invalid_bundle', bundle.problem); return outcome; }
  const ids = bundle.sections.map(s => s.id), sourceId = args.swap_from_enrollment_id === undefined ? null : args.swap_from_enrollment_id;
  outcome.course = bundle.course;
  outcome.sections = bundle.sections;
  if (sourceId !== null) {
    const source = data.enrollments.find(e => e.id === sourceId && e.occupant_ref === student.id);
    if (!source) { add('not_found', 'Enrollment ' + sourceId + ' does not exist in this account.'); return outcome; }
    if (source.status !== ledger.ACTIVE) { add('invalid_state', 'Enrollment ' + source.id + ' is no longer held (' + source.status + ').'); return outcome; }
    if (sameSet(source.section_ids, ids)) { add('invalid_bundle', 'Enrollment ' + source.id + ' already holds exactly this bundle.'); return outcome; }
    outcome.source = source;
  }
  // Rejoining the same queue returns the entry that is already there.
  const same = data.waitlist_entries.find(e => own(data, e) && waiting(e) && sameSet(e.section_ids, ids));
  if (same) {
    if (same.swap_from_enrollment_id === sourceId) { outcome.existing = same; return outcome; }
    add('invalid_state', 'You are already waiting for this bundle through entry ' + same.id + ', '
      + (same.swap_from_enrollment_id ? 'a pending swap from ' + same.swap_from_enrollment_id : 'which is not a swap')
      + '. Leave that entry before joining ' + (sourceId ? 'as a swap from ' + sourceId : 'without a swap') + '.');
    return outcome;
  }
  const course = bundle.course;
  if (!rules.registrationOpen(data, course, now)) {
    const window = rules.registrationWindow(data, course);
    add('registration_closed', 'Registration for ' + course.code + ' is open from ' + window.opens_at + ' until ' + window.closes_at + '.');
  }
  if (!outcome.source && ledger.activeEnrollments(data, student.id).some(e => e.course_id === course.id)) {
    add('swap_required', 'You are enrolled in ' + course.code + '. To change its sections, name that enrollment in swap_from_enrollment_id.');
  }
  const pending = outcome.source && data.waitlist_entries.find(e => waiting(e) && e.swap_from_enrollment_id === outcome.source.id);
  if (pending) {
    add('pending_swap_exists', 'Enrollment ' + outcome.source.id + ' already has a pending swap (entry ' + pending.id + '). Leave it before starting another.');
  }
  const table = ledger.seats(data), kept = new Set(outcome.source ? outcome.source.section_ids : []);
  const needed = ids.filter(id => !kept.has(id));
  if (needed.every(id => table.get(id).available > 0)) {
    add('seats_available', 'A seat is available in ' + needed.join(' and ') + ', so there is nothing to wait for: '
      + (outcome.source ? 'swap' : 'enroll') + ' directly instead.');
  }
  return outcome;
}

module.exports = {waiting, liveOffer, own, expired, rank, entryChange, evaluateEntry, canBeOffered, recheck, endEntry, endOffer,
  cancelPendingSwaps, fulfil, evaluateOffer, evaluateJoin};
