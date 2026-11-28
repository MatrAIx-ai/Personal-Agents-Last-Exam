'use strict';
// Pure business rules. Nothing here writes; time effects are computed from
// stored due times and the supplied clock (ctx.virtual_now).
const {fail} = require('./domain-utils.cjs');
const {DAY, ms, at, iso, addDays, localDate} = require('./clock.cjs');

const RELEASE_DAYS = 180;
const RELEASE_TIME = '07:00';
const HOLD_MINUTES = 15;
const NO_SHOW_TIME = '21:00';
const LATE_RELEASE_TIME = '12:00';
const CHECKOUT_TIME = '12:00';
const REFUND_DELAY_DAYS = 3;

const byId = (list, id, code = 'not_found', what = 'Record') => {
  const item = list.find(x => x.id === id);
  if (!item) fail(code, `${what} does not exist.`);
  return item;
};
const facility = (data, id) => byId(data.facilities, id, 'not_found', 'Facility');
const site = (data, id) => byId(data.sites, id, 'not_found', 'Site');
const policy = (data, id) => byId(data.policies, id, 'invalid_seed', 'Policy');
const reservation = (data, id) => byId(data.reservations, id, 'not_found', 'Reservation');
const offsetOf = (data, siteOrFacility) =>
  facility(data, siteOrFacility.facility_id || siteOrFacility.id).utc_offset;

// ---- Alerts and closures -------------------------------------------------

function alertActive(alert, now) {
  const end = alert.cancelled_at ? Math.min(ms(alert.to), ms(alert.cancelled_at)) : ms(alert.to);
  return ms(alert.from) <= now && now < end;
}

function covers(record, s) {
  return record.facility_id === s.facility_id && (!record.site_ids.length || record.site_ids.includes(s.id));
}

// A stay occupies its sites from 00:00 on arrival to 00:00 on departure, facility time.
function stayWindow(data, r) {
  const off = facility(data, r.facility_id).utc_offset;
  return [at(r.arrival, '00:00', off), at(r.departure, '00:00', off)];
}

function affectedBy(data, r, now) {
  const s = site(data, r.site_id), [start, end] = stayWindow(data, r);
  return data.alerts.filter(a => alertActive(a, now) && covers(a, s) &&
    ms(a.from) < end && start < Math.min(ms(a.to), a.cancelled_at ? ms(a.cancelled_at) : Infinity))
    .map(a => a.id);
}

function closureFor(data, s, date) {
  return data.closures.find(c => covers(c, s) && c.from <= date && date < c.to) || null;
}

function outageAt(data, s, now) {
  return data.alerts.some(a => a.kind === 'electrical_outage' && alertActive(a, now) && covers(a, s));
}

// ---- Reservation lifecycle ------------------------------------------------

function releaseAt(data, r) {
  const off = facility(data, r.facility_id).utc_offset;
  return r.late_arrival ? at(addDays(r.arrival, 1), LATE_RELEASE_TIME, off) : at(r.arrival, NO_SHOW_TIME, off);
}

// The stored state plus any transition whose due time has passed.
function currentState(data, r, now) {
  const off = facility(data, r.facility_id).utc_offset;
  if (r.state === 'confirmed' && now >= releaseAt(data, r)) return 'no_show';
  if (r.state === 'checked_in' && now >= at(r.departure, CHECKOUT_TIME, off)) return 'completed';
  return r.state;
}

const LIVE = new Set(['confirmed', 'checked_in']);

// ---- Night availability ----------------------------------------------------

function holdActive(h, now) {
  return h.status === 'active' && now < ms(h.expires_at);
}

function nightState(data, s, date, now, {ignoreHold = null, ignoreReservation = null} = {}) {
  const off = offsetOf(data, s);
  if (now < at(addDays(date, -RELEASE_DAYS), RELEASE_TIME, off)) return 'unreleased';
  if (closureFor(data, s, date)) return 'closed';
  const booked = data.reservations.some(r => r.id !== ignoreReservation && r.site_id === s.id &&
    LIVE.has(currentState(data, r, now)) && r.nights.includes(date));
  if (booked || data.claims.some(c => c.site_id === s.id && c.nights.includes(date))) return 'booked';
  if (data.holds.some(h => h.id !== ignoreHold && h.site_id === s.id && holdActive(h, now) && h.nights.includes(date))) return 'held';
  return 'open';
}

function requireOpen(data, s, dates, now, options) {
  const today = localDate(now, offsetOf(data, s));
  for (const date of dates) {
    if (date < today) fail('night_in_past', `The night of ${date} has already passed.`);
    const state = nightState(data, s, date, now, options);
    if (state === 'unreleased') fail('not_yet_released', `The night of ${date} is not released yet.`);
    if (state === 'closed') fail('site_closed', `The site is closed on ${date}.`);
    if (state !== 'open') fail('site_taken', `The night of ${date} is not available.`);
  }
}

// ---- Prices, rungs and refunds ---------------------------------------------

function price(s, dates) {
  return dates.map(() => s.nightly_cents);
}

function rungs(data, r) {
  const p = policy(data, r.policy_id), off = facility(data, r.facility_id).utc_offset;
  return p.rungs.map((rung, index) => ({index, rung,
    ends_at: rung.ends ? at(addDays(r.arrival, -rung.ends.days_before), rung.ends.time, off) : null}));
}

function currentRung(data, r, now) {
  return rungs(data, r).find(x => x.ends_at === null || now < x.ends_at);
}

function nextRungChange(data, r, now) {
  const x = currentRung(data, r, now);
  return x.ends_at === null ? null : iso(x.ends_at, facility(data, r.facility_id).utc_offset);
}

function cancelRefund(r, rung) {
  const c = rung.cancel;
  const kept = c.fee_cents + (c.first_night ? r.nightly_cents[0] : 0) + Math.round(r.total_cents * c.percent_kept / 100);
  return Math.max(0, r.total_cents - kept);
}

function changeFee(r, rung) {
  const c = rung.change;
  if (!c.allowed) return null;
  return c.fee_cents + Math.round(r.total_cents * c.percent / 100);
}

// ---- Cards ----------------------------------------------------------------

function cardExpired(card, now) {
  // Valid through the last day of its expiry month (UTC).
  return now >= Date.UTC(card.exp_year, card.exp_month, 1);
}

function cardLabel(card) {
  return `${card.brand} ending ${card.last4}`;
}

module.exports = {
  RELEASE_DAYS, RELEASE_TIME, HOLD_MINUTES, REFUND_DELAY_DAYS, DAY, LIVE,
  byId, facility, site, policy, reservation, offsetOf, localDate,
  alertActive, covers, affectedBy, closureFor, outageAt, stayWindow,
  releaseAt, currentState, holdActive, nightState, requireOpen,
  price, rungs, currentRung, nextRungChange, cancelRefund, changeFee, cardExpired, cardLabel,
};
