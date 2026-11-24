'use strict';
// Runnable without a host: the #49 hotel steps of the reference solution. Book refundable stays in
// Munich (04-19 to 04-25) and Lyon (04-25 to 04-30); the Lyon stay comes back pending_rate_switch
// and is left unconfirmed; the task's expiry sweep closes the offer; then the example scenario
// event (a sell-out at another Lyon hotel) is applied. Prints the states a grader reads.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const label = f.call('roomline.account', {}).payment_labels[0];

const munich = f.call('roomline.book', {hotel_id:'hotel-isarblick', check_in:'2027-04-19', check_out:'2027-04-25', plan:'refundable', payment_label:label});
const lyon = f.call('roomline.book', {hotel_id:'hotel-rive-gauche', check_in:'2027-04-25', check_out:'2027-04-30', plan:'refundable', payment_label:label});
assert.equal(munich.reservation.status, 'confirmed');
assert.equal(lyon.reservation.status, 'pending_rate_switch');
assert.equal(lyon.reservation.plan, 'refundable');

// The agent does not confirm. The task sweeps expired offers after the 30-minute window.
f.event({event_id:'roomline-expire-session1', at:'2027-02-08T21:05:00-06:00', operation:'roomline.rate_switch.expire', payload:{hotel_id:null}});
f.event(require('./scenario.json'));

const graded = f.call('roomline.reservations.list', {}).items.map(r => ({id:r.id, confirmation:r.confirmation, hotel_id:r.hotel_id, city:r.city,
  check_in:r.check_in, check_out:r.check_out, status:r.status, plan:r.plan, paid_cents:r.paid_cents,
  free_cancellation_until:r.free_cancellation_until, rate_switch:r.rate_switch && r.rate_switch.status}));
assert.deepEqual(graded.map(r => [r.city, r.status, r.plan, r.rate_switch]),
  [['Munich', 'confirmed', 'refundable', null], ['Lyon', 'confirmed', 'refundable', 'expired']]);
const saone = f.call('roomline.search', {city:'Lyon', check_in:'2027-04-25', check_out:'2027-04-30'}).hotels.find(h => h.hotel_id === 'hotel-saone-express');
assert.deepEqual(saone.sold_out_nights, ['2027-04-26', '2027-04-27', '2027-04-28']);

console.log(JSON.stringify({app:'roomline', book_messages:[munich.message, lyon.message], reservations:graded,
  charges:f.call('roomline.account', {}).charges, events_applied:f.data.events_applied,
  non_refundable_reservations:graded.filter(r => r.plan === 'non_refundable').length}, null, 2));
