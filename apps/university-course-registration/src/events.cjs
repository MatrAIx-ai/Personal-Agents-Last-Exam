'use strict';
// Incoming Infra events. A Task supplies them; Core has already checked the
// envelope against schemas/events.schema.json, the declared event types, the
// event ID and the version, and has set ctx.virtual_now to the event's time.
// A handler that throws changes nothing, including the clock. The App has no
// scheduler: an offer expires only when offers.expire is applied.
const {fail, entry: named} = require('./domain-utils.cjs');
const APP = require('../app.json').app_id;
const ledger = require('./ledger.cjs');
const queue = require('./queue.cjs');

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const normal = meetings => meetings.map(m => ({days: m.days.slice(), start: m.start, end: m.end}));
// The same weekly times, however they are written: days and meetings in any
// order, one meeting on two days or two meetings on a day each, a meeting twice.
const slots = meetings => [...new Set(meetings.flatMap(m => m.days.map(day => day + ' ' + m.start + '-' + m.end)))].sort();
const sameMeetings = (a, b) => JSON.stringify(slots(a)) === JSON.stringify(slots(b));

// occupancy.change moves a synthetic competitor through the shared ledger.
// The signed-in student acts only through the Agent's tools.
function competitor(data, payload) {
  if (payload.occupant_ref === data.student.id) {
    fail('invalid_event', 'occupancy.change acts on synthetic competitors only; ' + payload.occupant_ref + ' is the signed-in student.');
  }
  return payload.occupant_ref;
}
function unused(data, id, what) {
  if (ledger.collections(data).flat().some(row => row.id === id)) fail('invalid_event', what + ' ID ' + id + ' is already in use.');
  return id;
}
function bundleOf(data, sectionIds) {
  const bundle = ledger.resolveBundle(ledger.index(data), sectionIds);
  if (bundle.missing) fail('not_found', 'Section ' + bundle.missing + ' does not exist in this term.');
  if (bundle.problem) fail('invalid_bundle', bundle.problem);
  return bundle;
}
// A competitor's offer that can still be answered. The expiry boundary is the
// same for everyone: from expires_at on it can be neither accepted nor declined.
function theirOffer(data, payload, now) {
  const offer = data.offers.find(o => o.id === payload.offer_id);
  const entry = offer && data.waitlist_entries.find(e => e.id === offer.entry_id);
  if (!entry || entry.occupant_ref !== payload.occupant_ref) fail('not_found', 'Offer ' + payload.offer_id + ' was not made to ' + payload.occupant_ref + '.');
  if (offer.status !== 'live') fail('offer_not_live', 'Offer ' + offer.id + ' is no longer open (' + offer.status + ').');
  if (queue.expired(offer, now)) fail('offer_expired', 'Offer ' + offer.id + ' expired at ' + offer.expires_at + '.');
  return {offer, entry};
}
const holds = (data, occupant, courseId) => data.enrollments.some(e => e.status === ledger.ACTIVE && e.occupant_ref === occupant && e.course_id === courseId);

const OCCUPANCY = {
  // Releases the complete bundle; capacity limits do not change.
  withdraw(ctx, data, payload, eventId) {
    const row = data.enrollments.find(e => e.id === payload.enrollment_id && e.occupant_ref === payload.occupant_ref);
    if (!row) fail('not_found', 'Enrollment ' + payload.enrollment_id + ' is not held by ' + payload.occupant_ref + '.');
    if (row.status !== ledger.ACTIVE) fail('invalid_state', 'Enrollment ' + row.id + ' is no longer held (' + row.status + ').');
    row.status = 'withdrawn';
    row.ended_at = ctx.virtual_now;
    queue.cancelPendingSwaps(ctx, data, row, 'source_withdrawn', 'the enrollment it would have replaced was withdrawn', eventId);
  },
  // Takes the seats if every section of the bundle has one; otherwise nothing changes.
  enroll(ctx, data, payload) {
    const bundle = bundleOf(data, payload.section_ids), table = ledger.seats(data);
    if (holds(data, payload.occupant_ref, bundle.course.id)) fail('duplicate_enrollment', payload.occupant_ref + ' is already enrolled in ' + bundle.course.code + '.');
    const full = bundle.sections.filter(s => table.get(s.id).available < 1).map(s => s.id);
    if (full.length) fail('section_full', 'No seat is available in ' + full.join(', ') + '.');
    const fresh = ledger.allocate(data, 'enr');
    data.enrollments.push({id: payload.enrollment_id === undefined ? fresh.id : unused(data, payload.enrollment_id, 'Enrollment'), seq: fresh.seq,
      occupant_ref: payload.occupant_ref, course_id: bundle.course.id, section_ids: bundle.sections.map(s => s.id), status: 'enrolled',
      enrolled_at: ctx.virtual_now, ended_at: null});
  },
  // Joins behind everyone already waiting. The same policy applies as to the
  // student: there is no queue for a bundle that has seats.
  waitlist_join(ctx, data, payload) {
    const bundle = bundleOf(data, payload.section_ids), table = ledger.seats(data), ids = bundle.sections.map(s => s.id);
    if (data.waitlist_entries.some(e => queue.waiting(e) && e.occupant_ref === payload.occupant_ref && sameSet(e.section_ids, ids))) {
      fail('invalid_state', payload.occupant_ref + ' is already waiting for this bundle.');
    }
    if (holds(data, payload.occupant_ref, bundle.course.id)) fail('swap_required', payload.occupant_ref + ' is already enrolled in ' + bundle.course.code + '.');
    if (ids.every(id => table.get(id).available > 0)) fail('seats_available', 'A seat is available in every section of this bundle; there is nothing to wait for.');
    const fresh = ledger.allocate(data, 'wl');
    data.waitlist_entries.push({id: payload.entry_id === undefined ? fresh.id : unused(data, payload.entry_id, 'Waitlist entry'), seq: fresh.seq,
      occupant_ref: payload.occupant_ref, course_id: bundle.course.id, section_ids: ids, swap_from_enrollment_id: null, status: 'queued',
      joined_at: ctx.virtual_now, ended_at: null, end_reason: null, blocked_reason: null});
  },
  waitlist_leave(ctx, data, payload) {
    const entry = data.waitlist_entries.find(e => e.id === payload.entry_id && e.occupant_ref === payload.occupant_ref);
    if (!entry) fail('not_found', 'Waitlist entry ' + payload.entry_id + ' does not belong to ' + payload.occupant_ref + '.');
    if (!queue.waiting(entry)) fail('invalid_state', 'Waitlist entry ' + entry.id + ' has already left the queue (' + entry.status + ').');
    const offer = queue.liveOffer(data, entry);
    if (offer) queue.endOffer(offer, 'cancelled', ctx.virtual_now);
    queue.endEntry(entry, 'left', ctx.virtual_now);
  },
  offer_accept(ctx, data, payload) {
    const {offer, entry} = theirOffer(data, payload, ctx.virtual_now);
    if (data.enrollments.some(e => e.status === ledger.ACTIVE && e.occupant_ref === entry.occupant_ref && e.course_id === entry.course_id
      && e.id !== entry.swap_from_enrollment_id)) {
      fail('duplicate_enrollment', entry.occupant_ref + ' is already enrolled in this course.');
    }
    queue.fulfil(ctx, data, entry, offer);
  },
  offer_decline(ctx, data, payload) {
    const {offer, entry} = theirOffer(data, payload, ctx.virtual_now);
    queue.endOffer(offer, 'declined', ctx.virtual_now);
    queue.endEntry(entry, 'declined', ctx.virtual_now);
  }
};

function occupancyChange(ctx, data, event) {
  competitor(data, event.payload);
  const change = named(OCCUPANCY, event.payload.change);
  if (!change) fail('invalid_event', 'occupancy.change does not know the change ' + event.payload.change + '.');
  change(ctx, data, event.payload, event.event_id);
}

// The section meets at new times. Its version goes up and the old times are
// kept in its history with the event that replaced them. No enrollment is
// dropped: an overlap this creates stays in the schedule and is attributed to
// the event. The student is told when a section they hold or wait for moved.
function sectionReschedule(ctx, data, event) {
  const {section_id: id, meetings} = event.payload, now = ctx.virtual_now;
  const section = data.sections.find(s => s.id === id);
  if (!section) fail('not_found', 'Section ' + id + ' does not exist in this term.');
  const backwards = meetings.find(m => !(m.start < m.end));
  if (backwards) fail('invalid_event', 'A meeting must start before it ends: ' + ledger.meetingText([backwards]) + '.');
  if (sameMeetings(section.meetings, meetings)) fail('invalid_event', 'Section ' + id + ' already meets at these times.');
  const from = section.version, was = section.meetings;
  section.history.push({version: from, meetings: was, replaced_at: now, event_id: event.event_id});
  section.meetings = normal(meetings);
  section.version = from + 1;

  const idx = ledger.index(data), self = data.student.id, course = idx.courses.get(section.course_id);
  const moved = course.code + ' ' + section.label + ' now meets ' + ledger.meetingText(meetings) + ' (was ' + ledger.meetingText(was) + ').';
  const refs = {event_id: event.event_id, course_id: course.id, section_id: section.id, from_version: from, to_version: section.version};
  const held = ledger.activeEnrollments(data, self);
  const enrollment = held.find(e => e.section_ids.includes(section.id));
  if (enrollment) {
    const others = ledger.scheduleSections(idx, held).filter(s => s.id !== section.id && ledger.sectionsConflict(section, s));
    ledger.addNotice(data, now, 'section_rescheduled', moved + (others.length
      ? ' It now overlaps ' + others.map(s => idx.courses.get(s.course_id).code + ' ' + s.label).join(' and ') + '. Your enrollments are unchanged; the overlap is yours to resolve.'
      : ' Your enrollment is unchanged.'), {...refs, enrollment_id: enrollment.id});
  }
  for (const entry of data.waitlist_entries) {
    if (!queue.own(data, entry) || !queue.waiting(entry) || !entry.section_ids.includes(section.id)) continue;
    const offer = queue.liveOffer(data, entry);
    ledger.addNotice(data, now, 'section_rescheduled', moved + ' You are waiting for a bundle that includes it'
      + (offer ? ' and hold offer ' + offer.id + ', which stays open; accepting is checked against the new times.' : '; your place in the queue is unchanged.'),
      {...refs, entry_id: entry.id, ...(offer ? {offer_id: offer.id} : {})});
  }
}

// Closes every offer whose deadline has been reached, in the order the offers
// were issued, releases its seats and takes its entry out of the queue. Infra
// sends this at each offer deadline; when nothing is due it closes nothing.
function offersExpire(ctx, data, event) {
  const now = ctx.virtual_now, idx = ledger.index(data);
  const due = data.offers.filter(o => o.status === 'live' && queue.expired(o, now)).sort((a, b) => a.seq - b.seq);
  for (const offer of due) {
    const entry = data.waitlist_entries.find(e => e.id === offer.entry_id);
    queue.endOffer(offer, 'expired', now);
    queue.endEntry(entry, 'expired', now);
    if (!queue.own(data, entry)) continue;
    ledger.addNotice(data, now, 'offer_expired',
      'Offer ' + offer.id + ' for ' + ledger.bundleLabel(idx, entry.section_ids) + ' expired at ' + offer.expires_at
      + ' without being accepted. Its seat was released and your waitlist entry has left the queue.'
      + (entry.swap_from_enrollment_id ? ' Enrollment ' + entry.swap_from_enrollment_id + ' is unchanged.' : ''),
      {event_id: event.event_id, course_id: entry.course_id, entry_id: entry.id, offer_id: offer.id, expires_at: offer.expires_at,
        ...(entry.swap_from_enrollment_id ? {enrollment_id: entry.swap_from_enrollment_id} : {})});
  }
}

const HANDLERS = {'occupancy.change': occupancyChange, 'section.reschedule': sectionReschedule, 'offers.expire': offersExpire};

// Every event ends by re-checking the queues: seats may have been freed, and
// an entry's eligibility may have changed with a section's times.
function applyEvent(ctx, data, event) {
  const operation = event.operation.startsWith(APP + '.') ? event.operation.slice(APP.length + 1) : event.operation;
  const handler = named(HANDLERS, operation);
  if (!handler) fail('invalid_event', 'Operation ' + event.operation + ' is not accepted by this App version.');
  // An event dated before the ledger's latest record would rewrite history out of order.
  const last = ledger.aheadOfClock(data, ctx.virtual_now);
  if (last !== null) fail('invalid_event', 'This ledger holds records dated up to ' + last + '; an event cannot be applied at an earlier time.');
  handler(ctx, data, event);
  queue.recheck(ctx, data, event.event_id);
  return data;
}

module.exports = {applyEvent};
