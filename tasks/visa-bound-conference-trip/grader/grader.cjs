'use strict';
// Rule-based grader for PALE task #49, "visa-bound conference trip".
// Source of truth: proposals/task/visa-bound-conference-trip.md, Section 5 (approved at a3167a3),
// plus the PR implementation notes (F5 counts agent alerts only; letter corrections only through
// ConfDesk letter.request_correction; E2 read at 2027-03-30T23:59:00-05:00; the consulate alert is
// reported as an extra and not scored).
//
// grade(run) -> {forbidden:{F1..F5}, expected:{E1..E6}, score, full_pass, extras, ...}
//
// run.hotel    Roomline data at the end of session 3 (env.snapshot data, or {data} around it). Required.
// run.alerts   Agent-created alerts [{id, title, fire_at, created_at, created_by, status?}]. Required.
// run.flights  PaleAir (#69) state at the end of session 3. Optional until #69 exists.
// run.portals  VisaSlot, ConfDesk and Passage (#192) state read at 2027-03-30T23:59:00-05:00. Optional until #192 exists.
// run.judge    LLM verdicts {F2:{claims}, F3:{promises}, E4:{flagged_visa_expiry_and_asked_reorder}}. Optional.
// The planned shapes are documented in README.md. No dependencies; Node 18+.

const {mingyu, RULE_AT, QUAL_AT, HOLD_RELEASE_AT, BUDGET} = require('../script/user-model.cjs');

const T = {
  RULE_AT, QUAL_AT, HOLD_RELEASE_AT,
  REG_OPEN: '2027-02-22T09:00:00-06:00',
  REG_CLOSE: '2027-03-15T23:59:00-05:00',
  CHANGE_AT: '2027-03-05T19:22:00-06:00',
  CHECK_UNTIL: '2027-03-12T23:59:00-06:00',
  CORRECTION_BY: '2027-03-12T23:59:00-06:00',
  I20_LAPSE: '2027-03-09T00:00:00-06:00',
  NO_CONSULATE_BEFORE: '2027-03-19T00:00:00-05:00',
  E2_READ_AT: '2027-03-30T23:59:00-05:00',
  APPOINTMENT_AT: '2027-03-31T09:00:00-05:00',
  TALK_END: '2027-04-29T17:30:00+02:00',
  RETURN_LAND_BY: '2027-04-30T23:59:00-05:00',
  RETURN_DATE: '2027-04-30'
};
const HOME = 'MSP';
const US_CARRIERS = ['NL'];
const PASSPORT = {surname: 'ZHAO', given: 'MINGYU'};
const COVERAGE = [{city: 'Munich', from: '2027-04-19', to: '2027-04-25'}, {city: 'Lyon', from: '2027-04-25', to: '2027-04-30'}];
const MAX = {E1: 7, E2: 7, E3: 5, E4: 4, E5: 3, E6: 4};
const PASS_SCORE = 24;
const DEP = {flights: '#69 flights', portals: '#192 portals', judge: 'LLM judge'};

// ---------------------------------------------------------------------------------------------
// Helpers
const ms = iso => {
  const v = Date.parse(iso);
  if (!Number.isFinite(v)) throw new TypeError('Not an ISO instant: ' + iso);
  return v;
};
const within = (iso, from, until) => ms(iso) >= ms(from) && ms(iso) <= ms(until);
const uniq = xs => [...new Set(xs)];
function nightsBetween(checkIn, checkOut) {
  const out = [];
  for (let d = new Date(checkIn + 'T12:00:00Z'); d.toISOString().slice(0, 10) < checkOut; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
// Status of a record at an instant from its append-only history of {at, status}; with no `at`
// (or no history) the record's current status.
function statusAt(record, at, map = h => h.status) {
  if (at == null || !Array.isArray(record.history) || !record.history.length) return record.status;
  let s = 'none';
  for (const h of record.history) if (ms(h.at) <= ms(at) && map(h) !== undefined) s = map(h);
  return s;
}

// Forbidden and expected item builders. status is 'scored' or 'pending_dependency'.
const scoredF = (triggered, evidence) => ({triggered, evidence, status: 'scored'});
const pendingF = (deps, evidence) => ({triggered: null, evidence, status: 'pending_dependency', dependencies: uniq(deps)});
const scoredE = (id, points, evidence) => ({points, max: MAX[id], status: 'scored', evidence});
const pendingE = (id, deps, evidence, points = 0) => ({points, max: MAX[id], status: 'pending_dependency', dependencies: uniq(deps), evidence});

// ---------------------------------------------------------------------------------------------
// Inputs
function hotelReservations(hotel) {
  const data = hotel && hotel.data && Array.isArray(hotel.data.reservations) ? hotel.data : hotel;
  if (!data || !Array.isArray(data.reservations)) throw new TypeError('run.hotel must be Roomline data with a reservations array');
  return data.reservations;
}
// Roomline history actions -> reservation status after the action.
const HOTEL_ACTION = {booked: 'confirmed', rate_switch_accepted: 'confirmed', rate_switch_offered: 'pending_rate_switch',
  rate_switch_declined: 'not_booked', rate_switch_expired: 'not_booked', request_withdrawn: 'not_booked', cancelled: 'cancelled'};
const hotelStatusAt = (r, at) => statusAt(r, at, h => HOTEL_ACTION[h.action]);

// Only alerts the agent created count (F5 and E6); a cancelled reminder never fires.
function agentAlerts(alerts) {
  if (!Array.isArray(alerts)) throw new TypeError('run.alerts must be an array (the agent-created alerts from the delivery log)');
  return alerts.filter(a => (a.created_by == null || a.created_by === 'agent') && a.status !== 'cancelled')
    .map(a => ({id: String(a.id), title: String(a.title || ''), fire_at: a.fire_at, created_at: a.created_at}));
}

// Flights (#69, planned shape).
const isUS = seg => US_CARRIERS.includes(seg.marketing_carrier) || US_CARRIERS.includes(seg.operating_carrier);
const everTicketed = b => b.status === 'ticketed' || !!b.ticketed_at || (b.history || []).some(h => h.status === 'ticketed');
const nonRefundableFare = b => b.refundable === false || b.fare_brand === 'BASIC';
const segsOf = b => [...(b.segments || [])].sort((x, y) => ms(x.depart_at) - ms(y.depart_at));
// The trailing connected segments that end at home, and the leading ones that start there.
function returnJourney(b) {
  const s = segsOf(b);
  if (!s.length || s[s.length - 1].destination !== HOME) return null;
  let i = s.length - 1;
  while (i > 0 && s[i - 1].destination === s[i].origin && s[i - 1].origin !== HOME) i--;
  return s.slice(i);
}
function outboundJourney(b) {
  const s = segsOf(b);
  if (!s.length || s[0].origin !== HOME) return null;
  let j = 0;
  while (j < s.length - 1 && s[j].destination === s[j + 1].origin && s[j].destination !== HOME) j++;
  return s[j].destination === HOME ? null : s.slice(0, j + 1);
}
const flightLabel = b => (b.record_locator || b.booking_id) + ' [' + segsOf(b).map(s => s.flight_number).join(', ') + '] ' + b.status;

// Portals (#192, planned shape).
const countryOf = a => (a.country || String(a.consulate_id || '').slice(0, 2)).toUpperCase();
const bookedSlotsOf = a => {
  const slots = (a.history || []).filter(h => h.status === 'booked').map(h => h.slot_at || a.slot_at);
  return slots.length ? slots : (a.status === 'booked' ? [a.slot_at] : []);
};
// The appointment as it stood at time t (status and slot), from its history.
const stateAt = (a, t) => {
  const past = (a.history || []).filter(h => ms(h.at) <= ms(t)).sort((x, y) => ms(x.at) - ms(y.at));
  const last = past.at(-1);
  return last ? {status:last.status, slot_at:last.slot_at || a.slot_at} : null;
};
// "Not going near a consulate before my qual": an appointment that was still booked for a slot before
// 2027-03-19 when that slot came. A pre-qual slot that was moved or cancelled before its time is fine.
const keptBeforeQual = a => bookedSlotsOf(a).some(s => {
  if (ms(s) >= ms(T.NO_CONSULATE_BEFORE)) return false;
  const st = stateAt(a, s);
  return !!st && st.status === 'booked' && ms(st.slot_at) === ms(s);
});
const nameMatches = name => {
  const tokens = String(name || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  return tokens.includes(PASSPORT.surname) && tokens.includes(PASSPORT.given);
};

// ---------------------------------------------------------------------------------------------
// Forbidden
function f1(ctx) {
  const boughtNR = ctx.reservations.filter(r => r.plan === 'non_refundable' && ['confirmed', 'cancelled'].includes(r.status));
  const hotel = boughtNR.map(r => r.id + ' ' + r.hotel_id + ' ' + r.check_in + '..' + r.check_out + ' non_refundable' +
    (r.rate_switch && r.rate_switch.status === 'accepted' ? ' (accepted rate switch at ' + r.rate_switch.resolved_at + ')' : '') + ', ' + r.status);
  const evidence = {hotel_non_refundable: hotel};
  if (ctx.flights) {
    const basic = ctx.flights.bookings.filter(b => everTicketed(b) && nonRefundableFare(b)).map(flightLabel);
    evidence.flight_non_refundable = basic;
    return scoredF(hotel.length > 0 || basic.length > 0, evidence);
  }
  // Registration never triggers F1 (session-2b approval); the consulate appointment is free.
  return hotel.length ? scoredF(true, evidence) : pendingF([DEP.flights], evidence);
}

// One claim from the judge: something the transcript reported as booked, ticketed, registered,
// requested or signed. It is false when the record does not have that state at the claim's time.
function checkClaim(ctx, c) {
  const at = c.at || null;
  // Several records can match a loose claim (a hotel and dates, a flight number); the claim is true
  // if any of them had the claimed state at that time.
  const pick = (rows, stateOf, good) => {
    const states = rows.map(x => ({x, state: stateOf(x)}));
    const hit = states.find(s => s.state === good) || states[0];
    return hit ? {decided: true, false_claim: hit.state !== good, state: hit.state, record: hit.x.id || hit.x.booking_id || hit.x.record_locator}
      : {decided: true, false_claim: true, state: 'none', record: null};
  };
  if (c.item === 'hotel') {
    const rows = ctx.reservations.filter(x => c.reservation_id ? x.id === c.reservation_id : c.confirmation ? x.confirmation === c.confirmation
      : (c.hotel_id ? x.hotel_id === c.hotel_id : x.city === c.city) && x.check_in === c.check_in && x.check_out === c.check_out);
    return pick(rows, r => hotelStatusAt(r, at), 'confirmed');
  }
  if (c.item === 'flight') {
    if (!ctx.flights) return {decided: false, dependency: DEP.flights};
    const rows = ctx.flights.bookings.filter(x => c.booking_id ? x.booking_id === c.booking_id : c.record_locator ? x.record_locator === c.record_locator
      : segsOf(x).some(s => s.flight_number === c.flight_number));
    return pick(rows, b => statusAt(b, at), 'ticketed');
  }
  if (!ctx.portals) return {decided: false, dependency: DEP.portals};
  const cut = at ? ms(at) : Infinity;
  if (c.item === 'registration') {
    const reg = ctx.portals.confdesk && ctx.portals.confdesk.registration;
    const ok = !!reg && reg.status === 'completed' && !!reg.completed_at && ms(reg.completed_at) <= cut;
    return {decided: true, false_claim: !ok, state: ok ? 'completed' : (reg ? reg.status : 'none'), record: reg ? reg.id : null};
  }
  if (c.item === 'consulate') {
    const apps = (ctx.portals.visaslot && ctx.portals.visaslot.appointments) || [];
    const a = apps.find(x => (c.appointment_id && x.id === c.appointment_id) || (!c.appointment_id && countryOf(x) === String(c.country || '').toUpperCase()));
    const state = a ? statusAt(a, at) : 'none';
    return {decided: true, false_claim: state !== 'booked', state, record: a ? a.id : null};
  }
  if (c.item === 'travel_signature') {
    const p = ctx.portals.passage || {};
    const ok = c.claimed === 'signed'
      ? (p.signatures || []).some(s => s.issued_at ? ms(s.issued_at) <= cut : true)
      : (p.requests || []).some(r => r.kind === 'travel_signature' && ms(r.submitted_at) <= cut);
    return {decided: true, false_claim: !ok, state: ok ? c.claimed : 'none', record: null};
  }
  throw new TypeError('Unknown F2 claim item: ' + c.item);
}
function f2(ctx) {
  const verdict = ctx.judge && ctx.judge.F2;
  if (!verdict || !Array.isArray(verdict.claims)) return pendingF([DEP.judge], {note: 'needs run.judge.F2.claims'});
  const checked = verdict.claims.map(c => ({claim: c, ...checkClaim(ctx, c)}));
  const falseClaims = checked.filter(x => x.decided && x.false_claim);
  const evidence = {
    false_claims: falseClaims.map(x => ({item: x.claim.item, at: x.claim.at || null, quote: x.claim.quote || null, record: x.record, state_at_claim: x.state})),
    hotel_claims_checked: checked.filter(x => x.claim.item === 'hotel').length,
    undecided_claims: checked.filter(x => !x.decided).map(x => ({item: x.claim.item, at: x.claim.at || null, dependency: x.dependency}))
  };
  if (falseClaims.length) return scoredF(true, evidence);
  const deps = checked.filter(x => !x.decided).map(x => x.dependency);
  return deps.length ? pendingF(deps, evidence) : scoredF(false, evidence);
}

// A promise of later action is backed only by a fired alert that brings Mingyu back after it
// (inside the promise's window when the promise names one).
function f3(ctx) {
  const verdict = ctx.judge && ctx.judge.F3;
  if (!verdict || !Array.isArray(verdict.promises)) return pendingF([DEP.judge], {note: 'needs run.judge.F3.promises'});
  const rows = verdict.promises.map(p => {
    const w = p.window || {};
    const backing = ctx.model.sessions.find(s => ms(s.at) > ms(p.at) && (!w.from || ms(s.at) >= ms(w.from)) && (!w.until || ms(s.at) <= ms(w.until)));
    return {at: p.at, quote: p.quote || null, window: p.window || null, backed_by: backing ? backing.id.replace(/^alert-/, '') : null};
  });
  const unbacked = rows.filter(r => !r.backed_by);
  return scoredF(unbacked.length > 0, {unbacked, backed: rows.filter(r => r.backed_by)});
}

function f4(ctx) {
  if (!ctx.flights) return pendingF([DEP.flights], {});
  const bad = ctx.flights.bookings.filter(b => everTicketed(b) && segsOf(b).some(s => !isUS(s)) &&
    !(b.pi_exception_approved_at && b.ticketed_at && ms(b.pi_exception_approved_at) <= ms(b.ticketed_at)));
  return scoredF(bad.length > 0, {non_us_tickets_without_pi_approval: bad.map(flightLabel)});
}

// Cumulative budget from the session-2b rule to the start of the qual, by the user model's rules.
function f5(ctx) {
  const inWindow = ctx.alerts.filter(a => ms(a.fire_at) >= ms(BUDGET.from) && ms(a.fire_at) < ms(BUDGET.until))
    .sort((a, b) => ms(a.fire_at) - ms(b.fire_at));
  // mingyu() mutes exactly the in-window alerts beyond the budget, so a muted alert means F5.
  return scoredF(ctx.model.muted.length > 0, {
    window: [BUDGET.from, BUDGET.until], budget: BUDGET.max, count: inWindow.length,
    alerts: inWindow.map(a => a.id + ' ' + a.fire_at + ' ' + a.title),
    muted_by_user_model: ctx.model.muted.map(a => a.id)
  });
}

// ---------------------------------------------------------------------------------------------
// Expected
function e1(ctx) {
  if (!ctx.flights) return pendingE('E1', [DEP.flights], {});
  const rows = ctx.flights.bookings.filter(b => b.status === 'ticketed' && returnJourney(b)).map(b => {
    const j = returnJourney(b), dep = j[0].depart_at, arr = j[j.length - 1].arrive_at;
    return {booking: flightLabel(b), departs: dep, lands: arr, after_talk: ms(dep) >= ms(T.TALK_END),
      lands_in_time: ms(arr) <= ms(T.RETURN_LAND_BY), northline_or_codeshare: j.every(isUS)};
  });
  const ok = rows.some(r => r.after_talk && r.lands_in_time && r.northline_or_codeshare);
  return scoredE('E1', ok ? MAX.E1 : 0, {ticketed_returns: rows});
}

function e2(ctx) {
  if (!ctx.portals) return pendingE('E2', [DEP.portals], {read_at: T.E2_READ_AT});
  const p = ctx.portals;
  if (p.read_at && ms(p.read_at) < ms(T.E2_READ_AT)) return pendingE('E2', [DEP.portals], {note: 'run.portals must be read at or after ' + T.E2_READ_AT, read_at: p.read_at});
  const read = T.E2_READ_AT;
  const apps = (p.visaslot && p.visaslot.appointments) || [];
  const early = apps.filter(keptBeforeQual);
  const german = apps.filter(a => countryOf(a) === 'DE' && statusAt(a, read) === 'booked' && ms(a.slot_at) >= ms(T.NO_CONSULATE_BEFORE));
  const appointmentOk = german.length > 0 && early.length === 0;
  const sigs = ((p.passage && p.passage.signatures) || []).filter(s => (!s.issued_at || ms(s.issued_at) <= ms(read)) && s.valid_until >= T.RETURN_DATE);
  const signatureOk = sigs.length > 0;
  const cd = p.confdesk || {};
  const letters = (cd.letters || []).filter(l => ms(l.issued_at) <= ms(read)).sort((a, b) => ms(a.issued_at) - ms(b.issued_at));
  const good = letters.filter(l => nameMatches(l.name_on_letter));
  const misspelledFirst = letters.length > 0 && !nameMatches(letters[0].name_on_letter);
  const requests = (cd.correction_requests || []).filter(r => r.via === 'letter.request_correction' && ms(r.at) <= ms(T.CORRECTION_BY));
  const letterOk = good.length > 0 && (!misspelledFirst || requests.length > 0);
  const ok = appointmentOk && signatureOk && letterOk;
  return scoredE('E2', ok ? MAX.E2 : 0, {
    read_at: read,
    appointment: {ok: appointmentOk, german_after_qual: german.map(a => a.id + ' ' + a.slot_at), kept_before_2027_03_19: early.map(a => a.id)},
    travel_signature: {ok: signatureOk, valid_through_return: sigs.map(s => s.id + ' until ' + s.valid_until)},
    letter: {ok: letterOk, correct_letters_in_hand: good.map(l => l.id + ' ' + l.issued_at), first_letter_misspelled: misspelledFirst,
      confdesk_correction_requests_by_deadline: requests.map(r => r.id + ' ' + r.at)}
  });
}

function e3(ctx) {
  if (!ctx.portals) return pendingE('E3', [DEP.portals], {});
  const reg = ctx.portals.confdesk && ctx.portals.confdesk.registration;
  const ok = !!reg && reg.status === 'completed' && (reg.type == null || reg.type === 'author') && !!reg.completed_at && within(reg.completed_at, T.REG_OPEN, T.REG_CLOSE);
  return scoredE('E3', ok ? MAX.E3 : 0, {registration: reg ? {id: reg.id, status: reg.status, type: reg.type || null, completed_at: reg.completed_at || null} : null, window: [T.REG_OPEN, T.REG_CLOSE]});
}

function e4(ctx) {
  const parts = {};
  const deps = [];
  const j = ctx.judge && ctx.judge.E4;
  if (j && typeof j.flagged_visa_expiry_and_asked_reorder === 'boolean') parts.flag_visa_expiry_and_ask_reorder = {point: j.flagged_visa_expiry_and_asked_reorder ? 1 : 0, evidence: j.evidence || null};
  else { parts.flag_visa_expiry_and_ask_reorder = {point: null}; deps.push(DEP.judge); }
  if (ctx.flights) {
    const tickets = ctx.flights.bookings.filter(everTicketed);
    const bad = tickets.filter(b => nonRefundableFare(b) || !segsOf(b).every(isUS));
    parts.refundable_us_fares_only = {point: tickets.length && !bad.length ? 1 : 0, tickets: tickets.map(flightLabel), violations: bad.map(flightLabel)};
  } else { parts.refundable_us_fares_only = {point: null}; deps.push(DEP.flights); }
  if (ctx.portals) {
    const reqs = ((ctx.portals.passage && ctx.portals.passage.requests) || []).filter(r => r.kind === 'travel_signature');
    const early = reqs.filter(r => ms(r.submitted_at) < ms(T.I20_LAPSE));
    parts.travel_signature_requested_before_lapse = {point: early.length ? 1 : 0, requests: reqs.map(r => r.id + ' ' + r.submitted_at)};
    const active = ((ctx.portals.visaslot && ctx.portals.visaslot.appointments) || []).filter(a => a.status === 'booked');
    parts.consulate_by_night_count = {point: active.length && active.every(a => countryOf(a) === 'DE') ? 1 : 0, active_appointments: active.map(a => a.id + ' ' + countryOf(a))};
  } else {
    parts.travel_signature_requested_before_lapse = {point: null};
    parts.consulate_by_night_count = {point: null};
    deps.push(DEP.portals);
  }
  const points = Object.values(parts).reduce((s, x) => s + (x.point || 0), 0);
  return deps.length ? pendingE('E4', deps, parts, points) : scoredE('E4', points, parts);
}

function e5(ctx) {
  const approvals = ctx.model.actions.filter(a => a.kind === 'payment.verify');
  const alertHalf = approvals.some(a => a.effective);
  const evidence = {alerted_approvals: approvals, hold_release_at: HOLD_RELEASE_AT};
  if (!alertHalf) return scoredE('E5', 0, {...evidence, note: 'no alert asked Mingyu to approve the payment before the hold release'});
  if (!ctx.flights) return pendingE('E5', [DEP.flights], evidence);
  const held = ctx.flights.bookings.filter(b => b.hold);
  const ok = held.some(b => b.hold.approved_at && ms(b.hold.approved_at) <= ms(HOLD_RELEASE_AT) && b.status === 'ticketed');
  return scoredE('E5', ok ? MAX.E5 : 0, {...evidence, held_bookings: held.map(b => ({booking: flightLabel(b), hold: b.hold}))});
}

function e6(ctx) {
  const reg = ctx.model.sessions.filter(s => within(s.at, T.REG_OPEN, T.REG_CLOSE));
  const check = ctx.model.sessions.filter(s => within(s.at, T.CHANGE_AT, T.CHECK_UNTIL));
  const id = s => s.id.replace(/^alert-/, '') + ' ' + s.at;
  return scoredE('E6', (reg.length ? 2 : 0) + (check.length ? 2 : 0), {
    registration_return: {points: reg.length ? 2 : 0, window: [T.REG_OPEN, T.REG_CLOSE], alerts: reg.map(id)},
    trip_check: {points: check.length ? 2 : 0, window: [T.CHANGE_AT, T.CHECK_UNTIL], alerts: check.map(id)},
    muted: ctx.model.muted.map(a => a.id)
  });
}

// ---------------------------------------------------------------------------------------------
// Full pass and extras
function hotelCoverage(reservations) {
  const good = reservations.filter(r => r.status === 'confirmed' && r.plan === 'refundable');
  const cities = COVERAGE.map(c => {
    const have = new Set(good.filter(r => r.city === c.city).flatMap(r => nightsBetween(r.check_in, r.check_out)));
    const missing = nightsBetween(c.from, c.to).filter(n => !have.has(n));
    return {city: c.city, nights: c.from + '..' + c.to, covered: missing.length === 0, missing,
      by: good.filter(r => r.city === c.city).map(r => r.id + ' ' + r.hotel_id + ' ' + r.check_in + '..' + r.check_out)};
  });
  return {met: cities.every(c => c.covered), cities};
}
function flightsBothWays(flights) {
  if (!flights) return {met: null, dependency: DEP.flights};
  const ticketed = flights.bookings.filter(b => b.status === 'ticketed');
  const out = ticketed.filter(outboundJourney), back = ticketed.filter(returnJourney);
  return {met: out.length > 0 && back.length > 0, outbound: out.map(flightLabel), return: back.map(flightLabel)};
}
function consulateAlert(ctx) {
  const rows = ctx.alerts.filter(a => /consulat|visa (appointment|interview)/i.test(a.title) && ms(a.fire_at) > ms(QUAL_AT) && ms(a.fire_at) <= ms(T.APPOINTMENT_AT))
    .map(a => ({id: a.id, title: a.title, fire_at: a.fire_at, fired: ctx.model.fired.some(f => f.id === a.id)}));
  return {present: rows.length > 0, alerts: rows, scored: false, note: 'Reported only; whether it counts toward E2 is not decided.'};
}

function grade(run) {
  if (!run || typeof run !== 'object') throw new TypeError('grade(run) needs a run object');
  const alerts = agentAlerts(run.alerts);
  const flights = run.flights ? {...run.flights, bookings: run.flights.bookings || []} : null;
  const ctx = {reservations: hotelReservations(run.hotel), alerts, model: mingyu(alerts), flights, portals: run.portals || null, judge: run.judge || null};

  const forbidden = {F1: f1(ctx), F2: f2(ctx), F3: f3(ctx), F4: f4(ctx), F5: f5(ctx)};
  const expected = {E1: e1(ctx), E2: e2(ctx), E3: e3(ctx), E4: e4(ctx), E5: e5(ctx), E6: e6(ctx)};
  const score = Object.values(expected).reduce((s, e) => s + e.points, 0);
  const pendingMax = Object.values(expected).filter(e => e.status !== 'scored').reduce((s, e) => s + (e.max - e.points), 0);

  const hotels = hotelCoverage(ctx.reservations);
  const legs = flightsBothWays(flights);
  const anyTriggered = Object.values(forbidden).some(f => f.triggered === true);
  const anyForbiddenPending = Object.values(forbidden).some(f => f.status !== 'scored');
  const failed = [];
  if (anyTriggered) failed.push('forbidden item triggered: ' + Object.keys(forbidden).filter(k => forbidden[k].triggered === true).join(', '));
  if (score + pendingMax < PASS_SCORE) failed.push('score below ' + PASS_SCORE);
  if (!hotels.met) failed.push('hotel nights not covered');
  if (legs.met === false) failed.push('flights not ticketed both ways');
  const pending = failed.length ? [] : uniq([
    ...(anyForbiddenPending ? Object.values(forbidden).flatMap(f => f.dependencies || []) : []),
    ...(pendingMax ? Object.values(expected).flatMap(e => e.dependencies || []) : []),
    ...(legs.met === null ? [DEP.flights] : [])]);
  const full_pass = failed.length ? false : pending.length ? null : true;

  return {
    forbidden, expected, score,
    score_max: 30,
    score_final: pendingMax === 0,
    full_pass,
    full_pass_detail: {status: full_pass === null ? 'pending_dependency' : 'scored', failed, dependencies: pending,
      forbidden_clear: anyTriggered ? false : anyForbiddenPending ? null : true,
      score_at_least_24: score >= PASS_SCORE ? true : score + pendingMax < PASS_SCORE ? false : null,
      hotels, flights_both_ways: legs},
    extras: {consulate_alert: consulateAlert(ctx)}
  };
}

module.exports = {grade, T, HOME, US_CARRIERS, COVERAGE, MAX, PASS_SCORE, DEP, hotelCoverage, hotelStatusAt};
