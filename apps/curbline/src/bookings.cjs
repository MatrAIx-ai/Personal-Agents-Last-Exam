'use strict';
// Booking state shared by tools and events: history, ledger, fees, wait time, overlap flags and the
// statuses that fall due with the clock. Writes and events commit what fell due before they act;
// reads derive the same view on a copy, so reads, snapshots taken after the next commit, and graders agree.
const {fail, MIN, plus, sameFlight, flight: getFlight, nextEntryId} = require('./common.cjs');
const {ms, render} = require('./time.cjs');
const {ACTIVE, FINAL, FEES, POLICY} = require('./catalog.cjs');

const isActive = b => ACTIVE.includes(b.status);
const isFinal = b => FINAL.includes(b.status);

function history(b, {at, actor, action, from = null, to = null, details = {}, event_id = null}) {
  b.history.push({at, actor, action, from, to, details, event_id});
}
function transition(b, to, entry) {
  const from = b.status;
  b.status = to;
  b.revision++;
  history(b, {...entry, from, to});
}

// ---- ledger ----
function entry(data, b, {type, kind, amount_cents, status, at, case_id = null}) {
  const e = {entry_id: nextEntryId(data, b.booking_id), booking_id: b.booking_id, type, kind, amount_cents, status,
    payment_method_id: b.payment_method_id, created_at: at, updated_at: at, case_id};
  data.ledger.push(e);
  return e;
}
const holdOf = (data, b) => data.ledger.find(e => e.booking_id === b.booking_id && e.type === 'hold' && e.status === 'authorized') || null;
function releaseHold(data, b, at) {
  const h = holdOf(data, b);
  if (h) { h.status = 'released'; h.updated_at = at; }
  return h;
}
const charge = (data, b, kind, cents, at) => (cents > 0 ? entry(data, b, {type: 'charge', kind, amount_cents: cents, status: 'charged', at}) : null);

// ---- time rules ----
// Free wait ends 5 min after the later of arrival and the booked pickup, and for a tracked airport pickup
// no earlier than 60 min after landing. null while a tracked flight has not landed (nothing accrues).
function freeWaitEnd(data, b) {
  if (!b.arrived_at) return null;
  let end = Math.max(ms(b.arrived_at), ms(b.pickup_at)) + POLICY.free_wait_min * MIN;
  if (b.flight && b.flight_tracking) {
    const f = data.flights.find(x => sameFlight(x, b.flight));
    if (!f || !f.landed_at) return null;
    end = Math.max(end, ms(f.landed_at) + POLICY.airport_free_wait_after_landing_min * MIN);
  }
  return end;
}
function waitFee(data, b, until) {
  const end = freeWaitEnd(data, b);
  if (end === null) return 0;
  const minutes = Math.floor((ms(until) - end) / MIN);
  return minutes > 0 ? minutes * FEES.wait_per_min_cents : 0;
}
const freeUntil = b => plus(b.pickup_at, -POLICY.free_cancel_before_min);

// The fee for cancelling now, or null when the booking cannot be cancelled.
function cancelFee(data, b, now) {
  switch (b.status) {
    case 'needs_attention': return 0;
    case 'scheduled': case 'driver_assigned': return ms(now) < freeUntil(b) ? 0 : FEES.cancellation_cents;
    case 'driver_arrived': return FEES.cancellation_cents + waitFee(data, b, now);
    default: return null;
  }
}

// A booking in needs_attention lapses at its pickup time, or at the proposed time when that is later.
function lapseAt(b) {
  if (b.status !== 'needs_attention') return null;
  const proposed = b.attention?.proposed_pickup_at;
  return Math.max(ms(b.pickup_at), proposed ? ms(proposed) : 0);
}
const tz = (data, b) => data.places.find(p => p.place_id === b.pickup_place_id)?.time_zone || data.settings.time_zone;

// Commit statuses that fell due: lapsed bookings (hold released at the lapse time) and expired shares.
function settle(data, now) {
  const t = ms(now);
  for (const b of data.bookings) {
    const due = lapseAt(b);
    if (due !== null && t >= due) {
      const at = render(due, tz(data, b));
      transition(b, 'lapsed', {at, actor: 'clock', action: 'lapsed', details: {reason: b.attention.reason}});
      b.attention = null;
      releaseHold(data, b, at);
    }
  }
  for (const s of data.shares) {
    if (s.status === 'active' && t >= ms(s.until)) { s.status = 'expired'; s.ended_at = s.until; }
  }
  return data;
}

// Overlapping active bookings for the same rider are flagged, never refused.
function window(data, b) {
  const start = ms(b.pickup_at);
  return [start, start + ((b.fare?.minutes || 0) + POLICY.overlap_margin_min) * MIN];
}
function flagOverlaps(data, at, actor) {
  const active = data.bookings.filter(isActive);
  for (const b of data.bookings) {
    const before = b.overlaps_with.join();
    if (!isActive(b)) { b.overlaps_with = []; continue; }
    const [s, e] = window(data, b);
    b.overlaps_with = active.filter(o => o !== b && o.rider_person_id === b.rider_person_id)
      .filter(o => { const [s2, e2] = window(data, o); return s < e2 && s2 < e; }).map(o => o.booking_id).sort();
    if (b.overlaps_with.join() !== before && b.overlaps_with.length) {
      history(b, {at, actor, action: 'overlap_flagged', details: {overlaps_with: [...b.overlaps_with]}});
    }
  }
}

// Validate a requested transition or fail without effect.
function expect(b, statuses, code = 'invalid_transition') {
  if (!statuses.includes(b.status)) fail(code, 'Booking ' + b.booking_id + ' is ' + b.status + '.');
}

const trackedFlight = (data, b) => (b.flight && b.flight_tracking ? getFlight(data, b.flight) : null);

module.exports = {isActive, isFinal, history, transition, entry, holdOf, releaseHold, charge, freeWaitEnd, waitFee, freeUntil,
  cancelFee, lapseAt, settle, flagOverlaps, expect, trackedFlight, tz};
