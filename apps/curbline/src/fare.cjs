'use strict';
// Fares, travel times, supply and quote/change tokens. Tokens are checked by recomputation, not signed:
// re-deriving one at the same market revision only reproduces the price a new quote would give.
const {fail, MIN, place: getPlace, flight: getFlight, flightLabel, plus} = require('./common.cjs');
const {ms, parts, minutes: hhmmMinutes, instantOf, addDays} = require('./time.cjs');
const {OPTIONS, OPTION_ORDER, FEES, POLICY, BANDS, FARE_VERSION} = require('./catalog.cjs');

// The time band of an instant in a zone.
function band(instant, zone) {
  const p = parts(ms(instant), zone), now = p.hour * 60 + p.minute;
  for (const b of BANDS) {
    const s = hhmmMinutes(b.start), e = hhmmMinutes(b.end);
    if (s < e ? now >= s && now < e : now >= s || now < e) return b.band;
  }
  return 'offpeak';
}

const market = (data, zoneId) => data.market.find(m => m.zone_id === zoneId) || {zone_id: zoneId, multiplier: 1, revision: 0, supply: {}};

// Vehicles of an option in a zone and band, after any market override.
function supply(data, zoneId, bandName, option) {
  const override = market(data, zoneId).supply?.[option]?.[bandName];
  if (typeof override === 'number') return override;
  const row = data.supply.find(s => s.zone_id === zoneId && s.option === option);
  return row ? row[bandName] : 0;
}

function travel(data, fromZone, toZone) {
  return data.travel.find(t => t.from_zone === fromZone && t.to_zone === toZone) || null;
}

// The pickup and drop-off places of a request, checked for the service area.
function route(data, request) {
  const pickup = getPlace(data, request.pickup_place_id), dropoff = getPlace(data, request.dropoff_place_id);
  if (!pickup.zone_id || !dropoff.zone_id) fail('outside_service_area', 'Curbline does not serve ' + (!pickup.zone_id ? pickup.name : dropoff.name) + '.');
  const t = travel(data, pickup.zone_id, dropoff.zone_id);
  if (!t) fail('outside_service_area', 'No service between these zones.');
  return {pickup, dropoff, travel: t};
}

// Does an option carry these riders? Counts that no option can carry are invalid_passengers.
function checkCounts(request) {
  const {passengers, bags, child_seats: seats = 0} = request;
  const most = Math.max(...Object.values(OPTIONS).map(o => o.seats));
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > most) fail('invalid_passengers', 'Passengers must be between 1 and ' + most + '.');
  if (seats > Math.min(POLICY.max_child_seats, passengers)) fail('invalid_passengers', 'At most two child seats, and no more than the passengers.');
  if (bags < 0) fail('invalid_passengers', 'Bags cannot be negative.');
}
const fits = (option, request) => {
  const o = OPTIONS[option], seats = request.child_seats || 0;
  return request.passengers <= o.seats && request.bags <= o.bags && (seats === 0 || o.child_seats);
};

function fareFor(data, r, option, pickupAt) {
  const zone = r.pickup.time_zone, bandName = band(pickupAt, zone), o = OPTIONS[option];
  const km = r.travel.km, min = r.travel.minutes[bandName], m = market(data, r.pickup.zone_id);
  const base = o.base_cents, distance = Math.round(km * o.per_km_cents), time = min * o.per_min_cents;
  const subtotal = base + distance + time, scaled = Math.round(subtotal * m.multiplier);
  const airport = r.pickup.kind === 'airport_terminal' || r.dropoff.kind === 'airport_terminal' ? FEES.airport_cents : 0;
  return {fare_cents: scaled + FEES.booking_cents + airport, km, minutes: min, band: bandName, fare_version: FARE_VERSION,
    market_revision: m.revision,
    breakdown: {base_cents: base, distance_cents: distance, time_cents: time, multiplier: m.multiplier, surge_cents: scaled - subtotal,
      booking_fee_cents: FEES.booking_cents, airport_fee_cents: airport}};
}

const available = (data, r, option, pickupAt) => supply(data, r.pickup.zone_id, band(pickupAt, r.pickup.time_zone), option) > 0;

// Up to two other fitting options at the requested time (cheapest first), then the requested option
// at the first later band start within 24 hours where it is available.
function alternatives(data, r, request) {
  const out = [], pickupAt = ms(request.pickup_at);
  const others = OPTION_ORDER.filter(o => o !== request.option && fits(o, request) && available(data, r, o, pickupAt))
    .map(o => ({option: o, pickup_at: pickupAt, fare_cents: fareFor(data, r, o, pickupAt).fare_cents}))
    .sort((a, b) => a.fare_cents - b.fare_cents).slice(0, 2);
  out.push(...others);
  if (fits(request.option, request)) {
    const zone = r.pickup.time_zone, date = parts(pickupAt, zone).date;
    const starts = [0, 1].flatMap(d => BANDS.map(b => instantOf(addDays(date, d), b.start, zone)))
      .filter(t => t > pickupAt && t <= pickupAt + 24 * 60 * MIN).sort((a, b) => a - b);
    const later = starts.find(t => available(data, r, request.option, t));
    if (later !== undefined) out.push({option: request.option, pickup_at: later, fare_cents: fareFor(data, r, request.option, later).fare_cents});
  }
  return out;
}

function checkLead(ctx, pickupAt) {
  const now = ms(ctx.virtual_now), t = ms(pickupAt);
  if (t < now + POLICY.min_lead_min * MIN) fail('pickup_too_soon', 'Pickups must be at least 30 minutes ahead.');
  if (t > now + POLICY.max_lead_days * 1440 * MIN) fail('pickup_too_far', 'Pickups can be booked at most 30 days ahead.');
}

// A flight is checked against its latest known status: its current arrival place must be the pickup.
function checkFlight(data, key, pickup, pickupAt) {
  if (!key) return [];
  const f = getFlight(data, key), warnings = [];
  if (f.arrival_place_id !== pickup.place_id) {
    const now = data.places.find(p => p.place_id === f.arrival_place_id);
    fail('invalid_flight', 'Flight ' + flightLabel(f) + ' now arrives at ' + f.arrival_place_id + (now ? ' (' + now.name + ')' : '') +
      ', not at the pickup place ' + pickup.place_id + '.');
  }
  if (f.status === 'cancelled') warnings.push('flight_cancelled');
  if (f.estimated_arrival && ms(pickupAt) < ms(f.estimated_arrival)) warnings.push('pickup_before_estimated_arrival');
  return warnings;
}

// Price a full ride request. Returns availability and alternatives rather than failing on supply.
function price(ctx, data, request, {checkTime = true} = {}) {
  checkCounts(request);
  const r = route(data, request);
  if (checkTime) checkLead(ctx, request.pickup_at);
  const warnings = checkFlight(data, request.flight || null, r.pickup, request.pickup_at);
  const fare = fareFor(data, r, request.option, ms(request.pickup_at));
  const ok = fits(request.option, request) && available(data, r, request.option, ms(request.pickup_at));
  return {route: r, fare, available: ok, warnings, alternatives: ok ? [] : alternatives(data, r, request)};
}

// ---- tokens ----
const encode = (prefix, value) => prefix + Buffer.from(JSON.stringify(value)).toString('base64url');
function decode(prefix, token, code) {
  if (typeof token !== 'string' || !token.startsWith(prefix)) fail(code, 'The token is not a Curbline token.');
  try { return JSON.parse(Buffer.from(token.slice(prefix.length), 'base64url').toString('utf8')); } catch { return fail(code, 'The token cannot be read.'); }
}
const REQUEST_KEYS = ['pickup_place_id', 'dropoff_place_id', 'pickup_at', 'option', 'passengers', 'bags', 'child_seats', 'flight', 'pickup_buffer_min'];
function normalRequest(args) {
  const out = {};
  for (const k of REQUEST_KEYS) out[k] = args[k] === undefined ? null : args[k];
  out.child_seats = out.child_seats || 0;
  out.pickup_at = new Date(ms(out.pickup_at)).toISOString();
  if (out.flight && out.pickup_buffer_min === null) out.pickup_buffer_min = POLICY.default_buffer_min;
  return out;
}
const quoteToken = (request, fare, quotedAt) => encode('q1.', {request, market_revision: fare.market_revision, quoted_at: quotedAt, fare_cents: fare.fare_cents});
function readQuote(token) {
  const q = decode('q1.', token, 'invalid_quote');
  if (!q || typeof q !== 'object' || !q.request || typeof q.request !== 'object' || !Number.isInteger(q.fare_cents) ||
      !Number.isInteger(q.market_revision) || !Number.isFinite(Date.parse(q.quoted_at)) ||
      Object.keys(q.request).sort().join() !== [...REQUEST_KEYS].sort().join()) fail('invalid_quote', 'The quote token is malformed.');
  return q;
}
const changeToken = (bookingId, revision, changes, fare, quotedAt) =>
  encode('c1.', {booking_id: bookingId, booking_revision: revision, changes, market_revision: fare.market_revision, quoted_at: quotedAt, fare_cents: fare.fare_cents});
function readChange(token) {
  const c = decode('c1.', token, 'invalid_change_token');
  if (!c || typeof c !== 'object' || typeof c.booking_id !== 'string' || !Number.isInteger(c.booking_revision) || !c.changes ||
      typeof c.changes !== 'object' || !Number.isInteger(c.fare_cents) || !Number.isInteger(c.market_revision) ||
      !Number.isFinite(Date.parse(c.quoted_at))) fail('invalid_change_token', 'The change token is malformed.');
  return c;
}
const expiresAt = (quotedAt, ttl) => plus(quotedAt, ttl);

module.exports = {band, market, supply, travel, route, fits, fareFor, available, alternatives, checkLead, checkFlight, price,
  normalRequest, quoteToken, readQuote, changeToken, readChange, expiresAt, REQUEST_KEYS};
