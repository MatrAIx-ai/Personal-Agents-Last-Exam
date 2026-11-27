'use strict';
// Builders for requests and events used by the business tests.
const path = require('node:path');
const {fixture} = require('./harness.cjs');

let seq = 0;
const PA218 = {carrier: 'PA', number: '218', local_date: '2026-12-03'};
const ev = (operation, at, payload) => ({event_id: 'ev-' + (++seq), at, operation, payload});
const target = t => (typeof t === 'string' ? {booking_id: t} : {selector: t});

// Core example 1: NGI Terminal 4 to Harborview Hotel, Dec 3 23:15, flight PA218 with a 20 min buffer.
// Keys set to undefined are dropped, so a test can remove the flight with {flight: undefined}.
const defined = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const airportRide = (extra = {}) => defined({pickup_place_id: 'pl-ngi-term-4', dropoff_place_id: 'pl-harborview-hotel', pickup_at: '2026-12-03T23:15:00-05:00',
  option: 'standard', passengers: 2, bags: 2, flight: PA218, pickup_buffer_min: 20, ...extra});
const bfaRide = (extra = {}) => defined({pickup_place_id: 'pl-bfa-term-b', dropoff_place_id: 'pl-harborview-hotel', pickup_at: '2026-12-04T01:00:00-05:00',
  option: 'standard', passengers: 2, bags: 2, flight: PA218, pickup_buffer_min: 20, ...extra});

function book(f, request, create = {}) {
  const q = f.call('curbline.rides.quote', request).quote;
  if (!q.available) throw new Error('not available: ' + JSON.stringify(q.alternatives));
  return f.call('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work', ...create});
}

const flightStatus = (at, status, estimated, place = 'pl-ngi-term-4', extra = {}) => ev('flight.status_changed', at,
  {flight: PA218, status, scheduled_arrival: '2026-12-03T22:55:00-05:00', estimated_arrival: estimated, arrival_place_id: place, ...extra});
const DRIVER = {driver: {driver_id: 'dr-14', first_name: 'Ines'}, vehicle: {vehicle_id: 'vh-14', make_model: 'Hybrid sedan', color: 'grey', plate: 'ASH 4417'}};
const assign = (at, t, eta, extra = {}) => ev('dispatch.driver_assigned', at, {...target(t), ...DRIVER, eta, ...extra});
const arrive = (at, t, arrivedAt = at) => ev('dispatch.driver_arrived', at, {...target(t), arrived_at: arrivedAt, pickup_point: 'NGI Terminal 4, door 6'});
const start = (at, t) => ev('trip.started', at, {...target(t), started_at: at});
const complete = (at, t, startedAt, extra = {}) => ev('trip.completed', at, {...target(t), started_at: startedAt, completed_at: at, distance_km: 24.5, duration_min: 34, tolls_cents: 0, ...extra});
const noShow = (at, t) => ev('trip.rider_no_show', at, {...target(t), at});
const driverCancelled = (at, t, reassign) => ev('dispatch.driver_cancelled', at, {...target(t), reason: 'vehicle_issue', reassign});
const market = (at, zone, payload) => ev('market.updated', at, {zone_id: zone, ...payload});
const delivery = (at, id, status, code = null, extra = {}) => ev('notification.delivery_recorded', at,
  {notification_id: id, status, code, router_event_id: status === 'committed' ? 'router-abc' : null, ...extra});

// A pack loaded at its own clock and binding.
function pack(name) {
  const dir = path.resolve(__dirname, '../examples/packs', name);
  const script = require(path.join(dir, 'events.json'));
  return {f: fixture({seed: require(path.join(dir, 'seed.json')), binding: require(path.join(dir, 'binding.json')), now: script.virtual_now}), script};
}

module.exports = {PA218, ev, airportRide, bfaRide, book, flightStatus, assign, arrive, start, complete, noShow, driverCancelled, market, delivery, pack, DRIVER};
