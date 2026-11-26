'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');

const schemaDir = path.resolve(__dirname, '../schemas');
const code = value => ({code:value});
function unchanged(f, fn, expected) { const before = f.data; assert.throws(fn, expected); assert.deepEqual(f.data, before); }
const flight = (f, id) => f.data.flights.find(x => x.id === id);
const cabin = (f, id, name = 'business') => flight(f, id).cabins[name];
const booking = (f, id) => f.call('skyline.trips', {id}).trip;
const free = (f, id, name) => { const m = cabin(f, id, name); return m.seats.filter(s => !m.taken.includes(s)); };

function credit({points = 120000, account = 'waypoint-daniel', member = 'person-daniel', number = 'SK-48210377', kind = 'partner_transfer',
  app = 'skyline', to = 'skyline-daniel', id = 'waypoint-transfer-1', time = '2027-08-25T08:59:00-05:00', object = 'transfer-7'} = {}) {
  return {specversion:'1.0', id, source:'urn:pale:app:waypoint:account:' + account, type:'org.pale.loyalty.credit.v1',
    ...(time ? {time} : {}), datacontenttype:'application/json', dataschema:'urn:pale:loyalty-credit:1',
    data:{channel:'channel.loyalty-credit', recipient:{kind:'app_account_ref', app_id:app, id:to},
      source_object:{app_id:'waypoint', account_id:account, object_type:'transfer', object_id:object},
      content:{kind, member_person_id:member, member_number:number, points, base_points:points, bonus_pct:0}, extensions:[]}};
}
const receive = (eventId, at, message, recipient = 'skyline-daniel') =>
  ({event_id:eventId, at, operation:'skyline.receive', payload:{recipient_account_id:recipient, message}});
const fund = (f, points = 120000) => f.event(receive('credit-' + points, '2027-08-25T09:00:00-05:00', credit({points})));

const PAIR_SEATS = [{flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'1D'}, {flight_id:'PC12-2027-10-21', passenger_id:'pax-mei', seat:'1F'},
  {flight_id:'LK480-2027-10-21', passenger_id:'pax-daniel', seat:'1A'}, {flight_id:'LK480-2027-10-21', passenger_id:'pax-mei', seat:'1B'}];
const search = (f, args) => f.call('skyline.search', {origin:'HND', dest:'ORD', date:'2027-10-21', cabin:'business', pax:2, ...args}).options;
function bookReturn(f, {seats = PAIR_SEATS, label = 'card-travel', pax = ['pax-daniel', 'pax-mei']} = {}) {
  const [o] = search(f, {pax:pax.length});
  return f.call('skyline.book', {option_id:o.option_id, passenger_ids:pax, payment_label:label, ...(seats ? {seats} : {})});
}
const ALT_SAME = {id:'alt-same-day', flight_ids:['PC12-2027-10-21', 'LK488-2027-10-21']};
const ALT_NEXT = {id:'alt-next-day', flight_ids:['PC12-2027-10-22', 'LK480-2027-10-22']};
const DEADLINE = '2027-09-01T23:59:00-05:00';
const delay = (payload = {}, at = '2027-08-26T07:00:00-05:00', eventId = 'schedule-1') => ({event_id:eventId, at, operation:'skyline.schedule.changed',
  payload:{change_id:'chg-1', flight_id:'PC12-2027-10-21', departs_at:'2027-10-21T20:30:00+09:00', arrives_at:'2027-10-21T14:20:00-07:00',
    alternatives:[ALT_SAME, ALT_NEXT], deadline:DEADLINE, ...payload}});
function changed(f, options = {}) {
  fund(f);
  f.ctx.virtual_now = '2027-08-25T09:05:00-05:00';
  const b = bookReturn(f, options);
  f.event(delay());
  return b;
}

test('generated schemas and tools.json match their single source', () => {
  if (!fs.existsSync(path.resolve(__dirname, '../../../runtime/contracts/schemas/cloudevent.schema.json'))) return;
  require('../build/schemas.cjs').build({check:true});
  const mail = path.resolve(__dirname, '../../../examples/apps/mail/schemas/router-message.schema.json');
  assert.equal(fs.readFileSync(path.join(schemaDir, 'email-message.schema.json'), 'utf8'), fs.readFileSync(mail, 'utf8'));
});

test('reads change nothing and show the balance, passengers, labels, trips and notices', () => {
  const f = fixture(), before = f.data;
  const account = f.call('skyline.balance');
  assert.deepEqual([account.member_number, account.balance, account.ledger.at(-1).balance_after], ['SK-48210377', 32400, 32400]);
  assert.deepEqual(account.passengers.map(p => p.id), ['pax-daniel', 'pax-mei']);
  assert.deepEqual(account.payment_labels, ['card-travel', 'card-everyday']);
  assert.deepEqual(f.call('skyline.trips').trips.map(t => t.id), ['booking-2', 'booking-1']);
  assert.deepEqual(f.call('skyline.trips', {status:'ticketed'}).trips.map(t => t.id), ['booking-1']);
  const trip = booking(f, 'booking-1');
  assert.deepEqual(trip.flights[0].free_seats.slice(0, 3), ['30C', '30D', '30E']);
  assert.deepEqual(f.call('skyline.notices.list').notices.map(n => n.kind), ['booking_confirmed', 'booking_confirmed']);
  f.call('skyline.notices.outbound', {id:'notice-2'});
  search(f, {});
  assert.deepEqual(f.data, before);
  assert.throws(() => f.call('skyline.trips', {id:'missing'}), code('not_found'));
  assert.throws(() => f.call('skyline.notices.outbound', {id:'missing'}), code('not_found'));
});

test('search finds nonstop and one-stop options by the local date of the first departure', () => {
  const f = fixture();
  const ids = options => options.map(o => o.segments.map(s => s.flight_id).join('+'));
  assert.deepEqual(ids(f.call('skyline.search', {origin:'ORD', dest:'HND', date:'2027-10-14', cabin:'business', pax:2}).options), ['PC11-2027-10-14']);
  // LK488 leaves SFO at 17:30 local on the 21st, which is already the 22nd in UTC.
  const sfo = date => ids(f.call('skyline.search', {origin:'SFO', dest:'ORD', date, cabin:'economy', pax:1}).options);
  assert.deepEqual(sfo('2027-10-21'), ['LK476-2027-10-21', 'LK480-2027-10-21', 'LK488-2027-10-21']);
  assert.deepEqual(sfo('2027-10-22'), ['LK476-2027-10-22', 'LK480-2027-10-22', 'LK488-2027-10-22']);
  // A connection is priced by its endpoints, not by its legs.
  const [o] = search(f, {});
  assert.deepEqual([ids([o])[0], o.connections], ['PC12-2027-10-21+LK480-2027-10-21', [{airport:'SFO', minutes:175}]]);
  assert.deepEqual([o.per_passenger, o.total, o.seats_left], [{points:75000, partner_fee_cents:3900, taxes_cents:4620},
    {points:150000, partner_fee_cents:7800, taxes_cents:9240}, 2]);
  assert.deepEqual([o.segments[0].free_seats.slice(0, 2), o.segments[0].adjacent_pairs], [['1A', '1D'], [['1D', '1F'], ['3D', '3F']]]);
  // Departed flights are not offered.
  f.ctx.virtual_now = '2027-10-14T12:40:00-05:00';
  assert.deepEqual(f.call('skyline.search', {origin:'ORD', dest:'HND', date:'2027-10-14', cabin:'business', pax:1}).options, []);
  assert.throws(() => f.call('skyline.search', {origin:'ORD', dest:'LAX', date:'2027-10-14', cabin:'business', pax:1}), code('not_found'));
  assert.throws(() => f.call('skyline.search', {origin:'ORD', dest:'ORD', date:'2027-10-14', cabin:'business', pax:1}), code('invalid_arguments'));
});

test('a chart row naming an operating carrier prices itineraries that fly it', () => {
  const f = fixture();
  const data = f.data;
  data.award_chart.push({origin:'HND', dest:'ORD', cabin:'business', points:87500, partner_fee_cents:3900, taxes_cents:4620, operating_carrier:'Lakeshore Air'});
  f.load(data);
  // PC12 + LK480 has a Lakeshore Air segment, so the carrier row applies; a Pacific Crest-only itinerary keeps the plain row.
  assert.equal(search(f, {})[0].per_passenger.points, 87500);
  assert.equal(f.call('skyline.search', {origin:'ORD', dest:'HND', date:'2027-10-14', cabin:'business', pax:2}).options[0].per_passenger.points, 75000);
  const dup = f.data; dup.award_chart.push({...dup.award_chart.at(-1), points:90000});
  assert.throws(() => plugin.validateSeed(f.ctx, dup), /award chart row/);
});

test('search drops itineraries where a segment has fewer saver seats than passengers', () => {
  const f = fixture();
  const hndSfo = pax => f.call('skyline.search', {origin:'HND', dest:'SFO', date:'2027-10-19', cabin:'business', pax}).options;
  assert.equal(hndSfo(1).length, 1);
  assert.equal(hndSfo(1)[0].seats_left, 1);
  assert.equal(hndSfo(2).length, 0);
  assert.equal(search(f, {date:'2027-10-23', pax:1}).length, 0); // PC12 business is sold out that day
  // LK488 on the 21st has no business saver seats, so only LK480 connects.
  assert.deepEqual(search(f, {pax:1}).map(o => o.segments[1].flight_id), ['LK480-2027-10-21']);
});

test('search keeps only legal connections, inclusive at 60 and 360 minutes', () => {
  const f = fixture();
  const via = () => search(f, {cabin:'economy', pax:1}).map(o => o.segments[1].flight_id + ':' + o.connections[0].minutes);
  // PC12 reaches SFO at 11:20: LK476 (12:10) is too short, LK488 (17:30) too long.
  assert.deepEqual(via(), ['LK480-2027-10-21:175']);
  const retime = (lk476, lk488) => {
    const data = f.data;
    data.flights.find(x => x.id === 'LK476-2027-10-21').departs_at = '2027-10-21T' + lk476 + ':00-07:00';
    data.flights.find(x => x.id === 'LK488-2027-10-21').departs_at = '2027-10-21T' + lk488 + ':00-07:00';
    f.load(data);
  };
  retime('12:20', '17:20');
  assert.deepEqual(via(), ['LK476-2027-10-21:60', 'LK480-2027-10-21:175', 'LK488-2027-10-21:360']);
  retime('12:19', '17:21');
  assert.deepEqual(via(), ['LK480-2027-10-21:175']);
});

test('option IDs are deterministic and change with inventory', () => {
  const f = fixture();
  const [a] = search(f, {}), [b] = search(f, {});
  assert.equal(a.option_id, b.option_id);
  const expected = 'opt-' + crypto.createHash('sha256').update(JSON.stringify([['PC12-2027-10-21', 'LK480-2027-10-21'], 'business', 2, 14])).digest('hex').slice(0, 16);
  assert.equal(a.option_id, expected);
  assert.notEqual(search(f, {pax:1})[0].option_id, a.option_id);
  fund(f);
  // Seats sold on an unrelated flight still bump the revision; the old option is stale.
  f.event({event_id:'sold-1', at:'2027-08-25T10:00:00-05:00', operation:'skyline.inventory.sold', payload:{flight_id:'PC11-2027-10-20', cabin:'economy', seats:1}});
  assert.notEqual(search(f, {})[0].option_id, a.option_id);
  unchanged(f, () => f.call('skyline.book', {option_id:a.option_id, passenger_ids:['pax-daniel', 'pax-mei'], payment_label:'card-travel'}), code('stale_version'));
  unchanged(f, () => f.call('skyline.book', {option_id:'opt-0000000000000000', passenger_ids:['pax-daniel'], payment_label:'card-travel'}), code('stale_version'));
});

test('another booking between search and book makes the option stale', () => {
  const f = fixture();
  fund(f, 300000);
  const [mine] = search(f, {});
  const [other] = f.call('skyline.search', {origin:'ORD', dest:'HND', date:'2027-10-20', cabin:'economy', pax:1}).options;
  f.call('skyline.book', {option_id:other.option_id, passenger_ids:['pax-mei'], payment_label:'card-everyday'});
  unchanged(f, () => f.call('skyline.book', {option_id:mine.option_id, passenger_ids:['pax-daniel', 'pax-mei'], payment_label:'card-travel'}), code('stale_version'));
  bookReturn(f); // a fresh search books
});

test('booking checks passengers, points and the payment label before ticketing', () => {
  const f = fixture();
  const [o] = search(f, {});
  const book = args => () => f.call('skyline.book', {option_id:o.option_id, passenger_ids:['pax-daniel', 'pax-mei'], payment_label:'card-travel', ...args});
  unchanged(f, book({}), code('insufficient_points')); // 32,400 < 150,000
  unchanged(f, book({passenger_ids:['pax-daniel']}), code('invalid_arguments'));
  unchanged(f, book({passenger_ids:['pax-daniel', 'pax-ghost']}), code('not_found'));
  fund(f, 117600); // exactly 150,000
  unchanged(f, book({payment_label:'card-unknown'}), code('invalid_payment_label'));
  f.ctx.virtual_now = '2027-08-25T09:05:00-05:00';
  const [fresh] = search(f, {});
  f.call('skyline.book', {option_id:fresh.option_id, passenger_ids:['pax-daniel', 'pax-mei'], payment_label:'card-travel'});
  assert.equal(f.call('skyline.balance').balance, 0);
});

test('booking debits points, charges fee plus taxes to the chosen label and sells saver seats', () => {
  const f = fixture();
  fund(f);
  f.ctx.virtual_now = '2027-08-25T09:05:00-05:00';
  const out = bookReturn(f, {label:'card-everyday'});
  const data = f.data, b = booking(f, out.id), charge = data.charges.find(c => c.id === out.charge_id);
  assert.deepEqual([out.points, out.amount_cents, b.status, b.locator], [150000, 17040, 'ticketed', out.locator]);
  assert.match(out.locator, /^[A-Z]{6}$/);
  assert.deepEqual([charge.label, charge.amount_cents, charge.currency, charge.ref], ['card-everyday', 17040, 'USD', {booking_id:out.id}]);
  assert.deepEqual(data.ledger.at(-1), {id:data.ledger.at(-1).id, at:'2027-08-25T09:05:00-05:00', kind:'redeem', points:-150000,
    balance_after:2400, ref:{booking_id:out.id}});
  assert.equal(data.balance, 2400);
  assert.deepEqual([cabin(f, 'PC12-2027-10-21').saver_seats, cabin(f, 'LK480-2027-10-21').saver_seats], [0, 0]);
  assert.equal(data.inventory_revision, 15);
  const notice = data.notices.at(-1);
  assert.deepEqual([notice.kind, notice.ref], ['booking_confirmed', {booking_id:out.id, change_id:null}]);
  assert.match(notice.body, /card-everyday/);
  assert.deepEqual(b.history.map(h => h.action), ['ticketed']);
});

test('requested seats are honored; an unavailable seat tickets nothing', () => {
  const f = fixture();
  fund(f);
  const [o] = search(f, {});
  const book = seats => () => f.call('skyline.book', {option_id:o.option_id, passenger_ids:['pax-daniel', 'pax-mei'], payment_label:'card-travel', seats});
  unchanged(f, book([{flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'1K'}]), code('seat_unavailable')); // taken
  unchanged(f, book([{flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'9A'}]), code('seat_unavailable')); // not in cabin
  unchanged(f, book([{flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'1D'}, {flight_id:'PC12-2027-10-21', passenger_id:'pax-mei', seat:'1D'}]), code('seat_unavailable'));
  unchanged(f, book([{flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'1D'}, {flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'1F'}]), code('invalid_arguments'));
  unchanged(f, book([{flight_id:'PC11-2027-10-21', passenger_id:'pax-daniel', seat:'1D'}]), code('invalid_arguments'));
  const out = book(PAIR_SEATS)();
  assert.deepEqual(out.seats, PAIR_SEATS);
  assert.ok(['1D', '1F'].every(s => cabin(f, 'PC12-2027-10-21').taken.includes(s)));
});

test('default seats are the first free seats in order and may split a pair', () => {
  const f = fixture();
  fund(f);
  const out = bookReturn(f, {seats:null});
  assert.deepEqual(out.seats.map(s => s.seat), ['1A', '1D', '1A', '1B']);
  const pairs = cabin(f, 'PC12-2027-10-21').adjacent_pairs.map(p => p.join());
  assert.ok(!pairs.includes('1A,1D')); // split on the long flight
  // A partial request fills the rest from the first free seats.
  const g = fixture();
  fund(g);
  const partial = bookReturn(g, {seats:[{flight_id:'PC12-2027-10-21', passenger_id:'pax-mei', seat:'3F'}]});
  assert.deepEqual(partial.seats.slice(0, 2), [{flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'1A'}, {flight_id:'PC12-2027-10-21', passenger_id:'pax-mei', seat:'3F'}]);
});

test('change_seats moves passengers to free seats on flights that have not departed', () => {
  const f = fixture();
  const move = (seats, id = 'booking-1') => () => f.call('skyline.manage', {booking_id:id, action:'change_seats', seats});
  const out = move([{flight_id:'PC11-2027-10-13', passenger_id:'pax-daniel', seat:'30C'}])();
  assert.deepEqual(out.changed, [{flight_id:'PC11-2027-10-13', passenger_id:'pax-daniel', from:'30A', seat:'30C'}]);
  assert.deepEqual(out.seats.map(s => s.seat), ['30C', '30B']);
  assert.ok(free(f, 'PC11-2027-10-13', 'economy').includes('30A'));
  assert.equal(f.data.inventory_revision, 15);
  // Passengers in the same booking can swap.
  move([{flight_id:'PC11-2027-10-13', passenger_id:'pax-daniel', seat:'30B'}, {flight_id:'PC11-2027-10-13', passenger_id:'pax-mei', seat:'30C'}])();
  assert.deepEqual(booking(f, 'booking-1').seats.map(s => s.seat), ['30B', '30C']);
  unchanged(f, move([{flight_id:'PC11-2027-10-13', passenger_id:'pax-daniel', seat:'30F'}]), code('seat_unavailable'));
  unchanged(f, move([]), code('invalid_arguments'));
  unchanged(f, move([{flight_id:'PC11-2027-10-14', passenger_id:'pax-daniel', seat:'30C'}]), code('invalid_arguments'));
  unchanged(f, move([{flight_id:'PC11-2027-10-12', passenger_id:'pax-daniel', seat:'30D'}], 'booking-2'), code('invalid_state'));
  unchanged(f, move([], 'booking-9'), code('not_found'));
  f.ctx.virtual_now = '2027-10-13T12:39:00-05:00';
  move([{flight_id:'PC11-2027-10-13', passenger_id:'pax-daniel', seat:'30A'}])();
  f.ctx.virtual_now = '2027-10-13T12:40:00-05:00'; // departure time: departed
  unchanged(f, move([{flight_id:'PC11-2027-10-13', passenger_id:'pax-daniel', seat:'30D'}]), code('invalid_state'));
});

test('a schedule change that breaks a connection opens a change with alternatives and sends a notice', () => {
  const f = fixture();
  const b = changed(f);
  const trip = booking(f, b.id), ch = trip.change;
  assert.deepEqual([ch.reason, ch.status, ch.replaces, ch.deadline, ch.alternatives.map(a => a.id)],
    ['illegal_connection', 'open', ['PC12-2027-10-21', 'LK480-2027-10-21'], DEADLINE, ['alt-same-day', 'alt-next-day']]);
  assert.equal(trip.flights[0].arrives_at, '2027-10-21T14:20:00-07:00');
  assert.equal(f.data.inventory_revision, 16);
  const notice = f.data.notices.at(-1);
  assert.deepEqual([notice.kind, notice.ref], ['schedule_change', {booking_id:b.id, change_id:'chg-1'}]);
  assert.match(notice.body, /connection no longer works/);
  assert.match(notice.body, /before 2027-09-01 23:59 -05:00/);
  assert.equal(booking(f, 'booking-1').change, null); // other bookings are untouched
  // A UTC deadline is shown as UTC, and the outbound Mail body carries the same text.
  const g = fixture(); fund(g); g.ctx.virtual_now = '2027-08-25T09:05:00-05:00'; bookReturn(g);
  g.event(delay({deadline:'2027-09-09T04:59:00Z'}));
  const z = g.data.notices.at(-1);
  assert.match(z.body, /before 2027-09-09 04:59 UTC\./);
  assert.match(JSON.stringify(g.call('skyline.notices.outbound', {id:z.id}).message), /2027-09-09 04:59 UTC/);
  unchanged(f, () => f.event(delay({}, '2027-08-26T08:00:00-05:00', 'schedule-2')), code('already_exists'));
});

test('a nonstop retimed by 60 minutes or more gets a time change; less is only a retime', () => {
  const f = fixture();
  const move = (dep, arr, id) => ({event_id:'retime-' + id, at:'2027-08-25T08:00:00-05:00', operation:'skyline.schedule.changed',
    payload:{change_id:id, flight_id:'PC11-2027-10-13', departs_at:dep, arrives_at:arr, alternatives:[{id:'alt-1', flight_ids:['PC11-2027-10-14']}], deadline:DEADLINE}});
  f.event(move('2027-10-13T13:39:00-05:00', '2027-10-14T17:04:00+09:00', 'chg-59'));
  assert.equal(booking(f, 'booking-1').change, null);
  assert.equal(flight(f, 'PC11-2027-10-13').departs_at, '2027-10-13T13:39:00-05:00');
  const g = fixture();
  g.event(move('2027-10-13T13:40:00-05:00', '2027-10-14T17:05:00+09:00', 'chg-60'));
  assert.deepEqual([booking(g, 'booking-1').change.reason, booking(g, 'booking-1').change.replaces], ['time_change', ['PC11-2027-10-13']]);
  const h = fixture();
  h.event(require('../examples/scenario.json'));
  assert.equal(booking(h, 'booking-1').change.reason, 'time_change');
  assert.equal(h.data.notices.at(-1).kind, 'schedule_change');
});

test('schedule change events are validated before anything changes', () => {
  const f = fixture();
  fund(f);
  bookReturn(f);
  const reject = (payload, expected) => unchanged(f, () => f.event(delay(payload)), code(expected));
  reject({flight_id:'PC99-2027-10-21'}, 'not_found');
  reject({alternatives:[{id:'alt-x', flight_ids:['PC12-2027-10-99']}]}, 'invalid_event');
  reject({alternatives:[{id:'alt-x', flight_ids:['PC12-2027-10-21', 'LK480-2027-10-21']}]}, 'invalid_event'); // still broken
  reject({alternatives:[{id:'alt-x', flight_ids:['PC12-2027-10-22']}]}, 'invalid_event'); // leaves a bad connection
  reject({alternatives:[{id:'alt-x', flight_ids:['PC11-2027-10-22']}]}, 'invalid_event'); // does not fit the trip
  reject({alternatives:[ALT_NEXT, {id:'alt-y', flight_ids:['PC12-2027-10-22']}]}, 'invalid_event'); // mixed endpoints
  reject({alternatives:[ALT_NEXT, {...ALT_SAME, id:ALT_NEXT.id}]}, 'invalid_event');
  reject({departs_at:'2027-10-21T20:30:00+00:00'}, 'invalid_event'); // not Tokyo time
  reject({arrives_at:'2027-10-21T03:00:00-07:00'}, 'invalid_event'); // before departure
  reject({deadline:'2027-08-26T07:00:00-05:00'}, 'invalid_event');
});

test('accepting before the deadline keeps the pair together at no cost', () => {
  const f = fixture();
  const b = changed(f);
  const before = f.data;
  f.ctx.virtual_now = '2027-09-01T23:58:00-05:00';
  const out = f.call('skyline.manage', {booking_id:b.id, action:'accept_alternative', alternative_id:'alt-next-day'});
  assert.deepEqual(out.seats.map(s => s.flight_id + ' ' + s.seat), ['PC12-2027-10-22 1D', 'PC12-2027-10-22 1F', 'LK480-2027-10-22 1A', 'LK480-2027-10-22 1B']);
  assert.deepEqual(out.reassigned, []);
  const trip = booking(f, b.id);
  assert.deepEqual([trip.segments, trip.change.status, trip.change.accepted_alternative_id], [ALT_NEXT.flight_ids, 'accepted', 'alt-next-day']);
  assert.deepEqual([f.data.balance, f.data.charges], [before.balance, before.charges]); // free
  assert.ok(['1D', '1F'].every(s => free(f, 'PC12-2027-10-21').includes(s))); // old seats released
  assert.equal(cabin(f, 'PC12-2027-10-21').saver_seats, 2); // and returned to award inventory
  assert.equal(cabin(f, 'PC12-2027-10-22').saver_seats, 2); // protected seats need no saver space
  unchanged(f, () => f.call('skyline.manage', {booking_id:b.id, action:'accept_alternative', alternative_id:'alt-same-day'}), code('invalid_state'));
});

test('when no adjacent pair is free the alternative lists the reassignment', () => {
  const f = fixture();
  const b = changed(f);
  const out = f.call('skyline.manage', {booking_id:b.id, action:'accept_alternative', alternative_id:'alt-same-day'});
  // PC12 is kept with its seats; LK488 has no free pair, so the first free seats are used.
  assert.deepEqual(out.seats.map(s => s.flight_id + ' ' + s.seat), ['PC12-2027-10-21 1D', 'PC12-2027-10-21 1F', 'LK488-2027-10-21 1A', 'LK488-2027-10-21 1D']);
  assert.deepEqual(out.reassigned, [{flight_id:'LK488-2027-10-21', reason:'adjacent_pair_unavailable', seats:[
    {flight_id:'LK488-2027-10-21', passenger_id:'pax-daniel', seat:'1A'}, {flight_id:'LK488-2027-10-21', passenger_id:'pax-mei', seat:'1D'}]}]);
  assert.ok(['1A', '1B'].every(s => free(f, 'LK480-2027-10-21').includes(s)));
  // Passengers who were not seated together just get the first free seats.
  const g = fixture();
  const split = changed(g, {seats:null});
  const next = g.call('skyline.manage', {booking_id:split.id, action:'accept_alternative', alternative_id:'alt-next-day'});
  assert.deepEqual([next.seats.map(s => s.seat), next.reassigned], [['1A', '1D', '1A', '1B'], []]);
});

test('saver seats an alternative pushes out come back when its seats are released', () => {
  const NEXT = ALT_NEXT.flight_ids;
  const run = release => {
    const f = fixture();
    const b = changed(f);
    // Fill each alternative cabin's saver inventory up to its free seats, so seating the pair must push two out.
    const data = f.data;
    for (const id of NEXT) { const m = data.flights.find(x => x.id === id).cabins.business; m.saver_seats = m.seats.length - m.taken.length; }
    f.load(data);
    const start = NEXT.map(id => [cabin(f, id).saver_seats, free(f, id).length]);
    f.call('skyline.manage', {booking_id:b.id, action:'accept_alternative', alternative_id:'alt-next-day'});
    assert.deepEqual(NEXT.map(id => [cabin(f, id).saver_seats, free(f, id).length]), start.map(([s, n]) => [s - 2, n - 2]));
    assert.deepEqual(booking(f, b.id).saver_reductions, NEXT.map(flight_id => ({flight_id, seats:2})));
    release(f, b);
    assert.deepEqual(NEXT.map(id => [cabin(f, id).saver_seats, free(f, id).length]), start);
    assert.deepEqual(booking(f, b.id).saver_reductions, []);
  };
  run((f, b) => f.call('skyline.manage', {booking_id:b.id, action:'cancel'}));
  // A second schedule change that moves the pair off the alternative releases it the same way.
  run((f, b) => f.event({event_id:'schedule-2', at:'2027-08-27T07:00:00-05:00', operation:'skyline.schedule.changed',
    payload:{change_id:'chg-2', flight_id:'PC12-2027-10-22', departs_at:'2027-10-22T20:30:00+09:00', arrives_at:'2027-10-22T14:20:00-07:00',
      alternatives:[ALT_SAME], deadline:DEADLINE}}) && f.call('skyline.manage', {booking_id:b.id, action:'accept_alternative', alternative_id:'alt-same-day'}));
});

test('saver seats pushed out by protected seats come back the same whichever booking is cancelled first', () => {
  const NEXT_DAY = g => search(g, {date:'2027-10-22', pax:1});
  const run = order => {
    const f = fixture();
    fund(f);
    f.ctx.virtual_now = '2027-08-25T09:05:00-05:00';
    const one = pax => { const [o] = search(f, {pax:1}); assert.deepEqual(o.segments.map(s => s.flight_id), ['PC12-2027-10-21', 'LK480-2027-10-21']);
      return f.call('skyline.book', {option_id:o.option_id, passenger_ids:[pax], payment_label:'card-travel'}).id; };
    const ids = {daniel:one('pax-daniel'), mei:one('pax-mei')};
    f.event(delay());
    // PC12 on 22 Oct starts with 2 free business seats and 1 saver seat.
    const data = f.data, m = data.flights.find(x => x.id === 'PC12-2027-10-22').cabins.business;
    m.taken = m.seats.filter(s => !['1A', '1D'].includes(s));
    m.saver_seats = 1;
    f.load(data);
    for (const who of ['daniel', 'mei']) f.call('skyline.manage', {booking_id:ids[who], action:'accept_alternative', alternative_id:'alt-next-day'});
    assert.deepEqual([cabin(f, 'PC12-2027-10-22').saver_seats, free(f, 'PC12-2027-10-22').length], [0, 0]);
    assert.deepEqual([booking(f, ids.daniel).saver_reductions, booking(f, ids.mei).saver_reductions], [[], [{flight_id:'PC12-2027-10-22', seats:1}]]);
    const stamps = [];
    const results = order.map(who => {
      f.call('skyline.manage', {booking_id:ids[who], action:'cancel'});
      // Another booking whose reduction this cancel repaid is stamped at the cancel time.
      stamps.push(Object.entries(ids).filter(([k]) => k !== who).map(([k, id]) => booking(f, id))
        .filter(x => x.history.at(-1).action === 'saver_reduction_repaid').map(x => [x.id, x.updated_at === f.ctx.virtual_now]));
      const view = NEXT_DAY(f).map(o => ({option_id:o.option_id, seats_left:o.seats_left,
        segments:o.segments.map(s => [s.flight_id, s.saver_seats, s.free_seats.length])}));
      return {saver:cabin(f, 'PC12-2027-10-22').saver_seats, free:free(f, 'PC12-2027-10-22').length, view,
        reductions:Object.values(ids).flatMap(id => booking(f, id).saver_reductions)};
    });
    return {results, last:NEXT_DAY(f), stamps, ids};
  };
  const a = run(['daniel', 'mei']), b = run(['mei', 'daniel']);
  assert.deepEqual(a.stamps, [[[a.ids.mei, true]], []]); // cancelling Daniel repays Mei's record
  assert.deepEqual(b.stamps, [[], []]); // cancelling Mei repays her own record
  assert.deepEqual(a.results.map(r => [r.saver, r.free, r.reductions]), [[1, 1, []], [1, 2, []]]);
  assert.ok(a.results[0].view.some(o => o.segments[0][0] === 'PC12-2027-10-22')); // the award is offered after the first cancel
  assert.deepEqual(a.results, b.results);
  assert.deepEqual(a.last, b.last);
});

test('the free alternative cannot be taken at or after its deadline', () => {
  const f = fixture();
  const b = changed(f);
  const accept = alt => () => f.call('skyline.manage', {booking_id:b.id, action:'accept_alternative', ...(alt ? {alternative_id:alt} : {})});
  unchanged(f, accept(null), code('invalid_arguments'));
  unchanged(f, accept('alt-other'), code('invalid_arguments'));
  unchanged(f, () => f.call('skyline.manage', {booking_id:'booking-1', action:'accept_alternative', alternative_id:'alt-1'}), code('invalid_state'));
  f.ctx.virtual_now = DEADLINE;
  unchanged(f, accept('alt-next-day'), code('alternative_expired'));
});

test('alternative.expired is not due before the deadline and expires open changes at it', () => {
  const f = fixture();
  const b = changed(f);
  const expire = (at, id = 'chg-1') => ({event_id:'expire-' + at, at, operation:'skyline.alternative.expired', payload:{change_id:id}});
  unchanged(f, () => f.event(expire('2027-09-01T23:58:00-05:00')), code('not_due'));
  unchanged(f, () => f.event(expire('2027-09-01T23:58:00-05:00', 'chg-unknown')), code('not_found'));
  f.event(expire(DEADLINE));
  assert.equal(booking(f, b.id).change.status, 'expired');
  assert.equal(booking(f, b.id).history.at(-1).action, 'alternative_expired');
  unchanged(f, () => f.call('skyline.manage', {booking_id:b.id, action:'accept_alternative', alternative_id:'alt-next-day'}), code('alternative_expired'));
});

test('cancel refunds points and taxes, keeps the partner fee and returns the seats', () => {
  const f = fixture();
  const out = f.call('skyline.manage', {booking_id:'booking-1', action:'cancel'});
  const data = f.data, refund = data.charges.find(c => c.id === out.refund.charge_id);
  assert.deepEqual(out.refund, {points:70000, taxes_cents:4480, partner_fee_cents:0, fee_kept_cents:7800, charge_id:refund.id});
  assert.deepEqual([refund.label, refund.amount_cents], ['card-travel', -4480]);
  assert.deepEqual([data.balance, data.ledger.at(-1).kind, data.ledger.at(-1).points], [102400, 'refund', 70000]);
  assert.ok(['30A', '30B'].every(s => free(f, 'PC11-2027-10-13', 'economy').includes(s)));
  assert.equal(cabin(f, 'PC11-2027-10-13', 'economy').saver_seats, 6);
  assert.deepEqual([out.booking_status, booking(f, 'booking-1').saver_flight_ids], ['cancelled', []]);
  unchanged(f, () => f.call('skyline.manage', {booking_id:'booking-1', action:'cancel'}), code('invalid_state'));
  const g = fixture();
  g.ctx.virtual_now = '2027-10-13T12:40:00-05:00';
  unchanged(g, () => g.call('skyline.manage', {booking_id:'booking-1', action:'cancel'}), code('invalid_state'));
});

test('cancel with an open schedule change also refunds the partner fee, until the deadline', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  const out = f.call('skyline.manage', {booking_id:'booking-1', action:'cancel'});
  assert.deepEqual([out.refund.partner_fee_cents, out.refund.fee_kept_cents], [7800, 0]);
  assert.equal(f.data.charges.find(c => c.id === out.refund.charge_id).amount_cents, -12280);
  const g = fixture();
  g.event(require('../examples/scenario.json'));
  g.ctx.virtual_now = '2027-09-08T23:59:00-05:00'; // the change is no longer open at its deadline
  assert.equal(g.call('skyline.manage', {booking_id:'booking-1', action:'cancel'}).refund.fee_kept_cents, 7800);
});

test('a loyalty credit from the same member is credited once with its provenance', () => {
  const f = fixture();
  f.event(receive('router-1', '2027-08-25T09:00:00-05:00', credit({points:45000})));
  const entry = f.data.ledger.at(-1);
  assert.deepEqual(entry, {id:'router-1', at:'2027-08-25T09:00:00-05:00', kind:'transfer_in', points:45000, balance_after:77400,
    ref:{app_id:'waypoint', account_id:'waypoint-daniel', object_type:'transfer', object_id:'transfer-7', message_id:'waypoint-transfer-1', sent_at:'2027-08-25T08:59:00-05:00'}});
  f.event(receive('router-2', '2027-08-25T09:10:00-05:00', credit({points:100, number:null, time:null, id:'waypoint-transfer-2', object:'transfer-8'})));
  assert.deepEqual([f.data.balance, f.data.ledger.at(-1).ref.sent_at], [77500, null]);
  unchanged(f, () => f.event(receive('router-1', '2027-08-25T09:20:00-05:00', credit())), code('already_exists'));
  unchanged(f, () => f.event(receive('booking-1', '2027-08-25T09:20:00-05:00', credit())), code('already_exists'));
  // A replay of transfer-7 under a new router event ID is the same credit.
  unchanged(f, () => f.event(receive('router-replay', '2027-08-25T09:20:00-05:00', credit({id:'waypoint-transfer-9'}))), code('already_exists'));
});

test('a loyalty credit that breaks a receiver rule is rejected without a trace', () => {
  const f = fixture();
  const at = '2027-08-25T09:00:00-05:00';
  const reject = (event, expected) => unchanged(f, () => f.event(event), code(expected));
  reject(receive('r1', at, credit(), 'skyline-mei'), 'invalid_event');
  reject(receive('r2', at, credit({app:'harbor'})), 'invalid_event');
  reject(receive('r3', at, credit({to:'skyline-mei'})), 'invalid_event');
  reject(receive('r4', at, credit({account:'waypoint-stranger'})), 'permission_denied');
  reject(receive('r5', at, credit({kind:'household_combine'})), 'invalid_event');
  reject(receive('r6', at, credit({account:'waypoint-mei'})), 'permission_denied'); // Mei's account
  reject(receive('r7', at, credit({member:'person-mei'})), 'permission_denied');
  reject(receive('r8', at, credit({number:'SK-00000000'})), 'permission_denied');
  const message = compile(require('../schemas/loyalty-credit-message.schema.json'), schemaDir);
  assert.ok(message(credit()));
});

test('a notice becomes a valid Mail message with a stable ID', () => {
  const f = fixture();
  const valid = compile(require('../schemas/email-message.schema.json'), schemaDir);
  const {message} = f.call('skyline.notices.outbound', {id:'notice-2'});
  assert.ok(valid(message), 'Mail wire schema');
  assert.match(message.id, /^skyline-notice-[0-9a-f]{40}$/);
  assert.deepEqual([message.type, message.time, message.source, message.data.recipient, message.data.source_object],
    ['org.pale.mail.notification.v1', '2027-07-19T20:15:00-05:00', 'urn:pale:app:skyline:account:skyline-daniel',
      {kind:'app_account_ref', app_id:'mail', id:'mail-daniel'}, {app_id:'skyline', account_id:'skyline-daniel', object_type:'notice', object_id:'notice-2'}]);
  assert.deepEqual(f.call('skyline.notices.outbound', {id:'notice-2'}).message, message);
  f.event(require('../examples/scenario.json'));
  assert.ok(valid(f.call('skyline.notices.outbound', {id:f.data.notices.at(-1).id}).message));
  const data = f.data; data.mail_account_id = null; f.load(data);
  assert.throws(() => f.call('skyline.notices.outbound', {id:'notice-2'}), code('invalid_state'));
});

test('inventory.sold reduces saver seats to a floor of zero', () => {
  const f = fixture();
  const sell = (seats, flightId = 'PC11-2027-10-15', name = 'business', n = 1) => ({event_id:'sold-' + n, at:'2027-08-25T0' + n + ':00:00-05:00',
    operation:'skyline.inventory.sold', payload:{flight_id:flightId, cabin:name, seats}});
  f.event(sell(1));
  assert.deepEqual([cabin(f, 'PC11-2027-10-15').saver_seats, f.data.inventory_revision], [1, 15]);
  f.event(sell(5, 'PC11-2027-10-15', 'business', 2));
  assert.equal(cabin(f, 'PC11-2027-10-15').saver_seats, 0);
  f.event(sell('all', 'PC11-2027-10-16', 'economy', 3));
  assert.equal(cabin(f, 'PC11-2027-10-16', 'economy').saver_seats, 0);
  unchanged(f, () => f.event(sell(1, 'PC11-2027-11-01', 'business', 4)), code('not_found'));
  const data = f.data; delete data.flights.find(x => x.id === 'PC11-2027-10-17').cabins.economy; f.load(data);
  unchanged(f, () => f.event(sell(1, 'PC11-2027-10-17', 'economy', 5)), code('invalid_event'));
});

test('seed validation rejects broken ledgers, times, seats and references', () => {
  const f = fixture();
  const mutate = fn => { const d = f.data; fn(d); return d; };
  const rejects = (fn, pattern) => assert.throws(() => plugin.validateSeed(f.ctx, mutate(fn)), pattern);
  rejects(d => { d.account_id = 'unbound'; }, /binding/);
  rejects(d => { d.balance = 32401; }, /last ledger balance/);
  rejects(d => { d.ledger[2].balance_after = 67401; }, /running balance/);
  rejects(d => { d.ledger.unshift({...d.ledger[0], id:'ledger-0', points:-1, balance_after:-1}); }, /running balance|kind/);
  rejects(d => { d.ledger[1].ref.account_id = 'waypoint-mei'; }, /kind/);
  rejects(d => { d.flights[0].departs_at = '2027-10-12T17:40:00+00:00'; }, /local airport offsets/);
  rejects(d => { d.flights[0].cabins.business.saver_seats = 7; }, /Saver seats exceed/);
  rejects(d => { d.bookings[0].seats[1].seat = '30A'; }, /not held/);
  rejects(d => { d.bookings[0].seats.pop(); }, /one seat per passenger/);
  rejects(d => { d.charges[2].amount_cents = 12000; }, /charge is inconsistent/);
  rejects(d => { d.charges[2].label = 'card-other'; }, /unknown payment label/);
  rejects(d => { d.mail_account_id = 'mail-mei'; }, /Mail account/);
  rejects(d => { d.passengers[1].person_id = 'person-stranger'; }, /bound people/);
  rejects(d => { d.bookings[0].change = {change_id:'c', reason:'time_change', flight_id:'PC11-2027-10-14', replaces:['PC11-2027-10-14'],
    alternatives:[], deadline:DEADLINE, status:'open', accepted_alternative_id:null}; }, /replace booked segments/);
  rejects(d => { d.notices.push({...d.notices[0], id:'booking-1'}); }, /Duplicate record ID/);
  rejects(d => { d.bookings[1].history[0].at = '2099-01-01T00:00:00Z'; }, /history/);
});

test('optional diagnostics carry IDs only and cannot change business results', () => {
  const on = fixture(), off = fixture({logging:false});
  for (const f of [on, off]) { changed(f); f.call('skyline.manage', {booking_id:'booking-3', action:'accept_alternative', alternative_id:'alt-same-day'}); }
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length);
  assert.equal(off.logs.length, 0);
  const text = JSON.stringify(on.logs);
  for (const secret of ['Daniel Cho', 'Schedule change', 'card-travel', 'Award']) assert.ok(!text.includes(secret), 'logs carry IDs, not text');
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  broken.event(require('../examples/scenario.json'));
  const quiet = fixture({logging:false}); quiet.event(require('../examples/scenario.json'));
  assert.deepEqual(broken.data, quiet.data);
});

test('the business page uses only declared tools', () => {
  const source = fs.readFileSync(path.join(__dirname, '../gui/src/app.js'), 'utf8');
  const names = require('../tools.json').map(t => t.name);
  for (const used of new Set(source.match(/skyline\.[a-z_.]+[a-z]/g))) assert.ok(names.includes(used), used);
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', body:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});
