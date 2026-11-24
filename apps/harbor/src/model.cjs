'use strict';
// Seed and state consistency. Core runs validateSeed after every load, tool call and event,
// so an invariant here can never be broken by a later write.
const {references:bound} = require('./domain-utils.cjs');
const {fail, ms} = require('./common.cjs');
const d = require('./dates.cjs');
const p = require('./program.cjs');

const bad = message => fail('invalid_seed', message);

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

function hotels(data) {
  const chart = new Set(data.award_chart.map(r => r.category));
  if (chart.size !== data.award_chart.length) bad('Duplicate award chart category.');
  for (const h of data.hotels) {
    if (!d.validTimeZone(h.timezone)) bad('Hotel ' + h.id + ' time zone is not a valid IANA zone.');
    if (!chart.has(h.category)) bad('Hotel ' + h.id + ' category is missing from the award chart.');
    if (!h.blackout_dates.every(d.validDate)) bad('Hotel ' + h.id + ' has an invalid blackout date.');
    let category = h.category, previous = -Infinity;
    for (const change of h.category_changes) {
      if (ms(change.effective_at) <= previous) bad('Hotel ' + h.id + ' category changes must be in effective_at order.');
      if (ms(change.announced_at) >= ms(change.effective_at)) bad('Hotel ' + h.id + ' category change must be announced before it takes effect.');
      if (change.category === category || !chart.has(change.category)) bad('Hotel ' + h.id + ' category change must move to another charted category.');
      previous = ms(change.effective_at); category = change.category;
    }
  }
}

function ledger(ctx, data, reservations) {
  const ids = new Set();
  let balance = 0, previous = -Infinity, forfeited = null;
  for (const e of data.ledger) {
    if (ids.has(e.id)) bad('Duplicate ledger entry ID.');
    ids.add(e.id);
    if (ms(e.at) < previous) bad('Ledger entries must be in time order.');
    previous = ms(e.at);
    balance += e.points;
    if (balance < 0 || e.balance_after !== balance) bad('Ledger entry ' + e.id + ' does not continue the running balance.');
    const r = e.ref && e.ref.reservation_id !== undefined ? reservations.get(e.ref.reservation_id) : null;
    if (e.kind === 'opening' && (e.points < 0 || e.ref !== null)) bad('An opening entry adds points and has no reference.');
    if (e.kind === 'redeem' && (!r || e.points >= 0 || -e.points !== r.points || ms(e.at) !== ms(r.created_at))) bad('Redemption ' + e.id + ' must match its reservation.');
    if (e.kind === 'refund' && (!r || e.points <= 0 || e.points !== r.points || r.status !== 'cancelled')) bad('Refund ' + e.id + ' must match a cancelled reservation.');
    if (e.kind === 'transfer_in') {
      if (e.points <= 0 || e.ref?.app_id !== 'waypoint') bad('Transfer in ' + e.id + ' must add points from Waypoint.');
      const sender = ctx.binding.accounts.find(a => a.app_id === 'waypoint' && a.account_id === e.ref.account_id);
      if (!sender || sender.owner_person_id !== data.owner_person_id) bad('Transfer in ' + e.id + ' must come from a Waypoint account of the same member.');
    }
    if (e.kind === 'expire') {
      if (e.ref !== null || e.balance_after !== 0) bad('An expire entry forfeits the whole balance.');
      if (e.points < 0) forfeited = e.at;
    }
    if (['redeem', 'transfer_in'].includes(e.kind) && ms(e.at) > ms(data.last_activity_at)) bad('last_activity_at is older than a redemption or transfer in.');
  }
  if (data.balance !== balance) bad('Balance must equal the last ledger balance.');
  if ((forfeited === null) !== (data.forfeited_at === null) || forfeited !== null && ms(forfeited) !== ms(data.forfeited_at)) {
    bad('forfeited_at must be the time of the last forfeiting expire entry.');
  }
  for (const r of reservations.values()) {
    const of = kind => data.ledger.filter(e => e.kind === kind && e.ref?.reservation_id === r.id).length;
    if (of('redeem') !== (r.points ? 1 : 0) || of('refund') !== (r.points && r.status === 'cancelled' ? 1 : 0)) bad('Reservation ' + r.id + ' points do not match the ledger.');
  }
}

function charges(data, reservations) {
  const ids = new Set();
  for (const ch of data.charges) {
    if (ids.has(ch.id)) bad('Duplicate charge ID.');
    ids.add(ch.id);
    if (!data.payment_labels.includes(ch.label) || ch.amount_cents === 0) bad('Charge ' + ch.id + ' needs a known label and a nonzero amount.');
    const r = ch.ref && reservations.get(ch.ref.reservation_id);
    if (!r || !r.charge_ids.includes(ch.id) || ch.label !== r.payment.payment_label) bad('Charge ' + ch.id + ' must belong to its reservation.');
  }
  for (const r of reservations.values()) {
    const list = r.charge_ids.map(id => data.charges.find(ch => ch.id === id));
    if (new Set(r.charge_ids).size !== list.length || list.some(ch => !ch || ch.ref?.reservation_id !== r.id)) bad('Reservation ' + r.id + ' lists a charge that is not its own.');
    const total = list.reduce((sum, ch) => sum + ch.amount_cents, 0), expected = r.cash_cents ? (r.status === 'cancelled' ? 2 : 1) : 0;
    if (list.length !== expected || total !== (r.status === 'cancelled' ? 0 : r.cash_cents)) bad('Reservation ' + r.id + ' charges do not match its cash price.');
  }
}

function reservation(data, r, hotel, certificates) {
  if (!hotel) bad('Reservation ' + r.id + ' names an unknown hotel.');
  if (!d.validDate(r.check_in) || !d.validDate(r.check_out) || d.nightsBetween(r.check_in, r.check_out) !== r.nights) bad('Reservation ' + r.id + ' nights do not match its dates.');
  if (r.check_in <= d.localDate(r.created_at, hotel.timezone)) bad('Reservation ' + r.id + ' must be booked before its check-in date.');
  if (r.category_locked !== p.categoryAt(hotel, r.created_at)) bad('Reservation ' + r.id + ' must lock the category in effect when it was booked.');
  const q = p.quote(data, hotel, r.category_locked, r.nights), {method, certificate_id, payment_label} = r.payment;
  const expected = {points:[q.points.points, 0], certificate:[0, 0], points_cash:q.points_cash ? [q.points_cash.points, q.points_cash.cash_cents] : null,
    cash:[0, q.cash.cash_cents]}[method];
  if (!expected || r.points !== expected[0] || r.cash_cents !== expected[1]) bad('Reservation ' + r.id + ' price does not match the award chart.');
  if ((certificate_id !== null) !== (method === 'certificate') || (payment_label !== null) !== ['points_cash', 'cash'].includes(method)) {
    bad('Reservation ' + r.id + ' payment fields do not match its method.');
  }
  if (payment_label !== null && !data.payment_labels.includes(payment_label)) bad('Reservation ' + r.id + ' uses an unknown payment label.');
  if (method === 'certificate') {
    const cert = certificates.get(certificate_id);
    if (!cert || r.nights !== 1 || r.category_locked > cert.category_cap || r.check_in > cert.expires_on) bad('Reservation ' + r.id + ' breaks its certificate rules.');
    if (r.status === 'confirmed' && (cert.status !== 'used' || cert.reservation_id !== r.id)) bad('Certificate ' + cert.id + ' must be used by its reservation.');
  }
}

function validateSeed(ctx, data) {
  bound(ctx, data);
  if (data.mail_account_id !== null && !ctx.binding.accounts.some(a => a.app_id === 'mail' && a.account_id === data.mail_account_id &&
      a.owner_person_id === data.owner_person_id)) bad('The Mail account must be bound to the member.');
  hotels(data);
  const ids = new Set();
  for (const record of [...data.hotels, ...data.certificates, ...data.reservations, ...data.notices]) {
    if (ids.has(record.id)) bad('Duplicate record ID.');
    ids.add(record.id);
    if (record.history) timeline(record, record.id);
  }
  const hotelMap = new Map(data.hotels.map(h => [h.id, h])), certificates = new Map(data.certificates.map(x => [x.id, x]));
  const reservations = new Map(data.reservations.map(r => [r.id, r]));
  if (new Set(data.reservations.map(r => r.confirmation)).size !== data.reservations.length) bad('Duplicate confirmation number.');
  for (const r of data.reservations) reservation(data, r, hotelMap.get(r.hotel_id), certificates);
  for (const cert of data.certificates) {
    if (!d.validDate(cert.expires_on)) bad('Certificate ' + cert.id + ' has an invalid expiry date.');
    if ((cert.status === 'used') !== (cert.reservation_id !== null)) bad('Only a used certificate points to a reservation.');
    const r = cert.reservation_id && reservations.get(cert.reservation_id);
    if (cert.status === 'used' && (!r || r.status !== 'confirmed' || r.payment.certificate_id !== cert.id)) bad('Certificate ' + cert.id + ' points to a reservation that does not use it.');
  }
  ledger(ctx, data, reservations);
  charges(data, reservations);
  for (const n of data.notices) {
    if (n.ref && !(n.ref.object_type === 'account' ? n.ref.object_id === data.account_id :
      (n.ref.object_type === 'hotel' ? hotelMap : reservations).has(n.ref.object_id))) bad('Notice ' + n.id + ' refers to an unknown object.');
  }
}

const records = data => [...data.hotels, ...data.certificates, ...data.reservations, ...data.notices];
// Waypoint transfer references are opaque provenance: the sender's object may be outside an assembled run.
module.exports = {validateSeed, records, objects:data => records(data).map(r => r.id), references:() => [], assetReferences:() => []};
