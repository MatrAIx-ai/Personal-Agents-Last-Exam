'use strict';
// Agent writes. They run on Core's copy after materialize(), so time-based statuses are already stored.
const {fail, copy, nextId, stamp, money, addDays, localDate, zoneOf} = require('./common.cjs');
const {validZone} = require('./time.cjs');
const {POLICY, TYPES} = require('./catalog.cjs');
const {allocate, billStatus} = require('./billing.cjs');
const {notify} = require('./notify.cjs');
const orders = require('./orders.cjs');
const field = require('./field.cjs');

const method = (data, id) => {
  const m = data.customer.payment_methods.find(x => x.payment_method_id === id);
  if (!m) fail('payment_method_not_found', 'Payment method is not on the account.');
  return m;
};

function arrangement(ctx, data, billId, count) {
  const b = data.bills.find(x => x.bill_id === billId);
  if (!b) fail('bill_not_found', 'Bill does not exist.');
  if (!Number.isInteger(count) || count < 2 || count > 6) fail('invalid_installments', 'A plan has 2 to 6 installments.');
  const now = ctx.virtual_now, unpaid = b.total_cents - allocate(data)[b.bill_id];
  if (billStatus(data, b, now) !== 'past_due' || unpaid < POLICY.arrangement_min_cents) fail('arrangement_not_eligible', 'A plan needs a past-due balance of at least $50.00.');
  if (data.arrangements.some(a => Date.parse(now) - Date.parse(a.created_at) <= POLICY.arrangement_lookback_days * 86400e3)) {
    fail('arrangement_not_eligible', 'The account had a payment plan in the past 12 months.');
  }
  // Even split rounded down to the cent; the last installment takes the remainder.
  const each = Math.floor(unpaid / count), today = localDate(now, zoneOf(data, b.premise_id));
  const installments = Array.from({length: count}, (_, i) => ({
    due_date: addDays(today, POLICY.arrangement_first_due_days + i * POLICY.arrangement_interval_days),
    amount_cents: i === count - 1 ? unpaid - each * (count - 1) : each}));
  const a = {arrangement_id: nextId(data.arrangements, 'arrangement_id', 'ar'), bill_id: b.bill_id, created_at: stamp(ctx, data), installments};
  data.arrangements.push(a);
  notify(ctx, data, {type: 'billing', source: {kind: 'arrangement', id: a.arrangement_id, version: 1}, premiseId: b.premise_id, account: true,
    title: 'Payment plan approved', body: `Your ${money(unpaid)} balance on ${b.bill_id} is split into ${count} installments: ` +
      installments.map(i => `${money(i.amount_cents)} due ${i.due_date}`).join(', ') + '.'});
  return {arrangement_id: a.arrangement_id, installments: copy(installments)};
}

function preferences(data, args) {
  const {expected_version, request_id, ...changes} = args;
  if (!Object.keys(changes).length) fail('invalid_preferences', 'Nothing to change.');
  if (changes.time_zone !== undefined && !validZone(changes.time_zone)) fail('invalid_preferences', 'Unknown time zone.');
  if (changes.quiet_hours && changes.quiet_hours.start === changes.quiet_hours.end) fail('invalid_preferences', 'Quiet hours must not be empty.');
  const p = data.preferences;
  if (changes.time_zone !== undefined) p.time_zone = changes.time_zone;
  if (changes.quiet_hours !== undefined) p.quiet_hours = changes.quiet_hours;
  for (const [type, value] of Object.entries(changes.types || {})) if (TYPES.includes(type)) p.types[type] = value;
  if (changes.health) Object.assign(p.health, changes.health);
  return {preferences: copy(p)};
}

function write(ctx, data, name, args) {
  switch (name) {
    case 'homegrid.orders.create': return orders.create(ctx, data, args.order_token);
    case 'homegrid.orders.reschedule': return orders.reschedule(ctx, data, args.order_id, args.date);
    case 'homegrid.orders.cancel': return orders.cancel(ctx, data, args.order_id);
    case 'homegrid.appointments.book': return field.book(ctx, data, args.order_id, args.date, args.slot);
    case 'homegrid.appointments.reschedule': return field.reschedule(ctx, data, args.appointment_id, args.date, args.slot);
    case 'homegrid.appointments.cancel': return field.cancel(ctx, data, args.appointment_id);
    case 'homegrid.connection.run_test': return field.runTest(ctx, data, args.service_id);
    case 'homegrid.equipment.schedule_return': return field.scheduleReturn(ctx, data, args.equipment_id, args.method);
    case 'homegrid.outages.report': return field.report(ctx, data, args.premise_id, args.service_type, args.note);
    case 'homegrid.payments.make': {
      if (!Number.isInteger(args.amount_cents) || args.amount_cents < 1) fail('invalid_amount', 'Amounts are positive integer cents.');
      method(data, args.payment_method_id);
      const p = {payment_id: nextId(data.payments, 'payment_id', 'py-' + data.account_id), amount_cents: args.amount_cents,
        payment_method_id: args.payment_method_id, created_at: stamp(ctx, data), scheduled_for: null, autopay_bill_id: null, status: 'pending', resolved_at: null};
      data.payments.push(p);
      notify(ctx, data, {type: 'billing', source: {kind: 'payment', id: p.payment_id, version: 1}, title: 'Payment received',
        body: `Your payment of ${money(p.amount_cents)} is pending and will count once it settles.`});
      return {payment_id: p.payment_id};
    }
    case 'homegrid.autopay.set': {
      if (args.payment_method_id !== null) method(data, args.payment_method_id);
      data.autopay.payment_method_id = args.payment_method_id;
      // Turning autopay off cancels every autopay payment not yet pending.
      if (args.payment_method_id === null) {
        for (const p of data.payments.filter(x => x.autopay_bill_id && x.status === 'scheduled')) { p.status = 'cancelled'; p.resolved_at = stamp(ctx, data); }
      } else {
        for (const p of data.payments.filter(x => x.autopay_bill_id && x.status === 'scheduled')) p.payment_method_id = args.payment_method_id;
      }
      return {payment_method_id: args.payment_method_id};
    }
    case 'homegrid.arrangements.request': return arrangement(ctx, data, args.bill_id, args.installments);
    case 'homegrid.preferences.update': return preferences(data, args);
    case 'homegrid.notifications.acknowledge': {
      const n = data.notifications.find(x => x.notification_id === args.notification_id);
      if (!n) fail('notification_not_found', 'Notification does not exist.');
      if (!n.acknowledged_at) n.acknowledged_at = stamp(ctx, data);
      return {notification_id: n.notification_id, acknowledged_at: n.acknowledged_at};
    }
    default: fail('unknown_tool', 'Unknown tool.');
  }
}

module.exports = {write};
