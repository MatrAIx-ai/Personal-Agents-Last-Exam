'use strict';
// Infra-applied events. Tasks choose content and timing; Homegrid defines each event's effect.
// Core exposes the event's `at` as ctx.virtual_now while this runs, and rejects backwards time.
const {fail, copy, log, premise: getPremise, stamp, money, localDate, zoneOf, render, checkDates} = require('./common.cjs');
const {accountPremise} = require('./billing.cjs');
const {FEES, HEALTH_ADVISORIES, PLANS} = require('./catalog.cjs');
const {charge, closeCycle} = require('./billing.cjs');
const {notify, supersede} = require('./notify.cjs');
const {materialize} = require('./derive.cjs');
const {covers} = require('./reads.cjs');
const {OPEN} = require('./field.cjs');

// A moot event commits as a no-op; the reason is kept in Homegrid's own records.
class Moot { constructor(reason) { this.reason = reason; } }
const moot = reason => { throw new Moot(reason); };
const ACTIVE = ['active', 'pending_start', 'pending_stop'];
const served = (data, premiseId) => data.services.some(s => s.premise_id === premiseId && ACTIVE.includes(s.status));
const window = a => `${a.date}, ${a.slot.replace('-', ':00-')}:00`;
const local = (data, premiseId, t) => render(Date.parse(t), zoneOf(data, premiseId)).slice(0, 16).replace('T', ' ');

// Selectors must match at most one object; none is moot.
function pick(list, matches, what) {
  if (matches.length > 1) fail('invalid_event', 'The selector matches more than one ' + what + '.');
  if (!matches.length) moot('No ' + what + ' matches the selector.');
  return matches[0];
}

const STEPS = {
  technician_en_route: ['booked'],
  arrived: ['booked', 'technician_en_route'],
  completed: ['arrived'],
  no_access: ['technician_en_route', 'arrived'],
  missed_by_provider: ['booked', 'technician_en_route']
};
function technicianUpdate(ctx, data, p) {
  let a;
  if (p.appointment_id) {
    a = data.appointments.find(x => x.appointment_id === p.appointment_id);
    if (!a) fail('invalid_event', 'Unknown appointment.');
  } else if (p.selector && p.selector.premise_id && p.selector.service_type) {
    const open = data.orders.filter(o => o.premise_id === p.selector.premise_id && o.service_type === p.selector.service_type && o.status === 'scheduled' && o.needs === 'technician');
    const order = pick(data.orders, open, 'open order');
    a = pick(data.appointments, data.appointments.filter(x => x.order_id === order.order_id && OPEN.includes(x.status)), 'current appointment');
  } else fail('invalid_event', 'Give appointment_id or a {premise_id, service_type} selector.');
  const order = data.orders.find(o => o.order_id === a.order_id);
  if (order.status === 'cancelled' || !OPEN.includes(a.status)) moot(`Appointment ${a.appointment_id} is already ${order.status === 'cancelled' ? 'cancelled' : a.status}.`);
  if (!STEPS[p.status].includes(a.status)) fail('invalid_transition', `${a.status} cannot become ${p.status}.`);
  const at = stamp(ctx, data), place = getPremise(data, order.premise_id);
  a.status = p.status; a.history.push({at, action: p.status});
  const v = a.history.length, src = {kind: 'appointment', id: a.appointment_id, version: v};
  if (p.status === 'missed_by_provider') {
    charge(data, order.premise_id, 'missed_appointment_credit', `Missed appointment ${a.appointment_id}`, FEES.missed_appointment_credit, at, a.appointment_id);
    // Hotspot loans at this premise become free until the internet service activates.
    for (const loan of data.orders.filter(o => o.type === 'temporary_internet' && o.premise_id === order.premise_id && o.status !== 'cancelled' && o.price_cents > 0)) {
      const c = data.charges.find(x => x.kind === 'temporary_internet' && x.ref === loan.order_id && !x.billed_in);
      if (c) { data.charges = data.charges.filter(x => x !== c); loan.price_cents = 0; loan.history.push({at, action: 'free after missed installation'}); }
    }
    notify(ctx, data, {type: 'appointment', source: src, premiseId: order.premise_id, title: 'We missed your installation',
      body: `Our technician missed your ${window(a)} installation at ${place.address}. A ${money(-FEES.missed_appointment_credit)} credit will appear on your next bill. Book a new window; a temporary hotspot is free until your internet is active.`});
  } else if (p.status === 'no_access') {
    notify(ctx, data, {type: 'appointment', source: src, premiseId: order.premise_id, title: 'Technician could not get in',
      body: `The technician could not reach anyone at ${place.address}. Your order is still open; book a new window.`});
  } else if (p.status === 'technician_en_route') {
    notify(ctx, data, {type: 'appointment', source: src, premiseId: order.premise_id, title: 'Technician on the way',
      body: `Your technician is on the way to ${place.address} for the ${window(a)} window.`});
  } else if (p.status === 'completed') {
    order.history.push({at, action: 'installation completed'});
  }
  return data;
}

function activationResult(ctx, data, p) {
  const s = data.services.find(x => x.service_id === p.service_id);
  if (!s) {
    // A cancelled start removes its pending service; an activation scripted for it is moot.
    const gone = data.orders.filter(o => o.type === 'start' && o.service_type === 'internet' && `sv-${o.premise_id}-internet` === p.service_id).at(-1);
    if (gone && gone.status === 'cancelled') moot('The internet order is cancelled.');
  }
  if (!s || s.service_type !== 'internet') fail('invalid_event', 'Unknown internet service.');
  const order = data.orders.filter(o => o.type === 'start' && o.premise_id === s.premise_id && o.service_type === 'internet').at(-1);
  if (!order || order.status === 'cancelled') moot('The internet order is cancelled.');
  if (s.status === 'active' || order.status === 'effective') moot('The service is already active.');
  // A technician install activates after its latest appointment completes; a failed one needs a new appointment first.
  if (order.needs === 'technician') {
    const last = data.appointments.filter(a => a.order_id === order.order_id).at(-1);
    if (s.status !== 'pending_start' || !last || last.status !== 'completed') fail('invalid_transition', 'Activation needs a completed installation.');
  }
  const gateway = data.equipment.find(e => e.kind === 'gateway' && e.order_id === order.order_id);
  if (order.needs === 'self_install' && (!gateway || !['delivered', 'in_use'].includes(gateway.status))) fail('invalid_transition', 'The self-install kit has not been delivered.');
  const at = stamp(ctx, data), place = getPremise(data, s.premise_id);
  if (p.result === 'activated') {
    s.status = 'active'; s.activated_at = at; s.start_date = localDate(ctx.virtual_now, zoneOf(data, s.premise_id));
    order.status = 'effective'; order.date = s.start_date; order.history.push({at, action: 'effective (activated)'});
    if (gateway) gateway.status = 'in_use';
    else data.equipment.push({equipment_id: 'eq-' + order.order_id, kind: 'gateway', premise_id: s.premise_id, order_id: order.order_id,
      status: 'in_use', return_due: null, return_method: null, returned_at: null});
    const plan = PLANS.find(x => x.plan_id === s.plan_id);
    notify(ctx, data, {type: 'order', source: {kind: 'order', id: order.order_id, version: order.history.length}, premiseId: s.premise_id,
      title: 'Your internet is active', body: `${plan.name} is active at ${place.address} from ${local(data, s.premise_id, ctx.virtual_now)}.`});
  } else {
    s.status = 'install_failed';
    order.history.push({at, action: 'activation failed: ' + (p.reason || 'unspecified').slice(0, 80)});
    notify(ctx, data, {type: 'order', source: {kind: 'order', id: order.order_id, version: order.history.length}, premiseId: s.premise_id,
      title: 'Internet activation failed', body: `We could not activate internet at ${place.address}${p.reason ? ' (' + p.reason + ')' : ''}. Your order is still open; book a new installation window.`});
  }
  return data;
}

const SHIP = {shipped: ['ordered'], delivered: ['ordered', 'shipped'], returned_received: ['shipped', 'delivered', 'in_use', 'return_due']};
function shipmentUpdate(ctx, data, p) {
  let e;
  if (p.equipment_id) {
    e = data.equipment.find(x => x.equipment_id === p.equipment_id);
    if (!e) {
      const order = data.orders.find(o => 'eq-' + o.order_id === p.equipment_id);
      if (order && order.status === 'cancelled') moot('The order for this equipment is cancelled.');
      fail('invalid_event', 'Unknown equipment.');
    }
  } else if (p.selector && p.selector.premise_id && p.selector.kind) {
    e = pick(data.equipment, data.equipment.filter(x => x.premise_id === p.selector.premise_id && x.kind === p.selector.kind && x.status !== 'returned'), 'equipment');
  } else fail('invalid_event', 'Give equipment_id or a {premise_id, kind} selector.');
  if (e.status === 'returned') moot(`${e.equipment_id} is already returned.`);
  if (!SHIP[p.status].includes(e.status)) fail('invalid_transition', `${e.status} equipment cannot be ${p.status}.`);
  const at = stamp(ctx, data);
  if (p.status === 'returned_received') { e.status = 'returned'; e.returned_at = at; }
  else e.status = p.status === 'delivered' && e.kind === 'hotspot' ? 'in_use' : p.status;
  if (p.status === 'delivered') notify(ctx, data, {type: 'order', source: {kind: 'equipment', id: e.equipment_id, version: 2}, premiseId: e.premise_id,
    title: e.kind === 'hotspot' ? 'Your hotspot arrived' : 'Your gateway arrived', body: `Your ${e.kind} (${e.equipment_id}) was delivered to ${getPremise(data, e.premise_id).address}.`});
  return data;
}

function outageUpdated(ctx, data, p) {
  let o = data.outages.find(x => x.outage_id === p.outage_id);
  const at = stamp(ctx, data);
  if (p.status === 'started') {
    if (o) fail('invalid_transition', 'This outage has already started.');
    for (const id of p.premise_ids || []) if (!data.premises.some(x => x.premise_id === id)) fail('invalid_event', 'Unknown premise ' + id + '.');
    for (const id of p.areas || []) if (!data.areas.some(x => x.area_id === id)) fail('invalid_event', 'Unknown area ' + id + '.');
    // An outage names premises, areas or both; areas expand to their premises.
    const ids = [...new Set([...(p.premise_ids || []), ...data.premises.filter(x => (p.areas || []).includes(x.area_id)).map(x => x.premise_id)])];
    if (!p.service || !ids.length) fail('invalid_event', 'A new outage needs a service and premises or areas.');
    o = {outage_id: p.outage_id, service_type: p.service, premise_ids: ids, cause: p.cause || null, versions: []};
    data.outages.push(o);
    // Open reports at those premises are linked to the outage now that it is known.
    for (const r of data.reports.filter(x => x.status === 'investigating' && x.service_type === o.service_type && o.premise_ids.includes(x.premise_id))) {
      r.status = 'linked'; r.outage_id = o.outage_id;
    }
  } else {
    if (!o) fail('outage_reference_unknown', 'The outage does not exist.');
    if (o.versions.at(-1).status === 'restored') moot(`Outage ${o.outage_id} is already restored.`);
    if (p.service && p.service !== o.service_type) fail('invalid_event', 'An update cannot change the outage service.');
  }
  const seq = o.versions.length + 1;
  o.versions.push({seq, status: p.status, at, etr: p.status === 'restored' ? null : (p.etr || o.versions.at(-1)?.etr || null)});
  supersede(data, 'outage', o.outage_id, seq, ctx.virtual_now);
  const place = o.premise_ids.map(id => getPremise(data, id)).find(x => served(data, x.premise_id));
  if (place) {
    const etr = o.versions.at(-1).etr, z = zoneOf(data, place.premise_id), when = t => render(Date.parse(t), z).slice(11, 16);
    const body = p.status === 'restored' ? `${o.service_type} service at ${place.address} is restored.`
      : `${o.service_type} outage at ${place.address}${o.cause ? ' (' + o.cause + ')' : ''}. ` + (etr ? `Estimated restoration ${localDate(etr, z)} ${when(etr)}.` : 'No restoration estimate yet.');
    notify(ctx, data, {type: 'outage', source: {kind: 'outage', id: o.outage_id, version: seq}, premiseId: place.premise_id,
      title: p.status === 'restored' ? 'Service restored' : p.status === 'started' ? 'Outage at your address' : 'Outage update', body});
  }
  return data;
}

function advisoryPublished(ctx, data, p) {
  let a = data.advisories.find(x => x.advisory_id === p.advisory_id);
  if (Date.parse(p.issued_at || ctx.virtual_now) > Date.parse(ctx.virtual_now)) fail('invalid_event', 'issued_at is later than the event time.');
  for (const id of p.areas || []) if (!data.areas.some(x => x.area_id === id)) fail('invalid_event', 'Unknown area ' + id + '.');
  for (const id of p.premise_ids || []) if (!data.premises.some(x => x.premise_id === id)) fail('invalid_event', 'Unknown premise ' + id + '.');
  if (p.msg_type === 'issue') {
    if (a) fail('stale_advisory_version', 'This advisory already exists; send an update.');
    if (p.version !== 1) fail('stale_advisory_version', 'A new advisory starts at version 1.');
    if (!p.kind || !p.effective_from || !p.instructions) fail('invalid_event', 'A new advisory needs kind, effective_from and instructions.');
    a = {advisory_id: p.advisory_id, versions: []};
    data.advisories.push(a);
  } else {
    if (!a) fail('advisory_reference_unknown', 'The advisory being updated or lifted does not exist.');
    const latest = a.versions.at(-1);
    if (latest.msg_type === 'lift') fail('stale_advisory_version', 'The advisory is already lifted.');
    if (p.version <= latest.version) fail('stale_advisory_version', 'The version must be greater than ' + latest.version + '.');
    if (p.references && !p.references.some(r => r.advisory_id === a.advisory_id && r.version === latest.version)) fail('advisory_reference_unknown', 'References must name the latest version.');
    if (p.kind && p.kind !== latest.kind) fail('invalid_event', 'An update cannot change the advisory kind; issue a new advisory.');
  }
  // Fields an update or lift leaves out carry over from the previous version.
  const prev = a.versions.at(-1);
  const v = {version: p.version, msg_type: p.msg_type, kind: p.kind || prev.kind, area_ids: p.areas || (prev ? [...prev.area_ids] : []),
    premise_ids: p.premise_ids || (prev ? [...prev.premise_ids] : []), effective_from: p.effective_from || prev.effective_from,
    planned_end: p.planned_end || (prev ? prev.planned_end : null), instructions: p.instructions || (p.msg_type === 'lift' ? 'The advisory is lifted.' : prev.instructions),
    issued_at: p.issued_at ? render(Date.parse(p.issued_at), data.preferences.time_zone) : stamp(ctx, data)};
  if (!v.area_ids.length && !v.premise_ids.length) fail('invalid_event', 'An advisory covers at least one area or premise.');
  a.versions.push(v);
  supersede(data, 'advisory', a.advisory_id, v.version, ctx.virtual_now);
  // Notice for the first served premise this version covers; failing that, one an earlier version covered
  // (so a lift, or an update that drops the premise, reaches everyone told before).
  const servedIds = data.premises.filter(x => served(data, x.premise_id));
  const current = servedIds.find(x => covers(data, v, x.premise_id));
  const place = current || servedIds.find(x => a.versions.some(w => covers(data, w, x.premise_id)));
  if (place) {
    const z = zoneOf(data, place.premise_id), health = HEALTH_ADVISORIES.includes(v.kind);
    const label = {boil_water: 'Boil-water advisory', do_not_drink: 'Do-not-drink advisory', planned_shutoff: 'Planned water shutoff'}[v.kind];
    const from = render(Date.parse(v.effective_from), z), dropped = !current && v.msg_type === 'update';
    const title = `${label}${v.msg_type === 'lift' ? ' lifted' : dropped ? ' no longer covers' : v.msg_type === 'update' ? ' updated' : ''} for ${place.address}`
      .replace(' no longer covers for ', ' no longer covers ');
    const body = v.msg_type === 'lift' ? `The ${label.toLowerCase()} for ${place.address} is lifted. ${v.instructions}`
      : dropped ? `The ${label.toLowerCase()} no longer covers your service address ${place.address}. ${v.instructions}`
      : `${v.msg_type === 'update' ? 'Updated: a' : 'A'} ${label.toLowerCase()} is in effect for your service address ${place.address} from ${from.slice(0, 10)} ${from.slice(11, 16)}` +
        `${v.planned_end ? ' until ' + render(Date.parse(v.planned_end), z).slice(0, 16).replace('T', ' ') : ' until further notice'}. ${v.instructions}` +
        (v.msg_type === 'issue' ? ' You will be notified when it is lifted.' : '');
    notify(ctx, data, {type: 'advisory', source: {kind: 'advisory', id: a.advisory_id, version: v.version}, premiseId: place.premise_id, title, body, health});
  }
  return data;
}

function cycleClosed(ctx, data, p) {
  const bill = closeCycle(data, p, stamp(ctx, data));
  notify(ctx, data, {type: 'billing', source: {kind: 'bill', id: bill.bill_id, version: 1}, premiseId: bill.premise_id, account: true,
    title: `Your bill ${bill.bill_id} is ready`, body: `Bill ${bill.bill_id} for ${getPremise(data, bill.premise_id).address}, ${bill.period.from} to ${bill.period.to}: ` +
      `${money(bill.total_cents)}, due ${bill.due_date}.` + (data.autopay.payment_method_id && bill.total_cents > 0 ? ' Autopay will pay it on the due date.' : '')});
  return data;
}

function paymentSettled(ctx, data, p) {
  let pay;
  if (p.payment_id) {
    pay = data.payments.find(x => x.payment_id === p.payment_id);
    if (!pay) fail('invalid_event', 'Unknown payment.');
  } else if (p.selector && p.selector.oldest_pending) {
    const pending = data.payments.filter(x => x.status === 'pending').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    if (!pending.length) moot('No payment is pending.');
    pay = pending[0];
  } else fail('invalid_event', 'Give payment_id or {oldest_pending: true}.');
  if (pay.status === 'scheduled') fail('invalid_transition', 'A scheduled payment cannot settle before its date.');
  if (pay.status !== 'pending') moot(`Payment ${pay.payment_id} is already ${pay.status}.`);
  const at = stamp(ctx, data);
  // A payment method seeded with `fails` always comes back returned.
  const outcome = data.customer.payment_methods.find(m => m.payment_method_id === pay.payment_method_id)?.fails ? 'returned' : p.outcome;
  pay.status = outcome; pay.resolved_at = at;
  if (outcome === 'returned') charge(data, accountPremise(data), 'returned_payment', `Returned payment ${pay.payment_id}`, FEES.returned_payment, at, pay.payment_id);
  notify(ctx, data, {type: 'billing', source: {kind: 'payment', id: pay.payment_id, version: 2},
    title: outcome === 'settled' ? 'Payment settled' : 'Payment returned',
    body: outcome === 'settled' ? `Your payment of ${money(pay.amount_cents)} has settled.`
      : `Your payment of ${money(pay.amount_cents)} was returned by the bank. It does not count, and a ${money(FEES.returned_payment)} fee will appear on your next bill.`});
  return data;
}

// Generated by Infra from the Messaging result for one notification.
function deliveryRecorded(ctx, data, p) {
  const n = data.notifications.find(x => x.notification_id === p.notification_id);
  if (!n) fail('notification_not_found', 'Notification does not exist.');
  if (n.status !== 'pending_delivery') fail('notification_not_pending', 'Notification is not waiting for delivery.');
  const stop = p.stop_run === true;
  n.outcome = {status: p.status, code: p.code, stop_run: stop, router_event_id: p.router_event_id, recorded_at: stamp(ctx, data)};
  if (p.status === 'committed') n.status = 'delivered';
  else if (p.status === 'rejected' && !stop && p.code !== 'idempotency_conflict') n.status = 'delivery_failed';
  // Otherwise (halting, unknown or idempotency_conflict) it stays pending_delivery for reconciliation.
  return data;
}

const HANDLERS = {
  'field.technician_update': technicianUpdate,
  'field.activation_result': activationResult,
  'logistics.shipment_update': shipmentUpdate,
  'grid.outage_updated': outageUpdated,
  'water.advisory_published': advisoryPublished,
  'billing.cycle_closed': cycleClosed,
  'payment.settled': paymentSettled,
  'notification.delivery_recorded': deliveryRecorded
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  checkDates(event.payload, 'invalid_event');
  materialize(data, ctx.virtual_now);
  const before = copy(data);
  try {
    handler(ctx, data, copy(event.payload));
  } catch (error) {
    if (!(error instanceof Moot)) throw error;
    // Discard any partial change, keep the derived statuses, and record why the event did nothing.
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, before);
    data.ignored_events.push({event_id: event.event_id, at: stamp(ctx, data), operation: event.operation, reason: error.reason.slice(0, 200)});
  }
  log(ctx, 'homegrid.event_applied', {operation: event.operation, event_id: event.event_id});
  return data;
}

module.exports = {applyEvent};
