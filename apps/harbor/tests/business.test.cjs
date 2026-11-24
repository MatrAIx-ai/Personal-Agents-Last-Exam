'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const {addMonths, localDate} = require('../src/dates.cjs');
const {certificateAfterCancel} = require('../src/program.cjs');

const code = value => ({code:value});
function unchanged(f, fn, expected) { const before = f.data; assert.throws(fn, expected); assert.deepEqual(f.data, before); }
const account = f => f.call('harbor.account', {});
const reservation = (f, id) => f.call('harbor.reservations', {id}).item;
const book = (f, hotel_id, check_in, check_out, payment) => f.call('harbor.book', {hotel_id, check_in, check_out, payment});
const kyoto = (f, check_in, check_out) => Object.fromEntries(f.call('harbor.search', {city:'Kyoto', check_in, check_out}).hotels.map(h => [h.hotel_id, h]));
const CERT = {method:'certificate', certificate_id:'cert-c4-2027'};
const FIXTURE_EXPIRY = '2028-02-02T08:30:00-06:00';

function credit({eventId = 'credit-1', at = '2027-08-24T21:05:00-05:00', points = 30000, recipientAccount = 'harbor-daniel', app = 'harbor',
  id = 'harbor-daniel', source = 'waypoint-daniel', kind = 'partner_transfer', member = 'person-daniel', number = 'HH-30418862',
  time = '2027-08-24T21:04:30-05:00'} = {}) {
  return {event_id:eventId, at, operation:'harbor.receive', payload:{recipient_account_id:recipientAccount, message:{
    specversion:'1.0', id:'loyalty-' + eventId, source:'urn:pale:app:waypoint:account:' + source, type:'org.pale.loyalty.credit.v1',
    ...(time ? {time} : {}), datacontenttype:'application/json', dataschema:'urn:pale:loyalty-credit:1',
    data:{channel:'channel.loyalty-credit', recipient:{kind:'app_account_ref', app_id:app, id},
      source_object:{app_id:'waypoint', account_id:source, object_type:'transfer', object_id:'transfer-' + eventId},
      content:{kind, member_person_id:member, member_number:number, points, base_points:points, bonus_pct:0}, extensions:[]}}}};
}
const tag = at => at.replace(/[^0-9A-Za-z]/g, '');
const expire = (at, eventId = 'expire-' + tag(at)) => ({event_id:eventId, at, operation:'harbor.points.expire', payload:{}});
const warn = (at, eventId = 'warn-' + tag(at)) => ({event_id:eventId, at, operation:'harbor.expiry.warn', payload:{}});
const categoryChange = (at, hotel_id, category, effective_at, eventId = 'cat-' + tag(at)) =>
  ({event_id:eventId, at, operation:'harbor.category.change', payload:{hotel_id, category, effective_at}});
function seeded(fn) { const f = fixture(); const data = f.data; fn(data); f.load(data); return f; }

test('generated schemas and tools.json match their single source', () => {
  if (!fs.existsSync(path.resolve(__dirname, '../../../runtime/contracts/schemas/cloudevent.schema.json'))) return;
  require('../build/schemas.cjs').build({check:true});
});

test('read tools change nothing and report the account, reservations and notices', () => {
  const f = fixture(), before = f.data;
  const a = account(f);
  assert.deepEqual([a.balance, a.member_number, a.last_activity_at, a.expires_at, a.forfeited_at], [40000, 'HH-30418862', '2026-02-02T08:30:00-06:00', FIXTURE_EXPIRY, null]);
  assert.deepEqual(a.certificates.map(c => [c.id, c.status, c.expires_on]), [['cert-c4-2027', 'active', '2027-10-16']]);
  assert.deepEqual(f.call('harbor.reservations', {}).items.map(r => r.id), ['res-1', 'res-2', 'res-3']);
  assert.deepEqual(f.call('harbor.reservations', {status:'confirmed'}).items.map(r => r.id), ['res-1', 'res-3']);
  assert.deepEqual(f.call('harbor.reservations', {id:'res-2', status:'confirmed'}).items, []);
  assert.equal(reservation(f, 'res-3').payment.payment_label, 'card-travel-4417');
  assert.deepEqual(f.call('harbor.notices.list', {}).items.map(n => n.id), ['notice-3', 'notice-2', 'notice-1']);
  f.call('harbor.search', {city:'Tokyo', check_in:'2027-09-10', check_out:'2027-09-12'});
  f.call('harbor.notices.outbound', {id:'notice-1'});
  assert.deepEqual(f.data, before);
  assert.throws(() => f.call('harbor.reservations', {id:'missing'}), code('not_found'));
  assert.throws(() => f.call('harbor.notices.outbound', {id:'missing'}), code('not_found'));
});

test('search prices every payment method at the category in effect now and shows the announced change', () => {
  const f = fixture();
  const out = f.call('harbor.search', {city:'kyoto', check_in:'2027-10-16', check_out:'2027-10-18'});
  assert.equal(out.nights, 2);
  const gion = out.hotels.find(h => h.hotel_id === 'hotel-kyoto-gion');
  assert.equal(gion.category, 6);
  assert.deepEqual(gion.upcoming_category_change, {category:7, effective_at:'2027-10-01T00:00:00+09:00', announced_at:'2027-07-15T10:00:00+09:00'});
  assert.deepEqual(gion.prices, {points:{points:50000}, points_cash:{points:25000, cash_cents:40000}, cash:{cash_cents:116000}});
  assert.deepEqual(out.hotels.map(h => h.hotel_id), ['hotel-arashiyama', 'hotel-kyoto-station', 'hotel-kyoto-gion']);
  assert.deepEqual(f.call('harbor.search', {city:'Osaka', check_in:'2027-10-16', check_out:'2027-10-18'}).hotels, []);
  // Once the change is in effect, search shows Category 7 and no upcoming change.
  f.ctx.virtual_now = '2027-10-01T00:00:00+09:00';
  const later = kyoto(f, '2027-10-20', '2027-10-21')['hotel-kyoto-gion'];
  assert.deepEqual([later.category, later.upcoming_category_change, later.prices.points.points], [7, null, 30000]);
  f.ctx.virtual_now = '2027-09-30T23:59:59+09:00';
  assert.equal(kyoto(f, '2027-10-20', '2027-10-21')['hotel-kyoto-gion'].category, 6);
});

test('search shows blackout nights and which certificates fit (1 night, cap, last check-in date)', () => {
  const f = fixture();
  let hotels = kyoto(f, '2027-10-16', '2027-10-17');
  assert.deepEqual(hotels['hotel-kyoto-station'].eligible_certificate_ids, ['cert-c4-2027']); // check-in on the last allowed date
  assert.deepEqual(hotels['hotel-arashiyama'].eligible_certificate_ids, ['cert-c4-2027']);
  assert.deepEqual(hotels['hotel-kyoto-gion'].eligible_certificate_ids, []); // Category 6 is above the cap of 4
  assert.deepEqual(kyoto(f, '2027-10-17', '2027-10-18')['hotel-kyoto-station'].eligible_certificate_ids, []); // after expiry
  assert.deepEqual(kyoto(f, '2027-10-15', '2027-10-17')['hotel-kyoto-station'].eligible_certificate_ids, []); // two nights
  hotels = kyoto(f, '2027-10-21', '2027-10-23');
  assert.deepEqual([hotels['hotel-kyoto-station'].award_available, hotels['hotel-kyoto-station'].blackout_nights], [false, ['2027-10-22']]);
  assert.equal(hotels['hotel-kyoto-gion'].award_available, true);
  // A stay ending on a blackout date is fine: the check-out date is not a night.
  assert.equal(kyoto(f, '2027-10-21', '2027-10-22')['hotel-kyoto-station'].award_available, true);
  // Points + Cash is not offered at Category 8.
  const eight = seeded(d => { d.hotels.find(h => h.id === 'hotel-tokyo-bay').category = 8; });
  assert.equal(eight.call('harbor.search', {city:'Tokyo', check_in:'2027-09-10', check_out:'2027-09-11'}).hotels.find(h => h.hotel_id === 'hotel-tokyo-bay').prices.points_cash, null);
});

test('stay dates are local hotel dates: check-in must be after today at the hotel', () => {
  const f = fixture();
  // 21:00 in Chicago on 24 August is 11:00 on 25 August in Tokyo.
  assert.equal(localDate(f.ctx.virtual_now, 'Asia/Tokyo'), '2027-08-25');
  const today = f.call('harbor.search', {city:'Tokyo', check_in:'2027-08-25', check_out:'2027-08-26'}).hotels[0];
  assert.deepEqual([today.dates_open, today.eligible_certificate_ids], [false, []]);
  assert.equal(f.call('harbor.search', {city:'Tokyo', check_in:'2027-08-26', check_out:'2027-08-27'}).hotels[0].dates_open, true);
  unchanged(f, () => book(f, 'hotel-haneda', '2027-08-25', '2027-08-26', {method:'points'}), code('invalid_arguments'));
  assert.equal(book(f, 'hotel-haneda', '2027-08-26', '2027-08-27', {method:'points'}).points, 8000);
  unchanged(f, () => book(f, 'hotel-haneda', '2027-09-02', '2027-09-02', {method:'points'}), code('invalid_arguments'));
  unchanged(f, () => book(f, 'hotel-haneda', '2027-09-03', '2027-09-02', {method:'points'}), code('invalid_arguments'));
  unchanged(f, () => book(f, 'hotel-haneda', '2027-02-30', '2027-03-02', {method:'points'}), code('invalid_arguments'));
  unchanged(f, () => book(f, 'hotel-haneda', '2027-09-01', '2027-10-02', {method:'cash', payment_label:'card-travel-4417'}), code('invalid_arguments')); // 31 nights
  assert.equal(book(f, 'hotel-haneda', '2027-09-01', '2027-10-01', {method:'cash', payment_label:'card-travel-4417'}).nights, 30);
  assert.throws(() => f.call('harbor.search', {city:'Tokyo', check_in:'2027-09-02', check_out:'2027-09-01'}), code('invalid_arguments'));
});

test('a points booking debits nights × chart price, locks the category, counts as activity and writes a notice', () => {
  const f = fixture();
  f.ctx.virtual_now = '2027-08-25T09:15:00-05:00';
  const out = book(f, 'hotel-kyoto-gion', '2027-10-17', '2027-10-18', {method:'points'});
  assert.deepEqual([out.category_locked, out.points, out.cash_cents, out.charge_id, out.balance, out.last_activity_at], [6, 25000, 0, null, 15000, '2027-08-25T09:15:00-05:00']);
  const r = reservation(f, out.id), a = account(f);
  assert.deepEqual([r.status, r.payment, r.category_locked, r.confirmation], ['confirmed', {method:'points', certificate_id:null, payment_label:null}, 6, out.confirmation]);
  assert.deepEqual(a.ledger.at(-1), {id:'ledger-5', at:'2027-08-25T09:15:00-05:00', kind:'redeem', points:-25000, balance_after:15000, ref:{reservation_id:out.id}});
  assert.equal(a.expires_at, '2029-08-25T09:15:00-05:00');
  const n = f.data.notices.find(x => x.id === out.notice_id);
  assert.deepEqual([n.kind, n.ref], ['booking_confirmed', {object_type:'reservation', object_id:out.id}]);
  assert.match(n.body, /Paid with 25,000 points/);
});

test('Points + Cash debits points and charges the chosen label; cash charges the label and is not activity', () => {
  const f = fixture();
  const pc = book(f, 'hotel-shinjuku', '2027-09-10', '2027-09-12', {method:'points_cash', payment_label:'card-everyday-0921'});
  assert.deepEqual([pc.points, pc.cash_cents, pc.balance, pc.last_activity_at], [15000, 25000, 25000, f.ctx.virtual_now]);
  const pcCharge = f.data.charges.find(c => c.id === pc.charge_id);
  assert.deepEqual([pcCharge.label, pcCharge.amount_cents, pcCharge.currency, pcCharge.ref], ['card-everyday-0921', 25000, 'USD', {reservation_id:pc.id}]);
  const g = fixture();
  const cash = book(g, 'hotel-tokyo-bay', '2027-09-10', '2027-09-13', {method:'cash', payment_label:'card-travel-4417'});
  assert.deepEqual([cash.points, cash.cash_cents, cash.balance, cash.last_activity_at], [0, 73500, 40000, '2026-02-02T08:30:00-06:00']);
  assert.deepEqual(reservation(g, cash.id).charge_ids, [cash.charge_id]);
  assert.equal(account(g).expires_at, FIXTURE_EXPIRY);
  unchanged(g, () => book(g, 'hotel-tokyo-bay', '2027-09-10', '2027-09-11', {method:'cash', payment_label:'card-unknown-0000'}), code('invalid_payment_label'));
  unchanged(g, () => book(g, 'hotel-tokyo-bay', '2027-09-10', '2027-09-11', {method:'points_cash', payment_label:'card-unknown-0000'}), code('invalid_payment_label'));
  unchanged(g, () => book(g, 'hotel-tokyo-bay', '2027-09-10', '2027-09-11', {method:'cash'}), code('invalid_arguments'));
  unchanged(g, () => book(g, 'hotel-tokyo-bay', '2027-09-10', '2027-09-11', {method:'points', payment_label:'card-travel-4417'}), code('invalid_arguments'));
  unchanged(g, () => book(g, 'hotel-tokyo-bay', '2027-09-10', '2027-09-11', {method:'certificate'}), code('invalid_arguments'));
  unchanged(g, () => book(g, 'hotel-missing', '2027-09-10', '2027-09-11', {method:'points'}), code('not_found'));
  const eight = seeded(d => { d.hotels.find(h => h.id === 'hotel-tokyo-bay').category = 8; });
  unchanged(eight, () => book(eight, 'hotel-tokyo-bay', '2027-09-10', '2027-09-11', {method:'points_cash', payment_label:'card-travel-4417'}), code('invalid_arguments'));
});

test('a certificate pays one night within its cap up to its last check-in date; other uses fail with the rule', () => {
  const f = fixture();
  unchanged(f, () => book(f, 'hotel-kyoto-gion', '2027-10-16', '2027-10-17', CERT), {code:'certificate_invalid', message:/category_cap/});
  unchanged(f, () => book(f, 'hotel-kyoto-station', '2027-10-17', '2027-10-18', CERT), {code:'certificate_invalid', message:/expires_on/});
  unchanged(f, () => book(f, 'hotel-kyoto-station', '2027-10-15', '2027-10-17', CERT), {code:'certificate_invalid', message:/one_night/});
  unchanged(f, () => book(f, 'hotel-kyoto-station', '2027-10-16', '2027-10-17', {method:'certificate', certificate_id:'cert-missing'}), code('not_found'));
  const out = book(f, 'hotel-kyoto-station', '2027-10-16', '2027-10-17', CERT);
  assert.deepEqual([out.points, out.cash_cents, out.certificate_id, out.balance, out.last_activity_at], [0, 0, 'cert-c4-2027', 40000, '2026-02-02T08:30:00-06:00']);
  const cert = account(f).certificates[0];
  assert.deepEqual([cert.status, cert.reservation_id, cert.history.at(-1).action], ['used', out.id, 'used']);
  unchanged(f, () => book(f, 'hotel-arashiyama', '2027-10-10', '2027-10-11', CERT), {code:'certificate_invalid', message:/status/});
});

test('blackout nights block every award method but not cash', () => {
  const f = fixture();
  unchanged(f, () => book(f, 'hotel-kyoto-station', '2027-10-21', '2027-10-23', {method:'points'}), code('award_unavailable'));
  unchanged(f, () => book(f, 'hotel-kyoto-station', '2027-10-22', '2027-10-23', {method:'points_cash', payment_label:'card-travel-4417'}), code('award_unavailable'));
  const g = seeded(d => { d.certificates[0].expires_on = '2027-10-30'; });
  unchanged(g, () => book(g, 'hotel-kyoto-station', '2027-10-22', '2027-10-23', CERT), code('award_unavailable'));
  assert.equal(book(f, 'hotel-kyoto-station', '2027-10-21', '2027-10-23', {method:'cash', payment_label:'card-travel-4417'}).cash_cents, 59000);
  assert.equal(book(f, 'hotel-kyoto-station', '2027-10-23', '2027-10-24', {method:'points'}).points, 15000);
});

test('insufficient points are rejected; spending the exact balance is allowed', () => {
  const f = fixture();
  unchanged(f, () => book(f, 'hotel-kyoto-gion', '2027-10-17', '2027-10-19', {method:'points'}), code('insufficient_points')); // 50,000 > 40,000
  book(f, 'hotel-kyoto-station', '2027-10-10', '2027-10-11', {method:'points'}); // 15,000 → 25,000 left
  assert.equal(book(f, 'hotel-kyoto-gion', '2027-10-17', '2027-10-18', {method:'points'}).balance, 0);
  unchanged(f, () => book(f, 'hotel-haneda', '2027-10-12', '2027-10-13', {method:'points_cash', payment_label:'card-travel-4417'}), code('insufficient_points'));
});

test('a category change locks the price of earlier bookings; bookings from effective_at pay the new category', () => {
  const f = fixture();
  const early = book(f, 'hotel-kyoto-gion', '2027-11-02', '2027-11-03', {method:'points'});
  assert.deepEqual([early.category_locked, early.points], [6, 25000]);
  f.ctx.virtual_now = '2027-09-30T09:59:59-05:00'; // one second before midnight in Kyoto
  const g = fixture(); g.ctx.virtual_now = f.ctx.virtual_now;
  assert.equal(book(g, 'hotel-kyoto-gion', '2027-11-04', '2027-11-05', {method:'points'}).category_locked, 6);
  f.ctx.virtual_now = '2027-09-30T10:00:00-05:00'; // 2027-10-01T00:00:00+09:00
  const late = book(f, 'hotel-kyoto-gion', '2027-11-04', '2027-11-05', {method:'points_cash', payment_label:'card-travel-4417'});
  assert.deepEqual([late.category_locked, late.points, late.cash_cents], [7, 15000, 25000]);
  const kept = reservation(f, early.id);
  assert.deepEqual([kept.category_locked, kept.points], [6, 25000]);
  // A reservation cannot claim a category other than the one in effect when it was booked.
  const data = f.data; data.reservations.find(r => r.id === early.id).category_locked = 7;
  assert.throws(() => plugin.validateSeed(f.ctx, data), /category in effect/);
});

test('harbor.category.change records a future change, notifies the member and is validated', () => {
  const f = fixture();
  f.event(categoryChange('2027-08-25T08:00:00-05:00', 'hotel-shinjuku', 5, '2027-12-01T00:00:00+09:00'));
  const hotel = f.data.hotels.find(h => h.id === 'hotel-shinjuku');
  assert.deepEqual(hotel.category_changes, [{category:5, effective_at:'2027-12-01T00:00:00+09:00', announced_at:'2027-08-25T08:00:00-05:00'}]);
  const n = f.data.notices.at(-1);
  assert.deepEqual([n.kind, n.ref, n.created_at], ['category_change', {object_type:'hotel', object_id:'hotel-shinjuku'}, '2027-08-25T08:00:00-05:00']);
  assert.match(n.body, /Category 4 to Category 5 on 2027-12-01/);
  // The existing cash reservation keeps its locked category and price.
  assert.deepEqual([reservation(f, 'res-3').category_locked, reservation(f, 'res-3').cash_cents], [4, 62000]);
  assert.equal(f.call('harbor.search', {city:'Tokyo', check_in:'2027-12-05', check_out:'2027-12-06'}).hotels.find(h => h.hotel_id === 'hotel-shinjuku').upcoming_category_change.category, 5);
  unchanged(f, () => f.event(categoryChange('2027-08-26T08:00:00+09:00', 'hotel-haneda', 3, '2027-08-26T08:00:00+09:00')), code('invalid_event')); // not after at
  unchanged(f, () => f.event(categoryChange('2027-08-26T09:00:00-05:00', 'hotel-shinjuku', 6, '2027-11-15T00:00:00+09:00')), code('invalid_event')); // before an announced one
  unchanged(f, () => f.event(categoryChange('2027-08-26T09:00:00-05:00', 'hotel-shinjuku', 5, '2028-03-01T00:00:00+09:00')), code('invalid_event')); // already 5 then
  unchanged(f, () => f.event(categoryChange('2027-08-26T09:00:00-05:00', 'hotel-missing', 5, '2028-03-01T00:00:00+09:00')), code('not_found'));
  const uncharted = seeded(d => { d.award_chart = d.award_chart.filter(r => r.category !== 8); });
  unchanged(uncharted, () => uncharted.event(categoryChange('2027-08-26T09:00:00-05:00', 'hotel-haneda', 8, '2028-03-01T00:00:00+09:00')), code('invalid_event'));
  f.event(categoryChange('2027-08-26T09:00:00-05:00', 'hotel-shinjuku', 4, '2028-03-01T00:00:00+09:00'));
  f.ctx.virtual_now = '2028-01-15T12:00:00+09:00';
  assert.equal(book(f, 'hotel-shinjuku', '2028-02-10', '2028-02-11', {method:'points'}).points, 20000); // Category 5
});

test('cancel refunds points without counting as activity, refunds cash to the same label and restores the certificate', () => {
  const f = fixture();
  f.ctx.virtual_now = '2027-08-25T09:00:00-05:00';
  const pts = book(f, 'hotel-arashiyama', '2027-10-18', '2027-10-20', {method:'points'});
  const cert = book(f, 'hotel-kyoto-station', '2027-10-16', '2027-10-17', CERT);
  f.ctx.virtual_now = '2027-09-05T10:00:00-05:00';
  const out = f.call('harbor.cancel', {reservation_id:pts.id});
  assert.deepEqual([out.refunded_points, out.refunded_cash_cents, out.refund_charge_id, out.certificate, out.balance], [24000, 0, null, null, 40000]);
  const a = account(f);
  assert.deepEqual(a.ledger.at(-1), {id:'ledger-6', at:'2027-09-05T10:00:00-05:00', kind:'refund', points:24000, balance_after:40000, ref:{reservation_id:pts.id}});
  assert.equal(a.last_activity_at, '2027-08-25T09:00:00-05:00'); // the redemption reset the clock; the refund did not
  const cash = f.call('harbor.cancel', {reservation_id:'res-3'});
  assert.deepEqual([cash.refunded_cash_cents, f.data.charges.find(c => c.id === cash.refund_charge_id).amount_cents,
    f.data.charges.find(c => c.id === cash.refund_charge_id).label], [62000, -62000, 'card-travel-4417']);
  assert.deepEqual(reservation(f, 'res-3').charge_ids, ['charge-1', cash.refund_charge_id]);
  const restored = f.call('harbor.cancel', {reservation_id:cert.id});
  assert.deepEqual(restored.certificate, {id:'cert-c4-2027', status:'active'});
  assert.deepEqual([account(f).certificates[0].reservation_id, account(f).certificates[0].history.at(-1).action], [null, 'restored']);
  unchanged(f, () => f.call('harbor.cancel', {reservation_id:pts.id}), code('invalid_state'));
  unchanged(f, () => f.call('harbor.cancel', {reservation_id:'missing'}), code('not_found'));
});

test('cancellation closes on the local check-in date; a certificate is restored only while still usable', () => {
  const f = fixture();
  const cert = book(f, 'hotel-kyoto-station', '2027-10-16', '2027-10-17', CERT);
  f.ctx.virtual_now = '2027-10-15T10:00:00-05:00'; // 2027-10-16 00:00 in Kyoto: the check-in date
  unchanged(f, () => f.call('harbor.cancel', {reservation_id:cert.id}), code('invalid_state'));
  const g = fixture();
  const again = book(g, 'hotel-kyoto-station', '2027-10-16', '2027-10-17', CERT);
  g.ctx.virtual_now = '2027-10-15T09:59:59-05:00'; // 23:59:59 on the 15th in Kyoto, the day before the last allowed check-in
  assert.deepEqual(g.call('harbor.cancel', {reservation_id:again.id}).certificate, {id:'cert-c4-2027', status:'active'});
  // Because check-in may be no later than expires_on and cancelling closes on the check-in date,
  // a cancel through the tool always restores; the expiry branch is the rule itself.
  const c = {expires_on:'2027-10-16'};
  assert.deepEqual([certificateAfterCancel(c, '2027-10-15'), certificateAfterCancel(c, '2027-10-16'), certificateAfterCancel(c, '2027-10-17')], ['active', 'active', 'expired']);
});

test('expiry date arithmetic adds calendar months at the same wall time and offset, clamping to month end', () => {
  assert.equal(addMonths('2026-02-02T08:30:00-06:00', 24), FIXTURE_EXPIRY);
  assert.equal(addMonths('2026-01-31T10:00:00+09:00', 1), '2026-02-28T10:00:00+09:00');
  assert.equal(addMonths('2026-08-31T23:30:00-05:00', 18), '2028-02-29T23:30:00-05:00'); // leap year
  assert.equal(addMonths('2027-08-31T23:30:00-05:00', 18), '2029-02-28T23:30:00-05:00');
  assert.equal(addMonths('2028-02-29T08:00:00Z', 24), '2030-02-28T08:00:00Z');
  assert.equal(addMonths('2026-03-31T00:00:00.250+09:00', -1), '2026-02-28T00:00:00.250+09:00');
  assert.equal(addMonths('2026-12-15T12:00:00+01:00', 1), '2027-01-15T12:00:00+01:00');
  // The offset is kept even when the zone's DST offset would differ on the new date.
  assert.equal(addMonths('2026-03-01T09:00:00-06:00', 6), '2026-09-01T09:00:00-06:00');
  const f = seeded(d => { d.inactivity_months = 18; d.last_activity_at = '2026-08-31T23:30:00-05:00'; });
  assert.equal(account(f).expires_at, '2028-02-29T23:30:00-05:00');
});

test('points expire at the inactivity boundary, not a second before; a zero balance is a recorded no-op', () => {
  const f = fixture();
  unchanged(f, () => f.event(expire('2028-02-02T08:29:59-06:00')), code('not_due'));
  f.event(expire('2028-02-02T14:30:00Z')); // the same instant in another spelling
  const a = account(f);
  assert.deepEqual([a.balance, a.forfeited_at], [0, '2028-02-02T14:30:00Z']);
  assert.deepEqual(a.ledger.at(-1), {id:'ledger-5', at:'2028-02-02T14:30:00Z', kind:'expire', points:-40000, balance_after:0, ref:null});
  f.event(expire('2028-02-03T09:00:00-06:00'));
  assert.deepEqual([account(f).ledger.at(-1).points, account(f).forfeited_at, account(f).balance], [0, '2028-02-02T14:30:00Z', 0]);
  // New points after a forfeiture restart the clock.
  f.event(credit({eventId:'credit-after', at:'2028-03-01T10:00:00-06:00', points:5000}));
  assert.deepEqual([account(f).balance, account(f).expires_at], [5000, '2030-03-01T10:00:00-06:00']);
  unchanged(f, () => f.event(expire('2028-03-02T10:00:00-06:00')), code('not_due'));
});

test('a redemption or a transfer in resets the inactivity clock; a refund, cash stay or certificate stay does not', () => {
  const redeemed = fixture();
  redeemed.ctx.virtual_now = '2028-02-02T08:00:00-06:00';
  book(redeemed, 'hotel-haneda', '2028-03-01', '2028-03-02', {method:'points'});
  assert.equal(account(redeemed).expires_at, '2030-02-02T08:00:00-06:00');
  unchanged(redeemed, () => redeemed.event(expire(FIXTURE_EXPIRY)), code('not_due'));
  const credited = fixture();
  credited.event(credit({at:'2028-02-02T08:29:00-06:00'}));
  assert.equal(account(credited).last_activity_at, '2028-02-02T08:29:00-06:00');
  unchanged(credited, () => credited.event(expire(FIXTURE_EXPIRY)), code('not_due'));
  const other = fixture();
  other.ctx.virtual_now = '2027-09-01T08:00:00-05:00';
  book(other, 'hotel-haneda', '2027-09-20', '2027-09-21', {method:'cash', payment_label:'card-travel-4417'});
  const c = book(other, 'hotel-kyoto-station', '2027-10-16', '2027-10-17', CERT);
  other.call('harbor.cancel', {reservation_id:c.id});
  assert.equal(account(other).last_activity_at, '2026-02-02T08:30:00-06:00');
  other.event(expire(FIXTURE_EXPIRY));
  assert.equal(account(other).balance, 0);
});

test('expiry warnings are accepted only in the 60 days before expiry and state the expiry time', () => {
  const f = fixture();
  unchanged(f, () => f.event(warn('2027-12-04T08:29:59-06:00')), code('not_due'));
  f.event(warn('2027-12-04T08:30:00-06:00')); // exactly 60 days before 2028-02-02T08:30:00-06:00
  const n = f.data.notices.at(-1);
  assert.deepEqual([n.kind, n.ref, n.title], ['expiry_warning', {object_type:'account', object_id:'harbor-daniel'}, 'Your Harbor points expire on 2028-02-02']);
  assert.match(n.body, /40,000 Harbor points expire at 2028-02-02T08:30:00-06:00/);
  f.event(warn('2028-02-02T08:29:59-06:00'));
  unchanged(f, () => f.event(warn('2028-02-02T08:30:00-06:00')), code('not_due'));
});

test('a loyalty credit from the member\'s own Waypoint account is credited with provenance and counts as activity', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  const a = account(f), entry = a.ledger.at(-1);
  assert.deepEqual(entry, {id:'credit-waypoint-transfer-1', at:'2027-08-24T21:05:00-05:00', kind:'transfer_in', points:30000, balance_after:70000,
    ref:{app_id:'waypoint', account_id:'waypoint-daniel', object_type:'transfer', object_id:'transfer-1', message_id:'loyalty-credit-transfer-1',
      sent_at:'2027-08-24T21:04:30-05:00'}});
  assert.deepEqual([a.balance, a.last_activity_at], [70000, '2027-08-24T21:05:00-05:00']);
  // No member number in the message is accepted; a missing producer time is not invented.
  f.event(credit({eventId:'credit-2', at:'2027-08-24T22:00:00-05:00', number:null, time:null, points:1000}));
  assert.deepEqual([account(f).balance, account(f).ledger.at(-1).ref.sent_at], [71000, null]);
});

test('loyalty credits for another account, from unbound or other members\' accounts, or repeated are rejected without a trace', () => {
  const f = fixture();
  unchanged(f, () => f.event(credit({recipientAccount:'harbor-mei'})), code('invalid_event'));
  unchanged(f, () => f.event(credit({app:'skyline'})), code('invalid_event'));
  unchanged(f, () => f.event(credit({id:'harbor-mei'})), code('invalid_event'));
  unchanged(f, () => f.event(credit({source:'waypoint-stranger'})), code('permission_denied'));
  unchanged(f, () => f.event(credit({kind:'household_combine'})), code('invalid_event'));
  unchanged(f, () => f.event(credit({source:'waypoint-mei'})), code('permission_denied'));
  unchanged(f, () => f.event(credit({member:'person-mei'})), code('permission_denied'));
  unchanged(f, () => f.event(credit({number:'HH-99999999'})), code('permission_denied'));
  unchanged(f, () => f.event(credit({eventId:'ledger-1'})), code('already_exists'));
  // Rule order: a wrong recipient is reported before an unbound sender.
  unchanged(f, () => f.event(credit({recipientAccount:'harbor-mei', source:'waypoint-stranger'})), code('invalid_event'));
});

test('notice outbound builds a stable Mail message that matches Mail\'s wire schema', () => {
  const f = fixture();
  const out = book(f, 'hotel-kyoto-station', '2027-10-16', '2027-10-17', CERT);
  const message = f.call('harbor.notices.outbound', {id:out.notice_id}).message;
  const valid = compile(require('../schemas/email-message.schema.json'), path.resolve(__dirname, '../schemas'));
  assert.ok(valid(message), 'Mail wire schema');
  const mail = path.resolve(__dirname, '../../../examples/apps/mail/schemas/router-message.schema.json');
  if (fs.existsSync(mail)) assert.equal(fs.readFileSync(mail, 'utf8'), fs.readFileSync(path.resolve(__dirname, '../schemas/email-message.schema.json'), 'utf8'));
  assert.match(message.id, /^harbor-notice-[0-9a-f]{40}$/);
  assert.deepEqual(f.call('harbor.notices.outbound', {id:out.notice_id}).message, message);
  assert.deepEqual([message.source, message.time, message.data.recipient, message.data.source_object],
    ['urn:pale:app:harbor:account:harbor-daniel', f.ctx.virtual_now, {kind:'app_account_ref', app_id:'mail', id:'mail-daniel'},
      {app_id:'harbor', account_id:'harbor-daniel', object_type:'notice', object_id:out.notice_id}]);
  assert.match(message.data.content.body.text, /Paid with a free-night certificate/);
  assert.notEqual(f.call('harbor.notices.outbound', {id:'notice-1'}).message.id, message.id);
  const silent = seeded(d => { d.mail_account_id = null; });
  assert.throws(() => silent.call('harbor.notices.outbound', {id:'notice-1'}), code('invalid_state'));
  // The scenario's loyalty credit matches the shared wire contract.
  const loyalty = compile(require('../schemas/loyalty-credit-message.schema.json'), path.resolve(__dirname, '../schemas'));
  assert.ok(loyalty(require('../examples/scenario.json').payload.message));
  assert.equal(require('../schemas/loyalty-credit-payload.schema.json').$id, 'urn:pale:loyalty-credit:1');
});

test('seed validation rejects broken ledgers, prices, links, bindings and timelines', () => {
  const f = fixture();
  const mutate = fn => { const d = f.data; fn(d); return d; };
  const rejects = (fn, pattern) => assert.throws(() => plugin.validateSeed(f.ctx, mutate(fn)), pattern);
  rejects(d => { d.account_id = 'unbound'; }, /binding/);
  rejects(d => { d.mail_account_id = 'mail-mei'; }, /Mail account/);
  rejects(d => { d.balance = 41000; }, /Balance/);
  rejects(d => { d.ledger[1].balance_after = 39000; }, /running balance/);
  rejects(d => { d.ledger[0].points = 5000; d.ledger[0].balance_after = 5000; }, /running balance/);
  rejects(d => { d.ledger[3].ref = {reservation_id:'res-1'}; }, /Refund/);
  rejects(d => { d.ledger.push({id:'t', at:'2026-03-01T00:00:00Z', kind:'transfer_in', points:1, balance_after:40001,
    ref:{app_id:'waypoint', account_id:'waypoint-mei', object_type:'transfer', object_id:'x', message_id:'m', sent_at:null}}); d.balance = 40001; d.last_activity_at = '2026-03-01T00:00:00Z'; }, /same member/);
  rejects(d => { d.last_activity_at = '2026-01-30T00:00:00-06:00'; }, /last_activity_at/);
  rejects(d => { d.forfeited_at = '2027-01-01T00:00:00Z'; }, /forfeited_at/);
  rejects(d => { d.reservations[0].points = 9000; }, /price|ledger/);
  rejects(d => { d.reservations[0].nights = 2; }, /nights/);
  rejects(d => { d.certificates[0].status = 'used'; }, /used certificate/);
  rejects(d => { d.charges[0].label = 'card-unknown'; }, /Charge/);
  rejects(d => { d.reservations[2].charge_ids = []; }, /Charge|charges/);
  rejects(d => { d.hotels[0].timezone = 'Mars/Olympus'; }, /time zone/);
  rejects(d => { d.hotels[4].category_changes[0].category = 6; }, /another charted category/);
  rejects(d => { d.notices[0].ref.object_id = 'res-9'; }, /unknown object/);
  rejects(d => { d.reservations[1].history[0].at = '2099-01-01T00:00:00Z'; }, /history/);
  rejects(d => { d.notices.push({...d.notices[0], id:'res-1'}); }, /Duplicate/);
});

test('each README event example is valid and applies to the fixture', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const examples = [...readme.matchAll(/```json\n(\{"event_id".*\})\n```/g)].map(m => JSON.parse(m[1]));
  assert.deepEqual(examples.map(e => e.operation).sort(), [...require('../app.json').event_types].sort());
  assert.deepEqual(examples[0], require('../examples/scenario.json'));
  for (const e of examples) { const f = fixture(); f.event(e); assert.notDeepEqual(f.data, fixture().data); }
});

test('optional diagnostics carry IDs only and cannot change business results', () => {
  const run = f => { f.event(require('../examples/scenario.json')); f.ctx.virtual_now = '2027-08-25T09:00:00-05:00';
    book(f, 'hotel-kyoto-station', '2027-10-16', '2027-10-17', CERT); return f.data; };
  const on = fixture(), off = fixture({logging:false});
  assert.deepEqual(run(on), run(off));
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => !/Harbor Kyoto|Confirmation|certificate\./.test(JSON.stringify(l))), 'logs carry IDs, not notice text');
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  assert.deepEqual(run(broken), off.data);
});

test('the Web page maps its actions to declared Agent tools', () => {
  const source = fs.readFileSync(path.join(__dirname, '../gui/src/app.js'), 'utf8')
    .replace(/^import .*$/m, 'const el=()=>null,date=String,tag=()=>null,textBlock=()=>null,metadata=()=>null,mount=()=>{};')
    .replace('export const config', 'const config');
  const config = new Function(source + '\nreturn config;')();
  const tools = require('../tools.json').map(t => t.name);
  for (const tool of [config.list, config.get, ...config.actions.map(a => a.tool)]) assert.ok(tools.includes(tool), tool);
  assert.deepEqual(config.actions.find(a => a.tool === 'harbor.cancel').prefill({id:'res-3'}), {reservation_id:'res-3'});
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', body:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});
