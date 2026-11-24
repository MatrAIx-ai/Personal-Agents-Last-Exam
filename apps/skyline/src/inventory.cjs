'use strict';
// Award inventory: itineraries, connections, option IDs, prices and seat maps.
const crypto = require('node:crypto');
const c = require('./common.cjs');

const MAX_PAX = 9, CABINS = ['business', 'economy'];
const airport = (data, code) => data.airports.find(a => a.code === code);
const flight = (data, id) => c.find(data.flights, id, 'Flight');

const freeSeats = cabin => { const taken = new Set(cabin.taken); return cabin.seats.filter(s => !taken.has(s)); };
const freePairs = cabin => { const free = new Set(freeSeats(cabin)); return cabin.adjacent_pairs.filter(([a, b]) => free.has(a) && free.has(b)); };
const isPair = (cabin, a, b) => cabin.adjacent_pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
function take(cabin, seat) {
  if (!cabin.seats.includes(seat) || cabin.taken.includes(seat)) c.fail('seat_unavailable', 'Seat ' + seat + ' is not free in this cabin.');
  cabin.taken.push(seat);
}
const release = (cabin, seat) => { cabin.taken = cabin.taken.filter(s => s !== seat); };
// Saver seats are a subset of the free seats; protected passengers can use the last free seats.
const clampSaver = cabin => { cabin.saver_seats = Math.min(cabin.saver_seats, freeSeats(cabin).length); };

// Connections between consecutive flights: same airport, min ≤ minutes ≤ max (both inclusive).
function connections(data, flights) {
  const {min_connection_minutes:min, max_connection_minutes:max} = data.rules;
  return flights.slice(1).map((next, i) => {
    const prev = flights[i], m = c.minutes(prev.arrives_at, next.departs_at);
    return {airport:prev.dest, minutes:m, legal:prev.dest === next.origin && m >= min && m <= max};
  });
}
const legal = (data, flights) => connections(data, flights).every(x => x.legal);

// A row naming an operating carrier prices any itinerary with a segment that carrier operates (first such row in chart
// order); otherwise the row for the endpoints and cabin without a carrier applies.
function chartRow(data, path, cabin) {
  const rows = data.award_chart.filter(r => r.origin === path[0].origin && r.dest === path.at(-1).dest && r.cabin === cabin);
  return rows.find(r => r.operating_carrier && path.some(f => f.operating_carrier === r.operating_carrier)) || rows.find(r => !r.operating_carrier);
}
const optionId = (flightIds, cabin, pax, revision) =>
  'opt-' + crypto.createHash('sha256').update(JSON.stringify([flightIds, cabin, pax, revision])).digest('hex').slice(0, 16);

// Every bookable itinerary at `now`: a nonstop or a one-stop with a legal connection, first flight
// not yet departed, the cabin on every segment with at least pax saver seats, and a chart price
// for its endpoints (a connection is priced by its endpoints and, where the chart says so, its operating carrier).
function itineraries(data, now, cabin, pax) {
  const open = f => f.cabins[cabin] && f.cabins[cabin].saver_seats >= pax;
  const paths = [];
  for (const f of data.flights) {
    if (!open(f) || c.ms(f.departs_at) <= c.ms(now)) continue;
    paths.push([f]);
    for (const g of data.flights) if (g !== f && g.origin === f.dest && g.dest !== f.origin && open(g) && legal(data, [f, g])) paths.push([f, g]);
  }
  return paths.filter(p => chartRow(data, p, cabin));
}

function segmentView(f, cabin) {
  const m = f.cabins[cabin];
  return {flight_id:f.id, flight_number:f.flight_number, operating_carrier:f.operating_carrier, origin:f.origin, dest:f.dest,
    departs_at:f.departs_at, arrives_at:f.arrives_at, cabin, saver_seats:m.saver_seats, free_seats:freeSeats(m),
    adjacent_pairs:c.copy(freePairs(m))};
}

function option(data, path, cabin, pax) {
  const row = chartRow(data, path, cabin);
  const each = {points:row.points, partner_fee_cents:row.partner_fee_cents, taxes_cents:row.taxes_cents};
  return {option_id:optionId(path.map(f => f.id), cabin, pax, data.inventory_revision), cabin, pax,
    origin:path[0].origin, dest:path.at(-1).dest, segments:path.map(f => segmentView(f, cabin)),
    connections:connections(data, path).map(({airport, minutes}) => ({airport, minutes})),
    seats_left:Math.min(...path.map(f => f.cabins[cabin].saver_seats)), per_passenger:each,
    total:{points:each.points * pax, partner_fee_cents:each.partner_fee_cents * pax, taxes_cents:each.taxes_cents * pax}, currency:'USD'};
}

function search(data, now, args) {
  for (const code of [args.origin, args.dest]) if (!airport(data, code)) c.fail('not_found', 'Airport ' + code + ' is not served.');
  if (args.origin === args.dest) c.fail('invalid_arguments', 'Origin and destination must differ.');
  const zone = airport(data, args.origin).timezone;
  return itineraries(data, now, args.cabin, args.pax)
    .filter(p => p[0].origin === args.origin && p.at(-1).dest === args.dest && c.localDate(zone, p[0].departs_at) === args.date)
    .map(p => option(data, p, args.cabin, args.pax))
    .sort((a, b) => c.ms(a.segments[0].departs_at) - c.ms(b.segments[0].departs_at) ||
      c.ms(a.segments.at(-1).arrives_at) - c.ms(b.segments.at(-1).arrives_at) || a.option_id.localeCompare(b.option_id));
}

// The option an ID names, if it is reproducible now (same itinerary, cabin, pax and inventory revision).
function reproduce(data, now, id) {
  for (const cabin of CABINS) for (let pax = 1; pax <= MAX_PAX; pax++) {
    for (const path of itineraries(data, now, cabin, pax)) {
      if (optionId(path.map(f => f.id), cabin, pax, data.inventory_revision) === id) return {path, cabin, pax, option:option(data, path, cabin, pax)};
    }
  }
  return null;
}

module.exports = {airport, flight, freeSeats, freePairs, isPair, take, release, clampSaver, connections, legal, chartRow,
  optionId, itineraries, segmentView, option, search, reproduce};
