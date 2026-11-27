'use strict';
const {fail, references: ownerReferences} = require('./domain-utils.cjs');
const {validZone} = require('./time.cjs');
const {PLANS, TYPES} = require('./catalog.cjs');
const {notificationId} = require('./common.cjs');

const unique = (list, key, what) => {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item[key])) fail('invalid_seed', 'Duplicate ' + what + ' ID ' + item[key] + '.');
    seen.add(item[key]);
  }
  return seen;
};
const notAfter = (value, now, what) => {
  if (value && Date.parse(value) > Date.parse(now)) fail('invalid_seed', what + ' is dated after the current virtual time.');
};
const known = (set, id, what) => { if (!set.has(id)) fail('invalid_seed', 'Unknown ' + what + ' ' + id + '.'); };

// Called by Core at load, after each write and during each event (with ctx.virtual_now set to the event time).
// Created, transition and received times must not be later than the virtual time; planned dates may be.
function validateSeed(ctx, data) {
  ownerReferences(ctx, data);
  const now = ctx.virtual_now;
  if (!validZone(data.preferences.time_zone)) fail('invalid_seed', 'Unknown account time zone.');
  for (const t of TYPES) if (!data.preferences.types[t]) fail('invalid_seed', 'Missing preference for ' + t + '.');
  const areas = unique(data.areas, 'area_id', 'area');
  for (const a of data.areas) if (!validZone(a.time_zone)) fail('invalid_seed', 'Unknown area time zone.');
  const premises = unique(data.premises, 'premise_id', 'premise');
  for (const p of data.premises) {
    known(areas, p.area_id, 'area');
    if (p.external_ref) {
      const r = p.external_ref;
      // Checked like Mail's event_ref: the account and object must appear in the run binding.
      if (!ctx.binding.accounts.some(a => a.app_id === r.app_id && a.account_id === r.account_id) ||
          !ctx.binding.objects?.[r.app_id]?.includes(r.object_id)) fail('invalid_seed', 'Cross-App reference is not in the task binding.');
    }
  }
  for (const c of data.capacity) known(areas, c.area_id, 'area');
  for (const s of data.stock) known(areas, s.area_id, 'area');
  unique(data.customer.payment_methods, 'payment_method_id', 'payment method');
  for (const t of data.customer.late_payments) notAfter(t, now, 'Late payment');
  unique(data.services, 'service_id', 'service');
  for (const s of data.services) {
    known(premises, s.premise_id, 'premise');
    const plan = PLANS.find(p => p.plan_id === s.plan_id);
    if (!plan || plan.service_type !== s.service_type) fail('invalid_seed', 'Service ' + s.service_id + ' has a plan of another type.');
    if (s.service_id !== `sv-${s.premise_id}-${s.service_type}`) fail('invalid_seed', 'Service IDs are sv-<premise_id>-<type>.');
    notAfter(s.activated_at, now, 'Activation'); if (s.last_test) notAfter(s.last_test.at, now, 'Connection test');
  }
  const orders = unique(data.orders, 'order_id', 'order');
  for (const o of data.orders) {
    known(premises, o.premise_id, 'premise'); notAfter(o.created_at, now, 'Order');
    for (const h of o.history) notAfter(h.at, now, 'Order history');
    if (o.type === 'temporary_internet' && (!o.temp || o.temp.to < o.temp.from)) fail('invalid_seed', 'A loan needs a date range.');
  }
  unique(data.appointments, 'appointment_id', 'appointment');
  for (const a of data.appointments) {
    known(orders, a.order_id, 'order');
    for (const h of a.history) notAfter(h.at, now, 'Appointment history');
  }
  unique(data.equipment, 'equipment_id', 'equipment');
  for (const e of data.equipment) {
    known(premises, e.premise_id, 'premise'); if (e.order_id) known(orders, e.order_id, 'order');
    notAfter(e.returned_at, now, 'Equipment return');
    if ((e.status === 'returned') !== Boolean(e.returned_at)) fail('invalid_seed', 'Returned equipment needs returned_at, and only it.');
  }
  const outages = unique(data.outages, 'outage_id', 'outage');
  for (const o of data.outages) {
    o.premise_ids.forEach(id => known(premises, id, 'premise'));
    o.versions.forEach((v, i) => {
      if (v.seq !== i + 1 || (i === 0) !== (v.status === 'started') || (i > 0 && o.versions[i - 1].status === 'restored')) fail('invalid_seed', 'Outage versions run started, updates, restored.');
      if (i > 0 && Date.parse(v.at) < Date.parse(o.versions[i - 1].at)) fail('invalid_seed', 'Outage versions must be in time order.');
      notAfter(v.at, now, 'Outage version');
    });
  }
  unique(data.advisories, 'advisory_id', 'advisory');
  for (const a of data.advisories) {
    a.versions.forEach((v, i) => {
      if (i === 0 ? v.version !== 1 : v.version <= a.versions[i - 1].version) fail('invalid_seed', 'Advisory versions start at 1 and increase.');
      if ((i === 0) !== (v.msg_type === 'issue') || (i > 0 && a.versions[i - 1].msg_type === 'lift') || (i > 0 && v.kind !== a.versions[0].kind)) {
        fail('invalid_seed', 'Advisory chains run issue, updates, lift, with one kind.');
      }
      v.area_ids.forEach(id => known(areas, id, 'area')); v.premise_ids.forEach(id => known(premises, id, 'premise'));
      notAfter(v.issued_at, now, 'Advisory version');
    });
  }
  unique(data.reports, 'report_id', 'report');
  for (const r of data.reports) { known(premises, r.premise_id, 'premise'); if (r.outage_id) known(outages, r.outage_id, 'outage'); notAfter(r.created_at, now, 'Report'); }
  const bills = unique(data.bills, 'bill_id', 'bill');
  for (const b of data.bills) {
    known(premises, b.premise_id, 'premise'); notAfter(b.closed_at, now, 'Bill');
    if (b.total_cents !== b.lines.reduce((s, l) => s + l.amount_cents, 0)) fail('invalid_seed', 'Bill ' + b.bill_id + ' total does not match its lines.');
  }
  unique(data.charges, 'charge_id', 'charge');
  for (const c of data.charges) { known(premises, c.premise_id, 'premise'); if (c.billed_in) known(bills, c.billed_in, 'bill'); notAfter(c.created_at, now, 'Charge'); }
  const methods = new Set(data.customer.payment_methods.map(m => m.payment_method_id));
  unique(data.payments, 'payment_id', 'payment');
  for (const p of data.payments) {
    known(methods, p.payment_method_id, 'payment method'); if (p.autopay_bill_id) known(bills, p.autopay_bill_id, 'bill');
    notAfter(p.created_at, now, 'Payment'); notAfter(p.resolved_at, now, 'Payment result');
  }
  if (data.autopay.payment_method_id) known(methods, data.autopay.payment_method_id, 'payment method');
  unique(data.arrangements, 'arrangement_id', 'arrangement');
  for (const a of data.arrangements) { known(bills, a.bill_id, 'bill'); notAfter(a.created_at, now, 'Arrangement'); }
  unique(data.notifications, 'notification_id', 'notification');
  for (const n of data.notifications) {
    notAfter(n.created_at, now, 'Notification');
    if (n.acknowledged_at) notAfter(n.acknowledged_at, now, 'Acknowledgement');
    if (n.outcome) notAfter(n.outcome.recorded_at, now, 'Delivery outcome');
    if (n.notification_id !== notificationId(n.trigger_key)) fail('invalid_seed', 'Notification ID must derive from its trigger key.');
    if (n.recipient_person_id !== data.owner_person_id) fail('invalid_seed', 'Notifications go to the account owner.');
  }
  for (const e of data.ignored_events) notAfter(e.at, now, 'Ignored event');
}

// Business records the account owns or the task loaded, and their IDs (the same set, as Core expects).
const KINDS = [['premises', 'premise_id'], ['services', 'service_id'], ['orders', 'order_id'], ['appointments', 'appointment_id'],
  ['equipment', 'equipment_id'], ['outages', 'outage_id'], ['advisories', 'advisory_id'], ['reports', 'report_id'], ['bills', 'bill_id'],
  ['payments', 'payment_id'], ['arrangements', 'arrangement_id'], ['notifications', 'notification_id']];
module.exports = {
  validateSeed,
  records: data => KINDS.flatMap(([list]) => data[list]),
  objects: data => KINDS.flatMap(([list, key]) => data[list].map(x => x[key])),
  references: data => data.premises.filter(p => p.external_ref).map(p => p.external_ref)
};
