'use strict';
// Runnable without a host: a Waypoint transfer lands, the member searches Kyoto, uses the
// expiring certificate on its last check-in date, books Gion with points before its category
// rises, and builds the Mail message for the certificate confirmation.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.call('harbor.account', {});
f.event(require('./scenario.json')); // 30,000 points from waypoint-daniel at 21:05 Chicago time
const credited = f.call('harbor.account', {});
assert.equal(credited.balance, before.balance + 30000);
assert.equal(credited.expires_at, '2029-08-24T21:05:00-05:00'); // a transfer in is activity

f.ctx.virtual_now = '2027-08-24T21:30:00-05:00';
const kyoto = f.call('harbor.search', {city:'Kyoto', check_in:'2027-10-16', check_out:'2027-10-17'}).hotels;
const station = kyoto.find(h => h.hotel_id === 'hotel-kyoto-station'), gion = kyoto.find(h => h.hotel_id === 'hotel-kyoto-gion');
assert.deepEqual(station.eligible_certificate_ids, ['cert-c4-2027']);
assert.deepEqual([gion.category, gion.upcoming_category_change.category, gion.eligible_certificate_ids], [6, 7, []]);

const certificateStay = f.call('harbor.book', {hotel_id:'hotel-kyoto-station', check_in:'2027-10-16', check_out:'2027-10-17',
  payment:{method:'certificate', certificate_id:'cert-c4-2027'}});
const pointsStay = f.call('harbor.book', {hotel_id:'hotel-kyoto-gion', check_in:'2027-10-17', check_out:'2027-10-19', payment:{method:'points'}});
assert.deepEqual([pointsStay.category_locked, pointsStay.points, pointsStay.balance], [6, 50000, 20000]);
const mail = f.call('harbor.notices.outbound', {id:certificateStay.notice_id}).message;

console.log(JSON.stringify({app:'harbor', transfer_in:{event_id:'credit-waypoint-transfer-1', balance:credited.balance, expires_at:credited.expires_at},
  kyoto_search:kyoto.map(h => ({hotel_id:h.hotel_id, category:h.category, upcoming:h.upcoming_category_change, points:h.prices.points.points,
    award_available:h.award_available, certificates:h.eligible_certificate_ids})),
  bookings:[certificateStay, pointsStay], account_after:{balance:f.call('harbor.account', {}).balance,
    certificate:f.call('harbor.account', {}).certificates[0].status},
  mail_message:{id:mail.id, to:mail.data.recipient, title:mail.data.content.title}}, null, 2));
