'use strict';
// App-owned generator: one definition source for the seed schema, event schema and tools.json.
// `node scripts/build-contracts.cjs` writes them; `--check` fails on drift (used by the tests).
const fs = require('node:fs'), path = require('node:path');
const {PATHWAY_MODES, EFFECTS, CAUSES, PROGRAMS} = require('../src/catalog.cjs');
const root = path.resolve(__dirname, '..');

const id = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:~-]{0,149}$'};
const time = {type: 'string', format: 'date-time'};
const date = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const monthP = {type: 'string', pattern: '^\\d{4}-\\d{2}$'};
const hhmm = {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'};
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const int = (minimum, maximum) => ({type: 'integer', minimum, maximum});
const cents = {type: 'integer', minimum: -10000000, maximum: 10000000};
const bool = {type: 'boolean'};
const nullable = s => ({anyOf: [s, {type: 'null'}]});
const arr = (items, maxItems = 5000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const obj = (properties, required = Object.keys(properties), additional = false) => ({type: 'object', properties, required, additionalProperties: additional});
const enumOf = values => ({enum: values});
// File-relative refs: Core inlines the seed schema into env.load_seed, so root-local refs would break.
const def = name => ({$ref: 'seed.schema.json#/$defs/' + name});
const ref = name => ({$ref: 'schemas/seed.schema.json#/$defs/' + name});
const mode = enumOf(['rail', 'bus']);
const delivery = enumOf(['mail', 'in_app']);
const weekWindow = obj({days: arr(int(1, 7), 7, {minItems: 1}), start: hhmm, end: hhmm});
const quiet = nullable(obj({start: hhmm, end: hhmm}));
// Tool inputs: nested fields are optional in the schema (forms can leave an optional object empty);
// the handlers check that a given window, quiet period or rule is complete.
const windowIn = obj({days: arr(int(1, 7), 7), start: hhmm, end: hhmm}, []);
const quietIn = nullable(obj({start: hhmm, end: hhmm}, []));
const freq = arr(obj({start: hhmm, end: hhmm, headway_min: int(1, 240)}), 10);

const defs = {
  external_ref: obj({app_id: id, account_id: id, object_id: id}),
  stop: obj({stop_id: id, name: text(120), kind: enumOf(['station', 'stop']), step_free: bool, external_ref: nullable(def('external_ref'))}),
  node: obj({node_id: id, stop_id: id, kind: enumOf(['entrance', 'platform', 'bus_bay', 'stop']), name: text(160)}),
  pathway: obj({pathway_id: id, from: id, to: id, mode: enumOf(PATHWAY_MODES), seconds: int(1, 3600), length_m: int(0, 5000), bidirectional: bool, facility_id: nullable(id)}),
  facility_status: obj({seq: int(1, 100000), status: enumOf(['out_of_service', 'in_service']), since: time, expected_return: nullable(time), note: nullable(text(300)), recorded_at: time}),
  facility: obj({facility_id: id, code: text(20), kind: enumOf(['elevator', 'escalator', 'ramp']), stop_id: id, name: text(160), pathway_ids: arr(id, 10),
    history: arr(def('facility_status'), 1000)}),
  route: obj({route_id: id, short_name: {type: 'string', pattern: '^[A-Za-z0-9]{1,12}$'}, name: text(80), mode}),
  pattern: obj({pattern_id: id, route_id: id, direction: enumOf(['nb', 'sb']), headsign: text(120), stops: arr(obj({node_id: id, offset_min: int(0, 600)}), 100, {minItems: 2}),
    frequencies: obj({weekday: freq, saturday: freq, sunday: freq})}),
  access: obj({node_id: id, seconds: int(0, 3600), length_m: int(0, 5000), step_free: bool}),
  place: obj({place_id: id, name: text(120), kind: enumOf(['address', 'landmark']), access: arr(def('access'), 10, {minItems: 1})}),
  alert_version: obj({version: int(1, 10000), msg_type: enumOf(['alert', 'update', 'cancel']), cause: enumOf(CAUSES), effect: enumOf(EFFECTS),
    informed: obj({route_ids: arr(id, 50), stop_ids: arr(id, 200), facility_ids: arr(id, 100)}), replacement_stop_id: nullable(id),
    active_periods: arr(obj({start: time, end: nullable(time)}), 20, {minItems: 1}), header: text(200), description: nullable(text(2000)), issued_at: time}),
  alert: obj({alert_id: id, versions: arr(def('alert_version'), 1000, {minItems: 1})}),
  trip_update: obj({trip_id: id, seq: int(1, 10000), at: time, delay_min: int(-60, 600), cancelled: bool, skipped_stop_ids: arr(id, 100)}),
  payment_method: obj({payment_method_id: id, label: text(80), last4: {type: 'string', pattern: '^\\d{4}$'}, fails: bool}),
  autoreload: obj({threshold_cents: int(0, 10000), amount_cents: int(500, 50000), payment_method_id: id}),
  card: obj({card_id: id, holder_name: text(120), label: text(80), status: enumOf(['active', 'blocked']), balance_cents: cents, carried_in_cents: cents, carried_out_cents: cents,
    replaces: nullable(id), replaced_by: nullable(id), fee_owed_cents: int(0, 100000), autoreload: nullable(def('autoreload')),
    reduced: nullable(obj({program: enumOf(PROGRAMS), approved_at: time, expires_at: time})), created_at: time, blocked_at: nullable(time)}),
  ledger_entry: obj({entry_id: id, card_id: id, original_card_id: id, kind: enumOf(['load_pending', 'load_settled', 'load_failed', 'fare', 'pass_purchase', 'pass_refund', 'replacement_fee']),
    amount_cents: cents, at: time, settled_at: nullable(time), payment_method_id: nullable(id), source: nullable(enumOf(['manual', 'autoreload'])),
    tap_id: nullable(id), pass_id: nullable(id), note: nullable(text(200))}),
  tap: obj({tap_id: id, card_id: id, at: time, stop_id: id, route_id: id, mode, result: enumOf(['accepted', 'declined']), reason: nullable(enumOf(['card_blocked', 'insufficient_balance'])),
    charged_cents: int(0, 100000), base_cents: nullable(int(0, 100000)), basis: nullable(enumOf(['fare', 'reduced', 'transfer', 'cap', 'pass'])), fare_origin: bool,
    transfer_of: nullable(id), pass_id: nullable(id), entry_id: nullable(id), autoreload_entry_id: nullable(id)}),
  pass: obj({pass_id: id, card_id: id, product: enumOf(['monthly']), month: monthP, price_cents: int(0, 100000), status: enumOf(['purchased', 'cancelled']), purchased_at: time, cancelled_at: nullable(time)}),
  application: obj({application_id: id, card_id: id, program: enumOf(PROGRAMS), status: enumOf(['submitted', 'approved', 'denied']), submitted_at: time, decided_at: nullable(time),
    expires_at: nullable(time), history: arr(obj({at: time, action: text(200)}), 100)}),
  saved: obj({saved_id: id, kind: enumOf(['place', 'commute']), label: text(80), created_at: time, place_ref: id, from_saved_id: id, to_saved_id: id, from_ref: id, to_ref: id,
    window: weekWindow, step_free: bool, max_walk_m: int(0, 5000), max_transfers: int(0, 4), avoid_modes: arr(mode, 2)}, ['saved_id', 'kind', 'label', 'created_at']),
  subscription: obj({subscription_id: id, target: obj({kind: enumOf(['route', 'stop', 'facility', 'commute', 'card']), id}), window: nullable(weekWindow),
    delay_threshold_min: nullable(int(1, 240)), low_balance_cents: nullable(int(0, 100000)), quiet_hours: quiet, urgent_override: bool, delivery,
    status: enumOf(['active', 'paused', 'deleted']), created_at: time, revision: int(1, 100000), history: arr(obj({revision: int(1, 100000), at: time, action: text(200), changes: {type: 'object'}}), 1000)}),
  notification: obj({notification_id: id, subscription_id: id, trigger_key: text(400), source: obj({kind: text(40), id, version: nullable(int(0, 100000))}), urgent: bool,
    created_at: time, release_at: nullable(time), delivery, status: enumOf(['in_app', 'held_quiet_hours', 'pending_delivery', 'delivered', 'delivery_failed', 'withdrawn']),
    title: text(200), body: text(2000), time, recipient_person_id: id,
    outcome: nullable(obj({status: enumOf(['committed', 'rejected', 'unknown', 'halted']), code: nullable(text(80)), stop_run: bool, router_event_id: nullable(text(150)), recorded_at: time})),
    acknowledged_at: nullable(time)}),
  event_record: obj({event_id: id, at: time, operation: text(60), reason: text(200)}),
  redirect: obj({event_id: id, at: time, operation: text(60), from_card_id: id, to_card_id: id})
};

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:hopline:seed:1', title: 'Hopline account and network data',
  ...obj({account_id: id, owner_person_id: id, settings: obj({time_zone: text(64)}), rider: obj({name: text(120), payment_methods: arr(def('payment_method'), 10)}),
    stops: arr(def('stop'), 500), nodes: arr(def('node'), 2000), pathways: arr(def('pathway'), 2000), facilities: arr(def('facility'), 500), routes: arr(def('route'), 100),
    patterns: arr(def('pattern'), 400), places: arr(def('place'), 500), alerts: arr(def('alert'), 1000), trip_updates: arr(def('trip_update'), 5000),
    cards: arr(def('card'), 50), ledger: arr(def('ledger_entry'), 10000), taps: arr(def('tap'), 10000), passes: arr(def('pass'), 200), applications: arr(def('application'), 100),
    saved: arr(def('saved'), 20), subscriptions: arr(def('subscription'), 200), notifications: arr(def('notification'), 20000),
    ignored_events: arr(def('event_record'), 5000), redirects: arr(def('redirect'), 5000)}),
  $defs: defs
};

const envelope = (operation, payload) => obj({event_id: id, at: time, operation: {const: operation}, payload});
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:hopline:events:1',
  title: 'Infra-applied Hopline events (tasks choose content and timing)',
  anyOf: [
    envelope('service.alert_published', obj({alert_id: id, version: int(1, 10000), msg_type: enumOf(['alert', 'update', 'cancel']), cause: enumOf(CAUSES), effect: enumOf(EFFECTS),
      informed: obj({route_ids: arr(id, 50), stop_ids: arr(id, 200), facility_ids: arr(id, 100)}, []), replacement_stop_id: id,
      active_periods: arr(obj({start: time, end: nullable(time)}, ['start']), 20, {minItems: 1}), header: text(200), description: text(2000), issued_at: time,
      references: arr(obj({alert_id: id, version: int(1, 10000)}), 10)}, ['alert_id', 'version', 'msg_type'])),
    envelope('service.trip_updated', obj({trip_id: id, delay_min: int(-60, 600), cancelled: bool, skipped_stop_ids: arr(id, 100)}, ['trip_id'])),
    envelope('facility.status_changed', obj({facility_id: id, stop_id: id, status: enumOf(['out_of_service', 'restored']), status_seq: int(1, 100000), since: time,
      expected_return: time, note: text(300)}, ['facility_id', 'status'])),
    envelope('fare.tap_recorded', obj({tap_id: id, card_id: id, stop_id: id, route_id: id, mode}, ['tap_id', 'card_id', 'stop_id', 'route_id', 'mode'])),
    envelope('fare.eligibility_decided', obj({card_id: id, decision: enumOf(['approved', 'denied']), program: enumOf(PROGRAMS), expires_at: time}, ['card_id', 'decision'])),
    envelope('payment.settled', obj({entry_id: id, card_id: id, settle: {const: 'oldest_pending'}, outcome: enumOf(['settled', 'failed'])}, ['outcome'])),
    envelope('notification.delivery_recorded', obj({notification_id: id, status: enumOf(['committed', 'rejected', 'unknown', 'halted']), code: nullable(text(80)),
      stop_run: bool, router_event_id: nullable(text(150))}, ['notification_id', 'status', 'code', 'router_event_id']))
  ]
};

const version = obj({epoch: int(1), revision: int(0)});
const writeIn = (properties, required = []) => obj({...properties, expected_version: version, request_id: id}, [...required, 'expected_version', 'request_id']);
const readOut = properties => obj({status: {const: 'ok'}, app_id: {const: 'hopline'}, version, as_of: time, ...properties});
const writeOut = properties => obj({status: {const: 'committed'}, app_id: {const: 'hopline'}, version, ...properties});
const any = {type: 'object'};
const tool = (name, description, read_only, inputSchema, outputSchema) =>
  ({name: 'hopline.' + name, description, read_only, scope: 'hopline.' + name, resource_target: 'current account', inputSchema, outputSchema});

const tools = [
  tool('places.search', 'Find places and stops by name.', true, obj({query: text(200, 0)}, []), readOut({places: arr(any, 500), stops: arr(any, 500)})),
  tool('stops.get', 'A stop or station: entrances, platforms, pathways and each facility\'s status at as_of, with active alerts.', true, obj({stop_id: id}), readOut({stop: any})),
  tool('routes.get', 'A route: stop patterns, frequencies per service period, the trip ID rule and active alerts.', true, obj({route_id: id}), readOut({route: any})),
  tool('departures.list', 'Departures at a stop in a window: scheduled time, live estimate, cancelled or skipped, and the trip update behind it.', true,
    obj({stop_id: id, from: time, to: time}), readOut({stop_id: id, departures: arr(any, 2000)})),
  tool('trips.plan', 'Up to three itineraries at the run\'s virtual time, with step-free routing, uses_estimates, blockers, the fare for a card, and the service state used. Each itinerary lists its edges (access links, pathways and rides with IDs and times) in order.', true,
    obj({from: id, to: id, depart_at: time, arrive_by: time, step_free: bool, max_walk_m: int(0, 5000), max_transfers: int(0, 4), avoid_modes: arr(mode, 2, {uniqueItems: true}), card_id: id}, ['from', 'to']),
    readOut({from: id, to: id, itineraries: arr(any, 3), blockers: arr(any, 100), service_state: any})),
  tool('alerts.list', 'Alerts with status derived at the virtual time, optionally for a route, stop, facility or status.', true,
    obj({route_id: id, stop_id: id, facility_id: id, status: enumOf(['upcoming', 'active', 'ended', 'cancelled'])}, []), readOut({alerts: arr(any, 1000)})),
  tool('alerts.get', 'One alert with its version chain, or one version.', true, obj({alert_id: id, version: int(1, 10000)}, ['alert_id']), readOut({alert: any})),
  tool('saved.list', 'Saved places and saved commutes.', true, obj({}, []), readOut({saved: arr(ref('saved'), 20)})),
  tool('subscriptions.list', 'Subscriptions with their revisions.', true, obj({include_deleted: bool}, []), readOut({subscriptions: arr(ref('subscription'), 200)})),
  tool('notifications.list', 'Notifications with delivery status as of the virtual time.', true,
    obj({status: defs.notification.properties.status}, []), readOut({notifications: arr(ref('notification'), 20000)})),
  tool('cards.get', 'Cards with spendable balance, pending loads, passes, reduced-fare status and weekly cap progress at the virtual time.', true, obj({card_id: id}, []), readOut({cards: arr(any, 50)})),
  tool('cards.history', 'Ledger entries and taps for a card in a window.', true, obj({card_id: id, from: time, to: time}), readOut({card_id: id, entries: arr(ref('ledger_entry'), 10000), taps: arr(ref('tap'), 10000)})),
  tool('fares.products', 'Fares, transfer and cap rules, products and reduced-fare programs (catalog version).', true, obj({}, []),
    readOut({catalog_version: text(40), fares: any, products: arr(any, 10), replacement_fee_cents: cents, reduced_fare_programs: arr(enumOf(PROGRAMS), 5)})),
  tool('saved.add', 'Save a place, or a commute between two saved places with days, a departure window and preferences (at most 20).', false,
    writeIn({kind: enumOf(['place', 'commute']), label: text(80), place_ref: id, from_saved_id: id, to_saved_id: id, days: arr(int(1, 7), 7, {minItems: 1}),
      window: obj({start: hhmm, end: hhmm}, []), step_free: bool, max_walk_m: int(0, 5000), max_transfers: int(0, 4), avoid_modes: arr(mode, 2, {uniqueItems: true})}, ['kind', 'label']),
    writeOut({saved_id: id})),
  tool('saved.remove', 'Remove a saved place or commute that no subscription refers to.', false, writeIn({saved_id: id}, ['saved_id']), writeOut({saved_id: id})),
  tool('subscriptions.create', 'Subscribe to a route, stop, facility, saved commute or card (at most 25).', false,
    writeIn({target: obj({kind: enumOf(['route', 'stop', 'facility', 'commute', 'card']), id}), window: windowIn, delay_threshold_min: int(1, 240),
      low_balance_cents: int(0, 100000), quiet_hours: quietIn, urgent_override: bool, delivery}, ['target']), writeOut({subscription_id: id})),
  tool('subscriptions.update', 'Change a subscription, or pause or resume it.', false,
    writeIn({subscription_id: id, window: nullable(windowIn), delay_threshold_min: int(1, 240), low_balance_cents: int(0, 100000), quiet_hours: quietIn, urgent_override: bool,
      delivery, status: enumOf(['active', 'paused'])}, ['subscription_id']), writeOut({subscription_id: id, revision: int(1, 100000)})),
  tool('subscriptions.delete', 'Delete a subscription (kept as a tombstone with its revisions).', false, writeIn({subscription_id: id}, ['subscription_id']), writeOut({subscription_id: id})),
  tool('notifications.acknowledge', 'Mark a notification as read.', false, writeIn({notification_id: id}, ['notification_id']), writeOut({notification_id: id, acknowledged_at: time})),
  tool('cards.add_value', 'Load value onto a card; it is pending, and spendable only once the payment settles.', false,
    writeIn({card_id: id, amount_cents: int(1, 1000000), payment_method_id: id}, ['card_id', 'amount_cents', 'payment_method_id']),
    writeOut({entry_id: id, spendable_cents: cents, pending_cents: cents})),
  tool('cards.set_autoreload', 'Set or clear (null) a card\'s autoreload rule; it is checked only after a charged tap.', false,
    writeIn({card_id: id, rule: nullable(obj({threshold_cents: int(0, 100000), amount_cents: int(1, 1000000), payment_method_id: id}, []))}, ['card_id']),
    writeOut({card_id: id, autoreload: nullable(ref('autoreload'))})),
  tool('passes.purchase', 'Buy a monthly pass from the settled balance, for this month or a later one.', false,
    writeIn({card_id: id, product: enumOf(['monthly']), start_month: monthP}, ['card_id', 'product', 'start_month']), writeOut({pass_id: id, balance_cents: cents})),
  tool('passes.cancel', 'Cancel a pass before it starts, with a full refund.', false, writeIn({pass_id: id}, ['pass_id']), writeOut({pass_id: id, refund_cents: cents, balance_cents: cents})),
  tool('cards.report_lost', 'Block a card at once and issue a virtual replacement carrying its balance, pending loads, passes, reduced fare and cap progress; a $5.00 fee applies.', false,
    writeIn({card_id: id}, ['card_id']), writeOut({card_id: id, replacement_card_id: id, fee_cents: cents, fee_owed_cents: cents, balance_cents: cents})),
  tool('reduced_fare.apply', 'Apply for a reduced fare (senior, disability or low_income); the decision arrives later.', false,
    writeIn({card_id: id, program: enumOf(PROGRAMS)}, ['card_id', 'program']), writeOut({application_id: id, application_status: enumOf(['submitted'])}))
];

function build({check = false} = {}) {
  const outputs = {'schemas/seed.schema.json': seed, 'schemas/events.schema.json': events, 'tools.json': tools};
  for (const [file, value] of Object.entries(outputs)) {
    const expected = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) throw new Error('Generated contract drift: ' + file); }
    else fs.writeFileSync(target, expected);
  }
  return {tools: tools.length};
}
module.exports = {build};
if (require.main === module) console.log(JSON.stringify(build({check: process.argv.includes('--check')})));
