#!/usr/bin/env node
'use strict';
// Replays the App-side steps of the reference solution and of the 2027-09-01 bonus path on this
// task's data, over real MCP processes and Messaging, and checks every number the rubric relies on.
//
//   node tasks/points-anniversary-trip/data/check.cjs --root <checkout with runtime/ and the #193 Apps>
//
// Covered: Waypoint (Daniel and Mei), Skyline (Aeroplan, United MileagePlus, Virgin Atlantic) and
// Harbor (World of Hyatt). The workspace Apps are checked by ../workspace/validate.cjs; the card
// account (#182) and the user model are not covered here.
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
const binding = data('binding.json');
const RESERVE = 'chase-sapphire-reserve', PAX = ['pax-daniel', 'pax-mei'];
const RETURN = {origin:'HND', dest:'MSP', date:'2027-10-25', cabin:'business', pax:2};
const OUT = {origin:'MSP', dest:'HND', date:'2027-10-15', cabin:'business', pax:2};
const seedFlights = data('skyline.seed.json').flights;
const isPair = (id, [a, b]) => seedFlights.find(f => f.id === id).cabins.business.adjacent_pairs
  .map(p => p.slice().sort().join()).includes([a, b].sort().join());
const seatedTogether = trip => trip.segments.every(id => isPair(id, trip.seats.filter(s => s.flight_id === id).map(s => s.seat)));
const pairSeats = option => option.segments.flatMap(seg => {
  const [a, b] = seg.adjacent_pairs[0];
  return [{flight_id:seg.flight_id, passenger_id:PAX[0], seat:a}, {flight_id:seg.flight_id, passenger_id:PAX[1], seat:b}];
});
const ids = options => options.map(o => o.segments.map(s => s.flight_id).join('+'));

async function run(variant) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-55-'));
  const dir = name => { const d = path.join(state, name); fs.mkdirSync(d); return d; };
  const meiState = dir('mei'), unitedState = dir('united'), virginState = dir('virgin');
  const timeline = data('timeline.json');
  const clients = [], checks = [];
  let sequence = 0;
  const equal = (label, actual, expected) => { assert.deepEqual(actual, expected, variant + ': ' + label); checks.push(label); };
  const ok = (label, condition) => { assert.ok(condition, variant + ': ' + label); checks.push(label); };
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
  const infras = [], byAccount = {};
  async function clock(iso) {
    for (const infra of infras) {
      const r = await infra.call('env.advance_time', {expected_version:await version(infra), virtual_now:iso, request_id:'clock-' + (++sequence)});
      assert.ok(r.status === 'committed' || r.status === 'ok', JSON.stringify(r));
    }
  }
  async function world(until) { // apply the timeline events due by `until`, in order
    for (const entry of timeline.events.filter(e => !e.done && Date.parse(e.event.at) <= Date.parse(until))) {
      await clock(entry.event.at);
      const infra = byAccount[entry.account_id];
      entry.done = await infra.call('env.apply_event', {expected_version:await version(infra), event:entry.event});
    }
    await clock(until);
  }
  const outcome = (id, account) => timeline.events.find(e => e.event.event_id === id && e.account_id === account).done;
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

  try {
    const waypoint = await open('waypoint', 'agent'), waypointInfra = await open('waypoint', 'infra');
    const skyline = await open('skyline', 'agent'), skylineInfra = await open('skyline', 'infra');
    const harbor = await open('harbor', 'agent'), harborInfra = await open('harbor', 'infra');
    const meiInfra = await open('waypoint', 'infra', meiState);
    const unitedInfra = await open('skyline', 'infra', unitedState), virginInfra = await open('skyline', 'infra', virginState);
    await load(waypointInfra, 'waypoint', data('waypoint-daniel.seed.json'));
    await load(meiInfra, 'waypoint', data('waypoint-mei.seed.json'));
    await load(skylineInfra, 'skyline', data('skyline.seed.json'));
    await load(unitedInfra, 'skyline', data('skyline-united.seed.json'));
    await load(virginInfra, 'skyline', data('skyline-virgin.seed.json'));
    await load(harborInfra, 'harbor', data('harbor.seed.json'));
    const mei = await open('waypoint', 'agent', meiState);
    const united = await open('skyline', 'agent', unitedState), virgin = await open('skyline', 'agent', virginState);
    infras.push(waypointInfra, meiInfra, skylineInfra, unitedInfra, virginInfra, harborInfra);
    Object.assign(byAccount, {'skyline-daniel':skylineInfra, 'skyline-united-daniel':unitedInfra, 'skyline-virgin-daniel':virginInfra, 'harbor-daniel':harborInfra});
    await clock(timeline.start);
    const danielBridge = await router('daniel-config.json'), meiBridge = await router('mei-config.json');
    const hyatt = async () => harbor.call('harbor.account', {});
    // Each sell-out is checked on award seats nobody booked: ANA's one seat on Aeroplan, United's own
    // space and Virgin's ANA seat are all open one minute before the cutoff and gone at it.
    const count = async (client, args) => (await client.call('skyline.search', args)).options.length;
    const openSeats = async direction => direction === 'return'
      ? [await count(skyline, {...RETURN, pax:1}), await count(united, RETURN), await count(virgin, {origin:'HND', dest:'ORD', date:'2027-10-25', cabin:'business', pax:1})]
      : [await count(skyline, {...OUT, pax:1}), await count(united, OUT), await count(virgin, {origin:'ORD', dest:'HND', date:'2027-10-15', cabin:'business', pax:1})];
    async function cutoff(direction, at) {
      const before = new Date(Date.parse(at) - 60000 - 5 * 3600000).toISOString().slice(0, 19) + '-05:00'; // one minute earlier, Central
      await world(before);
      ok('Unbooked ' + direction + ' award seats are open in every program at ' + before, (await openSeats(direction)).every(n => n > 0));
      await world(at);
      equal('Every program\'s ' + direction + ' award seats are gone at ' + at, await openSeats(direction), [0, 0, 0]);
    }

    // Starting state and the comparison searches of session 1.
    equal('Starting balances: UR 281,600, Aeroplan 0, United 12,400, Hyatt 41,200',
      [(await waypoint.call('waypoint.balance', {})).balance, (await skyline.call('skyline.balance', {})).balance,
        (await united.call('skyline.balance', {})).balance, (await hyatt()).balance], [281600, 0, 12400, 41200]);
    equal('Hyatt points are forfeited at 2027-09-30T00:00:00-05:00 without activity', (await hyatt()).expires_at, '2027-09-30T00:00:00-05:00');
    equal('Partners: Aeroplan, Hyatt, United and Virgin, all instant 1:1', (await waypoint.call('waypoint.partners', {})).items.map(p => [p.id, p.ratio.to, p.delay_minutes]),
      [['aeroplan', 1, 0], ['hyatt', 1, 0], ['united', 1, 0], ['virgin', 1, 0]]);
    equal('The 30% Aeroplan bonus is announced and upcoming', (await waypoint.call('waypoint.bonuses', {})).items.map(b => [b.partner_id, b.percent, b.state, b.starts_at]),
      [['aeroplan', 30, 'upcoming', '2027-09-01T00:00:00-05:00']]);
    let [r1, ...others] = (await skyline.call('skyline.search', RETURN)).options;
    equal('Aeroplan return for two: only OPT-R1, UA 838 + UA 2210', [others.length, ids([r1])], [0, ['UA838-2027-10-25+UA2210-2027-10-25']]);
    equal('OPT-R1: 2 seats, 75,000 points + USD 28.50 + USD 70.40 per passenger', [r1.seats_left, r1.per_passenger],
      [2, {points:75000, partner_fee_cents:2850, taxes_cents:7040}]);
    const single = async (client, args) => (await client.call('skyline.search', {...args, pax:1})).options.map(o => [ids([o])[0], o.per_passenger.points, o.seats_left]);
    equal('Aeroplan for one: OPT-A2 via Chicago on ANA costs 87,500 with one seat', await single(skyline, OUT),
      [['UA1735-2027-10-15+UA837-2027-10-15', 75000, 2], ['UA2455-2027-10-15+NH11-2027-10-15', 87500, 1]]);
    equal('United prices its own seats at 110,000 out and 98,000 back, no partner fee',
      [(await united.call('skyline.search', OUT)).options[0].per_passenger, (await united.call('skyline.search', RETURN)).options[0].per_passenger],
      [{points:110000, partner_fee_cents:0, taxes_cents:1120}, {points:98000, partner_fee_cents:0, taxes_cents:7040}]);
    equal('Virgin: ANA from Chicago only, 52,500 + USD 286 surcharges, one seat',
      [await single(virgin, {origin:'ORD', dest:'HND', date:'2027-10-15', cabin:'business'}),
        (await virgin.call('skyline.search', {origin:'ORD', dest:'HND', date:'2027-10-15', cabin:'business', pax:2})).options.length],
      [[['NH11-2027-10-15', 52500, 1]], 0]);
    ok('Default seating would split the couple on every OPT-R1 segment', r1.segments.every(seg => !isPair(seg.flight_id, seg.free_seats.slice(0, 2))));

    // Session 1, 2027-08-24 21:00: book the return with Daniel's own points.
    await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'aeroplan', points:150000});
    equal('150,000 UR reach Aeroplan', (await deliver(waypoint, waypointInfra, danielBridge)).map(r => r.status), ['committed']);
    [r1] = (await skyline.call('skyline.search', RETURN)).options;
    const back = await write(skyline, skylineInfra, 'skyline.book', {option_id:r1.option_id, passenger_ids:PAX, payment_label:RESERVE, seats:pairSeats(r1)});
    ok('Return ticketed with adjacent seats on both segments', seatedTogether((await skyline.call('skyline.trips', {id:back.id})).trip));
    equal('Return taxes and fees on the Reserve: $197.80', (await skyline.call('skyline.balance', {})).charges.map(c => [c.label, c.amount_cents]), [[RESERVE, 19780]]);

    // Mei acts at 07:40 on an exact text.
    await world('2027-08-25T07:40:00-05:00');
    await write(mei, meiInfra, 'waypoint.combine', {to_person_id:'person-daniel', points:171900});
    equal('Mei → Daniel combine commits', (await deliver(mei, meiInfra, meiBridge)).map(r => r.status), ['committed']);
    equal('Pool after the combine: 303,500 UR', (await waypoint.call('waypoint.balance', {})).balance, 303500);

    // Outbound and hotels: on 2027-08-25 08:00 (reference), or on 2027-09-01 with the bonus (accepted approach).
    const at = variant === 'reference' ? '2027-08-25T08:00:00-05:00' : '2027-09-01T08:00:00-05:00';
    if (variant === 'bonus') await cutoff('return', '2027-08-25T18:00:00-05:00');
    await world(at);
    const outbound = variant === 'reference' ? 150000 : 116000;
    const sent = await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'aeroplan', points:outbound});
    await deliver(waypoint, waypointInfra, danielBridge);
    equal('Aeroplan credit for the outbound: ' + (variant === 'reference' ? '150,000' : '116,000 × 1.3 = 150,800'),
      [sent.points, (await skyline.call('skyline.balance', {})).balance], variant === 'reference' ? [150000, 150000] : [150800, 150800]);
    const [a1] = (await skyline.call('skyline.search', OUT)).options;
    equal('OPT-A1: UA 1735 + UA 837, 2 seats, 75,000 + USD 28.50 + USD 11.20 per passenger',
      [ids([a1]), a1.seats_left, a1.per_passenger], [['UA1735-2027-10-15+UA837-2027-10-15'], 2, {points:75000, partner_fee_cents:2850, taxes_cents:1120}]);
    ok('Default seating would split the couple on every OPT-A1 segment', a1.segments.every(seg => !isPair(seg.flight_id, seg.free_seats.slice(0, 2))));
    const out = await write(skyline, skylineInfra, 'skyline.book', {option_id:a1.option_id, passenger_ids:PAX, payment_label:RESERVE, seats:pairSeats(a1)});
    ok('Outbound ticketed with adjacent seats on both segments', seatedTogether((await skyline.call('skyline.trips', {id:out.id})).trip));
    equal('No business award space on 2027-10-16', (await skyline.call('skyline.search', {...OUT, date:'2027-10-16'})).options.length, 0);

    await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'hyatt', points:147000});
    await deliver(waypoint, waypointInfra, danielBridge);
    equal('Hyatt after the transfer: 188,200', (await hyatt()).balance, 188200);
    ok('The transfer counts as Hyatt activity', (await hyatt()).expires_at > '2029-08-01');
    const arrival = (await harbor.call('harbor.search', {city:'Tokyo', check_in:'2027-10-16', check_out:'2027-10-17'})).hotels;
    equal('Arrival night: the certificate fits only Hyatt Regency Tokyo Bay',
      arrival.filter(h => h.eligible_certificate_ids.includes('cert-fn-2027')).map(h => h.hotel_id), ['hotel-hr-tokyo-bay']);
    const book = (hotel_id, check_in, check_out, payment) => write(harbor, harborInfra, 'harbor.book', {hotel_id, check_in, check_out, payment});
    await book('hotel-hr-tokyo-bay', '2027-10-16', '2027-10-17', {method:'certificate', certificate_id:'cert-fn-2027'});
    equal('Hyatt Regency Tokyo, 3 nights: 63,000', (await book('hotel-hr-tokyo', '2027-10-17', '2027-10-20', {method:'points'})).points, 63000);
    equal('Hyatt Regency Kyoto, 5 nights at Category 6: 125,000', (await book('hotel-hr-kyoto', '2027-10-20', '2027-10-25', {method:'points'})).points, 125000);
    equal('After the hotels: Hyatt 200 and UR ' + (variant === 'reference' ? '6,500' : '40,500'),
      [(await hyatt()).balance, (await waypoint.call('waypoint.balance', {})).balance], [200, variant === 'reference' ? 6500 : 40500]);

    // The world moves on.
    if (variant === 'reference') await cutoff('return', '2027-08-25T18:00:00-05:00');
    await cutoff('outbound', '2027-09-02T09:00:00-05:00');
    await world('2027-09-12T10:30:00-05:00');
    equal('Every program is sold out both ways after 2027-09-02 09:00',
      [(await skyline.call('skyline.search', RETURN)).options.length, (await skyline.call('skyline.search', OUT)).options.length,
        (await united.call('skyline.search', OUT)).options.length, (await virgin.call('skyline.search', {origin:'ORD', dest:'HND', date:'2027-10-15', cabin:'business', pax:1})).options.length],
      [0, 0, 0, 0]);
    equal('Kyoto moves to Category 7 from 2027-10-01; the booked stay keeps Category 6',
      [outcome('category-hr-kyoto-2027-10', 'harbor-daniel').status,
        (await harbor.call('harbor.reservations', {})).items.find(r => r.hotel_id === 'hotel-hr-kyoto').category_locked], ['committed', 6]);
    const changed = (await skyline.call('skyline.trips', {id:back.id})).trip;
    equal('The 2027-09-11 schedule change breaks the SFO connection and offers ALT-1 until 2027-09-18 23:59',
      [changed.change.status, changed.change.reason, changed.change.deadline], ['open', 'illegal_connection', '2027-09-18T23:59:00-05:00']);

    // Session 2, 2027-09-12 10:30: accept ALT-1.
    const accepted = await write(skyline, skylineInfra, 'skyline.manage', {booking_id:back.id, action:'accept_alternative', alternative_id:'ALT-1'});
    const fixed = (await skyline.call('skyline.trips', {id:back.id})).trip;
    equal('ALT-1 replaces UA 2210 with UA 2386 at no cost', [fixed.segments, accepted.reassigned], [['UA838-2027-10-25', 'UA2386-2027-10-25'], []]);
    ok('The pair stays adjacent on every return segment after ALT-1', seatedTogether(fixed));

    await world('2027-10-03T11:00:00-05:00');
    equal('Hyatt is not forfeited at 2027-09-30', [outcome('expire-hyatt-2027-09-30', 'harbor-daniel').status, (await hyatt()).balance], ['not_due', 200]);
    equal('Cash for flights: $277.20, all on the Reserve',
      (await skyline.call('skyline.balance', {})).charges.map(c => [c.label, c.amount_cents]), [[RESERVE, 19780], [RESERVE, 7940]]);
    equal('No stranded transferred points: Aeroplan ' + (variant === 'reference' ? '0' : '800') + ', Hyatt 200',
      [(await skyline.call('skyline.balance', {})).balance, (await hyatt()).balance], [variant === 'reference' ? 0 : 800, 200]);
    // Every world event applied: committed, except the ones whose refusal is the expected outcome.
    // The Hyatt forfeiture is not due after the transfer, and United's copy of the schedule-change expiry
    // finds no affected booking there (Skyline returns not_found for a change that affected none).
    const expected = e => e.event.event_id === 'expire-hyatt-2027-09-30' ? 'not_due'
      : e.account_id === 'skyline-united-daniel' && e.event.operation === 'skyline.alternative.expired' ? 'not_found' : 'committed';
    equal('Every world event has its expected outcome', timeline.events.map(e => [e.account_id, e.event.event_id, e.done?.status]),
      timeline.events.map(e => [e.account_id, e.event.event_id, expected(e)]));
    return {variant, checks:checks.length};
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    fs.rmSync(state, {recursive:true, force:true});
  }
}

(async () => {
  const results = [];
  for (const variant of ['reference', 'bonus']) results.push(await run(variant));
  console.log(JSON.stringify({passed:true, results}, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
