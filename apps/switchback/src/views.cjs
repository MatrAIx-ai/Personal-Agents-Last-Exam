'use strict';
// Read models. Each function takes data and an instant and returns plain copies.
const R = require('./rules.cjs');
const {at, iso, addDays, nights: nightList} = require('./clock.cjs');

const copy = value => structuredClone(value);

function siteSummary(data, s, now) {
  return {
    id: s.id, facility_id: s.facility_id, name: s.name, loop: s.loop,
    electric_amps: s.electric_amps, max_vehicle_ft: s.max_vehicle_ft, ada_accessible: s.ada_accessible,
    walk_in_ft: s.walk_in_ft, max_occupancy: s.max_occupancy, pets_allowed: s.pets_allowed,
    nightly_cents: s.nightly_cents,
    electric_outage: R.outageAt(data, s, now),
  };
}

function ladder(data, r) {
  return R.rungs(data, r).map(x => ({
    rung: x.index + 1, ends_at: x.ends_at === null ? null : iso(x.ends_at),
    cancel: copy(x.rung.cancel), change: copy(x.rung.change),
  }));
}

function cardView(data, card, now) {
  return {id: card.id, label: R.cardLabel(card), holder_name: card.holder_name,
    exp_month: card.exp_month, exp_year: card.exp_year, expired: R.cardExpired(card, now),
    is_default: data.wallet.default_card_id === card.id};
}

function reservationView(data, r, now) {
  const state = R.currentState(data, r, now);
  const out = copy(r);
  out.state = state;
  out.affected_by_alerts = R.LIVE.has(state) ? R.affectedBy(data, r, now) : [];
  out.release_at = iso(R.releaseAt(data, r));
  out.ladder = ladder(data, r);
  if (R.LIVE.has(state)) {
    const rung = R.currentRung(data, r, now);
    out.current_rung = rung.index + 1;
    out.cancel_refund_now_cents = state === 'confirmed' ? R.cancelRefund(r, rung.rung) : null;
    out.next_rung_change_at = R.nextRungChange(data, r, now);
  } else {
    out.current_rung = null;
    out.cancel_refund_now_cents = null;
    out.next_rung_change_at = null;
  }
  return out;
}

function nightsFor(data, s, arrival, departure, now) {
  return nightList(arrival, departure).map(date => ({date, state: R.nightState(data, s, date, now)}));
}

function facilityView(data, f, now) {
  const p = R.policy(data, f.policy_id);
  return {id: f.id, name: f.name, region: f.region, utc_offset: f.utc_offset, description: f.description,
    policy_id: f.policy_id, policy_name: p.name,
    site_count: data.sites.filter(s => s.facility_id === f.id).length,
    active_alerts: data.alerts.filter(a => a.facility_id === f.id && R.alertActive(a, now)).map(a => copy(a)),
    closures: data.closures.filter(c => c.facility_id === f.id).map(c => copy(c))};
}

function policyText(data, f) {
  const p = R.policy(data, f.policy_id);
  return {
    facility_id: f.id, policy_id: p.id, name: p.name,
    rules: [
      `Nights are released ${R.RELEASE_DAYS} days ahead at ${R.RELEASE_TIME} facility time (UTC${f.utc_offset}).`,
      `A cart hold lasts ${R.HOLD_MINUTES} minutes; a preview is void once its hold expires or a refund rung changes.`,
      'The booking form checks only equipment length, party size and pets. Other site attributes are listed on the site page; attribute filters are off by default and an unknown attribute never matches a filter.',
      'Without check-in, the site is released at 21:00 on arrival day, or 12:00 the next day after a late-arrival notice filed before 21:00, and the stay becomes a no-show with no refund.',
      'Refund rungs follow this facility\'s ladder below. Refunds never go below zero and return to the original card three days later.',
      'Date or site changes are allowed only in rungs that permit them, release the original nights at confirm and cannot be undone.',
      'An alert leaves a reservation confirmed and marks it affected; an active electrical outage removes its sites from the electric filter. A closure covering any night cancels the whole stay with a full refund.',
    ],
    ladder: p.rungs.map((r, i) => ({rung: i + 1, ends: copy(r.ends), cancel: copy(r.cancel), change: copy(r.change)})),
  };
}

module.exports = {copy, siteSummary, ladder, cardView, reservationView, nightsFor, facilityView, policyText, at, addDays};
