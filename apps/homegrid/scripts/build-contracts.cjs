'use strict';
// App-owned generator: one definition source for the seed schema, event schema and tools.json.
// `node scripts/build-contracts.cjs` writes them; `--check` fails on drift (used by the tests).
const fs = require('node:fs'), path = require('node:path');
const {SERVICE_TYPES, TYPES} = require('../src/catalog.cjs');
const root = path.resolve(__dirname, '..');

const id = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'};
const time = {type: 'string', format: 'date-time'};
const date = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
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
const service = enumOf(SERVICE_TYPES);
const delivery = enumOf(['mail', 'in_app']);
const slot = enumOf(['08-12', '12-16', '16-20']);
const history = arr(obj({at: time, action: text(200)}), 500);

const defs = {
  external_ref: obj({app_id: id, account_id: id, object_id: id}),
  payment_method: obj({payment_method_id: id, label: text(80), last4: {type: 'string', pattern: '^\\d{4}$'}, fails: bool}),
  customer: obj({name: text(120), late_payments: arr(time, 100), payment_methods: arr(def('payment_method'), 10)}),
  type_pref: obj({enabled: bool, delivery}),
  preferences: obj({time_zone: text(64), quiet_hours: nullable(obj({start: hhmm, end: hhmm})),
    types: obj(Object.fromEntries(TYPES.map(t => [t, def('type_pref')]))), health: obj({bypass_quiet_hours: bool, delivery})}),
  area: obj({area_id: id, name: text(120), time_zone: text(64)}),
  premise: obj({premise_id: id, address: text(200), area_id: id, internet_tech: enumOf(['fiber', 'cable', 'none']),
    self_install: bool, external_ref: nullable(def('external_ref'))}),
  capacity: obj({area_id: id, date, slot, capacity: int(0, 50)}),
  stock: obj({area_id: id, hotspots: int(0, 1000)}),
  test: obj({at: time, result: enumOf(['pass', 'fail']), speed_mbps: nullable(int(0, 10000)),
    reason: nullable(enumOf(['not_activated', 'outage', 'equipment_not_delivered'])), outage_id: nullable(id)}),
  service: obj({service_id: id, premise_id: id, service_type: service, plan_id: id,
    status: enumOf(['pending_start', 'active', 'pending_stop', 'stopped', 'install_failed']),
    start_date: nullable(date), stop_date: nullable(date), activated_at: nullable(time), last_test: nullable(def('test'))}),
  order: obj({order_id: id, transfer_id: nullable(id), type: enumOf(['start', 'stop', 'temporary_internet']), premise_id: id,
    service_type: service, plan_id: nullable(id), date: nullable(date), temp: nullable(obj({from: date, to: date})),
    status: enumOf(['scheduled', 'effective', 'cancelled']), needs: enumOf(['none', 'technician', 'self_install']),
    deposit_cents: cents, price_cents: cents, created_at: time, history}),
  appointment: obj({appointment_id: id, order_id: id, date, slot,
    status: enumOf(['booked', 'technician_en_route', 'arrived', 'completed', 'cancelled', 'missed_by_provider', 'no_access']), history}),
  equipment: obj({equipment_id: id, kind: enumOf(['gateway', 'hotspot']), premise_id: id, order_id: nullable(id),
    status: enumOf(['ordered', 'shipped', 'delivered', 'in_use', 'return_due', 'returned']),
    return_due: nullable(date), return_method: nullable(enumOf(['dropoff', 'prepaid_label'])), returned_at: nullable(time)}),
  outage_version: obj({seq: int(1, 1000), status: enumOf(['started', 'etr_updated', 'restored']), at: time, etr: nullable(time)}),
  outage: obj({outage_id: id, service_type: service, premise_ids: arr(id, 1000, {minItems: 1}), cause: nullable(text(200)),
    versions: arr(def('outage_version'), 1000, {minItems: 1})}),
  advisory_version: obj({version: int(1, 1000), msg_type: enumOf(['issue', 'update', 'lift']),
    kind: enumOf(['boil_water', 'do_not_drink', 'planned_shutoff']), area_ids: arr(id, 100), premise_ids: arr(id, 1000),
    effective_from: time, planned_end: nullable(time), instructions: text(2000), issued_at: time}),
  advisory: obj({advisory_id: id, versions: arr(def('advisory_version'), 1000, {minItems: 1})}),
  report: obj({report_id: id, premise_id: id, service_type: service, outage_id: nullable(id), status: enumOf(['linked', 'investigating']),
    created_at: time, note: text(500, 0)}),
  charge: obj({charge_id: id, premise_id: id, kind: text(40), ref: nullable(id), description: text(200), amount_cents: cents, created_at: time, billed_in: nullable(id)}),
  ignored_event: obj({event_id: id, at: time, operation: text(60), reason: text(200)}),
  bill_line: obj({kind: text(40), description: text(200), amount_cents: cents}),
  usage: {type: 'object', additionalProperties: obj({kwh: {type: 'number', minimum: 0}, gal: {type: 'number', minimum: 0}}, [])},
  bill: obj({bill_id: id, premise_id: id, period: obj({from: date, to: date}), closed_at: time, due_date: date,
    usage: def('usage'), prior_balance_cents: cents, lines: arr(def('bill_line'), 100), total_cents: cents}),
  payment: obj({payment_id: id, amount_cents: int(0, 10000000), payment_method_id: id, created_at: time, scheduled_for: nullable(date),
    autopay_bill_id: nullable(id), status: enumOf(['scheduled', 'pending', 'settled', 'returned', 'skipped', 'cancelled']), resolved_at: nullable(time)}),
  arrangement: obj({arrangement_id: id, bill_id: id, created_at: time, installments: arr(obj({due_date: date, amount_cents: int(0, 10000000)}), 6, {minItems: 2})}),
  notification: obj({notification_id: id, type: enumOf(TYPES), trigger_key: text(300), source: obj({kind: text(40), id, version: nullable(int(0, 100000))}),
    premise_id: nullable(id), health: bool, created_at: time, release_at: nullable(time), delivery,
    status: enumOf(['in_app', 'held_quiet_hours', 'pending_delivery', 'delivered', 'delivery_failed', 'withdrawn']),
    title: text(200), body: text(2000), time, recipient_person_id: id,
    outcome: nullable(obj({status: enumOf(['committed', 'rejected', 'unknown', 'halted']), code: nullable(text(80)), stop_run: bool,
      router_event_id: nullable(text(150)), recorded_at: time})), acknowledged_at: nullable(time)})
};

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:homegrid:seed:1', title: 'Homegrid account and world data',
  ...obj({account_id: id, owner_person_id: id, customer: def('customer'), preferences: def('preferences'),
    areas: arr(def('area'), 100), holidays: arr(date, 100), premises: arr(def('premise'), 1000), capacity: arr(def('capacity'), 5000),
    stock: arr(def('stock'), 100), services: arr(def('service'), 1000), orders: arr(def('order'), 2000),
    appointments: arr(def('appointment'), 2000), equipment: arr(def('equipment'), 1000), outages: arr(def('outage'), 1000),
    advisories: arr(def('advisory'), 1000), reports: arr(def('report'), 1000), charges: arr(def('charge'), 5000),
    bills: arr(def('bill'), 2000), payments: arr(def('payment'), 5000), autopay: obj({payment_method_id: nullable(id)}),
    arrangements: arr(def('arrangement'), 100), notifications: arr(def('notification'), 20000),
    ignored_events: arr(def('ignored_event'), 5000)}),
  $defs: defs
};

const selector = obj({premise_id: id, service_type: service, kind: enumOf(['gateway', 'hotspot']), oldest_pending: {const: true}}, []);
const envelope = (operation, payload) => obj({event_id: id, at: time, operation: {const: operation}, payload});
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:homegrid:events:1',
  title: 'Infra-applied Homegrid events (tasks choose content and timing)',
  anyOf: [
    envelope('field.technician_update', obj({appointment_id: id, selector,
      status: enumOf(['technician_en_route', 'arrived', 'completed', 'no_access', 'missed_by_provider'])}, ['status'])),
    envelope('field.activation_result', obj({service_id: id, result: enumOf(['activated', 'failed']), speed_mbps: int(0, 10000), reason: text(80)}, ['service_id', 'result'])),
    envelope('logistics.shipment_update', obj({shipment_id: id, equipment_id: id, selector, status: enumOf(['shipped', 'delivered', 'returned_received'])}, ['status'])),
    envelope('grid.outage_updated', obj({outage_id: id, service, status: enumOf(['started', 'etr_updated', 'restored']),
      areas: arr(id, 100), premise_ids: arr(id, 1000), etr: time, cause: text(200)}, ['outage_id', 'status'])),
    envelope('water.advisory_published', obj({advisory_id: id, version: int(1, 1000), msg_type: enumOf(['issue', 'update', 'lift']),
      kind: enumOf(['boil_water', 'do_not_drink', 'planned_shutoff']), areas: arr(id, 100), premise_ids: arr(id, 1000),
      effective_from: time, planned_end: time, instructions: text(2000), issued_at: time,
      references: arr(obj({advisory_id: id, version: int(1, 1000)}), 10)}, ['advisory_id', 'version', 'msg_type'])),
    envelope('billing.cycle_closed', obj({bill_id: id, premise_id: id, period: obj({from: date, to: date}),
      usage: {type: 'object', additionalProperties: obj({kwh: {type: 'number', minimum: 0}, gal: {type: 'number', minimum: 0}}, [])}}, ['bill_id', 'period', 'usage'])),
    envelope('payment.settled', obj({payment_id: id, selector, outcome: enumOf(['settled', 'returned'])}, ['outcome'])),
    envelope('notification.delivery_recorded', obj({notification_id: id, status: enumOf(['committed', 'rejected', 'unknown', 'halted']),
      code: nullable(text(80)), stop_run: bool, router_event_id: nullable(text(150))}, ['notification_id', 'status', 'code', 'router_event_id']))
  ]
};

const version = obj({epoch: int(1), revision: int(0)});
const writeIn = (properties, required = []) => obj({...properties, expected_version: version, request_id: id}, [...required, 'expected_version', 'request_id']);
const readOut = properties => obj({status: {const: 'ok'}, app_id: {const: 'homegrid'}, version, as_of: time, ...properties});
const writeOut = properties => obj({status: {const: 'committed'}, app_id: {const: 'homegrid'}, version, ...properties});
const any = {type: 'object'};
const tool = (name, description, read_only, inputSchema, outputSchema) =>
  ({name: 'homegrid.' + name, description, read_only, scope: 'homegrid.' + name, resource_target: 'current account', inputSchema, outputSchema});
const previewIn = {type: enumOf(['start', 'stop', 'transfer', 'temporary_internet']), premise_id: id, service_type: service, plan_id: id,
  date, service_id: id, from_premise_id: id, to_premise_id: id, services: arr(service, 3, {uniqueItems: true}), stop_date: date,
  start_date: date, from: date, to: date};

const tools = [
  tool('account.get', 'Customer, payment methods (masked), autopay and premises on the account.', true, obj({}, []), readOut({account: any})),
  tool('premises.search', 'Find a premise by address text (premises seeded for the task).', true, obj({query: text(200, 0)}, []), readOut({premises: arr(any, 1000)})),
  tool('services.list', 'Services with status, plan, activation and last connection test, as of the run\'s virtual time.', true,
    obj({premise_id: id}, []), readOut({services: arr(any, 1000)})),
  tool('plans.list', 'Plans available for a service at a premise.', true, obj({premise_id: id, service_type: service}), readOut({plans: arr(any, 20)})),
  tool('orders.list', 'Orders with status and history.', true, obj({premise_id: id, status: enumOf(['scheduled', 'effective', 'cancelled'])}, []), readOut({orders: arr(any, 2000)})),
  tool('orders.preview', 'Earliest dates, deposit, technician need, gap or overlap warnings and price for a start, stop, transfer or temporary-internet order, with a token for orders.create.', true,
    obj(previewIn, ['type']), readOut({order_token: text(4000), expires_at: time, parts: arr(any, 10), warnings: any, deposit_cents: cents, price_cents: cents})),
  tool('appointments.slots', 'Installation windows with free capacity at a premise; with order_id, the windows that order can use.', true,
    obj({premise_id: id, from: date, to: date, order_id: id}, ['premise_id', 'from', 'to']),
    readOut({slots: arr(obj({date, slot, free: int(0, 50)}), 500), earliest: nullable(date), earliest_slot: nullable(slot)})),
  tool('equipment.list', 'Gateways and hotspots with status and return deadlines.', true, obj({}, []), readOut({equipment: arr(any, 1000)})),
  tool('outages.list', 'Outages affecting a premise, with estimated restoration history.', true, obj({premise_id: id}), readOut({outages: arr(any, 1000)})),
  tool('advisories.list', 'Water advisories for a premise with status derived at the virtual time and the version chain.', true,
    obj({premise_id: id}), readOut({advisories: arr(any, 1000)})),
  tool('bills.list', 'Bills with totals, due dates and status (open, paid, past_due).', true, obj({premise_id: id}, []), readOut({bills: arr(any, 2000)})),
  tool('bills.get', 'One bill with its line items and payments applied.', true, obj({bill_id: id}), readOut({bill: any})),
  tool('payments.list', 'Payments, the autopay schedule and payment arrangements with installments.', true, obj({}, []),
    readOut({payments: arr(any, 5000), autopay: any, arrangements: arr(any, 100)})),
  tool('preferences.get', 'Notification preferences, quiet hours and health-advisory settings.', true, obj({}, []), readOut({preferences: ref('preferences')})),
  tool('notifications.list', 'Notifications with delivery status as of the virtual time.', true,
    obj({status: defs.notification.properties.status, type: enumOf(TYPES)}, []), readOut({notifications: arr(ref('notification'), 20000)})),
  tool('orders.create', 'Create the order(s) described by a preview token.', false, writeIn({order_token: text(4000)}, ['order_token']),
    writeOut({order_ids: arr(id, 10), transfer_id: nullable(id)})),
  tool('orders.reschedule', 'Move a scheduled start or stop to another date (lead times apply).', false,
    writeIn({order_id: id, date}, ['order_id', 'date']), writeOut({order_id: id, date})),
  tool('orders.cancel', 'Cancel an order that is not yet effective.', false, writeIn({order_id: id}, ['order_id']), writeOut({order_id: id})),
  tool('appointments.book', 'Book an installation window for an internet start order.', false,
    writeIn({order_id: id, date, slot}, ['order_id', 'date', 'slot']), writeOut({appointment_id: id})),
  tool('appointments.reschedule', 'Move an appointment; within 24 h of the window a $25.00 fee applies.', false,
    writeIn({appointment_id: id, date, slot}, ['appointment_id', 'date', 'slot']), writeOut({appointment_id: id, fee_cents: cents})),
  tool('appointments.cancel', 'Cancel an appointment; within 24 h of the window a $25.00 fee applies. The order stays open.', false,
    writeIn({appointment_id: id}, ['appointment_id']), writeOut({appointment_id: id, fee_cents: cents})),
  tool('connection.run_test', 'Run and record a connection test for an internet service.', false,
    writeIn({service_id: id}, ['service_id']), writeOut({test: ref('test')})),
  tool('equipment.schedule_return', 'Arrange the return of a gateway or hotspot.', false,
    writeIn({equipment_id: id, method: enumOf(['dropoff', 'prepaid_label'])}, ['equipment_id', 'method']), writeOut({equipment_id: id, return_due: nullable(date)})),
  tool('outages.report', 'Report an outage at a premise; linked to a known outage or investigated.', false,
    writeIn({premise_id: id, service_type: service, note: text(500, 0)}, ['premise_id', 'service_type']), writeOut({report_id: id, report_status: enumOf(['linked', 'investigating']), outage_id: nullable(id)})),
  tool('payments.make', 'Make a payment in integer cents; pending until settled.', false,
    writeIn({amount_cents: int(1, 10000000), payment_method_id: id}, ['amount_cents', 'payment_method_id']), writeOut({payment_id: id})),
  tool('autopay.set', 'Turn autopay on with a payment method, or off with null.', false,
    writeIn({payment_method_id: nullable(id)}, ['payment_method_id']), writeOut({payment_method_id: nullable(id)})),
  tool('arrangements.request', 'Request a payment plan for a past-due bill (2-6 installments).', false,
    writeIn({bill_id: id, installments: int(1, 12)}, ['bill_id', 'installments']), writeOut({arrangement_id: id, installments: arr(obj({due_date: date, amount_cents: int(0)}), 6)})),
  tool('preferences.update', 'Change notification preferences, quiet hours or health-advisory delivery.', false,
    writeIn({time_zone: text(64), quiet_hours: nullable(obj({start: hhmm, end: hhmm})), types: obj(Object.fromEntries(TYPES.map(t => [t, ref('type_pref')])), []),
      health: obj({bypass_quiet_hours: bool, delivery}, [])}), writeOut({preferences: ref('preferences')})),
  tool('notifications.acknowledge', 'Mark a notification as read.', false, writeIn({notification_id: id}, ['notification_id']),
    writeOut({notification_id: id, acknowledged_at: time}))
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
