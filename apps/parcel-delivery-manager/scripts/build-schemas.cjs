#!/usr/bin/env node
'use strict';
// Single source for this App's business contracts. Core and MCP clients need fully
// expanded schemas, so tools.json, seed.schema.json and events.schema.json are generated
// from the definitions below. Run `node scripts/build-schemas.cjs` after editing and
// `--check` to detect drift. The shared public contract copies in schemas/ are not
// generated here; they come from runtime/build-contracts.cjs.
const fs = require('node:fs');
const path = require('node:path');

const APP = 'parcel-delivery-manager';
const T = name => APP + '.' + name;

// ---------- primitives ----------
const id = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const time = {type: 'string', format: 'date-time'};
const day = {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'};
const clock = {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'};
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const int = (minimum = 0, maximum) => (maximum === undefined ? {type: 'integer', minimum} : {type: 'integer', minimum, maximum});
const bool = {type: 'boolean'};
const nullable = schema => ({anyOf: [schema, {type: 'null'}]});
const list = (items, maxItems = 1000, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const obj = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const oneOf = values => ({enum: values});
const version = obj({epoch: int(1), revision: int(0)});

// ---------- business vocabulary ----------
const PHYSICAL = ['in_transit', 'out_for_delivery', 'attempt_failed', 'at_pickup', 'delivered', 'collected', 'returning', 'returned'];
const MODES = ['home', 'pickup', 'hold'];
const CHANGE_KINDS = ['reschedule', 'address', 'hold', 'redirect', 'home_delivery'];
const CHANGE_STATUS = ['pending', 'applied', 'rejected', 'cancelled'];
const GRANT_STATUS = ['active', 'revoked', 'replaced', 'expired', 'invalidated', 'consumed'];
const PASS_STATUS = ['active', 'consumed', 'invalidated'];

const history = list(obj({at: time, action: text(80)}));
const plan = obj({
  revision: int(1),
  mode: oneOf(MODES),
  address_id: nullable(id),
  point_id: nullable(id),
  delivery_date: nullable(day),
  hold_until: nullable(day)
});
const pickup = obj({point_id: id, epoch: int(1), ready_at: time, deadline: time});
const attempt = obj({at: time, reason: text(200), action_deadline: time});
const returnInfo = obj({started_at: time, reason: text(600), completed_at: nullable(time)});
const timelineEntry = obj({at: time, kind: text(80), summary: text(1000)});

const address = obj({
  id, person_id: id, label: text(80), recipient_name: text(120),
  line1: text(200), line2: nullable(text(200)), city: text(100), region: text(100),
  postal_code: text(20), country: text(2), verified: bool, delivery_restricted: bool
});
const hours = obj({weekday: int(0, 6), opens: clock, closes: clock});
const point = obj({
  id, name: text(120), kind: oneOf(['counter', 'locker']), address_text: text(300),
  time_zone: text(64), hours: list(hours, 21), status: oneOf(['open', 'closed']),
  accessible: bool, accepts_redirects: bool, status_note: nullable(text(300)), updated_at: time
});
const policy = obj({
  id, name: text(120),
  allow_reschedule: bool, max_reschedule_days: int(0, 30),
  allow_address_change: bool, allow_hold: bool, max_hold_days: int(0, 30),
  allow_pickup_redirect: bool, allow_delegation: bool,
  change_cutoff_hours: int(0, 168), pickup_window_hours: int(1, 720),
  failure_action_hours: int(1, 720), max_grant_hours: int(1, 720),
  allowed_point_kinds: list(oneOf(['counter', 'locker']), 2, {uniqueItems: true})
});
const collector = obj({recipient_person_id: id, person_id: id, relationship: text(80)});
const shipment = obj({
  id, account_id: id, tracking_number: text(40), recipient_person_id: id,
  sender_label: text(120), contents_label: text(200), policy_id: id,
  created_at: time, updated_at: time, estimated_delivery: nullable(day),
  status: oneOf(PHYSICAL), plan, pending_change_id: nullable(id),
  pickup_epoch: int(0), pickup: nullable(pickup), attempt: nullable(attempt),
  return_info: nullable(returnInfo), completed_at: nullable(time),
  timeline: list(timelineEntry), history
});
const target = obj({mode: oneOf(MODES), address_id: nullable(id), point_id: nullable(id), delivery_date: nullable(day), hold_until: nullable(day)});
const change = obj({
  id, account_id: id, shipment_id: id, kind: oneOf(CHANGE_KINDS), requested_by_person_id: id,
  created_at: time, updated_at: time, base_plan_revision: int(1), target,
  status: oneOf(CHANGE_STATUS), decided_at: nullable(time), reason: nullable(text(300)), history
});
const grant = obj({
  id, account_id: id, shipment_id: id, collector_person_id: id, point_id: id, pickup_epoch: int(1),
  created_at: time, expires_at: time, status: oneOf(GRANT_STATUS), ended_at: nullable(time),
  end_reason: nullable(text(200)), replaces_grant_id: nullable(id), history
});
const pass = obj({
  id, account_id: id, shipment_id: id, holder_person_id: id, grant_id: nullable(id), point_id: id,
  pickup_epoch: int(1), code: {type: 'string', pattern: '^[A-Z0-9]{4}-[A-Z0-9]{4}$'}, issued_at: time, expires_at: time,
  status: oneOf(PASS_STATUS), ended_at: nullable(time), end_reason: nullable(text(200))
});
const notice = obj({id, account_id: id, shipment_id: nullable(id), at: time, type: text(80), audience: list(id, 20, {minItems: 1, uniqueItems: true}), message: text(1500)});

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pale:parcel-delivery-manager:seed:1',
  ...obj({
    account_id: id, owner_person_id: id,
    carrier: obj({name: text(120), service_area: text(200), time_zone: text(64)}),
    addresses: list(address, 200), pickup_points: list(point, 100), policies: list(policy, 50),
    collectors: list(collector, 200), shipments: list(shipment, 500), changes: list(change, 2000),
    grants: list(grant, 2000), passes: list(pass, 4000), notices: list(notice, 5000)
  })
};

// ---------- Agent-facing views (subsets of records; access-filtered by the App) ----------
const shipmentSummary = obj({
  id, access: oneOf(['recipient', 'delegate']), tracking_number: nullable(text(40)), sender_label: nullable(text(120)),
  contents_label: text(200), status: oneOf(PHYSICAL), plan_mode: nullable(oneOf(MODES)), updated_at: time,
  pickup_deadline: nullable(time), deadline_passed: bool, has_pending_change: bool
});
const deadlineView = obj({kind: oneOf(['pickup', 'failure_action', 'hold_end']), at: time, passed: bool});
const pointView = obj({
  id, name: text(120), kind: oneOf(['counter', 'locker']), address_text: text(300), time_zone: text(64),
  hours: list(hours, 21), status: oneOf(['open', 'closed']), accessible: bool, accepts_redirects: bool,
  status_note: nullable(text(300)), open_now: bool
});
// `point` is the pickup point of the current plan (its hours, status and any closure note), or null.
const shipmentView = obj({
  id, access: oneOf(['recipient', 'delegate']), tracking_number: nullable(text(40)), recipient_person_id: nullable(id),
  sender_label: nullable(text(120)), contents_label: text(200), policy_id: nullable(id), status: oneOf(PHYSICAL),
  estimated_delivery: nullable(day), plan: nullable(plan), pending_change: nullable(change), pickup: nullable(pickup),
  point: nullable(pointView), attempt: nullable(attempt), return_info: nullable(returnInfo), completed_at: nullable(time),
  deadlines: list(deadlineView, 3), timeline: list(timelineEntry), created_at: time, updated_at: time
});
// A grant with status `active` and valid_now false has expired by the clock.
const grantView = obj({
  id, shipment_id: id, collector_person_id: id, collector_name: nullable(text(120)), point_id: id, pickup_epoch: int(1),
  created_at: time, expires_at: time, status: oneOf(GRANT_STATUS), valid_now: bool, ended_at: nullable(time),
  end_reason: nullable(text(200)), replaces_grant_id: nullable(id)
});
const eligibility = obj({allowed: bool, reason: nullable(text(80))});
const optionsView = obj({
  shipment_id: id, plan_revision: int(1), cutoff_at: nullable(time),
  reschedule: obj({...eligibility.properties, earliest_date: nullable(day), latest_date: nullable(day)}),
  address: obj({...eligibility.properties, address_ids: list(id, 200)}),
  hold: obj({...eligibility.properties, latest_date: nullable(day)}),
  redirect: obj({...eligibility.properties, point_ids: list(id, 100)}),
  home_delivery: obj({...eligibility.properties, address_ids: list(id, 200)}),
  delegation: obj({...eligibility.properties, latest_expires_at: nullable(time)})
});
// Flat change request. `id` is always the tool's primary object so Core object-level policy constraints apply to it.
const changeFields = {id, kind: oneOf(CHANGE_KINDS), delivery_date: day, address_id: id, point_id: id, hold_until: day};
const preview = obj({allowed: bool, reason: nullable(text(80)), summary: text(1500), confirmation: nullable(text(64)), current_plan: nullable(plan), proposed_plan: nullable(target)});
const passView = obj({
  id, shipment_id: id, holder_person_id: id, role: oneOf(['recipient', 'delegate']), point_id: id, point_name: text(120),
  pickup_epoch: int(1), code: pass.properties.code, issued_at: time, expires_at: time, valid_now: bool
});

const write = (properties, required = Object.keys(properties)) => {
  const input = obj({...properties, expected_version: version, request_id: id}, [...required, 'expected_version', 'request_id']);
  return input;
};
const output = (properties, read = true) => obj({status: {const: read ? 'ok' : 'committed'}, app_id: {const: APP}, version, ...properties});

const tool = (name, description, readOnly, inputSchema, outputProperties) => ({
  name: T(name), description, read_only: readOnly, scope: T(name), resource_target: 'current account',
  inputSchema, outputSchema: output(outputProperties, readOnly)
});

const tools = [
  tool('shipments.list', 'List parcels this person may see: their own parcels and parcels they are currently authorized to collect. Closed parcels (delivered, collected, returned) require include_closed. Read-only.', true,
    obj({query: text(200, 0), include_closed: bool}, []), {items: list(shipmentSummary, 500)}),
  tool('shipments.get', 'Read one parcel by its ID: physical status, current delivery plan, pending change, pickup readiness, deadlines and timeline. A delegate sees only the collection details of a parcel they are authorized for. Read-only.', true,
    obj({id}), {shipment: shipmentView}),
  tool('options.get', 'For the parcel with this ID, list the delivery changes its policy currently allows (reschedule, address, hold, pickup redirect, back to home delivery, delegation) with eligible dates, addresses and points, and a reason when a change is not allowed. Recipient only. Read-only.', true,
    obj({id}), {options: optionsView}),
  tool('addresses.list', 'List this person\'s own saved delivery addresses with their label and whether each is verified or restricted for delivery. Address IDs returned by options.get refer to these. Read-only.', true,
    obj({}, []), {items: list(obj({id, label: text(80), recipient_name: text(120), line1: text(200), line2: nullable(text(200)), city: text(100), region: text(100),
      postal_code: text(20), country: text(2), verified: bool, delivery_restricted: bool}), 200)}),
  tool('points.list', 'Search the pickup-point directory with hours, accessibility and current status. Read-only.', true,
    obj({query: text(200, 0), accessible_only: bool, open_only: bool}, []), {items: list(pointView, 100)}),
  tool('change.preview', 'Check a proposed delivery change for the parcel with this ID against its current plan and policy, without changing anything. kind selects the change: reschedule (delivery_date), address (address_id, optional delivery_date), hold (hold_until), redirect (point_id) or home_delivery (address_id, optional delivery_date). Returns the effect and a confirmation value that change.submit requires; the confirmation becomes stale when the parcel changes. Read-only.', true,
    obj(changeFields, ['id', 'kind']), {preview}),
  tool('change.submit', 'Submit a previewed delivery change for the parcel with this ID to the carrier, repeating the previewed fields and its confirmation. The request becomes pending; the delivery plan changes only when the carrier applies it.', false,
    write({...changeFields, confirmation: text(64)}, ['id', 'kind', 'confirmation']), {change_id: id, change_status: {const: 'pending'}}),
  tool('change.cancel', 'Withdraw the pending delivery change with this change ID. Fails with too_late once the carrier has decided it.', false,
    write({id}), {change_id: id, change_status: {const: 'cancelled'}}),
  tool('changes.list', 'List delivery change requests and their decisions, optionally for one parcel. Recipient only. Read-only.', true,
    obj({shipment_id: id}, []), {items: list(change, 2000)}),
  tool('collectors.list', 'List the people this recipient has saved as trusted collectors. Read-only.', true,
    obj({}, []), {items: list(obj({person_id: id, name: nullable(text(120)), relationship: text(80)}), 200)}),
  tool('grants.list', 'List collection authorizations on this person\'s own parcels with their status, or the current authorizations granted to this person as a collector. Read-only.', true,
    obj({shipment_id: id}, []), {items: list(grantView, 2000)}),
  tool('grant.preview', 'Check whether a trusted collector can be authorized to collect the ready parcel with this ID until expires_at, optionally replacing an existing authorization. The authorization cannot outlast the pickup deadline or the policy maximum (latest_expires_at). Returns the limited access granted and a confirmation value that grant.create requires. Recipient only. Read-only.', true,
    obj({id, collector_person_id: id, expires_at: time, replaces_grant_id: id}, ['id', 'collector_person_id', 'expires_at']),
    {preview: obj({allowed: bool, reason: nullable(text(80)), summary: text(1500), confirmation: nullable(text(64)), point_id: nullable(id), expires_at: nullable(time), latest_expires_at: nullable(time)})}),
  tool('grant.create', 'Authorize a trusted collector for the ready parcel with this ID at its current pickup point, or replace an existing authorization, repeating the previewed fields and its confirmation. Issues the collector their own pass. The collector can see only this parcel\'s pickup details and cannot change the parcel or authorize anyone else.', false,
    write({id, collector_person_id: id, expires_at: time, replaces_grant_id: id, confirmation: text(64)}, ['id', 'collector_person_id', 'expires_at', 'confirmation']),
    {grant_id: id, pass_id: id}),
  tool('grant.revoke', 'Revoke the collection authorization with this grant ID and invalidate its pass at once. Fails with grant_not_active if it already ended.', false,
    write({id}), {grant_id: id, grant_status: {const: 'revoked'}}),
  tool('pass.get', 'Show this person\'s current collection pass for the ready parcel with this ID (the recipient\'s own pass or a delegate\'s authorized pass). Read-only.', true,
    obj({id}), {pass: passView}),
  tool('notices.list', 'List in-app delivery notices for parcels this person can currently see, optionally for one parcel. Read-only.', true,
    obj({shipment_id: id}, []), {items: list(notice, 5000)})
];

// ---------- trusted Infra events ----------
const EVENTS = {
  'carrier.change_resolved': obj({shipment_id: id, change_id: id, base_plan_revision: int(1), decision: oneOf(['applied', 'rejected']), reason: nullable(text(300))}),
  'carrier.transit_update': obj({shipment_id: id, plan_revision: int(1), status: oneOf(['in_transit', 'out_for_delivery']), estimated_delivery: nullable(day)}),
  'carrier.delivery_failed': obj({shipment_id: id, plan_revision: int(1), reason: text(200)}),
  'carrier.delivered': obj({shipment_id: id, plan_revision: int(1)}),
  'carrier.pickup_ready': obj({shipment_id: id, plan_revision: int(1), point_id: id, pickup_epoch: int(1)}),
  'carrier.point_status': obj({point_id: id, status: oneOf(['open', 'closed']), note: nullable(text(300))}),
  'carrier.relocated': obj({shipment_id: id, plan_revision: int(1), to_point_id: id, reason: text(300)}),
  'carrier.collected': obj({shipment_id: id, point_id: id, pickup_epoch: int(1), collector_person_id: id, pass_code: pass.properties.code}),
  'carrier.deadline_reached': obj({shipment_id: id, deadline: oneOf(['pickup', 'failure_action', 'hold_end'])}),
  'carrier.return_completed': obj({shipment_id: id})
};
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pale:parcel-delivery-manager:events:1',
  oneOf: Object.entries(EVENTS).map(([operation, payload]) => obj({event_id: id, at: time, operation: {const: operation}, payload}))
};

const outputs = {
  'tools.json': tools,
  'schemas/seed.schema.json': seed,
  'schemas/events.schema.json': events
};
const root = path.resolve(__dirname, '..');
const render = value => JSON.stringify(value, null, 2) + '\n';
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(outputs)) {
    const target = path.join(root, file), expected = render(value);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) drift.push(file); }
    else fs.writeFileSync(target, expected);
  }
  return drift;
}
module.exports = {APP, EVENTS, tools, seed, events, build, PHYSICAL, CHANGE_KINDS};
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = build({check});
  if (drift.length) { console.error('Generated contract drift: ' + drift.join(', ') + '. Run node scripts/build-schemas.cjs'); process.exitCode = 1; }
  else console.log(check ? 'Generated contracts match.' : 'Generated tools.json, seed and event schemas.');
}
