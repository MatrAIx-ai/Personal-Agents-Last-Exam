'use strict';
// Agent tool handlers. Reads work on a settled copy and return it unchanged;
// writes settle due time effects first, then apply one business transition.
const {fail} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const R = require('./rules.cjs');
const V = require('./views.cjs');
const {ms, iso, nights: nightList, MINUTE, DAY} = require('./clock.cjs');
const {settle, history} = require('./settle.cjs');
const {notify, money} = require('./notices.cjs');
const {nextId} = require('./ids.cjs');

const P = 'switchback.';
const copy = value => structuredClone(value);

// ---- Reads ------------------------------------------------------------------

const READS = {
  'facilities.search'(data, args, now) {
    const q = (args.query || '').toLocaleLowerCase();
    return {facilities: data.facilities
      .filter(f => [f.id, f.name, f.region, f.description].join(' ').toLocaleLowerCase().includes(q))
      .map(f => V.facilityView(data, f, now))};
  },
  'facilities.get'(data, args, now) {
    const f = R.facility(data, args.facility_id);
    return {facility: V.facilityView(data, f, now),
      sites: data.sites.filter(s => s.facility_id === f.id).map(s => V.siteSummary(data, s, now))};
  },
  'sites.search'(data, args, now) {
    const dates = nightList(args.arrival, args.departure);
    const matches = s => (args.facility_id === undefined || s.facility_id === args.facility_id) &&
      (args.electric_min_amps === undefined || (s.electric_amps !== null && s.electric_amps >= args.electric_min_amps && !R.outageAt(data, s, now))) &&
      (args.min_vehicle_ft === undefined || (s.max_vehicle_ft !== null && s.max_vehicle_ft >= args.min_vehicle_ft)) &&
      (args.ada_accessible === undefined || (s.ada_accessible !== null && s.ada_accessible === args.ada_accessible)) &&
      (args.max_walk_in_ft === undefined || (s.walk_in_ft !== null && s.walk_in_ft <= args.max_walk_in_ft)) &&
      (args.party_size === undefined || s.max_occupancy >= args.party_size) &&
      (args.pets === undefined || (s.pets_allowed !== null && s.pets_allowed === args.pets));
    const sites = data.sites.filter(matches).map(s => {
      const nights = dates.map(date => ({date, state: R.nightState(data, s, date, now)}));
      return {...V.siteSummary(data, s, now), available: nights.every(n => n.state === 'open'), nights};
    });
    if (args.available_only) return {sites: sites.filter(s => s.available)};
    return {sites};
  },
  'sites.get'(data, args, now) {
    const s = R.site(data, args.site_id);
    const out = {site: V.siteSummary(data, s, now)};
    if (args.arrival && args.departure) out.nights = V.nightsFor(data, s, args.arrival, args.departure, now);
    return out;
  },
  'policy.get'(data, args) {
    const ids = args.facility_id ? [args.facility_id] : data.facilities.map(f => f.id);
    return {policies: ids.map(id => V.policyText(data, R.facility(data, id)))};
  },
  'reservations.list'(data, args, now) {
    return {reservations: data.reservations.map(r => V.reservationView(data, r, now))
      .filter(r => args.state === undefined || r.state === args.state)};
  },
  'reservations.get'(data, args, now) {
    const r = R.reservation(data, args.reservation_id);
    return {reservation: V.reservationView(data, r, now),
      payments: data.payments.filter(p => p.reservation_id === r.id).map(copy)};
  },
  'alerts.list'(data, args, now) {
    return {alerts: data.alerts.filter(a => args.facility_id === undefined || a.facility_id === args.facility_id)
      .map(a => ({...copy(a), active: R.alertActive(a, now)}))};
  },
  'account.get'(data, args, now) {
    return {account: {account_id: data.account_id, holder: copy(data.holder),
      default_card_id: data.wallet.default_card_id, default_equipment_id: data.default_equipment_id,
      equipment: copy(data.equipment), companions: copy(data.companions),
      cards: data.wallet.cards.map(c => V.cardView(data, c, now))}};
  },
  'wallet.list'(data, args, now) {
    return {cards: data.wallet.cards.map(c => V.cardView(data, c, now)), default_card_id: data.wallet.default_card_id};
  },
};

// ---- Shared write helpers ----------------------------------------------------

// Facility offset for a reservation, so computed stamps read in local time.
function offsetFor(data, reservationId) {
  return R.facility(data, R.reservation(data, reservationId).facility_id).utc_offset;
}

function card(data, id) {
  return R.byId(data.wallet.cards, id, 'not_found', 'Card');
}

function newHold(ctx, data, {site, arrival, departure, purpose, reservation_id = null}) {
  const now = ms(ctx.virtual_now);
  const hold = {id: nextId(data.holds, 'hold'), site_id: site.id, facility_id: site.facility_id,
    arrival, departure, nights: nightList(arrival, departure), purpose, reservation_id,
    created_at: ctx.virtual_now, expires_at: iso(now + R.HOLD_MINUTES * MINUTE, R.offsetOf(data, site)), status: 'active'};
  data.holds.push(hold);
  return hold;
}

// The booking form's three checks, against a site, for a party.
function checkFit(s, party) {
  if (party.equipment && s.max_vehicle_ft !== null && party.equipment.length_ft > s.max_vehicle_ft) {
    fail('equipment_exceeds_site', `Equipment is ${party.equipment.length_ft} ft; the site allows ${s.max_vehicle_ft} ft.`);
  }
  if (party.party_size > s.max_occupancy) fail('occupancy_exceeded', `Party of ${party.party_size}; the site allows ${s.max_occupancy}.`);
  if (party.pets > 0 && s.pets_allowed === false) fail('pets_not_allowed', 'Pets are not allowed at this site.');
}

function party(data, args) {
  const occupant = args.primary_occupant_id || 'holder';
  let primary;
  if (occupant === 'holder') primary = {kind: 'holder', id: 'holder', display_name: data.holder.display_name};
  else {
    const c = R.byId(data.companions, occupant, 'not_found', 'Companion');
    primary = {kind: 'companion', id: c.id, display_name: c.display_name};
  }
  const ids = args.companion_ids !== undefined ? args.companion_ids : data.companions.filter(c => c.default_party).map(c => c.id);
  const companions = ids.map(id => R.byId(data.companions, id, 'not_found', 'Companion'))
    .map(c => ({id: c.id, display_name: c.display_name, person_id: c.person_id}));
  const equipmentId = args.equipment_id !== undefined ? args.equipment_id : data.default_equipment_id;
  const equipment = equipmentId ? copy(R.byId(data.equipment, equipmentId, 'not_found', 'Equipment')) : null;
  // The primary occupant counts once even when also listed as a companion.
  const party_size = new Set([primary.id, ...companions.map(c => c.id)]).size + (args.additional_guests || 0);
  return {primary_occupant: primary, companions, equipment, party_size, pets: args.pets || 0};
}

function previewRecord(ctx, data, fields, expiresAt) {
  const p = {id: nextId(data.previews, 'preview'), created_at: ctx.virtual_now, expires_at: expiresAt,
    consumed_at: null, ...fields};
  data.previews.push(p);
  return p;
}

function usePreview(ctx, data, id, kind) {
  const p = R.byId(data.previews, id, 'not_found', 'Preview');
  if (p.kind !== kind) fail('not_found', 'Preview is for a different action.');
  if (p.consumed_at) fail('preview_consumed', 'This preview was already confirmed. Start a new preview.');
  if (ms(ctx.virtual_now) >= ms(p.expires_at)) fail('preview_stale', 'The preview expired; preview again.');
  return p;
}

function charge(ctx, data, {reservation_id, card_id, amount_cents, kind = 'charge', reason}) {
  const p = {id: nextId(data.payments, 'pay'), reservation_id, card_id, amount_cents, kind, reason,
    created_at: ctx.virtual_now,
    posts_at: kind === 'refund' ? iso(ms(ctx.virtual_now) + R.REFUND_DELAY_DAYS * DAY, offsetFor(data, reservation_id)) : ctx.virtual_now,
    status: kind === 'refund' ? 'pending' : 'posted'};
  data.payments.push(p);
  return p;
}

function ensureLive(data, r, now, {cancel = false} = {}) {
  const state = R.currentState(data, r, now);
  if (state === 'cancelled' || state === 'closure_cancelled') fail('already_cancelled', 'This reservation is already cancelled.');
  if (cancel && state === 'checked_in') fail('already_checked_in', 'The stay has started; it cannot be cancelled here.');
  if (state !== 'confirmed') fail('invalid_state', `The reservation is ${state}.`);
}

// ---- Writes -----------------------------------------------------------------

const WRITES = {
  'cart.hold'(ctx, data, args, now) {
    const s = R.site(data, args.site_id), dates = nightList(args.arrival, args.departure);
    R.requireOpen(data, s, dates, now);
    const hold = newHold(ctx, data, {site: s, arrival: args.arrival, departure: args.departure, purpose: 'book'});
    return {hold: copy(hold)};
  },
  'cart.release'(ctx, data, args) {
    const h = R.byId(data.holds, args.hold_id, 'not_found', 'Hold');
    if (h.status !== 'active') fail('invalid_state', `The hold is ${h.status}.`);
    h.status = 'released';
    return {hold: copy(h)};
  },
  'reservations.preview'(ctx, data, args, now) {
    const h = R.byId(data.holds, args.hold_id, 'not_found', 'Hold');
    if (h.purpose !== 'book') fail('not_found', 'Hold is not a booking hold.');
    if (!R.holdActive(h, now)) fail('hold_expired', 'The cart hold has expired or was released.');
    const s = R.site(data, h.site_id), f = R.facility(data, s.facility_id), who = party(data, args);
    checkFit(s, who);
    const c = card(data, args.card_id || data.wallet.default_card_id);
    const nightly = R.price(s, h.nights);
    const draft = {facility_id: f.id, site_id: s.id, arrival: h.arrival, departure: h.departure,
      nights: h.nights, nightly_cents: nightly, total_cents: nightly.reduce((a, b) => a + b, 0), policy_id: f.policy_id};
    const p = previewRecord(ctx, data, {kind: 'book', hold_id: h.id, ...draft, ...who, card_id: c.id}, h.expires_at);
    return {preview: {...copy(p), card: V.cardView(data, c, now), ladder: V.ladder(data, draft)}};
  },
  'reservations.confirm'(ctx, data, args, now) {
    const p = usePreview(ctx, data, args.preview_id, 'book');
    const h = R.byId(data.holds, p.hold_id, 'not_found', 'Hold');
    if (!R.holdActive(h, now)) fail('preview_stale', 'The cart hold has expired; start again.');
    const s = R.site(data, p.site_id);
    if (p.nights.some(d => R.closureFor(data, s, d))) fail('site_closed', 'The site was closed after the preview.');
    const c = card(data, p.card_id);
    if (R.cardExpired(c, now)) fail('payment_declined', `${R.cardLabel(c)} is expired.`);
    const r = {id: nextId(data.reservations, 'res'), facility_id: p.facility_id, site_id: p.site_id,
      arrival: p.arrival, departure: p.departure, nights: p.nights, nightly_cents: p.nightly_cents,
      total_cents: p.total_cents, policy_id: p.policy_id, primary_occupant: p.primary_occupant,
      equipment: p.equipment, companions: p.companions, party_size: p.party_size, pets: p.pets,
      card_id: c.id, state: 'confirmed', late_arrival: false,
      created_at: ctx.virtual_now, updated_at: ctx.virtual_now, history: []};
    history(r, ctx.virtual_now, 'confirmed', {preview_id: p.id});
    data.reservations.push(r);
    h.status = 'converted';
    p.consumed_at = ctx.virtual_now;
    const pay = charge(ctx, data, {reservation_id: r.id, card_id: c.id, amount_cents: r.total_cents, reason: 'booking'});
    const f = R.facility(data, r.facility_id);
    notify(ctx, data, {kind: 'confirmation', object_type: 'reservation', object_id: r.id,
      title: `Confirmed: ${f.name} site ${s.name}, ${r.arrival} to ${r.departure} (${r.id})`,
      fields: [['Reservation', r.id], ['Facility', f.name], ['Site', `${s.name} (${s.id})`],
        ['Nights', `${r.arrival} to ${r.departure}`], ['Primary occupant', r.primary_occupant.display_name],
        ['Party', r.party_size], ['Equipment', r.equipment ? `${r.equipment.label}, ${r.equipment.length_ft} ft` : 'none'],
        ['Charged', `${money(r.total_cents)} to ${R.cardLabel(c)}`]]});
    return {reservation: V.reservationView(data, r, now), receipt: copy(pay)};
  },
  'reservations.late_arrival'(ctx, data, args, now) {
    const r = R.reservation(data, args.reservation_id), f = R.facility(data, r.facility_id);
    if (R.currentState(data, r, now) === 'no_show' || (r.state === 'confirmed' && now >= V.at(r.arrival, '21:00', f.utc_offset))) {
      fail('notice_too_late', 'Late-arrival notices must be filed before 21:00 on arrival day.');
    }
    ensureLive(data, r, now);
    if (r.late_arrival) fail('invalid_state', 'A late-arrival notice is already on file.');
    r.late_arrival = true;
    history(r, ctx.virtual_now, 'late_arrival_notice');
    notify(ctx, data, {kind: 'late_arrival', object_type: 'reservation', object_id: r.id,
      title: `Late arrival noted for ${r.id}: site held until 12:00 the next day`,
      fields: [['Reservation', r.id], ['Arrival', r.arrival], ['Site held until', iso(R.releaseAt(data, r), f.utc_offset)]]});
    return {reservation: V.reservationView(data, r, now)};
  },
  'reservations.modify.preview'(ctx, data, args, now) {
    const r = R.reservation(data, args.reservation_id);
    ensureLive(data, r, now);
    const rung = R.currentRung(data, r, now), fee = R.changeFee(r, rung.rung);
    if (fee === null) fail('outside_change_window', 'Changes are not allowed in the current refund rung.');
    const s = R.site(data, args.site_id || r.site_id);
    if (s.facility_id !== r.facility_id) fail('different_facility', 'A change stays within the same facility; cancel and book again instead.');
    const dates = nightList(args.arrival, args.departure);
    R.requireOpen(data, s, dates, now, {ignoreReservation: r.id});
    checkFit(s, {equipment: r.equipment, party_size: r.party_size, pets: r.pets});
    const hold = newHold(ctx, data, {site: s, arrival: args.arrival, departure: args.departure, purpose: 'modify', reservation_id: r.id});
    const nightly = R.price(s, dates), total = nightly.reduce((a, b) => a + b, 0), diff = total - r.total_cents;
    const expires = Math.min(ms(hold.expires_at), rung.ends_at === null ? Infinity : rung.ends_at);
    const p = previewRecord(ctx, data, {kind: 'modify', reservation_id: r.id, hold_id: hold.id, site_id: s.id,
      arrival: args.arrival, departure: args.departure, nights: dates, nightly_cents: nightly, total_cents: total,
      price_difference_cents: diff, change_fee_cents: fee, charge_cents: Math.max(0, diff) + fee,
      refund_cents: Math.max(0, -diff), card_id: r.card_id, rung: rung.index + 1}, iso(expires, offsetFor(data, r.id)));
    return {preview: {...copy(p), card: V.cardView(data, card(data, r.card_id), now),
      note: 'Confirming releases the original nights and cannot be undone.'}};
  },
  'reservations.modify.confirm'(ctx, data, args, now) {
    const p = usePreview(ctx, data, args.preview_id, 'modify');
    const r = R.reservation(data, p.reservation_id), h = R.byId(data.holds, p.hold_id, 'not_found', 'Hold');
    ensureLive(data, r, now);
    if (!R.holdActive(h, now) || R.currentRung(data, r, now).index + 1 !== p.rung) fail('preview_stale', 'The hold expired or the refund rung changed; preview again.');
    const s = R.site(data, p.site_id);
    if (p.nights.some(d => R.closureFor(data, s, d))) fail('site_closed', 'The site was closed after the preview.');
    const c = card(data, r.card_id);
    if (p.charge_cents > 0 && R.cardExpired(c, now)) fail('payment_declined', `${R.cardLabel(c)} is expired.`);
    const before = {site_id: r.site_id, arrival: r.arrival, departure: r.departure, total_cents: r.total_cents};
    Object.assign(r, {site_id: s.id, arrival: p.arrival, departure: p.departure, nights: p.nights,
      nightly_cents: p.nightly_cents, total_cents: p.total_cents});
    history(r, ctx.virtual_now, 'modified', {from: before, preview_id: p.id});
    h.status = 'converted';
    p.consumed_at = ctx.virtual_now;
    if (p.charge_cents > 0) charge(ctx, data, {reservation_id: r.id, card_id: c.id, amount_cents: p.charge_cents, reason: 'change'});
    if (p.refund_cents > 0) charge(ctx, data, {reservation_id: r.id, card_id: c.id, amount_cents: p.refund_cents, kind: 'refund', reason: 'change'});
    notify(ctx, data, {kind: 'modified', object_type: 'reservation', object_id: r.id,
      title: `Changed: ${r.id} is now ${r.arrival} to ${r.departure} at site ${s.name}`,
      fields: [['Reservation', r.id], ['Was', `${before.arrival} to ${before.departure}, site ${before.site_id}`],
        ['Now', `${r.arrival} to ${r.departure}, site ${s.id}`], ['Change fee', money(p.change_fee_cents)],
        ['Charged', money(p.charge_cents)], ['Refund', money(p.refund_cents)], ['Card', R.cardLabel(c)]]});
    return {reservation: V.reservationView(data, r, now)};
  },
  'reservations.cancel.preview'(ctx, data, args, now) {
    const r = R.reservation(data, args.reservation_id);
    ensureLive(data, r, now, {cancel: true});
    const rung = R.currentRung(data, r, now), refund = R.cancelRefund(r, rung.rung);
    const expires = Math.min(now + R.HOLD_MINUTES * MINUTE, rung.ends_at === null ? Infinity : rung.ends_at);
    const p = previewRecord(ctx, data, {kind: 'cancel', reservation_id: r.id, rung: rung.index + 1,
      refund_cents: refund, card_id: r.card_id, next_rung_change_at: R.nextRungChange(data, r, now)}, iso(expires, offsetFor(data, r.id)));
    return {preview: {...copy(p), card: V.cardView(data, card(data, r.card_id), now)}};
  },
  'reservations.cancel.confirm'(ctx, data, args, now) {
    const p = usePreview(ctx, data, args.preview_id, 'cancel');
    const r = R.reservation(data, p.reservation_id);
    ensureLive(data, r, now, {cancel: true});
    if (R.currentRung(data, r, now).index + 1 !== p.rung) fail('preview_stale', 'The refund rung changed; preview again.');
    r.state = 'cancelled';
    history(r, ctx.virtual_now, 'cancelled', {preview_id: p.id, refund_cents: p.refund_cents});
    p.consumed_at = ctx.virtual_now;
    if (p.refund_cents > 0) charge(ctx, data, {reservation_id: r.id, card_id: r.card_id, amount_cents: p.refund_cents, kind: 'refund', reason: 'cancellation'});
    const c = card(data, r.card_id);
    notify(ctx, data, {kind: 'cancelled', object_type: 'reservation', object_id: r.id,
      title: `Cancelled: ${r.id}, refund ${money(p.refund_cents)}`,
      fields: [['Reservation', r.id], ['Nights', `${r.arrival} to ${r.departure}`], ['Refund rung', p.rung],
        ['Refund', `${money(p.refund_cents)} to ${R.cardLabel(c)}`],
        ['Refund posts', p.refund_cents > 0 ? iso(now + R.REFUND_DELAY_DAYS * DAY, offsetFor(data, r.id)).slice(0, 10) : 'no refund']]});
    return {reservation: V.reservationView(data, r, now)};
  },
  'wallet.set_default'(ctx, data, args) {
    card(data, args.card_id);
    data.wallet.default_card_id = args.card_id;
    return {default_card_id: args.card_id};
  },
  'equipment.save'(ctx, data, args) {
    let e;
    if (args.equipment_id) {
      e = R.byId(data.equipment, args.equipment_id, 'not_found', 'Equipment');
      Object.assign(e, {label: args.label, kind: args.kind, length_ft: args.length_ft, updated_at: ctx.virtual_now});
    } else {
      e = {id: nextId(data.equipment, 'equip'), label: args.label, kind: args.kind, length_ft: args.length_ft, updated_at: ctx.virtual_now};
      data.equipment.push(e);
    }
    if (args.make_default) data.default_equipment_id = e.id;
    return {equipment: copy(e), default_equipment_id: data.default_equipment_id};
  },
  'companions.save'(ctx, data, args) {
    if (args.remove) {
      const c = R.byId(data.companions, args.companion_id, 'not_found', 'Companion');
      data.companions = data.companions.filter(x => x.id !== c.id);
      return {companion: copy(c), removed: true};
    }
    let c;
    if (args.companion_id) {
      c = R.byId(data.companions, args.companion_id, 'not_found', 'Companion');
      for (const k of ['display_name', 'person_id', 'default_party']) if (args[k] !== undefined) c[k] = args[k];
      c.updated_at = ctx.virtual_now;
    } else {
      if (!args.display_name) fail('invalid_arguments', 'A new companion needs a display name.');
      c = {id: nextId(data.companions, 'comp'), display_name: args.display_name, person_id: args.person_id ?? null,
        default_party: args.default_party ?? true, updated_at: ctx.virtual_now};
      data.companions.push(c);
    }
    return {companion: copy(c), removed: false};
  },
};

function handleTool(ctx, data, name, args) {
  if (!name.startsWith(P)) fail('unknown_tool', 'Unknown Switchback operation.');
  const op = name.slice(P.length), now = ms(ctx.virtual_now);
  const {expected_version, request_id, ...input} = args;
  if (READS[op]) {
    // Compute due time effects on a copy so that reads never change state.
    const view = settle({...ctx, log: undefined}, copy(data));
    return {data, result: READS[op](view, input, now)};
  }
  if (!WRITES[op]) fail('unknown_tool', 'Unknown Switchback operation.');
  settle(ctx, data);
  const result = WRITES[op](ctx, data, input, now);
  log(ctx, 'switchback.' + op, {request_id: request_id || null});
  return {data, result};
}

module.exports = {handleTool, READS, WRITES};
