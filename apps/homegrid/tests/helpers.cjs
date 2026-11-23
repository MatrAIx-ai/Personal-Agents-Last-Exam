'use strict';
// The core-examples journey (proposal §2): Sam moves from 22 Maple St to 14 Linden Ct on Fri Jan 15, 2027.
// Each step builds on the previous one, so a test can stop at any step and branch from there.
let seq = 0;
const ev = (at, operation, payload) => ({event_id: 'ev-' + (++seq), at, operation, payload});
const T = (monthDay, hhmm) => `2027-${monthDay}T${hhmm}:00-05:00`;
const NET = 'or-pr-linden-14-internet-1', APPT1 = 'ap-' + NET + '-1', APPT2 = 'ap-' + NET + '-2';
const LOAN = 'or-pr-linden-14-internet-2';
const LINDEN = {premise_id: 'pr-linden-14', service_type: 'internet'};

function transfer(f) {
  return f.call('homegrid.orders.preview', {type: 'transfer', from_premise_id: 'pr-maple-22', to_premise_id: 'pr-linden-14',
    stop_date: '2027-01-15', start_date: '2027-01-15'});
}
const STEPS = [
  ['ordered', f => f.call('homegrid.orders.create', {order_token: transfer(f).order_token})],
  ['booked', f => f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-19', slot: '08-12'})],
  ['missed', f => f.event(ev(T('01-19', '12:05'), 'field.technician_update', {selector: LINDEN, status: 'missed_by_provider'}))],
  ['loaned', f => {
    f.advance(T('01-19', '12:30'));
    const p = f.call('homegrid.orders.preview', {type: 'temporary_internet', premise_id: 'pr-linden-14', from: '2027-01-19', to: '2027-01-26'});
    f.call('homegrid.orders.create', {order_token: p.order_token});
  }],
  ['rebooked', f => f.call('homegrid.appointments.book', {order_id: NET, date: '2027-01-20', slot: '08-12'})],
  ['completed', f => {
    f.event(ev(T('01-20', '09:10'), 'field.technician_update', {appointment_id: APPT2, status: 'arrived'}));
    f.event(ev(T('01-20', '10:40'), 'field.technician_update', {appointment_id: APPT2, status: 'completed'}));
  }],
  ['activated', f => f.event(ev(T('01-20', '10:55'), 'field.activation_result', {service_id: 'sv-pr-linden-14-internet', result: 'activated', speed_mbps: 300}))],
  ['outage', f => {
    f.event(ev(T('01-25', '13:00'), 'grid.outage_updated', {outage_id: 'out-77', service: 'internet', status: 'started', premise_ids: ['pr-linden-14'], etr: T('01-25', '18:00'), cause: 'fiber cut'}));
    f.event(ev(T('01-25', '17:30'), 'grid.outage_updated', {outage_id: 'out-77', status: 'etr_updated', etr: T('01-25', '21:00')}));
    f.event(ev(T('01-26', '02:30'), 'grid.outage_updated', {outage_id: 'out-77', status: 'restored'}));
  }],
  ['billed', f => f.event(ev(T('01-31', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-0131', period: {from: '2027-01-15', to: '2027-01-31'},
    usage: {'sv-pr-linden-14-electricity': {kwh: 412}, 'sv-pr-linden-14-water': {gal: 2950}}}))]
];
// Runs the steps after the last one this fixture reached, up to and including `until`.
const reached = new WeakMap();
function journey(f, until) {
  const end = STEPS.findIndex(([name]) => name === until);
  if (end < 0) throw new Error('Unknown step ' + until);
  for (let i = (reached.get(f) ?? -1) + 1; i <= end; i++) STEPS[i][1](f);
  reached.set(f, end);
  return f;
}
// Linden's February cycle (used to see fees on the next bill).
const february = f => f.event(ev(T('02-28', '23:59'), 'billing.cycle_closed', {bill_id: 'bl-0228', period: {from: '2027-02-01', to: '2027-02-28'},
  usage: {'sv-pr-linden-14-electricity': {kwh: 380}, 'sv-pr-linden-14-water': {gal: 2700}}}));

module.exports = {ev, T, NET, APPT1, APPT2, LOAN, LINDEN, transfer, journey, february};
