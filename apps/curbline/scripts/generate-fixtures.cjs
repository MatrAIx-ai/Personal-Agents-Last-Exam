'use strict';
// Deterministic synthetic fixture generator. Same seed, same bytes. `--check` fails on drift.
// Metro Ashford (fictional): 8 zones, 39 places, 2 airports with 5 terminals, travel times for
// 8x8 zone pairs x 3 bands, supply by zone, band and option. Accounts: Maya's minimal fixture and three
// packs: (a) a two-traveller household, (b) an adult child booking wheelchair-accessible rides for a
// parent with shares to a sibling, (c) a parent's child-seat school rides.
const fs = require('node:fs'), path = require('node:path');
const {render, instantOf, parts, ms} = require('../src/time.cjs');
const {fareFor, band} = require('../src/fare.cjs');
const {FEES, POLICY, BAND_NAMES} = require('../src/catalog.cjs');
const {tools} = require('./build-contracts.cjs');
const root = path.resolve(__dirname, '..');
const SEED = 20261203;
const TZ = 'America/New_York', MIN = 60e3, DAY = 1440 * MIN;
const NOW = '2026-12-03T19:00:00-05:00';
const HISTORY_FLOOR = '2025-01-01T00:00:00-05:00';

function prng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// ---- world ----
const ZONES = [
  ['z-harbor', 'Harborview', 0, 0], ['z-midtown', 'Midtown', 3, 4], ['z-elm', 'Elm Park', -6, 5], ['z-riverside', 'Riverside', 7, -3],
  ['z-westfield', 'Westfield', -10, -4], ['z-oakridge', 'Oak Ridge', 5, 10], ['z-ngi', 'Northgate International Airport', 0, 19.6],
  ['z-bfa', 'Bayfield Airport', 14, -12]];
const term = (id, zone, code, airport, t) => ({place_id: id, name: `${airport} Terminal ${t}`, kind: 'airport_terminal', zone_id: zone,
  time_zone: TZ, airport_code: code, airport_name: airport, terminal: t, address: null});
const spot = (id, name, kind, zone, address = null) => ({place_id: id, name, kind, zone_id: zone, time_zone: TZ, airport_code: null,
  airport_name: null, terminal: null, address});
const PLACES = [
  term('pl-ngi-term-1', 'z-ngi', 'NGI', 'Northgate International (NGI)', '1'), term('pl-ngi-term-2', 'z-ngi', 'NGI', 'Northgate International (NGI)', '2'),
  term('pl-ngi-term-4', 'z-ngi', 'NGI', 'Northgate International (NGI)', '4'), term('pl-bfa-term-a', 'z-bfa', 'BFA', 'Bayfield Airport (BFA)', 'A'),
  term('pl-bfa-term-b', 'z-bfa', 'BFA', 'Bayfield Airport (BFA)', 'B'),
  spot('pl-harborview-hotel', 'Harborview Hotel', 'hotel', 'z-harbor', '2 Pier Plaza'), spot('pl-grand-midtown', 'Grand Midtown Hotel', 'hotel', 'z-midtown', '80 Commerce St'),
  spot('pl-riverside-inn', 'Riverside Inn', 'hotel', 'z-riverside', '15 Mill Lane'), spot('pl-ngi-airport-hotel', 'Northgate Airport Hotel', 'hotel', 'z-ngi', '1 Runway Rd'),
  spot('pl-bayfield-suites', 'Bayfield Suites', 'hotel', 'z-bfa', '40 Gull Way'), spot('pl-elm-park-lodge', 'Elm Park Lodge', 'hotel', 'z-elm', '7 Grove St'),
  spot('pl-ashford-general', 'Ashford General Hospital', 'venue', 'z-oakridge', '500 Ridge Ave'), spot('pl-oakridge-rehab', 'Oak Ridge Rehabilitation Center', 'venue', 'z-oakridge', '12 Cedar Path'),
  spot('pl-oakridge-clinic', 'Oak Ridge Eye Clinic', 'venue', 'z-oakridge', '88 Ridge Ave'), spot('pl-civic-center', 'Ashford Civic Center', 'venue', 'z-harbor', '1 Civic Sq'),
  spot('pl-ashford-station', 'Ashford Central Station', 'venue', 'z-midtown', '10 Station Rd'), spot('pl-lakeview-elementary', 'Lakeview Elementary School', 'venue', 'z-elm', '3 School Ln'),
  spot('pl-westfield-middle', 'Westfield Middle School', 'venue', 'z-westfield', '60 West Ave'), spot('pl-riverside-arena', 'Riverside Arena', 'venue', 'z-riverside', '200 Arena Dr'),
  spot('pl-harbor-market', 'Harbor Market Hall', 'venue', 'z-harbor', '9 Quay St'), spot('pl-midtown-office-park', 'Midtown Office Park', 'venue', 'z-midtown', '300 Commerce St'),
  spot('pl-westfield-mall', 'Westfield Mall', 'venue', 'z-westfield', '1 Mall Blvd'), spot('pl-westfield-pool', 'Westfield Aquatic Center', 'venue', 'z-westfield', '25 Pool Rd'),
  spot('pl-ashford-university', 'Ashford University', 'venue', 'z-oakridge', '1 College Way'),
  spot('pl-maya-home', '14 Linden Court', 'address', 'z-elm', '14 Linden Court, Elm Park'), spot('pl-maya-office', 'Midtown Tower', 'address', 'z-midtown', '200 Commerce St, Floor 18'),
  spot('pl-jon-office', 'Riverside Works', 'address', 'z-riverside', '41 Mill Lane'), spot('pl-lena-home', '27 Orchard Row', 'address', 'z-westfield', '27 Orchard Row, Westfield'),
  spot('pl-ruth-home', 'Maple House', 'address', 'z-oakridge', '9 Birch Rd, Oak Ridge'), spot('pl-dan-home', '5 Ferry St', 'address', 'z-riverside', '5 Ferry St, Riverside'),
  spot('pl-priya-home', '62 Willow Bend', 'address', 'z-elm', '62 Willow Bend, Elm Park'), spot('pl-omar-home', '18 Clock Tower Sq', 'address', 'z-midtown', '18 Clock Tower Sq, Midtown'),
  spot('pl-quay-31', '31 Quay St', 'address', 'z-harbor', '31 Quay St, Harborview'), spot('pl-ridge-140', '140 Ridge Ave', 'address', 'z-oakridge', '140 Ridge Ave, Oak Ridge'),
  spot('pl-gull-7', '7 Gull Way', 'address', 'z-bfa', '7 Gull Way, Bayfield'), spot('pl-west-ave-12', '12 West Ave', 'address', 'z-westfield', '12 West Ave, Westfield'),
  spot('pl-grove-44', '44 Grove St', 'address', 'z-elm', '44 Grove St, Elm Park'), spot('pl-mill-90', '90 Mill Lane', 'address', 'z-riverside', '90 Mill Lane, Riverside'),
  spot('pl-pine-hollow', 'Pine Hollow Lodge', 'hotel', null, 'Route 9, Pine Hollow')];

function world() {
  const zones = ZONES.map(([zone_id, name]) => ({zone_id, name, time_zone: TZ}));
  const travel = [];
  for (const [a, , ax, ay] of ZONES) for (const [b, , bx, by] of ZONES) {
    const km = a === b ? 3 : Math.round(Math.hypot(ax - bx, ay - by) * 1.25 * 2) / 2;
    const at = speed => Math.max(4, Math.round(km * 60 / speed));
    travel.push({from_zone: a, to_zone: b, km, minutes: {night: at(43.2), offpeak: at(32), peak: at(22)}});
  }
  const supply = [];
  for (const [z] of ZONES) {
    const airport = z === 'z-ngi' || z === 'z-bfa';
    supply.push({zone_id: z, option: 'standard', night: airport ? 8 : 4, offpeak: 12, peak: 10},
      {zone_id: z, option: 'comfort', night: 2, offpeak: 4, peak: 4}, {zone_id: z, option: 'xl', night: 1, offpeak: 3, peak: 3},
      {zone_id: z, option: 'wheelchair_accessible', night: 1, offpeak: 1, peak: 1});
  }
  return {zones, places: structuredClone(PLACES), travel, supply, market: []};
}
const flight = (carrier, number, localDate, arrival, place) => ({carrier, number, local_date: localDate, scheduled_arrival: arrival,
  estimated_arrival: arrival, arrival_place_id: place, status: 'scheduled', landed_at: null, source_ref: null, history: []});

const DRIVERS = ['Ines', 'Marco', 'Aisha', 'Tomas', 'Grace', 'Wei', 'Olu', 'Sofia', 'Ravi', 'Hana', 'Diego', 'Nadia', 'Ken', 'Lucia', 'Femi',
  'Yara', 'Sam', 'Petra', 'Arjun', 'Mei', 'Jonas', 'Leila', 'Owen', 'Rosa', 'Tariq'];
const MODELS = ['Hybrid sedan', 'Compact SUV', 'Electric hatchback', 'Sedan', 'Minivan'];
const COLORS = ['grey', 'white', 'black', 'blue', 'silver', 'red'];
const drivers = DRIVERS.map((first_name, i) => ({driver: {driver_id: 'dr-' + (i + 1), first_name},
  vehicle: {vehicle_id: 'vh-' + (i + 1), make_model: i % 6 === 5 ? 'Wheelchair van' : MODELS[i % 5], color: COLORS[(i * 7) % 6], plate: 'ASH ' + (4400 + i * 17)}}));

// ---- history ----
const R = (data, from, to) => {
  const pickup = data.places.find(p => p.place_id === from), dropoff = data.places.find(p => p.place_id === to);
  return {pickup, dropoff, travel: data.travel.find(t => t.from_zone === pickup.zone_id && t.to_zone === dropoff.zone_id)};
};
const local = t => render(t, TZ);

// One past or upcoming booking with its ledger, built the way Curbline itself records them.
function makeBooking(data, n, spec, rand) {
  const r = R(data, spec.from, spec.to), pickup = spec.pickup;
  const fare = fareFor(data, r, spec.option, pickup), id = 'bk-' + n, created = pickup - spec.lead_min * MIN;
  const crew = spec.option === 'wheelchair_accessible' ? drivers.filter(d => d.vehicle.make_model === 'Wheelchair van') : drivers.filter(d => d.vehicle.make_model !== 'Wheelchair van');
  const d = pick(rand, crew);
  const b = {booking_id: id, created_at: local(created), status: 'scheduled', attention: null, pickup_place_id: spec.from, dropoff_place_id: spec.to,
    pickup_at: local(pickup), anchor_pickup_at: local(pickup), option: spec.option, passengers: spec.passengers, bags: spec.bags,
    child_seats: spec.child_seats || 0, rider_person_id: spec.rider, notes: spec.notes || null, payment_method_id: spec.method,
    expense: {profile: spec.profile, memo: spec.memo || null},
    fare: {fare_cents: fare.fare_cents, breakdown: fare.breakdown, distance_km: fare.km, minutes: fare.minutes, band: fare.band,
      fare_version: fare.fare_version, market_revision: 0, quoted_at: local(created - 2 * MIN)},
    flight: spec.flight || null, flight_tracking: !!spec.flight, pickup_buffer_min: spec.flight ? POLICY.default_buffer_min : null,
    external_trip_ref: null, driver: null, vehicle: null, eta: null, arrived_at: null, pickup_point: null, started_at: null, completed_at: null,
    trip: null, wait_fee_cents: 0, overlaps_with: [], revision: 1,
    history: [{at: local(created), actor: 'agent', action: 'created', from: null, to: 'scheduled', details: {}, event_id: null}]};
  const ledger = [], le = (type, kind, amount, status, at, updated = at) =>
    ledger.push({entry_id: `le-${id}-${ledger.length + 1}`, booking_id: id, type, kind, amount_cents: amount, status, payment_method_id: spec.method,
      created_at: local(at), updated_at: local(updated), case_id: null});
  const step = (at, action, to, details = {}) => { b.history.push({at: local(at), actor: action === 'cancelled' ? 'agent' : 'infra', action, from: b.status, to, details, event_id: null}); b.status = to; b.revision++; };
  le('hold', 'fare', fare.fare_cents, 'authorized', created);
  const hold = ledger[0], outcome = spec.outcome;
  if (outcome === 'upcoming') return {b, ledger};
  if (outcome === 'cancel_free' || outcome === 'cancel_fee') {
    const at = outcome === 'cancel_free' ? pickup - (90 + Math.floor(rand() * 600)) * MIN : pickup - (10 + Math.floor(rand() * 45)) * MIN;
    hold.status = 'released'; hold.updated_at = local(at);
    if (outcome === 'cancel_fee') le('charge', 'cancellation_fee', FEES.cancellation_cents, 'charged', at);
    step(at, 'cancelled', 'cancelled', {reason: spec.cancel_reason || 'Plans changed', fee_cents: outcome === 'cancel_fee' ? FEES.cancellation_cents : 0});
    return {b, ledger};
  }
  const assigned = pickup - (12 + Math.floor(rand() * 20)) * MIN, arrived = pickup + (Math.floor(rand() * 7) - 3) * MIN;
  Object.assign(b, {driver: d.driver, vehicle: d.vehicle, eta: local(arrived)});
  step(assigned, 'driver_assigned', 'driver_assigned');
  b.arrived_at = local(arrived); b.pickup_point = r.pickup.kind === 'airport_terminal' ? r.pickup.name + ', rideshare zone' : r.pickup.name;
  step(arrived, 'driver_arrived', 'driver_arrived');
  const freeEnd = Math.max(arrived, pickup) + POLICY.free_wait_min * MIN;
  if (outcome === 'no_show') {
    const at = freeEnd + (5 + Math.floor(rand() * 6)) * MIN, wait = Math.floor((at - freeEnd) / MIN) * FEES.wait_per_min_cents;
    hold.status = 'released'; hold.updated_at = local(at);
    le('charge', 'no_show_fee', FEES.no_show_cents, 'charged', at); le('charge', 'wait_fee', wait, 'charged', at);
    b.wait_fee_cents = wait;
    step(at, 'rider_no_show', 'rider_no_show', {at: local(at), wait_fee_cents: wait});
    return {b, ledger};
  }
  const started = outcome === 'late' ? freeEnd + (3 + Math.floor(rand() * 9)) * MIN : arrived + (1 + Math.floor(rand() * 3)) * MIN;
  const wait = Math.max(0, Math.floor((started - freeEnd) / MIN)) * FEES.wait_per_min_cents;
  b.started_at = local(started); b.wait_fee_cents = wait;
  step(started, 'trip_started', 'on_trip');
  const duration = Math.max(4, Math.round(fare.minutes * (0.9 + rand() * 0.25))), done = started + duration * MIN;
  const tolls = spec.tolls ? 350 : 0;
  b.completed_at = local(done);
  b.trip = {distance_km: Math.round(fare.km * (0.97 + rand() * 0.08) * 10) / 10, duration_min: duration, tolls_cents: tolls};
  hold.status = 'captured'; hold.updated_at = local(done);
  if (wait) le('charge', 'wait_fee', wait, 'charged', done);
  if (tolls) le('charge', 'toll', tolls, 'charged', done);
  step(done, 'trip_completed', 'completed');
  if (spec.tip) { le('charge', 'tip', spec.tip, 'charged', done + 50 * MIN); b.history.push({at: local(done + 50 * MIN), actor: 'agent', action: 'tipped', from: null, to: null, details: {amount_cents: spec.tip, entry_id: ledger[ledger.length - 1].entry_id}, event_id: null}); }
  return {b, ledger};
}

// Random rides along an account's usual routes between two dates.
function history(data, rand, routes, count, from, to) {
  const specs = [], start = ms(from), span = ms(to) - start;
  for (let i = 0; i < count; i++) {
    const total = routes.reduce((s, r) => s + r.weight, 0);
    let x = rand() * total, route = routes[0];
    for (const r of routes) { if ((x -= r.weight) < 0) { route = r; break; } }
    const day = parts(start + Math.floor(rand() * span / DAY) * DAY, TZ).date;
    const [h, m] = route.time.split(':').map(Number), minute = h * 60 + m + (Math.floor(rand() * 7) - 3) * 15;
    const pickup = instantOf(day, `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(((minute % 60) + 60) % 60).padStart(2, '0')}`, TZ);
    const roll = rand();
    const outcome = roll < 0.05 ? 'cancel_free' : roll < 0.08 ? 'cancel_fee' : roll < 0.095 ? 'no_show' : roll < 0.16 ? 'late' : 'completed';
    specs.push({...route, pickup, lead_min: 60 + Math.floor(rand() * 2880), outcome, tolls: route.tolls && rand() < 0.5,
      tip: outcome === 'completed' && rand() < 0.3 ? 200 + Math.floor(rand() * 7) * 100 : 0});
  }
  return specs;
}

function assemble(data, specs, rand) {
  const ordered = [...specs].sort((a, b) => (a.pickup - a.lead_min * MIN) - (b.pickup - b.lead_min * MIN));
  data.bookings = []; data.ledger = [];
  ordered.forEach((spec, i) => { const {b, ledger} = makeBooking(data, i + 1, spec, rand); data.bookings.push(b); data.ledger.push(...ledger); });
  return data;
}

// A past fare review resolved with a refund that has settled.
function fareReview(data, bookingId, cents, note) {
  const b = data.bookings.find(x => x.booking_id === bookingId), done = ms(b.completed_at);
  const caseId = 'cs-' + bookingId + '-1', entryId = `le-${bookingId}-${data.ledger.filter(e => e.booking_id === bookingId).length + 1}`;
  data.support_cases.push({case_id: caseId, booking_id: bookingId, reason: 'fare_review', note, status: 'resolved_adjusted',
    created_at: local(done + 3 * 60 * MIN), resolved_at: local(done + 2 * DAY), adjustment_cents: -cents, resolution_note: 'Route was longer than needed.', refund_entry_id: entryId});
  data.ledger.push({entry_id: entryId, booking_id: bookingId, type: 'refund', kind: 'adjustment', amount_cents: cents, status: 'refunded',
    payment_method_id: b.payment_method_id, created_at: local(done + 2 * DAY), updated_at: local(done + 5 * DAY), case_id: caseId});
}

const base = (account, owner, methods) => ({account_id: account, owner_person_id: owner, settings: {time_zone: TZ, auto_shift_max_min: POLICY.default_auto_shift_max_min},
  ...world(), flights: [], payment_methods: methods, bookings: [], ledger: [], shares: [], support_cases: [], notifications: [], ignored_events: []});
const card = (id, brand, last4, label, profile, declines = false) => ({payment_method_id: id, brand, last4, label, profile, declines});
const binding = (account, owner, people) => ({people: people.map(([person_id, name]) => ({person_id, name})),
  accounts: [{app_id: 'curbline', account_id: account, owner_person_id: owner},
    ...people.filter(p => p[2]).map(([person_id]) => ({app_id: 'mail', account_id: 'mail-' + person_id.replace('person-', ''), owner_person_id: person_id}))],
  objects: {}});

// ---- accounts ----
const MAYA_METHODS = [card('pm-personal', 'Visa', '4242', 'Personal Visa', 'personal'), card('pm-work', 'Amex', '1005', 'Work card', 'business'),
  card('pm-old', 'Mastercard', '0002', 'Old Mastercard', 'personal', true)];
const MAYA_PEOPLE = [['person-maya', 'Maya Chen', true], ['person-jon', 'Jon Okafor', false], ['person-ava', 'Ava Chen', false]];

function minimal() {
  const rand = prng(SEED), data = base('curbline-maya', 'person-maya', MAYA_METHODS);
  const at = (date, hhmm) => instantOf(date, hhmm, TZ);
  const ride = (from, to, pickup, outcome, extra = {}) => ({from, to, pickup, outcome, option: 'standard', passengers: 1, bags: 0, rider: 'person-maya',
    method: 'pm-personal', profile: 'personal', lead_min: 600, ...extra});
  assemble(data, [
    ride('pl-maya-home', 'pl-maya-office', at('2026-11-02', '08:15'), 'completed'),
    ride('pl-maya-office', 'pl-maya-home', at('2026-11-02', '18:30'), 'late', {tip: 300}),
    ride('pl-maya-home', 'pl-ngi-term-2', at('2026-11-09', '05:45'), 'completed', {method: 'pm-work', profile: 'business', bags: 1, memo: 'Client visit, Northbay', tolls: true}),
    ride('pl-ngi-term-2', 'pl-maya-home', at('2026-11-12', '21:40'), 'completed', {method: 'pm-work', profile: 'business', bags: 1, memo: 'Client visit, Northbay'}),
    ride('pl-maya-home', 'pl-civic-center', at('2026-11-20', '19:00'), 'cancel_fee', {passengers: 2, rider: 'person-maya'}),
    ride('pl-maya-home', 'pl-riverside-arena', at('2026-11-28', '18:00'), 'cancel_free', {passengers: 2})
  ], rand);
  fareReview(data, 'bk-4', 300, 'The driver took a long detour on the way home.');
  data.flights = [flight('PA', '218', '2026-12-03', '2026-12-03T22:55:00-05:00', 'pl-ngi-term-4'),
    flight('NB', '442', '2026-12-05', '2026-12-05T14:10:00-05:00', 'pl-bfa-term-a')];
  return data;
}

function household() {
  const rand = prng(SEED + 1), data = base('curbline-maya', 'person-maya', MAYA_METHODS);
  const r = (from, to, time, weight, extra = {}) => ({from, to, time, weight, option: 'standard', passengers: 1, bags: 0, rider: 'person-maya', method: 'pm-personal', profile: 'personal', ...extra});
  const work = {method: 'pm-work', profile: 'business', memo: 'Client travel'};
  const specs = history(data, rand, [
    r('pl-maya-home', 'pl-maya-office', '08:15', 6), r('pl-maya-office', 'pl-maya-home', '18:30', 6),
    r('pl-maya-home', 'pl-ngi-term-2', '06:00', 2, {...work, bags: 1, tolls: true}), r('pl-ngi-term-4', 'pl-maya-home', '21:30', 2, {...work, bags: 2}),
    r('pl-maya-home', 'pl-bfa-term-a', '07:00', 1, {bags: 2, passengers: 2, tolls: true}), r('pl-jon-office', 'pl-maya-home', '19:15', 3, {rider: 'person-jon'}),
    r('pl-maya-home', 'pl-harbor-market', '19:30', 2, {passengers: 2, option: 'comfort'}), r('pl-harbor-market', 'pl-maya-home', '23:10', 2, {passengers: 2, option: 'comfort'}),
    r('pl-maya-home', 'pl-ashford-station', '07:20', 1, {bags: 1})], 112, '2025-06-02T00:00:00-04:00', '2026-11-30T00:00:00-05:00');
  const at = (date, hhmm) => instantOf(date, hhmm, TZ);
  // Upcoming: Jon to BFA tomorrow morning; Maya's pickup from flight NB442 on Dec 5.
  specs.push({...r('pl-maya-home', 'pl-bfa-term-b', '07:30', 0, {rider: 'person-jon', bags: 2}), pickup: at('2026-12-04', '07:30'), lead_min: 1400, outcome: 'upcoming'});
  specs.push({...r('pl-bfa-term-a', 'pl-maya-home', '14:30', 0, {...work, bags: 1}), pickup: at('2026-12-05', '14:30'), lead_min: 3000, outcome: 'upcoming',
    flight: {carrier: 'NB', number: '442', local_date: '2026-12-05'}});
  assemble(data, specs, rand);
  const done = data.bookings.filter(b => b.status === 'completed' && b.rider_person_id === 'person-maya');
  fareReview(data, done[Math.floor(done.length / 2)].booking_id, 450, 'Charged for a longer route than the one driven.');
  data.flights = [flight('NB', '442', '2026-12-05', '2026-12-05T14:10:00-05:00', 'pl-bfa-term-a')];
  const jon = data.bookings.find(b => b.pickup_at.startsWith('2026-12-04')), maya = data.bookings.find(b => b.pickup_at.startsWith('2026-12-05'));
  const events = [
    {event_id: 'ev-hh-1', at: '2026-12-04T07:12:00-05:00', operation: 'dispatch.driver_assigned', payload: {selector: {rider_person_id: 'person-jon', pickup_from: '2026-12-04T07:00:00-05:00', pickup_to: '2026-12-04T08:00:00-05:00'},
      driver: drivers[1].driver, vehicle: drivers[1].vehicle, eta: '2026-12-04T07:29:00-05:00'}},
    {event_id: 'ev-hh-2', at: '2026-12-04T07:29:00-05:00', operation: 'dispatch.driver_arrived', payload: {booking_id: jon.booking_id, arrived_at: '2026-12-04T07:29:00-05:00', pickup_point: '14 Linden Court'}},
    {event_id: 'ev-hh-3', at: '2026-12-04T07:33:00-05:00', operation: 'trip.started', payload: {booking_id: jon.booking_id, started_at: '2026-12-04T07:33:00-05:00'}},
    {event_id: 'ev-hh-4', at: '2026-12-04T08:31:00-05:00', operation: 'trip.completed', payload: {booking_id: jon.booking_id, started_at: '2026-12-04T07:33:00-05:00',
      completed_at: '2026-12-04T08:31:00-05:00', distance_km: jon.fare.distance_km, duration_min: 58, tolls_cents: 350}},
    {event_id: 'ev-hh-5', at: '2026-12-05T09:00:00-05:00', operation: 'flight.status_changed', payload: {flight: {carrier: 'NB', number: '442', local_date: '2026-12-05'},
      status: 'delayed', scheduled_arrival: '2026-12-05T14:10:00-05:00', estimated_arrival: '2026-12-05T15:25:00-05:00', arrival_place_id: 'pl-bfa-term-a'}},
    {event_id: 'ev-hh-6', at: '2026-12-05T15:18:00-05:00', operation: 'flight.status_changed', payload: {flight: {carrier: 'NB', number: '442', local_date: '2026-12-05'},
      status: 'landed', scheduled_arrival: '2026-12-05T14:10:00-05:00', estimated_arrival: '2026-12-05T15:18:00-05:00', arrival_place_id: 'pl-bfa-term-a', landed_at: '2026-12-05T15:18:00-05:00'}},
    {event_id: 'ev-hh-7', at: '2026-12-05T15:20:00-05:00', operation: 'dispatch.driver_assigned', payload: {selector: {flight: {carrier: 'NB', number: '442', local_date: '2026-12-05'}},
      driver: drivers[0].driver, vehicle: drivers[0].vehicle, eta: '2026-12-05T15:44:00-05:00'}},
    {event_id: 'ev-hh-8', at: '2026-12-05T15:44:00-05:00', operation: 'dispatch.driver_arrived', payload: {booking_id: maya.booking_id, arrived_at: '2026-12-05T15:44:00-05:00', pickup_point: 'BFA Terminal A, door 3'}},
    {event_id: 'ev-hh-9', at: '2026-12-05T16:25:00-05:00', operation: 'trip.started', payload: {booking_id: maya.booking_id, started_at: '2026-12-05T16:25:00-05:00'}},
    {event_id: 'ev-hh-10', at: '2026-12-05T17:20:00-05:00', operation: 'trip.completed', payload: {booking_id: maya.booking_id, started_at: '2026-12-05T16:25:00-05:00',
      completed_at: '2026-12-05T17:20:00-05:00', distance_km: maya.fare.distance_km, duration_min: 55, tolls_cents: 0}}];
  return {data, binding: binding('curbline-maya', 'person-maya', [['person-maya', 'Maya Chen', true], ['person-jon', 'Jon Okafor', true], ['person-ava', 'Ava Chen', false]]), events,
    expect: {[jon.booking_id]: 'completed', [maya.booking_id]: 'completed'}};
}

function care() {
  const rand = prng(SEED + 2), data = base('curbline-lena', 'person-lena', [card('pm-lena', 'Visa', '7781', 'Lena Visa', 'personal')]);
  const r = (from, to, time, weight, extra = {}) => ({from, to, time, weight, option: 'wheelchair_accessible', passengers: 2, bags: 1, rider: 'person-ruth',
    method: 'pm-lena', profile: 'personal', notes: 'Ruth uses a folding wheelchair; please help with the ramp.', ...extra});
  const specs = history(data, rand, [r('pl-ruth-home', 'pl-oakridge-rehab', '09:30', 5), r('pl-oakridge-rehab', 'pl-ruth-home', '12:00', 5),
    r('pl-ruth-home', 'pl-oakridge-clinic', '10:30', 2), r('pl-oakridge-clinic', 'pl-ruth-home', '12:30', 2),
    r('pl-lena-home', 'pl-ashford-general', '17:00', 1, {option: 'standard', passengers: 1, bags: 0, rider: 'person-lena', notes: null})], 39, '2026-01-12T00:00:00-05:00', '2026-11-30T00:00:00-05:00');
  const at = (date, hhmm) => instantOf(date, hhmm, TZ);
  specs.push({...r('pl-ashford-general', 'pl-ruth-home', '11:00', 0, {notes: 'Discharge from ward 4; Ruth uses a wheelchair.'}), pickup: at('2026-12-05', '11:00'), lead_min: 3000, outcome: 'upcoming'});
  assemble(data, specs, rand);
  const up = data.bookings[data.bookings.length - 1];
  data.shares.push({share_id: `sh-${up.booking_id}-1`, booking_id: up.booking_id, person_id: 'person-dan', scope: 'status',
    until: '2026-12-05T18:00:00-05:00', status: 'active', created_at: local(ms(up.created_at) + 5 * MIN), ended_at: null});
  const events = [
    {event_id: 'ev-care-1', at: '2026-12-05T10:40:00-05:00', operation: 'dispatch.driver_assigned', payload: {booking_id: up.booking_id, driver: drivers[5].driver, vehicle: drivers[5].vehicle, eta: '2026-12-05T10:58:00-05:00'}},
    {event_id: 'ev-care-2', at: '2026-12-05T10:50:00-05:00', operation: 'dispatch.eta_updated', payload: {booking_id: up.booking_id, eta: '2026-12-05T11:02:00-05:00'}},
    {event_id: 'ev-care-3', at: '2026-12-05T11:02:00-05:00', operation: 'dispatch.driver_arrived', payload: {booking_id: up.booking_id, arrived_at: '2026-12-05T11:02:00-05:00', pickup_point: 'Ashford General, main entrance'}},
    {event_id: 'ev-care-4', at: '2026-12-05T11:20:00-05:00', operation: 'trip.started', payload: {booking_id: up.booking_id, started_at: '2026-12-05T11:20:00-05:00'}},
    {event_id: 'ev-care-5', at: '2026-12-05T11:31:00-05:00', operation: 'trip.completed', payload: {booking_id: up.booking_id, started_at: '2026-12-05T11:20:00-05:00',
      completed_at: '2026-12-05T11:31:00-05:00', distance_km: up.fare.distance_km, duration_min: 11, tolls_cents: 0}}];
  return {data, binding: binding('curbline-lena', 'person-lena', [['person-lena', 'Lena Park', true], ['person-ruth', 'Ruth Park', true], ['person-dan', 'Dan Park', true], ['person-mia', 'Mia Lowe', false]]),
    events, expect: {[up.booking_id]: 'completed'}};
}

function school() {
  const rand = prng(SEED + 3), data = base('curbline-priya', 'person-priya', [card('pm-priya', 'Visa', '3310', 'Family Visa', 'personal')]);
  const r = (from, to, time, weight, extra = {}) => ({from, to, time, weight, option: 'standard', passengers: 3, bags: 2, child_seats: 2, rider: 'person-priya',
    method: 'pm-priya', profile: 'personal', notes: 'Two booster seats, please.', ...extra});
  const specs = history(data, rand, [r('pl-priya-home', 'pl-lakeview-elementary', '07:45', 6), r('pl-lakeview-elementary', 'pl-priya-home', '15:15', 3),
    r('pl-priya-home', 'pl-westfield-pool', '16:30', 2, {option: 'xl', passengers: 3})], 29, '2026-01-05T00:00:00-05:00', '2026-11-30T00:00:00-05:00');
  const at = (date, hhmm) => instantOf(date, hhmm, TZ);
  specs.push({...r('pl-priya-home', 'pl-lakeview-elementary', '07:45', 0), pickup: at('2026-12-04', '07:45'), lead_min: 1000, outcome: 'upcoming'});
  assemble(data, specs, rand);
  const up = data.bookings[data.bookings.length - 1];
  const events = [
    {event_id: 'ev-sc-1', at: '2026-12-04T07:20:00-05:00', operation: 'dispatch.driver_assigned', payload: {booking_id: up.booking_id, driver: drivers[3].driver, vehicle: drivers[3].vehicle, eta: '2026-12-04T07:44:00-05:00'}},
    {event_id: 'ev-sc-2', at: '2026-12-04T07:31:00-05:00', operation: 'dispatch.driver_cancelled', payload: {booking_id: up.booking_id, reason: 'vehicle_issue', reassign: true}},
    {event_id: 'ev-sc-3', at: '2026-12-04T07:33:00-05:00', operation: 'dispatch.driver_assigned', payload: {booking_id: up.booking_id, driver: drivers[8].driver, vehicle: drivers[8].vehicle, eta: '2026-12-04T07:49:00-05:00'}},
    {event_id: 'ev-sc-4', at: '2026-12-04T07:49:00-05:00', operation: 'dispatch.driver_arrived', payload: {booking_id: up.booking_id, arrived_at: '2026-12-04T07:49:00-05:00'}},
    {event_id: 'ev-sc-5', at: '2026-12-04T07:51:00-05:00', operation: 'trip.started', payload: {booking_id: up.booking_id, started_at: '2026-12-04T07:51:00-05:00'}},
    {event_id: 'ev-sc-6', at: '2026-12-04T08:00:00-05:00', operation: 'trip.completed', payload: {booking_id: up.booking_id, started_at: '2026-12-04T07:51:00-05:00',
      completed_at: '2026-12-04T08:00:00-05:00', distance_km: up.fare.distance_km, duration_min: 9, tolls_cents: 0}}];
  return {data, binding: binding('curbline-priya', 'person-priya', [['person-priya', 'Priya Nair', true], ['person-omar', 'Omar Nair', true]]), events,
    expect: {[up.booking_id]: 'completed'}};
}

// ---- quality checks (run on every build) ----
function check(data) {
  const fail = m => { throw new Error('Fixture check failed: ' + m); };
  for (const t of data.travel) {
    const back = data.travel.find(x => x.from_zone === t.to_zone && x.to_zone === t.from_zone);
    for (const b of BAND_NAMES) if (Math.abs(back.minutes[b] - t.minutes[b]) > t.minutes[b] * 0.1) fail('travel times are not symmetric');
  }
  for (const b of data.bookings) {
    for (const v of [b.pickup_at, b.created_at, ...b.history.map(h => h.at)]) if (render(ms(v), TZ) !== v) fail('local date or offset is wrong for ' + v);
    if (ms(b.created_at) < ms(HISTORY_FLOOR)) fail('history before 2025-01-01');
    if (b.fare.band !== band(ms(b.pickup_at), TZ)) fail('fare band does not match pickup time');
    const entries = data.ledger.filter(e => e.booking_id === b.booking_id);
    for (const e of entries) {
      if (['cancellation_fee', 'no_show_fee'].includes(e.kind) && e.amount_cents !== FEES.cancellation_cents) fail('fee does not match policy');
      if (e.kind === 'wait_fee' && (e.amount_cents % FEES.wait_per_min_cents || e.amount_cents !== b.wait_fee_cents)) fail('wait fee does not match policy');
    }
    if (b.status === 'completed') {
      const sum = entries.filter(e => (e.type === 'hold' && e.status === 'captured') || (e.type === 'charge' && e.kind !== 'tip')).reduce((s, e) => s + e.amount_cents, 0);
      if (sum !== b.fare.fare_cents + b.wait_fee_cents + b.trip.tolls_cents) fail('receipt does not sum to ledger for ' + b.booking_id);
    }
  }
  const size = Buffer.byteLength(JSON.stringify(data));
  if (size > 300 * 1024) fail('account seed is ' + size + ' bytes');
  return size;
}

function policies() {
  const allow = tools.map(t => t.name);
  return {scenario: {allow, constraints: {}}, sandbox: {allow, constraints: {}}};
}

function dataset(records) {
  return {schema_version: 'pale.dataset.v1', dataset_id: 'curbline-minimal', version: '1.0.0',
    description: 'Synthetic ride, airport-pickup and ledger fixture for package validation; not an evaluation task.',
    record_source_ids: ['curbline-generator'],
    sources: [{source_id: 'curbline-generator', kind: 'synthetic',
      description: 'Metro Ashford places, zones, travel times, supply, flights, drivers, vehicles, payment methods and ride histories written by the seeded generator. All people, places, drivers, plates, flights and prices are fictional; no real ride, fare or location data is collected.',
      uri: null, license: 'MIT', usage: 'permitted', collection: null,
      generation: {method: 'seeded procedural generation', tool: 'apps/curbline/scripts/generate-fixtures.cjs', tool_version: '1.0.0', seed: SEED, parameters: {prng: 'mulberry32'}}}],
    transformations: ['All times are RFC 3339 with UTC offsets in the place\'s IANA time zone; money is integer cents in USD.'],
    expected_counts: {records, assets: 0},
    quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
    review: {status: 'pending', reviewer: null, notes: 'Automatic checks do not replace human review of realism, wording and provenance.'}};
}

// Large account seeds keep one record per line: close to compact JSON in size, still readable in a diff.
function lines(value) {
  const parts = Object.entries(value).map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + (Array.isArray(v) && v.length
    ? '[\n' + v.map(x => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]' : JSON.stringify(v)));
  return '{\n' + parts.join(',\n') + '\n}\n';
}

function build({check: checking = false} = {}) {
  const sizes = {}, outputs = {};
  const m = minimal();
  sizes.minimal = check(m);
  outputs['fixtures/minimal.json'] = m;
  outputs['fixtures/binding.json'] = binding('curbline-maya', 'person-maya', MAYA_PEOPLE);
  outputs['fixtures/clock.json'] = {initial_time: NOW};
  outputs['fixtures/policies.json'] = policies();
  outputs['contribution/dataset.json'] = dataset(require('../src/model.cjs').records(m).length);
  for (const [name, make] of Object.entries({household, care, school})) {
    const pack = make();
    sizes[name] = check(pack.data);
    outputs[`examples/packs/${name}/seed.json`] = pack.data;
    outputs[`examples/packs/${name}/binding.json`] = pack.binding;
    outputs[`examples/packs/${name}/events.json`] = {virtual_now: NOW, events: pack.events, expect: pack.expect};
  }
  for (const [file, value] of Object.entries(outputs)) {
    const expected = file.endsWith('/seed.json') ? lines(value) : JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (checking) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) throw new Error('Generated fixture drift: ' + file); }
    else { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, expected); }
  }
  return {sizes, bookings: Object.fromEntries(['minimal', 'household', 'care', 'school'].map(k => [k, k === 'minimal' ? m.bookings.length :
    outputs[`examples/packs/${k}/seed.json`].bookings.length]))};
}

module.exports = {build, NOW, world};
if (require.main === module) console.log(JSON.stringify(build({check: process.argv.includes('--check')})));
