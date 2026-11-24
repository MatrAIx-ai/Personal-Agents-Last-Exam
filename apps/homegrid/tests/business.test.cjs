'use strict';
// Business tests for the approved Homegrid workflows (proposal §2 core examples, rules and error paths).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {ev, T, NET, APPT1, APPT2, LOAN, LINDEN, transfer, journey, february} = require('./helpers.cjs');
const {TARIFFS} = require('../src/catalog.cjs');
const {addBusinessDays} = require('../src/common.cjs');
const {quietRelease, render} = require('../src/time.cjs');
const {message} = require('../src/publisher.cjs');

const fails = (f, fn, code, text) => {
  const before = f.data;
  assert.throws(fn, e => e.code === code && (!text || e.message.includes(text)), code);
  assert.deepEqual(f.data, before, 'no partial effect');
};
const notes = (f, args = {}) => f.call('homegrid.notifications.list', args).notifications;
const note = (f, id) => notes(f).find(n => n.notification_id === id);
const bill = (f, id) => f.call('homegrid.bills.get', {bill_id: id}).bill;
const withSeed = change => { const seed = structuredClone(require('../fixtures/minimal.json')); change(seed); return fixture({seed}); };

test('generated contracts and fixtures match their generators', () => {
  require('../scripts/build-contracts.cjs').build({check: true});
  require('../scripts/generate-fixtures.cjs').build({check: true});
});

test('Mail wire schema copy is byte-identical to the receiver-owned schema', {skip: !fs.existsSync(path.resolve(__dirname, '../../../examples/apps/mail'))}, () => {
  const ours = fs.readFileSync(path.resolve(__dirname, '../schemas/mail-router-message.schema.json'));
  const mail = fs.readFileSync(path.resolve(__dirname, '../../../examples/apps/mail/schemas/router-message.schema.json'));
  assert.ok(ours.equals(mail));
});

// ---- Workflow 1: account, services and plans ----
test('W1 plans.list gives the fiber tiers at Linden and not_serviceable where there is no internet', () => {
  const f = fixture();
  assert.deepEqual(f.call('homegrid.plans.list', {premise_id: 'pr-linden-14', service_type: 'internet'}).plans.map(p => [p.plan_id, p.monthly_cents]),
    [['net-fiber-300', 6000], ['net-fiber-1000', 8000]]);
  assert.equal(f.call('homegrid.plans.list', {premise_id: 'pr-linden-14', service_type: 'electricity'}).plans[0].tariff.per_unit_cents, 18);
  fails(f, () => f.call('homegrid.plans.list', {premise_id: 'pr-quarry-8', service_type: 'internet'}), 'not_serviceable');
  fails(f, () => f.call('homegrid.plans.list', {premise_id: 'pr-nowhere', service_type: 'water'}), 'premise_not_found');
});

test('W1 account, premise search and services carry as_of and masked payment methods', () => {
  const f = fixture();
  const a = f.call('homegrid.account.get');
  assert.equal(a.as_of, '2027-01-12T10:00:00-05:00');
  assert.deepEqual(a.account.payment_methods[0], {payment_method_id: 'pm-visa', label: 'Visa', last4: '4242'});
  assert.deepEqual(f.call('homegrid.premises.search', {query: 'linden'}).premises.map(p => p.premise_id), ['pr-linden-14']);
  assert.deepEqual(f.call('homegrid.services.list', {premise_id: 'pr-maple-22'}).services.map(s => s.status), ['active', 'active', 'active']);
});

// ---- Workflow 2: start, stop and transfer ----
test('W2 core example: transfer preview with lead times, holiday, full windows, gap and overlap', () => {
  const f = fixture();
  const p = transfer(f);
  const start = t => p.parts.find(x => x.type === 'start' && x.service_type === t);
  assert.equal(start('electricity').earliest, '2027-01-14');
  assert.equal(start('electricity').date, '2027-01-15');
  assert.deepEqual(start('internet').earliest_window, {date: '2027-01-19', slot: '08-12', free: 2});
  assert.equal(start('internet').needs, 'technician');
  assert.deepEqual(p.warnings, {electricity: {overlap_days: 1}, water: {overlap_days: 1}, internet: {service_gap_days: 3}});
  assert.equal(p.deposit_cents, 0);
  assert.equal(p.parts.filter(x => x.type === 'stop').length, 3);
  const r = f.call('homegrid.orders.create', {order_token: p.order_token});
  assert.deepEqual(r.order_ids, ['or-pr-maple-22-electricity-1', 'or-pr-maple-22-water-1', 'or-pr-maple-22-internet-1',
    'or-pr-linden-14-electricity-1', 'or-pr-linden-14-water-1', NET]);
  assert.ok(f.call('homegrid.orders.list', {status: 'scheduled'}).orders.length === 6);
  assert.equal(note(f, 'n-tr-1-0-sam').type, 'order');
  assert.match(note(f, 'n-tr-1-0-sam').body, /internet: 3-day gap/);
});

test('W2 lead time, expired and altered tokens, stale tokens', () => {
  const f = fixture();
  fails(f, () => f.call('homegrid.orders.preview', {type: 'start', premise_id: 'pr-linden-14', service_type: 'electricity', date: '2027-01-13'}), 'lead_time_not_met', '2027-01-14');
  fails(f, () => f.call('homegrid.orders.preview', {type: 'start', premise_id: 'pr-linden-14', service_type: 'electricity', date: '2027-01-16'}), 'invalid_date');
  const p = transfer(f);
  const raw = JSON.parse(Buffer.from(p.order_token, 'base64url').toString());
  raw.req.stop_date = '2027-01-22';
  fails(f, () => f.call('homegrid.orders.create', {order_token: Buffer.from(JSON.stringify(raw)).toString('base64url')}), 'invalid_order_token');
  fails(f, () => f.call('homegrid.orders.create', {order_token: 'not-a-token'}), 'invalid_order_token');
  f.advance(T('01-12', '10:31'));
  fails(f, () => f.call('homegrid.orders.create', {order_token: p.order_token}), 'order_token_expired');
  // Stock taken by another order between preview and create.
  const loan = () => f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-maple-22', from: '2027-01-13', to: '2027-01-14'});
  const a = loan(), b = loan();
  f.call('homegrid.orders.create', {order_token: a.order_token});
  fails(f, () => f.call('homegrid.orders.create', {order_token: b.order_token}), 'order_token_stale');
});

test('W2 reschedule and cancel orders; effective orders cannot change', () => {
  const f = fixture();
  journey(f, 'ordered');
  fails(f, () => f.call('homegrid.orders.reschedule', {order_id: 'or-pr-linden-14-water-1', date: '2027-01-13'}), 'lead_time_not_met');
  assert.equal(f.call('homegrid.orders.reschedule', {order_id: 'or-pr-linden-14-water-1', date: '2027-01-14'}).date, '2027-01-14');
  fails(f, () => f.call('homegrid.orders.reschedule', {order_id: NET, date: '2027-01-20'}), 'invalid_date');
  f.advance(T('01-16', '09:00'));
  const services = f.call('homegrid.services.list').services;
  assert.equal(services.find(s => s.service_id === 'sv-pr-linden-14-water').status, 'active');
  assert.equal(services.find(s => s.service_id === 'sv-pr-maple-22-water').status, 'stopped');
  fails(f, () => f.call('homegrid.orders.cancel', {order_id: 'or-pr-linden-14-water-1'}), 'order_already_effective');
  fails(f, () => f.call('homegrid.orders.cancel', {order_id: 'or-x'}), 'order_not_found');
  // A same-day stop leaves the old service active through its last day.
  const g = fixture();
  journey(g, 'ordered');
  g.advance(T('01-15', '23:00'));
  assert.equal(g.call('homegrid.services.list', {premise_id: 'pr-maple-22'}).services[0].status, 'pending_stop');
});

test('W2 derived effective dates are stored on the next write with the time they fell due', () => {
  const f = fixture();
  journey(f, 'ordered');
  f.advance(T('01-15', '10:00'));
  assert.equal(f.data.orders.find(o => o.order_id === 'or-pr-linden-14-water-1').status, 'scheduled', 'reads do not store derived state');
  f.call('homegrid.notifications.acknowledge', {notification_id: 'n-tr-1-0-sam'});
  const o = f.data.orders.find(x => x.order_id === 'or-pr-linden-14-water-1');
  assert.equal(o.status, 'effective');
  assert.deepEqual(o.history.at(-1), {at: '2027-01-15T00:00:00-05:00', action: 'effective'});
});

test('W2 a stop preview needs its date; a change exactly 24 h before the window is inside the fee window', () => {
  const f = fixture();
  fails(f, () => f.call('homegrid.orders.preview', {type: 'stop', service_id: 'sv-pr-maple-22-water'}), 'invalid_date');
  journey(f, 'booked');
  f.advance(T('01-18', '08:00'));
  assert.equal(f.call('homegrid.appointments.reschedule', {appointment_id: APPT1, date: '2027-01-19', slot: '12-16'}).fee_cents, 2500);
  const g = fixture();
  journey(g, 'booked');
  g.advance(T('01-18', '07:59'));
  assert.equal(g.call('homegrid.appointments.reschedule', {appointment_id: APPT1, date: '2027-01-19', slot: '12-16'}).fee_cents, 0);
});

test('W2 deposit once per new premise with 2 late payments in 12 months', () => {
  const f = withSeed(s => { s.customer.late_payments = ['2026-03-01T10:00:00-05:00', '2026-09-01T10:00:00-04:00']; });
  assert.equal(transfer(f).deposit_cents, 15000);
  f.call('homegrid.orders.create', {order_token: transfer(f).order_token});
  assert.equal(f.data.charges.find(c => c.kind === 'deposit').amount_cents, 15000);
  const g = withSeed(s => { s.customer.late_payments = ['2025-12-01T10:00:00-05:00', '2026-09-01T10:00:00-04:00']; });
  assert.equal(transfer(g).deposit_cents, 0, 'one late payment is older than 12 months');
});

test('W2 temporary internet: price per started week, no_stock with the earliest free date', () => {
  const f = fixture();
  const quote = (from, to) => f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-maple-22', from, to});
  assert.equal(quote('2027-01-13', '2027-01-20').price_cents, 1000, 'Jan 13-20 is one 7-day period');
  assert.equal(quote('2027-01-13', '2027-01-21').price_cents, 2000, 'a started second period');
  const p = quote('2027-01-13', '2027-01-20');
  assert.equal(p.expires_at, '2027-01-12T10:30:00-05:00');
  f.call('homegrid.orders.create', {order_token: p.order_token});
  assert.equal(f.data.equipment.find(e => e.kind === 'hotspot').return_due, '2027-01-27');
  fails(f, () => f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-maple-22', from: '2027-01-14', to: '2027-01-15'}), 'no_stock', '2027-01-28');
  fails(f, () => f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-maple-22', from: '2027-01-13', to: '2027-02-20'}), 'invalid_date');
});

// ---- Workflow 3: appointments, activation and equipment ----
test('W3 core example: reschedule is free 49 h before the window and costs $25.00 22 h before', () => {
  const f = fixture();
  journey(f, 'booked');
  f.advance(T('01-17', '07:00'));
  assert.equal(f.call('homegrid.appointments.reschedule', {appointment_id: APPT1, date: '2027-01-19', slot: '12-16'}).fee_cents, 0);
  const g = fixture();
  journey(g, 'booked');
  g.advance(T('01-18', '10:00'));
  assert.deepEqual(g.call('homegrid.appointments.reschedule', {appointment_id: APPT1, date: '2027-01-19', slot: '12-16'}), {appointment_id: APPT1, fee_cents: 2500});
  assert.match(note(g, 'n-' + APPT1 + '-2-sam').body, /\$25\.00 late-change fee/);
});

test('W3 the late-change fee appears on the next bill', () => {
  const f = fixture();
  journey(f, 'booked');
  f.advance(T('01-18', '10:00'));
  f.call('homegrid.appointments.cancel', {appointment_id: APPT1});
  fails(f, () => f.call('homegrid.appointments.cancel', {appointment_id: APPT1}), 'appointment_closed');
  f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-20', slot: '08-12'});
  f.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-0131', period: {from: '2027-01-15', to: '2027-01-31'},
    usage: {'sv-pr-linden-14-electricity': {kwh: 412}, 'sv-pr-linden-14-water': {gal: 2950}}}));
  assert.deepEqual(bill(f, 'bl-0131').lines.filter(l => l.kind === 'late_reschedule').map(l => l.amount_cents), [2500]);
});

test('W3 booking rules: windows, capacity, lead time and orders that need no appointment', () => {
  const f = fixture();
  journey(f, 'ordered');
  fails(f, () => f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-15', slot: '08-12'}), 'window_full');
  fails(f, () => f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-18', slot: '08-12'}), 'invalid_date');
  fails(f, () => f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-14', slot: '08-12'}), 'lead_time_not_met');
  fails(f, () => f.call('homegrid.appointments.book', {order_id: 'or-pr-linden-14-water-1', date: '2027-01-19', slot: '08-12'}), 'no_appointment_needed');
  const slots = f.call('homegrid.appointments.slots', {premise_id: 'pr-linden-14', from: '2027-01-15', to: '2027-01-19', order_id: NET});
  assert.deepEqual(slots.slots.filter(s => s.free > 0).map(s => s.date + ' ' + s.slot), ['2027-01-19 08-12', '2027-01-19 12-16', '2027-01-19 16-20']);
  assert.equal(slots.earliest, '2027-01-19');
});

test('W3 core example: provider misses the visit; free hotspot; the order stays open and can be cancelled', () => {
  const f = fixture();
  journey(f, 'missed');
  const d = f.data;
  assert.equal(d.appointments.find(a => a.appointment_id === APPT1).status, 'missed_by_provider');
  assert.equal(d.charges.find(c => c.kind === 'missed_appointment_credit').amount_cents, -2000);
  assert.equal(d.orders.find(o => o.order_id === NET).status, 'scheduled');
  assert.equal(d.services.find(s => s.service_id === 'sv-pr-linden-14-internet').status, 'pending_start');
  f.advance(T('01-19', '12:30'));
  const p = f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-linden-14', from: '2027-01-19', to: '2027-01-26'});
  assert.equal(p.price_cents, 0);
  f.call('homegrid.orders.create', {order_token: p.order_token});
  fails(f, () => f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-linden-14', from: '2027-01-20', to: '2027-01-21'}), 'no_stock', '2027-02-03');
  f.call('homegrid.orders.cancel', {order_id: NET});
  assert.equal(f.data.services.find(s => s.service_id === 'sv-pr-linden-14-internet'), undefined);
});

test('W3 a loan created before the miss becomes free; after activation new loans are charged', () => {
  const f = fixture();
  journey(f, 'booked');
  const p = f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-linden-14', from: '2027-01-15', to: '2027-01-21'});
  assert.equal(p.price_cents, 1000);
  f.call('homegrid.orders.create', {order_token: p.order_token});
  f.event(ev(T('01-19', '12:05'), 'field.technician_update', {selector: LINDEN, status: 'missed_by_provider'}));
  assert.equal(f.data.charges.filter(c => c.kind === 'temporary_internet').length, 0);
  assert.equal(f.data.orders.find(o => o.order_id === LOAN).price_cents, 0);
});

test('W3 core example: completed, activated, connection test passes at 300 Mbps and the loan continues', () => {
  const f = fixture();
  journey(f, 'completed');
  assert.deepEqual(f.call('homegrid.connection.run_test', {service_id: 'sv-pr-linden-14-internet'}).test,
    {at: '2027-01-20T10:40:00-05:00', result: 'fail', speed_mbps: null, reason: 'not_activated', outage_id: null});
  journey(f, 'activated');
  assert.deepEqual(f.call('homegrid.connection.run_test', {service_id: 'sv-pr-linden-14-internet'}).test,
    {at: '2027-01-20T10:55:00-05:00', result: 'pass', speed_mbps: 300, reason: null, outage_id: null});
  assert.equal(f.data.orders.find(o => o.order_id === NET).status, 'effective');
  assert.equal(f.call('homegrid.orders.list', {}).orders.find(o => o.order_id === LOAN).temp.to, '2027-01-26');
  assert.equal(f.data.equipment.find(e => e.equipment_id === 'eq-' + NET).status, 'in_use');
  f.event(ev(T('01-25', '13:00'), 'grid.outage_updated', {outage_id: 'out-77', service: 'internet', status: 'started', premise_ids: ['pr-linden-14'], etr: T('01-25', '18:00')}));
  const t = f.call('homegrid.connection.run_test', {service_id: 'sv-pr-linden-14-internet'}).test;
  assert.deepEqual([t.result, t.reason, t.outage_id], ['fail', 'outage', 'out-77']);
});

test('W3 transitions: completed before arrived is rejected; activation needs a completed visit', () => {
  const f = fixture();
  journey(f, 'booked');
  fails(f, () => f.event(ev(T('01-19', '09:00'), 'field.technician_update', {appointment_id: APPT1, status: 'completed'})), 'invalid_transition');
  fails(f, () => f.event(ev(T('01-19', '09:00'), 'field.activation_result', {service_id: 'sv-pr-linden-14-internet', result: 'activated'})), 'invalid_transition');
  fails(f, () => f.event(ev(T('01-19', '09:00'), 'field.technician_update', {appointment_id: 'ap-nope', status: 'arrived'})), 'invalid_event');
});

test('W3 no_access and failed activation leave the order open for a new window', () => {
  const f = fixture();
  journey(f, 'booked');
  f.event(ev(T('01-19', '08:20'), 'field.technician_update', {appointment_id: APPT1, status: 'technician_en_route'}));
  f.event(ev(T('01-19', '09:00'), 'field.technician_update', {appointment_id: APPT1, status: 'no_access'}));
  assert.equal(f.data.charges.length, 0, 'no credit when nobody was home');
  f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-20', slot: '12-16'});
  f.event(ev(T('01-20', '12:30'), 'field.technician_update', {appointment_id: APPT2, status: 'arrived'}));
  f.event(ev(T('01-20', '14:00'), 'field.technician_update', {appointment_id: APPT2, status: 'completed'}));
  f.event(ev(T('01-20', '14:10'), 'field.activation_result', {service_id: 'sv-pr-linden-14-internet', result: 'failed', reason: 'signal too low'}));
  assert.equal(f.data.services.find(s => s.service_id === 'sv-pr-linden-14-internet').status, 'install_failed');
  fails(f, () => f.event(ev(T('01-20', '14:20'), 'field.activation_result', {service_id: 'sv-pr-linden-14-internet', result: 'activated'})), 'invalid_transition');
  f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-21', slot: '08-12'});
  assert.equal(f.data.services.find(s => s.service_id === 'sv-pr-linden-14-internet').status, 'pending_start');
});

test('W3 self-install: kit shipped and delivered, then activation; equipment_not_delivered before', () => {
  const f = fixture();
  const p = f.call('homegrid.orders.preview', {type: 'start', premise_id: 'pr-birch-3', service_type: 'internet'});
  assert.deepEqual([p.parts[0].needs, p.parts[0].date], ['self_install', '2027-01-14']);
  f.call('homegrid.orders.create', {order_token: p.order_token});
  const kit = 'eq-or-pr-birch-3-internet-1';
  assert.equal(f.call('homegrid.connection.run_test', {service_id: 'sv-pr-birch-3-internet'}).test.reason, 'equipment_not_delivered');
  fails(f, () => f.event(ev(T('01-13', '09:00'), 'field.activation_result', {service_id: 'sv-pr-birch-3-internet', result: 'activated'})), 'invalid_transition');
  f.event(ev(T('01-13', '09:00'), 'logistics.shipment_update', {shipment_id: 'sh-1', selector: {premise_id: 'pr-birch-3', kind: 'gateway'}, status: 'shipped'}));
  f.event(ev(T('01-14', '15:00'), 'logistics.shipment_update', {shipment_id: 'sh-1', equipment_id: kit, status: 'delivered'}));
  f.event(ev(T('01-14', '18:00'), 'field.activation_result', {service_id: 'sv-pr-birch-3-internet', result: 'activated', speed_mbps: 200}));
  assert.equal(f.call('homegrid.connection.run_test', {service_id: 'sv-pr-birch-3-internet'}).test.speed_mbps, 200);
  fails(f, () => f.event(ev(T('01-14', '19:00'), 'logistics.shipment_update', {equipment_id: kit, status: 'shipped'})), 'invalid_transition');
});

test('W3 core example: gateway return before the deadline, already_returned, and the $120.00 fee otherwise', () => {
  const f = fixture();
  journey(f, 'ordered');
  f.advance(T('01-16', '09:00'));
  const gw = f.call('homegrid.equipment.list').equipment.find(e => e.equipment_id === 'eq-gw-maple');
  assert.deepEqual([gw.status, gw.return_due], ['return_due', '2027-02-14']);
  assert.equal(f.call('homegrid.equipment.schedule_return', {equipment_id: 'eq-gw-maple', method: 'prepaid_label'}).return_due, '2027-02-14');
  f.event(ev(T('01-20', '15:00'), 'logistics.shipment_update', {shipment_id: 'sh-gw-maple', equipment_id: 'eq-gw-maple', status: 'returned_received'}));
  assert.equal(f.data.equipment.find(e => e.equipment_id === 'eq-gw-maple').status, 'returned');
  fails(f, () => f.call('homegrid.equipment.schedule_return', {equipment_id: 'eq-gw-maple', method: 'dropoff'}), 'already_returned');
  fails(f, () => f.call('homegrid.equipment.schedule_return', {equipment_id: 'eq-x', method: 'dropoff'}), 'equipment_not_found');
  // Without the return: a Maple bill closing before Feb 14 has no fee; the first one after it does, once.
  const g = fixture();
  journey(g, 'ordered');
  const close = (id, at, from, to) => g.event(ev(at, 'billing.cycle_closed', {bill_id: id, premise_id: 'pr-maple-22', period: {from, to}, usage: {}}));
  close('bl-m-0131', T('01-31', '23:59'), '2027-01-01', '2027-01-31');
  assert.equal(bill(g, 'bl-m-0131').lines.some(l => l.kind === 'unreturned_gateway'), false);
  close('bl-m-0228', T('02-28', '23:59'), '2027-02-01', '2027-02-28');
  assert.deepEqual(bill(g, 'bl-m-0228').lines.filter(l => l.kind === 'unreturned_gateway').map(l => l.amount_cents), [12000]);
  close('bl-m-0331', '2027-03-31T23:59:00-04:00', '2027-03-01', '2027-03-31');
  assert.equal(bill(g, 'bl-m-0331').lines.some(l => l.kind === 'unreturned_gateway'), false);
});

test('W3 a hotspot returned late is charged $150.00', () => {
  const f = fixture();
  const p = f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-maple-22', from: '2027-01-13', to: '2027-01-14'});
  f.call('homegrid.orders.create', {order_token: p.order_token});
  const id = f.data.equipment.find(e => e.kind === 'hotspot').equipment_id;
  f.event(ev(T('01-12', '15:00'), 'logistics.shipment_update', {equipment_id: id, status: 'shipped'}));
  f.event(ev(T('01-13', '11:00'), 'logistics.shipment_update', {equipment_id: id, status: 'delivered'}));
  assert.equal(f.data.equipment.find(e => e.equipment_id === id).status, 'in_use');
  f.advance(T('01-15', '09:00'));
  assert.equal(f.call('homegrid.equipment.list').equipment.find(e => e.equipment_id === id).status, 'return_due');
  f.event(ev(T('01-25', '09:00'), 'logistics.shipment_update', {equipment_id: id, status: 'returned_received'}));
  f.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-m-0131', period: {from: '2027-01-01', to: '2027-01-31'},
    usage: {'sv-pr-maple-22-electricity': {kwh: 300}, 'sv-pr-maple-22-water': {gal: 2000}}}));
  assert.deepEqual(bill(f, 'bl-m-0131').lines.filter(l => l.kind.startsWith('unreturned') || l.kind === 'temporary_internet').map(l => [l.kind, l.amount_cents]),
    [['temporary_internet', 1000], ['unreturned_hotspot', 15000]]);
});

// ---- Workflow 4: outages and advisories ----
test('W4 core example: out-77 of 13.5 h earns no credit; the report links to it', () => {
  const f = fixture();
  journey(f, 'activated');
  f.event(ev(T('01-25', '13:00'), 'grid.outage_updated', {outage_id: 'out-77', service: 'internet', status: 'started', premise_ids: ['pr-linden-14'], etr: T('01-25', '18:00'), cause: 'fiber cut'}));
  assert.deepEqual(f.call('homegrid.outages.report', {premise_id: 'pr-linden-14', service_type: 'internet', note: 'No connection'}),
    {report_id: 'rp-1', report_status: 'linked', outage_id: 'out-77'});
  fails(f, () => f.call('homegrid.outages.report', {premise_id: 'pr-linden-14', service_type: 'internet'}), 'report_already_open');
  f.event(ev(T('01-25', '17:30'), 'grid.outage_updated', {outage_id: 'out-77', status: 'etr_updated', etr: T('01-25', '21:00')}));
  f.event(ev(T('01-26', '02:30'), 'grid.outage_updated', {outage_id: 'out-77', status: 'restored'}));
  const o = f.call('homegrid.outages.list', {premise_id: 'pr-linden-14'}).outages[0];
  assert.deepEqual([o.status, o.versions.map(v => v.etr)], ['restored', [T('01-25', '18:00'), T('01-25', '21:00'), null]]);
  f.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-0131', period: {from: '2027-01-15', to: '2027-01-31'},
    usage: {'sv-pr-linden-14-electricity': {kwh: 412}, 'sv-pr-linden-14-water': {gal: 2950}}}));
  assert.equal(bill(f, 'bl-0131').lines.some(l => l.kind === 'outage_credit'), false);
  fails(f, () => f.event(ev(T('02-01', '09:00'), 'grid.outage_updated', {outage_id: 'out-99', status: 'restored'})), 'outage_reference_unknown');
});

test('W4 an outage of 2 started days credits round(2 x $60.00 / 31) = $3.87', () => {
  const f = fixture();
  journey(f, 'activated');
  f.event(ev(T('01-25', '13:00'), 'grid.outage_updated', {outage_id: 'out-78', service: 'internet', status: 'started', premise_ids: ['pr-linden-14']}));
  f.event(ev(T('01-26', '19:00'), 'grid.outage_updated', {outage_id: 'out-78', status: 'restored'}));
  f.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-0131', period: {from: '2027-01-15', to: '2027-01-31'},
    usage: {'sv-pr-linden-14-electricity': {kwh: 412}, 'sv-pr-linden-14-water': {gal: 2950}}}));
  assert.deepEqual(bill(f, 'bl-0131').lines.filter(l => l.kind === 'outage_credit').map(l => l.amount_cents), [-387]);
});

test('W4 a report with no known outage is investigating, and links when the outage is announced', () => {
  const f = fixture();
  assert.deepEqual(f.call('homegrid.outages.report', {premise_id: 'pr-maple-22', service_type: 'electricity'}), {report_id: 'rp-1', report_status: 'investigating', outage_id: null});
  fails(f, () => f.call('homegrid.outages.report', {premise_id: 'pr-linden-14', service_type: 'electricity'}), 'service_not_at_premise');
  f.event(ev(T('01-12', '10:20'), 'grid.outage_updated', {outage_id: 'out-5', service: 'electricity', status: 'started', premise_ids: ['pr-maple-22']}));
  assert.equal(f.data.reports[0].outage_id, 'out-5');
});

test('W4 core example: boil-water advisory bypasses quiet hours, is updated, then lifted', () => {
  const f = fixture();
  journey(f, 'ordered');
  f.call('homegrid.preferences.update', {quiet_hours: {start: '22:00', end: '09:30'}});
  const issue = {advisory_id: 'adv-bw7', version: 1, msg_type: 'issue', kind: 'boil_water', areas: ['ar-linden'], effective_from: T('01-13', '09:00'),
    instructions: 'Boil tap water for 1 minute before drinking, cooking or brushing teeth.'};
  f.event(ev(T('01-13', '09:00'), 'water.advisory_published', issue));
  const n = note(f, 'n-adv-bw7-1-sam');
  assert.deepEqual([n.status, n.health, n.release_at, n.premise_id], ['pending_delivery', true, null, 'pr-linden-14']);
  assert.equal(n.title, 'Boil-water advisory for 14 Linden Ct, Fairmont');
  f.event(ev(T('01-13', '15:00'), 'water.advisory_published', {...issue, version: 2, msg_type: 'update', premise_ids: ['pr-birch-3'],
    instructions: 'The advisory now also covers Birch St.', references: [{advisory_id: 'adv-bw7', version: 1}]}));
  assert.equal(f.call('homegrid.advisories.list', {premise_id: 'pr-birch-3'}).advisories[0].status, 'in_effect');
  f.event(ev(T('01-14', '16:00'), 'water.advisory_published', {...issue, version: 3, msg_type: 'lift', instructions: 'Tap water is safe to drink.',
    references: [{advisory_id: 'adv-bw7', version: 2}]}));
  const a = f.call('homegrid.advisories.list', {premise_id: 'pr-linden-14'}).advisories[0];
  assert.deepEqual([a.status, a.versions.map(v => v.version)], ['lifted', [1, 2, 3]]);
  fails(f, () => f.event(ev(T('01-14', '17:00'), 'water.advisory_published', {...issue, advisory_id: 'adv-zz', version: 2, msg_type: 'update'})), 'advisory_reference_unknown');
  fails(f, () => f.event(ev(T('01-14', '17:00'), 'water.advisory_published', {...issue, version: 3, msg_type: 'update'})), 'stale_advisory_version');
  fails(f, () => f.event(ev(T('01-14', '17:00'), 'water.advisory_published', {...issue, version: 4, msg_type: 'update', references: [{advisory_id: 'adv-bw7', version: 1}]})), 'stale_advisory_version');
});

test('W4 advisory status: upcoming, in_effect and ended for a planned shutoff', () => {
  const f = fixture();
  f.event(ev(T('01-12', '11:00'), 'water.advisory_published', {advisory_id: 'adv-ps', version: 1, msg_type: 'issue', kind: 'planned_shutoff', areas: ['ar-maple'],
    effective_from: T('01-14', '09:00'), planned_end: T('01-14', '13:00'), instructions: 'Water off for main repair.'}));
  const status = () => f.call('homegrid.advisories.list', {premise_id: 'pr-maple-22'}).advisories[0].status;
  assert.equal(status(), 'upcoming');
  f.advance(T('01-14', '10:00')); assert.equal(status(), 'in_effect');
  f.advance(T('01-14', '13:00')); assert.equal(status(), 'ended');
  assert.equal(note(f, 'n-adv-ps-1-sam').health, false);
});

test('W4 no advisory notice where the account has no service', () => {
  const f = fixture();
  f.event(ev(T('01-13', '09:00'), 'water.advisory_published', {advisory_id: 'adv-bw7', version: 1, msg_type: 'issue', kind: 'boil_water', areas: ['ar-linden'],
    effective_from: T('01-13', '09:00'), instructions: 'Boil water.'}));
  assert.equal(note(f, 'n-adv-bw7-1-sam'), undefined);
});

// ---- Workflow 5: bills, payments and payment plans ----
test('W5 core example: bl-0131 totals $123.94 from tariffs, proration and the missed-visit credit', () => {
  const f = fixture();
  journey(f, 'billed');
  const b = bill(f, 'bl-0131');
  assert.deepEqual(b.lines.map(l => [l.kind, l.amount_cents]), [['electricity', 8616], ['water', 3455], ['internet', 2323], ['missed_appointment_credit', -2000]]);
  assert.deepEqual([b.total_cents, b.due_date, b.status], [12394, '2027-02-21', 'open']);
  f.advance(T('02-22', '09:00'));
  assert.equal(bill(f, 'bl-0131').status, 'past_due');
  fails(f, () => f.call('homegrid.bills.get', {bill_id: 'bl-x'}), 'bill_not_found');
  fails(f, () => f.event(ev(T('02-22', '10:00'), 'billing.cycle_closed', {bill_id: 'bl-dup', period: {from: '2027-01-20', to: '2027-02-10'},
    usage: {'sv-pr-linden-14-water': {gal: 10}}})), 'invalid_event');
});

test('W5 core example: arrangement of $41.31, $41.31, $41.32 with no late fee; second request not eligible', () => {
  const f = fixture();
  journey(f, 'billed');
  f.advance(T('02-24', '10:00'));
  const r = f.call('homegrid.arrangements.request', {bill_id: 'bl-0131', installments: 3});
  assert.deepEqual(r.installments, [{due_date: '2027-03-03', amount_cents: 4131}, {due_date: '2027-04-02', amount_cents: 4131}, {due_date: '2027-05-02', amount_cents: 4132}]);
  assert.equal(f.call('homegrid.payments.list').arrangements[0].status, 'active');
  fails(f, () => f.call('homegrid.arrangements.request', {bill_id: 'bl-0131', installments: 2}), 'arrangement_not_eligible');
  february(f);
  assert.equal(bill(f, 'bl-0228').lines.some(l => l.kind === 'late_fee'), false);
  // An installment unpaid 5 days after its due date defaults the plan.
  f.advance('2027-03-09T00:00:00-05:00');
  assert.equal(f.call('homegrid.payments.list').arrangements[0].status, 'defaulted');
});

test('W5 without an arrangement the next bill adds a 1.5% late fee of $1.86', () => {
  const f = fixture();
  journey(f, 'billed');
  february(f);
  assert.deepEqual(bill(f, 'bl-0228').lines.filter(l => l.kind === 'late_fee').map(l => l.amount_cents), [186]);
});

test('W5 arrangement eligibility and installment count', () => {
  const f = fixture();
  journey(f, 'billed');
  fails(f, () => f.call('homegrid.arrangements.request', {bill_id: 'bl-0131', installments: 3}), 'arrangement_not_eligible', 'past-due');
  f.advance(T('02-24', '10:00'));
  fails(f, () => f.call('homegrid.arrangements.request', {bill_id: 'bl-0131', installments: 7}), 'invalid_installments');
  fails(f, () => f.call('homegrid.arrangements.request', {bill_id: 'bl-0131', installments: 1}), 'invalid_installments');
});

test('W5 core example: a payment is pending until settled and counts from its creation time', () => {
  const f = fixture();
  journey(f, 'billed');
  f.advance(T('02-24', '10:00'));
  const next = 'py-homegrid-sam-' + (f.data.payments.length + 1);
  assert.deepEqual(f.call('homegrid.payments.make', {amount_cents: 12394, payment_method_id: 'pm-visa'}), {payment_id: next});
  assert.equal(bill(f, 'bl-0131').status, 'past_due');
  f.event(ev(T('02-25', '09:00'), 'payment.settled', {selector: {oldest_pending: true}, outcome: 'settled'}));
  assert.equal(bill(f, 'bl-0131').status, 'paid');
  fails(f, () => f.call('homegrid.payments.make', {amount_cents: 100, payment_method_id: 'pm-nope'}), 'payment_method_not_found');
});

test('W5 a returned payment does not count and adds $15.00 to the next bill', () => {
  const f = fixture();
  journey(f, 'billed');
  f.advance(T('02-10', '10:00'));
  f.call('homegrid.payments.make', {amount_cents: 12394, payment_method_id: 'pm-checking'});
  const id = f.data.payments.at(-1).payment_id;
  f.event(ev(T('02-12', '09:00'), 'payment.settled', {payment_id: id, outcome: 'returned'}));
  assert.equal(f.call('homegrid.payments.list').payments.find(p => p.payment_id === id).status, 'returned');
  assert.equal(bill(f, 'bl-0131').status, 'open');
  february(f);
  assert.deepEqual(bill(f, 'bl-0228').lines.filter(l => ['returned_payment', 'late_fee'].includes(l.kind)).map(l => [l.kind, l.amount_cents]),
    [['returned_payment', 1500], ['late_fee', 186]]);
  fails(f, () => f.event(ev(T('03-01', '09:00'), 'payment.settled', {payment_id: 'py-nope', outcome: 'settled'})), 'invalid_event');
});

test('W5 a payment method seeded to fail always returns', () => {
  const f = withSeed(s => { s.customer.payment_methods[1].fails = true; });
  f.call('homegrid.payments.make', {amount_cents: 5000, payment_method_id: 'pm-checking'});
  f.event(ev(T('01-14', '09:00'), 'payment.settled', {selector: {oldest_pending: true}, outcome: 'settled'}));
  assert.equal(f.data.payments.at(-1).status, 'returned');
  assert.equal(f.data.charges.at(-1).amount_cents, 1500);
});

test('W5 autopay: scheduled for the due date, skipped when already covered, pending otherwise, cancelled when turned off', () => {
  // Covered by an earlier payment: skipped.
  const f = fixture();
  journey(f, 'activated');
  f.call('homegrid.autopay.set', {payment_method_id: 'pm-visa'});
  f.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-0131', period: {from: '2027-01-15', to: '2027-01-31'},
    usage: {'sv-pr-linden-14-electricity': {kwh: 412}, 'sv-pr-linden-14-water': {gal: 2950}}}));
  const auto = () => f.call('homegrid.payments.list').payments.find(p => p.payment_id === 'py-auto-bl-0131');
  assert.deepEqual([auto().status, auto().scheduled_for], ['scheduled', '2027-02-21']);
  fails(f, () => f.event(ev(T('02-01', '09:00'), 'payment.settled', {payment_id: 'py-auto-bl-0131', outcome: 'settled'})), 'invalid_transition');
  f.advance(T('02-10', '10:00'));
  f.call('homegrid.payments.make', {amount_cents: 12394, payment_method_id: 'pm-visa'});
  f.advance(T('02-21', '00:01'));
  assert.equal(auto().status, 'skipped');
  // Not covered: pending for the remaining balance, then it settles.
  const g = fixture();
  journey(g, 'activated');
  g.call('homegrid.autopay.set', {payment_method_id: 'pm-visa'});
  g.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-0131', period: {from: '2027-01-15', to: '2027-01-31'},
    usage: {'sv-pr-linden-14-electricity': {kwh: 412}, 'sv-pr-linden-14-water': {gal: 2950}}}));
  g.advance(T('02-10', '10:00'));
  g.call('homegrid.payments.make', {amount_cents: 2394, payment_method_id: 'pm-visa'});
  g.event(ev(T('02-21', '09:00'), 'payment.settled', {payment_id: 'py-auto-bl-0131', outcome: 'settled'}));
  const p = g.data.payments.find(x => x.payment_id === 'py-auto-bl-0131');
  assert.deepEqual([p.status, p.amount_cents], ['settled', 10000]);
  // Off: scheduled autopay payments are cancelled.
  const h = fixture();
  journey(h, 'activated');
  h.call('homegrid.autopay.set', {payment_method_id: 'pm-visa'});
  h.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-0131', period: {from: '2027-01-15', to: '2027-01-31'},
    usage: {'sv-pr-linden-14-electricity': {kwh: 412}, 'sv-pr-linden-14-water': {gal: 2950}}}));
  h.advance(T('02-02', '10:00'));
  h.call('homegrid.autopay.set', {payment_method_id: null});
  assert.equal(h.data.payments.find(x => x.payment_id === 'py-auto-bl-0131').status, 'cancelled');
});

// ---- Workflow 6: notifications and preferences ----
test('W6 core example: a billing notice at 23:59 is held until 07:00, then reads as pending after env.advance_time', () => {
  const f = fixture();
  journey(f, 'billed');
  const n = note(f, 'n-bl-0131-1-sam');
  assert.deepEqual([n.status, n.release_at, n.time], ['held_quiet_hours', '2027-02-01T07:00:00-05:00', '2027-02-01T07:00:00-05:00']);
  f.advance(T('02-01', '07:00'));
  assert.equal(note(f, 'n-bl-0131-1-sam').status, 'pending_delivery');
  // Later preference changes do not move a held notice.
  const g = fixture();
  journey(g, 'billed');
  g.call('homegrid.preferences.update', {quiet_hours: {start: '23:00', end: '05:00'}});
  assert.equal(g.data.notifications.find(x => x.notification_id === 'n-bl-0131-1-sam').release_at, '2027-02-01T07:00:00-05:00');
});

test('W6 a newer outage version before release withdraws the held one', () => {
  const f = fixture();
  journey(f, 'activated');
  f.event(ev(T('01-25', '23:00'), 'grid.outage_updated', {outage_id: 'out-80', service: 'internet', status: 'started', premise_ids: ['pr-linden-14'], etr: T('01-26', '04:00')}));
  f.event(ev(T('01-26', '03:00'), 'grid.outage_updated', {outage_id: 'out-80', status: 'etr_updated', etr: T('01-26', '08:00')}));
  assert.deepEqual([note(f, 'n-out-80-1-sam').status, note(f, 'n-out-80-2-sam').status], ['withdrawn', 'held_quiet_hours']);
  f.event(ev(T('01-26', '06:00'), 'grid.outage_updated', {outage_id: 'out-80', status: 'restored'}));
  f.advance(T('01-26', '07:00'));
  assert.deepEqual(notes(f, {type: 'outage'}).filter(n => n.source.id === 'out-80').map(n => n.status), ['withdrawn', 'withdrawn', 'pending_delivery']);
});

test('W6 health advisories: quiet-hour bypass and delivery are configurable; disabled advisories keep an in-app record', () => {
  const issue = at => ev(at, 'water.advisory_published', {advisory_id: 'adv-n', version: 1, msg_type: 'issue', kind: 'do_not_drink', areas: ['ar-maple'],
    effective_from: at, instructions: 'Do not drink tap water.'});
  const f = fixture();
  f.call('homegrid.preferences.update', {health: {bypass_quiet_hours: false}});
  f.event(issue(T('01-13', '02:00')));
  assert.deepEqual([note(f, 'n-adv-n-1-sam').status, note(f, 'n-adv-n-1-sam').release_at], ['held_quiet_hours', '2027-01-13T07:00:00-05:00']);
  const g = fixture();
  g.call('homegrid.preferences.update', {types: {advisory: {enabled: false, delivery: 'mail'}}, health: {delivery: 'in_app'}});
  g.event(issue(T('01-13', '02:00')));
  assert.equal(note(g, 'n-adv-n-1-sam').status, 'in_app');
  g.event(ev(T('01-13', '03:00'), 'water.advisory_published', {advisory_id: 'adv-p', version: 1, msg_type: 'issue', kind: 'planned_shutoff', areas: ['ar-maple'],
    effective_from: T('01-15', '09:00'), planned_end: T('01-15', '12:00'), instructions: 'Shutoff.'}));
  assert.equal(note(g, 'n-adv-p-1-sam'), undefined, 'a disabled type creates nothing unless it concerns health');
});

test('W6 preferences and acknowledgement errors', () => {
  const f = fixture();
  fails(f, () => f.call('homegrid.preferences.update', {time_zone: 'Mars/Olympus'}), 'invalid_preferences');
  fails(f, () => f.call('homegrid.preferences.update', {}), 'invalid_preferences');
  fails(f, () => f.call('homegrid.notifications.acknowledge', {notification_id: 'n-x'}), 'notification_not_found');
  const ack = f.call('homegrid.notifications.acknowledge', {notification_id: 'n-bl-1231-1-sam'});
  assert.equal(ack.acknowledged_at, '2027-01-12T10:00:00-05:00');
});

test('W6 delivery outcomes follow the Messaging table', () => {
  const f = fixture();
  journey(f, 'ordered');
  const id = 'n-tr-1-0-sam', record = (status, code, extra = {}) => f.event(ev(f.now, 'notification.delivery_recorded',
    {notification_id: id, status, code, router_event_id: status === 'committed' ? 'router-1' : null, ...extra}));
  record('rejected', 'idempotency_conflict');
  assert.equal(note(f, id).status, 'pending_delivery');
  record('unknown', 'receiver_unconfirmed', {stop_run: true});
  assert.deepEqual([note(f, id).status, note(f, id).outcome.stop_run], ['pending_delivery', true]);
  record('committed', null);
  assert.deepEqual([note(f, id).status, note(f, id).outcome.router_event_id], ['delivered', 'router-1']);
  fails(f, () => record('committed', null), 'notification_not_pending');
  const g = fixture();
  journey(g, 'ordered');
  g.event(ev(g.now, 'notification.delivery_recorded', {notification_id: id, status: 'rejected', code: 'recipient_not_authorized', router_event_id: null}));
  assert.equal(note(g, id).status, 'delivery_failed');
});

test('W6 the wire message is byte-stable and names the source object', () => {
  const f = fixture();
  journey(f, 'ordered');
  f.call('homegrid.preferences.update', {quiet_hours: {start: '22:00', end: '09:30'}});
  f.event(ev(T('01-13', '09:00'), 'water.advisory_published', {advisory_id: 'adv-bw7', version: 1, msg_type: 'issue', kind: 'boil_water', areas: ['ar-linden'],
    effective_from: T('01-13', '09:00'), instructions: 'Boil tap water for 1 minute before drinking, cooking or brushing teeth.'}));
  const d = f.data, n = d.notifications.find(x => x.notification_id === 'n-adv-bw7-1-sam');
  const m = message(d, n);
  assert.deepEqual([m.id, m.source, m.time, m.subject], ['homegrid-n-adv-bw7-1-sam', 'urn:pale:app:homegrid:account:homegrid-sam', '2027-01-13T09:00:00-05:00', 'adv-bw7']);
  assert.deepEqual(m.data.source_object, {app_id: 'homegrid', account_id: 'homegrid-sam', object_type: 'advisory', object_id: 'adv-bw7'});
  f.advance(T('01-13', '12:00'));
  assert.equal(JSON.stringify(message(f.data, f.data.notifications.find(x => x.notification_id === 'n-adv-bw7-1-sam'))), JSON.stringify(m));
});

// ---- Review regressions ----
test('after a move, fees for the old premise go on the next bill at the new one; a never-shipped hotspot is not charged', () => {
  const f = fixture();
  journey(f, 'billed');
  f.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-m-final', premise_id: 'pr-maple-22', period: {from: '2027-01-01', to: '2027-01-15'}, usage: {}}));
  assert.equal(note(f, 'n-bl-m-final-1-sam').type, 'billing', 'a final bill is still notified');
  f.advance(T('02-10', '10:00'));
  f.call('homegrid.payments.make', {amount_cents: 500, payment_method_id: 'pm-visa'});
  f.event(ev(T('02-12', '09:00'), 'payment.settled', {selector: {oldest_pending: true}, outcome: 'returned'}));
  assert.equal(f.data.charges.at(-1).premise_id, 'pr-linden-14');
  assert.equal(f.data.customer.late_payments.length, 0, 'a returned payment is not itself a late payment');
  february(f);
  const b = bill(f, 'bl-0228');
  assert.deepEqual(b.lines.filter(l => !['electricity', 'water', 'internet'].includes(l.kind)).map(l => [l.kind, l.amount_cents]).sort(),
    [['late_fee', 186], ['late_fee', Math.round(bill(f, 'bl-m-final').total_cents * 0.015)], ['returned_payment', 1500], ['unreturned_gateway', 12000]].sort());
  assert.equal(b.prior_balance_cents, 12394 + bill(f, 'bl-m-final').total_cents);
});

test('an activation scripted for a cancelled order is moot; a long failure reason is kept', () => {
  const f = fixture();
  journey(f, 'missed');
  f.call('homegrid.orders.cancel', {order_id: NET});
  f.event(ev(T('01-20', '10:55'), 'field.activation_result', {service_id: 'sv-pr-linden-14-internet', result: 'activated'}));
  assert.match(f.data.ignored_events[0].reason, /cancelled/);
  const g = fixture();
  journey(g, 'booked');
  g.event(ev(T('01-19', '09:00'), 'field.technician_update', {appointment_id: APPT1, status: 'arrived'}));
  g.event(ev(T('01-19', '10:00'), 'field.technician_update', {appointment_id: APPT1, status: 'completed'}));
  g.event(ev(T('01-19', '10:10'), 'field.activation_result', {service_id: 'sv-pr-linden-14-internet', result: 'failed', reason: 'x'.repeat(80)}));
  assert.equal(g.data.orders.find(o => o.order_id === NET).history.at(-1).action.length, 99);
});

test('activation notices of a cancelled and reordered start do not collide', () => {
  const f = fixture();
  journey(f, 'booked');
  const fail = (appt, day) => {
    f.event(ev(T(day, '09:00'), 'field.technician_update', {appointment_id: appt, status: 'arrived'}));
    f.event(ev(T(day, '10:00'), 'field.technician_update', {appointment_id: appt, status: 'completed'}));
    f.event(ev(T(day, '10:10'), 'field.activation_result', {service_id: 'sv-pr-linden-14-internet', result: 'failed', reason: 'no signal'}));
  };
  fail(APPT1, '01-19');
  f.call('homegrid.orders.cancel', {order_id: NET});
  const p = f.call('homegrid.orders.preview', {type: 'start', premise_id: 'pr-linden-14', service_type: 'internet'});
  const [order] = f.call('homegrid.orders.create', {order_token: p.order_token}).order_ids;
  const w = p.parts[0].earliest_window;
  f.call('homegrid.appointments.book', {order_id: order, date: w.date, slot: w.slot});
  fail('ap-' + order + '-1', w.date.slice(5));
  assert.equal(notes(f, {type: 'order'}).filter(n => n.title === 'Internet activation failed').length, 2);
});

test('a transfer from a premise without service is refused', () => {
  const f = fixture();
  fails(f, () => f.call('homegrid.orders.preview', {type: 'transfer', from_premise_id: 'pr-birch-3', to_premise_id: 'pr-linden-14', stop_date: '2027-01-15'}), 'service_not_active');
});

test('a rescheduled appointment withdraws the held notice for the earlier version', () => {
  const f = fixture();
  journey(f, 'ordered');
  f.advance(T('01-12', '23:00'));
  f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-19', slot: '08-12'});
  f.call('homegrid.appointments.reschedule', {appointment_id: APPT1, date: '2027-01-19', slot: '12-16'});
  assert.deepEqual([note(f, 'n-' + APPT1 + '-1-sam').status, note(f, 'n-' + APPT1 + '-2-sam').status], ['withdrawn', 'held_quiet_hours']);
});

test('an outage may name areas; advisory updates that drop a premise say so; a lift may omit carried fields', () => {
  const f = fixture();
  journey(f, 'ordered');
  f.event(ev(T('01-12', '11:00'), 'grid.outage_updated', {outage_id: 'out-a', service: 'water', status: 'started', areas: ['ar-linden']}));
  assert.ok(f.data.outages[0].premise_ids.includes('pr-linden-14') && f.data.outages[0].premise_ids.includes('pr-quarry-8'));
  f.event(ev(T('01-12', '11:05'), 'water.advisory_published', {advisory_id: 'adv-s', version: 1, msg_type: 'issue', kind: 'boil_water', areas: ['ar-linden'],
    effective_from: T('01-12', '11:05'), instructions: 'Boil water.'}));
  f.event(ev(T('01-12', '12:00'), 'water.advisory_published', {advisory_id: 'adv-s', version: 2, msg_type: 'update', areas: ['ar-hollow']}));
  assert.equal(note(f, 'n-adv-s-2-sam').title, 'Boil-water advisory no longer covers 14 Linden Ct, Fairmont');
  f.event(ev(T('01-12', '13:00'), 'water.advisory_published', {advisory_id: 'adv-s', version: 3, msg_type: 'lift'}));
  assert.equal(f.call('homegrid.advisories.list', {premise_id: 'pr-linden-14'}).advisories[0].status, 'lifted');
});

test('impossible calendar dates are rejected', () => {
  const f = fixture();
  fails(f, () => f.call('homegrid.orders.preview', {type: 'start', premise_id: 'pr-linden-14', service_type: 'water', date: '2027-02-30'}), 'invalid_date');
  fails(f, () => f.event(ev(T('02-01', '09:00'), 'billing.cycle_closed', {bill_id: 'bl-x', period: {from: '2027-01-01', to: '2027-01-32'}, usage: {}, premise_id: 'pr-maple-22'})), 'invalid_event');
});

// ---- Deterministic IDs, selectors and moot events ----
test('selectors that match nothing are moot: committed as no-ops with the reason recorded', () => {
  const f = fixture();
  const before = f.data;
  f.event(ev(T('01-12', '11:00'), 'field.technician_update', {selector: LINDEN, status: 'arrived'}));
  f.event(ev(T('01-12', '11:01'), 'payment.settled', {selector: {oldest_pending: true}, outcome: 'settled'}));
  const after = f.data;
  assert.deepEqual(after.ignored_events.map(e => [e.event_id.startsWith('ev-'), e.operation]), [[true, 'field.technician_update'], [true, 'payment.settled']]);
  assert.deepEqual({...after, ignored_events: []}, before);
  // An event for a cancelled appointment is moot too.
  const g = fixture();
  journey(g, 'booked');
  g.call('homegrid.appointments.cancel', {appointment_id: APPT1});
  g.event(ev(T('01-19', '09:00'), 'field.technician_update', {appointment_id: APPT1, status: 'arrived'}));
  assert.match(g.data.ignored_events[0].reason, /cancelled/);
});

test('notification IDs derive from the trigger key, and IDs are never reused', () => {
  const f = fixture();
  journey(f, 'billed');
  for (const n of f.data.notifications) assert.equal(n.notification_id, ['n', ...n.trigger_key.split('|').slice(1, 3), 'sam'].join('-'));
  const g = fixture();
  journey(g, 'booked');
  g.call('homegrid.appointments.cancel', {appointment_id: APPT1});
  assert.equal(g.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-20', slot: '08-12'}).appointment_id, APPT2);
});

// ---- Time, fixtures and packs ----
test('business days skip weekends and fixture holidays; quiet hours end at local time across DST', () => {
  const data = require('../fixtures/minimal.json');
  assert.equal(addBusinessDays(data, '2027-01-12', 2), '2027-01-14');
  assert.equal(addBusinessDays(data, '2027-01-14', 3), '2027-01-20');
  assert.equal(addBusinessDays(data, '2027-02-12', 1), '2027-02-16');
  const release = quietRelease(Date.parse('2027-03-14T01:30:00-05:00'), 'America/New_York', {start: '22:00', end: '07:00'});
  assert.equal(render(release, 'America/New_York'), '2027-03-14T07:00:00-04:00');
});

test('reads never change data and every read carries as_of', () => {
  const f = fixture();
  journey(f, 'billed');
  f.advance(T('02-25', '09:00'));
  const before = JSON.stringify(f.data);
  for (const [name, args] of [['homegrid.services.list', {}], ['homegrid.orders.list', {}], ['homegrid.bills.list', {}], ['homegrid.payments.list', {}],
    ['homegrid.equipment.list', {}], ['homegrid.notifications.list', {}], ['homegrid.advisories.list', {premise_id: 'pr-linden-14'}],
    ['homegrid.outages.list', {premise_id: 'pr-linden-14'}], ['homegrid.preferences.get', {}]]) {
    assert.equal(f.call(name, args).as_of, '2027-02-25T09:00:00-05:00');
  }
  assert.equal(JSON.stringify(f.data), before);
});

test('seed validation rejects inconsistent records', () => {
  const bad = (change, text) => assert.throws(() => withSeed(change), e => e.code === 'invalid_seed' && (!text || e.message.includes(text)));
  bad(s => { s.bills[0].total_cents += 1; }, 'total');
  bad(s => { s.services[0].service_id = 'sv-other'; }, 'sv-');
  bad(s => { s.payments[0].created_at = '2027-02-01T00:00:00-05:00'; }, 'after the current virtual time');
  bad(s => { s.notifications[0].notification_id = 'n-wrong'; }, 'trigger key');
  bad(s => { s.premises[0].area_id = 'ar-none'; });
  bad(s => { s.premises[0].external_ref = {app_id: 'lintel', account_id: 'lintel-sam', object_id: 'ls-1'}; }, 'binding');
});

test('fixture history recomputes: bills from usage and the catalog, from 2025-01-01 on', () => {
  const packs = ['move-remote-worker', 'boil-water-infant', 'tight-month'];
  for (const seed of [require('../fixtures/minimal.json'), ...packs.map(p => require(`../examples/packs/${p}/seed.json`))]) {
    for (const b of seed.bills) {
      assert.equal(b.total_cents, b.lines.reduce((s, l) => s + l.amount_cents, 0));
      for (const [sid, u] of Object.entries(b.usage)) {
        const type = sid.endsWith('electricity') ? 'electricity' : 'water', t = TARIFFS[type];
        assert.equal(b.lines.find(l => l.kind === type).amount_cents, Math.round(u[t.unit] * t.per_unit_cents) + t.customer_charge_cents);
      }
      assert.ok(b.period.from >= '2025-01-01');
    }
    for (const p of seed.payments) assert.ok(p.created_at >= '2025-01-01');
    assert.ok(seed.bills[0].period.from < '2025-02-01', 'history starts in January 2025');
  }
  const tight = require('../examples/packs/tight-month/seed.json');
  assert.equal(tight.bills.length, 26);
  assert.equal(tight.payments.filter(p => p.status === 'returned').length, 2);
  assert.equal(tight.arrangements.length, 1);
});

for (const name of ['move-remote-worker', 'boil-water-infant', 'tight-month']) {
  test(`pack ${name} loads and replays its events`, () => {
    const dir = `../examples/packs/${name}/`;
    const f = fixture({seed: require(dir + 'seed.json'), binding: require(dir + 'binding.json'), now: require(dir + 'clock.json').initial_time});
    for (const e of require(dir + 'events.json')) f.event(e);
    const d = f.data;
    if (name === 'move-remote-worker') {
      assert.equal(d.services.find(s => s.service_id === 'sv-pr-heron-7-internet').status, 'active');
      assert.equal(d.equipment.find(e => e.equipment_id === 'eq-gw-elm').status, 'returned');
      assert.deepEqual(d.bills.at(-1).lines.filter(l => l.kind === 'outage_credit').map(l => l.amount_cents), [-323]);
    }
    if (name === 'boil-water-infant') {
      const adv = f.call('homegrid.advisories.list', {premise_id: 'pr-river-12'}).advisories.find(a => a.advisory_id === 'adv-rv3');
      assert.deepEqual([adv.status, adv.versions.length], ['lifted', 3]);
      assert.equal(d.notifications.find(n => n.notification_id === 'n-adv-rv3-1-ama').release_at, '2027-04-07T07:00:00-05:00');
    }
    if (name === 'tight-month') assert.equal(d.ignored_events.length, 1, 'nothing pending to settle without the agent');
  });
}

test('records and objects describe the same business records', () => {
  const seed = require('../fixtures/minimal.json');
  assert.equal(plugin.records(seed).length, plugin.objects(seed).length);
  assert.equal(plugin.records(seed).length, require('../contribution/dataset.json').expected_counts.records);
});
