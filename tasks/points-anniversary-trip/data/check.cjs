#!/usr/bin/env node
'use strict';
// Replays the reference solution's App-side steps on this task's data, over real MCP
// processes and Messaging, and checks every number the rubric relies on.
//
//   node tasks/points-anniversary-trip/data/check.cjs --root <checkout with runtime/ and the #193 Apps>
//
// Covered: Waypoint (Daniel and Mei), Skyline and Harbor. Not covered here: Mail, Messages,
// Calendar, the card account (#182) and the user model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const root = path.resolve(arg('--root') || path.resolve(__dirname, '../../..'));
for (const need of ['runtime/client.cjs', 'apps/waypoint', 'apps/skyline', 'apps/harbor', 'registry.points.json'])
  if (!fs.existsSync(path.join(root, need))) { console.error('Missing ' + need + ' under ' + root + '. Pass --root <checkout with #193>.'); process.exit(2); }
process.chdir(root); // Messaging configs resolve the registry and package roots from the checkout.

const {Client} = require(path.join(root, 'runtime/client.cjs'));
const {deliverable, settleEvent} = require(path.join(root, 'apps/waypoint/src/settlement.cjs'));
const data = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
const copy = value => structuredClone(value);
const binding = data('binding.json'), timeline = data('timeline.json');
const RESERVE = 'chase-sapphire-reserve', PAX = ['pax-daniel', 'pax-mei'];

async function run() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-55-')), meiState = path.join(state, 'mei');
  fs.mkdirSync(meiState);
  const clients = [], checks = [];
  let sequence = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks.push(label); };
  const ok = (label, condition) => { assert.ok(condition, label); checks.push(label); };
  async function open(app, role, directory = state) {
    const client = new Client(app, role, 'task-55', directory, 'task-55-check', {registry:path.join(root, 'registry.points.json')});
    clients.push(client); await client.initialize(); return client;
  }
  const version = async infra => (await infra.call('env.snapshot')).version;
  async function write(agent, infra, name, args) {
    const result = await agent.call(name, {...args, expected_version:await version(infra), request_id:'w-' + (++sequence)});
    assert.equal(result.status, 'committed', JSON.stringify({name, result})); return result;
  }
  async function load(infra, app, seed) {
    const s = await infra.call('env.snapshot'), bundle = copy(s.snapshot.resources.bundle);
    const plugin = require(path.join(root, 'apps', app, 'plugin.cjs'));
    bundle.dataset.expected_counts.records = plugin.records(seed).length;
    const result = await infra.call('env.load_seed', {expected_version:s.version, request_id:'load-' + (++sequence), data:seed,
      binding:{...copy(binding), objects:{[app]:plugin.objects(seed)}}, policies:copy(s.snapshot.policies), bundle});
    assert.equal(result.status, 'ready', app + ': ' + JSON.stringify(result));
    assert.equal((await infra.call('env.reset', {expected_version:await version(infra), profile:'sandbox'})).status, 'ready');
  }
  let infras = [];
  async function clock(iso) {
    for (const infra of infras) {
      const r = await infra.call('env.advance_time', {expected_version:await version(infra), virtual_now:iso, request_id:'clock-' + (++sequence)});
      assert.ok(r.status === 'committed' || r.status === 'ok', JSON.stringify(r));
    }
  }
  const byApp = {};
  async function world(until) { // apply timeline events due by `until`, in order
    for (const {app, event} of timeline.events.filter(e => !e.done && e.event.at <= until)) {
      await clock(event.at);
      const result = await byApp[app].call('env.apply_event', {expected_version:await version(byApp[app]), event});
      timeline.events.find(e => e.event === event).done = result;
    }
    await clock(until);
  }
  const outcome = id => timeline.events.find(e => e.event.event_id === id).done;
  async function router(config) {
    const client = new Client(null, null, null, null, 'task-55-router', {commandArgs:[path.join(root, 'runtime/messaging/service.cjs'),
      '--config', path.join(__dirname, 'messaging', config), '--publisher', 'waypoint', '--run', 'task-55', '--state-dir', state]});
    clients.push(client); await client.initialize(); return client;
  }
  async function deliver(agent, infra, bridge) {
    const s = await infra.call('env.snapshot'), out = [];
    for (const t of deliverable(s.snapshot.data, s.snapshot.virtual_now)) {
      const message = (await agent.call('waypoint.transfer.outbound', {id:t.id})).message;
      const receipt = await bridge.call('router.publish', {request_id:'deliver-' + t.id, message});
      const settle = settleEvent(t, receipt, (await infra.call('env.snapshot')).snapshot.virtual_now);
      if (settle) assert.equal((await infra.call('env.apply_event', {expected_version:await version(infra), event:settle})).status, 'committed');
      out.push(receipt);
    }
    return out;
  }
  const pairSeats = option => option.segments.flatMap(seg => {
    const [a, b] = seg.adjacent_pairs[0];
    return [{flight_id:seg.flight_id, passenger_id:PAX[0], seat:a}, {flight_id:seg.flight_id, passenger_id:PAX[1], seat:b}];
  });
  const seedFlights = data('skyline.seed.json').flights;
  const isPair = (id, [a, b]) => {
    const pairs = seedFlights.find(f => f.id === id).cabins.business.adjacent_pairs.map(p => p.slice().sort().join());
    return pairs.includes([a, b].sort().join());
  };

  try {
    const waypoint = await open('waypoint', 'agent'), waypointInfra = await open('waypoint', 'infra');
    const skyline = await open('skyline', 'agent'), skylineInfra = await open('skyline', 'infra');
    const harbor = await open('harbor', 'agent'), harborInfra = await open('harbor', 'infra');
    const meiInfra = await open('waypoint', 'infra', meiState);
    await load(waypointInfra, 'waypoint', data('waypoint-daniel.seed.json'));
    await load(meiInfra, 'waypoint', data('waypoint-mei.seed.json'));
    await load(skylineInfra, 'skyline', data('skyline.seed.json'));
    await load(harborInfra, 'harbor', data('harbor.seed.json'));
    const mei = await open('waypoint', 'agent', meiState);
    infras = [waypointInfra, meiInfra, skylineInfra, harborInfra];
    Object.assign(byApp, {skyline:skylineInfra, harbor:harborInfra});
    await clock(timeline.start);
    const danielBridge = await router('daniel-config.json'), meiBridge = await router('mei-config.json');

    // Starting state.
    equal('Starting balances: UR 281,600, Aeroplan 0, Hyatt 41,200',
      [(await waypoint.call('waypoint.balance', {})).balance, (await skyline.call('skyline.balance', {})).balance, (await harbor.call('harbor.account', {})).balance],
      [281600, 0, 41200]);
    equal('Hyatt points are forfeited at 2027-09-30T00:00:00-05:00 without activity',
      (await harbor.call('harbor.account', {})).expires_at, '2027-09-30T00:00:00-05:00');
    const bonus = (await waypoint.call('waypoint.bonuses', {})).items;
    equal('The 30% Aeroplan bonus is announced and upcoming', bonus.map(b => [b.partner_id, b.percent, b.state, b.starts_at]),
      [['aeroplan', 30, 'upcoming', '2027-09-01T00:00:00-05:00']]);

    // Session 1, 2027-08-24 21:00: the return (OPT-R1).
    const RETURN = {origin:'HND', dest:'MSP', date:'2027-10-25', cabin:'business', pax:2};
    let [r1, ...rest] = (await skyline.call('skyline.search', RETURN)).options;
    equal('Return search shows one business option, UA 838 + UA 2210', [rest.length, r1.segments.map(s => s.flight_id)], [0, ['UA838-2027-10-25', 'UA2210-2027-10-25']]);
    equal('OPT-R1: 2 seats, 75,000 points + USD 28.50 + USD 70.40 per passenger', [r1.seats_left, r1.per_passenger],
      [2, {points:75000, partner_fee_cents:2850, taxes_cents:7040}]);
    ok('Default seating would split the couple on every OPT-R1 segment',
      r1.segments.every(seg => !isPair(seg.flight_id, seg.free_seats.slice(0, 2))));
    ok('Every OPT-R1 segment has a free adjacent pair', r1.segments.every(seg => seg.adjacent_pairs.length > 0));
    await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'aeroplan', points:150000});
    equal('150,000 UR reach Aeroplan', (await deliver(waypoint, waypointInfra, danielBridge)).map(r => r.status), ['committed']);
    [r1] = (await skyline.call('skyline.search', RETURN)).options;
    const back = await write(skyline, skylineInfra, 'skyline.book', {option_id:r1.option_id, passenger_ids:PAX, payment_label:RESERVE, seats:pairSeats(r1)});
    const backTrip = (await skyline.call('skyline.trips', {id:back.id})).trip;
    ok('Return ticketed with adjacent seats on both segments', backTrip.segments.every(id => isPair(id, backTrip.seats.filter(s => s.flight_id === id).map(s => s.seat))));
    equal('Return taxes and fees on the Reserve: $197.80', (await skyline.call('skyline.balance', {})).charges.map(c => [c.label, c.amount_cents]), [[RESERVE, 19780]]);

    // Mei acts at 07:40 on an exact text; the return seats sell out at 18:00.
    await world('2027-08-25T07:40:00-05:00');
    await write(mei, meiInfra, 'waypoint.combine', {to_person_id:'person-daniel', points:171900});
    equal('Mei → Daniel combine commits', (await deliver(mei, meiInfra, meiBridge)).map(r => r.status), ['committed']);
    equal('Pool after the combine: 303,500 UR', (await waypoint.call('waypoint.balance', {})).balance, 303500);

    // Alert-triggered session, 2027-08-25 08:00: outbound (OPT-A1) and hotels.
    await world('2027-08-25T08:00:00-05:00');
    const OUT = {origin:'MSP', dest:'HND', date:'2027-10-15', cabin:'business', pax:2};
    await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'aeroplan', points:150000});
    await deliver(waypoint, waypointInfra, danielBridge);
    const [a1] = (await skyline.call('skyline.search', OUT)).options;
    equal('OPT-A1: UA 1735 + UA 837, 2 seats, 75,000 + USD 28.50 + USD 11.20 per passenger',
      [a1.segments.map(s => s.flight_id), a1.seats_left, a1.per_passenger],
      [['UA1735-2027-10-15', 'UA837-2027-10-15'], 2, {points:75000, partner_fee_cents:2850, taxes_cents:1120}]);
    ok('Default seating would split the couple on every OPT-A1 segment', a1.segments.every(seg => !isPair(seg.flight_id, seg.free_seats.slice(0, 2))));
    const out = await write(skyline, skylineInfra, 'skyline.book', {option_id:a1.option_id, passenger_ids:PAX, payment_label:RESERVE, seats:pairSeats(a1)});
    const outTrip = (await skyline.call('skyline.trips', {id:out.id})).trip;
    ok('Outbound ticketed with adjacent seats on both segments', outTrip.segments.every(id => isPair(id, outTrip.seats.filter(s => s.flight_id === id).map(s => s.seat))));
    equal('No business award space on 2027-10-16', (await skyline.call('skyline.search', {...OUT, date:'2027-10-16'})).options.length, 0);

    await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'hyatt', points:147000});
    await deliver(waypoint, waypointInfra, danielBridge);
    equal('Hyatt after the transfer: 188,200', (await harbor.call('harbor.account', {})).balance, 188200);
    ok('The transfer counts as Hyatt activity', (await harbor.call('harbor.account', {})).expires_at > '2029-08-01');
    const hotels = async (city, check_in, check_out) => Object.fromEntries((await harbor.call('harbor.search', {city, check_in, check_out})).hotels.map(h => [h.hotel_id, h]));
    const arrival = await hotels('Tokyo', '2027-10-16', '2027-10-17');
    equal('Arrival night: certificate fits only Hyatt Regency Tokyo Bay among Tokyo hotels',
      Object.values(arrival).filter(h => h.eligible_certificate_ids.includes('cert-fn-2027')).map(h => h.hotel_id), ['hotel-hr-tokyo-bay']);
    const book = (hotel_id, check_in, check_out, payment) => write(harbor, harborInfra, 'harbor.book', {hotel_id, check_in, check_out, payment});
    await book('hotel-hr-tokyo-bay', '2027-10-16', '2027-10-17', {method:'certificate', certificate_id:'cert-fn-2027'});
    equal('Hyatt Regency Tokyo, 3 nights: 63,000', (await book('hotel-hr-tokyo', '2027-10-17', '2027-10-20', {method:'points'})).points, 63000);
    equal('Hyatt Regency Kyoto, 5 nights at Category 6: 125,000', (await book('hotel-hr-kyoto', '2027-10-20', '2027-10-25', {method:'points'})).points, 125000);
    equal('After the reference hotels: Hyatt 200, UR 6,500', [(await harbor.call('harbor.account', {})).balance,
      (await waypoint.call('waypoint.balance', {})).balance], [200, 6500]);

    // The world moves on.
    await world('2027-09-12T10:30:00-05:00');
    equal('Return and outbound award seats sold out on schedule',
      [(await skyline.call('skyline.search', RETURN)).options.length, (await skyline.call('skyline.search', OUT)).options.length], [0, 0]);
    equal('Kyoto moves to Category 7 from 2027-10-01; the booked stay keeps Category 6',
      [outcome('category-hr-kyoto-2027-10').status, (await harbor.call('harbor.reservations', {})).items.find(r => r.hotel_id === 'hotel-hr-kyoto').category_locked],
      ['committed', 6]);
    const changed = (await skyline.call('skyline.trips', {id:back.id})).trip;
    equal('The 2027-09-11 schedule change breaks the SFO connection and offers ALT-1 until 2027-09-18 23:59',
      [changed.change.status, changed.change.reason, changed.change.deadline], ['open', 'illegal_connection', '2027-09-18T23:59:00-05:00']);

    // Session 2, 2027-09-12 10:30: accept ALT-1.
    const accepted = await write(skyline, skylineInfra, 'skyline.manage', {booking_id:back.id, action:'accept_alternative', alternative_id:'ALT-1'});
    const fixed = (await skyline.call('skyline.trips', {id:back.id})).trip;
    equal('ALT-1 replaces UA 2210 with UA 2386 at no cost', [fixed.segments, accepted.reassigned], [['UA838-2027-10-25', 'UA2386-2027-10-25'], []]);
    ok('The pair stays adjacent on every return segment after ALT-1', fixed.segments.every(id => isPair(id, fixed.seats.filter(s => s.flight_id === id).map(s => s.seat))));

    await world('2027-10-03T11:00:00-05:00');
    equal('Hyatt is not forfeited at 2027-09-30', [outcome('expire-hyatt-2027-09-30').status, (await harbor.call('harbor.account', {})).balance], ['not_due', 200]);
    equal('Cash for flights and hotels: $277.20, all on the Reserve',
      (await skyline.call('skyline.balance', {})).charges.map(c => [c.label, c.amount_cents]), [[RESERVE, 19780], [RESERVE, 7940]]);
    equal('No stranded transferred points: Aeroplan 0, Hyatt 200', [(await skyline.call('skyline.balance', {})).balance,
      (await harbor.call('harbor.account', {})).balance], [0, 200]);

    const report = {passed:true, checks:checks.length, names:checks};
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(state, {recursive:true, force:true});
  }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
