'use strict';
// App-only walkthrough on the minimal fixture: quote and book the PA218 pickup, apply the example
// delay, and see the pickup move to 01:00 at the same fare with a booking_changed notification.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

const f = fixture();
const q = f.call('curbline.rides.quote', {pickup_place_id: 'pl-ngi-term-4', dropoff_place_id: 'pl-harborview-hotel',
  pickup_at: '2026-12-03T23:15:00-05:00', option: 'standard', passengers: 2, bags: 2,
  flight: {carrier: 'PA', number: '218', local_date: '2026-12-03'}, pickup_buffer_min: 20}).quote;
const booked = f.call('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work'});
f.event(require('./scenario.json'));
const after = f.call('curbline.bookings.get', {booking_id: booked.booking_id}).booking;
const notifications = f.call('curbline.notifications.list', {booking_id: booked.booking_id}).notifications;
assert.equal(after.pickup_at, '2026-12-04T01:00:00-05:00');
assert.equal(after.fare.fare_cents, 4935);
assert.deepEqual(notifications.map(n => n.kind), ['booking_confirmed', 'booking_changed']);
console.log(JSON.stringify({
  app: 'curbline',
  quote: {fare_cents: q.fare_cents, breakdown: q.breakdown, expires_at: q.expires_at},
  booking: {booking_id: booked.booking_id, hold_entry_id: booked.hold_entry_id},
  event: require('./scenario.json').operation,
  after: {status: after.status, pickup_at: after.pickup_at, anchor_pickup_at: after.anchor_pickup_at, fare_cents: after.fare.fare_cents,
    free_until: after.policy.free_until},
  notifications: notifications.map(n => ({id: n.notification_id, kind: n.kind, status: n.status, title: n.title}))
}, null, 2));
