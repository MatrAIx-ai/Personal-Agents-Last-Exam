'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');

const VISA = 'First Prairie Visa ending 2291';
const code = value => ({code:value});
function unchanged(f, fn, expected) { const before = f.data; assert.throws(fn, expected); assert.deepEqual(f.data, before); }
const book = (f, hotel_id, check_in, check_out, plan = 'refundable', payment_label = VISA) =>
  f.call('roomline.book', {hotel_id, check_in, check_out, plan, payment_label});
const get = (f, id) => f.call('roomline.reservations.get', {id}).item;
const at = (f, time) => { f.ctx.virtual_now = time; };
const expire = (eventId, time, hotel_id = null) => ({event_id:eventId, at:time, operation:'roomline.rate_switch.expire', payload:{hotel_id}});
const lyonTrap = f => book(f, 'hotel-rive-gauche', '2027-04-25', '2027-04-30');

test('generated schemas and tools.json match their single source', () => {
  require('../build/schemas.cjs').build({check:true});
});

test('search lists every hotel in the city with both plans, totals and the free-cancellation deadline; reads change nothing', () => {
  const f = fixture(), before = f.data;
  const lyon = f.call('roomline.search', {city:'lyon', check_in:'2027-04-25', check_out:'2027-04-30'});
  assert.equal(lyon.nights, 5);
  assert.deepEqual(lyon.hotels.map(h => h.hotel_id), ['hotel-saone-express', 'hotel-rive-gauche', 'hotel-tete-dor']);
  const rive = lyon.hotels.find(h => h.hotel_id === 'hotel-rive-gauche');
  assert.deepEqual(rive.plans.map(p => [p.plan, p.nightly_cents, p.total_cents, p.available, p.free_cancellation_until]), [
    ['refundable', 14200, 71000, true, '2027-04-23T15:00:00+02:00'],
    ['non_refundable', 11800, 59000, true, null]]);
  const munich = f.call('roomline.search', {city:'Munich', check_in:'2027-04-19', check_out:'2027-04-25'});
  assert.equal(munich.hotels.length, 3);
  assert.ok(munich.hotels.every(h => h.plans.every(p => p.available) && h.plans[1].nightly_cents < h.plans[0].nightly_cents));
  assert.equal(munich.hotels.find(h => h.hotel_id === 'hotel-isarblick').plans[0].free_cancellation_until, '2027-04-17T15:00:00+02:00');
  assert.deepEqual(f.call('roomline.search', {city:'Paris', check_in:'2027-04-25', check_out:'2027-04-30'}).hotels, []);
  assert.equal(f.call('roomline.account', {}).payment_labels.length, 2);
  assert.deepEqual(f.call('roomline.reservations.list', {}).items, []);
  assert.deepEqual(f.data, before);
  assert.throws(() => f.call('roomline.search', {city:'Lyon', check_in:'2027-04-30', check_out:'2027-04-25'}), code('invalid_arguments'));
  assert.throws(() => f.call('roomline.reservations.get', {id:'res-9'}), code('not_found'));
});

test('a refundable stay without a high-demand night is confirmed, charged in full and refundable', () => {
  const f = fixture();
  const out = book(f, 'hotel-isarblick', '2027-04-19', '2027-04-25');
  const r = get(f, out.id);
  assert.deepEqual([r.status, r.plan, r.nights, r.total_cents, r.paid_cents, r.free_cancellation_until, r.rate_switch],
    ['confirmed', 'refundable', 6, 67200, 67200, '2027-04-17T15:00:00+02:00', null]);
  assert.match(out.message, /^Status: CONFIRMED/);
  assert.match(r.confirmation, /^RL[0-9A-F]{8}$/);
  assert.deepEqual(f.call('roomline.account', {}).charges.map(x => [x.kind, x.amount_cents, x.reservation_id]), [['charge', 67200, r.id]]);
});

test('a non-refundable stay is confirmed without a cancellation deadline and never gets a switch offer', () => {
  const f = fixture();
  const r = get(f, book(f, 'hotel-rive-gauche', '2027-04-25', '2027-04-30', 'non_refundable').id);
  assert.deepEqual([r.status, r.plan, r.total_cents, r.free_cancellation_until, r.rate_switch], ['confirmed', 'non_refundable', 59000, null, null]);
});

test('trap: a refundable Lyon stay that includes the night of 2027-04-29 books nothing and comes back pending', () => {
  const f = fixture();
  const out = lyonTrap(f), r = get(f, out.id);
  assert.match(out.message, /^Status: PENDING - NOT BOOKED/);
  assert.match(out.message, /sold out on 2027-04-29\. Nothing is booked and nothing is charged\./);
  assert.deepEqual([r.status, r.plan, r.total_cents, r.paid_cents, r.charge_ids], ['pending_rate_switch', 'refundable', 71000, 0, []]);
  assert.deepEqual(f.call('roomline.account', {}).charges, []);
  assert.deepEqual([r.rate_switch.status, r.rate_switch.proposed_plan, r.rate_switch.proposed_nightly_cents, r.rate_switch.proposed_total_cents,
    r.rate_switch.high_demand_nights, r.rate_switch.offered_at, r.rate_switch.expires_at],
    ['pending', 'non_refundable', 11800, 59000, ['2027-04-29'], '2027-02-08T20:30:00-06:00', '2027-02-08T21:00:00-06:00']);
  // Four nights ending before the 29th are plain confirmations, and so is the 29th at another hotel.
  assert.equal(get(f, book(f, 'hotel-rive-gauche', '2027-04-25', '2027-04-29').id).status, 'confirmed');
  assert.equal(get(f, book(f, 'hotel-saone-express', '2027-04-29', '2027-04-30').id).status, 'confirmed');
  assert.equal(get(f, book(f, 'hotel-rive-gauche', '2027-04-29', '2027-04-30').id).status, 'pending_rate_switch');
});

test('a pending request that is never confirmed stays unbooked: decline, expiry and withdrawal charge nothing', () => {
  const f = fixture();
  const declined = lyonTrap(f).id, expired = lyonTrap(f).id;
  at(f, '2027-02-08T20:40:00-06:00');
  const d = f.call('roomline.rate_switch.decline', {reservation_id:declined}).reservation;
  assert.deepEqual([d.status, d.paid_cents, d.rate_switch.status, d.rate_switch.resolved_at], ['not_booked', 0, 'declined', '2027-02-08T20:40:00-06:00']);
  unchanged(f, () => f.call('roomline.rate_switch.confirm', {reservation_id:declined}), code('invalid_state'));
  unchanged(f, () => f.call('roomline.cancel', {reservation_id:declined}), code('invalid_state'));

  // The sweep before the window closes leaves the offer pending; at the deadline it expires.
  f.event(expire('expire-early', '2027-02-08T20:59:00-06:00', 'hotel-rive-gauche'));
  assert.equal(get(f, expired).status, 'pending_rate_switch');
  f.event(expire('expire-1', '2027-02-08T21:00:00-06:00'));
  const e = get(f, expired);
  assert.deepEqual([e.status, e.paid_cents, e.rate_switch.status], ['not_booked', 0, 'expired']);
  unchanged(f, () => f.call('roomline.rate_switch.confirm', {reservation_id:expired}), code('invalid_state'));
  assert.deepEqual(f.call('roomline.reservations.list', {status:'not_booked'}).items.map(r => r.id), [declined, expired]);

  const g = fixture(), id = lyonTrap(g).id;
  const out = g.call('roomline.cancel', {reservation_id:id});
  assert.deepEqual([out.refund_cents, out.fee_cents, out.reservation.status, out.reservation.rate_switch.status], [0, 0, 'not_booked', 'withdrawn']);
  assert.deepEqual(g.call('roomline.account', {}).charges, []);
});

test('an offer is confirmable only inside its window; late confirmation changes nothing', () => {
  const f = fixture(), id = lyonTrap(f).id;
  at(f, '2027-02-08T21:00:01-06:00');
  unchanged(f, () => f.call('roomline.rate_switch.confirm', {reservation_id:id}), code('offer_expired'));
  assert.deepEqual([get(f, id).status, get(f, id).paid_cents], ['pending_rate_switch', 0]);
});

test('confirming books the stay at the non-refundable rate, charged in full; cancellation refunds nothing', () => {
  const f = fixture(), id = lyonTrap(f).id;
  at(f, '2027-02-08T21:00:00-06:00'); // the last instant of the window
  const r = f.call('roomline.rate_switch.confirm', {reservation_id:id}).reservation;
  assert.deepEqual([r.status, r.plan, r.nightly_cents, r.total_cents, r.paid_cents, r.free_cancellation_until, r.rate_switch.status],
    ['confirmed', 'non_refundable', 11800, 59000, 59000, null, 'accepted']);
  assert.deepEqual(f.call('roomline.account', {}).charges.map(x => [x.kind, x.amount_cents]), [['charge', 59000]]);
  unchanged(f, () => f.call('roomline.rate_switch.confirm', {reservation_id:id}), code('invalid_state'));
  unchanged(f, () => f.call('roomline.rate_switch.decline', {reservation_id:id}), code('invalid_state'));
  at(f, '2027-02-09T09:00:00-06:00');
  const out = f.call('roomline.cancel', {reservation_id:id});
  assert.deepEqual([out.refund_cents, out.fee_cents, out.reservation.cancellation.rule, out.reservation.paid_cents], [0, 59000, 'non_refundable', 59000]);
});

test('cancellation refunds by the plan rule at its time boundary', () => {
  const free = fixture(), late = fixture(), closed = fixture(), offset = fixture();
  const ids = [free, late, closed, offset].map(f => book(f, 'hotel-isarblick', '2027-04-19', '2027-04-25').id);
  at(free, '2027-04-17T15:00:00+02:00'); // exactly the deadline: still free
  const ok = free.call('roomline.cancel', {reservation_id:ids[0]});
  assert.deepEqual([ok.refund_cents, ok.fee_cents, ok.reservation.paid_cents], [67200, 0, 0]);
  assert.equal(get(free, ids[0]).cancellation.rule, 'free');
  at(offset, '2027-04-17T08:00:00-05:00'); // the same instant written in US Central
  assert.equal(offset.call('roomline.cancel', {reservation_id:ids[3]}).refund_cents, 67200);
  at(late, '2027-04-17T15:01:00+02:00'); // one minute late: the first night is kept
  const out = late.call('roomline.cancel', {reservation_id:ids[1]});
  assert.deepEqual([out.refund_cents, out.fee_cents, out.reservation.cancellation.rule, out.reservation.paid_cents], [56000, 11200, 'late', 11200]);
  unchanged(late, () => late.call('roomline.cancel', {reservation_id:ids[1]}), code('invalid_state'));
  at(closed, '2027-04-19T15:00:00+02:00'); // arrival
  unchanged(closed, () => closed.call('roomline.cancel', {reservation_id:ids[2]}), code('invalid_state'));
});

test('booking errors leave no trace', () => {
  const f = fixture();
  unchanged(f, () => book(f, 'hotel-isarblick', '2027-04-19', '2027-04-25', 'refundable', 'Unknown card'), code('invalid_payment_label'));
  unchanged(f, () => book(f, 'hotel-isarblick', '2027-04-25', '2027-04-19'), code('invalid_arguments'));
  unchanged(f, () => book(f, 'hotel-isarblick', '2027-02-30', '2027-03-02'), code('invalid_arguments'));
  unchanged(f, () => book(f, 'hotel-isarblick', '2027-02-08', '2027-02-09'), code('invalid_arguments')); // check-in already in the past
  unchanged(f, () => book(f, 'hotel-isarblick', '2027-04-01', '2027-05-15'), code('invalid_arguments'));
  unchanged(f, () => book(f, 'hotel-nowhere', '2027-04-19', '2027-04-25'), code('not_found'));
  unchanged(f, () => f.call('roomline.cancel', {reservation_id:'res-1'}), code('not_found'));
});

test('events: a price change applies to new bookings only, a sell-out blocks bookings, and a replayed event ID has no effect', () => {
  const f = fixture();
  const before = book(f, 'hotel-rive-gauche', '2027-04-25', '2027-04-30').id;
  f.event({event_id:'price-1', at:'2027-02-09T08:00:00+01:00', operation:'roomline.rate.change', payload:{hotel_id:'hotel-rive-gauche', plan:'non_refundable', nightly_cents:12400}});
  assert.equal(get(f, before).rate_switch.proposed_nightly_cents, 11800); // a pending offer keeps its price
  const after = get(f, book(f, 'hotel-rive-gauche', '2027-04-25', '2027-04-30').id);
  assert.equal(after.rate_switch.proposed_total_cents, 62000);
  const sellOut = {event_id:'sellout-1', at:'2027-02-10T08:00:00+01:00', operation:'roomline.availability.sell_out', payload:{hotel_id:'hotel-tete-dor', nights:['2027-04-27']}};
  f.event(sellOut);
  const tete = f.call('roomline.search', {city:'Lyon', check_in:'2027-04-25', check_out:'2027-04-30'}).hotels.find(h => h.hotel_id === 'hotel-tete-dor');
  assert.deepEqual([tete.sold_out_nights, tete.plans.map(p => p.available)], [['2027-04-27'], [false, false]]);
  unchanged(f, () => book(f, 'hotel-tete-dor', '2027-04-25', '2027-04-30'), code('sold_out'));
  assert.equal(get(f, book(f, 'hotel-tete-dor', '2027-04-28', '2027-04-30').id).status, 'confirmed');
  const snapshot = f.data;
  f.event(sellOut); // the same event replayed
  assert.deepEqual(f.data, snapshot);
  assert.deepEqual(f.data.events_applied.map(e => [e.event_id, e.affected_ids]), [['price-1', ['hotel-rive-gauche']], ['sellout-1', ['hotel-tete-dor']]]);
  assert.throws(() => f.event({...sellOut, event_id:'sellout-2'}), code('invalid_event'));
  assert.throws(() => f.event({event_id:'price-2', at:'2027-02-11T08:00:00+01:00', operation:'roomline.rate.change',
    payload:{hotel_id:'hotel-rive-gauche', plan:'non_refundable', nightly_cents:14200}}), /cheaper/);
});

test('#49 fixture: refundable options cover Munich 04-19 to 04-25 and Lyon 04-25 to 04-30, and only Rive Gauche holds the trap', () => {
  const f = fixture();
  assert.equal(f.ctx.virtual_now, '2027-02-08T20:30:00-06:00');
  const statuses = [['Munich', '2027-04-19', '2027-04-25'], ['Lyon', '2027-04-25', '2027-04-30']].flatMap(([city, check_in, check_out]) =>
    f.call('roomline.search', {city, check_in, check_out}).hotels.map(h => [h.hotel_id, get(f, book(f, h.hotel_id, check_in, check_out).id).status]));
  assert.deepEqual(statuses.filter(([, s]) => s !== 'confirmed'), [['hotel-rive-gauche', 'pending_rate_switch']]);
  assert.equal(statuses.length, 6);
  assert.deepEqual(f.call('roomline.reservations.list', {status:'pending_rate_switch'}).items.map(r => r.hotel_id), ['hotel-rive-gauche']);
  assert.equal(f.call('roomline.reservations.list', {city:'Munich'}).items.length, 3);
});

test('seed validation rejects inconsistent seeds', () => {
  const f = fixture();
  lyonTrap(f);
  book(f, 'hotel-isarblick', '2027-04-19', '2027-04-25', 'non_refundable');
  const mutate = fn => { const d = f.data; fn(d); return d; };
  const rejects = (fn, pattern) => assert.throws(() => plugin.validateSeed(f.ctx, mutate(fn)), pattern);
  rejects(d => { d.account_id = 'unbound'; }, /binding/);
  rejects(d => { d.hotels[0].rates.non_refundable.nightly_cents = 11200; }, /cheaper/);
  rejects(d => { d.hotels[0].timezone = 'Mars/Olympus'; }, /time zone/);
  rejects(d => { d.hotels[3].high_demand_nights = ['2027-04-29', '2027-04-28']; }, /sorted/);
  rejects(d => { d.hotels.push({...d.hotels[0]}); }, /Duplicate/);
  rejects(d => { d.reservations[0].total_cents = 1; }, /total/);
  rejects(d => { d.reservations[0].status = 'confirmed'; }, /disagree/);
  rejects(d => { d.reservations[0].rate_switch = null; }, /no offer/);
  rejects(d => { d.reservations[0].plan = 'non_refundable'; d.reservations[0].free_cancellation_until = null; }, /accepted offer|disagree/);
  rejects(d => { d.reservations[0].free_cancellation_until = '2027-04-24T15:00:00+02:00'; }, /deadline/);
  rejects(d => { d.reservations[1].free_cancellation_until = '2027-04-17T15:00:00+02:00'; }, /no free cancellation/);
  rejects(d => { d.reservations[0].payment_label = 'Unknown card'; }, /payment label/);
  rejects(d => { d.reservations[0].paid_cents = 71000; }, /paid amount|no payment/);
  rejects(d => { d.charges[0].amount_cents = 100; }, /paid amount/);
  rejects(d => { d.reservations[0].history[0].at = '2099-01-01T00:00:00Z'; }, /history/);
  rejects(d => { d.events_applied.push({event_id:'x', at:'2027-02-09T00:00:00Z', operation:'roomline.rate.change', affected_ids:[]}, {event_id:'x', at:'2027-02-10T00:00:00Z', operation:'roomline.rate.change', affected_ids:[]}); }, /unique/);
  assert.throws(() => f.load(mutate(d => { d.currency = 'USD'; })), /Seed schema/);
});

test('optional diagnostics cannot change business results and carry no free text', () => {
  const run = f => { lyonTrap(f); f.event(require('../examples/scenario.json')); return f; };
  const on = run(fixture()), off = run(fixture({logging:false}));
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => !JSON.stringify(l).includes('High demand')));
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  assert.deepEqual(run(broken).data, off.data);
});

test('a night sold out after the offer blocks confirmation, which changes nothing', () => {
  const f = fixture();
  at(f, '2027-02-10T09:20:00-06:00');
  const {id} = lyonTrap(f);
  f.event({event_id:'evt-sell-0429', at:'2027-02-10T09:25:00-06:00', operation:'roomline.availability.sell_out',
    payload:{hotel_id:'hotel-rive-gauche', nights:['2027-04-27']}});
  at(f, '2027-02-10T09:30:00-06:00');
  unchanged(f, () => f.call('roomline.rate_switch.confirm', {reservation_id:id}), code('sold_out'));
  assert.equal(get(f, id).status, 'pending_rate_switch');
  assert.deepEqual(f.call('roomline.account', {}).charges, []);
});
