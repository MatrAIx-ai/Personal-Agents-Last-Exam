'use strict';
// Seed and state consistency. Core runs validateSeed after every load, tool call and event,
// so an invariant here can never be broken by a later write.
const {references:bound} = require('./domain-utils.cjs');
const {fail, ms} = require('./common.cjs');
const d = require('./dates.cjs');
const rates = require('./rates.cjs');

const bad = message => fail('invalid_seed', message);
const sum = list => list.reduce((a, b) => a + b, 0);

function timeline(record, label) {
  if (ms(record.created_at) > ms(record.updated_at)) bad(label + ' timestamps are reversed.');
  let previous = ms(record.created_at);
  for (const entry of record.history) {
    const at = ms(entry.at);
    if (!Number.isFinite(at) || at < previous || at > ms(record.updated_at)) bad('Invalid history timeline for ' + label + '.');
    previous = at;
  }
  if (!record.history.length || previous !== ms(record.updated_at)) bad(label + ' history must include the last update.');
}

function nightList(list, label) {
  if (!list.every(d.validDate) || list.some((n, i) => i && n <= list[i - 1])) bad(label + ' must be real dates, sorted and unique.');
}

function hotel(h) {
  if (!d.validTimeZone(h.timezone)) bad('Hotel ' + h.id + ' time zone is not a valid IANA zone.');
  if (h.rates.non_refundable.nightly_cents >= h.rates.refundable.nightly_cents) bad('Hotel ' + h.id + ': the non-refundable rate must be cheaper than the refundable rate.');
  nightList(h.high_demand_nights, 'High-demand nights of ' + h.id);
  nightList(h.sold_out_nights, 'Sold-out nights of ' + h.id);
  timeline(h, h.id);
}

function offer(r) {
  const o = r.rate_switch;
  if (!o) { if (r.status === 'pending_rate_switch') bad(r.id + ' is pending a rate switch but has no offer.'); return; }
  if ((o.status === 'pending') !== (r.status === 'pending_rate_switch')) bad(r.id + ': status and rate-switch offer disagree.');
  if ((o.resolved_at === null) !== (o.status === 'pending')) bad(r.id + ': only a pending offer is unresolved.');
  if (ms(o.expires_at) <= ms(o.offered_at) || ms(o.offered_at) < ms(r.created_at) || ms(o.offered_at) > ms(r.updated_at)) bad(r.id + ': offer times are inconsistent.');
  if (o.resolved_at !== null && (ms(o.resolved_at) < ms(o.offered_at) || ms(o.resolved_at) > ms(r.updated_at))) bad(r.id + ': offer resolution is outside the record timeline.');
  if (o.status === 'expired' && ms(o.resolved_at) < ms(o.expires_at)) bad(r.id + ': an offer cannot expire before its window closes.');
  if (o.status === 'accepted' && ms(o.resolved_at) > ms(o.expires_at)) bad(r.id + ': an offer cannot be accepted after it expires.');
  if (!o.high_demand_nights.length || o.high_demand_nights.some(n => n < r.check_in || n >= r.check_out)) bad(r.id + ': high-demand nights must fall in the stay.');
  nightList(o.high_demand_nights, r.id + ' offer nights');
  if (o.proposed_total_cents !== o.proposed_nightly_cents * r.nights) bad(r.id + ': offer total must be nightly price times nights.');
  const accepted = o.status === 'accepted';
  if (accepted !== (r.plan === 'non_refundable')) bad(r.id + ': only an accepted offer moves a stay booked through it to the non-refundable plan.');
  if (accepted && (r.nightly_cents !== o.proposed_nightly_cents || r.total_cents !== o.proposed_total_cents)) bad(r.id + ': an accepted offer sets the price.');
}

function reservation(r, data, hotels, charges) {
  const h = hotels.get(r.hotel_id);
  if (!h || h.name !== r.hotel_name || h.city !== r.city) bad(r.id + ' must reference a hotel in this seed.');
  if (!d.validDate(r.check_in) || !d.validDate(r.check_out) || d.nightsBetween(r.check_in, r.check_out) !== r.nights ||
      r.nights < 1 || r.nights > rates.MAX_NIGHTS) bad(r.id + ': nights must match the dates.');
  if (r.total_cents !== r.nightly_cents * r.nights) bad(r.id + ': total must be nightly price times nights.');
  if (!data.payment_labels.includes(r.payment_label)) bad(r.id + ': unknown payment label.');
  const refundable = r.plan === 'refundable';
  if (refundable && (r.free_cancellation_until === null || ms(r.free_cancellation_until) !== ms(rates.freeCancellationUntil(h, r.check_in)))) {
    bad(r.id + ': free cancellation deadline must follow the hotel rule.');
  }
  if (!refundable && r.free_cancellation_until !== null) bad(r.id + ': a non-refundable stay has no free cancellation.');
  offer(r);
  const own = data.charges.filter(x => x.reservation_id === r.id);
  if (JSON.stringify(own.map(x => x.id)) !== JSON.stringify(r.charge_ids) || !r.charge_ids.every(id => charges.has(id))) bad(r.id + ': charge list mismatch.');
  if (sum(own.map(x => x.amount_cents)) !== r.paid_cents) bad(r.id + ': paid amount must equal its charges.');
  if (!own.length || own[0].kind !== 'charge' || own[0].amount_cents <= 0) bad(r.id + ': a reservation starts with its booking charge.');
  const cancelled = r.status === 'cancelled';
  if (cancelled !== (r.cancellation !== null)) bad(r.id + ': cancellation record mismatch.');
  if (!cancelled && r.paid_cents !== r.total_cents) bad(r.id + ': an active reservation is paid in full.');
  if (cancelled) {
    const x = r.cancellation;
    if (ms(x.at) < ms(r.created_at) || ms(x.at) > ms(r.updated_at) || r.rate_switch?.status === 'pending') bad(r.id + ': cancellation timeline mismatch.');
    if (x.refund_cents + x.fee_cents !== r.total_cents || r.paid_cents !== x.fee_cents) bad(r.id + ': refund and fee must add up to the price.');
    const rule = x.rule === 'non_refundable' ? !refundable && x.refund_cents === 0 :
      x.rule === 'free' ? refundable && x.fee_cents === 0 && ms(x.at) <= ms(r.free_cancellation_until) :
      refundable && x.fee_cents === r.nightly_cents && ms(x.at) > ms(r.free_cancellation_until);
    if (!rule) bad(r.id + ': cancellation does not follow the plan rule.');
  }
  for (const x of own) {
    if (x.payment_label !== r.payment_label || ms(x.at) < ms(r.created_at) || ms(x.at) > ms(r.updated_at)) bad(x.id + ' does not match its reservation.');
  }
  timeline(r, r.id);
}

function validateSeed(ctx, data) {
  bound(ctx, data);
  if (new Set(data.payment_labels).size !== data.payment_labels.length) bad('Duplicate payment label.');
  const ids = new Set();
  for (const record of [...data.hotels, ...data.reservations, ...data.charges]) {
    if (ids.has(record.id)) bad('Duplicate record ID ' + record.id + '.');
    ids.add(record.id);
  }
  for (const record of [...data.reservations, ...data.charges]) if (record.account_id !== data.account_id) bad('Record ' + record.id + ' belongs to another account.');
  if (new Set(data.reservations.map(r => r.confirmation)).size !== data.reservations.length) bad('Duplicate confirmation number.');
  const hotels = new Map(data.hotels.map(h => [h.id, h])), charges = new Map(data.charges.map(x => [x.id, x]));
  data.hotels.forEach(hotel);
  for (const x of data.charges) {
    if (!data.reservations.some(r => r.id === x.reservation_id)) bad(x.id + ' must belong to a reservation.');
    if ((x.kind === 'charge') !== (x.amount_cents > 0) || x.amount_cents === 0) bad(x.id + ': charges are positive and refunds negative.');
  }
  for (const r of data.reservations) reservation(r, data, hotels, charges);
  const seen = new Set();
  data.events_applied.forEach((e, i) => {
    if (seen.has(e.event_id) || (i && ms(e.at) < ms(data.events_applied[i - 1].at))) bad('Applied events must be unique and in time order.');
    seen.add(e.event_id);
  });
}

module.exports = {validateSeed, records:data => [...data.hotels, ...data.reservations, ...data.charges],
  objects:data => [...data.hotels, ...data.reservations, ...data.charges].map(r => r.id), references:() => [], assetReferences:() => []};
