'use strict';
// App-owned generator: one definition source for the seed schema, event schema and tools.json.
// Run `node scripts/build-contracts.cjs` after editing; `--check` fails on drift (used by the tests).
const fs = require('node:fs'), path = require('node:path');
const C = require('../src/catalog.cjs');
const root = path.resolve(__dirname, '..');
const SEED = 'schemas/seed.schema.json#/$defs/';

const id = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const time = {type: 'string', format: 'date-time'};
const date = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const num = (minimum, maximum) => ({type: 'number', minimum, maximum});
const int = (minimum, maximum) => (maximum === undefined ? {type: 'integer', minimum} : {type: 'integer', minimum, maximum});
const cents = int(0, 10000000);
const bool = {type: 'boolean'};
const nullable = s => ({anyOf: [s, {type: 'null'}]});
const arr = (items, maxItems = 1000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const obj = (properties, required = Object.keys(properties), additional = false) =>
  ({type: 'object', properties, required, additionalProperties: additional});
const ref = name => ({$ref: SEED + name});
const localRef = name => ({$ref: 'seed.schema.json#/$defs/' + name}); // file-relative: Core inlines the seed schema
const enumOf = values => ({enum: values});

const option = enumOf(Object.keys(C.OPTIONS));
const status = enumOf(C.STATUSES);
const bands = obj(Object.fromEntries(C.BAND_NAMES.map(b => [b, int(0, 1000)])), []);

const defs = {
  id, time, date,
  flight_key: obj({carrier: {type: 'string', pattern: '^[A-Z0-9]{2}$'}, number: {type: 'string', pattern: '^[0-9]{1,4}$'}, local_date: date}),
  external_ref: obj({app_id: id, account_id: id, object_id: id}),
  settings: obj({time_zone: text(64), auto_shift_max_min: int(0, 1440)}),
  zone: obj({zone_id: id, name: text(120), time_zone: text(64)}),
  place: obj({place_id: id, name: text(160), kind: enumOf(C.PLACE_KINDS), zone_id: nullable(id), time_zone: text(64),
    airport_code: nullable({type: 'string', pattern: '^[A-Z]{3}$'}), airport_name: nullable(text(120)), terminal: nullable(text(40)),
    address: nullable(text(200))}),
  travel: obj({from_zone: id, to_zone: id, km: num(0, 500), minutes: obj(Object.fromEntries(C.BAND_NAMES.map(b => [b, int(1, 600)])))}),
  supply: obj({zone_id: id, option, night: int(0, 1000), offpeak: int(0, 1000), peak: int(0, 1000)}),
  market: obj({zone_id: id, multiplier: num(0.5, 5), revision: int(0), updated_at: nullable(time),
    supply: obj(Object.fromEntries(Object.keys(C.OPTIONS).map(o => [o, bands])), [])}),
  flight: obj({carrier: {type: 'string', pattern: '^[A-Z0-9]{2}$'}, number: {type: 'string', pattern: '^[0-9]{1,4}$'}, local_date: date,
    scheduled_arrival: time, estimated_arrival: nullable(time), arrival_place_id: id, status: enumOf(C.FLIGHT_STATUSES),
    landed_at: nullable(time), source_ref: nullable(text(200)),
    history: arr(obj({at: time, status: enumOf(C.FLIGHT_STATUSES), estimated_arrival: nullable(time), arrival_place_id: id, event_id: nullable(id)}), 200)}),
  payment_method: obj({payment_method_id: id, brand: text(40), last4: {type: 'string', pattern: '^[0-9]{4}$'}, label: text(80),
    profile: enumOf(C.PROFILES), declines: bool}),
  fare: obj({fare_cents: cents, breakdown: obj({base_cents: cents, distance_cents: cents, time_cents: cents, multiplier: num(0.5, 5),
    surge_cents: int(-10000000, 10000000), booking_fee_cents: cents, airport_fee_cents: cents}),
    distance_km: num(0, 500), minutes: int(0, 600), band: enumOf(C.BAND_NAMES), fare_version: text(60), market_revision: int(0), quoted_at: time}),
  history_entry: obj({at: time, actor: enumOf(['agent', 'infra', 'clock', 'seed']), action: text(60), from: nullable(status), to: nullable(status),
    details: {type: 'object'}, event_id: nullable(id)}),
  driver: obj({driver_id: id, first_name: text(60)}),
  vehicle: obj({vehicle_id: id, make_model: text(80), color: text(40), plate: text(20)}),
  booking: obj({booking_id: {type: 'string', pattern: '^bk-[0-9]{1,6}$'}, created_at: time, status,
    attention: nullable(obj({reason: enumOf(C.ATTENTION_REASONS), proposed_pickup_at: nullable(time), since: time})),
    pickup_place_id: id, dropoff_place_id: id, pickup_at: time, anchor_pickup_at: time, option,
    passengers: int(1, 10), bags: int(0, 10), child_seats: int(0, 2), rider_person_id: id, notes: nullable(text(500)),
    payment_method_id: id, expense: obj({profile: enumOf(C.PROFILES), memo: nullable(text(200))}), fare: localRef('fare'),
    flight: nullable(localRef('flight_key')), flight_tracking: bool, pickup_buffer_min: nullable(int(0, C.POLICY.max_buffer_min)),
    external_trip_ref: nullable(localRef('external_ref')), driver: nullable(localRef('driver')), vehicle: nullable(localRef('vehicle')),
    eta: nullable(time), arrived_at: nullable(time), pickup_point: nullable(text(200)), started_at: nullable(time), completed_at: nullable(time),
    trip: nullable(obj({distance_km: num(0, 1000), duration_min: int(0, 1440), tolls_cents: cents})), wait_fee_cents: cents,
    overlaps_with: arr(id, 100), revision: int(1), history: arr(localRef('history_entry'), 500)}),
  ledger_entry: obj({entry_id: id, booking_id: id, type: enumOf(['hold', 'charge', 'refund']),
    kind: enumOf(['fare', 'wait_fee', 'toll', 'cancellation_fee', 'no_show_fee', 'tip', 'adjustment']), amount_cents: int(1, 10000000),
    status: enumOf(['authorized', 'released', 'captured', 'charged', 'refund_pending', 'refunded']), payment_method_id: id,
    created_at: time, updated_at: time, case_id: nullable(id)}),
  share: obj({share_id: id, booking_id: id, person_id: id, scope: enumOf(C.SHARE_SCOPES), until: time,
    status: enumOf(['active', 'revoked', 'expired']), created_at: time, ended_at: nullable(time)}),
  support_case: obj({case_id: id, booking_id: id, reason: enumOf(C.SUPPORT_REASONS), note: text(1000),
    status: enumOf(['submitted', 'resolved_adjusted', 'resolved_no_change']), created_at: time, resolved_at: nullable(time),
    adjustment_cents: nullable(int(-10000000, 0)), resolution_note: nullable(text(1000)), refund_entry_id: nullable(id)}),
  notification: obj({notification_id: id, booking_id: id, kind: enumOf(Object.keys(C.NOTIFICATION_KINDS)), seq: int(1),
    recipient_person_id: id, recipient_role: enumOf(['booker', 'rider', 'sharee']), share_id: nullable(id), created_at: time,
    title: text(200), body: text(2000), status: enumOf(C.NOTIFICATION_STATUSES),
    outcome: nullable(obj({status: enumOf(['committed', 'rejected', 'unknown', 'halted']), code: nullable(text(80)),
      stop_run: bool, router_event_id: nullable(text(120)), recorded_at: time}))}),
  ignored_event: obj({event_id: id, at: time, operation: text(60), reason: text(60), target: {type: 'object'}})
};

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:curbline:seed:1',
  title: 'Curbline account and world data', ...obj({
    account_id: id, owner_person_id: id, settings: localRef('settings'),
    zones: arr(localRef('zone'), 50), places: arr(localRef('place'), 500), travel: arr(localRef('travel'), 2500),
    supply: arr(localRef('supply'), 500), market: arr(localRef('market'), 50), flights: arr(localRef('flight'), 500),
    payment_methods: arr(localRef('payment_method'), 20), bookings: arr(localRef('booking'), 2000), ledger: arr(localRef('ledger_entry'), 10000),
    shares: arr(localRef('share'), 2000), support_cases: arr(localRef('support_case'), 500), notifications: arr(localRef('notification'), 20000),
    ignored_events: arr(localRef('ignored_event'), 5000)}),
  $defs: defs
};

// ---- events ----
const envelope = (operation, payload) => obj({event_id: id, at: time, operation: {const: operation}, payload});
const flightKey = {$ref: 'seed.schema.json#/$defs/flight_key'};
const selector = {anyOf: [obj({flight: flightKey}), obj({rider_person_id: id, pickup_from: time, pickup_to: time})]};
// Dispatch and trip events name a booking or a selector.
const targeted = (properties, required = []) => ({anyOf: [
  obj({booking_id: id, ...properties}, ['booking_id', ...required]),
  obj({selector, on_multiple: enumOf(['first', 'reject']), ...properties}, ['selector', ...required])]});
const driver = {$ref: 'seed.schema.json#/$defs/driver'}, vehicle = {$ref: 'seed.schema.json#/$defs/vehicle'};
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:curbline:events:1',
  title: 'Infra-applied Curbline events (tasks choose content and timing)',
  anyOf: [
    envelope('dispatch.driver_assigned', targeted({driver, vehicle, eta: time}, ['driver', 'vehicle', 'eta'])),
    envelope('dispatch.eta_updated', targeted({eta: time}, ['eta'])),
    envelope('dispatch.driver_arrived', targeted({arrived_at: time, pickup_point: text(200)}, ['arrived_at'])),
    envelope('dispatch.driver_cancelled', targeted({reason: text(80), reassign: bool}, ['reason', 'reassign'])),
    envelope('trip.started', targeted({started_at: time}, ['started_at'])),
    envelope('trip.completed', targeted({started_at: time, completed_at: time, distance_km: num(0, 1000), duration_min: int(0, 1440), tolls_cents: cents},
      ['completed_at', 'distance_km', 'duration_min', 'tolls_cents'])),
    envelope('trip.rider_no_show', targeted({at: time}, ['at'])),
    envelope('flight.status_changed', obj({flight: flightKey, status: enumOf(C.FLIGHT_STATUSES), scheduled_arrival: time,
      estimated_arrival: nullable(time), arrival_place_id: id, landed_at: time, source_ref: text(200)}, ['flight', 'status', 'scheduled_arrival', 'arrival_place_id'])),
    envelope('market.updated', obj({zone_id: id, multiplier: num(0.5, 5), supply: defs.market.properties.supply}, ['zone_id'])),
    envelope('support.resolved', obj({case_id: id, outcome: enumOf(['resolved_adjusted', 'resolved_no_change']), adjustment_cents: int(-10000000, 0),
      note: text(1000)}, ['case_id', 'outcome'])),
    envelope('payment.refund_settled', obj({ledger_entry_id: id, settled_at: time})),
    envelope('notification.delivery_recorded', obj({notification_id: id, status: enumOf(['committed', 'rejected', 'unknown', 'halted']),
      code: nullable(text(80)), stop_run: bool, router_event_id: nullable(text(120))}, ['notification_id', 'status', 'code', 'router_event_id']))
  ]
};

// ---- tools ----
const version = obj({epoch: int(1), revision: int(0)});
const writeIn = (properties, required = []) => obj({...properties, expected_version: version, request_id: id}, [...required, 'expected_version', 'request_id']);
const readOut = properties => obj({status: {const: 'ok'}, app_id: {const: 'curbline'}, version, ...properties});
const writeOut = properties => obj({status: {const: 'committed'}, app_id: {const: 'curbline'}, version, ...properties});
const loose = (properties, required = Object.keys(properties)) => obj(properties, required, true);
const asOf = {as_of: time};
const rideFields = {pickup_place_id: id, dropoff_place_id: id, pickup_at: time, option, passengers: int(1, 10), bags: int(0, 10),
  child_seats: int(0, 2), flight: ref('flight_key'), pickup_buffer_min: int(0, C.POLICY.max_buffer_min)};
const alternative = loose({option, pickup_at: time, fare_cents: cents});
const priced = {available: bool, code: nullable(enumOf(['no_vehicle_for_requirements'])), pickup_at: time, option, fare_cents: cents,
  breakdown: {type: 'object'}, warnings: arr(text(60), 10), alternatives: arr(alternative, 3), expires_at: nullable(time)};
const tool = (name, description, read_only, inputSchema, outputSchema) =>
  ({name: 'curbline.' + name, description, read_only, scope: 'curbline.' + name, resource_target: 'current account', inputSchema, outputSchema});
const bookingSummary = loose({booking_id: id, status, pickup_place_id: id, dropoff_place_id: id, pickup_at: time, option, rider_person_id: id,
  fare_cents: cents, overlaps_with: arr(id, 100)});
const warnings = {warnings: arr(text(60), 10)};

const tools = [
  tool('places.search', 'Search the run\'s places by name, place ID or airport code, optionally by kind.', true,
    obj({query: text(120, 0), kind: enumOf(C.PLACE_KINDS)}, []), readOut({places: arr(ref('place'), 500)})),
  tool('places.get', 'Get one place with its zone, time zone and airport code.', true, obj({place_id: id}), readOut({place: ref('place')})),
  tool('rides.quote', 'Price a scheduled ride at the run\'s virtual time. Returns the fare breakdown, availability, a quote token valid for 10 virtual minutes, warnings, and up to three alternatives when no vehicle fits. Stores nothing.', true,
    obj(rideFields, ['pickup_place_id', 'dropoff_place_id', 'pickup_at', 'option', 'passengers', 'bags']),
    readOut({...asOf, quote: loose({...priced, distance_km: num(0, 500), duration_min: int(0, 600), band: enumOf(C.BAND_NAMES),
      fare_version: text(60), quote_token: nullable(text(4000))})})),
  tool('payment_methods.list', 'List the account\'s masked payment methods and their profiles (personal or business).', true,
    obj({}, []), readOut({payment_methods: arr(loose({payment_method_id: id, brand: text(40), last4: text(4), label: text(80), profile: enumOf(C.PROFILES)}), 20)})),
  tool('bookings.list', 'List bookings, optionally by status or pickup time range, with overlap flags.', true,
    obj({status, from: time, to: time}, []), readOut({...asOf, bookings: arr(bookingSummary, 2000)})),
  tool('bookings.get', 'One booking with its history, fare, flight, driver and vehicle, and policy times derived at the virtual time (free cancellation, current fee, lapse, free wait, tip and expense windows).', true,
    obj({booking_id: id}), readOut({...asOf, booking: loose({booking_id: id, status, history: arr({type: 'object'}, 500), policy: {type: 'object'}})})),
  tool('bookings.preview_change', 'Price a change to a scheduled or needs_attention booking. Returns the new fare, the difference and a change token bound to the booking\'s revision (10 virtual minutes), or alternatives when no vehicle fits.', true,
    obj({booking_id: id, changes: obj({...rideFields, flight: nullable(ref('flight_key'))}, [])}),
    readOut({...asOf, booking_id: id, ...priced, fare_difference_cents: int(-10000000, 10000000), change_token: nullable(text(4000))})),
  tool('bookings.preview_cancel', 'The fee if the booking were cancelled now, and the free-cancellation time.', true,
    obj({booking_id: id}), readOut({...asOf, booking_id: id, booking_status: status, cancellable: bool, fee_cents: nullable(cents), free_until: nullable(time), reason: text(40)})),
  tool('shares.list', 'Trip shares with their status derived at the virtual time.', true,
    obj({booking_id: id}, []), readOut({...asOf, shares: arr(ref('share'), 2000)})),
  tool('receipts.get', 'Receipt for a booking from the payment ledger: holds, charges, refunds pending versus refunded, and the expense profile.', true,
    obj({booking_id: id}), readOut({...asOf, receipt: loose({booking_id: id, entries: arr(ref('ledger_entry'), 100), charged_cents: cents,
      refund_pending_cents: cents, refunded_cents: cents, net_cents: int(-10000000, 10000000)})})),
  tool('support.list', 'Support cases and their outcomes.', true, obj({booking_id: id}, []), readOut({...asOf, cases: arr(ref('support_case'), 500)})),
  tool('notifications.list', 'Notifications Curbline recorded, per recipient, with their delivery status.', true,
    obj({booking_id: id, status: enumOf(C.NOTIFICATION_STATUSES), recipient_person_id: id}, []), readOut({...asOf, notifications: arr(ref('notification'), 20000)})),
  tool('bookings.create', 'Book a ride from a quote token with a payment method; optionally for another rider from the run binding. Authorizes a hold for the fare. A token may be reused; each use books again and overlaps are flagged.', false,
    writeIn({quote_token: text(4000), payment_method_id: id, rider_person_id: id, notes: text(500), external_trip_ref: ref('external_ref')}, ['quote_token', 'payment_method_id']),
    writeOut({booking_id: id, booking_status: status, pickup_at: time, fare_cents: cents, hold_entry_id: id, overlaps_with: arr(id, 100), ...warnings})),
  tool('bookings.update', 'Apply a previewed change with its change token. Releases the old hold and authorizes a new one.', false,
    writeIn({booking_id: id, change_token: text(4000)}, ['booking_id', 'change_token']),
    writeOut({booking_id: id, booking_status: status, pickup_at: time, fare_cents: cents, hold_entry_id: id, overlaps_with: arr(id, 100), ...warnings})),
  tool('bookings.cancel', 'Cancel a booking under the published fee rules. Releases the hold; any fee is a separate charge.', false,
    writeIn({booking_id: id, reason: text(200)}, ['booking_id', 'reason']), writeOut({booking_id: id, booking_status: status, fee_cents: cents, charge_entry_ids: arr(id, 5)})),
  tool('bookings.set_flight', 'Link a flight (tracked) to a scheduled or needs_attention airport pickup, or unlink it with null.', false,
    writeIn({booking_id: id, flight: nullable(ref('flight_key')), pickup_buffer_min: int(0, C.POLICY.max_buffer_min)}, ['booking_id', 'flight']),
    writeOut({booking_id: id, flight: nullable(ref('flight_key')), flight_tracking: bool, pickup_buffer_min: nullable(int(0, 90)), ...warnings})),
  tool('bookings.confirm_adjustment', 'Accept the proposed pickup time of a booking held for a large flight shift.', false,
    writeIn({booking_id: id}, ['booking_id']), writeOut({booking_id: id, booking_status: status, pickup_at: time})),
  tool('shares.create', 'Share a ride\'s status with a person from the run binding until a time. Scope status omits the vehicle and ETA.', false,
    writeIn({booking_id: id, person_id: id, scope: enumOf(C.SHARE_SCOPES), until: time}, ['booking_id', 'person_id', 'scope', 'until']),
    writeOut({share_id: id, share_status: enumOf(['active']), until: time})),
  tool('shares.revoke', 'Stop an active share.', false, writeIn({share_id: id}, ['share_id']), writeOut({share_id: id, share_status: enumOf(['revoked'])})),
  tool('trips.tip', 'Tip the driver within 72 hours of a completed ride.', false,
    writeIn({booking_id: id, amount_cents: int(1, 10000000)}, ['booking_id', 'amount_cents']), writeOut({booking_id: id, entry_id: id, amount_cents: cents})),
  tool('trips.set_expense', 'Set the expense profile and memo of a completed ride within 30 days.', false,
    writeIn({booking_id: id, profile: enumOf(C.PROFILES), memo: text(200)}, ['booking_id', 'profile']),
    writeOut({booking_id: id, expense: obj({profile: enumOf(C.PROFILES), memo: nullable(text(200))})})),
  tool('support.open', 'Open a support case for a ride: fare_review, wait_fee_review, lost_item or driver_no_show.', false,
    writeIn({booking_id: id, reason: enumOf(C.SUPPORT_REASONS), note: text(1000)}, ['booking_id', 'reason', 'note']),
    writeOut({case_id: id, case_status: enumOf(['submitted'])}))
];

function build({check = false} = {}) {
  const outputs = {'schemas/seed.schema.json': seed, 'schemas/events.schema.json': events, 'tools.json': tools};
  for (const [file, value] of Object.entries(outputs)) {
    const expected = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) throw new Error('Generated contract drift: ' + file); }
    else fs.writeFileSync(target, expected);
  }
  return {tools: tools.length, reads: tools.filter(t => t.read_only).length, writes: tools.filter(t => !t.read_only).length, events: events.anyOf.length};
}
module.exports = {build, tools};
if (require.main === module) console.log(JSON.stringify(build({check: process.argv.includes('--check')})));
